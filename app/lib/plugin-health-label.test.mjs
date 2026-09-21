import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');
const start = source.indexOf('function pluginHealthLabel(');
assert.notEqual(start, -1);
const implementation = source.slice(start, source.indexOf('\n}', start) + 2);

test('cached successful probe is labeled as a past check, not a live connection', () => {
  const context = vm.createContext({ pluginProbeErrors: new Map() });
  vm.runInContext(implementation, context);
  const server = { alias: 'fixture', approved: true, health: 'ok' };
  assert.equal(context.pluginHealthLabel(server), '최근 확인 성공');
  context.pluginProbeErrors.set('fixture', 'fixture failure');
  assert.equal(context.pluginHealthLabel(server), '최근 확인 실패');
  context.pluginProbeErrors.delete('fixture');
  assert.equal(context.pluginHealthLabel(server), '최근 확인 성공');
  assert.match(context.pluginHealthLabel({ ...server, approved: false }), /꺼짐/);
  assert.match(context.pluginHealthLabel({ ...server, health: 'unknown' }), /미확인/);
});
