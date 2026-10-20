import assert from 'node:assert/strict';
import test from 'node:test';

import { FINANCIAL_ERROR_MESSAGES } from '../../contracts/wts-foundation.mjs';
import { FinancialBackendSupervisorError } from '../src/financial-backend-supervisor.mjs';
import { FinancialSourceBridge } from '../src/financial-source-bridge.mjs';

test('financial bridge forwards only the frozen methods without retaining payloads', async () => {
  const calls = [];
  const bridge = new FinancialSourceBridge({
    async request(method, payload, options) {
      calls.push({ method, payload, signal: options.signal });
      return { job: { state: 'queued' } };
    },
  });
  const params = {
    submissionId: '11111111-1111-4111-8111-111111111111',
    profileId: '22222222-2222-4222-8222-222222222222',
    operationRef: 'base:ka10001',
    arguments: { stk_cd: '005930' },
  };
  const controller = new AbortController();
  assert.deepEqual(
    await bridge.execute('source.query.start', params, { signal: controller.signal }),
    { job: { state: 'queued' } },
  );
  assert.deepEqual(calls, [{
    method: 'source.query.start', payload: params, signal: controller.signal,
  }]);
  await assert.rejects(bridge.execute('source.proxy', {}), {
    code: 'REQUEST_INVALID',
    message: FINANCIAL_ERROR_MESSAGES.REQUEST_INVALID,
  });
});

test('financial bridge exposes only constant allowlisted failures', async () => {
  const bridge = new FinancialSourceBridge({
    async request() {
      throw new FinancialBackendSupervisorError('FINANCIAL_BACKEND_STARTING');
    },
  });
  await assert.rejects(bridge.execute('source.credentials.status', { mutationId: null }), {
    code: 'FINANCIAL_BACKEND_STARTING',
    message: FINANCIAL_ERROR_MESSAGES.FINANCIAL_BACKEND_STARTING,
  });

  const opaque = new FinancialSourceBridge({
    async request() {
      throw new Error('secret=value http://127.0.0.1:4567');
    },
  });
  await assert.rejects(opaque.execute('source.credentials.status', { mutationId: null }), (error) => {
    assert.equal(error.code, 'INTERNAL_ERROR');
    assert.equal(error.message, FINANCIAL_ERROR_MESSAGES.INTERNAL_ERROR);
    assert.doesNotMatch(`${error.message}`, /secret|127\.0\.0\.1/u);
    return true;
  });

  for (const code of ['VAULT_UNAVAILABLE', 'CREDENTIAL_MUTATION_NOT_FOUND']) {
    const recovery = new FinancialSourceBridge({
      async request() {
        throw new FinancialBackendSupervisorError(code);
      },
    });
    await assert.rejects(
      recovery.execute('source.credentials.status', { mutationId: null }),
      { code, message: FINANCIAL_ERROR_MESSAGES[code] },
    );
  }
});
