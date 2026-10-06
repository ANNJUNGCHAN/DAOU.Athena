import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createSelectorColdHedge, createDecisionCache, buildClassificationPrompt, buildArgumentExtractionPrompt } = require('./selector-cold-hedge');
const candidate = (ref) => ({ operation_ref: ref, kind: 'query', argument_contracts: {
  required: ['symbol'], properties: { symbol: { type: 'string', pattern: '^\\d{6}$' }, limit: { type: 'integer' } },
} });
const preflight = (args = {}) => ({ candidates: [candidate('base:a'), candidate('base:b')], bound_arguments: args, catalog_version: 'fixture-v1' });
const selection = { task: 'operation_selection', choice: 'candidate_2' };

function datedPreflight(bound) {
  const result = preflight(bound);
  for (const entry of result.candidates) {
    entry.argument_contracts.required.push('date');
    entry.argument_contracts.properties.date = { type: 'string', pattern: '^\\d{8}$' };
  }
  return result;
}

test('finite selection with complete bound arguments uses no CLI and dispatches once', async () => {
  let dispatches = 0;
  let classifiers = 0;
  const result = await createSelectorColdHedge()({ question: '선택', preflight: preflight({ symbol: '005930', limit: 3 }),
    selectOperation: async () => selection,
    classify: async () => { classifiers++; },
    dispatchProposal: async (proposal) => { dispatches++; assert.equal(proposal.operation_ref, 'base:b'); assert.deepEqual(proposal.arguments, { symbol: '005930', limit: 3 }); return { handled: true }; },
  });
  assert.equal(dispatches, 1); assert.equal(classifiers, 0); assert.equal(result.layaSelected, true);
});

test('missing free values remain CLI work constrained to the selected candidate', async () => {
  const prompts = [];
  let dispatches = 0;
  await createSelectorColdHedge()({ question: '종목 조회', preflight: preflight(), selectOperation: async () => selection,
    classify: async ({ prompt }) => { prompts.push(prompt); return { ok: true, result: { arguments: { symbol: '005930' } } }; },
    dispatchProposal: async () => { dispatches++; return { handled: true }; },
  });
  assert.equal(dispatches, 1); assert.equal(prompts.length, 2);
  for (const prompt of prompts) { assert.match(prompt, /base:b/); assert.doesNotMatch(prompt, /base:a/); }
});

test('selected extraction preserves bound required and optional values when CLI supplies only missing fields', async () => {
  for (const generated of [{ date: '20260930' }, { symbol: '005930', date: '20260930' }]) {
    let dispatched;
    const result = await createSelectorColdHedge()({ question: '그 날짜로 조회',
      preflight: datedPreflight({ symbol: '005930', limit: 3 }), selectOperation: async () => selection,
      classify: async () => ({ ok: true, result: { arguments: generated } }),
      dispatchProposal: async (proposal) => { dispatched = proposal; return { handled: true }; },
    });
    assert.equal(result.handled, true);
    assert.deepEqual(dispatched.arguments, { symbol: '005930', limit: 3, date: '20260930' });
  }
});

test('conflicting required or optional bound values fail closed before dispatch', async () => {
  for (const generated of [
    { symbol: '000660', date: '20260930' },
    { date: '20260930', limit: 4 },
  ]) {
    let dispatches = 0;
    const result = await createSelectorColdHedge()({ question: '조회',
      preflight: datedPreflight({ symbol: '005930', limit: 3 }), selectOperation: async () => selection,
      classify: async () => ({ ok: true, result: { arguments: generated } }),
      dispatchProposal: async () => { dispatches++; return { handled: true }; },
    });
    assert.equal(result.handled, false);
    assert.equal(result.reason, 'classification_failed');
    assert.equal(dispatches, 0);
  }
});

test('only valid bound fields from the selected contract are merged', async () => {
  let dispatched;
  const result = await createSelectorColdHedge()({ question: '조회',
    preflight: datedPreflight({ symbol: '005930', limit: 'invalid', other_operation_only: 77 }),
    selectOperation: async () => selection,
    classify: async () => ({ ok: true, result: { arguments: { date: '20260930', limit: 5 } } }),
    dispatchProposal: async (proposal) => { dispatched = proposal; return { handled: true }; },
  });
  assert.equal(result.handled, true);
  assert.deepEqual(dispatched.arguments, { symbol: '005930', date: '20260930', limit: 5 });
  assert.equal(Object.hasOwn(dispatched.arguments, 'other_operation_only'), false);
});

test('legacy full classifier path still requires the original complete argument output', async () => {
  let dispatches = 0;
  const result = await createSelectorColdHedge()({ question: '조회',
    preflight: datedPreflight({ symbol: '005930', limit: 3 }),
    classify: async () => ({ ok: true, result: { intent: 'query', operation_ref: 'base:b', arguments: { date: '20260930' } } }),
    dispatchProposal: async () => { dispatches++; return { handled: true }; },
  });
  assert.equal(result.handled, false);
  assert.equal(dispatches, 0);
});

test('selected-argument prompt removes route selection and shrinks actual classifier bytes', () => {
  const full = preflight();
  const narrow = { ...full, candidates: [full.candidates[1]] };
  const before = buildClassificationPrompt('종목 조회', full);
  const after = buildArgumentExtractionPrompt('종목 조회', narrow);
  assert.ok(Buffer.byteLength(after) < Buffer.byteLength(before));
  assert.match(after, /Do not choose a route/);
  assert.doesNotMatch(after, /Choose exactly one operation_ref|base:a/);
});

test('complete selected schema is sent once with required, optional, definitions and constraints intact', () => {
  const symbol = { type: 'string', pattern: '^\\d{6}$', description: 'Exact instrument identifier' };
  const interval = { type: 'string', enum: ['day', 'week'], default: 'day', description: 'Requested interval' };
  const contract = { type: 'object', additionalProperties: false, required: ['symbol'],
    properties: { symbol, interval, period: { $ref: '#/$defs/DateRange' } },
    $defs: { DateRange: { type: 'object', properties: { start: { type: 'string', pattern: '^\\d{8}$' } },
      required: ['start'], additionalProperties: false } } };
  const selected = { operation_ref: 'base:ka10081', kind: 'query', name: 'Daily chart',
    required_arguments: [{ alias: 'symbol', required: true, json_schema: symbol }], argument_contracts: contract };
  const prompt = buildArgumentExtractionPrompt('종목 차트', { candidates: [selected], bound_arguments: {} });
  const sent = JSON.parse(prompt.split('Argument contract: ')[1]);
  assert.deepEqual(sent.argument_contracts, contract);
  assert.equal(sent.operation_ref, selected.operation_ref);
  assert.equal(sent.name, selected.name);
  assert.equal(Object.hasOwn(sent, 'required_arguments'), false);
  assert.equal(prompt.split('Exact instrument identifier').length - 1, 1);
  assert.doesNotMatch(prompt, /Candidates:|Choose exactly one operation_ref/);
  assert.deepEqual(selected.required_arguments, [{ alias: 'symbol', required: true, json_schema: symbol }], 'source contract is not mutated');

  const legacy = { ...selected, argument_contracts: null };
  const legacyPrompt = buildArgumentExtractionPrompt('종목 차트', { candidates: [legacy] });
  const legacySent = JSON.parse(legacyPrompt.split('Argument contract: ')[1]);
  assert.deepEqual(legacySent.required_arguments, selected.required_arguments);
  assert.equal(Object.hasOwn(legacySent, 'name'), false);
});

test('selected detail group comes from the catalog reference, not CLI classification', async () => {
  const scoped = { candidates: [candidate('detail:ka10007:prices'), candidate('detail:ka10007:volume')] };
  let dispatched;
  await createSelectorColdHedge()({ question: '거래량', preflight: scoped, selectOperation: async () => selection,
    classify: async () => ({ ok: true, result: { arguments: { symbol: '005930' } } }),
    dispatchProposal: async (proposal) => { dispatched = proposal; return { handled: true }; },
  });
  assert.equal(dispatched.operation_ref, 'detail:ka10007:volume');
  assert.equal(dispatched.detail_group, 'volume');
  assert.equal(dispatched.intent, 'query');
});

test('a classifier cannot replace LAYA selection or invent a plan token', async () => {
  let dispatches = 0;
  const result = await createSelectorColdHedge()({ question: '조회', preflight: preflight(), selectOperation: async () => selection,
    classify: async () => ({ ok: true, result: { intent: 'query', operation_ref: 'base:a', arguments: { symbol: '005930' }, plan_token: 'invented' } }),
    dispatchProposal: async () => { dispatches++; return { handled: true }; },
  });
  assert.equal(result.handled, false); assert.equal(dispatches, 0);
});

test('unknown or failed LAYA selection preserves the existing classifier path', async () => {
  for (const selectOperation of [async () => null, async () => ({ ...selection, choice: 'unknown' }), async () => { throw new Error('unavailable'); }]) {
    let dispatches = 0;
    const result = await createSelectorColdHedge()({ question: '조회', preflight: preflight(), selectOperation,
      classify: async ({ prompt }) => { assert.match(prompt, /base:a/); assert.match(prompt, /base:b/); return { ok: true, result: { intent: 'query', operation_ref: 'base:a', arguments: { symbol: '005930' } } }; },
      dispatchProposal: async () => { dispatches++; return { handled: true }; },
    });
    assert.equal(result.handled, true); assert.equal(dispatches, 1);
  }
});

test('late finite decision is discarded on cancellation or superseded turn', async () => {
  let current = true;
  let dispatches = 0;
  await assert.rejects(createSelectorColdHedge()({ question: '조회', preflight: preflight({ symbol: '005930' }),
    isCurrent: () => current, selectOperation: async () => { current = false; return selection; },
    classify: async () => { throw new Error('must not generate'); },
    dispatchProposal: async () => { dispatches++; },
  }), { name: 'AbortError' });
  assert.equal(dispatches, 0);
});

function catalogSelection(ref = 'base:ka10046', requiredDate = false) {
  const selected = candidate(ref);
  selected.name = 'Catalog-selected operation';
  selected.detail_group = ref.startsWith('detail:') ? ref.split(':')[2] : null;
  selected.argument_contracts.type = 'object';
  selected.argument_contracts.additionalProperties = false;
  if (requiredDate) {
    selected.argument_contracts.required.push('date');
    selected.argument_contracts.properties.date = { type: 'string', pattern: '^\\d{8}$' };
  }
  selected.required_arguments = selected.argument_contracts.required.map((alias) => ({ alias,
    required: true, json_schema: selected.argument_contracts.properties[alias] }));
  return { status: 'accepted', task: 'operation_selection', choice: ref, candidate: selected,
    confidence: 0.96, catalog_version: 'fixture-v1', considered_count: 266, evaluated_count: 266, question_count: 306 };
}

test('catalog selection outside the old three candidates dispatches once and never enters the shortlist cache', async () => {
  const decisionCache = createDecisionCache();
  const run = createSelectorColdHedge({ decisionCache });
  const scoped = preflight({ symbol: '005930', limit: 3 });
  scoped.candidates.push(candidate('base:c'));
  let selections = 0;
  let dispatches = 0;
  for (let i = 0; i < 2; i++) {
    const result = await run({ question: '체결강도', preflight: scoped,
      selectCatalogOperation: async (input) => {
        selections++;
        assert.equal(input.catalog_version, 'fixture-v1');
        assert.equal(Object.hasOwn(input, 'candidates'), false);
        return catalogSelection();
      },
      classify: async () => { throw new Error('bound arguments need no CLI'); },
      dispatchProposal: async (proposal) => {
        dispatches++;
        assert.equal(proposal.operation_ref, 'base:ka10046');
        assert.deepEqual(proposal.arguments, { symbol: '005930', limit: 3 });
        return { handled: true };
      },
    });
    assert.equal(result.layaCatalogSelected, true);
  }
  assert.equal(selections, 2);
  assert.equal(dispatches, 2);
  assert.equal(decisionCache.size(), 0);
});

test('full-catalog choice gives CLI only its contract and conserves valid bound optional arguments', async () => {
  const decisionCache = createDecisionCache();
  const prompts = [];
  let dispatched;
  const result = await createSelectorColdHedge({ decisionCache })({ question: '그 날짜로 체결강도',
    preflight: preflight({ symbol: '005930', limit: 3 }),
    selectCatalogOperation: async () => catalogSelection('base:ka10046', true),
    classify: async ({ prompt }) => { prompts.push(prompt); return { ok: true, result: { arguments: { date: '20261001' } } }; },
    dispatchProposal: async (proposal) => { dispatched = proposal; return { handled: true }; },
  });
  assert.equal(result.layaCatalogSelected, true);
  assert.deepEqual(dispatched.arguments, { symbol: '005930', limit: 3, date: '20261001' });
  assert.equal(decisionCache.size(), 0);
  assert.equal(prompts.length, 2);
  for (const prompt of prompts) {
    assert.match(prompt, /base:ka10046/);
    assert.doesNotMatch(prompt, /base:a|base:b|Candidates:|Choose exactly one operation_ref/);
  }
});

test('partial catalog, changed version, missing contract and unsupported references fall back to original CLI candidates', async () => {
  for (const change of [
    (r) => { r.evaluated_count = 265; },
    (r) => { r.catalog_version = 'stale'; },
    (r) => { delete r.candidate.argument_contracts; },
    (r) => { r.choice = r.candidate.operation_ref = 'base:ka10173'; r.candidate.kind = 'websocket'; },
  ]) {
    const selection = catalogSelection();
    change(selection);
    let dispatched;
    const result = await createSelectorColdHedge()({ question: '조회', preflight: preflight(),
      selectCatalogOperation: async () => selection,
      classify: async ({ prompt }) => {
        assert.match(prompt, /base:a/); assert.match(prompt, /base:b/); assert.doesNotMatch(prompt, /base:ka10046/);
        return { ok: true, result: { intent: 'query', operation_ref: 'base:a', arguments: { symbol: '005930' } } };
      },
      dispatchProposal: async (proposal) => { dispatched = proposal; return { handled: true }; },
    });
    assert.equal(result.layaSelected, false);
    assert.equal(dispatched.operation_ref, 'base:a');
  }
});

test('full-catalog selection preserves deterministic schema and cache fast paths', async () => {
  const run = createSelectorColdHedge();
  const scoped = preflight({ symbol: '005930' });
  scoped.candidates = [scoped.candidates[0]];
  for (let i = 0; i < 2; i++) {
    const result = await run({ question: '조회', preflight: scoped,
      selectCatalogOperation: async () => { throw new Error('must not classify'); },
      classify: async () => { throw new Error('must not call CLI'); },
      dispatchProposal: async () => ({ handled: true }),
    });
    assert.equal(result.modelCalls, 0);
    assert.equal(i === 0 ? result.schemaGated : result.cacheHit, true);
  }
});

test('read-only condition operations and detail groups survive full-catalog contract validation', async () => {
  for (const ref of ['base:ka10171', 'base:ka10172', 'detail:ka10007:volume']) {
    const selection = catalogSelection(ref);
    if (ref.startsWith('base:')) selection.candidate.kind = 'websocket';
    let dispatched;
    const result = await createSelectorColdHedge()({ question: '조회', preflight: preflight({ symbol: '005930' }),
      selectCatalogOperation: async () => selection,
      classify: async () => { throw new Error('bound arguments need no CLI'); },
      dispatchProposal: async (proposal) => { dispatched = proposal; return { handled: true }; },
    });
    assert.equal(result.layaCatalogSelected, true);
    assert.equal(dispatched.operation_ref, ref);
    assert.equal(dispatched.intent, 'query');
    assert.equal(dispatched.detail_group, selection.candidate.detail_group);
  }
});

test('cancelled or replaced full-catalog selection cannot start CLI or dispatch', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    let current = true;
    let calls = 0;
    await assert.rejects(createSelectorColdHedge()({ question: '조회', preflight: preflight({ symbol: '005930' }),
      signal: controller.signal, isCurrent: () => current,
      selectCatalogOperation: async () => { if (cancel) controller.abort(); else current = false; return catalogSelection(); },
      classify: async () => { calls++; }, dispatchProposal: async () => { calls++; },
    }), { name: 'AbortError' });
    assert.equal(calls, 0);
  }
});
