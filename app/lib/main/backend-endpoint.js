'use strict';

const LOOPBACK_HOST = '127.0.0.1';

function normalizeBackendUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('ATHENA_BACKEND_URL must use http or https');
  }
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

const explicitBackendUrl = normalizeBackendUrl(process.env.ATHENA_BACKEND_URL);
let backendUrl = explicitBackendUrl;
let backendReady = explicitBackendUrl !== null;
const backendUrlWaiters = new Set();

function setBackendUrl(value, { publishEnv = true } = {}) {
  backendUrl = normalizeBackendUrl(value);
  backendReady = backendUrl !== null;
  if (publishEnv && backendUrl) process.env.ATHENA_BACKEND_URL = backendUrl;
  if (backendUrl) {
    for (const waiter of backendUrlWaiters) waiter.resolve(backendUrl);
    backendUrlWaiters.clear();
  }
  return backendUrl;
}

function getBackendUrl() {
  return backendReady ? backendUrl : null;
}

function markBackendUnavailable(expectedUrl = null) {
  if (explicitBackendUrl !== null || !backendUrl || !backendReady) return false;
  if (expectedUrl && normalizeBackendUrl(expectedUrl) !== backendUrl) return false;
  backendReady = false;
  return true;
}

function requireBackendUrl() {
  const readyUrl = getBackendUrl();
  if (!readyUrl) throw new Error('Athena backend endpoint is not initialized');
  return readyUrl;
}

function waitForBackendUrl({ timeoutMs = 65_000 } = {}) {
  const readyUrl = getBackendUrl();
  if (readyUrl) return Promise.resolve(readyUrl);
  const boundedTimeoutMs = Math.max(1, Number(timeoutMs) || 65_000);
  return new Promise((resolve, reject) => {
    const waiter = {
      resolve: (value) => {
        clearTimeout(timer);
        backendUrlWaiters.delete(waiter);
        resolve(value);
      },
    };
    const timer = setTimeout(() => {
      backendUrlWaiters.delete(waiter);
      reject(new Error('백엔드 주소를 준비하지 못했습니다 (시작 제한시간 초과)'));
    }, boundedTimeoutMs);
    backendUrlWaiters.add(waiter);
  });
}

function getBackendWsUrl() {
  return requireBackendUrl().replace(/^http/, 'ws');
}

function isExternalBackend() {
  return explicitBackendUrl !== null;
}

function getBackendPort() {
  const value = backendUrl;
  if (!value) return 0;
  const parsed = new URL(value);
  if (parsed.port) return Number(parsed.port);
  return parsed.protocol === 'https:' ? 443 : 80;
}

module.exports = {
  LOOPBACK_HOST,
  normalizeBackendUrl,
  setBackendUrl,
  getBackendUrl,
  markBackendUnavailable,
  requireBackendUrl,
  waitForBackendUrl,
  getBackendWsUrl,
  getBackendPort,
  isExternalBackend,
};
