import test from 'node:test';
import assert from 'node:assert/strict';
import controllerModule from './graph-mode/controller.js';
import store from './graph-mode/graph-mode-store.js';
import grouping from './graph-mode/cluster-grouping.js';
import fakeDom from './graph-mode/fake-dom.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import editProposal from './graph-mode/graph-edit-proposal.js';
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

const detail = { resolved: true, entity_id: 'synthetic', name: '합성 테마', kind: 'theme', degree: 13,
  relations: Array.from({ length: 13 }, (_, index) => ({ relation_kind: 'interested_in', direction: 'out',
    other_entity_name: `합성 항목 ${index}`, rationale: '사용자가 조회한 합성 근거',
    source: { text: '합성 원문'.repeat(120), full_chars: 600, kind: 'chat_message', occurred_at: '2026-10-01' },
  })), timeline: [] };

test('entity evidence starts folded while preserving every quote and its provenance', async () => {
  const oldDocument = global.document;
  global.document = { createElement: fakeNode };
  try {
    const panel = fakeNode('aside');
    const controller = createGraphModeController({ store, grouping, elements: { panel },
      fetchClusterMap: async () => ({ revision: 1, nodes: [], edges: [] }) });
    await controller.setView(store.VIEW_GRAPH);
    controller.showEntityDetail(detail);
    assert.equal(panel.hidden, false);
    const quotes = panel.querySelectorAll('.entity-relation-excerpt');
    assert.equal(quotes.length, 13);
    for (const quote of quotes) {
      assert.equal(quote.nodeName, 'details');
      assert.equal(quote.getAttribute('open'), undefined);
      assert.equal(quote.firstChild.nodeName, 'summary');
      assert.match(quote.firstChild.textContent, /원문 발췌 · 대화 · 10-01 · 전문 600자/);
      assert.equal(quote.querySelector('.entity-excerpt-text').textContent, `"${detail.relations[0].source.text}"`);
    }
  } finally { global.document = oldDocument; }
});

test('entity details cannot obscure another mode and return intact when graph mode is reopened', async () => {
  const oldDocument = global.document;
  global.document = { createElement: fakeNode };
  try {
    const panel = fakeNode('aside');
    const controller = createGraphModeController({ store, grouping, elements: { panel },
      fetchClusterMap: async () => ({ revision: 1, nodes: [], edges: [] }) });
    await controller.setView(store.VIEW_GRAPH);
    controller.showEntityDetail(detail);
    for (const mode of [store.VIEW_PLUGIN, store.VIEW_AGENT, store.VIEW_BACKTEST, store.VIEW_SUMMARY]) {
      await controller.setView(mode);
      assert.equal(panel.hidden, true, mode);
      controller.showEntityDetail(detail); // A late result cannot expose the panel in another mode.
      assert.equal(panel.hidden, true, mode);
      await controller.setView(store.VIEW_GRAPH);
      assert.equal(panel.hidden, false);
      assert.equal(panel.querySelectorAll('.entity-relation-row').length, 13);
    }
  } finally { global.document = oldDocument; }
});

test('graph edit notice describes the actual immediate or deferred application path', () => {
  const source = readFileSync(new URL('../chat.js', import.meta.url), 'utf8');
  const start = source.indexOf('function renderGraphEditProposalCard(');
  const code = source.slice(start, source.indexOf('\n}', start) + 2);
  for (const [patch, expected] of [
    [{ op: 'add', subjectId: 'a', objectId: 'b' }, /바로 반영/],
    [{ op: 'change', subjectId: 'a', objectId: 'b' }, /바로 반영/],
    [{ op: 'remove', relationId: 'r' }, /바로 지워/],
    [{ op: 'add', subjectId: 'a' }, /다음 수집/],
    [{ op: 'change', objectId: 'b' }, /다음 수집/],
    [{ op: 'remove' }, /다음 수집/],
  ]) {
    const host = fakeNode('div');
    const sandbox = { document: { getElementById: () => host, createElement: fakeNode },
      graphEditProposalLib: () => editProposal, graphEditProposal: { object: '합성 항목', relationText: '관심', ...patch },
      answerGraphEditProposal: () => { throw Error('rendering must never apply a proposal'); },
    };
    vm.runInNewContext(`${code}\nrenderGraphEditProposalCard();`, sandbox);
    assert.match(host.querySelector('.question-card-note').textContent, expected);
  }
});
