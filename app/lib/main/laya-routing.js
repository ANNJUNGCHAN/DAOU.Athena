'use strict';

function isLayaEnabled(env = process.env) {
  return /^(?:1|true|on|yes)$/i.test(String(env.ATHENA_LAYA_ENABLED || '').trim());
}

function ensureCurrent(signal, isCurrent) {
  if ((signal && signal.aborted) || !isCurrent()) {
    const error = new Error('LAYA 판단이 취소되거나 새 요청으로 교체됐다');
    error.name = 'AbortError';
    throw error;
  }
}

function normalizeCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 9) return null;
  const ids = new Set();
  const result = [];
  for (const item of candidates) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 128
        || ids.has(item.id) || typeof item.label !== 'string' || !item.label.trim()) return null;
    ids.add(item.id);
    result.push({ id: item.id, label: item.label.slice(0, 160),
      ...(typeof item.description === 'string' ? { description: item.description.slice(0, 500) } : {}) });
  }
  return result;
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function acceptedCatalogSelection(result, catalogVersion) {
  if (!isObject(result) || result.status !== 'accepted' || result.task !== 'operation_selection'
      || typeof catalogVersion !== 'string' || !catalogVersion.trim() || result.catalog_version !== catalogVersion
      || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1
      || !Number.isSafeInteger(result.considered_count) || result.considered_count < 1
      || result.evaluated_count !== result.considered_count
      || !Number.isSafeInteger(result.question_count) || result.question_count < 1) return null;
  const candidate = result.candidate;
  if (!isObject(candidate) || typeof candidate.operation_ref !== 'string'
      || result.choice !== candidate.operation_ref || typeof candidate.name !== 'string' || !candidate.name.trim()) return null;
  const ref = candidate.operation_ref;
  const detail = /^detail:[A-Za-z][A-Za-z0-9_]*:([A-Za-z0-9_]+)$/.exec(ref);
  const base = /^base:[A-Za-z][A-Za-z0-9_]*$/.test(ref);
  const readOnlyCondition = candidate.kind === 'websocket' && ['base:ka10171', 'base:ka10172'].includes(ref);
  if (!(readOnlyCondition || (['query', 'detail'].includes(candidate.kind) && (base || detail)))
      || (candidate.kind === 'detail' && !detail)
      || (detail ? candidate.detail_group !== detail[1] : candidate.detail_group != null)) return null;
  const schema = candidate.argument_contracts;
  if (!isObject(schema) || schema.type !== 'object' || !isObject(schema.properties)
      || !Array.isArray(schema.required) || schema.additionalProperties !== false
      || !Array.isArray(candidate.required_arguments)) return null;
  if (Object.values(schema.properties).some((spec) => !isObject(spec))
      || schema.required.some((name) => typeof name !== 'string' || !Object.hasOwn(schema.properties, name))
      || new Set(schema.required).size !== schema.required.length) return null;
  const required = candidate.required_arguments;
  if (required.length !== schema.required.length || new Set(required.map((field) => field && field.alias)).size !== required.length
      || required.some((field) => !isObject(field) || field.required !== true
        || !schema.required.includes(field.alias) || !isObject(field.json_schema))) return null;
  // The authenticated backend owns membership and the complete argument schema.
  // Do not reapply the old three-candidate shortlist to its selected operation.
  return {
    status: 'accepted', task: 'operation_selection', choice: ref, confidence: result.confidence,
    catalog_version: result.catalog_version, candidate,
    considered_count: result.considered_count, evaluated_count: result.evaluated_count,
    question_count: result.question_count,
  };
}

function createLayaRouting({ getBackendUrl, getBearerToken, fetchImpl = fetch, timeoutMs = 2000,
  fullCatalogTimeoutMs = 5500 } = {}) {
  async function requestDecision(path, body, { signal, isCurrent }, budgetMs) {
    ensureCurrent(signal, isCurrent);
    let endpoint;
    let token;
    try {
      endpoint = new URL(path, getBackendUrl());
      token = getBearerToken();
    } catch { return null; }
    if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
        || typeof token !== 'string' || !token) return null;
    const controller = new AbortController();
    let timer;
    let cancel;
    const interrupted = new Promise((resolve) => {
      cancel = () => { controller.abort(); resolve(null); };
      timer = setTimeout(cancel, budgetMs);
      if (signal) signal.addEventListener('abort', cancel, { once: true });
    });
    // Bound the entire response, including JSON parsing, even if fetch ignores
    // AbortSignal. A cancelled/stale decision can never start a dispatch.
    const request = Promise.resolve().then(async () => {
      if (controller.signal.aborted) return null;
      const response = await fetchImpl(endpoint.href, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      return response.ok ? response.json() : null;
    }).catch(() => null);
    let result;
    try { result = await Promise.race([request, interrupted]); }
    finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', cancel);
    }
    ensureCurrent(signal, isCurrent);
    return result;
  }

  async function selectOperation({ text, candidates, signal, isCurrent = () => true } = {}) {
    ensureCurrent(signal, isCurrent);
    const supplied = normalizeCandidates(candidates);
    if (!supplied || typeof text !== 'string' || !text.trim()) return null;
    const choices = new Set(supplied.map((item) => item.id));
    const result = await requestDecision('/api/v1/laya/decide',
      { task: 'operation_selection', text, candidates: supplied }, { signal, isCurrent }, timeoutMs);
    if (!result || result.status !== 'accepted' || result.task !== 'operation_selection' || !choices.has(result.choice)
        || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) return null;
    // Confidence/margin policy belongs to the authenticated backend. Free text
    // reasons and invented arguments never reach the existing dispatch contract.
    return { task: 'operation_selection', choice: result.choice, confidence: result.confidence };
  }

  async function selectCatalogOperation({ text, catalog_version, signal, isCurrent = () => true } = {}) {
    ensureCurrent(signal, isCurrent);
    if (typeof text !== 'string' || !text.trim() || typeof catalog_version !== 'string' || !catalog_version.trim()) return null;
    const result = await requestDecision('/api/v1/laya/select-operation', { text, catalog_version },
      { signal, isCurrent }, fullCatalogTimeoutMs);
    return acceptedCatalogSelection(result, catalog_version);
  }
  return { operation_selection: selectOperation, select_catalog_operation: selectCatalogOperation };
}

module.exports = { acceptedCatalogSelection, createLayaRouting, isLayaEnabled };
