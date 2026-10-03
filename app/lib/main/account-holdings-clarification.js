'use strict';

const REF = 'detail:kt00018:holdings';
const MODES = Object.freeze({ '합산': '1', '개별': '2' });
const EXCHANGES = Object.freeze({ KRX: 'KRX', '한국거래소': 'KRX', NXT: 'NXT', '넥스트레이드': 'NXT' });
const idle = () => ({ state: null, request: null });
const normalize = value => String(value || '').normalize('NFKC').trim().toUpperCase();

function choices(text, followup) {
  const args = {};
  let conflict = /(?:말고|제외|아닌|않|NOT\b|EXCEPT\b)/u.test(text);
  function accept(key, value) {
    if (args[key] && args[key] !== value) conflict = true;
    args[key] = value;
  }
  let rest = text.replace(/(?<![A-Z0-9])(?:거래소\s*[:：]?\s*)?(KRX|NXT|한국거래소|넥스트레이드)(?![A-Z0-9])(?:에서|으로|로)?/gu,
    (_match, value) => { accept('dmst_stex_tp', EXCHANGES[value]); return ''; });
  const mode = followup ? /(?:조회\s*구분\s*[:：]?\s*)?(합산|개별)(?:으로|로)?/gu
    : /(?:조회\s*구분\s*[:：]?\s*(합산|개별)|(합산|개별)\s*조회)/gu;
  rest = rest.replace(mode, (_match, first, second) => {
    accept('qry_tp', MODES[first || second]); return '';
  });
  const related = Object.keys(args).length > 0;
  const completeReply = !rest.replace(/(?:조회|선택)?\s*(?:해\s*줘|해\s*주세요|해주세요|부탁해요)|그리고|또는|및|와|과|[\s,.!?/·:：]/gu, '');
  return { args: conflict ? {} : args, conflict, related, completeReply };
}

function outcome(state) {
  const args = state.arguments;
  if (args.qry_tp && args.dmst_stex_tp) {
    const mode = args.qry_tp === '1' ? '합산' : '개별';
    return { state: null, request: { accountId: state.accountId,
      question: `${state.question} (조회 구분: ${mode}, 거래소: ${args.dmst_stex_tp})`,
      options: { arguments: { ...args }, candidateRefs: [REF], preferredRef: REF } } };
  }
  const needed = [];
  if (!args.qry_tp) needed.push('조회 구분(합산 또는 개별)');
  if (!args.dmst_stex_tp) needed.push('거래소(KRX 또는 NXT)');
  const selected = args.qry_tp ? ` 조회 구분은 ${args.qry_tp === '1' ? '합산' : '개별'}입니다.`
    : args.dmst_stex_tp ? ` 거래소는 ${args.dmst_stex_tp}입니다.` : '';
  return { state, request: null,
    answerText: `보유 종목 평가 손익을 조회하려면 ${needed.join('과 ')}를 선택해 주세요.${selected}` };
}

function begin(question, preflight, { conversationId, accountId } = {}) {
  const candidates = preflight?.candidates;
  if (!conversationId || !accountId || preflight?.status !== 'needs_inference'
    || preflight.code !== 'INVALID_ARGUMENTS' || candidates?.length !== 1) return idle();
  const candidate = candidates[0];
  const required = candidate.required_arguments?.map(field => field.alias).sort();
  if (candidate.operation_ref !== REF || candidate.kind !== 'query'
    || JSON.stringify(required) !== JSON.stringify(['dmst_stex_tp', 'qry_tp'])) return idle();
  return outcome({ operationRef: REF, conversationId, accountId,
    question, arguments: choices(normalize(question), false).args });
}

function resume(question, state, { conversationId, accountId, blocked = false } = {}) {
  if (blocked || !state || state.operationRef !== REF || !accountId
    || state.conversationId !== conversationId || state.accountId !== accountId) return idle();
  const text = normalize(question);
  if (/^(?:취소|그만|CANCEL)[.!]?$/u.test(text)) return { ...idle(), status: 'cancelled', answerText: '조회 조건 선택을 취소했습니다.' };
  const parsed = choices(text, true);
  if (!parsed.related) return idle();
  if (!parsed.completeReply && !parsed.conflict) return idle();
  return outcome({ ...state, arguments: { ...state.arguments, ...parsed.args } });
}

function reply(answerText, status = 'needs_input') {
  return { ok: true, source: 'account-holdings-clarification', status, error: null,
    answerText, canvasTypes: [], modelCalls: 0 };
}

module.exports = { REF, begin, resume, reply };
