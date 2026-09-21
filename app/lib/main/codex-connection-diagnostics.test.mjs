import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { probeCodexVersion, connectionDiagnostics } = require('./codex-connection-diagnostics');

function runtime(output, code = 0) {
  return { spawnPrivateHomeCommand(args, options) {
    assert.deepEqual(args, ['--version']);
    assert.equal(options.stdio[2], 'ignore');
    const child = new EventEmitter(); child.stdout = new EventEmitter();
    setImmediate(() => { child.stdout.emit('data', output); child.emit('close', code, null); });
    return child;
  } };
}

test('real version format is checked separately from authentication', async () => {
  const version = await probeCodexVersion(runtime('codex-cli 0.155.1\n'));
  assert.deepEqual(version, { cliStatus: 'available', cliVersion: '0.155.1' });
  assert.equal(connectionDiagnostics(version, 'disconnected').authentication, 'not-authenticated');
  assert.equal(connectionDiagnostics(version, 'connected').authentication, 'authenticated');
  assert.equal(connectionDiagnostics(version, 'unavailable').authentication, 'unknown');
});

test('failure and unexpected CLI output expose no raw details', async () => {
  for (const [output, code] of [['codex-cli 0.155.1', 1], ['private-path credential=value', 0]]) {
    const result = await probeCodexVersion(runtime(output, code));
    assert.deepEqual(result, { cliStatus: 'unavailable', cliVersion: null });
    assert.doesNotMatch(JSON.stringify(result), /private-path|credential/);
  }
  assert.equal((await probeCodexVersion(null)).cliStatus, 'unavailable');
});

test('a stalled version probe times out and terminates its child', async () => {
  let killed = false;
  const result = await probeCodexVersion({ spawnPrivateHomeCommand() {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.kill = () => { killed = true; };
    return child;
  } }, 5);
  assert.equal(killed, true);
  assert.equal(result.cliStatus, 'unavailable');
});

test('Codex settings identify authentication and diagnostic scope without claiming model/MCP success', () => {
  const source = fs.readFileSync(new URL('../settings-cards.js', import.meta.url), 'utf8');
  const start = source.indexOf('function buildModelSection(opts) {');
  const prefix = source.slice(start, source.indexOf('  async function doSwitch(acc)', start));
  const node = (tag, cls, text = '') => ({ text, children: [], appendChild(child) { this.children.push(child); } });
  const build = vm.runInNewContext(`${prefix} return wrap; }\nbuildModelSection`, {
    el: node, statusDot: (_ok, text) => node('', '', text), pill: text => node('', '', text),
    row: (_cls, children) => ({ children }),
  });
  const textOf = node => [node.text || '', ...(node.children || []).map(textOf)].join(' ');
  const section = build({ title: 'Codex', description: '', provider: { id: 'codex', accounts: [{}],
    diagnostics: { cliStatus: 'available', cliVersion: '0.155.1', authentication: 'authenticated' } } });
  const text = textOf(section);
  assert.match(text, /인증됨/);
  assert.match(text, /CLI 실행 확인 · 0.155.1/);
  assert.match(text, /이 연결 확인에서는 모델 응답·MCP 실행을 검사하지 않습니다/);
  assert.doesNotMatch(text, /연결됨|미검증/);
});
