import { createRequire } from 'node:module';
const require = createRequire(new URL('./graph-mode/live-map.js', import.meta.url));
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { fakeNode } = require('./fake-dom');
const { createGraphModeController } = require('./controller');
const store = require('./graph-mode-store');
const grouping = require('./cluster-grouping');

function harness() {
  const timers = new Map();
  let nextTimer = 0;
  const networks = [];
  const document = { createElement(name) {
    const node = fakeNode(name);
    node.removeEventListener = () => {};
    return node;
  } };
  const context = { module: { exports: {} }, document,
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./live-map'), 'utf8'), context);
  const visNetwork = {
    DataSet: class { constructor(items) { this.items = items; } },
    Network: class {
      constructor(host) { this.host = host; this.events = {}; this.fits = 0; networks.push(this); }
      on(event, callback) { this.events[event] = callback; }
      fit() { this.fits++; }
      destroy() { this.destroyed = true; }
      unselectAll() {}
    },
  };
  const container = fakeNode('main');
  const create = (deps) => context.module.exports.createLiveMap({ ...deps, visNetwork });
  return { create, container, timers, networks, document };
}
const payload = { revision: 1, nodes: [{ entity_id: 'qa-node', name: '검증 노드', degree: 0, cluster: 0 }], edges: [] };

test('controller forced redraw retains the attached live graph and user placement', async () => {
  const h = harness();
  const previousDocument = global.document;
  global.document = h.document;
  try {
    const controller = createGraphModeController({ store, grouping,
      elements: { graphBody: h.container }, fetchClusterMap: async () => payload,
      createLiveMap: h.create,
    });
    controller.setAvailable(true);
    await controller.setView(store.VIEW_GRAPH);
    await controller.setSurface(store.SURFACE_MAP);
    const network = h.networks[0];
    network.userPosition = { x: 123, y: 456 };
    await controller.refreshFiltered();
    assert.equal(h.networks.length, 1, 'same graph must not restart physics');
    assert.equal(h.container.firstChild, network.host, 'retained canvas stays attached');
    assert.deepEqual(network.userPosition, { x: 123, y: 456 });
  } finally { global.document = previousDocument; }
});

test('destroyed graph fit callback cannot change the replacement camera', () => {
  const h = harness();
  const map = h.create({ container: h.container });
  map.render(payload);
  const oldFit = [...h.timers.values()][0];
  map.render({ ...payload, revision: 2 });
  oldFit(); // A callback already queued before cancellation must also be harmless.
  assert.equal(h.networks[1].fits, 0);
  assert.equal(h.timers.size, 1, 'replacement owns the only pending fit');
  [...h.timers.values()][0]();
  assert.equal(h.networks[1].fits, 1);
  map.destroy();
  assert.equal(h.timers.size, 0);
});

test('same graph replaces an intervening notice without discarding the live network', () => {
  const h = harness();
  const map = h.create({ container: h.container });
  map.render(payload);
  h.container.removeChild(h.container.firstChild);
  h.container.appendChild(fakeNode('notice'));
  map.render(payload);
  assert.equal(h.networks.length, 1);
  assert.equal(h.container.children.length, 1);
  assert.equal(h.container.firstChild, h.networks[0].host);
  map.destroy();
});

test('stabilization fits once and cancels the fallback timer', () => {
  const h = harness();
  const map = h.create({ container: h.container });
  map.render(payload);
  const delayedFit = [...h.timers.values()][0];
  h.networks[0].events.stabilized();
  delayedFit();
  assert.equal(h.networks[0].fits, 1);
  assert.equal(h.timers.size, 0);
  map.destroy();
});
