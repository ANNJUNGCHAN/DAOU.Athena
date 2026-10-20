import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  FINANCIAL_ERROR_MESSAGES,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
} from '../../contracts/wts-foundation.mjs';
import { FinancialBackendSupervisor } from '../src/financial-backend-supervisor.mjs';
import { encodeNativeMessage, NativeMessageDecoder } from '../src/framing.mjs';
import { runNativeHost } from '../src/main.mjs';

const CATALOG = `sha256:${'b'.repeat(64)}`;

function pythonExecutable() {
  return execFileSync('python', ['-c', 'import sys; print(sys.executable)'], {
    encoding: 'utf8',
  }).trim();
}

function fakeFinancialSource(stateDir, mode) {
  return `
import argparse, hashlib, json, os, pathlib, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATE = pathlib.Path(${JSON.stringify(stateDir)})
MODE = ${JSON.stringify(mode)}
CATALOG = ${JSON.stringify(CATALOG)}
token = os.environ.get('ATHENA_LOCAL_BEARER_TOKEN', '')
if not token: raise SystemExit(71)
for key in os.environ:
    if key.lower() in {'athena_kiwoom_accounts','athena_kiwoom_app_key','athena_kiwoom_secret_key'}:
        raise SystemExit(72)
with (STATE / 'token-hashes.txt').open('a', encoding='utf-8') as stream:
    stream.write(hashlib.sha256(token.encode()).hexdigest() + '\\n')

methods = [
 'source.credentials.status','source.credentials.configure','source.credentials.delete',
 'source.query.start','source.query.status','source.query.page','source.query.continue','source.query.cancel',
]
capabilities = {
 'profile':'wts-financial-read-v1','apiVersion':'selector-financial-read-v1',
 'cardVersion':'wts-financial-card-1','catalogVersion':CATALOG,'methods':methods,
 'renderKinds':['facts','table','compound','chart'],'queryOnly':True,'credentialSetup':True,
 'order':False,'websocket':False,'externalAi':False,
}
routes = {
 '/api/v1/financial/credentials/status':'source.credentials.status',
 '/api/v1/financial/credentials/configure':'source.credentials.configure',
 '/api/v1/financial/credentials/delete':'source.credentials.delete',
 '/api/v1/financial/query/start':'source.query.start',
 '/api/v1/financial/query/status':'source.query.status',
 '/api/v1/financial/query/page':'source.query.page',
 '/api/v1/financial/query/continue':'source.query.continue',
 '/api/v1/financial/query/cancel':'source.query.cancel',
}

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *_): pass
    def send_json(self, status, value):
        encoded=json.dumps(value).encode()
        self.send_response(status); self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(encoded))); self.end_headers(); self.wfile.write(encoded)
    def authorized(self): return self.headers.get('Authorization') == 'Bearer ' + token
    def route(self):
        if not self.authorized(): return self.send_json(401, {'error':{'code':'LOCAL_AUTH_FAILED','message':'Local authorization failed.'}})
        fatal=(STATE / 'fatal.flag').exists()
        if self.path == '/health' and fatal:
            if MODE == 'slow-fatal-health': time.sleep(0.3)
            return self.send_json(503, {'error':{'code':'VAULT_UNAVAILABLE','message':'Credential vault is unavailable.'}})
        if self.path == '/health': return self.send_json(200, {'status':'ok','profile':'wts-financial-read-v1'})
        if self.path == '/api/v1/financial/capabilities':
            value=dict(capabilities)
            if MODE == 'bad-capability': value['order']=True
            return self.send_json(200, value)
        if self.path not in routes: return self.send_json(404, {'error':{'code':'RESOURCE_NOT_FOUND','message':'Requested local resource was not found.'}})
        body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or b'{}')
        with (STATE / 'requests.jsonl').open('a',encoding='utf-8') as stream:
            stream.write(json.dumps({'path':self.path,'auth':self.authorized(),'keys':sorted(body.keys())})+'\\n')
        if fatal and self.path.endswith('/credentials/status') and body.get('mutationId') is not None:
            return self.send_json(404, {'error':{'code':'CREDENTIAL_MUTATION_NOT_FOUND','message':'Credential mutation was not found.'}})
        if MODE == 'missing-tracked-healthy' and self.path.endswith('/credentials/status') and body.get('mutationId') is not None:
            return self.send_json(404, {'error':{'code':'CREDENTIAL_MUTATION_NOT_FOUND','message':'Credential mutation was not found.'}})
        if fatal or MODE == 'request-vault-healthy':
            return self.send_json(503, {'error':{'code':'VAULT_UNAVAILABLE','message':'Credential vault is unavailable.'}})
        if MODE == 'unsafe-error': return self.send_json(422, {'error':{'code':'TOKEN_REJECTED','message':'secret=' + str(body)}})
        if MODE == 'large' and self.path.endswith('/page'): return self.send_json(200, {'padding':'x'*140000})
        if self.path.endswith('/status') and 'credentials' in self.path:
            return self.send_json(200, {'profile':'wts-financial-read-v1','apiVersion':'selector-financial-read-v1','catalogVersion':CATALOG,'profiles':[],'mutation':None})
        return self.send_json(200, {'accepted':True,'method':routes[self.path]})
    do_GET=route
    do_POST=route

parser=argparse.ArgumentParser(); parser.add_argument('--profile'); parser.add_argument('--data-dir'); parser.add_argument('--host'); parser.add_argument('--port',type=int)
args=parser.parse_args()
if args.profile != 'wts-financial-read': raise SystemExit(73)
if pathlib.Path(args.data_dir).resolve() != pathlib.Path(${JSON.stringify(path.dirname(stateDir))}).resolve(): raise SystemExit(74)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
with (STATE/'port.txt').open('w',encoding='utf-8') as stream: stream.write(str(server.server_port))
if MODE == 'slow-start': time.sleep(0.5)
print('ATHENA_BACKEND_URL=http://127.0.0.1:%d' % server.server_port,flush=True)
server.serve_forever()
`;
}

async function fixture(mode = 'normal') {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-financial-'));
  const backendRoot = path.join(dataDir, 'backend');
  const packageDir = path.join(backendRoot, 'athena_api');
  const stateDir = path.join(dataDir, 'owned-child');
  await mkdir(packageDir, { recursive: true });
  await writeFile(path.join(packageDir, '__init__.py'), '', 'utf8');
  await writeFile(path.join(packageDir, 'financial_read_app.py'), '# fake app\n', 'utf8');
  await writeFile(path.join(packageDir, 'launcher.py'), fakeFinancialSource(stateDir, mode), 'utf8');
  const supervisor = new FinancialBackendSupervisor({
    backendRoot,
    pythonExecutable: pythonExecutable(),
    dataDir,
    stateDir,
    startTimeoutMs: 3_000,
    requestTimeoutMs: 1_000,
    stopTimeoutMs: 2_000,
  });
  return { dataDir, backendRoot, stateDir, supervisor };
}

async function waitForState(supervisor, expected, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = supervisor.status();
    if (status.state === expected) return status;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`financial supervisor did not reach ${expected}`);
}

async function createPendingMarker(dataDir) {
  const vaultDir = path.join(dataDir, 'financial-read-v1');
  await mkdir(vaultDir, { recursive: true });
  const marker = path.join(vaultDir, '.credentials.dpapi.pending');
  await writeFile(marker, 'opaque recovery evidence', 'utf8');
  return marker;
}

function nativeRequest(requestId, method, params = {}) {
  return { protocolVersion: PROTOCOL_VERSION, requestId, method, params };
}

function nativeResponseReader(stream) {
  const decoder = new NativeMessageDecoder(MAX_MESSAGE_BYTES);
  const queued = [];
  const waiting = [];
  stream.on('data', (chunk) => {
    for (const payload of decoder.push(chunk)) {
      const value = JSON.parse(payload.toString('utf8'));
      const waiter = waiting.shift();
      if (waiter) waiter.resolve(value);
      else queued.push(value);
    }
  });
  return (timeoutMs = 2_000) => {
    if (queued.length > 0) return Promise.resolve(queued.shift());
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      };
      const timer = setTimeout(() => {
        const index = waiting.indexOf(waiter);
        if (index >= 0) waiting.splice(index, 1);
        reject(new Error('Native host response was blocked.'));
      }, timeoutMs);
      waiting.push(waiter);
    });
  };
}

async function sendNative(stdin, nextResponse, value, timeoutMs) {
  stdin.write(encodeNativeMessage(value, MAX_MESSAGE_BYTES));
  return nextResponse(timeoutMs);
}

function controlObservation() {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    capturedAt: new Date().toISOString(),
    source: {
      origin: 'https://wts.kiwoom.com', path: '/', tabId: 1, windowId: 2,
      frameId: 0, documentId: 'recovery-control-document',
    },
    state: {
      screenId: 'main-other', activeTab: 'quote', period: 'none', blocked: false,
      chartOpenEnabled: true, periodEnabled: false,
      instrumentToken: 'f'.repeat(64), contextToken: 'a'.repeat(64),
    },
  };
}

test('first financial call starts one isolated child and returns immediately', async () => {
  const prior = process.env.ATHENA_KIWOOM_SECRET_KEY;
  process.env.ATHENA_KIWOOM_SECRET_KEY = 'must-not-inherit';
  const { stateDir, supervisor } = await fixture('slow-start');
  try {
    const startedAt = Date.now();
    await assert.rejects(
      supervisor.request('source.credentials.status', { mutationId: null }),
      { code: 'FINANCIAL_BACKEND_STARTING', message: FINANCIAL_ERROR_MESSAGES.FINANCIAL_BACKEND_STARTING },
    );
    assert.equal(Date.now() - startedAt < 200, true);
    await waitForState(supervisor, 'ready');
    assert.deepEqual(supervisor.status(), {
      state: 'ready', profile: 'wts-financial-read-v1', apiVersion: 'selector-financial-read-v1',
      catalogVersion: CATALOG, ownedChild: true,
    });
    const result = await supervisor.request('source.credentials.status', { mutationId: null });
    assert.equal(result.profile, 'wts-financial-read-v1');
    const requests = (await readFile(path.join(stateDir, 'requests.jsonl'), 'utf8')).trim().split(/\r?\n/u);
    assert.equal(requests.length, 1);
    assert.deepEqual(JSON.parse(requests[0]), {
      path: '/api/v1/financial/credentials/status', auth: true, keys: ['mutationId'],
    });
    assert.equal((await readFile(path.join(stateDir, 'token-hashes.txt'), 'utf8')).trim().length, 64);
  } finally {
    await supervisor.stop().catch(() => {});
    if (prior === undefined) delete process.env.ATHENA_KIWOOM_SECRET_KEY;
    else process.env.ATHENA_KIWOOM_SECRET_KEY = prior;
  }
});

test('financial supervisor rejects generic routes, unsafe backend errors, and oversized bodies', async () => {
  const unsafe = await fixture('unsafe-error');
  try {
    unsafe.supervisor.startInBackground();
    await waitForState(unsafe.supervisor, 'ready');
    await assert.rejects(
      unsafe.supervisor.request('source.credentials.configure', { appKey: 'not-recorded' }),
      { code: 'INTERNAL_ERROR', message: FINANCIAL_ERROR_MESSAGES.INTERNAL_ERROR },
    );
    await assert.rejects(unsafe.supervisor.request('source.proxy', {}), {
      code: 'REQUEST_INVALID',
    });
  } finally {
    await unsafe.supervisor.stop().catch(() => {});
  }

  const large = await fixture('large');
  try {
    large.supervisor.startInBackground();
    await waitForState(large.supervisor, 'ready');
    await assert.rejects(large.supervisor.request('source.query.page', {
      jobId: '11111111-1111-4111-8111-111111111111', pageToken: 'x'.repeat(43),
    }), { code: 'PAYLOAD_TOO_LARGE' });
  } finally {
    await large.supervisor.stop().catch(() => {});
  }
});

test('strict financial identity and physical data directory fail closed', async () => {
  const mismatch = await fixture('bad-capability');
  try {
    mismatch.supervisor.startInBackground();
    await waitForState(mismatch.supervisor, 'failed');
    assert.equal(mismatch.supervisor.status().ownedChild, false);
  } finally {
    await mismatch.supervisor.stop().catch(() => {});
  }

  if (process.platform === 'win32') {
    const current = await fixture();
    const linked = `${current.dataDir}-junction`;
    await symlink(current.dataDir, linked, 'junction');
    const redirected = new FinancialBackendSupervisor({
      backendRoot: path.join(linked, path.basename(current.backendRoot)),
      pythonExecutable: pythonExecutable(),
      dataDir: linked,
      stateDir: path.join(linked, 'redirected-child'),
      startTimeoutMs: 2_000,
    });
    redirected.startInBackground();
    await waitForState(redirected, 'failed');
    await assert.rejects(access(path.join(current.stateDir, 'token-hashes.txt')), { code: 'ENOENT' });
  }
});

test('pending recovery evidence blocks initial launch and every restart attempt', async () => {
  const current = await fixture();
  await createPendingMarker(current.dataDir);
  try {
    await assert.rejects(
      current.supervisor.request('source.credentials.status', { mutationId: null }),
      { code: 'FINANCIAL_BACKEND_STARTING' },
    );
    await waitForState(current.supervisor, 'failed');
    assert.equal(current.supervisor.status().ownedChild, false);
    await assert.rejects(
      current.supervisor.request('source.credentials.status', { mutationId: null }),
      { code: 'VAULT_UNAVAILABLE', message: FINANCIAL_ERROR_MESSAGES.VAULT_UNAVAILABLE },
    );
    await assert.rejects(
      current.supervisor.request('source.credentials.status', {
        mutationId: '11111111-1111-4111-8111-111111111111',
      }),
      {
        code: 'CREDENTIAL_MUTATION_NOT_FOUND',
        message: FINANCIAL_ERROR_MESSAGES.CREDENTIAL_MUTATION_NOT_FOUND,
      },
    );
    assert.throws(() => current.supervisor.startInBackground(), {
      code: 'VAULT_UNAVAILABLE',
    });
    await assert.rejects(access(path.join(current.stateDir, 'token-hashes.txt')), { code: 'ENOENT' });

    const restartedState = path.join(current.dataDir, 'restart-child');
    const restarted = new FinancialBackendSupervisor({
      backendRoot: current.backendRoot,
      pythonExecutable: pythonExecutable(),
      dataDir: current.dataDir,
      stateDir: restartedState,
      startTimeoutMs: 3_000,
      requestTimeoutMs: 1_000,
      stopTimeoutMs: 2_000,
    });
    try {
      await assert.rejects(
        restarted.request('source.query.status', {
          jobId: '22222222-2222-4222-8222-222222222222',
        }),
        { code: 'FINANCIAL_BACKEND_STARTING' },
      );
      await waitForState(restarted, 'failed');
      await assert.rejects(restarted.request('source.query.status', {
        jobId: '22222222-2222-4222-8222-222222222222',
      }), { code: 'VAULT_UNAVAILABLE' });
      assert.equal(restarted.status().ownedChild, false);
      await assert.rejects(access(path.join(restartedState, 'token-hashes.txt')), { code: 'ENOENT' });
    } finally {
      await restarted.stop().catch(() => {});
    }
  } finally {
    await current.supervisor.stop().catch(() => {});
  }
});

test('healthy child ignores a live commit marker and nonfatal vault errors do not latch', async () => {
  const healthy = await fixture();
  try {
    healthy.supervisor.startInBackground();
    await waitForState(healthy.supervisor, 'ready');
    await createPendingMarker(healthy.dataDir);
    const result = await healthy.supervisor.request('source.credentials.status', { mutationId: null });
    assert.deepEqual(result.profiles, []);
    assert.equal(healthy.supervisor.status().state, 'ready');
    assert.equal(healthy.supervisor.status().ownedChild, true);
  } finally {
    await healthy.supervisor.stop().catch(() => {});
  }

  const missing = await fixture('missing-tracked-healthy');
  try {
    missing.supervisor.startInBackground();
    await waitForState(missing.supervisor, 'ready');
    await createPendingMarker(missing.dataDir);
    await assert.rejects(missing.supervisor.request('source.credentials.status', {
      mutationId: '55555555-5555-4555-8555-555555555555',
    }), { code: 'CREDENTIAL_MUTATION_NOT_FOUND' });
    assert.equal(missing.supervisor.status().state, 'ready');
    assert.equal(missing.supervisor.status().ownedChild, true);
  } finally {
    await missing.supervisor.stop().catch(() => {});
  }

  const noEvidence = await fixture();
  try {
    noEvidence.supervisor.startInBackground();
    await waitForState(noEvidence.supervisor, 'ready');
    await writeFile(path.join(noEvidence.stateDir, 'fatal.flag'), 'fatal', 'utf8');
    await assert.rejects(
      noEvidence.supervisor.request('source.credentials.status', { mutationId: null }),
      { code: 'VAULT_UNAVAILABLE' },
    );
    assert.equal(noEvidence.supervisor.status().state, 'ready');
    assert.equal(noEvidence.supervisor.status().ownedChild, true);
  } finally {
    await noEvidence.supervisor.stop().catch(() => {});
  }

  const nonfatal = await fixture('request-vault-healthy');
  try {
    nonfatal.supervisor.startInBackground();
    await waitForState(nonfatal.supervisor, 'ready');
    await createPendingMarker(nonfatal.dataDir);
    await assert.rejects(
      nonfatal.supervisor.request('source.credentials.status', { mutationId: null }),
      { code: 'VAULT_UNAVAILABLE' },
    );
    assert.equal(nonfatal.supervisor.status().state, 'ready');
    assert.equal(nonfatal.supervisor.status().ownedChild, true);
    await assert.rejects(
      nonfatal.supervisor.request('source.credentials.status', { mutationId: null }),
      { code: 'VAULT_UNAVAILABLE' },
    );
    assert.equal(nonfatal.supervisor.status().ownedChild, true);
  } finally {
    await nonfatal.supervisor.stop().catch(() => {});
  }
});

test('fatal vault health plus pending evidence latches once and stops only the owned child', async () => {
  const current = await fixture();
  try {
    current.supervisor.startInBackground();
    await waitForState(current.supervisor, 'ready');
    await createPendingMarker(current.dataDir);
    await writeFile(path.join(current.stateDir, 'fatal.flag'), 'fatal', 'utf8');

    await assert.rejects(
      current.supervisor.request('source.credentials.status', {
        mutationId: '33333333-3333-4333-8333-333333333333',
      }),
      {
        code: 'CREDENTIAL_MUTATION_NOT_FOUND',
        message: FINANCIAL_ERROR_MESSAGES.CREDENTIAL_MUTATION_NOT_FOUND,
      },
    );
    await waitForState(current.supervisor, 'failed');
    assert.equal(current.supervisor.status().state, 'failed');
    assert.equal(current.supervisor.status().ownedChild, false);
    for (let index = 0; index < 3; index += 1) {
      await assert.rejects(
        current.supervisor.request('source.credentials.status', { mutationId: null }),
        { code: 'VAULT_UNAVAILABLE' },
      );
    }
    await assert.rejects(current.supervisor.request('source.credentials.status', {
      mutationId: '33333333-3333-4333-8333-333333333333',
    }), { code: 'CREDENTIAL_MUTATION_NOT_FOUND' });
    await assert.rejects(current.supervisor.request('source.query.start', {}), {
      code: 'VAULT_UNAVAILABLE',
    });
    const tokens = (await readFile(path.join(current.stateDir, 'token-hashes.txt'), 'utf8'))
      .trim().split(/\r?\n/u);
    assert.equal(tokens.length, 1);
    assert.equal(current.supervisor.status().ownedChild, false);
  } finally {
    await current.supervisor.stop().catch(() => {});
  }
});

test('slow fatal health and an uncooperative stop do not block native hello or control', {
  timeout: 20_000,
}, async () => {
  const current = await fixture('slow-fatal-health');
  await mkdir(current.stateDir, { recursive: true });
  const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';
  const configPath = path.join(current.dataDir, 'host-config.json');
  await writeFile(configPath, JSON.stringify({
    hostName: 'com.athena.wts',
    allowedOrigin: origin,
    dataDir: current.dataDir,
    backendRoot: current.backendRoot,
    pythonExecutable: pythonExecutable(),
  }), 'utf8');
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const nextResponse = nativeResponseReader(stdout);
  let supervisor = null;
  let realStop = null;
  const neverStops = new Promise(() => {});
  let running = null;
  try {
    running = runNativeHost({
      stdin,
      stdout,
      callerOrigin: origin,
      configPath,
      createFinancialSupervisor: (options) => {
        supervisor = new FinancialBackendSupervisor({
          ...options,
          startTimeoutMs: 3_000,
          requestTimeoutMs: 1_000,
          stopTimeoutMs: 1_000,
        });
        realStop = supervisor.stop.bind(supervisor);
        supervisor.stop = () => neverStops;
        return supervisor;
      },
    });

    const first = await sendNative(stdin, nextResponse, nativeRequest(
      'recovery-host-first', 'source.credentials.status', { mutationId: null },
    ));
    assert.equal(first.error.code, 'FINANCIAL_BACKEND_STARTING');
    await waitForState(supervisor, 'ready', 3_000);
    const ready = await sendNative(stdin, nextResponse, nativeRequest(
      'recovery-host-ready', 'source.credentials.status', { mutationId: null },
    ));
    assert.equal(ready.ok, true);
    await createPendingMarker(current.dataDir);
    await writeFile(path.join(current.stateDir, 'fatal.flag'), 'fatal', 'utf8');

    const tracked = await sendNative(stdin, nextResponse, nativeRequest(
      'recovery-host-tracked',
      'source.credentials.status',
      { mutationId: '88888888-8888-4888-8888-888888888888' },
    ));
    assert.deepEqual(tracked.error, {
      code: 'CREDENTIAL_MUTATION_NOT_FOUND',
      message: FINANCIAL_ERROR_MESSAGES.CREDENTIAL_MUTATION_NOT_FOUND,
    });
    assert.equal(supervisor.status().ownedChild, true);

    const hello = await sendNative(
      stdin,
      nextResponse,
      nativeRequest('recovery-host-hello', 'runtime.hello'),
    );
    assert.equal(hello.ok, true);
    const control = await sendNative(stdin, nextResponse, nativeRequest(
      'recovery-host-control',
      'control.plan',
      { command: '차트 열어줘', observation: controlObservation() },
    ));
    assert.equal(control.ok, true, JSON.stringify(control.error ?? null));
    await assert.rejects(supervisor.request('source.query.start', {}), {
      code: 'VAULT_UNAVAILABLE',
    });
  } finally {
    if (supervisor && realStop) {
      supervisor.stop = realStop;
      await realStop().catch(() => {});
    }
    if (!stdin.writableEnded) stdin.end();
    if (running) await running.catch(() => {});
  }
});

test('owned child stop rejection never overrides persistent recovery errors', async () => {
  const current = await fixture();
  let realStop = null;
  try {
    current.supervisor.startInBackground();
    await waitForState(current.supervisor, 'ready');
    await createPendingMarker(current.dataDir);
    await writeFile(path.join(current.stateDir, 'fatal.flag'), 'fatal', 'utf8');
    realStop = current.supervisor.stop.bind(current.supervisor);
    current.supervisor.stop = async () => {
      throw new Error('simulated owned-child stop failure');
    };

    await assert.rejects(current.supervisor.request('source.credentials.status', {
      mutationId: '99999999-9999-4999-8999-999999999999',
    }), {
      code: 'CREDENTIAL_MUTATION_NOT_FOUND',
      message: FINANCIAL_ERROR_MESSAGES.CREDENTIAL_MUTATION_NOT_FOUND,
    });
    await waitForState(current.supervisor, 'failed');
    await assert.rejects(
      current.supervisor.request('source.credentials.status', { mutationId: null }),
      { code: 'VAULT_UNAVAILABLE', message: FINANCIAL_ERROR_MESSAGES.VAULT_UNAVAILABLE },
    );
    await assert.rejects(current.supervisor.request('source.credentials.status', {
      mutationId: '99999999-9999-4999-8999-999999999999',
    }), {
      code: 'CREDENTIAL_MUTATION_NOT_FOUND',
      message: FINANCIAL_ERROR_MESSAGES.CREDENTIAL_MUTATION_NOT_FOUND,
    });
  } finally {
    if (realStop) {
      current.supervisor.stop = realStop;
      await realStop().catch(() => {});
    } else {
      await current.supervisor.stop().catch(() => {});
    }
  }
});
