import test from 'node:test';
import assert from 'node:assert/strict';
import canvas from './backtest-canvas.js';

test('registered nested technique keeps its identity before the asynchronous project tree completes', async () => {
  let finishOpen;
  let binding;
  let openArgs;
  const entry = { project_id: 'parent-project', name: 'DEMO-SMA-5-20',
    path: 'DEMO-SMA-5-20/strategy.py' };
  const pending = canvas.openRegisteredTechnique({
    openAt(...args) {
      openArgs = args;
      assert.equal(binding.name, entry.name);
      assert.equal(binding.rootPath, 'DEMO-SMA-5-20');
      return new Promise((resolve) => { finishOpen = resolve; });
    },
  }, entry, (value) => { binding = value; });
  assert.deepEqual(openArgs, ['parent-project', entry.path, { rootPath: 'DEMO-SMA-5-20' }]);
  finishOpen(true);
  assert.equal(await pending, true);
  assert.deepEqual(binding, { projectId: 'parent-project', rootPath: 'DEMO-SMA-5-20',
    path: entry.path, name: entry.name });
});

test('registered root files and deeper folders preserve full project-relative execution paths', async () => {
  for (const [path, normalized, rootPath] of [
    ['strategy.py', 'strategy.py', ''],
    ['strategies/demo/strategy.py', 'strategies/demo/strategy.py', 'strategies/demo'],
    ['strategies\\demo\\strategy.py', 'strategies/demo/strategy.py', 'strategies/demo'],
  ]) {
    const entry = { project_id: 'project', name: 'Demo', path };
    let binding;
    const opened = await canvas.openRegisteredTechnique({
      openAt: async (...args) => {
        assert.deepEqual(args, ['project', normalized, { rootPath }]);
        return false;
      },
    }, entry, (value) => { binding = value; });
    assert.equal(opened, false);
    assert.equal(binding.path, normalized);
    assert.equal(binding.rootPath, rootPath);
    assert.equal(entry.path, path);
  }
});
