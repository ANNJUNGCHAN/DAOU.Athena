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

function createLayaRouting({ getBackendUrl, getBearerToken, fetchImpl = fetch, timeoutMs = 2000 } = {}) {
  async function selectOperation({ text, candidates, signal, isCurrent = () => true } = {}) {
    ensureCurrent(signal, isCurrent);
    const supplied = normalizeCandidates(candidates);
    if (!supplied || typeof text !== 'string' || !text.trim()) return null;
    const choices = new Set(supplied.map((item) => item.id));
    let endpoint;
    let token;
    try {
      endpoint = new URL('/api/v1/laya/decide', getBackendUrl());
      token = getBearerToken();
    } catch { return null; }
    if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
        || typeof token !== 'string' || !token) return null;
    const controller = new AbortController();
    let timer;
    let cancel;
    const interrupted = new Promise((resolve) => {
      cancel = () => { controller.abort(); resolve(null); };
      timer = setTimeout(cancel, timeoutMs);
      if (signal) signal.addEventListener('abort', cancel, { once: true });
    });
    // Bound the entire response, including JSON parsing, even if fetch ignores
    // AbortSignal. A cancelled/stale decision can never start a dispatch.
    const request = Promise.resolve().then(async () => {
      if (controller.signal.aborted) return null;
      const response = await fetchImpl(endpoint.href, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ task: 'operation_selection', text, candidates: supplied }),
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
    if (!result || result.status !== 'accepted' || result.task !== 'operation_selection' || !choices.has(result.choice)
        || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) return null;
    // Confidence/margin policy belongs to the authenticated backend. Free text
    // reasons and invented arguments never reach the existing dispatch contract.
    return { task: 'operation_selection', choice: result.choice, confidence: result.confidence };
  }
  return { operation_selection: selectOperation };
}

module.exports = { createLayaRouting, isLayaEnabled };
