import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import author from './natural-strategy-author.js';

const contract = { draft_schema: { type: 'object', additionalProperties: false,
  properties: { title: { type: 'string' } }, required: ['title'] },
observations: { close: 'Current close', previous_close: 'Previous close' },
limits: { instruction_bytes: 320 } };
const draft = { title: '가격 상승 진입' };
const selection = { provider: 'codex', model: 'configured-model', effort: 'low' };
const generated = { ok: true, text: JSON.stringify({ needs_clarification: false, question: '', draft }),
  model: 'configured-model' };
const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function setup({ query = async () => generated, prepare = () => reply({ decision_schema: draft }) } = {}) {
  const calls = [];
  const options = { strategy: '종가가 전일보다 높으면 진입하고 낮으면 청산',
    backendBase: 'http://127.0.0.1:8765', selection, userDataPath: '/test/profile',
    runQuery: async args => { calls.push({ type: 'model', args }); return query(args); },
    fetchImpl: async (url, init) => {
      calls.push({ type: 'http', url, init });
      return url.endsWith('/schema-contract') ? reply(contract) : prepare(JSON.parse(init.body));
    } };
  return { calls, options };
}

test('selected provider generates draft before backend sealing; author metadata is not model output', async () => {
  const { calls, options } = setup();
  const result = await author.prepareNaturalStrategy(options);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map(c => c.type), ['http', 'model', 'http']);
  assert.deepEqual(calls[1].args.selection, selection);
  assert.match(calls[1].args.prompt, /Never silently drop/);
  assert.match(calls[1].args.prompt, /Do not use tools/);
  assert.match(calls[1].args.prompt, /\{close\}/);
  assert.deepEqual(JSON.parse(calls[2].init.body), { strategy: options.strategy, draft,
    author: { provider: 'codex', model: 'configured-model' } });
  assert.deepEqual(result.data.decision_schema, draft);
});

test('ambiguity returns one focused clarification and never creates a schema', async () => {
  const { calls, options } = setup({ query: async () => ({ ok: true,
    text: JSON.stringify({ needs_clarification: true, question: '상승 기준은 전일 종가인가요?', draft: null }) }) });
  const result = await author.prepareNaturalStrategy(options);
  assert.equal(result.data.status, 'needs_clarification');
  assert.equal(calls.length, 2);
});

test('unsupported sizing and RSI instructions explicitly require clarification without approximation', () => {
  const prompt = author.buildPrompt('현금의 50%만 매수하고 RSI14가 30 미만이면 진입해줘', contract);
  assert.match(prompt, /unsupported sizing \(e\.g\. 50% cash\)/);
  assert.match(prompt, /RSI.*unavailable/);
  assert.match(prompt, /Do not approximate an unavailable observation/);
  assert.match(prompt, /Missing requirements cannot become assumptions/);
});

test('one schema validation repair uses the same provider and preserves source text', async () => {
  let validations = 0;
  const { calls, options } = setup({ prepare: () => ++validations === 1
    ? reply({ detail: 'instructions exceed byte limit' }, 422) : reply({ decision_schema: draft }) });
  const result = await author.prepareNaturalStrategy(options);
  assert.equal(result.ok, true);
  const models = calls.filter(c => c.type === 'model');
  assert.equal(models.length, 2);
  assert.deepEqual(models[0].args.selection, models[1].args.selection);
  assert.match(models[1].args.prompt, /instructions exceed byte limit/);
  assert.ok(models[1].args.prompt.includes(JSON.stringify(options.strategy)));
});

test('repeated validation failure does not return an unsealed draft', async () => {
  const { calls, options } = setup({ prepare: () => reply({ detail: 'unsupported observation' }, 422) });
  const result = await author.prepareNaturalStrategy(options);
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.equal(calls.filter(c => c.type === 'model').length, 2);
  assert.equal(result.data, undefined);
});

test('provider errors and invalid JSON never fall back to a handwritten strategy', async () => {
  for (const result of [{ ok: false, error: 'model unavailable' }, { ok: true, text: 'not JSON' }]) {
    const { calls, options } = setup({ query: async () => result });
    assert.equal((await author.prepareNaturalStrategy(options)).ok, false);
    assert.equal(calls.length, 2);
  }
});

test('unsupported provider is explicit and cannot silently select Claude or Codex', async () => {
  const { calls, options } = setup();
  const result = await author.prepareNaturalStrategy({ ...options, selection: { provider: 'grok' } });
  assert.equal(result.ok, false);
  assert.equal(calls.filter(c => c.type === 'model').length, 0);
});

test('aborted generation does not reach backend validation', async () => {
  const controller = new AbortController();
  const { calls, options } = setup({ query: async () => { controller.abort(); return generated; } });
  const result = await author.prepareNaturalStrategy({ ...options, signal: controller.signal });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 2);
});

test('Codex process uses private auth, empty work directory, structured output and disabled tools', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-author-test-'));
  fs.mkdirSync(path.join(root, 'codex-runtime'));
  fs.writeFileSync(path.join(root, 'codex-runtime', 'auth.json'), '{}');
  let invocation;
  try {
    const result = await author.runCodexAuthor({ prompt: 'strategy-only', schema: author.outputSchema(contract.draft_schema),
      ...selection, userDataPath: root, resolveExecutable: () => 'configured-codex.exe',
      spawnImpl: (exe, args, opts) => {
        invocation = { exe, args, opts };
        const child = new EventEmitter();
        child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
        queueMicrotask(() => {
          fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], generated.text);
          child.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 12 } }) + '\n');
          child.emit('close', 0);
        });
        return child;
      },
    });
    assert.equal(result.text, generated.text);
    assert.equal(invocation.opts.shell, false);
    assert.equal(invocation.opts.windowsHide, true);
    assert.equal(invocation.opts.env.CODEX_HOME, path.join(root, 'codex-runtime'));
    assert.ok(invocation.args.includes('--ignore-user-config'));
    assert.ok(invocation.args.includes('--ignore-rules'));
    assert.ok(invocation.args.includes('mcp_servers={}'));
    for (const tool of ['shell_tool', 'apps', 'hooks', 'plugins', 'multi_agent']) {
      const index = invocation.args.indexOf(tool);
      assert.equal(invocation.args[index - 1], '--disable');
    }
    assert.equal(invocation.args[invocation.args.indexOf('code_mode_host') - 1], '--enable');
    assert.equal(fs.existsSync(invocation.opts.cwd), false);
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('main routes preparation through configured author before the ordinary bridge', () => {
  const main = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
  assert.match(main, /body\.decision_mode === 'natural' && body\.operation === 'prepare'/);
  assert.match(main, /selection: resolveActiveModelSelection\(\)/);
  assert.match(main, /naturalAuthorRequests\.get\(senderId\)\?\.abort\(\)/);
});

test('Claude compiler isolates inherited MCP as well as built-in tools', async () => {
  let queryOptions;
  const { options } = setup();
  delete options.runQuery;
  const result = await author.prepareNaturalStrategy({ ...options,
    selection: { provider: 'claude', model: 'configured-claude' },
    runClaudeQuery: async args => {
      queryOptions = args;
      assert.deepEqual(JSON.parse(fs.readFileSync(args.configFile, 'utf8')), { mcpServers: {} });
      return { ok: true, finalResult: { result: generated.text } };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(queryOptions.disableAllTools, true);
  assert.equal(queryOptions.isolateMcp, true);
  assert.equal(queryOptions.resumeSessionId, null);
  assert.equal(fs.existsSync(queryOptions.cwd), false);

  const runnerPath = new URL('./claude-runner.js', import.meta.url);
  const runnerRequire = createRequire(runnerPath);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(runnerPath, 'utf8'), { module,
    require: name => name === './mcp-env' ? {} : runnerRequire(name) });
  const args = module.exports.buildArgs(queryOptions);
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(args[args.indexOf('--mcp-config') + 1], queryOptions.configFile);
  assert.equal(args[args.indexOf('--tools') + 1], '');
  const priorCaller = module.exports.buildArgs({ disableAllTools: true });
  assert.equal(priorCaller.includes('--mcp-config'), false);
});
