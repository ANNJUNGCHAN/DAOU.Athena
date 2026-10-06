import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import graphEditProposal from './graph-edit-proposal.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const {
  normalizeProposal,
  proposalMutation,
} = graphEditProposal;

test('add apply preserves the exact direct-mutation payload', () => {
  const item = normalizeProposal({
    op: 'add',
    object: '삼성전자',
    relation: 'researched',
    subjectId: 'entity:investor-profile',
    objectId: 'entity:samsung',
    reason: '이번 대화에서는 조회만 했다',
  });

  assert.deepEqual(proposalMutation(item, 'apply'), {
    type: 'add',
    payload: {
      subjectId: 'entity:investor-profile',
      objectId: 'entity:samsung',
      kind: 'researched',
      rationale: '이번 대화에서는 조회만 했다',
    },
  });
});

test('reject and skip preserve the current unconfirmed state', () => {
  const item = normalizeProposal({
    op: 'remove',
    object: '삼성전자',
    relation: 'interested_in',
    relationId: 'relation:ambiguous-interest',
  });

  assert.equal(proposalMutation(item, 'reject'), null);
  assert.equal(proposalMutation(item, 'skip'), null);
});

test('missing ids and unsupported change fail closed', () => {
  assert.equal(normalizeProposal({
    op: 'remove', object: '삼성전자', relation: 'interested_in',
  }), null);
  assert.equal(normalizeProposal({
    op: 'add', object: '삼성전자', relation: 'researched', objectId: 'entity:samsung',
  }), null);
  assert.equal(normalizeProposal({
    op: 'change', object: '삼성전자', relation: 'researched',
    subjectId: 'entity:investor-profile', objectId: 'entity:samsung',
  }), null);
});

test('proposal answer handler never dispatches a synthetic user query', () => {
  const source = fs.readFileSync(path.join(here, '..', '..', 'chat.js'), 'utf8');
  const start = source.indexOf('function answerGraphEditProposal(choice)');
  const end = source.indexOf('function appendSystemLine', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const handler = source.slice(start, end);

  assert.doesNotMatch(handler, /dispatchUserQuery\s*\(/);
  assert.match(handler, /choice !== 'apply'/);
  assert.match(handler, /proposalMutation/);
});
