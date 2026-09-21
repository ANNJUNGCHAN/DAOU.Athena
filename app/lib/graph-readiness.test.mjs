import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');
const start = source.indexOf('function applyGraphReadiness(');
const fn = source.slice(start, source.indexOf('\n}', start) + 2);
test('graph stays pending beyond backend readiness and becomes available only after projection', () => {
  const states = [];
  const ctx = vm.createContext({ graphBrainReady: false,
    graphMode: { setAvailable: (...args) => states.push(args) },
    markGraphBrainReady() { ctx.graphBrainReady = true; states.push([true]); },
  });
  vm.runInContext(fn, ctx);
  const apply = (state) => ctx.applyGraphReadiness({ phase: 'ready', tasks: [
    { id: 'backend', state: 'succeeded' }, { id: 'graph-projection', state },
  ] });
  apply('running');
  assert.equal(states.at(-1)[0], false);
  assert.match(states.at(-1)[1], /연결하고 있습니다/);
  apply('failed');
  assert.match(states.at(-1)[1], /준비하지 못했습니다/);
  apply('succeeded');
  assert.deepEqual(states.at(-1), [true]);
  apply('running');
  assert.deepEqual(states.at(-1), [true]);
  const failureStart = source.indexOf('function graphReadinessUnavailable(');
  vm.runInContext(source.slice(failureStart, source.indexOf('\n}', failureStart) + 2), ctx);
  const calls = states.length;
  ctx.graphReadinessUnavailable();
  assert.equal(states.length, calls, 'late snapshot failure cannot disable a graph already made ready by an event');
});
