import assert from 'node:assert/strict';
import {
  constants as cryptoConstants,
  createHash,
  generateKeyPairSync,
  sign as signBytes,
} from 'node:crypto';
import { request } from 'node:http';
import test from 'node:test';

import { OAuthSession } from '../src/chatgpt-provider/oauth-session.mjs';
import {
  OPENAI_OIDC_DISCOVERY_URL,
  OPENAI_OIDC_JWKS_URI,
  OpenIdVerifier,
} from '../src/chatgpt-provider/openid-verifier.mjs';

const CONFIGURATION = Object.freeze({
  issuer: 'https://auth.openai.com',
  authorizationEndpoint: 'https://auth.openai.com/api/accounts/authorize',
  tokenEndpoint: 'https://auth.openai.com/api/accounts/oauth/token',
  revocationEndpoint: 'https://auth.openai.com/api/accounts/oauth/revoke',
  jwksUri: 'https://auth.openai.com/.well-known/jwks.json',
});
const HOST_ID = 'urn:uuid:123e4567-e89b-42d3-a456-426614174000';

function metadata({ registered = false, binding = null } = {}) {
  return {
    version: 1,
    hostId: HOST_ID,
    issuedClientId: registered ? 'oaiapp_athena' : null,
    accountBindingSha256: registered ? binding : null,
  };
}

function bindingFor(sub = 'subject-1') {
  return createHash('sha256')
    .update(JSON.stringify([CONFIGURATION.issuer, 'oaiapp_athena', sub]), 'utf8')
    .digest('hex');
}

function tokenResponse(overrides = {}) {
  return streamJsonResponse({
    access_token: 'initial-access-secret',
    refresh_token: 'initial-refresh-secret',
    id_token: 'signed-id-token',
    token_type: 'Bearer',
    expires_in: 3_600,
    scope: 'openid profile chatgpt.tokens.use.direct',
    ...overrides,
  });
}

function streamJsonResponse(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'application/json' : null },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

function sendCallback(redirectUri, query, options = {}) {
  const target = new URL(redirectUri);
  const path = options.path ?? `${target.pathname}?${query}`;
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: target.port,
      method: options.method ?? 'GET',
      path,
      headers: {
        Host: options.host ?? `127.0.0.1:${target.port}`,
        ...(options.headers ?? {}),
      },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function fixture({
  registration = metadata(),
  fetchImpl,
  openBrowser,
  verify,
  bind,
  tokenSessionFactory,
  attemptDeadlineMs = 10_000,
  exchangeDeadlineMs = 10_000,
} = {}) {
  const events = [];
  const store = {
    ensureHost: async () => { events.push('ensure'); return registration; },
    bind: bind ?? (async (value) => { events.push(['bind', value]); return { ...registration, ...value }; }),
  };
  const verifier = {
    getConfiguration: async () => { events.push('discovery'); return CONFIGURATION; },
    verify: verify ?? (async (token, options) => {
      events.push(['verify', token, options]);
      return { issuer: CONFIGURATION.issuer, sub: 'subject-1' };
    }),
  };
  const oauth = new OAuthSession({
    registrationStore: store,
    openIdVerifier: verifier,
    fetchImpl: fetchImpl ?? (async () => tokenResponse()),
    openBrowser,
    tokenSessionFactory: tokenSessionFactory ?? ((options) => {
      events.push(['activate', options]);
      return { kind: 'token-session' };
    }),
    attemptDeadlineMs,
    exchangeDeadlineMs,
  });
  return { oauth, events };
}

test('legacy host registration fails closed with safe remediation before browser use', async () => {
  let browserCalls = 0;
  const legacy = Buffer.alloc(32, 0x68).toString('base64url');
  const { oauth } = fixture({
    registration: { ...metadata(), hostId: legacy },
    openBrowser: async () => { browserCalls += 1; },
  });
  const error = await oauth.connect().catch((value) => value);
  assert.equal(error.code, 'OPENAI_OAUTH_REGISTRATION_HOST_ID_UNSUPPORTED');
  assert.match(error.message, /자동 변환할 수 없습니다/u);
  assert.equal(browserCalls, 0);
});

test('initial OAuth binds before browser use and emits exact authorization and exchange fields', async () => {
  let authorization;
  let exchange;
  const { oauth, events } = fixture({
    openBrowser: async (url) => {
      authorization = new URL(url);
      const redirectUri = authorization.searchParams.get('redirect_uri');
      const state = authorization.searchParams.get('state');
      assert.equal(await sendCallback(
        redirectUri,
        new URLSearchParams({ state, code: 'one-use-code', client_id: 'oaiapp_athena' }),
      ), 200);
    },
    fetchImpl: async (url, options) => {
      exchange = { url, options };
      return tokenResponse({ earliest_refresh_at: 'ignored' });
    },
  });
  assert.deepEqual(await oauth.connect(), { kind: 'token-session' });
  assert.equal(authorization.origin + authorization.pathname, CONFIGURATION.authorizationEndpoint);
  assert.equal(authorization.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(authorization.searchParams.get('agent_name_hint'), 'ATHENA');
  assert.equal(authorization.searchParams.get('ext_agent_host_id'), HOST_ID);
  assert.equal(authorization.searchParams.get('response_type'), 'code');
  assert.equal(authorization.searchParams.get('resource'), 'https://api.openai.com/v1');
  assert.equal(authorization.searchParams.get('scope'),
    'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct');
  assert.match(authorization.searchParams.get('state'), /^[A-Za-z0-9_-]{43}$/u);
  assert.match(authorization.searchParams.get('nonce'), /^[A-Za-z0-9_-]{43}$/u);
  assert.match(authorization.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(exchange.url, CONFIGURATION.tokenEndpoint);
  const form = [...new URLSearchParams(exchange.options.body)];
  assert.deepEqual(form.map(([name]) => name), [
    'grant_type', 'client_id', 'code', 'code_verifier', 'redirect_uri', 'resource',
  ]);
  assert.deepEqual(Object.fromEntries(form), {
    grant_type: 'authorization_code',
    client_id: 'oaiapp_athena',
    code: 'one-use-code',
    code_verifier: Object.fromEntries(form).code_verifier,
    redirect_uri: authorization.searchParams.get('redirect_uri'),
    resource: 'https://api.openai.com/v1',
  });
  assert.match(Object.fromEntries(form).code_verifier, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(events.findIndex((event) => Array.isArray(event) && event[0] === 'bind')
    < events.findIndex((event) => Array.isArray(event) && event[0] === 'activate'), true);
  const verifyEvent = events.find((event) => Array.isArray(event) && event[0] === 'verify');
  assert.equal(verifyEvent[2].clientId, 'oaiapp_athena');
  assert.equal(verifyEvent[2].nonce, authorization.searchParams.get('nonce'));
  assert.equal(verifyEvent[2].allowMissingNonce, false);
});

test('reauthorization uses the saved client, omits the agent hint, and permits omitted callback client_id', async () => {
  let authorization;
  const { oauth, events } = fixture({
    registration: metadata({ registered: true, binding: bindingFor() }),
    openBrowser: async (url) => {
      authorization = new URL(url);
      const state = authorization.searchParams.get('state');
      assert.equal(await sendCallback(
        authorization.searchParams.get('redirect_uri'),
        new URLSearchParams({ state, code: 'reauth-code' }),
      ), 200);
    },
  });
  await oauth.connect();
  assert.equal(authorization.searchParams.get('client_id'), 'oaiapp_athena');
  assert.equal(authorization.searchParams.has('agent_name_hint'), false);
  const bindEvent = events.find((event) => Array.isArray(event) && event[0] === 'bind');
  assert.equal(bindEvent[1].accountBindingSha256, bindingFor());
});

test('wrong, missing and duplicate state are non-consuming, as are wrong Host, path and body', async () => {
  const statuses = [];
  const { oauth } = fixture({
    openBrowser: async (url) => {
      const authorization = new URL(url);
      const redirect = authorization.searchParams.get('redirect_uri');
      const state = authorization.searchParams.get('state');
      statuses.push(await sendCallback(redirect, new URLSearchParams({ code: 'x' })));
      statuses.push(await sendCallback(redirect,
        new URLSearchParams({ state: 'x'.repeat(43), code: 'x', client_id: 'oaiapp_athena' })));
      statuses.push(await sendCallback(redirect,
        `state=${state}&state=${state}&code=x&client_id=oaiapp_athena`));
      statuses.push(await sendCallback(redirect,
        new URLSearchParams({ state, code: 'x', client_id: 'oaiapp_athena' }),
        { host: 'localhost' }));
      statuses.push(await sendCallback(redirect,
        new URLSearchParams({ state, code: 'x', client_id: 'oaiapp_athena' }),
        { path: `/wrong?state=${state}` }));
      statuses.push(await sendCallback(redirect,
        new URLSearchParams({ state, code: 'x', client_id: 'oaiapp_athena' }),
        { body: 'x', headers: { 'Content-Length': '1' } }));
      statuses.push(await sendCallback(redirect,
        new URLSearchParams({ state, code: 'accepted', client_id: 'oaiapp_athena' })));
    },
  });
  await oauth.connect();
  assert.deepEqual(statuses, [400, 400, 400, 400, 404, 400, 200]);
});

test('a matching state consumes malformed tuples, provider denial, and client mismatch', async () => {
  const cases = [
    (state) => `state=${state}&code=a&code=b&client_id=oaiapp_athena`,
    (state) => new URLSearchParams({ state, error: 'access_denied' }).toString(),
    (state) => new URLSearchParams({ state, code: 'x', client_id: 'oaiapp_other' }).toString(),
  ];
  const expectedCodes = [
    'OPENAI_OAUTH_CALLBACK_INVALID',
    'OPENAI_OAUTH_PROVIDER_DENIED',
    'OPENAI_OAUTH_CLIENT_ID_MISMATCH',
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const registered = index === 2;
    const { oauth } = fixture({
      registration: registered
        ? metadata({ registered: true, binding: bindingFor() })
        : metadata(),
      openBrowser: async (url) => {
        const authorization = new URL(url);
        assert.equal(await sendCallback(
          authorization.searchParams.get('redirect_uri'),
          cases[index](authorization.searchParams.get('state')),
        ), 400);
      },
    });
    await assert.rejects(oauth.connect(), { code: expectedCodes[index] });
  }
});

test('returning identity mismatch cannot bind or activate a token session', async () => {
  let bindCalls = 0;
  let activationCalls = 0;
  const { oauth } = fixture({
    registration: metadata({ registered: true, binding: bindingFor('expected-subject') }),
    openBrowser: async (url) => {
      const authorization = new URL(url);
      await sendCallback(
        authorization.searchParams.get('redirect_uri'),
        new URLSearchParams({ state: authorization.searchParams.get('state'), code: 'x' }),
      );
    },
    bind: async () => { bindCalls += 1; },
    tokenSessionFactory: () => { activationCalls += 1; return {}; },
  });
  await assert.rejects(oauth.connect(), { code: 'OPENAI_OAUTH_ACCOUNT_MISMATCH' });
  assert.equal(bindCalls, 0);
  assert.equal(activationCalls, 0);
});

test('cancellation during a bounded metadata bind waits for its outcome and suppresses activation', async () => {
  let releaseBind;
  let bindStarted;
  const started = new Promise((resolve) => { bindStarted = resolve; });
  let activationCalls = 0;
  const { oauth } = fixture({
    openBrowser: async (url) => {
      const authorization = new URL(url);
      await sendCallback(
        authorization.searchParams.get('redirect_uri'),
        new URLSearchParams({
          state: authorization.searchParams.get('state'),
          code: 'x',
          client_id: 'oaiapp_athena',
        }),
      );
    },
    bind: async () => {
      bindStarted();
      return new Promise((resolve) => { releaseBind = resolve; });
    },
    tokenSessionFactory: () => { activationCalls += 1; return {}; },
  });
  const pending = oauth.connect();
  await started;
  assert.equal(oauth.cancel(), true);
  releaseBind();
  await assert.rejects(pending, { code: 'OPENAI_OAUTH_CANCELLED' });
  assert.equal(activationCalls, 0);
  assert.equal(oauth.active, false);
});

test('attempt and exchange deadlines bound non-cooperative work and fixed errors redact secrets', async () => {
  const browserCanary = 'browser-private-canary';
  const first = fixture({
    openBrowser: async () => new Promise(() => {}),
    attemptDeadlineMs: 10,
  }).oauth;
  await assert.rejects(first.connect(), { code: 'OPENAI_OAUTH_DEADLINE_EXCEEDED' });

  const second = fixture({
    openBrowser: async (url) => {
      const authorization = new URL(url);
      await sendCallback(
        authorization.searchParams.get('redirect_uri'),
        new URLSearchParams({
          state: authorization.searchParams.get('state'),
          code: browserCanary,
          client_id: 'oaiapp_athena',
        }),
      );
    },
    fetchImpl: async () => new Promise(() => {}),
    exchangeDeadlineMs: 10,
  }).oauth;
  const error = await second.connect().catch((value) => value);
  assert.equal(error.code, 'OPENAI_OAUTH_EXCHANGE_DEADLINE_EXCEEDED');
  assert.equal(error.message.includes(browserCanary), false);
});

test('token exchange rejects a non-streaming response instead of buffering response.text()', async () => {
  const { oauth } = fixture({
    openBrowser: async (url) => {
      const authorization = new URL(url);
      await sendCallback(
        authorization.searchParams.get('redirect_uri'),
        new URLSearchParams({
          state: authorization.searchParams.get('state'),
          code: 'one-use-code',
          client_id: 'oaiapp_athena',
        }),
      );
    },
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({ access_token: 'must-not-buffer' }),
    }),
  });
  await assert.rejects(oauth.connect(), { code: 'OPENAI_OAUTH_TOKEN_RESPONSE_INVALID' });
});

test('real OpenIdVerifier accepts the signed offline identity through the complete callback flow', async () => {
  const now = 1_800_000_000_000;
  const nowSeconds = Math.floor(now / 1_000);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2_048 });
  const publicJwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'oauth-integration-key',
    alg: 'RS256',
    use: 'sig',
    key_ops: ['verify'],
  };
  let nonce;
  const signIdToken = () => {
    const header = Buffer.from(JSON.stringify({
      alg: 'RS256', kid: publicJwk.kid, typ: 'JWT',
    })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({
      iss: CONFIGURATION.issuer,
      aud: 'oaiapp_athena',
      sub: 'offline-integration-subject',
      iat: nowSeconds - 5,
      exp: nowSeconds + 300,
      nonce,
    })).toString('base64url');
    const input = `${header}.${claims}`;
    const signature = signBytes(
      'RSA-SHA256',
      Buffer.from(input, 'ascii'),
      { key: privateKey, padding: cryptoConstants.RSA_PKCS1_PADDING },
    ).toString('base64url');
    return `${input}.${signature}`;
  };
  const discovery = {
    issuer: CONFIGURATION.issuer,
    authorization_endpoint: CONFIGURATION.authorizationEndpoint,
    token_endpoint: CONFIGURATION.tokenEndpoint,
    revocation_endpoint: CONFIGURATION.revocationEndpoint,
    jwks_uri: CONFIGURATION.jwksUri,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    id_token_signing_alg_values_supported: ['RS256'],
  };
  const fetchImpl = async (url) => {
    if (url === OPENAI_OIDC_DISCOVERY_URL) return streamJsonResponse(discovery);
    if (url === OPENAI_OIDC_JWKS_URI) return streamJsonResponse({ keys: [publicJwk] });
    if (url === CONFIGURATION.tokenEndpoint) {
      return tokenResponse({ id_token: signIdToken() });
    }
    throw new Error('unexpected URL');
  };
  const verifier = new OpenIdVerifier({ fetchImpl, now: () => now });
  let bound;
  const oauth = new OAuthSession({
    registrationStore: {
      ensureHost: async () => metadata(),
      bind: async (value) => { bound = value; return { ...metadata(), ...value }; },
    },
    openIdVerifier: verifier,
    fetchImpl,
    openBrowser: async (url) => {
      const authorization = new URL(url);
      nonce = authorization.searchParams.get('nonce');
      await sendCallback(
        authorization.searchParams.get('redirect_uri'),
        new URLSearchParams({
          state: authorization.searchParams.get('state'),
          code: 'offline-code',
          client_id: 'oaiapp_athena',
        }),
      );
    },
    now: () => now,
  });
  const session = await oauth.connect();
  assert.equal(session.active, true);
  assert.equal(await session.accessToken(), 'initial-access-secret');
  assert.equal(bound.issuedClientId, 'oaiapp_athena');
  assert.equal(bound.accountBindingSha256, bindingFor('offline-integration-subject'));
  session.shutdown();
});

