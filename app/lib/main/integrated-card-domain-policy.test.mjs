import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { publicPolicies, resolveLeaseBindings } = require('./integrated-card-realtime.js');

const accountAlias = { backendAccountAlias: 'server-a' };

function resolve(config) {
  return resolveLeaseBindings({ ...accountAlias, ...config });
}

test('32S7 index-chart REST authority selects sector feeds and its three-digit index target', () => {
  const bindings = resolve({
    leaseId: 'index-chart',
    cardId: 'CC-03',
    mode: 'chart',
    indexSectorId: '001',
    symbol: '005930',
    target: '999',
    verifiedOperationRefs: [
      'base:ka20004', 'base:ka20005', 'base:ka20006',
      'base:ka20007', 'base:ka20008', 'base:ka20019',
    ],
  });

  assert.deepEqual(
    bindings.map((binding) => `${binding.operationId}:${binding.target}`),
    ['0J:001', '0U:001'],
  );
});

test('stock-chart REST authority remains on stock executions and cannot be coerced into an index lease', () => {
  assert.deepEqual(
    resolve({
      leaseId: 'stock-chart',
      cardId: 'CC-03',
      mode: 'chart',
      symbol: '005930',
      verifiedOperationRefs: ['base:ka10081'],
    }).map((binding) => `${binding.operationId}:${binding.target}`),
    ['0B:005930'],
  );

  assert.throws(() => resolve({
    leaseId: 'missing-index-target',
    cardId: 'CC-03',
    mode: 'chart',
    symbol: '001',
    verifiedOperationRefs: ['base:ka20004'],
  }), /indexSector realtime target is required/);

  assert.throws(() => resolve({
    leaseId: 'cross-domain-operation',
    cardId: 'CC-03',
    mode: 'chart',
    indexSectorId: '001',
    symbol: '005930',
    verifiedOperationRefs: ['base:ka20004', 'base:ka10081'],
  }), /mixed chart realtime authority/);

  assert.throws(() => resolve({
    leaseId: 'cross-domain-websocket',
    cardId: 'CC-03',
    mode: 'chart',
    indexSectorId: '001',
    verifiedOperationRefs: ['base:ka20004', 'base:0B'],
  }), /mixed chart realtime authority/);

  assert.throws(() => resolve({
    leaseId: 'cross-domain-momentum',
    cardId: 'CC-03',
    mode: 'chart',
    indexSectorId: '001',
    symbol: '005930',
    verifiedOperationRefs: ['base:ka20004', 'base:0A'],
  }), /mixed chart realtime authority/);

  assert.throws(() => resolve({
    leaseId: 'stock-with-sector-feed',
    cardId: 'CC-03',
    mode: 'chart',
    indexSectorId: '001',
    symbol: '005930',
    verifiedOperationRefs: ['base:ka10081', 'base:0J'],
  }), /mixed chart realtime authority/);
});

test('all 19 streaming data operations retain a reachable primary-card policy', () => {
  const fixtures = {
    '00': { cardId: 'CC-01', mode: 'overview', accountId: 'ACC-1' },
    '04': { cardId: 'CC-01', mode: 'overview', accountId: 'ACC-1' },
    '0A': { cardId: 'CC-03', mode: 'quote', symbol: '005930' },
    '0B': { cardId: 'CC-03', mode: 'quote', symbol: '005930' },
    '0C': { cardId: 'CC-04', mode: 'regular', symbol: '005930' },
    '0D': { cardId: 'CC-04', mode: 'regular', symbol: '005930' },
    '0E': { cardId: 'CC-04', mode: 'after-hours', symbol: '005930' },
    '0F': { cardId: 'CC-05', mode: 'broker', symbol: '005930' },
    '0G': { cardId: 'CC-03', mode: 'etf', symbol: '069500' },
    '0H': { cardId: 'CC-03', mode: 'expected', symbol: '005930' },
    '0I': { cardId: 'CC-03', mode: 'gold', target: 'GOLD' },
    '0J': { cardId: 'CC-06', mode: 'sector', sectorId: '001' },
    '0U': { cardId: 'CC-06', mode: 'sector', sectorId: '001' },
    '0g': { cardId: 'CC-03', mode: 'profile', symbol: '005930' },
    '0m': { cardId: 'CC-03', mode: 'elw', symbol: '52M504' },
    '0s': { cardId: 'CC-06', mode: 'market-status', target: 'MARKET' },
    '0u': { cardId: 'CC-03', mode: 'elw', symbol: '52M504' },
    '0w': { cardId: 'CC-05', mode: 'program', symbol: '005930' },
    '1h': { cardId: 'CC-06', mode: 'vi', target: 'MARKET' },
  };

  assert.equal(Object.keys(fixtures).length, 19);
  for (const [operationId, fixture] of Object.entries(fixtures)) {
    const bindings = resolve({
      leaseId: `direct-${operationId}`,
      ...fixture,
      verifiedOperationRefs: [`base:${operationId}`],
    });
    assert.equal(bindings.some((binding) => binding.operationId === operationId), true, operationId);
  }

  const policies = publicPolicies();
  for (const operationId of Object.keys(fixtures)) {
    assert.equal(policies.some((policy) => policy.operationId === operationId), true, operationId);
  }
});

test('verified REST query families opt into only their board-declared compatible feeds', () => {
  const operationIds = (config) => resolve(config).map((binding) => binding.operationId);

  assert.equal(operationIds({
    cardId: 'CC-05', mode: 'program', symbol: '005930',
    verifiedOperationRefs: ['base:ka90008'],
  }).includes('0F'), false);
  assert.equal(operationIds({
    cardId: 'CC-05', mode: 'broker', symbol: '005930',
    verifiedOperationRefs: ['base:ka10043'],
  }).includes('0w'), true);
  assert.equal(operationIds({
    cardId: 'CC-05', mode: 'investor', symbol: '005930',
    verifiedOperationRefs: ['base:ka10059'],
  }).includes('0w'), true);
  assert.equal(operationIds({
    cardId: 'CC-05', mode: 'credit-lending-short', symbol: '005930',
    verifiedOperationRefs: ['base:ka10013'],
  }).includes('0w'), true);
  assert.equal(operationIds({
    cardId: 'CC-05', mode: 'broker', symbol: '005930',
    verifiedOperationRefs: ['base:ka10038'],
  }).includes('0w'), false);

  assert.equal(operationIds({
    cardId: 'CC-03', mode: 'quote', symbol: '005930',
    verifiedOperationRefs: ['base:ka10046'],
  }).includes('0H'), true);
  assert.equal(operationIds({
    cardId: 'CC-03', mode: 'quote', symbol: '005930',
    verifiedOperationRefs: ['base:ka10005'],
  }).includes('0H'), false);
});

test('domestic gold chart REST authority remains disjoint from stock and international-gold feeds', () => {
  for (const operationId of ['ka50080', 'ka50092']) {
    assert.deepEqual(resolve({
      cardId: 'CC-03', mode: 'chart', symbol: 'M04020000',
      verifiedOperationRefs: [`base:${operationId}`],
    }), [], operationId);
  }
  assert.throws(() => resolve({
    cardId: 'CC-03', mode: 'chart', symbol: 'M04020000',
    verifiedOperationRefs: ['base:ka50080', 'base:0B'],
  }), /mixed chart realtime authority/);
  assert.throws(() => resolve({
    cardId: 'CC-03', mode: 'chart', symbol: 'M04020000',
    verifiedOperationRefs: ['base:ka50080', 'base:0I'],
  }), /mixed chart realtime authority/);
});
