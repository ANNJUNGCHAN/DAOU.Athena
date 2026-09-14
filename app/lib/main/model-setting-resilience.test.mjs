import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadHandleModelSet({ providerRuntimeEnabled = false, failPrepare = false, failRotate = false } = {}) {
  const source = fs.readFileSync(path.join(here, '..', '..', 'main.js'), 'utf8');
  const start = source.indexOf('async function handleModelSet(');
  const end = source.indexOf('function broadcastModelChanged(', start);
  assert.ok(start >= 0 && end > start, 'handleModelSet must remain executable');

  const observed = [];
  const state = {
    claude: { model: 'sonnet', effort: 'low' },
    grok: { model: null, effort: null },
    codex: { model: null, effort: null },
    active: { provider: 'claude', model: 'sonnet', effort: 'low' },
  };
  const context = vm.createContext({
    modelPrefs: { set: () => ({ ok: true }) },
    codexConfig: { writeModelSettings: () => ({ ok: true }) },
    handleModelGet: () => state,
    selectorClaudePool: {
      configure: () => ({
        activation: 'warming', targetGeneration: 2, servingGeneration: 1,
        readyCurrent: 0, desiredSize: 8,
      }),
    },
    mdlog: (message) => observed.push(['log', message]),
    broadcastModelChanged: () => observed.push(['broadcast']),
    prepareLiveChatPool: () => {
      observed.push(['prepare']);
      if (failPrepare) throw new Error('backend unavailable');
    },
    providerRuntimeEnabled,
    rotatePersistentProvider: async () => {
      observed.push(['rotate']);
      if (failRotate) throw new Error('runtime unavailable');
    },
  });
  vm.runInContext(source.slice(start, end), context);
  return { modelSet: context.handleModelSet, observed };
}

test('모델 저장은 backend 없는 대화 예열 실패와 독립적으로 성공한다', async () => {
  const { modelSet, observed } = loadHandleModelSet({ failPrepare: true });

  const result = await modelSet(null, {
    provider: 'claude', patch: { model: 'sonnet', effort: 'low' },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(observed.map(([event]) => event), ['log', 'broadcast', 'prepare', 'log']);
  assert.match(observed.at(-1)[1], /backend unavailable/);
});

test('모델 저장 후 provider 회전 실패는 저장 여부와 활성화 실패를 분리한다', async () => {
  const { modelSet, observed } = loadHandleModelSet({
    providerRuntimeEnabled: true, failRotate: true,
  });

  const result = await modelSet(null, {
    provider: 'claude', patch: { model: 'sonnet', effort: 'low' },
  });

  assert.equal(result.ok, false);
  assert.equal(result.persisted, true);
  assert.equal(result.code, 'PROVIDER_ACTIVATION_FAILED');
  assert.match(result.error, /저장했지만.*활성화하지 못했습니다/);
  assert.deepEqual(observed.map(([event]) => event), ['log', 'broadcast', 'prepare', 'rotate', 'log']);
  assert.match(observed.at(-1)[1], /runtime unavailable/);
});

function loadProviderRotationWithDesiredStateFailure() {
  const source = fs.readFileSync(path.join(here, '..', '..', 'main.js'), 'utf8');
  const start = source.indexOf('async function rotatePersistentProviderInner(');
  const end = source.indexOf('function enqueueProviderRotation(', start);
  assert.ok(start >= 0 && end > start, 'provider rotation must remain executable');

  const observed = [];
  let blocked = false;
  const runtime = {
    snapshot: () => ({ state: 'ready', model: 'old-model' }),
    blockNewTurns: (reason) => { blocked = true; observed.push(['block', reason]); },
    sendTurn: async () => {
      observed.push(['send']);
      return blocked ? { ok: false, code: 'PROVIDER_ADMISSION_BLOCKED' } : { ok: true, model: 'old-model' };
    },
  };
  const context = vm.createContext({
    providerRuntimeEnabled: true,
    assertProviderLifecycleOpen: () => {},
    awaitProviderLifecycle: (promise) => promise,
    cliAccounts: { getActiveAccount: async () => ({ accountId: 'claude-1', providerId: 'claude' }) },
    ensureProviderRuntimeController: () => runtime,
    providerEpochStore: {
      publishGeneration: () => ({
        stamp: { epochRevision: 7 },
        dispose: () => observed.push(['dispose']),
      }),
      invalidate: () => observed.push(['invalidate']),
    },
    providerSecurityGeneration: 1,
    resolveProviderDesiredState: async () => {
      observed.push(['resolve']);
      throw new Error('backend endpoint is not initialized');
    },
    providerControllerLifecycle: {
      stopAndDiscard: async (_reason, expected) => {
        assert.equal(expected, runtime);
        observed.push(['stop']);
      },
    },
    providerRuntimeReady: true,
    currentProviderSelection: Object.freeze({
      activeAccount: { accountId: 'claude-1', providerId: 'claude' },
      desiredState: { model: 'old-model' },
      disabled: null,
    }),
    providerVerifierTelemetry: { recordRotationCompletion: () => {} },
  });
  vm.runInContext(source.slice(start, end), context);
  return { rotate: context.rotatePersistentProviderInner, runtime, context, observed };
}

test('desired state 해석 실패는 ready 구모델 runtime을 차단하고 폐기한다', async () => {
  const { rotate, runtime, context, observed } = loadProviderRotationWithDesiredStateFailure();

  await assert.rejects(rotate('model_settings_changed'), /backend endpoint is not initialized/);
  const nextTurn = await runtime.sendTurn();

  assert.equal(nextTurn.ok, false);
  assert.equal(nextTurn.code, 'PROVIDER_ADMISSION_BLOCKED');
  assert.equal(context.providerRuntimeReady, false);
  assert.equal(context.currentProviderSelection.desiredState, null);
  assert.equal(context.currentProviderSelection.disabled.code, 'PROVIDER_ACTIVATION_FAILED');
  assert.deepEqual(observed, [
    ['resolve'],
    ['block', 'provider_activation_failed'],
    ['dispose'],
    ['invalidate'],
    ['stop'],
    ['send'],
  ]);
});
