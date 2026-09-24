// Windows-only, isolated upgrade boundary exercise. Uses only fresh temporary
// files and a unique HKCU test subtree; no installed application is touched.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'win32');
const root = mkdtempSync(join(tmpdir(), 'athena-upgrade-check-'));
const scripts = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ps = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const prefix = `Software\\AthenaUpgradeTest-${process.pid}-${Date.now()}`;
const keys = { install: `${prefix}\\Install`, primary: `${prefix}\\Primary`, secondary: `${prefix}\\Legacy` };
const resultFile = join(root, 'result.ini');
const environment = {
  ...process.env, ATHENA_UPGRADE_INSTALL_KEY: keys.install, ATHENA_UPGRADE_UNINSTALL_KEY: keys.primary,
  ATHENA_UPGRADE_UNINSTALL_KEY_2: keys.secondary, ATHENA_UPGRADE_RESULT: resultFile,
};
const local = process.env.LOCALAPPDATA;
const cache = join(local, 'electron-builder/Cache/nsis-3.0.4.1');
const compiler = process.env.ATHENA_TEST_MAKENSIS || readdirSync(cache).map((entry) => join(cache, entry, 'Bin/makensis.exe')).find(existsSync);
const npmCache = join(local, 'npm-cache/_npx');
const builder = readdirSync(npmCache).map((entry) => join(npmCache, entry, 'node_modules/app-builder-lib'))
  .find((entry) => existsSync(join(entry, 'package.json')) && JSON.parse(readFileSync(join(entry, 'package.json'))).version === '26.15.3');
assert.ok(compiler && builder);
const templates = join(builder, 'templates/nsis');
const resources = join(local, 'electron-builder/Cache/nsis-resources-3.4.1');
const pluginFolder = readdirSync(resources).map((entry) => join(resources, entry, 'plugins/x86-unicode')).find(existsSync)
  || join(resources, 'plugins/x86-unicode');
const quote = (text) => text.replaceAll('$', '$$').replaceAll('"', '$\\"');
const clearRegistration = () => spawnSync('reg.exe', ['delete', `HKCU\\${prefix}`, '/f', '/reg:64'], { stdio: 'pipe' });
const reg = (key, name, value) => execFileSync('reg.exe', ['add', `HKCU\\${key}`, '/v', name, '/t', 'REG_SZ', '/d', value, '/f', '/reg:64'], { stdio: 'pipe' });
const inspectResult = () => Object.fromEntries(readFileSync(resultFile, 'utf16le').replace(/^\uFEFF/, '').split(/\r?\n/)
  .filter((line) => line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
function diagnostic(stage, category) {
  const bytes = readFileSync(resultFile + '.failure.ini');
  const contents = bytes.toString(bytes[0] === 0xff ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '').trim();
  assert.equal(contents, `[failure]\r\nStage=${stage}\r\nCategory=${category}`);
}
let cases = 0;
function helper(action, expected, extra = {}) {
  const result = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(scripts, 'windows-installer-upgrade.ps1'), '-Action', action], {
    env: { ...environment, ...extra }, encoding: 'utf8', timeout: 20000,
  });
  assert.equal(result.status, expected, `${action}: ${result.stderr}`);
  cases++;
}
const legacyMarker = join(root, 'LEGACY-WAS-EXECUTED');
const legacyExe = join(root, 'legacy.exe');
const safeExe = join(root, 'safe-uninstaller.exe');
const launcher = join(root, 'upgrade.exe');
const setup = (label, fallback = false) => {
  clearRegistration();
  const previous = join(root, label);
  mkdirSync(join(previous, 'resources/app'), { recursive: true });
  copyFileSync(legacyExe, join(previous, 'Uninstall Athena.exe'));
  writeFileSync(join(previous, 'Athena.exe'), 'synthetic application identity');
  writeFileSync(join(previous, 'resources/app/package.json'), JSON.stringify({ name: 'athena-shell', version: '0.1.0' }));
  writeFileSync(join(previous, 'resources/app/user-notes.txt'), 'nested user contents must survive');
  writeFileSync(join(previous, 'user-report.txt'), 'top-level user contents must survive');
  reg(fallback ? keys.secondary : keys.primary, 'UninstallString', `"${join(previous, 'Uninstall Athena.exe')}" /currentuser`);
  if (!fallback) reg(keys.install, 'InstallLocation', previous);
  reg(keys.install, 'KeepShortcuts', 'true');
  return previous;
};
const header = `
Unicode true
RequestExecutionLevel user
!addincludedir "${quote(join(templates, 'include'))}"
!addplugindir /x86-unicode "${quote(pluginFolder)}"
!include "StdUtils.nsh"
!define INSTALL_REGISTRY_KEY "${keys.install}"
!define UNINSTALL_REGISTRY_KEY "${keys.primary}"
!define UNINSTALL_REGISTRY_KEY_2 "${keys.secondary}"
!define APP_EXECUTABLE_FILENAME "Athena.exe"
!define UNINSTALL_FILENAME "Uninstall Athena.exe"
Var TestUpdated
!define isUpdated '$TestUpdated == 1'
!define isDeleteAppData '0 == 1'
!define allowToChangeInstallationDirectory
`;
const languages = `
LangString appRunning 1033 "Synthetic Athena is running"
LangString appClosing 1033 "Closing synthetic Athena"
LangString appCannotBeClosed 1033 "Synthetic Athena could not close"
LangString uninstallFailed 1033 "Synthetic uninstall failed"
`;
const compile = (name, contents) => {
  const path = join(root, name + '.nsi');
  writeFileSync(path, contents);
  // Match electron-builder's production warnings-as-errors policy in both
  // installer and BUILD_UNINSTALLER compilation contexts.
  execFileSync(compiler, ['/WX', '/V2', path], { encoding: 'utf8', stdio: 'pipe' });
};
async function withLock(target, mode, action) {
  const ready = join(root, 'lock-ready');
  const release = join(root, 'lock-release');
  for (const file of [ready, release]) rmSync(file, { force: true });
  const script = join(root, 'hold-lock.ps1');
  writeFileSync(script, `param($Target, $Mode, $Ready, $Release)
$ErrorActionPreference = 'Stop'
if ($Mode -eq 'cwd') { [Environment]::CurrentDirectory = $Target }
else { $handle = [IO.File]::Open($Target, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read) }
try {
  [IO.File]::WriteAllText($Ready, 'ready')
  while (-not [IO.File]::Exists($Release)) { Start-Sleep -Milliseconds 50 }
} finally {
  if ($Mode -eq 'cwd') { [Environment]::CurrentDirectory = [IO.Path]::GetTempPath() }
  else { $handle.Dispose() }
}
`);
  const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, target, mode, ready, release], { windowsHide: true, stdio: 'ignore' });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    for (let attempt = 0; !existsSync(ready) && attempt < 100; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(existsSync(ready), 'fixture lock ready');
    action();
  } finally { writeFileSync(release, 'release'); await exited; }
}
function launch(destination, expected, extra = {}) {
  const result = spawnSync(launcher, ['/S'], { env: { ...environment, ATHENA_TEST_DESTINATION: destination, ATHENA_TEST_LEGACY_MARKER: legacyMarker, ...extra }, timeout: 30000, encoding: 'utf8' });
  assert.equal(result.status, expected, `${destination}: ${result.error || result.stderr}`);
  assert.equal(existsSync(legacyMarker), false, 'registered legacy binary must never execute');
  cases++;
}
function preserved(previous) {
  const parent = dirname(previous);
  const name = previous.slice(parent.length + 1);
  const backups = readdirSync(parent).filter((entry) => entry.toLowerCase().startsWith((name + '.Athena-upgrade-backup-').toLowerCase()) && !entry.endsWith('.txt'));
  assert.equal(backups.length, 1);
  const backup = join(parent, backups[0]);
  assert.equal(readFileSync(join(backup, 'user-report.txt'), 'utf8'), 'top-level user contents must survive');
  assert.equal(readFileSync(join(backup, 'resources/app/user-notes.txt'), 'utf8'), 'nested user contents must survive');
  assert.deepEqual(readFileSync(join(backup, 'Uninstall Athena.exe')), readFileSync(legacyExe));
  assert.match(readFileSync(backup + '.txt', 'utf8'), /이 백업은 자동으로 삭제되지 않습니다/);
  return backup;
}

try {
  const diagnosticExe = join(root, 'diagnostic.exe');
  compile('diagnostic', `Unicode true
Name "Synthetic diagnostic boundary"
OutFile "${quote(diagnosticExe)}"
RequestExecutionLevel user
!include "LogicLib.nsh"
!define BUILD_UNINSTALLER
!include "${quote(join(scripts, 'windows-installer-upgrade.nsh'))}"
Function .onInit
 !insertmacro AthenaUpgradeFailure child-exit
FunctionEnd
Section
SectionEnd`);
  const reportFailure = () => {
    const reported = spawnSync(diagnosticExe, ['/S'], { env: environment, timeout: 10000 });
    assert.equal(reported.status, 2);
  };
  reportFailure();
  diagnostic('child-exit', 'installer');
  compile('legacy', `Unicode true\nName "Harmless legacy execution marker"\nOutFile "${quote(legacyExe)}"\nRequestExecutionLevel user
Function .onInit
 ReadEnvStr $0 ATHENA_TEST_LEGACY_MARKER
 FileOpen $1 "$0" w
 FileWrite $1 "legacy invoked"
 FileClose $1
 Quit
FunctionEnd
Section
SectionEnd`);
  const stockUninstaller = readFileSync(join(templates, 'uninstaller.nsh'), 'utf8');
  const atomicFunctions = stockUninstaller.slice(stockUninstaller.indexOf('Function un.atomicRMDir'), stockUninstaller.indexOf('\nSection '));
  const installerHelpers = readFileSync(join(templates, 'include/installer.nsh'), 'utf8');
  const shortcutMacros = installerHelpers.slice(installerHelpers.indexOf('!macro cleanupOldMenuDirectory'));
  const installSection = readFileSync(join(templates, 'installSection.nsh'), 'utf8');
  const shortcutDecision = installSection.slice(installSection.indexOf('Var /GLOBAL keepShortcuts'), installSection.indexOf('!insertmacro uninstallOldVersion'));
  // Compile the production custom removal macro with the pinned native atomic
  // removal functions. Registry deletion below mirrors the pinned final step,
  // scoped exclusively to the three synthetic keys above.
  compile('producer', `${header}
Name "Safe synthetic uninstaller producer"
OutFile "${quote(join(root, 'producer.exe'))}"
!define BUILD_UNINSTALLER
!include "${quote(join(scripts, 'windows-installer.nsh'))}"
${languages}
${atomicFunctions}
Function .onInit
 WriteUninstaller "${quote(safeExe)}"
 SetErrorLevel 0
 Quit
FunctionEnd
Function un.onInit
 SetShellVarContext current
 SetRegView 64
 SetOutPath $INSTDIR
 \${GetParameters} $R0
 ReadEnvStr $R8 ATHENA_TEST_CHILD_ARGS
 StrCmp $R8 "" +4
   FileOpen $R9 "$R8" w
   FileWriteUTF16LE $R9 "$R0"
   FileClose $R9
 ClearErrors
 \${GetOptions} $R0 "--updated" $R1
 StrCpy $TestUpdated 0
 \${IfNot} \${Errors}
   StrCpy $TestUpdated 1
 \${EndIf}
 !insertmacro customCheckAppRunning
 ; Exercise legacy missing-InstallLocation behavior of initMultiUser.
 ReadRegStr $0 HKCU "${keys.install}" InstallLocation
 StrCmp $0 "" 0 +2
   StrCpy $INSTDIR "$TEMP\\wrong-default-location"
 !insertmacro customUnInit
FunctionEnd
Section
SectionEnd
Section "Uninstall"
 ReadEnvStr $0 ATHENA_TEST_CHILD_FAIL
 StrCmp $0 "1" 0 +3
   SetErrorLevel 7
   Quit
 !insertmacro customRemoveFiles
 ReadEnvStr $0 ATHENA_TEST_RESIDUAL_REGISTRY
 StrCmp $0 "1" done
 DeleteRegKey HKCU "${keys.primary}"
 DeleteRegKey HKCU "${keys.secondary}"
 DeleteRegKey HKCU "${keys.install}"
 done:
 SetErrorLevel 0
SectionEnd`);
  execFileSync(join(root, 'producer.exe'), ['/S'], { stdio: 'pipe' });
  compile('launcher', `${header}
Name "Safe synthetic upgrade boundary"
OutFile "${quote(launcher)}"
!define UNINSTALLER_OUT_FILE "${quote(safeExe)}"
Var installMode
Var hasPerMachineInstallation
Var appExe
Var oldDesktopLink
Var oldStartMenuLink
Var newDesktopLink
Var newStartMenuLink
Var oldMenuDirectory
Var TestNoDesktop
!define APP_DESCRIPTION "Synthetic upgrade shortcut"
!define APP_ID "test.athena.upgrade"
!define isNoDesktopShortcut '$TestNoDesktop == 1'
!include "${quote(join(scripts, 'windows-installer.nsh'))}"
!insertmacro customHeader
!include "installUtil.nsh"
${shortcutMacros}
${languages}
Function .onInit
 SetShellVarContext current
 SetRegView 64
 ReadEnvStr $INSTDIR ATHENA_TEST_DESTINATION
 ReadEnvStr $0 ATHENA_TEST_PARENT_OLD_CWD
 StrCmp $0 "1" 0 +2
   SetOutPath $INSTDIR
 StrCpy $appExe "$INSTDIR\\Athena.exe"
 StrCpy $installMode "CurrentUser"
 ReadEnvStr $0 ATHENA_TEST_ALL_USERS
 StrCmp $0 "1" 0 +2
   StrCpy $installMode "all"
 StrCpy $hasPerMachineInstallation "1"
 !insertmacro customInit
 StrCmp $hasPerMachineInstallation "0" +3
   SetErrorLevel 4
   Quit
 StrCpy $TestUpdated 1
 ReadEnvStr $TestNoDesktop ATHENA_TEST_NO_DESKTOP
 ReadEnvStr $0 ATHENA_TEST_MANUAL_INSTALL
 StrCmp $0 "1" 0 +2
   StrCpy $TestUpdated 0
 ReadEnvStr $0 ATHENA_TEST_SHORTCUT_DIR
 StrCpy $newDesktopLink "$0\\desktop.lnk"
 StrCpy $newStartMenuLink "$0\\start.lnk"
 StrCpy $oldDesktopLink $newDesktopLink
 StrCpy $oldStartMenuLink $newStartMenuLink
 ReadEnvStr $0 ATHENA_TEST_RENAME_LINKS
 StrCmp $0 "1" 0 +3
   StrCpy $oldDesktopLink "$newDesktopLink.old.lnk"
   StrCpy $oldStartMenuLink "$newStartMenuLink.old.lnk"
 !insertmacro customCheckAppRunning
 ${shortcutDecision}
 ; Real pinned fallback: after safe cleanup this must never find/run legacy.
 !insertmacro uninstallOldVersion SHELL_CONTEXT
 !insertmacro handleUninstallResult SHELL_CONTEXT
 ReadEnvStr $0 ATHENA_TEST_LATE_FAILURE
 StrCmp $0 "1" 0 +3
   SetErrorLevel 6
   Quit
 ReadEnvStr $0 ATHENA_TEST_SHORTCUT_DIR
 StrCmp $0 "" no_shortcut_fixture
 SetOutPath $INSTDIR
 File /oname=Athena.exe "${quote(legacyExe)}"
 !insertmacro addDesktopLink $keepShortcuts
 !insertmacro addStartMenuLink $keepShortcuts
 ; The optional cleanup test targets only this temporary shortcut directory,
 ; never the real Start Menu path used by the pinned creation macros.
 ReadEnvStr $0 ATHENA_TEST_SHARED_MENU
 StrCmp $0 "1" 0 +2
   StrCpy $oldMenuDirectory "synthetic-shared-menu"
 !insertmacro customInstall
 no_shortcut_fixture:
 SetErrorLevel 73
 Quit
FunctionEnd
Section
SectionEnd`);

  helper('Inspect', 1);
  let previous = setup("O'Brien 한글 same");
  helper('Inspect', 0);
  assert.equal(inspectResult().Root, previous);
  reg(keys.install, 'InstallLocation', previous.toUpperCase() + '\\');
  helper('Inspect', 0);
  const childArgs = join(root, 'child-args.txt');
  launch(previous, 73, { ATHENA_TEST_PARENT_OLD_CWD: '1', ATHENA_TEST_CHILD_ARGS: childArgs });
  const passedArgs = readFileSync(childArgs, 'utf16le');
  for (const argument of ['/KEEP_APP_DATA', '/currentuser', '--updated', '--keep-shortcuts', '/ATHENA-PRESERVE-UPGRADE']) assert.ok(passedArgs.includes(argument));
  assert.equal(passedArgs.includes('--delete-app-data'), false);
  preserved(previous);
  helper('VerifyRemoved', 0);

  previous = setup('legacy-fallback', true);
  helper('Inspect', 0);
  launch(join(root, 'relocated'), 73);
  preserved(previous);
  helper('VerifyRemoved', 0);

  previous = setup('nested-relocation');
  launch(join(previous, 'new-location'), 73);
  preserved(previous);
  // Simulate the extraction stage creating the requested nested destination.
  mkdirSync(join(previous, 'new-location'), { recursive: true });
  writeFileSync(join(previous, 'new-location/new-app'), 'new install');
  assert.ok(existsSync(preserved(previous)));

  previous = setup('child-fails');
  launch(join(root, 'failure-new'), 2, { ATHENA_TEST_CHILD_FAIL: '1' });
  assert.ok(existsSync(previous));
  helper('Inspect', 0);
  previous = setup('residual-registration');
  launch(join(root, 'residual-new'), 2, { ATHENA_TEST_RESIDUAL_REGISTRY: '1' });
  preserved(previous);
  helper('VerifyRemoved', 2);
  diagnostic('verify-registration', 'validation');
  reportFailure();
  diagnostic('verify-registration', 'validation');
  previous = setup('later-extraction-failure');
  launch(join(root, 'late-new'), 6, { ATHENA_TEST_LATE_FAILURE: '1' });
  preserved(previous);

  previous = setup('locked-result-rollback');
  helper('Inspect', 0);
  let plan = inspectResult();
  await withLock(resultFile, 'file', () => helper('Preserve', 2, { ATHENA_UPGRADE_EXPECTED_ROOT: previous, ATHENA_UPGRADE_BACKUP: plan.Backup }));
  diagnostic('preserve-result', 'io');
  assert.ok(existsSync(join(previous, 'resources/app/user-notes.txt')));
  assert.equal(existsSync(plan.Backup), false, 'result-write failure restores previous root');
  assert.equal(existsSync(plan.Receipt), false, 'rollback removes only its new receipt');
  helper('Inspect', 0);
  assert.equal(existsSync(resultFile + '.failure.ini'), false, 'new inspection clears stale diagnostics');
  plan = inspectResult();
  await withLock(previous, 'cwd', () => helper('Preserve', 2, { ATHENA_UPGRADE_EXPECTED_ROOT: previous, ATHENA_UPGRADE_BACKUP: plan.Backup }));
  diagnostic('preserve-move', 'io');
  assert.ok(existsSync(previous), 'rename failure leaves old install intact');
  helper('VerifyRemoved', 2);

  const shortcutDir = join(root, 'shortcuts');
  mkdirSync(shortcutDir);
  previous = setup('absent-shortcuts');
  launch(previous, 73, { ATHENA_TEST_SHORTCUT_DIR: shortcutDir });
  assert.equal(existsSync(join(shortcutDir, 'desktop.lnk')), false);
  assert.equal(existsSync(join(shortcutDir, 'start.lnk')), false);
  preserved(previous);
  previous = setup('no-desktop-option');
  launch(previous, 73, { ATHENA_TEST_SHORTCUT_DIR: shortcutDir, ATHENA_TEST_NO_DESKTOP: '1' });
  assert.equal(existsSync(join(shortcutDir, 'desktop.lnk')), false);
  assert.equal(existsSync(join(shortcutDir, 'start.lnk')), false);
  const createLink = join(root, 'create-link.ps1');
  writeFileSync(createLink, `param($Target, $Link)\n$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($Link)\n$shortcut.TargetPath = $Target\n$shortcut.Arguments = '--user-choice'\n$shortcut.Save()\n`);
  for (const renamed of [false, true]) {
    previous = setup(renamed ? 'renamed-shortcuts' : 'present-shortcuts');
    const originals = new Map();
    for (const name of ['desktop.lnk', 'start.lnk']) {
      const link = join(shortcutDir, name + (renamed ? '.old.lnk' : ''));
      execFileSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', createLink, join(previous, 'Athena.exe'), link], { stdio: 'pipe' });
      originals.set(name, readFileSync(link));
    }
    if (renamed) writeFileSync(join(shortcutDir, 'other-app.txt'), 'unrelated menu content');
    launch(previous, 73, { ATHENA_TEST_SHORTCUT_DIR: shortcutDir, ATHENA_TEST_RENAME_LINKS: renamed ? '1' : '', ATHENA_TEST_SHARED_MENU: renamed ? '1' : '' });
    for (const [name, bytes] of originals) {
      assert.deepEqual(readFileSync(join(shortcutDir, name)), bytes, 'existing shortcut bytes preserved');
      if (renamed) assert.equal(existsSync(join(shortcutDir, name + '.old.lnk')), false);
      rmSync(join(shortcutDir, name));
    }
    if (renamed) assert.equal(readFileSync(join(shortcutDir, 'other-app.txt'), 'utf8'), 'unrelated menu content');
    preserved(previous);
  }
  previous = setup('manual-install-shortcuts');
  launch(previous, 73, { ATHENA_TEST_SHORTCUT_DIR: shortcutDir, ATHENA_TEST_MANUAL_INSTALL: '1' });
  assert.ok(existsSync(join(shortcutDir, 'desktop.lnk')) && existsSync(join(shortcutDir, 'start.lnk')), 'manual reinstall retains stock recreate behavior');

  previous = setup('invalid-tuple');
  reg(keys.install, 'InstallLocation', join(root, 'mismatched'));
  helper('Inspect', 2);
  diagnostic('inspect-registration', 'validation');
  launch(join(root, 'invalid-new'), 2);
  assert.ok(existsSync(previous));
  reg(keys.install, 'InstallLocation', previous);
  reg(keys.primary, 'UninstallString', join(previous, 'Uninstall Athena.exe'));
  reg(keys.secondary, 'UninstallString', `"${join(previous, 'Uninstall Athena.exe')}" /currentuser`);
  helper('Inspect', 2);
  reg(keys.primary, 'UninstallString', '"C:relative\\Uninstall Athena.exe"');
  helper('Inspect', 2);
  reg(keys.primary, 'UninstallString', '"\\root-relative\\Uninstall Athena.exe"');
  helper('Inspect', 2);
  reg(keys.primary, 'UninstallString', `"${join(previous, 'Uninstall Athena.exe')}" /allusers`);
  helper('Inspect', 2);
  reg(keys.primary, 'UninstallString', `"${join(previous, 'Uninstall Athena.exe')}" /currentuser`);
  reg(keys.secondary, 'UninstallString', 'malformed ignored fallback');
  helper('Inspect', 0);
  writeFileSync(join(previous, 'resources/app/package.json'), '{"name":"other-app"}');
  helper('Inspect', 2);
  writeFileSync(join(previous, 'resources/app/package.json'), '{"name":"athena-shell"}');
  for (const protectedRoot of [process.env.USERPROFILE, process.env.APPDATA, join(process.env.APPDATA, 'Athena'), join(process.env.USERPROFILE, '.athena'), 'C:\\']) {
    reg(keys.install, 'InstallLocation', protectedRoot);
    helper('Inspect', 2);
  }
  const junction = join(root, 'old-junction');
  symlinkSync(previous, junction, 'junction');
  reg(keys.install, 'InstallLocation', junction);
  reg(keys.primary, 'UninstallString', `"${join(junction, 'Uninstall Athena.exe')}" /currentuser`);
  helper('Inspect', 2);
  clearRegistration();
  launch(join(root, 'all-users-block'), 2, { ATHENA_TEST_ALL_USERS: '1' });
  previous = setup('ordinary-direct-uninstall');
  const direct = spawnSync(safeExe, ['/S', `_?=${previous}`], { env: environment, timeout: 15000 });
  assert.equal(direct.status, 0, 'ordinary uninstall retains the standard removal path');
  assert.equal(existsSync(previous), false);
  assert.equal(readdirSync(root).some((name) => name.startsWith('ordinary-direct-uninstall.Athena-upgrade-backup-')), false);
  helper('VerifyRemoved', 0);
  assert.equal(existsSync(legacyMarker), false);
  console.log(`PASS: ${cases} upgrade boundary cases; legacy executable never ran; mixed-use files and persistent recovery receipts preserved`);
} finally {
  clearRegistration();
  rmSync(root, { recursive: true, force: true });
}
