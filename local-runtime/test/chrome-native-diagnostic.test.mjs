import assert from 'node:assert/strict';
import { mkdtemp, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/diagnose-chrome-native-host.ps1', import.meta.url));

function powerShell() {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
}

function runScript(args, env = process.env) {
  return spawnSync(
    powerShell(),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', SCRIPT, ...args],
    { encoding: 'utf8', env },
  );
}

test('diagnostic script uses only standard Chrome logging and no browser-control bypass flags', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  assert.match(source, /--enable-logging/u);
  assert.match(source, /--log-level=1/u);
  assert.match(source, /--log-file=/u);
  assert.doesNotMatch(source, /--log-file=\\"/u);
  assert.doesNotMatch(source, /--vmodule=/u);
  assert.doesNotMatch(source, /--user-data-dir|--remote-debugging|--no-sandbox|--disable-web-security|--disable-extensions/iu);
  assert.doesNotMatch(source, /Stop-Process|taskkill|Remove-Item|Set-ItemProperty|New-ItemProperty/iu);
  assert.doesNotMatch(source, /ExecutionPolicy/iu);
});

test('plan mode reports without creating the diagnostics directory', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-diagnostic-plan-'));
  try {
    const localAppData = path.join(root, 'LocalAppData');
    const result = runScript(
      ['-Mode', 'Launch', '-DryRun', '-OpenWts'],
      { ...process.env, LOCALAPPDATA: localAppData },
    );
    assert.equal(result.status, 0, result.stderr);
    const unwrappedOutput = result.stdout.replace(/\r?\n\s+/gu, '');
    assert.match(result.stdout, /filesWritten\s+: False/u);
    assert.match(result.stdout, /browserLaunched\s+: False/u);
    assert.match(unwrappedOutput, /--log-file="[^"]*LocalAppData[^"]*"/u);
    assert.doesNotMatch(unwrappedOutput, /--log-file=\\"/u);
    await assert.rejects(stat(path.join(localAppData, 'Athena', 'WtsDiagnostics')), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collect reads an active log and reports categories without returning raw Chrome log lines', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-diagnostic-'));
  try {
    const localAppData = path.join(root, 'Local App Data');
    const diagnostics = path.join(localAppData, 'Athena', 'WtsDiagnostics');
    await mkdir(diagnostics, { recursive: true });
    const logPath = path.join(diagnostics, 'chrome-native-messaging-20261018-120000-0123456789abcdef0123456789abcdef.log');
    await writeFile(logPath, [
      '[INFO] browsing https://private.example/account/123',
      '[ERROR] Can\'t find manifest for native messaging host com.athena.wts',
      '[ERROR] Can\'t find manifest for native messaging host com.athena.wts.other-private-host',
      '[ERROR] Failed to load manifest for native messaging host com.athena.wts: File doesn\'t exist.',
      '[ERROR] Failed to load manifest for native messaging host com.other.private-host: File doesn\'t exist.',
      '[INFO] C:\\Users\\Private\\secret.txt',
    ].join('\n'), 'utf8');

    const activeWriter = await open(logPath, 'a');
    let result;
    try {
      result = runScript(
        ['-Mode', 'Collect', '-LogPath', logPath],
        { ...process.env, LOCALAPPDATA: localAppData },
      );
    } finally {
      await activeWriter.close();
    }
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.evidenceCount, 4);
    assert.equal(report.evidence[0].code, 'HOST_MANIFEST_FILE_NOT_FOUND');
    assert.equal(report.evidence[0].count, 1);
    assert.equal(report.evidence[1].code, 'HOST_MANIFEST_NOT_FOUND');
    assert.equal(report.evidence[2].code, 'OTHER_HOST_MANIFEST_NOT_FOUND');
    assert.equal(report.evidence[3].code, 'UNSCOPED_NATIVE_MESSAGING_ERROR');
    assert.doesNotMatch(result.stdout, /private\.example|secret\.txt|Private\\\\AppData|other-private-host|other\.private-host|File doesn/iu);
    assert.equal(report.rawLogShared, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collect rejects logs outside the ATHENA diagnostics directory', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-diagnostic-reject-'));
  try {
    const outsideLog = path.join(root, 'chrome-native-messaging-20261018-120000-0123456789abcdef0123456789abcdef.log');
    await writeFile(outsideLog, 'Specified native messaging host not found', 'utf8');
    const result = runScript(
      ['-Mode', 'Collect', '-LogPath', outsideLog],
      { ...process.env, LOCALAPPDATA: path.join(root, 'LocalAppData') },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be an ATHENA Chrome diagnostic log/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
