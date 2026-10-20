import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONVERSATION_UNSUPPORTED_MESSAGE,
} from '../../contracts/wts-foundation.mjs';
import { routeConversation } from '../src/conversation-router.mjs';

const submissionId = '77efbb4a-f12a-4ea7-a4d0-18f252a57866';

test('routes only complete chart or fixed market compiler inputs and returns normalized text', () => {
  assert.deepEqual(routeConversation({ submissionId, text: '차트   열고   주봉으로' }), {
    submissionId,
    kind: 'wts-control',
    text: '차트 열고 주봉으로',
  });
  assert.deepEqual(routeConversation({ submissionId, text: '월봉으로, 년봉으로 바꿔줘' }), {
    submissionId,
    kind: 'wts-control',
    text: '월봉으로, 년봉으로 바꿔줘',
  });
  assert.deepEqual(routeConversation({
    submissionId,
    text: '시장   메뉴   열어줘:   투자자별/프로그램   >   종목별투자자',
  }), {
    submissionId,
    kind: 'wts-control',
    text: '시장 메뉴 열어줘: 투자자별/프로그램 > 종목별투자자',
  });
});

test('routes only the exact source-search prefix with a trimmed 2-500 character query', () => {
  assert.deepEqual(routeConversation({ submissionId, text: '조회 기능 찾아줘:   종목 조회' }), {
    submissionId,
    kind: 'source-search',
    query: '종목 조회',
  });
  assert.equal(
    routeConversation({ submissionId, text: `조회 기능 찾아줘: ${'가'.repeat(500)}` }).kind,
    'source-search',
  );

  for (const text of [
    '조회 기능 찾아줘: 가',
    `조회 기능 찾아줘: ${'가'.repeat(501)}`,
    '조회 기능 찾아줘: ',
    '조회기능 찾아줘: 종목 조회',
    '조회 기능 찾아줘:종목 조회',
  ]) {
    assert.deepEqual(routeConversation({ submissionId, text }), {
      submissionId,
      kind: 'unsupported',
      message: CONVERSATION_UNSUPPORTED_MESSAGE,
    });
  }
});

test('mixed, negative, incomplete, and execution-like text stays unsupported', () => {
  for (const text of [
    '차트 열어줘 그리고 매수',
    '차트 열지 마',
    '005930 차트 열어줘',
    '차트 열어줘 그리고 조회 기능 찾아줘: 종목 조회',
    '매수해줘',
    'https://evil.example',
  ]) {
    assert.deepEqual(routeConversation({ submissionId, text }), {
      submissionId,
      kind: 'unsupported',
      message: CONVERSATION_UNSUPPORTED_MESSAGE,
    });
  }
});

