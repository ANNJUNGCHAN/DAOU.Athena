import assert from 'node:assert/strict';
import {
  constants as cryptoConstants,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
} from 'node:crypto';
import test from 'node:test';

import {
  MAX_OIDC_CLAIMS_BYTES,
  MAX_OIDC_DISCOVERY_BYTES,
  OPENAI_OIDC_AUTHORIZATION_ENDPOINT,
  OPENAI_OIDC_DISCOVERY_URL,
  OPENAI_OIDC_ISSUER,
  OPENAI_OIDC_JWKS_URI,
  OPENAI_OIDC_REVOCATION_ENDPOINT,
  OPENAI_OIDC_TOKEN_ENDPOINT,
  OpenIdVerifier,
} from '../src/chatgpt-provider/openid-verifier.mjs';

const encoder = new TextEncoder();
const CLIENT_ID = 'oaiapp_athena_fixture';
const NONCE = 'nonce-fixture-value';
const NOW_MS = 1_800_000_000_000;
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

function keyFixture(kid = 'fixture-key', modulusLength = 2048) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength });
  return {
    kid,
    privateKey,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig', key_ops: ['verify'] },
  };
}

function discovery(overrides = {}) {
  return {
    issuer: OPENAI_OIDC_ISSUER,
    authorization_endpoint: OPENAI_OIDC_AUTHORIZATION_ENDPOINT,
    token_endpoint: OPENAI_OIDC_TOKEN_ENDPOINT,
    revocation_endpoint: OPENAI_OIDC_REVOCATION_ENDPOINT,
    jwks_uri: OPENAI_OIDC_JWKS_URI,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    id_token_signing_alg_values_supported: ['RS256'],
    ...overrides,
  };
}

function claims(overrides = {}) {
  return {
    iss: OPENAI_OIDC_ISSUER,
    aud: CLIENT_ID,
    sub: 'user-fixture',
    iat: NOW_SECONDS - 10,
    exp: NOW_SECONDS + 300,
    nonce: NONCE,
    ...overrides,
  };
}

function b64(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return Buffer.from(bytes).toString('base64url');
}

function jwtRaw(key, headerText, claimsBytesOrText, { signature } = {}) {
  const header = b64(headerText);
  const payload = b64(claimsBytesOrText);
  const signingInput = `${header}.${payload}`;
  const signed = signature ?? signBytes(
    'RSA-SHA256',
    Buffer.from(signingInput, 'ascii'),
    { key: key.privateKey, padding: cryptoConstants.RSA_PKCS1_PADDING },
  );
  return `${signingInput}.${b64(signed)}`;
}

function jwt(key, claimValue = claims(), headerValue = { alg: 'RS256', kid: key.kid, typ: 'JWT' }) {
  return jwtRaw(key, JSON.stringify(headerValue), JSON.stringify(claimValue));
}

function jsonResponse(value, { status = 200, chunks, contentType = 'application/json; charset=utf-8' } = {}) {
  const wire = typeof value === 'string' || value instanceof Uint8Array
    ? (typeof value === 'string' ? encoder.encode(value) : value)
    : encoder.encode(JSON.stringify(value));
  const bodyChunks = chunks ?? [wire];
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? contentType : null },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of bodyChunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  };
}

function fakeFetch({ discoveryValues = [discovery()], jwksValues = [], calls = [] } = {}) {
  let discoveryIndex = 0;
  let jwksIndex = 0;
  return async (url, options) => {
    calls.push({ url, options });
    if (url === OPENAI_OIDC_DISCOVERY_URL) {
      const value = discoveryValues[Math.min(discoveryIndex, discoveryValues.length - 1)];
      discoveryIndex += 1;
      return value?.response ?? jsonResponse(value);
    }
    if (url === OPENAI_OIDC_JWKS_URI) {
      const value = jwksValues[Math.min(jwksIndex, jwksValues.length - 1)];
      jwksIndex += 1;
      return value?.response ?? jsonResponse(value);
    }
    throw new Error('unexpected URL');
  };
}

function verifier(fetchImpl, overrides = {}) {
  return new OpenIdVerifier({ fetchImpl, now: () => NOW_MS, ...overrides });
}

test('fetches only fixed discovery/JWKS URLs and returns frozen minimal results', async () => {
  const key = keyFixture();
  const calls = [];
  const instance = verifier(fakeFetch({ jwksValues: [{ keys: [key.jwk] }], calls }));
  const configuration = await instance.getConfiguration();
  assert.deepEqual(configuration, {
    issuer: OPENAI_OIDC_ISSUER,
    authorizationEndpoint: OPENAI_OIDC_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: OPENAI_OIDC_TOKEN_ENDPOINT,
    revocationEndpoint: OPENAI_OIDC_REVOCATION_ENDPOINT,
    jwksUri: OPENAI_OIDC_JWKS_URI,
  });
  assert.equal(Object.isFrozen(configuration), true);
  const identity = await instance.verify(jwt(key), { clientId: CLIENT_ID, nonce: NONCE });
  assert.deepEqual(identity, { issuer: OPENAI_OIDC_ISSUER, sub: 'user-fixture' });
  assert.equal(Object.isFrozen(identity), true);
  assert.deepEqual(calls.map((call) => call.url), [OPENAI_OIDC_DISCOVERY_URL, OPENAI_OIDC_JWKS_URI]);
  for (const call of calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'error');
    assert.deepEqual(call.options.headers, { Accept: 'application/json' });
  }
});

test('validates exact discovery endpoints and required capabilities before caching', async () => {
  const cases = [
    { issuer: 'https://attacker.invalid' },
    { authorization_endpoint: `${OPENAI_OIDC_AUTHORIZATION_ENDPOINT}/alternate` },
    { token_endpoint: 'https://attacker.invalid/token' },
    { revocation_endpoint: 'https://attacker.invalid/revoke' },
    { jwks_uri: 'https://attacker.invalid/jwks' },
    { response_types_supported: ['token'] },
    { code_challenge_methods_supported: ['plain'] },
    { grant_types_supported: ['authorization_code'] },
    { id_token_signing_alg_values_supported: ['HS256'] },
  ];
  for (const changed of cases) {
    await assert.rejects(
      verifier(fakeFetch({ discoveryValues: [discovery(changed)] })).getConfiguration(),
      { code: 'OPENAI_OIDC_DISCOVERY_INVALID' },
    );
  }
});

test('accepts the public JWKS field shape with optional x5c metadata and verifies its RSA signature', async () => {
  const key = keyFixture();
  const { key_ops, ...publicShape } = key.jwk;
  const metadata = Buffer.from('unused certificate metadata').toString('base64');
  const keys = [
    { ...publicShape, x5c: [metadata] },
    { ...publicShape, kid: 'second', x5c: [metadata] },
    { ...publicShape, kid: 'third' },
    { ...publicShape, kid: 'fourth' },
  ];
  const calls = [];
  const identity = await verifier(fakeFetch({ jwksValues: [{ keys }], calls }))
    .verify(jwt(key), { clientId: CLIENT_ID, nonce: NONCE });
  assert.deepEqual(identity, { issuer: OPENAI_OIDC_ISSUER, sub: 'user-fixture' });
  assert.deepEqual(calls.map(({ url }) => url), [OPENAI_OIDC_DISCOVERY_URL, OPENAI_OIDC_JWKS_URI]);
});

test('x5c metadata cannot replace the RSA modulus and exponent or supply a JWT header key', async () => {
  const key = keyFixture();
  const other = keyFixture(key.kid);
  const otherKeyMetadata = createPublicKey(other.privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
  const jwk = { ...key.jwk, x5c: [otherKeyMetadata] };
  const calls = [];
  const instance = verifier(fakeFetch({ jwksValues: [{ keys: [jwk] }], calls }));
  assert.equal((await instance.verify(jwt(key), { clientId: CLIENT_ID, nonce: NONCE })).sub, 'user-fixture');
  await assert.rejects(instance.verify(jwt(other), { clientId: CLIENT_ID, nonce: NONCE }), {
    code: 'OPENAI_OIDC_SIGNATURE_INVALID',
  });
  assert.equal(calls.filter(({ url }) => url === OPENAI_OIDC_JWKS_URI).length, 1);
  await assert.rejects(instance.verify(jwt(key, claims(), { alg: 'RS256', kid: key.kid, x5c: ['AA=='] }), {
    clientId: CLIENT_ID, nonce: NONCE,
  }), { code: 'OPENAI_OIDC_HEADER_INVALID' });
  assert.equal(calls.length, 2);

  await assert.rejects(verifier(fakeFetch({ jwksValues: [{ keys: [{ ...jwk, n: other.jwk.n, e: other.jwk.e }] }] }))
    .verify(jwt(key), { clientId: CLIENT_ID, nonce: NONCE }), { code: 'OPENAI_OIDC_SIGNATURE_INVALID' });
});

test('x5c metadata is canonical base64 with bounded entries, item bytes, JWK bytes and JWKS bytes', async () => {
  const key = keyFixture();
  const maxEntry = Buffer.alloc(8 * 1024, 0x30).toString('base64');
  for (const x5c of [[maxEntry], Array(5).fill('AA==')]) {
    assert.equal((await verifier(fakeFetch({ jwksValues: [{ keys: [{ ...key.jwk, x5c }] }] }))
      .verify(jwt(key), { clientId: CLIENT_ID, nonce: NONCE })).sub, 'user-fixture');
  }
  const cases = [
    null, 'AA==', {}, [], [null], [1], [{}], [''], ['AA'], ['AB=='], ['AA==='],
    ['AA==\n'], ['__8='], ['https://attacker.invalid/cert'], Array(6).fill('AA=='),
    [Buffer.alloc((8 * 1024) + 1).toString('base64')], [maxEntry, maxEntry],
  ];
  for (const x5c of cases) {
    await assert.rejects(verifier(fakeFetch({ jwksValues: [{ keys: [{ ...key.jwk, x5c }] }] }))
      .verify(jwt(key), { clientId: CLIENT_ID, nonce: NONCE }), { code: 'OPENAI_OIDC_JWKS_INVALID' });
  }
  const oversizedJwks = { keys: Array.from({ length: 32 }, (_, index) => ({ ...key.jwk, kid: `key-${index}`, x5c: [maxEntry] })) };
  await assert.rejects(verifier(fakeFetch({ jwksValues: [oversizedJwks] }))
    .verify(jwt(key), { clientId: CLIENT_ID, nonce: NONCE }), { code: 'OPENAI_OIDC_RESPONSE_TOO_LARGE' });
});

test('rejects duplicate JSON keys by decoded names at every depth', async () => {
  const key = keyFixture();
  const headerCases = [
    `{"alg":"RS256","\\u0061lg":"RS256","kid":"${key.kid}"}`,
    `{"alg":"RS256","kid":"${key.kid}","\\u006bid":"${key.kid}"}`,
  ];
  for (const rawHeader of headerCases) {
    let calls = 0;
    const instance = verifier(async () => { calls += 1; throw new Error('must not fetch'); });
    await assert.rejects(
      instance.verify(jwtRaw(key, rawHeader, JSON.stringify(claims())), { clientId: CLIENT_ID, nonce: NONCE }),
      { code: 'OPENAI_OIDC_HEADER_INVALID' },
    );
    assert.equal(calls, 0);
  }

  const claimCases = [
    `{"iss":"${OPENAI_OIDC_ISSUER}","\\u0069ss":"${OPENAI_OIDC_ISSUER}","aud":"${CLIENT_ID}","sub":"x","iat":${NOW_SECONDS},"exp":${NOW_SECONDS + 10},"nonce":"${NONCE}"}`,
    `{"iss":"${OPENAI_OIDC_ISSUER}","aud":"${CLIENT_ID}","\\u0061ud":"${CLIENT_ID}","sub":"x","iat":${NOW_SECONDS},"exp":${NOW_SECONDS + 10},"nonce":"${NONCE}"}`,
    `{"iss":"${OPENAI_OIDC_ISSUER}","aud":"${CLIENT_ID}","sub":"x","iat":${NOW_SECONDS},"exp":${NOW_SECONDS + 10},"nonce":"${NONCE}","\\u006eonce":"${NONCE}"}`,
    `{"iss":"${OPENAI_OIDC_ISSUER}","aud":"${CLIENT_ID}","sub":"x","iat":${NOW_SECONDS},"exp":${NOW_SECONDS + 10},"nonce":"${NONCE}","nested":{"x":1,"\\u0078":2}}`,
  ];
  for (const rawClaims of claimCases) {
    const instance = verifier(fakeFetch({ jwksValues: [{ keys: [key.jwk] }] }));
    await assert.rejects(
      instance.verify(jwtRaw(key, JSON.stringify({ alg: 'RS256', kid: key.kid }), rawClaims), { clientId: CLIENT_ID, nonce: NONCE }),
      { code: 'OPENAI_OIDC_CLAIMS_INVALID' },
    );
  }
});

test('rejects noncanonical segments, invalid UTF-8, excessive depth/key count and bounds', async () => {
  const key = keyFixture();
  const valid = jwt(key);
  await assert.rejects(
    verifier(async () => { throw new Error('must not fetch'); }).verify(`${valid}=`, { clientId: CLIENT_ID, nonce: NONCE }),
    { code: 'OPENAI_OIDC_JWT_INVALID' },
  );
  const invalidUtf8Header = jwtRaw(key, Uint8Array.of(0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d), JSON.stringify(claims()));
  await assert.rejects(
    verifier(async () => { throw new Error('must not fetch'); }).verify(invalidUtf8Header, { clientId: CLIENT_ID, nonce: NONCE }),
    { code: 'OPENAI_OIDC_HEADER_UTF8_INVALID' },
  );
  const invalidUtf8Claims = jwtRaw(
    key,
    JSON.stringify({ alg: 'RS256', kid: key.kid }),
    Uint8Array.of(0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d),
  );
  await assert.rejects(
    verifier(fakeFetch({ jwksValues: [{ keys: [key.jwk] }] }))
      .verify(invalidUtf8Claims, { clientId: CLIENT_ID, nonce: NONCE }),
    { code: 'OPENAI_OIDC_CLAIMS_UTF8_INVALID' },
  );
  let nested = '0';
  for (let i = 0; i < 17; i += 1) nested = `{"x":${nested}}`;
  const deepClaims = jwtRaw(key, JSON.stringify({ alg: 'RS256', kid: key.kid }), nested);
  let acceptedNested = '0';
  for (let i = 0; i < 15; i += 1) acceptedNested = `{"x":${acceptedNested}}`;
  const baseClaims = JSON.stringify(claims());
  const boundaryClaims = `${baseClaims.slice(0, -1)},"nested":${acceptedNested}}`;
  assert.equal((await verifier(fakeFetch({ jwksValues: [{ keys: [key.jwk] }] }))
    .verify(jwtRaw(key, JSON.stringify({ alg: 'RS256', kid: key.kid }), boundaryClaims), {
      clientId: CLIENT_ID, nonce: NONCE,
    })).sub, 'user-fixture');
  const manyKeys = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`k${index}`, index]));
  const tooLarge = JSON.stringify({ ...claims(), padding: 'x'.repeat(MAX_OIDC_CLAIMS_BYTES) });
  for (const token of [deepClaims, jwt(key, manyKeys), jwtRaw(key, JSON.stringify({ alg: 'RS256', kid: key.kid }), tooLarge)]) {
    await assert.rejects(
      verifier(fakeFetch({ jwksValues: [{ keys: [key.jwk] }] })).verify(token, { clientId: CLIENT_ID, nonce: NONCE }),
      (error) => error.code === 'OPENAI_OIDC_CLAIMS_INVALID' || error.code === 'OPENAI_OIDC_JWT_INVALID',
    );
  }
});

test('rejects forbidden JOSE headers and algorithms without fetching header URLs or keys', async () => {
  const key = keyFixture();
  const cases = [
    { alg: 'none', kid: key.kid },
    { alg: 'HS256', kid: key.kid },
    { alg: 'RS256', kid: key.kid, typ: 'at+jwt' },
    { alg: 'RS256', kid: key.kid, crit: ['exp'] },
    { alg: 'RS256', kid: key.kid, b64: false },
    { alg: 'RS256', kid: key.kid, jku: 'https://attacker.invalid/jwks' },
    { alg: 'RS256', kid: key.kid, jwk: key.jwk },
    { alg: 'RS256', kid: key.kid, x5u: 'https://attacker.invalid/cert' },
    { alg: 'RS256', kid: key.kid, x5c: ['canary'] },
    { alg: 'RS256', kid: '' },
  ];
  for (const header of cases) {
    let fetchCalls = 0;
    await assert.rejects(
      verifier(async () => { fetchCalls += 1; throw new Error('must not fetch'); })
        .verify(jwt(key, claims(), header), { clientId: CLIENT_ID, nonce: NONCE }),
      { code: 'OPENAI_OIDC_HEADER_INVALID' },
    );
    assert.equal(fetchCalls, 0);
  }
});

test('rejects duplicate, weak, private, malformed and contradictory JWKs', async () => {
  const key = keyFixture();
  const weak = keyFixture('weak', 1024);
  const cases = [
    { keys: [key.jwk, { ...key.jwk }] },
    { keys: [weak.jwk] },
    { keys: [{ ...key.jwk, d: 'AQ' }] },
    { keys: [{ ...key.jwk, kty: 'EC' }] },
    { keys: [{ ...key.jwk, alg: 'PS256' }] },
    { keys: [{ ...key.jwk, use: 'enc' }] },
    { keys: [{ ...key.jwk, key_ops: ['verify', 'sign'] }] },
    { keys: [{ ...key.jwk, key_ops: ['verify', 'unknown-operation'] }] },
    { keys: [{ ...key.jwk, x5c: ['untrusted-certificate'] }] },
    { keys: [{ ...key.jwk, x5u: 'https://attacker.invalid/cert' }] },
    { keys: [{ ...key.jwk, unknown: 'still rejected' }] },
    { keys: [{ ...key.jwk, n: `${key.jwk.n}=` }] },
    { keys: [{ ...key.jwk, e: 'Ag' }] },
    { keys: [] },
    { keys: [key.jwk], extra: true },
  ];
  for (const jwks of cases) {
    await assert.rejects(
      verifier(fakeFetch({ jwksValues: [jwks] })).verify(jwt(key), { clientId: CLIENT_ID, nonce: NONCE }),
      { code: 'OPENAI_OIDC_JWKS_INVALID' },
    );
  }

  const duplicateDecodedKid = `{"keys":[{"kty":"RSA","kid":"${key.kid}","\\u006bid":"other","n":"${key.jwk.n}","e":"${key.jwk.e}"}]}`;
  await assert.rejects(
    verifier(fakeFetch({ jwksValues: [{ response: jsonResponse(duplicateDecodedKid) }] }))
      .verify(jwt(key), { clientId: CLIENT_ID, nonce: NONCE }),
    { code: 'OPENAI_OIDC_JWKS_INVALID' },
  );
});

test('accepts exactly 32 bounded JWK objects and rejects a 33rd', async () => {
  const key = keyFixture('key-31');
  const makeKeys = (count) => Array.from({ length: count }, (_, index) => ({
    ...key.jwk,
    kid: `key-${index}`,
    x5c: ['AA=='],
  }));
  const identity = await verifier(fakeFetch({ jwksValues: [{ keys: makeKeys(32) }] }))
    .verify(jwt(key), { clientId: CLIENT_ID, nonce: NONCE });
  assert.equal(identity.sub, 'user-fixture');
  await assert.rejects(
    verifier(fakeFetch({ jwksValues: [{ keys: makeKeys(33) }] }))
      .verify(jwt(key), { clientId: CLIENT_ID, nonce: NONCE }),
    { code: 'OPENAI_OIDC_JWKS_INVALID' },
  );
});

test('enforces audience, azp, subject, time and nonce claims', async () => {
  const key = keyFixture();
  const cases = [
    [claims({ iss: 'https://attacker.invalid' }), 'OPENAI_OIDC_CLAIMS_INVALID'],
    [claims({ aud: 'other-client' }), 'OPENAI_OIDC_CLAIMS_INVALID'],
    [claims({ aud: [CLIENT_ID, 'other-client'] }), 'OPENAI_OIDC_CLAIMS_INVALID'],
    [claims({ aud: [CLIENT_ID], azp: 'other-client' }), 'OPENAI_OIDC_CLAIMS_INVALID'],
    [claims({ sub: '' }), 'OPENAI_OIDC_CLAIMS_INVALID'],
    [claims({ sub: '\ud800' }), 'OPENAI_OIDC_CLAIMS_INVALID'],
    [claims({ iat: NOW_SECONDS + 6 }), 'OPENAI_OIDC_CLAIMS_INVALID'],
    [claims({ iat: NOW_SECONDS + 1, exp: NOW_SECONDS }), 'OPENAI_OIDC_CLAIMS_INVALID'],
    [claims({ exp: NOW_SECONDS - 5 }), 'OPENAI_OIDC_CLAIMS_INVALID'],
    [claims({ nbf: NOW_SECONDS + 6 }), 'OPENAI_OIDC_CLAIMS_INVALID'],
    [claims({ iat: 1.5 }), 'OPENAI_OIDC_CLAIMS_INVALID'],
    [claims({ nonce: 'wrong-nonce' }), 'OPENAI_OIDC_NONCE_INVALID'],
  ];
  for (const [claimValue, code] of cases) {
    await assert.rejects(
      verifier(fakeFetch({ jwksValues: [{ keys: [key.jwk] }] }))
        .verify(jwt(key, claimValue), { clientId: CLIENT_ID, nonce: NONCE }),
      { code },
    );
  }
});

test('allows a missing refresh nonce only when requested and still verifies a present nonce', async () => {
  const key = keyFixture();
  const withoutNonce = claims();
  delete withoutNonce.nonce;
  await assert.rejects(
    verifier(fakeFetch({ jwksValues: [{ keys: [key.jwk] }] }))
      .verify(jwt(key, withoutNonce), { clientId: CLIENT_ID, nonce: NONCE }),
    { code: 'OPENAI_OIDC_NONCE_INVALID' },
  );
  const identity = await verifier(fakeFetch({ jwksValues: [{ keys: [key.jwk] }] }))
    .verify(jwt(key, withoutNonce), { clientId: CLIENT_ID, nonce: NONCE, allowMissingNonce: true });
  assert.equal(identity.sub, 'user-fixture');
  await assert.rejects(
    verifier(fakeFetch({ jwksValues: [{ keys: [key.jwk] }] }))
      .verify(jwt(key, claims({ nonce: 'wrong' })), {
        clientId: CLIENT_ID, nonce: NONCE, allowMissingNonce: true,
      }),
    { code: 'OPENAI_OIDC_NONCE_INVALID' },
  );
});

test('refetches JWKS exactly once for an unknown kid and caches the successful replacement', async () => {
  const stale = keyFixture('stale-key');
  const current = keyFixture('current-key');
  const calls = [];
  const instance = verifier(fakeFetch({
    jwksValues: [{ keys: [stale.jwk] }, { keys: [current.jwk] }],
    calls,
  }));
  assert.equal((await instance.verify(jwt(current), { clientId: CLIENT_ID, nonce: NONCE })).sub, 'user-fixture');
  assert.equal((await instance.verify(jwt(current), { clientId: CLIENT_ID, nonce: NONCE })).sub, 'user-fixture');
  assert.deepEqual(calls.map((call) => call.url), [
    OPENAI_OIDC_DISCOVERY_URL, OPENAI_OIDC_JWKS_URI, OPENAI_OIDC_JWKS_URI,
  ]);

  const absent = keyFixture('absent-key');
  const absentCalls = [];
  await assert.rejects(
    verifier(fakeFetch({
      jwksValues: [{ keys: [stale.jwk] }, { keys: [current.jwk] }], calls: absentCalls,
    })).verify(jwt(absent), { clientId: CLIENT_ID, nonce: NONCE }),
    { code: 'OPENAI_OIDC_KEY_NOT_FOUND' },
  );
  assert.equal(absentCalls.filter((call) => call.url === OPENAI_OIDC_JWKS_URI).length, 2);
});

test('does not retry a known key with a bad signature', async () => {
  const key = keyFixture();
  const other = keyFixture(key.kid);
  const calls = [];
  await assert.rejects(
    verifier(fakeFetch({ jwksValues: [{ keys: [key.jwk] }], calls }))
      .verify(jwt(other), { clientId: CLIENT_ID, nonce: NONCE }),
    { code: 'OPENAI_OIDC_SIGNATURE_INVALID' },
  );
  assert.equal(calls.filter((call) => call.url === OPENAI_OIDC_JWKS_URI).length, 1);
});

test('bounds discovery response bytes and rejects fatal UTF-8', async () => {
  const oversized = new Uint8Array(MAX_OIDC_DISCOVERY_BYTES + 1).fill(0x20);
  await assert.rejects(
    verifier(fakeFetch({ discoveryValues: [{ response: jsonResponse(oversized) }] })).getConfiguration(),
    { code: 'OPENAI_OIDC_RESPONSE_TOO_LARGE' },
  );
  await assert.rejects(
    verifier(fakeFetch({ discoveryValues: [{ response: jsonResponse(Uint8Array.of(0xc3, 0x28)) }] })).getConfiguration(),
    { code: 'OPENAI_OIDC_DISCOVERY_UTF8_INVALID' },
  );
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(discovery()))]);
  await assert.rejects(
    verifier(fakeFetch({ discoveryValues: [{ response: jsonResponse(bom) }] })).getConfiguration(),
    { code: 'OPENAI_OIDC_DISCOVERY_INVALID' },
  );
});

test('cancels a non-cooperative fetch without exposing its late result', async () => {
  let resolveFetch;
  let lateBodyCancelCalls = 0;
  const controller = new AbortController();
  const pending = verifier(async () => new Promise((resolve) => { resolveFetch = resolve; }))
    .getConfiguration({ signal: controller.signal });
  controller.abort('external-private-reason');
  await assert.rejects(pending, { code: 'OPENAI_OIDC_CANCELLED' });
  resolveFetch({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    body: { cancel: () => { lateBodyCancelCalls += 1; } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateBodyCancelCalls, 1);
});

test('cancels unconsumed response bodies on invalid status and content type', async () => {
  for (const response of [
    { ok: false, status: 503, contentType: 'application/json' },
    { ok: true, status: 200, contentType: 'text/html' },
  ]) {
    let cancelCalls = 0;
    const instance = verifier(async () => ({
      ok: response.ok,
      status: response.status,
      headers: { get: () => response.contentType },
      body: { cancel: () => { cancelCalls += 1; } },
    }));
    await assert.rejects(
      instance.getConfiguration(),
      (error) => error.code === 'OPENAI_OIDC_HTTP_ERROR'
        || error.code === 'OPENAI_OIDC_RESPONSE_INVALID',
    );
    assert.equal(cancelCalls, 1);
  }
});

test('honors cancellation before returning warm discovery or JWKS cache entries', async () => {
  const key = keyFixture();
  const instance = verifier(fakeFetch({ jwksValues: [{ keys: [key.jwk] }] }));
  await instance.verify(jwt(key), { clientId: CLIENT_ID, nonce: NONCE });
  const controller = new AbortController();
  controller.abort('external-private-reason');
  await assert.rejects(instance.getConfiguration({ signal: controller.signal }), {
    code: 'OPENAI_OIDC_CANCELLED',
  });
  await assert.rejects(instance.verify(jwt(key), {
    clientId: CLIENT_ID, nonce: NONCE, signal: controller.signal,
  }), { code: 'OPENAI_OIDC_CANCELLED' });
});

test('deadline bounds a non-cooperative response reader and performs best-effort cleanup', async () => {
  let fire;
  let cancelCalls = 0;
  let clearCalls = 0;
  const instance = verifier(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    body: { getReader: () => ({
      read: async () => new Promise(() => {}),
      cancel: () => { cancelCalls += 1; },
      releaseLock() {},
    }) },
  }), {
    discoveryDeadlineMs: 1,
    setTimeoutImpl: (callback) => { fire = callback; return 9; },
    clearTimeoutImpl: (id) => { assert.equal(id, 9); clearCalls += 1; },
  });
  const pending = instance.getConfiguration();
  await new Promise((resolve) => setImmediate(resolve));
  fire();
  await assert.rejects(pending, { code: 'OPENAI_OIDC_DEADLINE_EXCEEDED' });
  assert.equal(cancelCalls, 1);
  assert.equal(clearCalls, 1);
});

test('redacts provider, transport, token and secret-canary details from all errors', async () => {
  const canary = 'SECRET_CANARY_PROVIDER_RAW_TOKEN';
  const error = await verifier(async () => { throw new Error(canary); }).getConfiguration().catch((value) => value);
  assert.equal(error.code, 'OPENAI_OIDC_NETWORK_ERROR');
  assert.doesNotMatch(`${error.message}${error.stack}`, new RegExp(canary, 'u'));

  const key = keyFixture();
  const badToken = `${jwt(key).slice(0, -2)}AA`;
  const signatureError = await verifier(fakeFetch({ jwksValues: [{ keys: [key.jwk] }] }))
    .verify(badToken, { clientId: CLIENT_ID, nonce: NONCE }).catch((value) => value);
  assert.equal(signatureError.code, 'OPENAI_OIDC_SIGNATURE_INVALID');
  assert.equal(signatureError.message.includes(badToken), false);
  assert.equal(signatureError.message.includes(NONCE), false);

  const responseError = await verifier(async () => ({
    get ok() { throw new Error(canary); },
  })).getConfiguration().catch((value) => value);
  assert.equal(responseError.code, 'OPENAI_OIDC_RESPONSE_INVALID');
  assert.doesNotMatch(`${responseError.message}${responseError.stack}`, new RegExp(canary, 'u'));
});

test('public entry points reject malformed options with stable verifier errors', async () => {
  assert.throws(() => new OpenIdVerifier(null), { code: 'OPENAI_OIDC_VERIFIER_INVALID' });
  const instance = verifier(async () => { throw new Error('must not fetch'); });
  await assert.rejects(instance.getConfiguration(null), { code: 'OPENAI_OIDC_REQUEST_INVALID' });
  await assert.rejects(instance.getConfiguration({ extra: true }), { code: 'OPENAI_OIDC_REQUEST_INVALID' });
  await assert.rejects(instance.verify('x.y.z', null), { code: 'OPENAI_OIDC_REQUEST_INVALID' });
});

test('source exports no generic JSON parser and contains no remote key/header URL import path', async () => {
  const module = await import('../src/chatgpt-provider/openid-verifier.mjs');
  assert.deepEqual(Object.keys(module).filter((name) => /json|parse/iu.test(name)), []);
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(
    new URL('../src/chatgpt-provider/openid-verifier.mjs', import.meta.url), 'utf8',
  ));
  assert.doesNotMatch(source, /createPublicKey\s*\(\s*header/iu);
  assert.doesNotMatch(source, /fetch\s*\(\s*header\./iu);
  assert.doesNotMatch(source, /console\.|process\.env/iu);
});
