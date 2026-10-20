import assert from 'node:assert/strict';
import test from 'node:test';

import { TokenSession } from '../src/chatgpt-provider/token-session.mjs';

const CONFIGURATION = Object.freeze({
  tokenEndpoint: 'https://auth.openai.com/api/accounts/oauth/token',
  revocationEndpoint: 'https://auth.openai.com/api/accounts/oauth/revoke',
});

function jsonResponse(value, ok = true) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    ok,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

function createSession({
  fetchImpl = async () => { throw new Error('unexpected fetch'); },
  verifier = { verify: async () => ({ issuer: 'https://auth.openai.com', sub: 'subject-1' }) },
  now = () => 1_000_000,
  expiresAt = 2_000_000,
  accessTokenValue = 'access-secret',
  refreshTokenValue = 'refresh-secret',
  refreshDeadlineMs = 15_000,
  revokeDeadlineMs = 15_000,
} = {}) {
  return new TokenSession({
    fetchImpl,
    openIdVerifier: verifier,
    configuration: CONFIGURATION,
    issuedClientId: 'oaiapp_athena',
    issuer: 'https://auth.openai.com',
    subject: 'subject-1',
    accountBindingSha256: 'a'.repeat(64),
    accessTokenValue,
    refreshTokenValue,
    scope: 'openid chatgpt.tokens.use.direct',
    nonce: 'nonce-value',
    expiresAt,
    now,
    refreshDeadlineMs,
    revokeDeadlineMs,
  });
}

test('returns an unexpired RAM access token without transport work', async () => {
  const session = createSession();
  assert.equal(session.active, true);
  assert.equal(await session.accessToken(), 'access-secret');
});

test('refresh sends the exact client-bound form and accepts the minimal two-token response', async () => {
  let request;
  let now = 1_000_000;
  const session = createSession({
    expiresAt: now,
    now: () => now,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({
        access_token: 'replacement-access',
        refresh_token: 'replacement-refresh',
        earliest_refresh_at: { ignored: true },
      });
    },
  });
  assert.equal(await session.accessToken(), 'replacement-access');
  assert.equal(request.url, CONFIGURATION.tokenEndpoint);
  assert.equal(request.options.method, 'POST');
  assert.deepEqual([...new URLSearchParams(request.options.body)], [
    ['grant_type', 'refresh_token'],
    ['client_id', 'oaiapp_athena'],
    ['refresh_token', 'refresh-secret'],
    ['resource', 'https://api.openai.com/v1'],
  ]);
  now += 54 * 60 * 1_000;
  assert.equal(await session.accessToken(), 'replacement-access');
});

test('allows same-byte token rotation and validates optional refresh security fields', async () => {
  let verifyOptions;
  const session = createSession({
    expiresAt: 0,
    accessTokenValue: 'same-access',
    refreshTokenValue: 'same-refresh',
    fetchImpl: async () => jsonResponse({
      access_token: 'same-access',
      refresh_token: 'same-refresh',
      token_type: 'Bearer',
      scope: 'openid chatgpt.tokens.use.direct',
      expires_in: 60,
      id_token: 'signed-id-token',
      earliest_refresh_at: Number.MAX_SAFE_INTEGER,
    }),
    verifier: {
      verify: async (token, options) => {
        assert.equal(token, 'signed-id-token');
        verifyOptions = options;
        return { issuer: 'https://auth.openai.com', sub: 'subject-1' };
      },
    },
  });
  assert.equal(await session.accessToken(), 'same-access');
  assert.equal(verifyOptions.clientId, 'oaiapp_athena');
  assert.equal(verifyOptions.nonce, 'nonce-value');
  assert.equal(verifyOptions.allowMissingNonce, true);
});

test('contradictory optional refresh fields invalidate the generation without leaking payloads', async () => {
  const canary = 'provider-private-canary';
  const cases = [
    { token_type: 'bearer' },
    { scope: 'openid profile' },
    { expires_in: 0 },
  ];
  for (const extra of cases) {
    const session = createSession({
      expiresAt: 0,
      fetchImpl: async () => jsonResponse({
        access_token: 'next-access',
        refresh_token: 'next-refresh',
        detail: canary,
        ...extra,
      }),
    });
    const error = await session.accessToken().catch((value) => value);
    assert.equal(error.code, 'OPENAI_TOKEN_RESPONSE_INVALID');
    assert.equal(error.message.includes(canary), false);
    assert.equal(session.active, false);
    await assert.rejects(session.accessToken(), { code: 'OPENAI_TOKEN_LOGIN_REQUIRED' });
  }
});

test('one shared refresh serves waiters and aborting one caller does not cancel it', async () => {
  let resolveFetch;
  let calls = 0;
  const session = createSession({
    expiresAt: 0,
    fetchImpl: async () => {
      calls += 1;
      return new Promise((resolve) => { resolveFetch = resolve; });
    },
  });
  const caller = new AbortController();
  const abandoned = session.accessToken({ signal: caller.signal });
  const retained = session.accessToken();
  caller.abort();
  await assert.rejects(abandoned, { code: 'OPENAI_TOKEN_CANCELLED' });
  resolveFetch(jsonResponse({ access_token: 'shared-access', refresh_token: 'shared-refresh' }));
  assert.equal(await retained, 'shared-access');
  assert.equal(calls, 1);
  assert.equal(session.active, true);
});

test('idle disconnect revokes the captured refresh token and pre-abort cancels only its waiter', async () => {
  let body;
  const session = createSession({
    fetchImpl: async (url, options) => {
      assert.equal(url, CONFIGURATION.revocationEndpoint);
      body = [...new URLSearchParams(options.body)];
      return { ok: true };
    },
  });
  assert.equal(await session.disconnect(), 'revoked');
  assert.deepEqual(body, [
    ['token', 'refresh-secret'],
    ['token_type_hint', 'refresh_token'],
    ['client_id', 'oaiapp_athena'],
  ]);
  assert.equal(session.active, false);

  const preAborted = new AbortController();
  preAborted.abort();
  let revokeCalls = 0;
  let releaseRevoke;
  const second = createSession({
    fetchImpl: async () => {
      revokeCalls += 1;
      return new Promise((resolve) => { releaseRevoke = resolve; });
    },
  });
  await assert.rejects(second.disconnect({ signal: preAborted.signal }), {
    code: 'OPENAI_TOKEN_CANCELLED',
  });
  assert.equal(second.active, false);
  assert.equal(revokeCalls, 1);
  const sharedResult = second.disconnect();
  releaseRevoke({ ok: true });
  assert.equal(await sharedResult, 'revoked');
  await assert.rejects(second.accessToken(), { code: 'OPENAI_TOKEN_LOGIN_REQUIRED' });
});

test('disconnect during refresh aborts work, does not guess a rotated token, and blocks late publication', async () => {
  let fetchSignal;
  let resolveFetch;
  let calls = 0;
  const session = createSession({
    expiresAt: 0,
    fetchImpl: async (url, options) => {
      calls += 1;
      fetchSignal = options.signal;
      return new Promise((resolve) => { resolveFetch = resolve; });
    },
  });
  const pending = session.accessToken();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await session.disconnect(), 'revocation-unconfirmed');
  assert.equal(fetchSignal.aborted, true);
  resolveFetch(jsonResponse({ access_token: 'late-access', refresh_token: 'late-refresh' }));
  await assert.rejects(pending);
  assert.equal(calls, 1);
  assert.equal(session.active, false);
  await assert.rejects(session.accessToken(), { code: 'OPENAI_TOKEN_LOGIN_REQUIRED' });
});

test('refresh deadlines invalidate non-cooperative transport and shutdown drops references', async () => {
  const session = createSession({
    expiresAt: 0,
    refreshDeadlineMs: 10,
    fetchImpl: async () => new Promise(() => {}),
  });
  await assert.rejects(session.accessToken(), { code: 'OPENAI_TOKEN_REFRESH_DEADLINE_EXCEEDED' });
  assert.equal(session.active, false);

  const second = createSession();
  second.shutdown();
  assert.equal(second.active, false);
  await assert.rejects(second.accessToken(), { code: 'OPENAI_TOKEN_LOGIN_REQUIRED' });
});

test('refresh deadline cancels a non-cooperative response reader and rejects stale late bytes', async () => {
  let cancelCalls = 0;
  let releaseCalls = 0;
  let resolveRead;
  const session = createSession({
    expiresAt: 0,
    refreshDeadlineMs: 10,
    fetchImpl: async () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: () => new Promise((resolve) => { resolveRead = resolve; }),
          cancel: () => { cancelCalls += 1; },
          releaseLock: () => { releaseCalls += 1; },
        }),
      },
    }),
  });
  await assert.rejects(session.accessToken(), {
    code: 'OPENAI_TOKEN_REFRESH_DEADLINE_EXCEEDED',
  });
  resolveRead({
    done: false,
    value: new TextEncoder().encode(JSON.stringify({
      access_token: 'late-access', refresh_token: 'late-refresh',
    })),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelCalls, 1);
  assert.equal(releaseCalls, 1);
  assert.equal(session.active, false);
});

test('refresh rejects non-streaming and oversized bodies before parsing or publication', async () => {
  const nonStreaming = createSession({
    expiresAt: 0,
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({
        access_token: 'must-not-buffer', refresh_token: 'must-not-buffer',
      }),
    }),
  });
  await assert.rejects(nonStreaming.accessToken(), { code: 'OPENAI_TOKEN_RESPONSE_INVALID' });
  assert.equal(nonStreaming.active, false);

  const oversized = createSession({
    expiresAt: 0,
    fetchImpl: async () => ({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(64 * 1_024 + 1));
          controller.close();
        },
      }),
    }),
  });
  await assert.rejects(oversized.accessToken(), { code: 'OPENAI_TOKEN_RESPONSE_INVALID' });
  assert.equal(oversized.active, false);
});

