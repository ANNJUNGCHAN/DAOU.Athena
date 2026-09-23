// Windows-only executable NSIS policy checks. No application is installed and
// the real process-closing macros are replaced by an observable exit code.
// Requires the pinned electron-builder/NSIS caches from an installer build.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'win32', 'Run this executable policy check on Windows');
const local = process.env.LOCALAPPDATA;
const nsisCache = join(local, 'electron-builder/Cache/nsis-3.0.4.1');
const compiler = process.env.ATHENA_TEST_MAKENSIS || readdirSync(nsisCache)
  .map((entry) => join(nsisCache, entry, 'Bin/makensis.exe')).find(existsSync);
const npmCache = join(local, 'npm-cache/_npx');
const builder = readdirSync(npmCache).map((entry) => join(npmCache, entry, 'node_modules/app-builder-lib'))
  .find((entry) => existsSync(join(entry, 'package.json')) && JSON.parse(readFileSync(join(entry, 'package.json'))).version === '26.15.3');
assert.ok(compiler && builder, 'Build once with electron-builder 26.15.3 to populate its NSIS cache');
const templates = join(builder, 'templates/nsis');
const include = resolve(dirname(fileURLToPath(import.meta.url)), '../windows-installer.nsh');
const root = mkdtempSync(join(tmpdir(), 'athena-install-dir-'));
const regKey = `Software\\AthenaInstallerDirectoryTest-${process.pid}-${Date.now()}`;
const regPath = `HKCU\\${regKey}`;
const output = join(root, 'check.exe');
const quote = (value) => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
const fixture = join(root, 'check.nsi');
writeFileSync(fixture, `
Unicode true
Name "Athena directory policy test"
OutFile "${quote(output)}"
RequestExecutionLevel user
!addincludedir "${quote(join(templates, 'include'))}"
!define INSTALL_REGISTRY_KEY "${regKey}"
!define APP_EXECUTABLE_FILENAME "Athena.exe"
!define UNINSTALL_FILENAME "Uninstall Athena.exe"
!include "${quote(include)}"
!insertmacro customHeader
!macroundef AthenaInspectUpgrade
!macro AthenaInspectUpgrade
  StrCpy $AthenaOldInstallRoot ""
!macroend
!macroundef AthenaPerformUpgrade
!macro AthenaPerformUpgrade
!macroend
!macroundef AthenaCheckProcesses
!macro AthenaCheckProcesses
  SetErrorLevel 73
  Quit
!macroend
Function .onInit
  SetShellVarContext current
  ReadEnvStr $INSTDIR ATHENA_TEST_DESTINATION
  ; Execute the exact install-section hook before any UI. /S determines
  ; whether NSIS takes the silent branch; valid cases have no UI either way.
  !insertmacro customCheckAppRunning
FunctionEnd
Section
SectionEnd
`);
let cases = 0;
const setRegistered = (path) => execFileSync('reg.exe', ['add', regPath, '/v', 'InstallLocation', '/t', 'REG_SZ', '/d', path, '/f'], { stdio: 'pipe' });
const run = (label, path, expected, silent = true) => {
  const result = spawnSync(output, silent ? ['/S'] : [], {
    env: { ...process.env, ATHENA_TEST_DESTINATION: path }, timeout: 10000,
  });
  assert.equal(result.error, undefined, `${label}: ${result.error}`);
  assert.equal(result.status, expected, label);
  cases++;
};
try {
  execFileSync(compiler, ['/V2', fixture], { stdio: 'pipe' });
  const fresh = join(root, 'fresh-custom');
  run('absent custom directory', fresh, 73);
  run('interactive valid custom directory', fresh, 73, false);
  const empty = join(root, 'empty-custom');
  mkdirSync(empty);
  run('empty custom directory', empty, 73);
  const junction = join(root, 'junction');
  symlinkSync(empty, junction, 'junction');
  run('junction destination', junction, 2);
  const unreadable = join(root, 'unreadable');
  mkdirSync(unreadable);
  writeFileSync(join(unreadable, 'important.txt'), 'preserve inaccessible contents');
  const identity = execFileSync('whoami.exe', [], { encoding: 'utf8' }).trim();
  try {
    execFileSync('icacls.exe', [unreadable, '/deny', `${identity}:(RD)`], { stdio: 'pipe' });
    run('directory with list permission denied', unreadable, 2);
  } finally {
    execFileSync('icacls.exe', [unreadable, '/remove:d', identity], { stdio: 'pipe' });
  }
  const occupied = join(root, 'AthenaDocuments');
  mkdirSync(occupied);
  writeFileSync(join(occupied, 'important.txt'), 'preserve this file');
  run('nonempty directory containing Athena substring', occupied, 2);
  assert.equal(readFileSync(join(occupied, 'important.txt'), 'utf8'), 'preserve this file');
  const previous = join(root, "O'Brien custom Athena");
  mkdirSync(join(previous, 'resources/app'), { recursive: true });
  for (const file of ['Athena.exe', 'Uninstall Athena.exe', 'resources/app/package.json']) {
    writeFileSync(join(previous, file), 'synthetic install marker');
  }
  run('unregistered directory with copied install markers', previous, 2);
  setRegistered(previous.toUpperCase() + '\\');
  run('registered previous install, case/trailing separator normalization', previous, 73);
  run('interactive registered previous install', previous, 73, false);
  rmSync(join(previous, 'Uninstall Athena.exe'));
  run('registered directory missing uninstaller', previous, 2);
  setRegistered(occupied);
  run('registered unrelated data directory without install markers', occupied, 2);
  run('file as installation destination', join(occupied, 'important.txt'), 2);
  run('drive root', resolve(root, '/'), 2);
  for (const data of [process.env.USERPROFILE, process.env.APPDATA, process.env.LOCALAPPDATA]) {
    setRegistered(data);
    run('profile/container root', data, 2);
  }
  for (const data of [join(process.env.APPDATA, 'Athena'), join(process.env.APPDATA, 'athena-shell'), join(process.env.USERPROFILE, '.athena')]) {
    setRegistered(data);
    run('registered user data root', data, 2);
    run('user data descendant', join(data, 'new-install'), 2);
  }
  // Check the real pinned template still calls the guarded hook before removal.
  const section = readFileSync(join(templates, 'installSection.nsh'), 'utf8');
  assert.ok(section.indexOf('!insertmacro CHECK_APP_RUNNING') < section.indexOf('!insertmacro uninstallOldVersion'));
  assert.match(readFileSync(join(templates, 'include/allowOnlyOneInstallerInstance.nsh'), 'utf8'), /!ifmacrodef customCheckAppRunning\s+!insertmacro customCheckAppRunning/);
  console.log(`PASS: ${cases} executable NSIS destination-policy cases; rejection precedes process handling`);
} finally {
  spawnSync('reg.exe', ['delete', regPath, '/f'], { stdio: 'pipe' });
  // Only the fresh test-owned directory is removed; user-data paths were read only.
  rmSync(root, { recursive: true, force: true });
}

