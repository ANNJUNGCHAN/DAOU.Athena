import test from 'node:test';
import assert from 'node:assert/strict';
import controllerModule from './graph-mode/controller.js';
import store from './graph-mode/graph-mode-store.js';
import grouping from './graph-mode/cluster-grouping.js';
import fakeDom from './graph-mode/fake-dom.js';
const { createGraphModeController } = controllerModule;
const { fakeNode } = fakeDom;

test('selected graph context includes the same connected entities as the visible panel', async () => {
  const payload = { revision: 1, nodes: [
    { entity_id: 'sector', name: '합성 업종', cluster: 0, degree: 2 },
    { entity_id: 'company-a', name: '합성 회사 A', cluster: 0, degree: 1 },
    { entity_id: 'company-b', name: '합성 회사 B', cluster: 0, degree: 1 },
  ], edges: [['company-a', 'sector'], ['company-b', 'sector']], edge_details: [
    { source: 'company-a', target: 'sector', kinds: ['belongs_to'], confidence: 'EXTRACTED' },
    { source: 'company-b', target: 'sector', kinds: ['belongs_to'], confidence: 'INFERRED' },
  ] };
  const controller = createGraphModeController({ store, grouping,
    elements: { graphBody: fakeNode('main') }, fetchClusterMap: async () => payload,
    createLiveMap: () => ({ available: () => true, render() {}, selectEntity() {} }),
  });
  controller.setAvailable(true);
  await controller.setView(store.VIEW_GRAPH);
  await controller.setSurface(store.SURFACE_MAP);
  controller.selectNode('sector');
  const selected = controller.getContext().selected;
  assert.equal(selected.name, '합성 업종');
  assert.equal(selected.degree, 2);
  assert.deepEqual(selected.relations.map((r) => r.name), ['합성 회사 A', '합성 회사 B']);
  assert.deepEqual(selected.relations.map((r) => r.confidence), ['EXTRACTED', 'INFERRED']);
});
