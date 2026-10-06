import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { runSelectorFastPath } = require('./selector-fast-path');
const { buildHydrateBody } = require('./board-hydrate');
const source = readFileSync(new URL('../../canvas.js', import.meta.url), 'utf8');
const targetSource = source.slice(source.indexOf('function boardHydrateTarget('), source.indexOf('function boardHydrateAccount('));
const context = vm.createContext({ cardStkCd: () => null, boardStateOf: () => ({ boardId: '15J9-2' }), rankingBoardControls: null });
vm.runInContext(targetSource, context);

async function deliver(args, topArgs) {
  let emitted;
  let responseEnvelope;
  const result = await runSelectorFastPath({
    question: '공개 합성 조회', backendBase: 'http://127.0.0.1', backendAccountAlias: 'synthetic',
    arguments: { inds_cd: 'unverified-input' },
    fetchImpl: async (_url, request) => {
      const input = JSON.parse(request.body);
      const correlation = { dataset_id: input.dataset_id, item_id: input.item_id, ordinal: input.ordinal };
      responseEnvelope = { operation_ref: 'base:ka20002', canvas_type: 'table', screen_id: 'synthetic', correlation,
        ...(args === undefined ? {} : { operation_args: args }) };
      return { ok: true, json: async () => ({ delivery: 'inline', queued: false, status: 'rendered',
        operation_ref: 'base:ka20002', canvas_type: 'table', screen_id: 'synthetic', correlation,
        envelope: responseEnvelope, ...(topArgs === undefined ? {} : { operation_args: topArgs }) }) };
    },
    emitCanvas: async payload => { emitted = payload; return {}; },
  });
  assert.equal(result.ok, true);
  // The real canvas/main delivery overlays these fields before mounting.
  const envelope = { ...emitted.envelope, operation_ref: emitted.operationRef, operation_args: emitted.operationArgs };
  const target = context.boardHydrateTarget(envelope, {});
  return { emitted, envelope, responseEnvelope, body: buildHydrateBody({ boardId: '15J9-2', target }) };
}

test('verified sector criteria survive inline delivery and the next hydration', async () => {
  const args = { mrkt_tp: '0', inds_cd: '013', stex_tp: '1' };
  const out = await deliver(args, { mrkt_tp: '0', inds_cd: '001' });
  assert.deepEqual(out.emitted.operationArgs, args);
  assert.deepEqual(out.body.target, args);
  assert.deepEqual(out.responseEnvelope.operation_args, args);
});

test('table issuer and sort criteria are preserved from the verified envelope', async () => {
  const args = { sort_tp: '5', isscomp_cd: '003', lpcd: '007', bsis_aset_cd: '201' };
  assert.deepEqual((await deliver(args)).body.target, args);
});

test('missing criteria do not borrow the unverified request; legacy top metadata remains compatible', async () => {
  assert.equal((await deliver(undefined)).body.target, undefined);
  assert.deepEqual((await deliver(undefined, { inds_cd: '002' })).body.target, { inds_cd: '002' });
  assert.equal((await deliver({}, { inds_cd: '002' })).body.target, undefined);
});
