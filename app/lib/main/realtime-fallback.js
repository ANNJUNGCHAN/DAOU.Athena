'use strict';

const FALLBACK_KINDS = new Set(['quote', 'orderbook', 'chart', 'integrated-board', 'semantic', 'orb-quote']);
const FAILURE_STATES = new Set(['disconnected', 'registration-failed', 'retrying', 'reconnecting', 'unavailable', 'unsupported', 'error']);

function clean(value) { return String(value == null ? '' : value).trim(); }

function createRealtimeFallbackCoordinator(options = {}) {
  if (typeof options.refresh !== 'function') throw new TypeError('refresh가 필요하다');
  const refresh = options.refresh;
  const onState = typeof options.onState === 'function' ? options.onState : () => {};
  const onData = typeof options.onData === 'function' ? options.onData : () => {};
  const project = typeof options.project === 'function' ? options.project : (result) => result;
  const getAccountGeneration = typeof options.getAccountGeneration === 'function' ? options.getAccountGeneration : () => 1;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
  const jitter = typeof options.jitter === 'function' ? options.jitter : (delay) => Math.round(delay * (0.9 + Math.random() * 0.2));
  const maxIntervalMs = Math.max(1_000, Number(options.maxIntervalMs) || 60_000);
  const owners = new Map();
  const groups = new Map();
  let revisionSequence = 0;
  let feedState = 'unknown';
  let closed = false;

  const identity = (owner) => ({ ownerId: owner.ownerId, accountGeneration: owner.accountGeneration, registrationRevision: owner.registrationRevision });
  const currentOwner = (owner) => !closed && owners.get(owner.ownerId) === owner && owner.accountGeneration === Number(getAccountGeneration());
  const liveOwners = (group) => [...group.owners].filter(currentOwner);
  const fallbackOwners = (group, visibleOnly = false) => liveOwners(group).filter((owner) => owner.needsFallback && (!visibleOnly || owner.visible));

  function emitState(owner, status, group, extra = {}) {
    if (!currentOwner(owner) && status !== 'stopped') return;
    onState({
      ...identity(owner), status, source: 'kiwoom-rest', transport: 'rest-fallback',
      sourceEpoch: group.sourceEpoch, ownerEpoch: owner.ownerEpoch,
      asOf: extra.asOf || null, lastSuccessAt: owner.lastSuccessAt,
      ...(extra.error ? { error: clean(extra.error) } : {}),
    });
  }

  function clearGroupTimer(group) {
    if (group.timer !== null) { clearTimer(group.timer); group.timer = null; }
  }

  function deactivateGroup(group) {
    if (!group.active && !group.controller && group.timer === null) return;
    clearGroupTimer(group);
    group.active = false;
    group.sourceEpoch += 1;
    if (group.controller) {
      group.controller.abort(new Error('실시간 복구로 API 대체 조회를 중단했다'));
      group.controller = null;
    }
  }

  function schedule(group, delay) {
    if (closed || !group.active || group.timer !== null || groups.get(group.physicalKey) !== group || !fallbackOwners(group, true).length) return;
    const scheduledDelay = Math.max(1, Number(jitter(delay, group)) || delay);
    group.timer = setTimer(() => { group.timer = null; void run(group); }, scheduledDelay);
    if (group.timer && typeof group.timer.unref === 'function') group.timer.unref();
  }

  async function run(group) {
    const recipients = fallbackOwners(group, true);
    if (!group.active || group.controller || !recipients.length || groups.get(group.physicalKey) !== group) return false;
    const authorityOwner = recipients[0];
    const recipientEpochs = new Map(recipients.map((owner) => [owner, owner.ownerEpoch]));
    const sourceEpoch = group.sourceEpoch;
    const accountGeneration = group.accountGeneration;
    const controller = new AbortController();
    group.controller = controller;
    recipients.forEach((owner) => emitState(owner, 'refreshing', group));
    let result;
    try {
      result = await refresh(authorityOwner.descriptor, { signal: controller.signal, registrationRevision: authorityOwner.registrationRevision, sourceEpoch });
      if (!result || result.ok !== true) {
        const error = new Error((result && result.error) || 'API 대체 조회 결과가 없다');
        if (result && Number.isFinite(Number(result.retryAfterMs))) error.retryAfterMs = Number(result.retryAfterMs);
        throw error;
      }
    } catch (error) {
      if (group.controller === controller) group.controller = null;
      if (closed || !group.active || groups.get(group.physicalKey) !== group || sourceEpoch !== group.sourceEpoch
        || accountGeneration !== Number(getAccountGeneration()) || controller.signal.aborted) return false;
      const baseDelay = Math.min(group.intervalMs * (2 ** group.failureCount), group.maxIntervalMs);
      group.failureCount += 1;
      const retryAfterMs = Math.max(0, Number(error && error.retryAfterMs) || 0);
      fallbackOwners(group, true).forEach((owner) => emitState(owner, 'delayed', group, { error: String((error && error.message) || error) }));
      schedule(group, Math.max(baseDelay, retryAfterMs));
      return false;
    }
    if (group.controller === controller) group.controller = null;
    if (closed || !group.active || groups.get(group.physicalKey) !== group || sourceEpoch !== group.sourceEpoch
      || accountGeneration !== Number(getAccountGeneration()) || controller.signal.aborted) return false;
    const providerAsOf = clean(result.providerAsOf || result.provider_as_of);
    const providerMs = providerAsOf ? Date.parse(providerAsOf) : NaN;
    if (Number.isFinite(providerMs) && Number.isFinite(group.lastProviderMs) && providerMs < group.lastProviderMs) {
      schedule(group, group.intervalMs);
      return false;
    }
    if (Number.isFinite(providerMs)) group.lastProviderMs = providerMs;
    const asOf = clean(result.asOf) || now();
    let delivered = 0;
    for (const [owner, ownerEpoch] of recipientEpochs) {
      if (!currentOwner(owner) || !owner.visible || !owner.needsFallback || owner.ownerEpoch !== ownerEpoch) continue;
      let projected;
      try {
        projected = project(result, owner.descriptor);
      } catch (error) {
        emitState(owner, 'delayed', group, { error: String((error && error.message) || error) });
        continue;
      }
      if (!projected || projected.ok !== true) {
        emitState(owner, 'delayed', group, { error: projected && projected.error || 'API 대체 조회를 카드에 적용할 수 없다' });
        continue;
      }
      const { ok: _ok, providerAsOf: _providerAsOf, provider_as_of: _providerAsOfSnake, ...payload } = projected;
      if (delivered === 0) {
        group.failureCount = 0;
        group.lastSuccessAt = asOf;
      }
      owner.lastSuccessAt = asOf;
      onData({ ...payload, ...identity(owner), kind: owner.descriptor.kind, source: 'kiwoom-rest', transport: 'rest-fallback', sourceEpoch, ownerEpoch, asOf, ...(providerAsOf ? { providerAsOf } : {}) });
      delivered += 1;
      emitState(owner, 'api-fallback', group, { asOf });
    }
    if (delivered > 0) {
      schedule(group, group.intervalMs);
      return true;
    }
    const delay = Math.min(group.intervalMs * (2 ** group.failureCount), group.maxIntervalMs);
    group.failureCount += 1;
    schedule(group, delay);
    return false;
  }

  function activateGroup(group) {
    if (closed || groups.get(group.physicalKey) !== group || !fallbackOwners(group).length) return Promise.resolve(false);
    if (!group.active) { group.active = true; group.sourceEpoch += 1; group.failureCount = 0; clearGroupTimer(group); }
    if (group.controller || group.timer !== null || !fallbackOwners(group, true).length) return Promise.resolve(false);
    return run(group);
  }

  function enterFallback(owner) {
    if (!owner.needsFallback) { owner.needsFallback = true; owner.ownerEpoch += 1; }
    return activateGroup(owner.group);
  }

  function leaveFallback(owner) {
    if (owner.needsFallback) { owner.needsFallback = false; owner.ownerEpoch += 1; }
    emitState(owner, 'ws-active', owner.group);
    if (!fallbackOwners(owner.group).length) deactivateGroup(owner.group);
  }

  function register(descriptor = {}) {
    if (closed) return { ok: false, error: 'fallback coordinator가 종료됐다' };
    const ownerId = clean(descriptor.ownerId);
    const kind = clean(descriptor.kind);
    const physicalKey = clean(descriptor.physicalKey);
    const accountGeneration = Number(descriptor.accountGeneration);
    const intervalMs = Number(descriptor.refreshIntervalMs);
    if (!ownerId || ownerId.length > 160) return { ok: false, error: 'ownerId가 올바르지 않다' };
    if (!FALLBACK_KINDS.has(kind)) return { ok: false, error: '지원하지 않는 fallback kind다' };
    if (descriptor.intent !== 'query' || descriptor.verifiedQueryOnly !== true) return { ok: false, error: '검증된 조회 작업만 API 대체 조회할 수 있다' };
    if (!physicalKey || physicalKey.length > 512) return { ok: false, error: '물리 조회 키가 없다' };
    if (!Number.isInteger(accountGeneration) || accountGeneration !== Number(getAccountGeneration())) return { ok: false, error: '계좌 세대가 현재 상태와 다르다' };
    if (!Number.isFinite(intervalMs) || intervalMs < 1_000) return { ok: false, error: 'fallback 조회 주기가 올바르지 않다' };
    if (owners.has(ownerId)) unregister(ownerId);
    let group = groups.get(physicalKey);
    if (!group) {
      group = { physicalKey, accountGeneration, intervalMs, maxIntervalMs: Math.max(intervalMs, maxIntervalMs), owners: new Set(), active: false, sourceEpoch: 0, timer: null, controller: null, failureCount: 0, lastSuccessAt: null, lastProviderMs: NaN };
      groups.set(physicalKey, group);
    } else if (group.accountGeneration !== accountGeneration) {
      return { ok: false, error: '같은 물리 조회 키의 계좌 세대가 다르다' };
    }
    const inheritedFailure = FAILURE_STATES.has(feedState);
    const owner = {
      ownerId, accountGeneration, registrationRevision: ++revisionSequence,
      descriptor: Object.freeze({ ...descriptor, ownerId, kind, physicalKey, accountGeneration }),
      visible: descriptor.visible !== false, rememberedActive: descriptor.rememberedActive === true,
      explicitFailure: false,
      needsFallback: inheritedFailure, ownerEpoch: inheritedFailure ? 1 : 0, group,
      lastSuccessAt: null,
    };
    const previousIntervalMs = group.intervalMs;
    owners.set(ownerId, owner);
    group.owners.add(owner);
    group.intervalMs = Math.min(...liveOwners(group).map((item) => Number(item.descriptor.refreshIntervalMs)));
    if (group.active && group.timer !== null && group.intervalMs !== previousIntervalMs) {
      clearGroupTimer(group);
      schedule(group, group.intervalMs);
    }
    if (inheritedFailure) void activateGroup(group);
    return { ok: true, ...identity(owner), sourceEpoch: group.sourceEpoch, ownerEpoch: owner.ownerEpoch, status: owner.needsFallback ? 'api-fallback' : 'standby' };
  }

  function unregister(ownerId) {
    const key = clean(ownerId && typeof ownerId === 'object' ? ownerId.ownerId : ownerId);
    const owner = owners.get(key);
    if (!owner) return false;
    const group = owner.group;
    onState({ ...identity(owner), status: 'stopped', source: 'kiwoom-rest', transport: 'rest-fallback', sourceEpoch: group.sourceEpoch, ownerEpoch: owner.ownerEpoch + 1, asOf: null, lastSuccessAt: owner.lastSuccessAt });
    owners.delete(key);
    group.owners.delete(owner);
    if (!liveOwners(group).length) { deactivateGroup(group); groups.delete(group.physicalKey); }
    else {
      const previousIntervalMs = group.intervalMs;
      group.intervalMs = Math.min(...liveOwners(group).map((item) => Number(item.descriptor.refreshIntervalMs)));
      if (group.active && group.timer !== null && group.intervalMs !== previousIntervalMs) {
        clearGroupTimer(group);
        schedule(group, group.intervalMs);
      }
      if (!fallbackOwners(group).length) deactivateGroup(group);
    }
    return true;
  }

  function setOwnerVisible(ownerId, visible) {
    const owner = owners.get(clean(ownerId));
    if (!owner) return false;
    owner.visible = visible === true;
    if (owner.visible && owner.needsFallback) void activateGroup(owner.group);
    else if (!fallbackOwners(owner.group, true).length) clearGroupTimer(owner.group);
    return true;
  }

  function handleOwnerStatus(ownerId, status) {
    const owner = owners.get(clean(ownerId));
    if (!owner) return Promise.resolve(false);
    const state = clean(status && typeof status === 'object' ? status.state : status).toLowerCase();
    if (state === 'active' || state === 'receiving') {
      owner.explicitFailure = false;
      owner.rememberedActive = true;
      leaveFallback(owner);
      return Promise.resolve(true);
    }
    if (FAILURE_STATES.has(state)) {
      owner.explicitFailure = true;
      return enterFallback(owner);
    }
    return Promise.resolve(false);
  }

  function handleFeedStatus(status) {
    const state = clean(status && typeof status === 'object' ? status.state : status).toLowerCase();
    if (state === 'ready') {
      feedState = state;
      for (const owner of owners.values()) {
        if (owner.rememberedActive && !owner.explicitFailure) leaveFallback(owner);
      }
      return Promise.resolve([]);
    }
    if (!FAILURE_STATES.has(state)) return Promise.resolve([]);
    feedState = state;
    for (const owner of owners.values()) if (!owner.needsFallback) { owner.needsFallback = true; owner.ownerEpoch += 1; }
    return Promise.all([...groups.values()].map(activateGroup));
  }

  function resetAccount() {
    for (const group of groups.values()) deactivateGroup(group);
    owners.clear(); groups.clear(); feedState = 'unknown';
  }
  function close() { if (!closed) { resetAccount(); closed = true; } }

  return {
    register, unregister, setOwnerVisible, handleOwnerStatus, handleFeedStatus, resetAccount, close,
    size: () => owners.size, physicalSize: () => groups.size,
    status: (ownerId) => {
      const owner = owners.get(clean(ownerId));
      return owner ? { ...identity(owner), active: owner.group.active, needsFallback: owner.needsFallback, rememberedActive: owner.rememberedActive, sourceEpoch: owner.group.sourceEpoch, ownerEpoch: owner.ownerEpoch, lastSuccessAt: owner.lastSuccessAt } : null;
    },
  };
}

module.exports = { FALLBACK_KINDS, FAILURE_STATES, createRealtimeFallbackCoordinator };
