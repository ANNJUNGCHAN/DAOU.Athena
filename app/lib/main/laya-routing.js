'use strict';

const { randomUUID } = require('node:crypto');

const TICKET_TOOLS = Object.freeze([
  'athena_search', 'athena_describe', 'athena_resolve', 'athena_call',
  'athena_routine', 'athena_brain', 'athena_graph_view', 'athena_nudge_guard',
  'athena_plugin', 'athena__render_canvas', 'athena__save_canvas',
]);

function ticketPrompt(prompt, ticket, plan) {
  return `${prompt}\n\n[Athena 도구 연결]\n현재 턴의 opaque ticket: ${JSON.stringify(ticket)}\n`
    + `다음 Athena builtin 호출에만 _athena_turn_ticket 필드로 위 값을 그대로 복사한다: ${TICKET_TOOLS.join(', ')}. `
    + '백테스트 및 외부 플러그인 도구에는 붙이지 않는다. 이전 턴의 ticket은 재사용하지 않는다.\n'
    + (plan?.tool_name ? `서버가 선택한 도구/선택 항목: ${JSON.stringify({ tool_name: plan.tool_name, arguments: plan.arguments || {} })}. 아직 실행된 결과가 아니며, 부족한 입력은 기존 도구 계약에 따라 채운다.` : '');
}

function withoutTicket(value, ticket) {
  if (typeof value === 'string') return value.replaceAll(ticket, '[turn ticket]');
  if (Array.isArray(value)) return value.map(entry => withoutTicket(entry, ticket));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== '_athena_turn_ticket').map(([key, entry]) => [key, withoutTicket(entry, ticket)]));
  return value;
}

function directAnswer(result) {
  if (result.tool_name === 'athena_graph_view') return '요청한 그래프 화면 변경을 전달했습니다.';
  const unreadable = '조회를 완료했지만 결과 내용을 표시하지 못했습니다.';
  const blocks = result.result.content;
  let data;
  try {
    if (blocks.length !== 1 || blocks[0].type !== 'text') return unreadable;
    data = JSON.parse(blocks[0].text);
  } catch { return unreadable; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return unreadable;
  if (result.tool_name === 'athena_routine' && result.arguments?.action === 'list') {
    const statuses = { draft: '승인 대기', active: '활성', paused: '일시정지', expired: '기한 만료',
      cancelled: '취소', failed: '실패', completed: '완료' };
    if (!Array.isArray(data.routines) || data.routines.some(row => !row || typeof row.note !== 'string'
      || typeof row.symbol !== 'string' || !Object.hasOwn(statuses, row.status))) return unreadable;
    const plain = value => value.replace(/\s+/g, ' ').replace(/[\\`*_{}\[\]<>]/g, '\\$&');
    const lines = data.routines.slice(0, 20).map(row => `- ${plain(row.note || row.symbol)}${row.note && row.symbol ? ` (${plain(row.symbol)})` : ''} · ${statuses[row.status]}${row.activation_blocker ? ' · 실행 조건 확인 필요' : ''}`);
    let answer = data.routines.length ? `루틴 ${data.routines.length}개가 있습니다.\n\n${lines.join('\n')}` : '등록된 루틴이 없습니다.';
    if (data.routines.length > 20) answer += `\n\n그 밖에 ${data.routines.length - 20}개가 있습니다.`;
    if (Number.isSafeInteger(data.fired_today) && data.fired_today >= 0) answer += `\n\n오늘 발생 횟수: ${data.fired_today}회.`;
    if (data.last_error) answer += '\n현재 루틴 처리 오류가 기록되어 있습니다.';
    return answer;
  }
  if (result.tool_name === 'athena_nudge_guard' && result.arguments?.action === 'get') {
    const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (!Number.isSafeInteger(data.max_daily_nudges) || data.max_daily_nudges < 0 || data.max_daily_nudges > 10
      || !Number.isSafeInteger(data.max_daily_briefings) || data.max_daily_briefings < 0 || data.max_daily_briefings > 50
      || typeof data.show_rationale !== 'boolean' || typeof data.learn_from_dismissals !== 'boolean'
      || typeof data.quiet_hours?.start !== 'string' || typeof data.quiet_hours?.end !== 'string'
      || !clock.test(data.quiet_hours.start) || !clock.test(data.quiet_hours.end)) return unreadable;
    const quiet = data.quiet_hours.start === data.quiet_hours.end ? '사용 안 함'
      : `${data.quiet_hours.start}~${data.quiet_hours.end} (한국시간)`;
    return ['현재 말걸기 설정입니다.', '', `- 하루 말걸기 최대: ${data.max_daily_nudges}회`,
      `- 하루 자동 브리핑 최대: ${data.max_daily_briefings}회`, `- 방해 금지 시간: ${quiet}`,
      `- 알림 근거 표시: ${data.show_rationale ? '켜짐' : '꺼짐'}`,
      `- 알림 닫기 반응 학습: ${data.learn_from_dismissals ? '켜짐' : '꺼짐'}`].join('\n');
  }
  return unreadable;
}

// Forward only a confirmed execution envelope through the existing tool-event path.
function forwardDirect(result, callbacks, id) {
  const name = `mcp__athena__${result.tool_name}`;
  callbacks.onEvent?.({ type: 'assistant', message: { content: [
    { type: 'tool_use', id, name, input: result.arguments || {} },
  ] } });
  callbacks.onEvent?.({ type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: id, content: result.result.content,
      is_error: result.result.isError === true },
  ] } });
  const answer = directAnswer(result);
  callbacks.onTextDelta?.(answer);
  return { ok: true, layaDirect: true, finalResult: { result: answer }, spawnedFresh: false };
}

function createLayaRouting({ baseUrl, bearerToken, fetchImpl = globalThis.fetch, timeoutMs = 5000, uuid = randomUUID } = {}) {
  async function request(method, suffix, body, env) {
    const url = new URL(`/api/v1/laya${suffix}`, typeof baseUrl === 'function' ? baseUrl() : baseUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Laya backend must be loopback');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method, signal: controller.signal, redirect: 'error',
        headers: { 'Content-Type': 'application/json',
          Authorization: `Bearer ${typeof bearerToken === 'function' ? bearerToken() : bearerToken}`,
          'X-Athena-Laya-Lease': env.ATHENA_LAYA_LEASE_ID,
          'X-Athena-Laya-Generation': env.ATHENA_LAYA_GENERATION_ID },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error('Laya request unavailable');
      return response.status === 204 ? null : await response.json();
    } finally { clearTimeout(timer); }
  }

  function createSession() {
    // Private process env only. Neither these values nor user context enter logs.
    const env = Object.freeze({ ATHENA_LAYA_LEASE_ID: uuid(), ATHENA_LAYA_GENERATION_ID: uuid() });
    let conversationId = null;
    let active = null;
    let closed = false;
    function bind(id) {
      if (closed || !id || (conversationId !== null && conversationId !== id)) throw new Error('Laya session ownership mismatch');
      conversationId = id;
    }
    async function revoke(turn) {
      if (!turn.ticket || turn.revoked) return;
      turn.revoked = true;
      await request('DELETE', `/turns/${encodeURIComponent(turn.ticket)}`, undefined, env).catch(() => {});
    }
    function cancel(turn) {
      if (turn.controller.signal.aborted) return;
      turn.controller.abort();
      turn.providerHandle?.kill?.();
      void revoke(turn);
    }
    async function run(options, invoke) {
      const { layaContext, allowLayaDirect = true, ...providerOptions } = options;
      if (!layaContext || layaContext.origin === 'backtest' || layaContext.context?.canvasMode === 'backtest') {
        return invoke({ ...providerOptions, envOverrides: { ...providerOptions.envOverrides, ...env } });
      }
      // Empty scheduled notes authorize the existing briefing default, not an invented user utterance.
      if (layaContext.origin === 'briefing' && !String(layaContext.utterance || '').trim()) {
        const result = await invoke({ ...providerOptions, envOverrides: { ...providerOptions.envOverrides, ...env } });
        return { ...result, layaRouting: { path: 'provider', reason: 'empty_approved_note' } };
      }
      bind(layaContext.conversation_id);
      if (active) cancel(active);
      const turn = { controller: new AbortController(), ticket: null, revoked: false, providerHandle: null };
      active = turn;
      const current = () => active === turn && !closed && !turn.controller.signal.aborted;
      const abort = () => cancel(turn);
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener('abort', abort, { once: true });
      const onSpawn = handle => {
        turn.providerHandle = handle;
        if (!current()) handle?.kill?.();
        else providerOptions.onSpawn?.({ ...handle, kill: abort });
      };
      providerOptions.onSpawn?.({ pid: null, kill: abort });
      const interrupted = () => ({ ok: false, aborted: true, error: '요청이 취소되었습니다.' });
      try {
        if (!current()) return interrupted();
        let plan = null;
        try {
          const registration = await request('POST', '/turns', {
            ...layaContext, lease_id: env.ATHENA_LAYA_LEASE_ID,
            generation_id: env.ATHENA_LAYA_GENERATION_ID,
          }, env);
          if (typeof registration?.ticket !== 'string' || registration.conversation_id !== conversationId
            || registration.turn_id !== layaContext.turn_id) throw new Error('Laya registration mismatch');
          turn.ticket = registration.ticket;
          if (current()) plan = await request('POST', `/turns/${encodeURIComponent(turn.ticket)}/plan`, {}, env);
        } catch { /* Unavailable classifier preserves the existing provider path. */ }
        if (!current()) return interrupted();
        if (plan?.complete === true && TICKET_TOOLS.includes(plan.tool_name) && allowLayaDirect) {
          let dispatched;
          try { dispatched = await request('POST', `/turns/${encodeURIComponent(turn.ticket)}/dispatch`, {}, env); }
          catch {
            // Execution might have reached the server. Do not re-execute via a provider.
            return { ok: false, error: '도구 실행 결과를 확인하지 못했습니다. 화면 상태를 확인해 주세요.', submitted: true };
          }
          if (!current()) return interrupted();
          if (dispatched?.applied === true && dispatched.result?.isError !== true
            && Array.isArray(dispatched.result?.content) && dispatched.tool_name === plan.tool_name) {
            return forwardDirect(dispatched, providerOptions, uuid());
          }
          // An actual failed handler result is also terminal; only a non-executed plan may fall through.
          if (dispatched?.result) return { ok: false, submitted: true, error: '요청한 도구 실행을 완료하지 못했습니다.' };
        }
        const result = await invoke({ ...providerOptions,
          prompt: turn.ticket ? ticketPrompt(providerOptions.prompt, turn.ticket, plan) : providerOptions.prompt,
          envOverrides: { ...providerOptions.envOverrides, ...env },
          signal: turn.controller.signal, onSpawn,
          redactLayaEvent: event => turn.ticket ? withoutTicket(event, turn.ticket) : event,
          onEvent: providerOptions.onEvent && (event => { if (current()) providerOptions.onEvent(turn.ticket ? withoutTicket(event, turn.ticket) : event); }),
          onTextDelta: providerOptions.onTextDelta && ((text, metadata) => { if (current()) providerOptions.onTextDelta(turn.ticket ? withoutTicket(text, turn.ticket) : text, metadata); }),
          onThinkingDelta: providerOptions.onThinkingDelta && (text => { if (current()) providerOptions.onThinkingDelta(turn.ticket ? withoutTicket(text, turn.ticket) : text); }),
          onCanvasResult: providerOptions.onCanvasResult && (result => { if (current()) providerOptions.onCanvasResult(turn.ticket ? withoutTicket(result, turn.ticket) : result); }),
        });
        return current() ? result : interrupted();
      } finally {
        options.signal?.removeEventListener('abort', abort);
        await revoke(turn);
        if (active === turn) active = null;
      }
    }
    return Object.freeze({ env: () => env, bind, run,
      cancel() { if (active) cancel(active); },
      close() { closed = true; if (active) cancel(active); },
    });
  }
  return Object.freeze({ createSession });
}

module.exports = { createLayaRouting, ticketPrompt, forwardDirect, TICKET_TOOLS };
