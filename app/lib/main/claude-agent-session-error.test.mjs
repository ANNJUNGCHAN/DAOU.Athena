import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { userFacingProviderError } = require('./claude-agent-session');

test('expired Claude OAuth session points to the supported reauthentication path', () => {
  assert.equal(
    userFacingProviderError('Failed to authenticate: OAuth session expired and could not be refreshed'),
    'Claude 인증이 만료되었습니다. 설정 > 모델에서 Claude 계정의 ‘재인증’을 눌러 로그인을 완료한 뒤 다시 요청해 주세요.',
  );
});

test('unrelated authentication failures retain their provider detail', () => {
  for (const detail of [
    '401 Unauthorized',
    'Failed to authenticate',
    'OAuth token refresh failed',
    'Failed to authenticate: OAuth session expired and could not be refreshed; transport closed',
  ]) {
    assert.equal(userFacingProviderError(detail), detail);
  }
});
