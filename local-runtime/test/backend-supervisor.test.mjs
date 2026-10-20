import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BackendSupervisor } from '../src/backend-supervisor.mjs';

const CATALOG = `sha256:${'a'.repeat(64)}`;

function pythonExecutable() {
  return execFileSync('python', ['-c', 'import sys; print(sys.executable)'], {
    encoding: 'utf8',
  }).trim();
}

function fakeSource(stateDir, mode) {
  return `
import argparse, hashlib, json, os, pathlib, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATE = pathlib.Path(${JSON.stringify(stateDir)})
MODE = ${JSON.stringify(mode)}
CATALOG = ${JSON.stringify(CATALOG)}
if pathlib.Path.cwd().resolve() != STATE.resolve():
    raise SystemExit(70)
for key in os.environ:
    if key.lower() in {'athena_kiwoom_accounts', 'athena_kiwoom_app_key', 'athena_kiwoom_secret_key'}:
        raise SystemExit(71)
token = os.environ.get('ATHENA_LOCAL_BEARER_TOKEN', '')
if not token:
    raise SystemExit(72)
with (STATE / 'token-hashes.txt').open('a', encoding='utf-8') as stream:
    stream.write(hashlib.sha256(token.encode()).hexdigest() + '\\n')

capabilities = {
    'profile': 'wts-readonly-v1', 'apiVersion': 'selector-readonly-v1',
    'catalog': True, 'search': True, 'describe': True,
    'financialQuery': False, 'credentials': False, 'externalAi': False,
    'jobs': False, 'order': False, 'websocket': False,
    'canvasKinds': ['capability-list.v1', 'capability-detail.v1'],
}
hit = {
    'operation_ref': 'base:ka10001', 'kind': 'query', 'domain': 'stockinfo',
    'name': '주식기본정보요청', 'group_title': '현재 시세',
    'score': 999, 'confidence': 'high', 'contributions': [{'secret': 'ranking'}],
    'generic_callable': True, 'discovery_only': False,
}
manifest = {
    'profile': 'wts-readonly-v1', 'apiVersion': 'selector-readonly-v1',
    'catalogVersion': CATALOG,
    'operations': [{key: hit[key] for key in ('operation_ref','kind','domain','name','group_title')}],
}
detail = {
    'catalog_version': CATALOG, 'operation_ref': 'base:ka10001', 'kind': 'query',
    'domain': 'stockinfo', 'name': '주식기본정보요청', 'group_id': None,
    'group_title_ko': '현재 시세', 'group_title_en': 'Current quote', 'layout': 'facts',
    'required_arguments': [{'alias':'stk_cd','description':'종목코드','required':True,'json_schema':{'type':'string'}}],
    'optional_arguments': [],
    'response_fields': [{'alias':'cur_prc','description':'현재가','required':False,'json_schema':{'type':'string'}}],
    'execution_policy': 'selector_detail', 'policy_reasons': [],
}

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *_):
        pass
    def send_json(self, status, value):
        encoded = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers(); self.wfile.write(encoded)
    def authorized(self):
        if MODE == 'auth-mismatch': return False
        return self.headers.get('Authorization') == 'Bearer ' + token
    def route(self):
        if not self.authorized(): return self.send_json(401, {'detail':'unauthorized'})
        if MODE == 'slow' and self.path == '/health': time.sleep(2)
        if MODE == 'slow-probes' and self.path in {'/health','/api/v1/readonly/capabilities','/api/v1/readonly/manifest'}: time.sleep(0.35)
        if MODE == 'redirect' and self.path == '/health':
            self.send_response(302)
            self.send_header('Location', 'http://example.invalid/forbidden')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if self.path == '/health': return self.send_json(200, {'status':'ok','profile':'wts-readonly-v1'})
        if self.path == '/api/v1/readonly/capabilities':
            value = dict(capabilities)
            if MODE == 'capability-mismatch': value['order'] = True
            return self.send_json(200, value)
        if self.path == '/api/v1/readonly/manifest': return self.send_json(200, manifest)
        if self.path == '/api/v1/readonly/search':
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or b'{}')
            with (STATE / 'search-count.txt').open('a', encoding='utf-8') as stream: stream.write('1\\n')
            if MODE == 'large-chunked':
                encoded = json.dumps({'padding':'x' * 300000}).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Transfer-Encoding', 'chunked')
                self.end_headers()
                for offset in range(0, len(encoded), 4096):
                    chunk = encoded[offset:offset + 4096]
                    self.wfile.write(('%x\\r\\n' % len(chunk)).encode() + chunk + b'\\r\\n')
                    self.wfile.flush()
                self.wfile.write(b'0\\r\\n\\r\\n')
                return
            if MODE == 'lying-length':
                encoded = json.dumps({'padding':'x' * 300000}).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', '1')
                self.send_header('Connection', 'close')
                self.end_headers(); self.wfile.write(encoded)
                self.close_connection = True
                return
            results = [dict(hit)]
            if MODE == 'nonquery': results[0]['kind'] = 'order'
            return self.send_json(200, {'catalog_version':CATALOG,'normalized_query':body.get('query'),'results':results,'semantic_ranking':{'internal':True}})
        if self.path == '/api/v1/readonly/describe': return self.send_json(200, detail)
        return self.send_json(404, {'detail':'not found'})
    do_GET = route
    do_POST = route

parser=argparse.ArgumentParser(); parser.add_argument('--profile'); parser.add_argument('--host'); parser.add_argument('--port',type=int)
args=parser.parse_args()
server=ThreadingHTTPServer(('127.0.0.1', 0), Handler)
with (STATE / 'ports.txt').open('a', encoding='utf-8') as stream: stream.write(str(server.server_port) + '\\n')
if MODE == 'delayed-announcement': time.sleep(1)
if MODE == 'bad-announcement': print('ATHENA_BACKEND_URL=http://0.0.0.0:%d' % server.server_port, flush=True)
elif MODE == 'invalid-port': print('ATHENA_BACKEND_URL=http://127.0.0.1:0', flush=True)
elif MODE == 'malformed-announcement': print('ATHENA_BACKEND_URL=not-a-url', flush=True)
elif MODE == 'oversized-announcement': print('x' * 20000, flush=True)
elif MODE == 'duplicate-announcement':
    print('ATHENA_BACKEND_URL=http://127.0.0.1:%d\\nATHENA_BACKEND_URL=http://127.0.0.1:%d' % (server.server_port, server.server_port), flush=True)
elif MODE == 'delayed-duplicate':
    print('ATHENA_BACKEND_URL=http://127.0.0.1:%d' % server.server_port, flush=True)
    def announce_again():
        time.sleep(0.4)
        print('ATHENA_BACKEND_URL=http://127.0.0.1:%d' % server.server_port, flush=True)
    threading.Thread(target=announce_again, daemon=True).start()
elif MODE == 'delayed-oversized-output':
    print('ATHENA_BACKEND_URL=http://127.0.0.1:%d' % server.server_port, flush=True)
    def emit_oversized_output():
        time.sleep(0.4)
        print('x' * 20000, flush=True)
    threading.Thread(target=emit_oversized_output, daemon=True).start()
else: print('ATHENA_BACKEND_URL=http://127.0.0.1:%d' % server.server_port, flush=True)
if MODE in {'bad-announcement','malformed-announcement','auth-mismatch'}:
    import sys
    print('raw-stderr-secret http://127.0.0.1:65534 bearer-value', file=sys.stderr, flush=True)
server.serve_forever()
`;
}

async function fixture(mode = 'normal', options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-supervisor-'));
  const backendRoot = path.join(root, 'backend');
  const packageDir = path.join(backendRoot, 'athena_api');
  const stateDir = path.join(root, 'private-state');
  await mkdir(packageDir, { recursive: true });
  await mkdir(stateDir);
  await writeFile(path.join(packageDir, '__init__.py'), '', 'utf8');
  await writeFile(path.join(packageDir, 'readonly_app.py'), '# fake finite app\n', 'utf8');
  await writeFile(path.join(packageDir, 'launcher.py'), fakeSource(stateDir, mode), 'utf8');
  await writeFile(path.join(stateDir, '.env'), 'ATHENA_KIWOOM_APP_KEY=must-not-load\n', 'utf8');
  if (options.shadowState) {
    const shadowPackage = path.join(stateDir, 'athena_api');
    await mkdir(shadowPackage);
    await writeFile(path.join(shadowPackage, '__init__.py'), '', 'utf8');
    await writeFile(
      path.join(shadowPackage, 'launcher.py'),
      `from pathlib import Path\nPath(${JSON.stringify(path.join(stateDir, 'shadow-ran.txt'))}).write_text('shadow')\n`,
      'utf8',
    );
  }
  const supervisor = new BackendSupervisor({
    backendRoot,
    pythonExecutable: pythonExecutable(),
    stateDir,
    startTimeoutMs: options.startTimeoutMs ?? 3_000,
    requestTimeoutMs: options.requestTimeoutMs ?? 1_000,
    stopTimeoutMs: 2_000,
  });
  return { root, backendRoot, stateDir, supervisor };
}

async function portReleased(port) {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(true));
  });
}

test('supervisor owns one isolated child, keeps secrets private, and cleans up its port', async () => {
  const prior = process.env.Athena_Kiwoom_Accounts;
  process.env.Athena_Kiwoom_Accounts = '[{"secret":"must-not-pass"}]';
  const { stateDir, supervisor } = await fixture();
  try {
    const ready = await supervisor.ensure();
    assert.deepEqual(ready, {
      state: 'ready', profile: 'wts-readonly-v1', apiVersion: 'selector-readonly-v1',
      catalogVersion: CATALOG, ownedChild: true,
    });
    assert.doesNotMatch(JSON.stringify(ready), /127\.0\.0\.1|Bearer|token/iu);
    assert.equal((await supervisor.request('health')).status, 'ok');
    await supervisor.ensure();
    const ports = (await readFile(path.join(stateDir, 'ports.txt'), 'utf8')).trim().split(/\r?\n/u);
    const hashes = (await readFile(path.join(stateDir, 'token-hashes.txt'), 'utf8')).trim().split(/\r?\n/u);
    assert.equal(ports.length, 1);
    assert.equal(hashes.length, 1);
    await supervisor.stop();
    assert.equal((await supervisor.status()).state, 'stopped');
    assert.equal(await portReleased(Number(ports[0])), true);

    await supervisor.ensure();
    await supervisor.stop();
    const restartedHashes = (await readFile(path.join(stateDir, 'token-hashes.txt'), 'utf8')).trim().split(/\r?\n/u);
    assert.equal(restartedHashes.length, 2);
    assert.notEqual(restartedHashes[0], restartedHashes[1]);
    assert.equal(await readFile(path.join(stateDir, '.env'), 'utf8'), 'ATHENA_KIWOOM_APP_KEY=must-not-load\n');
  } finally {
    await supervisor.stop().catch(() => {});
    if (prior === undefined) delete process.env.Athena_Kiwoom_Accounts;
    else process.env.Athena_Kiwoom_Accounts = prior;
  }
});

test('concurrent ensure calls coalesce into one owned child', async () => {
  const { stateDir, supervisor } = await fixture();
  try {
    const results = await Promise.all(Array.from({ length: 12 }, () => supervisor.ensure()));
    assert.equal(results.every((result) => result.state === 'ready'), true);
    const ports = (await readFile(path.join(stateDir, 'ports.txt'), 'utf8')).trim().split(/\r?\n/u);
    const hashes = (await readFile(path.join(stateDir, 'token-hashes.txt'), 'utf8')).trim().split(/\r?\n/u);
    assert.equal(ports.length, 1);
    assert.equal(hashes.length, 1);
  } finally {
    await supervisor.stop().catch(() => {});
  }
});

test('isolated Python bootstrap cannot be shadowed from the persistent state directory', async () => {
  const { stateDir, supervisor } = await fixture('normal', { shadowState: true });
  try {
    await supervisor.ensure();
    await assert.rejects(access(path.join(stateDir, 'shadow-ran.txt')), { code: 'ENOENT' });
  } finally {
    await supervisor.stop().catch(() => {});
  }
});

test('stop during startup prevents a late ready state and releases the child', async () => {
  const startTimeoutMs = 3_000;
  const { stateDir, supervisor } = await fixture('delayed-announcement', { startTimeoutMs });
  const starting = supervisor.ensure();
  let port;
  try {
    const startupDeadline = Date.now() + startTimeoutMs;
    while (Date.now() < startupDeadline) {
      try {
        port = Number((await readFile(path.join(stateDir, 'ports.txt'), 'utf8')).trim());
        break;
      } catch {
        if (Date.now() < startupDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    }
    assert.equal(Number.isInteger(port), true);
    await supervisor.stop();
    await assert.rejects(starting, (error) => {
      assert.match(error.code, /^BACKEND_(?:EXITED|START_CANCELLED)$/u);
      return true;
    });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    assert.deepEqual(supervisor.status(), {
      state: 'stopped', profile: 'wts-readonly-v1', apiVersion: null,
      catalogVersion: null, ownedChild: false,
    });
    assert.equal(await portReleased(port), true);
  } finally {
    await supervisor.stop().catch(() => {});
    await starting.catch(() => {});
  }
});

test('one startup deadline bounds announcement and every readiness probe together', async () => {
  const { supervisor } = await fixture('slow-probes', {
    startTimeoutMs: 700,
    requestTimeoutMs: 1_000,
  });
  const startedAt = Date.now();
  await assert.rejects(supervisor.ensure(), (error) => {
    assert.match(error.code, /^BACKEND_(?:REQUEST|START)_TIMEOUT$/u);
    return true;
  });
  assert.equal(Date.now() - startedAt < 1_500, true);
  assert.equal(supervisor.status().ownedChild, false);
});

test('supervisor rejects non-loopback announcements and terminates the owned child', async () => {
  const { stateDir, supervisor } = await fixture('bad-announcement');
  await assert.rejects(supervisor.ensure(), { code: 'BACKEND_PROTOCOL_INVALID' });
  assert.equal(supervisor.status().ownedChild, false);
  const port = Number((await readFile(path.join(stateDir, 'ports.txt'), 'utf8')).trim());
  assert.equal(await portReleased(port), true);
});

for (const [mode, expectedCode] of [
  ['malformed-announcement', 'BACKEND_PROTOCOL_INVALID'],
  ['invalid-port', 'BACKEND_PROTOCOL_INVALID'],
  ['oversized-announcement', 'BACKEND_PROTOCOL_INVALID'],
  ['duplicate-announcement', 'BACKEND_PROTOCOL_INVALID'],
  ['auth-mismatch', 'BACKEND_AUTH_FAILED'],
  ['capability-mismatch', 'BACKEND_CAPABILITY_MISMATCH'],
  ['redirect', 'BACKEND_REQUEST_FAILED'],
]) {
  test(`supervisor fails closed for ${mode}`, async () => {
    const { stateDir, supervisor } = await fixture(mode);
    try {
      await assert.rejects(supervisor.ensure(), (error) => {
        assert.equal(error.code, expectedCode);
        const publicError = `${error.name}\n${error.code}\n${error.message}\n${error.stack}`;
        assert.doesNotMatch(publicError, /ATHENA_LOCAL_BEARER_TOKEN|raw-stderr-secret|bearer-value|http:\/\/127\.0\.0\.1:\d+/u);
        return true;
      });
      assert.equal(supervisor.status().ownedChild, false);
      const port = Number((await readFile(path.join(stateDir, 'ports.txt'), 'utf8')).trim());
      assert.equal(await portReleased(port), true);
    } finally {
      await supervisor.stop().catch(() => {});
    }
  });
}

for (const mode of ['delayed-duplicate', 'delayed-oversized-output']) {
  test(`${mode} uses bounded owned-child cleanup after readiness`, async () => {
    const { stateDir, supervisor } = await fixture(mode);
    await supervisor.ensure();
    const port = Number((await readFile(path.join(stateDir, 'ports.txt'), 'utf8')).trim());
    for (let attempt = 0; attempt < 40 && supervisor.status().ownedChild; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(supervisor.status().ownedChild, false);
    assert.equal(supervisor.status().state, 'failed');
    assert.equal(await portReleased(port), true);
  });
}

for (const [mode, expectedCode] of [
  ['large-chunked', 'BACKEND_RESPONSE_TOO_LARGE'],
  ['lying-length', 'BACKEND_RESPONSE_INVALID'],
]) {
  test(`supervisor bounds ${mode} bodies while streaming`, async () => {
    const { supervisor } = await fixture(mode);
    try {
      await supervisor.ensure();
      await assert.rejects(supervisor.request('search', { query: '현재가', limit: 1 }), (error) => {
        assert.equal(error.code, expectedCode);
        return true;
      });
    } finally {
      await supervisor.stop().catch(() => {});
    }
  });
}

test('an abort after ready prevents the request from reaching the backend', async () => {
  const { stateDir, supervisor } = await fixture();
  try {
    await supervisor.ensure();
    const controller = new AbortController();
    const pending = supervisor.request('search', { query: '현재가', limit: 1 }, {
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(pending, { code: 'BACKEND_CANCELLED' });
    await assert.rejects(access(path.join(stateDir, 'search-count.txt')), { code: 'ENOENT' });
  } finally {
    await supervisor.stop().catch(() => {});
  }
});

test('supervisor rejects configured paths redirected through a junction ancestor', async () => {
  if (process.platform !== 'win32') return;
  const { root, backendRoot, stateDir } = await fixture();
  const linkedRoot = `${root}-junction`;
  await symlink(root, linkedRoot, 'junction');
  const supervisor = new BackendSupervisor({
    backendRoot: path.join(linkedRoot, path.basename(backendRoot)),
    pythonExecutable: pythonExecutable(),
    stateDir: path.join(linkedRoot, path.basename(stateDir)),
    startTimeoutMs: 3_000,
    requestTimeoutMs: 1_000,
    stopTimeoutMs: 2_000,
  });
  await assert.rejects(supervisor.ensure(), { code: 'BACKEND_CONFIG_INVALID' });
  assert.equal(supervisor.status().ownedChild, false);
  await assert.rejects(access(path.join(stateDir, 'token-hashes.txt')), { code: 'ENOENT' });
});

test('supervisor bounds timeouts, cancellation, operations, and public diagnostics', async () => {
  const { supervisor } = await fixture('slow', { requestTimeoutMs: 100 });
  await assert.rejects(supervisor.ensure(), (error) => {
    assert.equal(error.code, 'BACKEND_REQUEST_TIMEOUT');
    assert.doesNotMatch(`${error.message}${error.stack}`, /Bearer\s|ATHENA_LOCAL_BEARER_TOKEN/u);
    return true;
  });
  assert.equal(supervisor.status().ownedChild, false);
  await assert.rejects(supervisor.request('arbitrary-url', {}), {
    code: 'BACKEND_OPERATION_NOT_ALLOWED',
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(supervisor.ensure({ signal: controller.signal }), {
    code: 'BACKEND_CANCELLED',
  });
});

test('supervisor requires explicit absolute physical configuration', async () => {
  assert.throws(() => new BackendSupervisor({
    backendRoot: 'backend', pythonExecutable: 'python', stateDir: 'state',
  }), { code: 'BACKEND_CONFIG_INVALID' });
  await assert.rejects(access(path.join(os.tmpdir(), 'athena-never-created')), { code: 'ENOENT' });
});
