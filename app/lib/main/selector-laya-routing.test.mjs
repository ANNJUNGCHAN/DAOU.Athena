import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createSelectorColdHedge, createDecisionCache, buildArgumentExtractionPrompt } = require('./selector-cold-hedge');
const candidate = ref => ({ operation_ref: ref, kind: 'query', argument_contracts: {
  required: ['symbol'], properties: { symbol: { type: 'string', pattern: '^\\d{6}$' }, limit: { type: 'integer' } },
} });
const preflight = (args = {}) => ({ candidates: [candidate('base:a'), candidate('base:b')],
  bound_arguments: args, catalog_version: 'fixture-v1' });
function selection(ref = 'base:ka10046', date = false) {
  const chosen = candidate(ref);
  chosen.name = 'Catalog-selected operation';
  chosen.detail_group = ref.startsWith('detail:') ? ref.split(':')[2] : null;
  chosen.execution_policy = chosen.detail_group ? 'selector_detail' : 'selector_query';
  Object.assign(chosen.argument_contracts, { type: 'object', additionalProperties: false });
  if (date) {
    chosen.argument_contracts.required.push('date');
    chosen.argument_contracts.properties.date = { type: 'string', pattern: '^\\d{8}$' };
  }
  chosen.required_arguments = chosen.argument_contracts.required.map(alias => ({ alias,
    required: true, json_schema: chosen.argument_contracts.properties[alias] }));
  return { status: 'accepted', task: 'operation_selection', choice: ref, candidate: chosen,
    confidence: 0.96, catalog_version: 'fixture-v1', considered_count: 266, evaluated_count: 266, question_count: 266 };
}
const unexpected = () => assert.fail('unexpected classifier');

test('full-catalog choice outside shortlist dispatches once, preserves bound values and never enters shortlist cache', async () => {
  const cache = createDecisionCache();
  const run = createSelectorColdHedge({ decisionCache: cache });
  let dispatches = 0, selections = 0;
  for (let i = 0; i < 2; i++) {
    const result = await run({ question: '조회', preflight: preflight({ symbol: '005930', limit: 3 }),
      selectCatalogOperation: async input => { selections++; assert.equal(input.catalog_version, 'fixture-v1'); return selection(); },
      classify: unexpected,
      dispatchProposal: async proposal => { dispatches++; assert.equal(proposal.operation_ref, 'base:ka10046');
        assert.deepEqual(proposal.arguments, { symbol: '005930', limit: 3 }); return { handled: true }; },
    });
    assert.equal(result.layaCatalogSelected, true); assert.equal(result.modelCalls, 0);
  }
  assert.equal(cache.size(), 0); assert.equal(dispatches, 2); assert.equal(selections, 2);
});

test('selected operation extracts only missing arguments and preserves the canonical detail group', async () => {
  const prompts = []; let dispatched;
  const result = await createSelectorColdHedge()({ question: '그 날짜의 거래량',
    preflight: preflight({ symbol: '005930', limit: 3 }),
    selectCatalogOperation: async () => selection('detail:ka10007:volume', true),
    classify: async ({ prompt }) => { prompts.push(prompt); return { ok: true, result: { arguments: { date: '20261007' } } }; },
    dispatchProposal: async proposal => { dispatched = proposal; return { handled: true }; },
  });
  assert.equal(result.handled, true); assert.equal(prompts.length, 2);
  for (const prompt of prompts) { assert.match(prompt, /Do not choose a route/); assert.doesNotMatch(prompt, /base:a|base:b/); }
  assert.equal(dispatched.detail_group, 'volume'); assert.equal(dispatched.intent, 'query');
  assert.deepEqual(dispatched.arguments, { symbol: '005930', limit: 3, date: '20261007' });
});

test('extraction cannot change the selected route, sealed plan, or valid bound input', async () => {
  for (const output of [{ operation_ref: 'base:a', arguments: { date: '20261007' } },
    { plan_token: 'invented', arguments: { date: '20261007' } },
    { arguments: { symbol: '000660', date: '20261007' } },
    { arguments: { limit: 4, date: '20261007' } }]) {
    const result = await createSelectorColdHedge()({ question: '조회', preflight: preflight({ symbol: '005930', limit: 3 }),
      selectCatalogOperation: async () => selection('base:ka10046', true),
      classify: async () => ({ ok: true, result: output }), dispatchProposal: () => assert.fail('invalid extraction'),
    });
    assert.equal(result.handled, false);
  }
});

test('full argument schema reaches extraction once without changing its source', () => {
  const chosen = selection().candidate;
  chosen.argument_contracts.$defs = { Period: { type: 'string', enum: ['day', 'week'] } };
  chosen.argument_contracts.properties.period = { $ref: '#/$defs/Period' };
  const prompt = buildArgumentExtractionPrompt('조회', { candidates: [chosen], bound_arguments: {} });
  const sent = JSON.parse(prompt.split('Argument contract: ')[1]);
  assert.deepEqual(sent.argument_contracts, chosen.argument_contracts);
  assert.equal(Object.hasOwn(sent, 'required_arguments'), false);
  assert.equal(chosen.required_arguments.length, 1);
});

test('missing, malformed, or unavailable full selection preserves original shortlist classification', async () => {
  const malformed = selection(); malformed.evaluated_count--;
  for (const selectCatalogOperation of [undefined, async () => null, async () => malformed, async () => { throw new Error('unavailable'); }]) {
    let dispatched;
    const result = await createSelectorColdHedge()({ question: '조회', preflight: preflight(), selectCatalogOperation,
      classify: async ({ prompt }) => { assert.match(prompt, /base:a/); assert.match(prompt, /base:b/);
        return { ok: true, result: { intent: 'query', operation_ref: 'base:a', arguments: { symbol: '005930' } } }; },
      dispatchProposal: async proposal => { dispatched = proposal; return { handled: true }; },
    });
    assert.equal(result.handled, true); assert.equal(dispatched.operation_ref, 'base:a');
    assert.ok(!result.layaCatalogSelected);
  }
});

test('deterministic and cached shortlist paths do not invoke the optional full classifier', async () => {
  const run = createSelectorColdHedge(); const scoped = preflight({ symbol: '005930' });
  scoped.candidates = [scoped.candidates[0]];
  for (let i = 0; i < 2; i++) {
    const result = await run({ question: '조회', preflight: scoped, selectCatalogOperation: unexpected,
      classify: unexpected, dispatchProposal: async () => ({ handled: true }) });
    assert.equal(result.modelCalls, 0); assert.equal(i === 0 ? result.schemaGated : result.cacheHit, true);
  }
});

test('only read-only condition websocket selections can reach the existing query dispatcher', async () => {
  for (const ref of ['base:ka10171', 'base:ka10172']) {
    const selected = selection(ref); selected.candidate.kind = 'websocket';
    const result = await createSelectorColdHedge()({ question: '조회', preflight: preflight({ symbol: '005930' }),
      selectCatalogOperation: async () => selected, classify: unexpected,
      dispatchProposal: async proposal => { assert.equal(proposal.intent, 'query'); assert.equal(proposal.operation_ref, ref); return { handled: true }; },
    });
    assert.equal(result.layaCatalogSelected, true);
  }
});

test('cancelled or replaced catalog response cannot start extraction or dispatch', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController(); let current = true;
    await assert.rejects(createSelectorColdHedge()({ question: '조회', preflight: preflight({ symbol: '005930' }),
      signal: controller.signal, isCurrent: () => current,
      selectCatalogOperation: async () => { if (cancel) controller.abort(); else current = false; return selection(); },
      classify: unexpected, dispatchProposal: () => assert.fail('stale dispatch'),
    }), { name: 'AbortError' });
  }
});
