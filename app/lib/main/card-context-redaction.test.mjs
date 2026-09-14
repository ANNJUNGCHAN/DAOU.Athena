import test from 'node:test';
import assert from 'node:assert/strict';

import cardContext from './active-card-context.js';

const { buildActiveCardContext } = cardContext;

function card(envelope) {
  return {
    cardId: 'account-card',
    kind: 'account',
    createdAt: '2026-09-14T01:00:00.000Z',
    envelope,
  };
}

function contract(slotValues) {
  return {
    canvas_type: 'account',
    surface_contract: {
      slot_values: slotValues,
      kiumi: {
        elements: [
          { source_slot_id: 's-auth', label: 'API token' },
          { source_slot_id: 's-balance', label: '잔고' },
        ],
      },
      presentation: {
        slots: [{
          slot_id: 's-account',
          f: 'acnt_nm',
          alt_mappings: [{ f: 'acnt_no', kor: '계좌번호' }],
        }],
      },
    },
  };
}

test('linked sensitive slot values are redacted for array and map contracts without mutating cards', () => {
  for (const slotValues of [
    [
      { slot_id: 's-account', value: 'TEST_ACCOUNT_VALUE' },
      { slot_id: 's-auth', value: 'secret-token' },
      { slot_id: 's-balance', value: 5032100 },
    ],
    { 's-account': 'TEST_ACCOUNT_VALUE', 's-auth': 'secret-token', 's-balance': 5032100 },
  ]) {
    const envelope = contract(slotValues);
    const original = structuredClone(envelope);
    const context = buildActiveCardContext({ cards: [card(envelope)] });
    const serialized = JSON.stringify(context);

    assert.equal(serialized.includes('TEST_ACCOUNT_VALUE'), false);
    assert.equal(serialized.includes('secret-token'), false);
    assert.equal(serialized.includes('5032100'), true);
    assert.deepEqual(envelope, original);
  }
});

test('singular table headers redact the matching row cell and preserve ordinary financial values', () => {
  const envelope = {
    canvas_type: 'table',
    header: ['계좌번호', '현재가', '잔고'],
    rows: [['TEST_ACCOUNT_VALUE', 40950, 5032100]],
  };
  const context = buildActiveCardContext({ cards: [card(envelope)] });

  assert.deepEqual(context.cards[0].envelope.rows[0], ['[redacted]', 40950, 5032100]);
  assert.equal(envelope.rows[0][0], 'TEST_ACCOUNT_VALUE');
});

test('selected linked slot primitives and observations cannot bypass metadata redaction', () => {
  for (const { slotValues, path } of [
    {
      slotValues: [
        { slot_id: 's-account', value: 'TEST_ACCOUNT_VALUE' },
        { slot_id: 's-balance', value: 5032100 },
      ],
      path: 'surface_contract.slot_values.0.value',
    },
    {
      slotValues: { 's-account': 'TEST_ACCOUNT_VALUE', 's-balance': 5032100 },
      path: 'surface_contract.slot_values.s-account',
    },
  ]) {
    const context = buildActiveCardContext({
      cards: [card(contract(slotValues))],
      requested: {
        selectedCardId: 'account-card',
        selectionMode: 'explicit-component',
        selectedComponent: { path, label: '계좌번호' },
        observation: {
          cardId: 'account-card',
          path,
          observedAt: '2026-09-14T01:00:01.000Z',
          source: 'renderer-visible',
          text: 'TEST_ACCOUNT_VALUE',
        },
      },
    });

    assert.equal(context.selection.value, '[redacted]');
    assert.equal(context.selection.label, '[redacted]');
    assert.equal(context.observationStatus, 'invalid');
    assert.equal(context.observation, null);
    assert.equal(JSON.stringify(context).includes('TEST_ACCOUNT_VALUE'), false);
  }
});

test('camel-case renderer contract aliases receive the same linked redaction', () => {
  const envelope = {
    canvas_type: 'account',
    surfaceContract: {
      slotValues: { s003: 'TEST_ACCOUNT_VALUE', s004: 40950 },
      elements: [
        { sourceSlotId: 's003', f: 'acctNo', label: '기본 식별값' },
        { sourceSlotId: 's004', label: '현재가' },
      ],
    },
  };
  const context = buildActiveCardContext({
    cards: [card(envelope)],
    requested: {
      selectedCardId: 'account-card',
      selectedComponent: { path: 'surfaceContract.slotValues.s003', label: '계좌번호' },
      observation: {
        cardId: 'account-card',
        path: 'surfaceContract.slotValues.s003',
        observedAt: '2026-09-14T01:00:01.000Z',
        source: 'renderer-visible',
        text: 'TEST_ACCOUNT_VALUE',
      },
    },
  });

  assert.equal(context.selection.value, '[redacted]');
  assert.equal(context.observationStatus, 'invalid');
  assert.equal(JSON.stringify(context).includes('TEST_ACCOUNT_VALUE'), false);
  assert.equal(envelope.surfaceContract.slotValues.s003, 'TEST_ACCOUNT_VALUE');
});

test('invalid selected paths reject observations instead of throwing', () => {
  assert.doesNotThrow(() => buildActiveCardContext({
    cards: [card(contract({ 's-account': 'TEST_ACCOUNT_VALUE' }))],
    requested: {
      selectedCardId: 'account-card',
      selectedComponent: { path: 'surface_contract..slot_values', label: '깨진 경로' },
      observation: {
        cardId: 'account-card',
        path: 'surface_contract..slot_values',
        observedAt: '2026-09-14T01:00:01.000Z',
        source: 'renderer-visible',
        text: 'TEST_ACCOUNT_VALUE',
      },
    },
  }));
});

test('selected sensitive containers retain slot and table schema redaction', () => {
  const cases = [
    {
      envelope: contract([
        { slot_id: 's-account', value: 'slot-secret' },
        { slot_id: 's-balance', value: 5032100 },
      ]),
      paths: ['surface_contract.slot_values'],
      secret: 'slot-secret',
    },
    {
      envelope: contract({ 's-account': 'map-secret', 's-balance': 5032100 }),
      paths: ['surface_contract.slot_values'],
      secret: 'map-secret',
    },
    {
      envelope: {
        canvas_type: 'account',
        surfaceContract: {
          slotValues: { s003: 'camel-map-secret', s004: 40950 },
          elements: [
            { sourceSlotId: 's003', f: 'acctNo' },
            { sourceSlotId: 's004', label: '현재가' },
          ],
        },
      },
      paths: ['surfaceContract.slotValues'],
      secret: 'camel-map-secret',
    },
    {
      envelope: {
        canvas_type: 'table',
        data: { headers: ['계좌번호', '잔고'], rows: [['row-secret', 5032100]] },
      },
      paths: ['data.rows', 'data.rows.0', 'data.rows.0.0'],
      secret: 'row-secret',
    },
  ];

  for (const { envelope, paths, secret } of cases) {
    for (const path of paths) {
      const context = buildActiveCardContext({
        cards: [card(envelope)],
        requested: {
          selectedCardId: 'account-card',
          selectedComponent: { path, label: '선택값' },
          observation: {
            cardId: 'account-card', path, observedAt: '2026-09-14T01:00:01.000Z',
            source: 'renderer-visible', text: secret,
          },
        },
      });
      assert.equal(JSON.stringify(context.selection.value).includes(secret), false, path);
      assert.equal(context.observationStatus, 'invalid', path);
    }
  }
});

test('selected field records keep their discriminator for value and observation redaction', () => {
  const envelope = {
    canvas_type: 'account',
    records: [
      { key: 'acnt_no', label: '계좌번호', value: 'record-secret' },
      { key: 'balance', label: '잔고', value: 5032100 },
    ],
  };

  for (const path of ['records', 'records.0', 'records.0.value']) {
    const context = buildActiveCardContext({
      cards: [card(envelope)],
      requested: {
        selectedCardId: 'account-card',
        selectedComponent: { path, label: '선택값' },
        observation: {
          cardId: 'account-card', path, observedAt: '2026-09-14T01:00:01.000Z',
          source: 'renderer-visible', text: 'record-secret',
        },
      },
    });
    assert.equal(JSON.stringify(context.selection.value).includes('record-secret'), false, path);
    assert.equal(context.observationStatus, 'invalid', path);
  }

  const labelOnly = buildActiveCardContext({
    cards: [card({ canvas_type: 'quote', current_price: 40950 })],
    requested: {
      selectedCardId: 'account-card',
      selectedComponent: { path: 'current_price', label: '계좌번호' },
      observation: {
        cardId: 'account-card', path: 'current_price', observedAt: '2026-09-14T01:00:01.000Z',
        source: 'renderer-visible', text: 'TEST_ACCOUNT_VALUE',
      },
    },
  });
  assert.equal(labelOnly.selection.value, 40950);
  assert.equal(labelOnly.selection.label, '[redacted]');
  assert.equal(labelOnly.observationStatus, 'invalid');
});

test('actual surface presentation aliases redact values and exact selected observations', () => {
  const envelope = {
    canvas_type: 'account',
    records: [{
      slot_id: 's003',
      f: 'acnt_nm',
      kor: '계좌번호',
      paper_text: 'TEST_ACCOUNT_VALUE',
      node_name: '계좌 TEST_ACCOUNT_VALUE',
      paper_text_override: 'TEST_ACCOUNT_OVERRIDE',
    }],
  };

  const whole = buildActiveCardContext({ cards: [card(envelope)] });
  const serialized = JSON.stringify(whole);
  for (const secret of ['TEST_ACCOUNT_VALUE', '계좌 TEST_ACCOUNT_VALUE', 'TEST_ACCOUNT_OVERRIDE']) {
    assert.equal(serialized.includes(secret), false, secret);
  }

  for (const path of ['records.0.paper_text', 'records.0.node_name', 'records.0.paper_text_override']) {
    const selected = buildActiveCardContext({
      cards: [card(envelope)],
      requested: {
        selectedCardId: 'account-card',
        selectedComponent: { path, label: '식별값' },
        observation: {
          cardId: 'account-card', path, observedAt: '2026-09-14T01:00:01.000Z',
          source: 'renderer-visible', text: 'TEST_ACCOUNT_VALUE',
        },
      },
    });
    assert.equal(selected.selection.value, '[redacted]', path);
    assert.equal(selected.observationStatus, 'invalid', path);
  }
  assert.equal(envelope.records[0].paper_text, 'TEST_ACCOUNT_VALUE');
});

test('camel presentation aliases follow the same discriminator and value policy', () => {
  const context = buildActiveCardContext({
    cards: [card({
      canvas_type: 'account',
      records: [{ headerKo: '계좌번호', paperText: 'camel-secret', nodeName: 'camel-node-secret' }],
    })],
  });
  const serialized = JSON.stringify(context);
  assert.equal(serialized.includes('camel-secret'), false);
  assert.equal(serialized.includes('camel-node-secret'), false);
});

test('metadata scans stay bounded for deep and broad hostile envelopes', () => {
  let deep = { value: 'leaf' };
  for (let index = 0; index < 12_000; index += 1) deep = { next: deep };
  assert.doesNotThrow(() => buildActiveCardContext({ cards: [card(deep)] }));

  const broad = {
    canvas_type: 'account',
    branches: Array.from({ length: 240 }, (_, outer) => ({
      children: Array.from({ length: 20 }, (_, inner) => ({ outer, inner, value: 40950 })),
    })),
    surface_contract: {
      slot_values: { s003: 'must-not-escape' },
      elements: [{ source_slot_id: 's003', label: '계좌번호' }],
    },
  };
  const context = buildActiveCardContext({ cards: [card(broad)] });
  assert.equal(context.truncated, true);
  assert.equal(JSON.stringify(context).includes('must-not-escape'), false);
});

test('omitted metadata fails linked slot projection closed without mutating its source', () => {
  const omittedArray = Array.from({ length: 241 }, (_, index) => (index === 0
    ? { source_slot_id: 's-account', label: '계좌번호' }
    : { source_slot_id: `safe-${index}`, label: '현재가' }));
  const omittedObject = Object.fromEntries([
    ...Array.from({ length: 80 }, (_, index) => [`safe${index}`, {
      sourceSlotId: `safe-${index}`, label: '현재가',
    }]),
    ['hiddenSensitive', { sourceSlotId: 's-account', f: 'acctNo' }],
  ]);

  for (const envelope of [
    {
      canvas_type: 'account',
      surface_contract: {
        elements: omittedArray,
        slot_values: { 's-account': 'omitted-array-secret', 's-balance': 5032100 },
      },
    },
    {
      canvas_type: 'account',
      surfaceContract: {
        descriptors: omittedObject,
        slotValues: { 's-account': 'omitted-object-secret', 's-balance': 5032100 },
      },
    },
  ]) {
    const original = structuredClone(envelope);
    const secret = JSON.stringify(envelope).match(/omitted-(?:array|object)-secret/u)[0];
    const base = buildActiveCardContext({ cards: [card(envelope)] });
    assert.equal(JSON.stringify(base).includes(secret), false);

    const prefix = envelope.surface_contract ? 'surface_contract.slot_values' : 'surfaceContract.slotValues';
    for (const path of [prefix, `${prefix}.s-account`]) {
      const selected = buildActiveCardContext({
        cards: [card(envelope)],
        requested: {
          selectedCardId: 'account-card',
          selectedComponent: { path, label: '선택값' },
          observation: {
            cardId: 'account-card', path, observedAt: '2026-09-14T01:00:01.000Z',
            source: 'renderer-visible', text: secret,
          },
        },
      });
      assert.equal(JSON.stringify(selected).includes(secret), false, path);
      assert.equal(selected.observationStatus, 'invalid', path);
    }
    assert.deepEqual(envelope, original);
  }
});

test('selected subtree observations fail closed when sensitive metadata is omitted by bounds', () => {
  const rows = Array.from({ length: 241 }, (_, index) => (index === 0
    ? { label: '계좌번호', value: 'omitted-row-secret' }
    : { label: '현재가', value: 40950 + index }));
  const keyed = Object.fromEntries([
    ...Array.from({ length: 80 }, (_, index) => [`price${index}`, 40950 + index]),
    ['account_no', 'omitted-key-secret'],
  ]);

  for (const { data, secret } of [
    { data: { rows }, secret: 'omitted-row-secret' },
    { data: keyed, secret: 'omitted-key-secret' },
  ]) {
    const context = buildActiveCardContext({
      cards: [card({ canvas_type: 'account', data })],
      requested: {
        selectedCardId: 'account-card',
        selectedComponent: { path: 'data', label: '선택 영역' },
        observation: {
          cardId: 'account-card', path: 'data', observedAt: '2026-09-14T01:00:01.000Z',
          source: 'renderer-visible', text: `계좌번호 ${secret}`,
        },
      },
    });
    assert.equal(context.observationStatus, 'invalid');
    assert.equal(context.observation, null);
    assert.equal(JSON.stringify(context).includes(secret), false);
  }
});
