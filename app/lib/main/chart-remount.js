'use strict';

// Main-owned source data only. A retired renderer generation never reopens.
function createChartRemounts({ correlationKey, panelIdFor, randomUUID, maxSources = 6 }) {
  const sources = new Map();
  const tickets = new Map();
  const sourceFor = key => [...sources.values()].find(source => source.keys.has(key));

  function remember({ key, paint, authority, envelope, senderId, conversationId, accountGeneration }) {
    if (!key || !paint || paint.renderState !== 'data' || paint.rendererId !== 'aits-chart-v1'
      || !paint.panelId || !authority || !authority.accountId || !conversationId) return false;
    let source = [...sources.values()].find(row => row.paint.panelId === paint.panelId);
    if (!source) {
      while (sources.size >= maxSources) {
        const key = sources.keys().next().value;
        abort(sources.get(key).pending);
        sources.delete(key);
      }
      source = { originalKey: key, keys: new Set([key]), cardId: null, pending: null };
      sources.set(key, source);
    }
    source.keys = new Set([source.originalKey, key]);
    Object.assign(source, { paint, authority, envelope, senderId, conversationId, accountGeneration, retired: false });
    return true;
  }

  function updateReload(request, result, context) {
    const expected = request && request.expected;
    const source = expected && [...sources.values()].find(row => row.paint.panelId === expected.panelId);
    const canvas = result && result.canvases && result.canvases[0];
    const envelope = canvas && canvas.envelope;
    if (!source || source.retired || source.pending || !envelope || !envelope.data
      || context.senderId !== source.senderId || context.conversationId !== source.conversationId
      || context.accountGeneration !== source.accountGeneration || context.accountId !== source.authority.accountId
      || request.accountId !== source.authority.accountId || expected.generation !== source.paint.generation + 1) return false;
    // Caller first validates renderer/panel/generation/period/operation with acceptResult.
    source.paint = { ...source.paint, generation: canvas.generation };
    source.envelope = envelope;
    source.keys = new Set([source.originalKey, correlationKey(envelope.correlation)]);
    source.authority = { ...source.authority, correlation: envelope.correlation,
      operationRef: canvas.operationRef, operationArgs: { ...request.items[0].args },
      chartBody: envelope.data.chart, chartMeta: envelope.data.chart_meta };
    return true;
  }

  function retire(panelId) {
    const source = [...sources.values()].find(row => row.paint.panelId === panelId);
    if (!source) return false;
    source.retired = true;
    return true;
  }

  function owned(source, input, context) {
    return source && context.senderId === source.senderId
      && context.conversationId === source.conversationId
      && context.accountGeneration === source.accountGeneration
      && context.accountId === source.authority.accountId
      && context.cardId === input.cardId && context.cardId
      && source.keys.has(context.cardKey)
      && (!source.cardId || source.cardId === context.cardId);
  }

  function begin(input, context) {
    const key = correlationKey(input.correlation);
    const source = sourceFor(key);
    if (!owned(source, input, context) || !source.retired || source.pending
      || input.panelId !== source.paint.panelId || Number(input.generation) !== source.paint.generation) {
      throw new Error('현재 카드의 차트 재표시 권위를 확인할 수 없습니다.');
    }
    const token = randomUUID();
    const correlation = { ...source.authority.correlation, dataset_id: randomUUID() };
    const envelope = {
      ...source.envelope, correlation,
      renderer_id: 'aits-chart-v1',
      operation_ref: source.authority.operationRef,
      operation_args: { ...source.authority.operationArgs },
      data: { ...source.envelope.data, chart: source.authority.chartBody, chart_meta: source.authority.chartMeta },
    };
    const expectedPanelId = panelIdFor({ source: 'live', correlation });
    if (expectedPanelId === source.paint.panelId) throw new Error('폐기한 차트 신원을 재사용할 수 없습니다.');
    source.cardId = context.cardId;
    source.pending = token;
    tickets.set(token, { source, input, envelope, expectedPanelId });
    return { token, envelope, accountId: source.authority.accountId, conversationId: source.conversationId };
  }

  function accept(token, paint, context) {
    const ticket = tickets.get(token);
    if (!ticket || sourceFor(ticket.source.originalKey) !== ticket.source
      || ticket.source.pending !== token || !owned(ticket.source, ticket.input, context)
      || !ticket.source.retired || paint.renderState !== 'data'
      || paint.rendererId !== 'aits-chart-v1' || paint.panelId !== ticket.expectedPanelId
      || paint.generation !== 1) return false;
    const source = ticket.source;
    source.keys = new Set([source.originalKey, correlationKey(ticket.envelope.correlation)]);
    source.paint = paint;
    source.envelope = ticket.envelope;
    source.authority = { ...source.authority, correlation: ticket.envelope.correlation };
    source.retired = false;
    source.pending = null;
    tickets.delete(token);
    return true;
  }

  function valid(token, paint, context) {
    const ticket = tickets.get(token);
    return !!ticket && sourceFor(ticket.source.originalKey) === ticket.source
      && ticket.source.pending === token && owned(ticket.source, ticket.input, context)
      && ticket.source.retired && paint.renderState === 'data'
      && paint.rendererId === 'aits-chart-v1' && paint.panelId === ticket.expectedPanelId
      && paint.generation === 1;
  }

  function abort(token) {
    const ticket = tickets.get(token);
    if (!ticket) return false;
    if (ticket.source.pending === token) ticket.source.pending = null;
    tickets.delete(token);
    return true;
  }

  function cancel(token, context) {
    const ticket = tickets.get(token);
    if (!ticket || !owned(ticket.source, ticket.input, context)) return false;
    return abort(token);
  }

  function clear() { sources.clear(); tickets.clear(); }
  return { remember, updateReload, retire, begin, valid, accept, abort, cancel, clear };
}

module.exports = { createChartRemounts };
