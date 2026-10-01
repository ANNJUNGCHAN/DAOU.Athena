import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createSelectorColdHedge, buildClassificationPrompt, buildArgumentExtractionPrompt } = require('./selector-cold-hedge');
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
