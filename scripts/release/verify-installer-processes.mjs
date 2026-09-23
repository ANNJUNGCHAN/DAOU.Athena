// Windows-only integration check: compile harmless test executables and run
// the production process helper against them. Never target installed Athena.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'win32');
const root = mkdtempSync(join(tmpdir(), 'athena-process-check-'));
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const helper = join(sourceRoot, 'windows-installer-processes.ps1');
const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const install = join(root, "O'Brien 한글 Athena");
const state = join(root, 'state.json');
const identities = new Set();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((accept) => setTimeout(accept, ms));
async function until(predicate, label) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await sleep(100); }
  throw new Error(`Timed out: ${label}`);
}
const readState = () => JSON.parse(readFileSync(state, 'utf8').replace(/^\uFEFF/, ''));
const invoke = (action, expected) => {
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Action', action], {
    env: { ...process.env, ATHENA_INSTALLER_PROCESS_ROOT: install, ATHENA_INSTALLER_PROCESS_STATE: state, ATHENA_INSTALLER_PROCESS_PID: String(process.pid) },
    encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, expected, `${action}: ${result.stderr}`);
};
function start(executable, args = []) {
  const child = spawn(executable, args, { windowsHide: args.length === 0, stdio: 'ignore' });
  identities.add(child.pid);
  return child;
}
try {
  mkdirSync(join(install, 'resources/backend'), { recursive: true });
  mkdirSync(install + 'Backup');
  const csharp = join(root, 'ProcessFixture.cs');
  writeFileSync(csharp, `
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;
public class ProcessFixture {
  [STAThread] public static void Main(string[] args) {
    if (args.Length == 0) { Thread.Sleep(Timeout.Infinite); return; }
    var form = new Form { StartPosition = FormStartPosition.Manual, Left = -32000, Top = -32000, Width = 1, Height = 1 };
    form.Shown += (sender, e) => {
      var child = Process.Start(new ProcessStartInfo(args[0]) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden });
      File.WriteAllText(args[1] + ".bits", IntPtr.Size.ToString());
      File.WriteAllText(args[1], child.Id.ToString());
    };
    if (args.Length > 2) form.FormClosing += (sender, e) => { e.Cancel = true; };
    Application.Run(form);
  }
}
`);
  const executable = join(install, 'Athena.exe');
  const csc = join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  execFileSync(csc, ['/nologo', '/target:winexe', '/platform:x64', '/reference:System.Windows.Forms.dll', `/out:${executable}`, csharp], { stdio: 'pipe' });
  const backend = join(install, 'resources/backend/python.exe');
  const unrelated = join(install, 'unrelated.exe');
  const sibling = join(install + 'Backup', 'Athena.exe');
  for (const target of [backend, unrelated, sibling]) copyFileSync(executable, target);
  const peer = start(unrelated);
  const neighbor = start(sibling);
  const ready = join(root, 'ready');
  const parent = start(executable, [backend, ready]);
  await until(() => existsSync(ready), 'synthetic root ready');
  assert.equal(readFileSync(ready + '.bits', 'utf8'), '8', 'fixture must actually execute as x64');
  const childPid = Number(readFileSync(ready, 'utf8'));
  identities.add(childPid);
  invoke('Find', 0);
  assert.deepEqual(readState().Processes.map((row) => row.Id).sort((a, b) => a - b), [parent.pid, childPid].sort((a, b) => a - b));
  invoke('Close', 0);
  await until(() => !alive(parent.pid), 'graceful parent exit');
  assert.ok(alive(childPid), 'child survives parent graceful close');
  invoke('Find', 0);
  assert.deepEqual(readState().Processes.map((row) => row.Id), [childPid]);
  invoke('Force', 0);
  await until(() => !alive(childPid), 'owned child stopped');
  invoke('Find', 1);
  assert.ok(alive(peer.pid), 'unrelated process in install folder remains alive');
  assert.ok(alive(neighbor.pid), 'AthenaBackup sibling remains alive');
  // An old identity must not authorize force against a reused PID.
  writeFileSync(state, JSON.stringify({ Root: install, Processes: [{ Id: peer.pid, Path: unrelated, Started: '1' }] }));
  invoke('Force', 1);
  assert.ok(alive(peer.pid));
  // A window that refuses CloseMainWindow (Athena's tray behavior) still
  // follows the explicit force stage, never pretending it gracefully quit.
  const stubbornReady = join(root, 'stubborn-ready');
  const stubborn = start(executable, [backend, stubbornReady, 'ignore-close']);
  await until(() => existsSync(stubbornReady), 'stubborn root ready');
  const stubbornChild = Number(readFileSync(stubbornReady, 'utf8'));
  identities.add(stubbornChild);
  invoke('Find', 0);
  invoke('Close', 0);
  assert.ok(alive(stubborn.pid));
  invoke('Force', 0);
  await until(() => !alive(stubborn.pid) && !alive(stubbornChild), 'force closes retained exact identities');
  assert.ok(alive(peer.pid) && alive(neighbor.pid));
  writeFileSync(state, '{invalid JSON');
  invoke('Force', 2);
  assert.ok(alive(peer.pid) && alive(neighbor.pid), 'corrupt state never authorizes process termination');

  // Compile the actual NSIS hook with BUILD_UNINSTALLER. A missing PowerShell
  // executable must stop before any process handling or installation action.
  const cache = join(process.env.LOCALAPPDATA, 'electron-builder/Cache/nsis-3.0.4.1');
  const compiler = process.env.ATHENA_TEST_MAKENSIS || readdirSync(cache).map((entry) => join(cache, entry, 'Bin/makensis.exe')).find(existsSync);
  assert.ok(compiler);
  const nsis = join(root, 'hook.nsi');
  const hookExe = join(root, 'hook.exe');
  const quote = (value) => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
  writeFileSync(nsis, `
Unicode true
Name "Athena process hook test"
OutFile "${quote(hookExe)}"
RequestExecutionLevel user
!define BUILD_UNINSTALLER
!define isUpdated '0 == 1'
!include "${quote(join(sourceRoot, 'windows-installer.nsh'))}"
LangString appRunning 1033 "Synthetic running process"
LangString appClosing 1033 "Closing synthetic process"
LangString appCannotBeClosed 1033 "Synthetic process could not close"
Function .onInit
  ReadEnvStr $INSTDIR ATHENA_TEST_DESTINATION
  StrCpy $AthenaPowerShell "$PLUGINSDIR\\missing-powershell.exe"
  !insertmacro AthenaCheckProcesses
  SetErrorLevel 73
  Quit
FunctionEnd
Section
SectionEnd
`);
  execFileSync(compiler, ['/V2', nsis], { stdio: 'pipe' });
  const blocked = spawnSync(hookExe, ['/S'], { env: { ...process.env, ATHENA_TEST_DESTINATION: install }, timeout: 10000 });
  assert.equal(blocked.status, 2, 'missing PowerShell blocks safely');
  assert.ok(alive(peer.pid) && alive(neighbor.pid));
  // Exercise the actual custom hook too: 32-bit NSIS must launch native
  // PowerShell so it can inspect our explicitly x64 process modules.
  writeFileSync(nsis, readFileSync(nsis, 'utf8').replace(
    '  StrCpy $AthenaPowerShell "$PLUGINSDIR\\missing-powershell.exe"\n  !insertmacro AthenaCheckProcesses',
    '  !insertmacro customCheckAppRunning',
  ));
  execFileSync(compiler, ['/V2', nsis], { stdio: 'pipe' });
  const hookReady = join(root, 'hook-ready');
  const hookParent = start(executable, [backend, hookReady]);
  await until(() => existsSync(hookReady), 'NSIS hook root ready');
  const hookChild = Number(readFileSync(hookReady, 'utf8'));
  identities.add(hookChild);
  const completed = spawnSync(hookExe, ['/S'], { env: { ...process.env, ATHENA_TEST_DESTINATION: install }, timeout: 30000 });
  assert.equal(completed.status, 73, `actual uninstaller hook: ${completed.error || ''}`);
  await until(() => !alive(hookParent.pid) && !alive(hookChild), 'actual NSIS helper closes owned processes');
  assert.ok(alive(peer.pid) && alive(neighbor.pid));
  writeFileSync(nsis, readFileSync(nsis, 'utf8').replace('!define BUILD_UNINSTALLER', `!define INSTALL_REGISTRY_KEY "Software\\AthenaProcessHarnessUnused"
!define APP_EXECUTABLE_FILENAME "Athena.exe"
!define UNINSTALL_FILENAME "Uninstall Athena.exe"`).replace('LangString appRunning', `!insertmacro customHeader
!macroundef AthenaInspectUpgrade
!macro AthenaInspectUpgrade
  StrCpy $AthenaOldInstallRoot ""
!macroend
!macroundef AthenaPerformUpgrade
!macro AthenaPerformUpgrade
!macroend
LangString appRunning`));
  execFileSync(compiler, ['/V2', nsis], { stdio: 'pipe' });
  const freshInstall = join(root, 'fresh-install');
  const freshResult = spawnSync(hookExe, ['/S'], { env: { ...process.env, ATHENA_TEST_DESTINATION: freshInstall }, timeout: 10000 });
  assert.equal(freshResult.status, 73, 'installer guard plus process hook accepts fresh safe destination');
  const occupiedResult = spawnSync(hookExe, ['/S'], { env: { ...process.env, ATHENA_TEST_DESTINATION: install }, timeout: 10000 });
  assert.equal(occupiedResult.status, 2, 'installer guard rejects unregistered nonempty destination before process hook');
  assert.ok(alive(peer.pid) && alive(neighbor.pid));
  console.log('PASS: exact root/descendant selection, graceful close, retained child, force, PID identity, sibling/unrelated preservation, apostrophe/Unicode path, and missing-PowerShell NSIS failure');
} finally {
  // Check the executable again, so a recycled fixture PID cannot target a
  // user's unrelated process during cleanup.
  const cleanup = join(root, 'cleanup.ps1');
  writeFileSync(cleanup, `param($Root, $ProcessIds)
$prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\\') + '\\'
foreach ($number in $ProcessIds.Split(',')) {
  try {
    $item = [Diagnostics.Process]::GetProcessById([int]$number)
    try {
      if ($item.MainModule.FileName.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        $item.Kill()
        [void]$item.WaitForExit(1000)
      }
    } finally { $item.Dispose() }
  } catch [ArgumentException] { }
}
`);
  execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', cleanup, root, [...identities].join(',')], { stdio: 'pipe' });
  await sleep(300);
  rmSync(root, { recursive: true, force: true });
}
