import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createLayaRouting } = createRequire(import.meta.url)('./laya-routing');

test('registration and planning share a deadline; exhausted registration goes straight to provider', async () => {
  let time = 0;
  const paths = [];
  const routing = createLayaRouting({ baseUrl: 'http://127.0.0.1:1234', bearerToken: 'fixture',
    timeoutMs: 100, now: () => time,
    async fetchImpl(url) {
      paths.push(url.pathname);
      if (url.pathname.endsWith('/turns')) {
        time = 101;
        return { ok: true, status: 200, json: async () => ({ ticket: 'fixture-ticket', conversation_id: 'c', turn_id: 't' }) };
      }
      return { ok: true, status: 200, json: async () => ({ complete: false }) };
    },
  });
  const session = routing.createSession();
  let invoked = 0;
  const result = await session.run({ prompt: 'original', layaContext: {
    conversation_id: 'c', turn_id: 't', origin: 'shell', utterance: 'original', context: {},
  } }, async () => { invoked++; return { ok: true }; });
  assert.equal(result.ok, true);
  assert.equal(invoked, 1);
  assert.equal(paths.some(path => path.endsWith('/plan')), false);
  assert.equal(paths.filter(path => path.endsWith('/fixture-ticket')).length, 1);
});

test('cancelling pending classification aborts its transport without invoking provider', async () => {
  const controller = new AbortController();
  let signal;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const routing = createLayaRouting({ baseUrl: 'http://127.0.0.1:1234', bearerToken: 'fixture',
    async fetchImpl(_url, options) {
      signal = options.signal;
      entered();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    },
  });
  const session = routing.createSession();
  let invoked = false;
  const run = session.run({ prompt: 'original', signal: controller.signal, layaContext: {
    conversation_id: 'c', turn_id: 't', origin: 'shell', utterance: 'original', context: {},
  } }, async () => { invoked = true; });
  await ready;
  controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signal.aborted, true);
  const result = await run;
  assert.equal(result.aborted, true);
  assert.equal(invoked, false);
});
