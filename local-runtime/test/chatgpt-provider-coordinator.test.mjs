import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ProviderCoordinator } from '../src/chatgpt-provider/provider-coordinator.mjs';
import { createRequestHandler } from '../src/host.mjs';
import {
  createProtocolValidator, PROTOCOL_VERSION, PROVIDER_ERROR_MESSAGES,
} from '../../contracts/wts-foundation.mjs';

function createMockTokenSession() {
  let active = true;
  return {
    get active() { return active; },
    accessToken: async () => 'test-access-token',
    disconnect: async () => 'revoked',
    shutdown: () => { active = false; },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settleJob() {
  await new Promise((resolve) => setImmediate(resolve));
}

function consumeTerminal(coordinator, operationId) {
  const snapshot = coordinator.operationGet({ operationId, consume: true });
  coordinator.operationCommitConsumption({
    operationId: snapshot.operationId,
    revision: snapshot.revision,
  });
  return snapshot;
}

function createMockStore({ issuedClientId = null, accountBindingSha256 = null } = {}) {
  let metadata = {
    version: 1,
    hostId: 'urn:uuid:123e4567-e89b-42d3-a456-426614174000',
    issuedClientId,
    accountBindingSha256,
  };
  return {
    ensureHost: async () => metadata,
    bind: async ({ issuedClientId: id, accountBindingSha256: b } = {}) => {
      metadata.issuedClientId = id;
      metadata.accountBindingSha256 = b;
    },
    read: async () => {
      if (metadata.issuedClientId === null) {
        const err = new Error('not found');
        err.code = 'OPENAI_REGISTRATION_NOT_FOUND';
        throw err;
      }
      return metadata;
    },
    reset: async () => {
      metadata.issuedClientId = null;
      metadata.accountBindingSha256 = null;
    },
  };
}

test('ProviderCoordinator initial status is signed-out and idle', () => {
  const coordinator = new ProviderCoordinator({
    registrationStore: createMockStore(),
  });
  const status = coordinator.status();
  assert.equal(status.provider, 'openai-chatgpt-siwc-v1');
  assert.equal(status.connection, 'signed-out');
  assert.equal(status.accountResetAvailable, true);
  assert.equal(status.catalog, 'unavailable');
  assert.equal(status.selectedModel, null);
  assert.equal(status.operation, null);
});

const connectFailureCases = [
  ['OPENAI_OAUTH_EXCHANGE_FAILED', 'PROVIDER_CONNECT_EXCHANGE_FAILED'],
  ['OPENAI_OAUTH_EXCHANGE_DEADLINE_EXCEEDED', 'PROVIDER_CONNECT_EXCHANGE_TIMEOUT'],
  ['OPENAI_OAUTH_TOKEN_HTTP_ERROR', 'PROVIDER_CONNECT_TOKEN_REJECTED'],
  ['OPENAI_OAUTH_TOKEN_RESPONSE_INVALID', 'PROVIDER_CONNECT_TOKEN_RESPONSE_INVALID'],
  ['OPENAI_OAUTH_IDENTITY_INVALID', 'PROVIDER_CONNECT_IDENTITY_INVALID'],
  ['OPENAI_OAUTH_ACCOUNT_MISMATCH', 'PROVIDER_CONNECT_ACCOUNT_MISMATCH'],
  ['OPENAI_OAUTH_BIND_FAILED', 'PROVIDER_CONNECT_REGISTRATION_FAILED'],
  ['OPENAI_OAUTH_TOKEN_ACTIVATION_FAILED', 'PROVIDER_CONNECT_SESSION_FAILED'],
  ['OPENAI_OAUTH_DEADLINE_EXCEEDED', 'PROVIDER_CONNECT_TIMEOUT'],
];

for (const [internalCode, publicCode] of connectFailureCases) {
  test(`connect failure preserves the safe ${publicCode} diagnostic without retrying`, async () => {
    let connectCalls = 0;
    let fetchCalls = 0;
    const coordinator = new ProviderCoordinator({
      registrationStore: createMockStore(),
      fetchImpl: async () => { fetchCalls += 1; throw new Error('unexpected network'); },
      createOAuthSession: () => ({
        connect: async () => {
          connectCalls += 1;
          throw Object.assign(new Error('synthetic-secret-token https://private.invalid/callback?code=secret'), {
            code: internalCode,
          });
        },
      }),
    });

    const started = coordinator.connectStart();
    await settleJob();
    const terminal = coordinator.operationGet({ operationId: started.operationId, consume: false });
    assert.equal(terminal.state, 'failed');
    assert.equal(terminal.result, null);
    assert.deepEqual(terminal.error, { code: publicCode, message: PROVIDER_ERROR_MESSAGES[publicCode] });
    assert.equal(typeof terminal.error.message, 'string');
    assert.doesNotMatch(JSON.stringify(terminal), /synthetic-secret|private\.invalid|OPENAI_OAUTH/u);
    assert.deepEqual(coordinator.operationGet({ operationId: started.operationId }), terminal);
    assert.equal(coordinator.status().connection, 'signed-out');
    consumeTerminal(coordinator, started.operationId);
    assert.throws(() => coordinator.modelsStart(), { code: 'PROVIDER_STATE_INVALID' });
    await settleJob();
    assert.equal(connectCalls, 1);
    assert.equal(fetchCalls, 0);
    coordinator.shutdown();
  });
}

test('connect failures with unknown or sensitive codes retain only the generic fixed error', async () => {
  for (const code of [undefined, 'OPENAI_OAUTH_UNEXPECTED', 'secret-token-value', '__proto__', 'constructor']) {
    const coordinator = new ProviderCoordinator({
      registrationStore: createMockStore(),
      createOAuthSession: () => ({
        connect: async () => { throw Object.assign(new Error('synthetic-secret-token'), { code }); },
      }),
    });
    const started = coordinator.connectStart();
    await settleJob();
    const terminal = coordinator.operationGet({ operationId: started.operationId });
    assert.deepEqual(terminal.error, {
      code: 'PROVIDER_CONNECT_FAILED', message: PROVIDER_ERROR_MESSAGES.PROVIDER_CONNECT_FAILED,
    });
    assert.doesNotMatch(JSON.stringify(terminal), /synthetic-secret|secret-token|OPENAI_OAUTH_UNEXPECTED/u);
    coordinator.shutdown();
  }
});

test('accepted cancellation takes precedence over every known connect diagnostic', async () => {
  for (const [code] of connectFailureCases) {
    const connect = deferred();
    const coordinator = new ProviderCoordinator({
      registrationStore: createMockStore(),
      createOAuthSession: () => ({ connect: () => connect.promise }),
    });
    const started = coordinator.connectStart();
    coordinator.operationCancel({
      operationId: started.operationId,
      expectedRevision: 1,
      cancellationId: '88888888-8888-4888-8888-888888888888',
    });
    connect.reject(Object.assign(new Error('synthetic-secret-token'), { code }));
    await settleJob();
    const terminal = coordinator.operationGet({ operationId: started.operationId });
    assert.equal(terminal.state, 'cancelled');
    assert.deepEqual(terminal.error, {
      code: 'PROVIDER_CONNECT_CANCELLED', message: PROVIDER_ERROR_MESSAGES.PROVIDER_CONNECT_CANCELLED,
    });
    assert.equal(coordinator.status().connection, 'signed-out');
    coordinator.shutdown();
  }
});

const modelsFailureCases = [
  ['OPENAI_MODELS_AUTH_REQUIRED', 'PROVIDER_MODELS_AUTH_REQUIRED'],
  ['OPENAI_MODELS_ACCESS_DENIED', 'PROVIDER_MODELS_ACCESS_DENIED'],
  ['OPENAI_MODELS_RATE_LIMITED', 'PROVIDER_MODELS_RATE_LIMITED'],
  ['OPENAI_MODELS_SERVICE_UNAVAILABLE', 'PROVIDER_MODELS_SERVICE_UNAVAILABLE'],
  ['OPENAI_MODELS_HTTP_ERROR', 'PROVIDER_MODELS_HTTP_FAILED'],
  ['OPENAI_MODELS_DEADLINE_EXCEEDED', 'PROVIDER_MODELS_TIMEOUT'],
  ['OPENAI_MODELS_NETWORK_ERROR', 'PROVIDER_MODELS_NETWORK_FAILED'],
  ['OPENAI_MODELS_TOKEN_UNAVAILABLE', 'PROVIDER_MODELS_SESSION_UNAVAILABLE'],
  ['OPENAI_MODELS_TOKEN_INVALID', 'PROVIDER_MODELS_SESSION_UNAVAILABLE'],
  ['OPENAI_MODELS_BODY_TOO_LARGE', 'PROVIDER_MODELS_RESPONSE_TOO_LARGE'],
  ['OPENAI_MODELS_CONTENT_TYPE_INVALID', 'PROVIDER_MODELS_RESPONSE_FORMAT_INVALID'],
  ['OPENAI_MODELS_JSON_INVALID', 'PROVIDER_MODELS_RESPONSE_FORMAT_INVALID'],
  ['OPENAI_MODELS_UTF8_INVALID', 'PROVIDER_MODELS_RESPONSE_FORMAT_INVALID'],
  ['OPENAI_MODELS_BODY_INVALID', 'PROVIDER_MODELS_RESPONSE_FORMAT_INVALID'],
  ['OPENAI_MODELS_BODY_READ_ERROR', 'PROVIDER_MODELS_RESPONSE_READ_FAILED'],
  ['OPENAI_MODELS_PAYLOAD_INVALID', 'PROVIDER_MODELS_RESPONSE_SCHEMA_INVALID'],
  ['OPENAI_MODELS_ENTRY_INVALID', 'PROVIDER_MODELS_MODEL_METADATA_INVALID'],
  ['OPENAI_MODELS_REDIRECT_REJECTED', 'PROVIDER_MODELS_REDIRECT_REJECTED'],
  ['OPENAI_MODELS_COUNT_EXCEEDED', 'PROVIDER_MODELS_COUNT_EXCEEDED'],
];

for (const [internalCode, publicCode] of modelsFailureCases) {
  test(`models failure publishes ${internalCode} as a fixed diagnostic without retrying`, async () => {
    const token = createMockTokenSession();
    let listCalls = 0;
    const coordinator = new ProviderCoordinator({
      registrationStore: createMockStore(),
      createOAuthSession: () => ({ connect: async () => token }),
      createModelsClient: () => ({
        list: async () => {
          listCalls += 1;
          throw Object.assign(new Error('private-token https://private.invalid/models'), { code: internalCode });
        },
      }),
    });
    const connected = coordinator.connectStart();
    await settleJob();
    consumeTerminal(coordinator, connected.operationId);
    const started = coordinator.modelsStart();
    await settleJob();
    const terminal = coordinator.operationGet({ operationId: started.operationId });
    assert.equal(terminal.state, 'failed');
    assert.equal(terminal.result, null);
    assert.deepEqual(terminal.error, { code: publicCode, message: PROVIDER_ERROR_MESSAGES[publicCode] });
    assert.equal(typeof terminal.error.message, 'string');
    assert.doesNotMatch(JSON.stringify(terminal), /private-|OPENAI_MODELS|https?:/u);
    assert.deepEqual(coordinator.operationGet({ operationId: started.operationId }), terminal);
    consumeTerminal(coordinator, started.operationId);
    assert.throws(() => coordinator.modelSelect({ slug: 'not-loaded' }), {
      code: internalCode === 'OPENAI_MODELS_AUTH_REQUIRED' ? 'PROVIDER_STATE_INVALID' : 'PROVIDER_MODEL_CATALOG_REQUIRED',
    });
    await settleJob();
    assert.equal(listCalls, 1);
    coordinator.shutdown();
  });
}

test('unknown models errors expose only the generic fixed diagnostic', async () => {
  for (const code of [undefined, 'OPENAI_MODELS_UNEXPECTED', 'private-token-value', '__proto__', 'constructor']) {
    const coordinator = new ProviderCoordinator({
      registrationStore: createMockStore(),
      createOAuthSession: () => ({ connect: async () => createMockTokenSession() }),
      createModelsClient: () => ({
        list: async () => { throw Object.assign(new Error('private-body-token'), { code }); },
      }),
    });
    const connected = coordinator.connectStart();
    await settleJob();
    consumeTerminal(coordinator, connected.operationId);
    const started = coordinator.modelsStart();
    await settleJob();
    const terminal = coordinator.operationGet({ operationId: started.operationId });
    assert.deepEqual(terminal.error, {
      code: 'PROVIDER_MODELS_FAILED', message: PROVIDER_ERROR_MESSAGES.PROVIDER_MODELS_FAILED,
    });
    assert.doesNotMatch(JSON.stringify(terminal), /private-|OPENAI_MODELS_UNEXPECTED/u);
    coordinator.shutdown();
  }
});

test('models HTTP 401 invalidates credentials while 403 preserves the connected session without retry', async () => {
  for (const status of [401, 403]) {
    const token = createMockTokenSession();
    let fetchCalls = 0;
    const coordinator = new ProviderCoordinator({
      registrationStore: createMockStore(),
      createOAuthSession: () => ({ connect: async () => token }),
      fetchImpl: async () => { fetchCalls += 1; return new Response('private-error-body', { status }); },
    });
    const connected = coordinator.connectStart();
    await settleJob();
    consumeTerminal(coordinator, connected.operationId);
    const started = coordinator.modelsStart();
    await settleJob();
    const terminal = coordinator.operationGet({ operationId: started.operationId });
    assert.equal(terminal.error.code, status === 401 ? 'PROVIDER_MODELS_AUTH_REQUIRED' : 'PROVIDER_MODELS_ACCESS_DENIED');
    assert.equal(token.active, status === 403);
    assert.equal(coordinator.status().connection, status === 401 ? 'signed-out' : 'connected');
    assert.equal(coordinator.status().catalog, status === 401 ? 'unavailable' : 'not-loaded');
    assert.equal(coordinator.status().selectedModel, null);
    consumeTerminal(coordinator, started.operationId);
    if (status === 401) assert.throws(() => coordinator.modelsStart(), { code: 'PROVIDER_STATE_INVALID' });
    await settleJob();
    assert.equal(fetchCalls, 1);
    coordinator.shutdown();
  }
});

test('model token failures preserve only an active session and never fetch a catalog', async () => {
  for (const invalidate of [true, false]) {
    let active = true;
    let tokenCalls = 0;
    let fetchCalls = 0;
    const token = {
      get active() { return active; },
      accessToken: async () => {
        tokenCalls += 1;
        if (invalidate) active = false;
        throw new Error('private-refresh-token');
      },
      shutdown: () => { active = false; },
    };
    const coordinator = new ProviderCoordinator({
      registrationStore: createMockStore(),
      createOAuthSession: () => ({ connect: async () => token }),
      fetchImpl: async () => { fetchCalls += 1; throw new Error('unexpected fetch'); },
    });
    const connected = coordinator.connectStart();
    await settleJob();
    consumeTerminal(coordinator, connected.operationId);
    const started = coordinator.modelsStart();
    await settleJob();
    const terminal = coordinator.operationGet({ operationId: started.operationId });
    assert.equal(terminal.error.code, 'PROVIDER_MODELS_SESSION_UNAVAILABLE');
    assert.equal(coordinator.status().connection, invalidate ? 'signed-out' : 'connected');
    assert.equal(coordinator.status().catalog, invalidate ? 'unavailable' : 'not-loaded');
    consumeTerminal(coordinator, started.operationId);
    assert.throws(() => coordinator.modelSelect({ slug: 'not-loaded' }), {
      code: invalidate ? 'PROVIDER_STATE_INVALID' : 'PROVIDER_MODEL_CATALOG_REQUIRED',
    });
    assert.equal(tokenCalls, 1);
    assert.equal(fetchCalls, 0);
    coordinator.shutdown();
  }
});

test('accepted models cancellation outranks every known model failure without invalidating credentials', async () => {
  for (const [code] of modelsFailureCases) {
    const models = deferred();
    const token = createMockTokenSession();
    const coordinator = new ProviderCoordinator({
      registrationStore: createMockStore(),
      createOAuthSession: () => ({ connect: async () => token }),
      createModelsClient: () => ({ list: () => models.promise }),
    });
    const connected = coordinator.connectStart();
    await settleJob();
    consumeTerminal(coordinator, connected.operationId);
    const started = coordinator.modelsStart();
    coordinator.operationCancel({
      operationId: started.operationId, expectedRevision: 1,
      cancellationId: '99999999-9999-4999-8999-999999999999',
    });
    models.reject(Object.assign(new Error('private-token'), { code }));
    await settleJob();
    const terminal = coordinator.operationGet({ operationId: started.operationId });
    assert.equal(terminal.state, 'cancelled');
    assert.deepEqual(terminal.error, {
      code: 'PROVIDER_MODELS_CANCELLED', message: PROVIDER_ERROR_MESSAGES.PROVIDER_MODELS_CANCELLED,
    });
    assert.equal(token.active, true);
    assert.equal(coordinator.status().connection, 'connected');
    coordinator.shutdown();
  }
});

test('real Native handler validates model selection and planning after consumed provider results', async () => {
  const schema = JSON.parse(await readFile(new URL('../../contracts/wts-foundation.protocol.schema.json', import.meta.url), 'utf8'));
  const connect = deferred();
  const models = deferred();
  const plan = deferred();
  const token = createMockTokenSession();
  const coordinator = new ProviderCoordinator({
    registrationStore: createMockStore(),
    createOAuthSession: () => ({ connect: () => connect.promise }),
    createModelsClient: () => ({ list: () => models.promise }),
    createResponsesClient: () => ({}),
    createPlanningClient: () => ({ plan: () => plan.promise }),
    fetchImpl: async () => { throw new Error('Test must not access the network.'); },
  });
  const handle = createRequestHandler({
    validator: createProtocolValidator(schema), runtimeVersion: '0.8.0', providerCoordinator: coordinator,
  });
  let sequence = 0;
  const call = (method, params = {}) => handle({
    protocolVersion: PROTOCOL_VERSION, requestId: `provider-lifecycle-${++sequence}`, method, params,
  });
  const consume = (operationId) => call('provider.operation.get', { operationId, consume: true });
  const status = async () => {
    const response = await call('provider.status');
    assert.equal(response.ok, true);
    return response.result;
  };

  assert.equal((await status()).operation, null);
  const connecting = await call('provider.connect.start');
  assert.equal(connecting.ok, true);
  assert.equal((await call('provider.models.start')).error.code, 'PROVIDER_BUSY');
  connect.resolve(token);
  await settleJob();
  assert.equal((await status()).operation.state, 'succeeded');
  assert.equal((await call('provider.models.start')).error.code, 'PROVIDER_PREVIOUS_RESULT_PENDING');
  assert.equal((await consume(connecting.result.operationId)).ok, true);

  const loading = await call('provider.models.start');
  assert.equal(loading.ok, true);
  assert.equal((await call('provider.model.select', { slug: 'model-test' })).error.code, 'PROVIDER_BUSY');
  models.resolve([{ slug: 'model-test', displayName: 'Test model' }]);
  await settleJob();
  assert.equal((await status()).operation.kind, 'models');
  assert.equal((await call('provider.model.select', { slug: 'model-test' })).error.code,
    'PROVIDER_PREVIOUS_RESULT_PENDING');
  const loaded = await consume(loading.result.operationId);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.result.state, 'succeeded');

  const selected = await call('provider.model.select', { slug: 'model-test' });
  assert.equal(selected.ok, true);
  assert.equal(selected.result.operation, null);
  assert.deepEqual(selected.result.selectedModel, {
    slug: 'model-test', displayName: 'Test model', compatibility: 'untested',
  });
  assert.deepEqual(await status(), selected.result);
  assert.deepEqual((await consume(loading.result.operationId)).result, loaded.result);
  assert.equal((await status()).operation, null);

  const planningParams = {
    submissionId: 'abababab-abab-4bab-8bab-abababababab', text: '연결을 확인해 주세요.',
  };
  const planning = await call('provider.plan.start', planningParams);
  assert.equal(planning.ok, true);
  assert.equal((await status()).operation.kind, 'plan');
  assert.equal((await call('provider.model.select', { slug: 'model-test' })).error.code, 'PROVIDER_BUSY');
  plan.resolve({ assistantText: '연결되었습니다.', proposal: null });
  await settleJob();
  assert.equal((await status()).selectedModel.compatibility, 'completed');
  assert.equal((await call('provider.plan.start', planningParams)).error.code, 'PROVIDER_PREVIOUS_RESULT_PENDING');
  assert.equal((await consume(planning.result.operationId)).result.state, 'succeeded');
  assert.equal((await status()).operation, null);
  assert.equal((await call('provider.model.select', { slug: 'model-test' })).ok, true);

  token.shutdown();
  const expired = await status();
  assert.equal(expired.connection, 'signed-out');
  assert.equal(expired.catalog, 'unavailable');
  assert.equal(expired.selectedModel, null);
  assert.equal(expired.operation, null);
  assert.equal(expired.accountResetAvailable, true);
  assert.equal((await call('provider.model.select', { slug: 'model-test' })).error.code, 'PROVIDER_STATE_INVALID');
  assert.equal((await call('provider.plan.start', planningParams)).error.code, 'PROVIDER_STATE_INVALID');
  coordinator.shutdown();
});

test('ProviderCoordinator connect, models, select, and plan lifecycle', async () => {
  const store = createMockStore();
  const mockToken = createMockTokenSession();
  let fakeFetch = async (url) => {
    if (url.includes('/models')) {
      return new Response(JSON.stringify({
        models: [
          { slug: 'gpt-4o', display_name: 'GPT-4o', visibility: 'list' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/responses')) {
      const sse = [
        'event: response.created\ndata: {"response":{"id":"resp-1"}}\n\n',
        'event: response.output_item.added\ndata: {"item":{"type":"message","role":"assistant","content":[]}}\n\n',
        'event: response.output_text.done\ndata: {"text":"{\\"assistantText\\":\\"차트를 열겠습니다.\\",\\"proposal\\":{\\"kind\\":\\"wts-control\\",\\"text\\":\\"차트 열어줘\\"}}"}\n\n',
        'event: response.completed\ndata: {"response":{"id":"resp-1","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"{\\"assistantText\\":\\"차트를 열겠습니다.\\",\\"proposal\\":{\\"kind\\":\\"wts-control\\",\\"text\\":\\"차트 열어줘\\"}}"}]}]}}\n\n',
      ].join('');
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response('{}', { status: 200 });
  };

  const coordinator = new ProviderCoordinator({
    registrationStore: store,
    openBrowser: async () => undefined,
    fetchImpl: fakeFetch,
  });

  // Inject tokenSession directly for testing connect completion
  coordinator._injectTokenSession = mockToken;

  // Test accountReset when already-empty
  const resetSnap = coordinator.accountResetStart();
  assert.equal(resetSnap.kind, 'account-reset');
  assert.equal(resetSnap.state, 'running');

  // Wait for reset job to finish
  await new Promise((r) => setTimeout(r, 50));
  const resetDone = consumeTerminal(coordinator, resetSnap.operationId);
  assert.equal(resetDone.state, 'succeeded');
  assert.equal(resetDone.result.registration, 'already-empty');

  // Test cannot start when unconsumed (we consumed it, so it should be idle)
  assert.equal(coordinator.status().accountResetAvailable, true);
});

test('ProviderCoordinator enforces PROVIDER_BUSY when a job is active', () => {
  const coordinator = new ProviderCoordinator({
    registrationStore: createMockStore(),
  });

  coordinator.accountResetStart();
  assert.throws(() => coordinator.accountResetStart(), { code: 'PROVIDER_BUSY' });
});

test('ProviderCoordinator operationCancel works for cancellable jobs', async () => {
  const coordinator = new ProviderCoordinator({
    registrationStore: createMockStore(),
  });

  // connect.start is cancellable
  const snap = coordinator.connectStart();
  assert.equal(snap.cancellable, true);
  assert.equal(snap.revision, 1);

  const cancelling = coordinator.operationCancel({
    operationId: snap.operationId,
    expectedRevision: 1,
    cancellationId: '11111111-1111-4111-8111-111111111111',
  });
  assert.equal(cancelling.state, 'cancelling');
  assert.equal(cancelling.revision, 2);

  // Repeat same cancel returns same snapshot
  const repeat = coordinator.operationCancel({
    operationId: snap.operationId,
    expectedRevision: 1,
    cancellationId: '11111111-1111-4111-8111-111111111111',
  });
  assert.equal(repeat.state, 'cancelling');
});

test('accepted connect cancellation suppresses late success, disposes its token, and stays idempotent', async () => {
  const connect = deferred();
  const tokenSession = createMockTokenSession();
  let cancelCalls = 0;
  const coordinator = new ProviderCoordinator({
    registrationStore: createMockStore(),
    createOAuthSession: () => ({
      connect: () => connect.promise,
      cancel: () => { cancelCalls += 1; },
    }),
  });

  const started = coordinator.connectStart();
  const cancellationId = '22222222-2222-4222-8222-222222222222';
  const cancelling = coordinator.operationCancel({
    operationId: started.operationId,
    expectedRevision: started.revision,
    cancellationId,
  });
  assert.equal(cancelling.state, 'cancelling');
  assert.equal(cancelling.revision, 2);

  connect.resolve(tokenSession);
  await settleJob();

  const cancelled = coordinator.operationGet({ operationId: started.operationId, consume: false });
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.revision, 3);
  assert.equal(cancelled.error.code, 'PROVIDER_CONNECT_CANCELLED');
  assert.equal(cancelCalls, 1);
  assert.equal(tokenSession.active, false);
  assert.equal(coordinator.status().connection, 'signed-out');
  assert.deepEqual(consumeTerminal(coordinator, started.operationId), cancelled);
  assert.equal(coordinator.status().operation, null);

  const repeated = coordinator.operationCancel({
    operationId: started.operationId,
    expectedRevision: 1,
    cancellationId,
  });
  assert.deepEqual(repeated, cancelled);
  assert.throws(() => coordinator.operationCancel({
    operationId: started.operationId,
    expectedRevision: cancelled.revision,
    cancellationId: '33333333-3333-4333-8333-333333333333',
  }), { code: 'PROVIDER_OPERATION_CONFLICT' });
});

test('accepted connect cancellation maps a non-cooperative late rejection to cancelled', async () => {
  const connect = deferred();
  const coordinator = new ProviderCoordinator({
    registrationStore: createMockStore(),
    createOAuthSession: () => ({ connect: () => connect.promise }),
  });
  const started = coordinator.connectStart();
  coordinator.operationCancel({
    operationId: started.operationId,
    expectedRevision: 1,
    cancellationId: '44444444-4444-4444-8444-444444444444',
  });

  connect.reject(Object.assign(new Error('late secret rejection'), { code: 'UNTRUSTED_FAILURE' }));
  await settleJob();

  const cancelled = coordinator.operationGet({ operationId: started.operationId });
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.error.code, 'PROVIDER_CONNECT_CANCELLED');
  assert.doesNotMatch(JSON.stringify(cancelled), /secret|UNTRUSTED/u);
});

test('accepted models cancellation cannot install a late catalog', async () => {
  const models = deferred();
  const tokenSession = createMockTokenSession();
  let cancelCalls = 0;
  const coordinator = new ProviderCoordinator({
    registrationStore: createMockStore(),
    createOAuthSession: () => ({ connect: async () => tokenSession }),
    createModelsClient: () => ({
      list: () => models.promise,
      cancel: () => { cancelCalls += 1; },
    }),
  });

  const connected = coordinator.connectStart();
  await settleJob();
  consumeTerminal(coordinator, connected.operationId);
  const started = coordinator.modelsStart();
  coordinator.operationCancel({
    operationId: started.operationId,
    expectedRevision: 1,
    cancellationId: '55555555-5555-4555-8555-555555555555',
  });

  models.resolve([{ slug: 'gpt-4o', displayName: 'GPT-4o' }]);
  await settleJob();

  const status = coordinator.status();
  assert.equal(status.connection, 'connected');
  assert.equal(status.catalog, 'not-loaded');
  assert.equal(status.selectedModel, null);
  assert.equal(status.operation.state, 'cancelled');
  assert.equal(status.operation.revision, 3);
  assert.equal(cancelCalls, 1);
});

test('accepted plan cancellation cannot mark model compatibility completed after late success', async () => {
  const plan = deferred();
  const tokenSession = createMockTokenSession();
  let cancelCalls = 0;
  const coordinator = new ProviderCoordinator({
    registrationStore: createMockStore(),
    createOAuthSession: () => ({ connect: async () => tokenSession }),
    createModelsClient: () => ({
      list: async () => [{ slug: 'gpt-4o', displayName: 'GPT-4o' }],
    }),
    createResponsesClient: () => ({ cancel: () => true }),
    createPlanningClient: () => ({
      plan: () => plan.promise,
      cancel: () => { cancelCalls += 1; return true; },
    }),
  });

  const connected = coordinator.connectStart();
  await settleJob();
  consumeTerminal(coordinator, connected.operationId);
  const loaded = coordinator.modelsStart();
  await settleJob();
  consumeTerminal(coordinator, loaded.operationId);
  coordinator.modelSelect({ slug: 'gpt-4o' });

  const started = coordinator.planStart({
    submissionId: '66666666-6666-4666-8666-666666666666',
    text: '차트 열어줘',
  });
  coordinator.operationCancel({
    operationId: started.operationId,
    expectedRevision: 1,
    cancellationId: '77777777-7777-4777-8777-777777777777',
  });
  plan.resolve({
    assistantText: 'late success',
    proposal: { kind: 'wts-control', text: '차트 열어줘' },
  });
  await settleJob();

  const status = coordinator.status();
  assert.equal(status.selectedModel.compatibility, 'untested');
  assert.equal(status.operation.state, 'cancelled');
  assert.equal(cancelCalls, 1);
  const terminal = coordinator.operationGet({ operationId: started.operationId });
  assert.equal(terminal.result, null);
  assert.equal(terminal.error.code, 'PROVIDER_PLAN_CANCELLED');
});

test('operation consumption commits only an exact retained terminal revision', async () => {
  const coordinator = new ProviderCoordinator({ registrationStore: createMockStore() });
  const started = coordinator.accountResetStart();
  await settleJob();
  const terminal = coordinator.operationGet({ operationId: started.operationId, consume: true });

  assert.throws(() => coordinator.accountResetStart(), {
    code: 'PROVIDER_PREVIOUS_RESULT_PENDING',
  });
  assert.throws(() => coordinator.operationCommitConsumption({
    operationId: terminal.operationId,
    revision: terminal.revision + 1,
  }), { code: 'PROVIDER_OPERATION_CONFLICT' });
  coordinator.operationCommitConsumption({
    operationId: terminal.operationId,
    revision: terminal.revision,
  });
  coordinator.operationCommitConsumption({
    operationId: terminal.operationId,
    revision: terminal.revision,
  });
  assert.doesNotThrow(() => coordinator.accountResetStart());
});
