import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { edgeRelationEvidence } = require('./controller.js');

test('merged edge relations keep each kind paired with its own provenance', () => {
  const evidence = edgeRelationEvidence({
    source: 'security:samsung',
    target: 'theme:semiconductor',
    kinds: ['belongs_to', 'relates_to'],
    tier: 'manual',
    confidence: 'EXTRACTED',
    observed_at: '2026-10-02T09:00:00+00:00',
    relations: [
      {
        source: 'security:samsung',
        target: 'theme:semiconductor',
        kind: 'belongs_to',
        tier: 'manual',
        confidence: 'EXTRACTED',
        source_id: 'manual:edit-1',
        observed_at: '2026-10-02T09:00:00+00:00',
      },
      {
        source: 'security:samsung',
        target: 'theme:semiconductor',
        kind: 'relates_to',
        tier: 'conversational',
        confidence: 'AMBIGUOUS',
        source_id: 'chat:question-1',
        observed_at: '2026-10-01T09:00:00+00:00',
      },
    ],
  });

  assert.deepEqual(evidence, [
    {
      source: 'security:samsung',
      target: 'theme:semiconductor',
      kind: 'belongs_to',
      tier: 'manual',
      confidence: 'EXTRACTED',
      sourceId: 'manual:edit-1',
      observedAt: '2026-10-02T09:00:00+00:00',
    },
    {
      source: 'security:samsung',
      target: 'theme:semiconductor',
      kind: 'relates_to',
      tier: 'conversational',
      confidence: 'AMBIGUOUS',
      sourceId: 'chat:question-1',
      observedAt: '2026-10-01T09:00:00+00:00',
    },
  ]);
});

test('legacy aggregate edge remains readable during rolling upgrades', () => {
  assert.deepEqual(edgeRelationEvidence({
    source: 'security:samsung',
    target: 'theme:semiconductor',
    kinds: ['belongs_to'],
    tier: 'conversational',
    confidence: 'INFERRED',
    observed_at: '2026-09-01T09:00:00+00:00',
  }), [{
    source: 'security:samsung',
    target: 'theme:semiconductor',
    kind: 'belongs_to',
    tier: 'conversational',
    confidence: 'INFERRED',
    sourceId: undefined,
    observedAt: '2026-09-01T09:00:00+00:00',
  }]);
});
