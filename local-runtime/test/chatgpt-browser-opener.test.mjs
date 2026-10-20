import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import {
  createAuthorizationBrowserOpener,
  validateAuthorizationUrl,
} from '../src/chatgpt-provider/browser-opener.mjs';

function createValidUrl(overrides = {}) {
  const base = {
    client_id: 'dynamic_agent_client',
    agent_name_hint: 'ATHENA',
    response_type: 'code',
    redirect_uri: 'http://127.0.0.1:8080/auth/callback',
    scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    resource: 'https://api.openai.com/v1',
    state: Buffer.alloc(32, 1).toString('base64url'),
    nonce: Buffer.alloc(32, 2).toString('base64url'),
    code_challenge: Buffer.alloc(32, 3).toString('base64url'),
    code_challenge_method: 'S256',
    ext_agent_host_id: 'urn:uuid:123e4567-e89b-42d3-a456-426614174000',
    ...overrides,
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined) params.set(k, v);
  }
  return `https://auth.openai.com/api/accounts/authorize?${params.toString()}`;
}

function runPowerShellHelper(helper, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper],
      {
        shell: false,
        windowsHide: true,
        env: {
          SystemRoot: 'C:\\Windows',
          windir: 'C:\\Windows',
          PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
    child.stdin.end(`${input}\n`, 'utf8');
  });
}

test('validateAuthorizationUrl accepts dynamic client with ATHENA hint', () => {
  const url = createValidUrl();
  assert.equal(validateAuthorizationUrl(url), url);
});

test('validateAuthorizationUrl accepts oaiapp client without hint', () => {
  const url = createValidUrl({
    client_id: 'oaiapp_test123',
    agent_name_hint: undefined,
  });
  assert.equal(validateAuthorizationUrl(url), url);
});

test('validateAuthorizationUrl rejects oaiapp client with hint', () => {
  const url = createValidUrl({
    client_id: 'oaiapp_test123',
    agent_name_hint: 'ATHENA',
  });
  assert.throws(() => validateAuthorizationUrl(url), { code: 'OPENAI_OPENER_REQUEST_INVALID' });
});

test('validateAuthorizationUrl rejects unknown param or missing param', () => {
  const url1 = createValidUrl({ extra: 'bad' });
  assert.throws(() => validateAuthorizationUrl(url1), { code: 'OPENAI_OPENER_REQUEST_INVALID' });

  const url2 = createValidUrl({ state: undefined });
  assert.throws(() => validateAuthorizationUrl(url2), { code: 'OPENAI_OPENER_REQUEST_INVALID' });
});

test('validateAuthorizationUrl rejects invalid host or protocol', () => {
  const valid = createValidUrl();
  assert.throws(() => validateAuthorizationUrl(valid.replace('https:', 'http:')), { code: 'OPENAI_OPENER_REQUEST_INVALID' });
  assert.throws(() => validateAuthorizationUrl(valid.replace('auth.openai.com', 'evil.com')), { code: 'OPENAI_OPENER_REQUEST_INVALID' });
});

test('validateAuthorizationUrl rejects non-32-byte base64url', () => {
  const shortState = Buffer.alloc(16).toString('base64url');
  const url = createValidUrl({ state: shortState });
  assert.throws(() => validateAuthorizationUrl(url), { code: 'OPENAI_OPENER_REQUEST_INVALID' });
});

test('validateAuthorizationUrl rejects legacy, non-v4, noncanonical and malformed host ids', () => {
  for (const ext_agent_host_id of [
    Buffer.alloc(32, 4).toString('base64url'),
    'urn:uuid:123e4567-e89b-12d3-a456-426614174000',
    'urn:uuid:123E4567-E89B-42D3-A456-426614174000',
    '123e4567-e89b-42d3-a456-426614174000',
  ]) {
    assert.throws(
      () => validateAuthorizationUrl(createValidUrl({ ext_agent_host_id })),
      { code: 'OPENAI_OPENER_REQUEST_INVALID' },
    );
  }
});

test('PowerShell opener enforces the same canonical UUIDv4 URN host allowlist', async () => {
  const helper = new URL('../scripts/open-openai-authorization.ps1', import.meta.url);
  const source = await readFile(helper, 'utf8');
  assert.match(source,
    /\^urn:uuid:\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$/u);
  assert.match(source, /Test-HostId \$queryMap\['ext_agent_host_id'\]/u);
  assert.doesNotMatch(source, /Test-Base64Url32 \$queryMap\['ext_agent_host_id'\]/u);
});

test('real PowerShell helper form-decodes OAuth query values and remains fail-closed', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const sourceUrl = new URL('../scripts/open-openai-authorization.ps1', import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  const launch = '    [System.Diagnostics.Process]::Start($psi) | Out-Null';
  assert.equal(source.split(launch).length, 2, 'launch stub anchor must remain unique');
  const isolated = source.replace(launch, [
    "    if ($psi.FileName -cne $url -or -not $psi.UseShellExecute) { Fail-Exit }",
    '    # Isolated regression stub: validate only; never launch a browser.',
  ].join('\n'));
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-openai-opener-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const helper = path.join(root, 'open-openai-authorization.ps1');
  await writeFile(helper, isolated, 'utf8');

  const valid = createValidUrl();
  assert.match(valid, /scope=openid\+profile/u);
  assert.deepEqual(await runPowerShellHelper(helper, valid), {
    code: 0,
    signal: null,
    stdout: 'ATHENA_OPENAI_LAUNCH_ACCEPTED\n',
    stderr: '',
  });

  for (const invalid of [
    `${valid}&scope=duplicate`,
    valid.replace('agent_name_hint=ATHENA', 'agent_name_hint=ATHENA%2B'),
    valid.replace('scope=openid+profile', 'scope=openid%2Bprofile'),
    valid.replace('client_id=', 'CLIENT_ID='),
  ]) {
    const result = await runPowerShellHelper(helper, invalid);
    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, 'ATHENA_OPENAI_LAUNCH_FAILED\n');
    assert.equal(result.stderr, '');
  }
});

function createMockSpawn({ stdout = 'ATHENA_OPENAI_LAUNCH_ACCEPTED\n', exitCode = 0, stderr = '', delay = 10 } = {}) {
  return function mockSpawn() {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      child.killed = true;
      child.emit('close', null, 'SIGTERM');
    };

    setTimeout(() => {
      if (child.killed) return;
      if (stderr) child.stderr.write(stderr);
      if (stdout) child.stdout.write(stdout);
      child.emit('close', exitCode, null);
    }, delay);

    return child;
  };
}

test('browserOpener succeeds with valid output and exit 0', async () => {
  const openBrowser = createAuthorizationBrowserOpener({ spawnImpl: createMockSpawn() });
  const url = createValidUrl();
  await assert.doesNotReject(openBrowser(url));
});

test('browserOpener rejects pre-aborted signal', async () => {
  const openBrowser = createAuthorizationBrowserOpener({ spawnImpl: createMockSpawn() });
  const url = createValidUrl();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(openBrowser(url, { signal: controller.signal }), { code: 'OPENAI_OPENER_CANCELLED' });
});

test('browserOpener rejects if helper fails', async () => {
  const openBrowser = createAuthorizationBrowserOpener({
    spawnImpl: createMockSpawn({ stdout: 'ATHENA_OPENAI_LAUNCH_FAILED\n', exitCode: 1 }),
  });
  const url = createValidUrl();
  await assert.rejects(openBrowser(url), { code: 'OPENAI_OPENER_LAUNCH_FAILED' });
});

test('browserOpener rejects if output is malformed', async () => {
  const openBrowser = createAuthorizationBrowserOpener({
    spawnImpl: createMockSpawn({ stdout: 'UNKNOWN_OUTPUT\n', exitCode: 0 }),
  });
  const url = createValidUrl();
  await assert.rejects(openBrowser(url), { code: 'OPENAI_OPENER_LAUNCH_FAILED' });
});

test('browserOpener rejects if aborted during execution', async () => {
  const openBrowser = createAuthorizationBrowserOpener({
    spawnImpl: createMockSpawn({ delay: 500 }),
  });
  const url = createValidUrl();
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(openBrowser(url, { signal: controller.signal }), { code: 'OPENAI_OPENER_CANCELLED' });
});

test('browserOpener waits for child close after cancellation and ignores late output', async () => {
  let closed = false;
  let killCalls = 0;
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      killCalls += 1;
      setTimeout(() => {
        child.stdout.write('late-output-that-must-be-ignored');
        closed = true;
        child.emit('close', null, 'SIGTERM');
      }, 25);
      return true;
    };
    return child;
  };
  const openBrowser = createAuthorizationBrowserOpener({ spawnImpl });
  const controller = new AbortController();
  const pending = openBrowser(createValidUrl(), { signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, { code: 'OPENAI_OPENER_CANCELLED' });
  assert.equal(killCalls, 1);
  assert.equal(closed, true);
});

test('browserOpener normalizes hostile child and stdin surfaces', async () => {
  const hostileChild = {};
  Object.defineProperty(hostileChild, 'stdout', {
    get() { throw new Error('private getter failure'); },
  });
  await assert.rejects(
    createAuthorizationBrowserOpener({ spawnImpl: () => hostileChild })(createValidUrl()),
    { code: 'OPENAI_OPENER_LAUNCH_FAILED' },
  );

  let closed = false;
  const openBrowser = createAuthorizationBrowserOpener({
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdin = { end() { throw new Error('private stdin failure'); } };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {
        setTimeout(() => {
          closed = true;
          child.emit('close', null, 'SIGTERM');
        }, 10);
        return true;
      };
      return child;
    },
  });
  await assert.rejects(openBrowser(createValidUrl()), { code: 'OPENAI_OPENER_LAUNCH_FAILED' });
  assert.equal(closed, true);
});
