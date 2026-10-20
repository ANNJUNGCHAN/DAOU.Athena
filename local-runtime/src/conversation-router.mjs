import {
  CONVERSATION_UNSUPPORTED_MESSAGE,
} from '../../contracts/wts-foundation.mjs';

import { compileTaskInput, normalizeTaskInput } from './task-compiler.mjs';

const SOURCE_SEARCH_PREFIX = '조회 기능 찾아줘: ';
const MIN_SOURCE_QUERY_LENGTH = 2;
const MAX_SOURCE_QUERY_LENGTH = 500;

export function routeConversation({ submissionId, text }) {
  if (compileTaskInput(text) !== null) {
    return {
      submissionId,
      kind: 'wts-control',
      text: normalizeTaskInput(text),
    };
  }

  if (text.startsWith(SOURCE_SEARCH_PREFIX)) {
    const query = text.slice(SOURCE_SEARCH_PREFIX.length).trim();
    if (query.length >= MIN_SOURCE_QUERY_LENGTH && query.length <= MAX_SOURCE_QUERY_LENGTH) {
      return { submissionId, kind: 'source-search', query };
    }
  }

  return {
    submissionId,
    kind: 'unsupported',
    message: CONVERSATION_UNSUPPORTED_MESSAGE,
  };
}

