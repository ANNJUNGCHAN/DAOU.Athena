import assert from 'node:assert/strict';
import test from 'node:test';

import { parseControlCandidate } from '../src/chatgpt-provider/control-candidate.mjs';

const MARKET = '시장 메뉴 열어줘: 시세분석 > 급등락';
const CATALOG = ['차트 열어줘', '주봉으로', '차트 열고 주봉으로', MARKET];

function candidate(assistantText, proposal) {
  return JSON.stringify({ assistantText, proposal });
}

test('accepts null and offered chart, compound and market proposals and freezes nested results', () => {
  for (const text of ['주봉으로', '차트 열고 주봉으로', MARKET]) {
    const result = parseControlCandidate(candidate('실행 전 제안입니다.', {
      kind: 'wts-control', text,
    }), { offeredCatalog: CATALOG });
    assert.equal(result.proposal.text, text);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.proposal), true);
  }
  const noProposal = parseControlCandidate(candidate('지원되는 명령이 아닙니다.', null), {
    offeredCatalog: CATALOG,
  });
  assert.deepEqual(noProposal, { assistantText: '지원되는 명령이 아닙니다.', proposal: null });
  assert.equal(Object.isFrozen(noProposal), true);
});

test('rejects missing, extra and mixed keys without a permissive parser', () => {
  const invalid = [
    '{}',
    JSON.stringify({ assistantText: 'x' }),
    JSON.stringify({ assistantText: 'x', proposal: null, extra: true }),
    JSON.stringify({ assistantText: 'x', proposal: { kind: 'wts-control' } }),
    JSON.stringify({ assistantText: 'x', proposal: { kind: 'wts-control', text: '주봉으로', extra: 1 } }),
    '```json\n{"assistantText":"x","proposal":null}\n```',
    '{"assistantText":"x","proposal":null} trailing',
    '[]',
  ];
  for (const value of invalid) {
    assert.throws(() => parseControlCandidate(value, { offeredCatalog: CATALOG }));
  }
});

test('requires canonical compiler input and exact offered-catalog membership', () => {
  assert.throws(() => parseControlCandidate(candidate('x', {
    kind: 'wts-control', text: '일봉으로',
  }), { offeredCatalog: CATALOG }), { code: 'CONTROL_CANDIDATE_NOT_OFFERED' });
  assert.throws(() => parseControlCandidate(candidate('x', {
    kind: 'wts-control', text: ' 주봉으로 ',
  }), { offeredCatalog: [...CATALOG, ' 주봉으로 '] }), { code: 'CONTROL_CANDIDATE_PROPOSAL_INVALID' });
  assert.throws(() => parseControlCandidate(candidate('x', {
    kind: 'wts-control', text: '매수해줘',
  }), { offeredCatalog: [...CATALOG, '매수해줘'] }), { code: 'CONTROL_CANDIDATE_PROPOSAL_INVALID' });
});

test('rejects order, code, shell, URL and arbitrary selector text as proposals', () => {
  for (const text of [
    '삼성전자 10주 매수', '<script>alert(1)</script>', 'document.querySelector("button").click()',
    'powershell Remove-Item file', 'https://example.com', '#buy-button',
  ]) {
    assert.throws(() => parseControlCandidate(candidate('x', {
      kind: 'wts-control', text,
    }), { offeredCatalog: [...CATALOG, text] }), { code: 'CONTROL_CANDIDATE_PROPOSAL_INVALID' });
  }
});

test('enforces scalar, UTF-8 byte and unpaired-surrogate limits', () => {
  assert.throws(() => parseControlCandidate(candidate('가'.repeat(2_731), null), {
    offeredCatalog: CATALOG,
  }));
  assert.throws(() => parseControlCandidate(candidate('\ud800', null), {
    offeredCatalog: CATALOG,
  }), { code: 'CONTROL_CANDIDATE_ASSISTANT_TEXT_INVALID' });
  assert.throws(() => parseControlCandidate(candidate('x', {
    kind: 'wts-control', text: '가'.repeat(513),
  }), { offeredCatalog: CATALOG }), { code: 'CONTROL_CANDIDATE_PROPOSAL_INVALID' });
});

test('assistant text is trimmed, non-empty display-only text', () => {
  for (const value of ['', '   ', ' 실행됨 ', '\udfff']) {
    assert.throws(() => parseControlCandidate(candidate(value, null), { offeredCatalog: CATALOG }));
  }
  const html = parseControlCandidate(candidate('<b>제안</b>', null), { offeredCatalog: CATALOG });
  assert.equal(html.assistantText, '<b>제안</b>');
  assert.equal(html.proposal, null);
});
