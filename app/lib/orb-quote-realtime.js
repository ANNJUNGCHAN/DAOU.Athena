(function () {
'use strict';

const __isCjs = typeof module !== 'undefined' && module.exports;

function normalizeQuoteSymbol(value) {
  const target = String(value == null ? '' : value).trim();
  return /^[AJQ]\d{6}$/.test(target) ? target.slice(1) : target;
}

function createOrbQuoteRealtimeSession({
  symbol, acquire, release, onTick, onState = () => {}, isConnected = () => true,
  setTimer = setTimeout, clearTimer = clearTimeout, retryBaseMs = 250, retryMaxMs = 5000,
  releaseRetryBaseMs = 250, releaseRetryMaxMs = 2000, releaseRetryAttempts = 5,
} = {}) {
  const targetSymbol = normalizeQuoteSymbol(symbol);
  if (!targetSymbol || typeof acquire !== 'function' || typeof release !== 'function'
    || typeof onTick !== 'function') throw new TypeError('quote session 인자가 올바르지 않다');
  let closed = false;
  let acquiring = false;
  let active = false;
  let leaseToken = null;
  let retryTimer = null;
  let releaseRetryTimer = null;
  let retryAttempt = 0;
  let connectionGeneration = -1;

  const releaseLease = (token, attempt = 0) => {
    const retry = () => {
      if (attempt + 1 >= releaseRetryAttempts || releaseRetryTimer !== null) return;
      const delay = Math.min(releaseRetryBaseMs * (2 ** attempt), releaseRetryMaxMs);
      releaseRetryTimer = setTimer(() => {
        releaseRetryTimer = null;
        releaseLease(token, attempt + 1);
      }, delay);
    };
    try {
      Promise.resolve(release(token)).then((released) => {
        if (released === false) retry();
        else if (leaseToken === token) leaseToken = null;
      }, retry);
    } catch { retry(); }
  };
  const scheduleRetry = () => {
    if (closed || acquiring || active || retryTimer !== null || !isConnected()) return;
    const delay = Math.min(retryBaseMs * (2 ** retryAttempt), retryMaxMs);
    retryAttempt += 1;
    retryTimer = setTimer(() => {
      retryTimer = null;
      void tryAcquire();
    }, delay);
  };
  const tryAcquire = async () => {
    if (closed || acquiring || active || !isConnected()) return false;
    acquiring = true;
    let result = null;
    try { result = await acquire(targetSymbol); } catch {}
    acquiring = false;
    if (closed) {
      if (result && result.ok && result.leaseToken) {
        leaseToken = result.leaseToken;
        releaseLease(result.leaseToken);
      }
      return false;
    }
    if (result && result.ok && result.status === 'fixture-disabled') {
      onState('fixture-disabled', result);
      return false;
    }
    if (result && result.ok && result.leaseToken) {
      if (!isConnected()) {
        leaseToken = result.leaseToken;
        releaseLease(result.leaseToken);
        return false;
      }
      leaseToken = result.leaseToken;
      active = true;
      retryAttempt = 0;
      onState('active', result);
      return true;
    }
    onState('registration-failed', result);
    scheduleRetry();
    return false;
  };

  return {
    symbol: targetSymbol,
    start() { void tryAcquire(); },
    applyTick(tick) {
      if (closed || !active || !tick || normalizeQuoteSymbol(tick.symbol) !== targetSymbol) return false;
      if (!isConnected()) {
        this.close();
        return false;
      }
      onTick(tick);
      onState('receiving');
      return true;
    },
    applyState(event) {
      if (closed || !leaseToken || !event
        || String(event.leaseToken || '') !== String(leaseToken)
        || event.kind !== 'quote'
        || normalizeQuoteSymbol(event.symbol) !== targetSymbol) return false;
      const generation = Number(event.connectionGeneration);
      if (!Number.isInteger(generation) || generation < connectionGeneration) return false;
      const status = String(event.status || '');
      if (!['active', 'reconnecting', 'error'].includes(status)) return false;
      connectionGeneration = generation;
      active = status === 'active';
      onState(status, event);
      return true;
    },
    close() {
      if (closed) return false;
      closed = true;
      active = false;
      onState('stopped');
      if (retryTimer !== null) {
        clearTimer(retryTimer);
        retryTimer = null;
      }
      if (leaseToken) {
        const token = leaseToken;
        releaseLease(token);
      }
      return true;
    },
  };
}

function createOrbFallbackSession({
  ownerId, kind, accountGeneration, correlation, target, slotIds = [], invoke, onData,
  onState = () => {}, isCurrent = () => true, failureStates = ['registration-failed'],
  validateData = () => true, errorMessage = 'fallback session 인자가 올바르지 않다',
} = {}) {
  if (!ownerId || !kind || !Number.isInteger(accountGeneration) || typeof invoke !== 'function'
    || typeof onData !== 'function' || typeof validateData !== 'function') throw new TypeError(errorMessage);
  let closed = false;
  let registration = null;
  let registerPromise = null;
  let latestSourceEpoch = -1;
  let latestOwnerEpoch = -1;
  let acceptsData = false;
  const pendingEvents = [];
  const failureSet = new Set(failureStates.map((state) => String(state || '').trim().toLowerCase()));

  const call = (channel, payload) => {
    try { return Promise.resolve(invoke(channel, payload)); } catch (error) { return Promise.reject(error); }
  };
  const unregister = async () => {
    const current = registration;
    registration = null;
    if (!current) return false;
    try { return await call('athena:realtime-fallback-unregister', { ownerId }); } catch { return false; }
  };
  const ensureRegistered = () => {
    if (closed || !isCurrent()) return Promise.resolve(null);
    if (registration) return Promise.resolve(registration);
    if (registerPromise) return registerPromise;
    registerPromise = call('athena:realtime-fallback-register', {
      ownerId, kind, accountGeneration, correlation, target,
      slotIds: [...new Set(slotIds.map((slotId) => String(slotId || '').trim()).filter(Boolean))],
      visible: true,
    }).then(async (result) => {
      registerPromise = null;
      if (!result || result.ok !== true) return null;
      if (closed || !isCurrent()) {
        try { await call('athena:realtime-fallback-unregister', { ownerId }); } catch {}
        return null;
      }
      registration = result;
      latestSourceEpoch = Number(result.sourceEpoch) || 0;
      latestOwnerEpoch = Number(result.ownerEpoch) || 0;
      acceptsData = ['refreshing', 'api-fallback', 'delayed'].includes(String(result.status || ''));
      if (acceptsData) {
        onState({
          ownerId, accountGeneration, registrationRevision: result.registrationRevision,
          sourceEpoch: latestSourceEpoch, ownerEpoch: latestOwnerEpoch, status: result.status,
        });
      }
      for (const pending of pendingEvents.splice(0)) {
        if (pending.type === 'state') applyState(pending.event);
        else applyData(pending.event);
      }
      return result;
    }, () => { registerPromise = null; return null; });
    return registerPromise;
  };
  const matchesIdentity = (event) => {
    if (closed || !registration || !isCurrent() || !event) return false;
    if (String(event.ownerId || '') !== String(ownerId)
      || Number(event.accountGeneration) !== accountGeneration
      || Number(event.registrationRevision) !== Number(registration.registrationRevision)) return false;
    return true;
  };

  const canQueue = (event) => !closed && !registration && !!registerPromise && isCurrent() && event
    && String(event.ownerId || '') === String(ownerId)
    && Number(event.accountGeneration) === accountGeneration;

  function applyState(event) {
    if (canQueue(event)) {
      if (pendingEvents.length < 8) pendingEvents.push({ type: 'state', event });
      return true;
    }
    if (!matchesIdentity(event)) return false;
    const sourceEpoch = Number(event.sourceEpoch);
    const ownerEpoch = Number(event.ownerEpoch);
    if (!Number.isFinite(sourceEpoch) || !Number.isFinite(ownerEpoch)
      || sourceEpoch < latestSourceEpoch || ownerEpoch < latestOwnerEpoch) return false;
    latestSourceEpoch = sourceEpoch;
    latestOwnerEpoch = ownerEpoch;
    acceptsData = ['refreshing', 'api-fallback', 'delayed'].includes(String(event.status || ''));
    onState(event);
    return true;
  }

  function applyData(event) {
    if (!validateData(event)) return false;
    if (canQueue(event)) {
      if (pendingEvents.length < 8) pendingEvents.push({ type: 'data', event });
      return true;
    }
    if (!acceptsData || !matchesIdentity(event)
      || Number(event.sourceEpoch) !== latestSourceEpoch
      || Number(event.ownerEpoch) !== latestOwnerEpoch) return false;
    onData(event);
    return true;
  }

  async function handleRealtimeState(rawState) {
    if (closed) return false;
    const state = String(rawState && typeof rawState === 'object'
      ? rawState.status || rawState.state : rawState || '').trim().toLowerCase();
    if (!failureSet.has(state) && state !== 'active' && state !== 'receiving') return false;
    acceptsData = failureSet.has(state);
    const current = await ensureRegistered();
    if (!current || closed) { acceptsData = false; return false; }
    try { return await call('athena:realtime-fallback-status', { ownerId, state }); }
    catch { return false; }
  }

  return {
    start() {
      return ensureRegistered();
    },
    handleQuoteState: handleRealtimeState,
    handleRealtimeState,
    applyState,
    applyData,
    close() {
      if (closed) return false;
      closed = true;
      acceptsData = false;
      pendingEvents.length = 0;
      if (registerPromise) void registerPromise.then(() => unregister());
      else void unregister();
      return true;
    },
  };
}

function createOrbQuoteFallbackSession(options = {}) {
  return createOrbFallbackSession({
    ...options,
    kind: 'orb-quote',
    failureStates: ['registration-failed', 'reconnecting', 'error'],
    errorMessage: 'fallback session 인자가 올바르지 않다',
  });
}

const __exports = {
  normalizeQuoteSymbol, createOrbQuoteRealtimeSession, createOrbFallbackSession,
  createOrbQuoteFallbackSession,
};
if (__isCjs) module.exports = __exports;
else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.OrbQuoteRealtime = __exports;
}
})();
