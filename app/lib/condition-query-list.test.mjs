import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { viewModel } = createRequire(import.meta.url)('./condition-query-list');

test('all received saved conditions survive the three-slot and fifty-record limits', () => {
  const records = Array.from({ length: 63 }, (_, n) => ({ seq: String(n), name: `합성 조건 ${n}`, secret: 'excluded' }));
  const model = viewModel({ operation_ref: 'base:ka10171', data: { lifecycle: 'completed', records } });
  assert.equal(model.rows.length, 63);
  assert.deepEqual(model.rows[62], ['62', '합성 조건 62']);
  assert.equal(JSON.stringify(model).includes('excluded'), false);
});

test('one-shot results keep zero volume and only approved fields without inventing missing values', () => {
  const model = viewModel({ operation_ref: 'base:ka10172', data: { lifecycle: 'completed', has_more: true,
    records: [{ '9001': 'A100001', '302': '<script>합성</script>', '10': null, '13': 0, hidden: 'excluded' }] } });
  assert.deepEqual(model.rows, [['A100001', '<script>합성</script>', '—', '0']]);
  assert.equal(model.hasMore, true);
  const prices = viewModel({ operation_ref: 'base:ka10172', data: { lifecycle: 'completed',
    records: [{ '10': '-001234', '13': '0' }, { '10': '000000', '13': 0 }] } });
  assert.deepEqual(prices.rows.map(row => row.slice(2)), [['1,234', '0'], ['—', '0']]);
});

test('empty query is explicit and live commands or failed reads never create a result panel', () => {
  assert.deepEqual(viewModel({ operation_ref: 'base:ka10171', data: { lifecycle: 'completed', records: [] } }).rows, []);
  for (const operation_ref of ['base:ka10173', 'base:ka10174', 'base:0B']) {
    assert.equal(viewModel({ operation_ref, data: { lifecycle: 'completed', records: [] } }), null);
  }
  assert.equal(viewModel({ operation_ref: 'base:ka10171', data: { lifecycle: 'error', records: [] } }), null);
});
