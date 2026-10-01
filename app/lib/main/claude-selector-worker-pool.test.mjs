import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClaudeSelectorWorkerPool } = require('./claude-selector-worker-pool');

test('selector workers keep MCP empty through startup and model replacement', () => {
  const spawns = [];
  const killed = [];
  const pool = createClaudeSelectorWorkerPool({
    cwd: process.cwd(),
    claudeBin: 'fixture-claude',
    desiredSize: 1,
    quietBoundaryMs: 0,
    spawnFn(bin, args, options) {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      spawns.push({ bin, args, options, child });
      return child;
    },
    killFn(child) { killed.push(child); },
  });
  const finishWarmup = child => child.stdout.write(`${JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, result: 'OK',
  })}\n`);
  try {
    pool.start();
    assert.equal(spawns.length, 1);
    finishWarmup(spawns[0].child);
    assert.equal(pool.snapshot().workers.idle, 1);
    pool.configure({ model: 'test-model', effort: 'low' });
    assert.equal(spawns.length, 2);
    finishWarmup(spawns[1].child);
    assert.equal(pool.snapshot().workers.idle, 1);
    assert.ok(killed.includes(spawns[0].child));
    for (const { args, options, child } of spawns) {
      const value = flag => args[args.indexOf(flag) + 1];
      assert.ok(args.includes('--strict-mcp-config'), 'registered MCP servers must stay excluded');
      assert.deepEqual(JSON.parse(value('--mcp-config')), { mcpServers: {} });
      assert.equal(value('--tools'), '', 'built-in tools must stay excluded');
      assert.equal(value('--setting-sources'), '');
      assert.equal(options.shell, false, 'empty argument strings must survive spawn');
      assert.equal(options.windowsHide, true);
      assert.equal(JSON.parse(child.stdin.read().toString()).message.content, 'Reply exactly OK.');
    }
    assert.equal(spawns[1].args[spawns[1].args.indexOf('--model') + 1], 'test-model');
    assert.equal(spawns[1].args[spawns[1].args.indexOf('--effort') + 1], 'low');
  } finally {
    pool.stop('test completed');
  }
});
