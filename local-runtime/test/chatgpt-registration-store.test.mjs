import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  REGISTRATION_STORE_EXECUTABLE,
  REGISTRATION_STORE_HELPER,
  RegistrationStore,
} from '../src/chatgpt-provider/registration-store.mjs';

const HOST_ID = 'urn:uuid:123e4567-e89b-42d3-a456-426614174000';
const LEGACY_HOST_ID = Buffer.alloc(32, 7).toString('base64url');
const UNREGISTERED = Object.freeze({
  version: 1,
  hostId: HOST_ID,
  issuedClientId: null,
  accountBindingSha256: null,
});
const BOUND = Object.freeze({
  version: 1,
  hostId: HOST_ID,
  issuedClientId: 'oaiapp_athena-test',
  accountBindingSha256: 'a'.repeat(64),
});

function fakeSpawn(responder) {
  const calls = [];
  const implementation = (executable, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killCalls = 0;
    child.kill = () => {
      child.killCalls += 1;
      return true;
    };
    const chunks = [];
    child.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stdin.on('finish', () => {
      const call = { executable, args, options, input: Buffer.concat(chunks).toString('utf8'), child };
      calls.push(call);
      responder(call, child);
    });
    return child;
  };
  implementation.calls = calls;
  return implementation;
}

function succeed(value, delay = 0) {
  return (_call, child) => setTimeout(() => {
    child.stdout.write(JSON.stringify(value));
    child.stdout.end();
    child.stderr.end();
    child.emit('close', 0, null);
  }, delay);
}

test('uses only the fixed executable, fixed helper, scrubbed environment, and exact input', async () => {
  process.env.ATHENA_REGISTRATION_CANARY = 'must-not-cross';
  const spawnImpl = fakeSpawn(succeed(BOUND));
  try {
    const store = new RegistrationStore({ dataRoot: 'C:\\fixtures\\registration', spawnImpl });
    const result = await store.bind({
      accountBindingSha256: BOUND.accountBindingSha256,
      issuedClientId: BOUND.issuedClientId,
    });
    assert.deepEqual(result, BOUND);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(spawnImpl.calls.length, 1);
    const [call] = spawnImpl.calls;
    assert.equal(call.executable, REGISTRATION_STORE_EXECUTABLE);
    assert.deepEqual(call.args, [
      '-NoLogo', '-NoProfile', '-NonInteractive',
      '-File', REGISTRATION_STORE_HELPER,
      '-Operation', 'bind',
      '-DataRoot', 'C:\\fixtures\\registration',
    ]);
    assert.deepEqual(call.options, {
      shell: false,
      windowsHide: true,
      env: {
        SystemRoot: 'C:\\Windows',
        windir: 'C:\\Windows',
        PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert.deepEqual(JSON.parse(call.input), {
      issuedClientId: BOUND.issuedClientId,
      accountBindingSha256: BOUND.accountBindingSha256,
    });
    assert.equal(call.input.includes('CANARY'), false);
  } finally {
    delete process.env.ATHENA_REGISTRATION_CANARY;
  }
});

test('rejects UNC, device, relative, extra, malformed, and secret-shaped requests before spawn', async () => {
  const spawnImpl = fakeSpawn(succeed(UNREGISTERED));
  for (const dataRoot of [
    '\\\\server\\share', '\\\\?\\C:\\fixture', '\\.\\C:\\fixture', 'relative\\fixture',
  ]) {
    assert.throws(
      () => new RegistrationStore({ dataRoot, spawnImpl }),
      { code: 'OPENAI_REGISTRATION_REQUEST_INVALID' },
    );
  }
  const store = new RegistrationStore({ dataRoot: 'C:\\fixture', spawnImpl });
  assert.throws(() => store.bind({
    issuedClientId: 'dynamic_agent_client',
    accountBindingSha256: 'a'.repeat(64),
  }), { code: 'OPENAI_REGISTRATION_REQUEST_INVALID' });
  assert.throws(() => store.bind({
    issuedClientId: BOUND.issuedClientId,
    accountBindingSha256: BOUND.accountBindingSha256,
    access_token: 'forbidden',
  }), { code: 'OPENAI_REGISTRATION_REQUEST_INVALID' });
  assert.throws(() => store.reset({
    expectedIssuedClientId: BOUND.issuedClientId,
    expectedAccountBindingSha256: 'A'.repeat(64),
  }), { code: 'OPENAI_REGISTRATION_REQUEST_INVALID' });
  assert.equal(spawnImpl.calls.length, 0);
});

test('cancellation before spawn aborts and cancellation after spawn waits without killing mutation', async () => {
  const pre = new AbortController();
  pre.abort();
  const beforeSpawn = fakeSpawn(succeed(UNREGISTERED));
  const store = new RegistrationStore({ dataRoot: 'C:\\fixture', spawnImpl: beforeSpawn });
  await assert.rejects(store.ensureHost({ signal: pre.signal }), {
    code: 'OPENAI_REGISTRATION_CANCELLED',
  });
  assert.equal(beforeSpawn.calls.length, 0);

  const controller = new AbortController();
  const started = fakeSpawn((call, child) => setTimeout(() => {
    child.stdout.write(JSON.stringify(BOUND));
    child.emit('close', 0, null);
  }, 30));
  const pending = new RegistrationStore({ dataRoot: 'C:\\fixture', spawnImpl: started }).bind({
    issuedClientId: BOUND.issuedClientId,
    accountBindingSha256: BOUND.accountBindingSha256,
  }, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await assert.rejects(pending, { code: 'OPENAI_REGISTRATION_CANCELLED' });
  assert.equal(started.calls[0].child.killCalls, 0);
});

test('malformed and hostile signal options always fail with a fixed registration error', async () => {
  const spawnImpl = fakeSpawn(succeed(UNREGISTERED));
  const store = new RegistrationStore({ dataRoot: 'C:\\fixture', spawnImpl });
  for (const options of [null, 1, [], { extra: true }, {
    get signal() { throw new Error('private signal getter'); },
  }, new Proxy({}, { ownKeys() { throw new Error('private ownKeys failure'); } })]) {
    await assert.rejects(store.read(options), {
      code: 'OPENAI_REGISTRATION_REQUEST_INVALID',
    });
  }
  await assert.rejects(store.read({ signal: {
    get aborted() { throw new Error('private aborted getter'); },
  } }), { code: 'OPENAI_REGISTRATION_REQUEST_INVALID' });
  assert.equal(spawnImpl.calls.length, 0);
});

test('accepts only exact canonical documents and bounded clean output', async () => {
  const invalid = [
    { ...UNREGISTERED, extra: true },
    { ...UNREGISTERED, hostId: 'urn:uuid:123e4567-e89b-12d3-a456-426614174000' },
    { ...UNREGISTERED, issuedClientId: BOUND.issuedClientId },
    { ...BOUND, accountBindingSha256: 'A'.repeat(64) },
  ];
  for (const value of invalid) {
    const store = new RegistrationStore({
      dataRoot: 'C:\\fixture',
      spawnImpl: fakeSpawn(succeed(value)),
    });
    await assert.rejects(store.read(), { code: 'OPENAI_REGISTRATION_OUTPUT_INVALID' });
  }

  const legacy = new RegistrationStore({
    dataRoot: 'C:\\fixture',
    spawnImpl: fakeSpawn(succeed({ ...UNREGISTERED, hostId: LEGACY_HOST_ID })),
  });
  await assert.rejects(legacy.read(), {
    code: 'OPENAI_REGISTRATION_HOST_ID_UNSUPPORTED',
  });

  const stderrStore = new RegistrationStore({
    dataRoot: 'C:\\fixture',
    spawnImpl: fakeSpawn((_call, child) => {
      child.stdout.write(JSON.stringify(UNREGISTERED));
      child.stderr.write('unexpected');
      child.emit('close', 0, null);
    }),
  });
  await assert.rejects(stderrStore.read(), { code: 'OPENAI_REGISTRATION_OUTPUT_INVALID' });

  const oversizedStore = new RegistrationStore({
    dataRoot: 'C:\\fixture',
    spawnImpl: fakeSpawn((_call, child) => {
      child.stdout.write('x'.repeat(4097));
      child.emit('close', 0, null);
    }),
  });
  await assert.rejects(oversizedStore.read(), { code: 'OPENAI_REGISTRATION_OUTPUT_INVALID' });
});

test('preserves allowlisted helper codes and never exposes raw helper output', async () => {
  const safe = new RegistrationStore({
    dataRoot: 'C:\\fixture',
    spawnImpl: fakeSpawn((_call, child) => {
      child.stdout.write(JSON.stringify({ code: 'OPENAI_REGISTRATION_BINDING_CONFLICT' }));
      child.emit('close', 1, null);
    }),
  });
  await assert.rejects(safe.bind({
    issuedClientId: BOUND.issuedClientId,
    accountBindingSha256: BOUND.accountBindingSha256,
  }), { code: 'OPENAI_REGISTRATION_BINDING_CONFLICT' });

  const raw = new RegistrationStore({
    dataRoot: 'C:\\fixture',
    spawnImpl: fakeSpawn((_call, child) => {
      child.stdout.write('{"code":"C:\\\\private\\\\provider-data"}');
      child.stderr.write('token=private-value');
      child.emit('close', 1, null);
    }),
  });
  const error = await raw.read().catch((value) => value);
  assert.equal(error.code, 'OPENAI_REGISTRATION_HELPER_FAILED');
  assert.equal(`${error.message}\n${error.stack}`.includes('private'), false);
});

test('does not retry an uncertain mutation and a later read can recover the published winner', async () => {
  let call = 0;
  const spawnImpl = fakeSpawn((_invocation, child) => {
    call += 1;
    if (call === 1) {
      child.stdout.write('{');
      child.emit('close', 0, null);
    } else {
      child.stdout.write(JSON.stringify(BOUND));
      child.emit('close', 0, null);
    }
  });
  const store = new RegistrationStore({ dataRoot: 'C:\\fixture', spawnImpl });
  await assert.rejects(store.bind({
    issuedClientId: BOUND.issuedClientId,
    accountBindingSha256: BOUND.accountBindingSha256,
  }), { code: 'OPENAI_REGISTRATION_OUTPUT_INVALID' });
  assert.equal(spawnImpl.calls.length, 1);
  assert.deepEqual(await store.read(), BOUND);
  assert.equal(spawnImpl.calls.length, 2);
});
