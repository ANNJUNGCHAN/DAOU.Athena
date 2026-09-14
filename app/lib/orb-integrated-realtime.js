(function () {
'use strict';

const isCjs = typeof module !== 'undefined' && !!module.exports;
const lib = (typeof window !== 'undefined' && window.AthenaLib) || {};
const boardFormat = isCjs ? require('./board-format') : lib.BoardFormat;
const orbQuoteRealtime = isCjs ? require('./orb-quote-realtime') : lib.OrbQuoteRealtime;

const OBSERVATION_ID = /^obs_[a-f0-9]{12,64}$/i;
const BINDING_ID = /^rtb_[a-f0-9]{12,64}$/i;
const FALLBACK_FAILURE = new Set(['disconnected', 'registration-failed', 'retrying', 'reconnecting', 'unavailable', 'unsupported', 'error']);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function surfaceContractOf(envelope) {
  return (envelope && (envelope.surface_contract || envelope.surfaceContract)) || null;
}

function realtimeBindingsOf(envelope) {
  const taskCanvas = (envelope && (envelope.task_canvas || envelope.taskCanvas)) || {};
  const candidates = [
    envelope && envelope.realtime_bindings,
    envelope && envelope.realtimeBindings,
    taskCanvas.realtime_bindings,
    taskCanvas.realtimeBindings,
  ];
  return candidates.find(Array.isArray) || [];
}

function slotEntriesOf(contract) {
  const raw = contract && (contract.slot_values || contract.slotValues);
  return Array.isArray(raw) ? raw : [];
}

function observationIdsOf(entry) {
  const ids = [];
  const direct = clean(entry && (entry.observation_id || entry.observationId));
  if (OBSERVATION_ID.test(direct)) ids.push(direct);
  const composite = boardFormat && boardFormat.compositeSpecOf(entry && entry.value);
  for (const part of (composite && Array.isArray(composite.parts)) ? composite.parts : []) {
    const id = clean(part && (part.observation_id || part.observationId));
    if (OBSERVATION_ID.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function kiumiFormats(contract) {
  const formats = new Map();
  const spec = contract && contract.kiumi;
  for (const element of (spec && Array.isArray(spec.elements)) ? spec.elements : []) {
    const slotId = clean(element && element.source_slot_id);
    if (slotId && element.format && typeof element.format === 'object') formats.set(slotId, element.format);
  }
  return formats;
}

function buildBindingPlan(envelope, excludedSlotIds = []) {
  const contract = surfaceContractOf(envelope);
  const excluded = new Set(Array.from(excludedSlotIds || [], clean).filter(Boolean));
  const kiumiElements = contract && contract.kiumi && Array.isArray(contract.kiumi.elements)
    ? contract.kiumi.elements : [];
  const visibleSlots = new Set(kiumiElements.map((element) => clean(element && element.source_slot_id)).filter(Boolean));
  const slotsByObservation = new Map();
  const entries = new Map();
  for (const entry of slotEntriesOf(contract)) {
    const slotId = clean(entry && (entry.slot_id || entry.slotId));
    if (!slotId || !visibleSlots.has(slotId) || excluded.has(slotId)) continue;
    entries.set(slotId, entry);
    for (const observationId of observationIdsOf(entry)) {
      if (!slotsByObservation.has(observationId)) slotsByObservation.set(observationId, []);
      slotsByObservation.get(observationId).push(slotId);
    }
  }
  const byBinding = new Map();
  const observationByBinding = new Map();
  for (const raw of realtimeBindingsOf(envelope)) {
    const bindingId = clean(raw && (raw.binding_id || raw.bindingId));
    const observationId = clean(raw && (raw.observation_id || raw.observationId));
    const slotIds = slotsByObservation.get(observationId);
    if (!BINDING_ID.test(bindingId) || !OBSERVATION_ID.test(observationId) || !slotIds) continue;
    byBinding.set(bindingId, [...new Set(slotIds)]);
    observationByBinding.set(bindingId, observationId);
  }
  return { contract, entries, formats: kiumiFormats(contract), byBinding, observationByBinding };
}

function updateValue(current, observationId, value) {
  const composite = boardFormat && boardFormat.compositeSpecOf(current);
  if (!composite) return { updated: true, value };
  if (!Array.isArray(composite.parts)) return { updated: false, value: current };
  let updated = false;
  const parts = composite.parts.map((part) => {
    const id = clean(part && (part.observation_id || part.observationId));
    if (id !== observationId) return part;
    updated = true;
    return { ...part, value };
  });
  return updated
    ? { updated: true, value: { ...current, composite: { ...composite, parts } } }
    : { updated: false, value: current };
}

function applyTone(node, tone) {
  if (!node || !node.classList) return;
  node.classList.toggle('is-missing', false);
  for (const name of ['up', 'down', 'flat']) node.classList.toggle(`is-${name}`, tone === name);
}

function payloadFor(envelope, leaseId, semanticBindingIds) {
  const args = (envelope && (envelope.operation_args || envelope.operationArgs || envelope.arguments)) || {};
  const context = envelope && envelope.source_data && envelope.source_data.canvas_context || {};
  const first = (...values) => values.map(clean).find(Boolean) || '';
  const refs = Array.isArray(envelope && envelope.operation_refs)
    ? envelope.operation_refs.map(clean).filter(Boolean)
    : [clean(envelope && (envelope.operation_ref || envelope.operationRef))].filter(Boolean);
  const explicitTargets = Array.isArray(envelope && envelope.visible_targets)
    ? envelope.visible_targets : null;
  const rows = envelope && envelope.data && Array.isArray(envelope.data.rows) ? envelope.data.rows : [];
  const visibleTargets = [];
  const candidates = explicitTargets || rows.map((row) => first(row && row.stk_cd, row && row.code, row && row.symbol));
  for (const candidate of candidates.slice(0, 50)) {
    const raw = typeof candidate === 'object'
      ? first(candidate && candidate.stk_cd, candidate && candidate.code, candidate && candidate.symbol)
      : clean(candidate);
    const value = /^[AJQ]\d{6}$/.test(raw) ? raw.slice(1) : raw;
    if (/^\d{6}$/.test(value) && !visibleTargets.includes(value)) visibleTargets.push(value);
  }
  return {
    leaseId,
    cardId: first(envelope && envelope.card_id, surfaceContractOf(envelope) && surfaceContractOf(envelope).card_id),
    mode: first(envelope && envelope.mode, envelope && envelope.capability, 'overview'),
    target: first(
      envelope && envelope.account_id, envelope && envelope.account_no,
      args.account_id, args.account_no, args.acnt_no,
      envelope && envelope.stk_cd, envelope && envelope.symbol, envelope && envelope.target,
      args.stk_cd, args.symbol, args.target, args.market, args.market_code,
      envelope && envelope.sector_id, args.sector_id, args.sect_code,
    ) || 'default',
    symbol: first(envelope && envelope.stk_cd, envelope && envelope.symbol, args.stk_cd, args.symbol, context.symbol),
    accountId: first(envelope && envelope.account_id, envelope && envelope.account_no, args.account_id, args.account_no, args.acnt_no),
    conditionId: first(envelope && envelope.condition_id, args.condition_id, args.seq),
    sectorId: first(envelope && envelope.sector_id, args.sector_id, args.sect_code),
    visibleTargets,
    verifiedOperationRefs: refs,
    realtimeEligible: !refs.includes('base:ka10099'),
    semanticBindingIds,
  };
}

function createOrbIntegratedRealtimeSession({
  card, envelope, leaseId, invoke, accountGeneration = 0, excludedSlotIds = [], onStatus = () => {},
  setTimer = setTimeout, clearTimer = clearTimeout, releaseRetryBaseMs = 250,
  releaseRetryMaxMs = 2000, releaseRetryAttempts = 5,
} = {}) {
  if (!card || typeof card.querySelectorAll !== 'function') throw new TypeError('card is required');
  if (!envelope || typeof envelope !== 'object') throw new TypeError('envelope is required');
  if (!clean(leaseId).startsWith('orb:')) throw new TypeError('orb leaseId is required');
  if (typeof invoke !== 'function') throw new TypeError('invoke is required');
  const plan = buildBindingPlan(envelope, excludedSlotIds);
  const payload = payloadFor(envelope, clean(leaseId), [...plan.byBinding.keys()]);
  let closed = false;
  let started = false;
  let mountAttempted = false;
  let releaseComplete = false;
  let releaseInFlight = false;
  let releaseTimer = null;
  let releaseAttempt = 0;
  let mounted = false;
  let expectedAccountGeneration = Number(accountGeneration);
  let generation = null;
  let connectionGeneration = null;
  let status = plan.byBinding.size ? 'idle' : 'snapshot';

  const stamp = (next, state = null) => {
    status = clean(next) || status;
    if (card.dataset) card.dataset.integratedRealtimeStatus = status;
    onStatus(status, state);
  };
  stamp(status);

  const release = () => {
    if (!mountAttempted || releaseComplete || releaseInFlight || releaseTimer !== null) return Promise.resolve(false);
    releaseInFlight = true;
    let pending;
    try {
      pending = Promise.resolve(invoke('athena:integrated-card-realtime-unmount', { leaseId: payload.leaseId }));
    } catch (error) {
      pending = Promise.reject(error);
    }
    return pending.then((result) => {
      releaseInFlight = false;
      if (result && result.ok === true) {
        releaseComplete = true;
        return true;
      }
      return scheduleReleaseRetry();
    }, () => {
      releaseInFlight = false;
      return scheduleReleaseRetry();
    });
  };

  const scheduleReleaseRetry = () => {
    if (releaseComplete || releaseTimer !== null || releaseAttempt + 1 >= releaseRetryAttempts) return false;
    const delay = Math.min(releaseRetryBaseMs * (2 ** releaseAttempt), releaseRetryMaxMs);
    releaseAttempt += 1;
    releaseTimer = setTimer(() => {
      releaseTimer = null;
      void release();
    }, delay);
    return false;
  };

  async function start() {
    if (started || closed) return false;
    started = true;
    if (!plan.byBinding.size) return false;
    stamp('registering');
    let state = null;
    try {
      mountAttempted = true;
      state = await invoke('athena:integrated-card-realtime-mount', payload);
    } catch {
      if (!closed) stamp('error');
      return false;
    }
    if (closed || !card.isConnected) {
      await release();
      return false;
    }
    if (!state || state.ok !== true) {
      if (Number.isInteger(Number(state && state.accountGeneration))) {
        expectedAccountGeneration = Number(state.accountGeneration);
      }
      stamp('error');
      return false;
    }
    if (Number.isInteger(Number(state.accountGeneration))) {
      expectedAccountGeneration = Number(state.accountGeneration);
    }
    mounted = true;
    generation = Number(state.generation);
    connectionGeneration = Number(state.connectionGeneration);
    stamp(state.status || 'active', state);
    return true;
  }

  function matches(message) {
    if (!message || clean(message.leaseId) !== payload.leaseId
      || clean(message.cardId) !== payload.cardId || clean(message.mode) !== payload.mode) return false;
    if (Object.prototype.hasOwnProperty.call(message, 'accountGeneration')
      && Number(message.accountGeneration) !== expectedAccountGeneration) return false;
    return true;
  }

  function applyState(state) {
    if (closed || !matches(state)) return false;
    if (Number.isFinite(Number(state.generation))) generation = Number(state.generation);
    if (Number.isFinite(Number(state.connectionGeneration))) connectionGeneration = Number(state.connectionGeneration);
    if (state.status === 'unmounted') mounted = false;
    else if (state.status === 'active') mounted = true;
    stamp(state.status || status, state);
    return true;
  }

  function applySlot(slotId, nextValue, observationId = '') {
    const entry = plan.entries.get(slotId);
    if (!entry) return 0;
    const next = observationId
      ? updateValue(entry.value, observationId, nextValue)
      : { updated: true, value: nextValue };
    if (!next.updated) return 0;
    const format = plan.formats.get(slotId) || entry.format || {};
    const formatted = boardFormat && boardFormat.formatSlot(format, next.value);
    if (!formatted || formatted.missing) return 0;
    let applied = 0;
    for (const node of card.querySelectorAll('[data-kiumi-slot-id]')) {
      if (clean(node && node.dataset && node.dataset.kiumiSlotId) !== slotId) continue;
      node.textContent = formatted.text;
      applyTone(node, formatted.tone);
      applied += 1;
    }
    if (!applied) return 0;
    entry.value = next.value;
    const revisions = card.__athenaOrbLiveSlotRevisions || new Map();
    revisions.set(slotId, (revisions.get(slotId) || 0) + 1);
    card.__athenaOrbLiveSlotRevisions = revisions;
    return applied;
  }

  function applyTick(tick) {
    if (closed || !mounted || !card.isConnected || !matches(tick)
      || Number(tick.generation) !== generation
      || Number(tick.connectionGeneration) !== connectionGeneration) return 0;
    let applied = 0;
    for (const update of Array.isArray(tick.semantic_updates) ? tick.semantic_updates : []) {
      const bindingId = clean(update && (update.binding_id || update.bindingId));
      const observationId = plan.observationByBinding.get(bindingId);
      if (!observationId) continue;
      for (const slotId of plan.byBinding.get(bindingId) || []) {
        applied += applySlot(slotId, update.value, observationId);
      }
    }
    if (applied) stamp('receiving');
    return applied;
  }

  function applyFallbackData(event) {
    if (closed || !card.isConnected || !event) return 0;
    let values = event.slotValues || event.slot_values;
    if (!values && event.envelope) {
      const contract = surfaceContractOf(event.envelope);
      values = contract && (contract.slot_values || contract.slotValues);
    }
    const entries = Array.isArray(values)
      ? values.map((entry) => [clean(entry && (entry.slot_id || entry.slotId)), entry && entry.value])
      : Object.entries((values && typeof values === 'object') ? values : {});
    let applied = 0;
    for (const [slotId, value] of entries) {
      if (!plan.entries.has(slotId)) continue;
      applied += applySlot(slotId, value);
    }
    return applied;
  }

  function close() {
    if (closed) return false;
    closed = true;
    mounted = false;
    if (releaseTimer !== null) {
      clearTimer(releaseTimer);
      releaseTimer = null;
    }
    stamp('stopped');
    void release();
    return true;
  }

  return {
    leaseId: payload.leaseId,
    payload,
    start,
    applyState,
    applyTick,
    applyFallbackData,
    close,
    status: () => status,
    bindingCount: plan.byBinding.size,
    slotIds: [...new Set([...plan.byBinding.values()].flat())],
    accountGeneration: () => expectedAccountGeneration,
  };
}

function createOrbIntegratedFallbackSession({
  ownerId, kind = 'integrated-board', accountGeneration, correlation, target, slotIds = [],
  invoke, onData, onState = () => {}, isCurrent = () => true,
} = {}) {
  if (!clean(ownerId) || !['integrated-board', 'semantic'].includes(kind)
    || !Number.isInteger(accountGeneration) || typeof invoke !== 'function'
    || typeof onData !== 'function') throw new TypeError('integrated fallback session 인자가 올바르지 않다');
  return orbQuoteRealtime.createOrbFallbackSession({
    ownerId, kind, accountGeneration, correlation, target, slotIds, invoke, onData, onState, isCurrent,
    failureStates: [...FALLBACK_FAILURE],
    validateData: (event) => clean(event && event.kind) === kind
      && event.source === 'kiwoom-rest' && event.transport === 'rest-fallback',
    errorMessage: 'integrated fallback session 인자가 올바르지 않다',
  });
}
const api = {
  buildBindingPlan, payloadFor, createOrbIntegratedRealtimeSession, createOrbIntegratedFallbackSession,
};
if (isCjs) module.exports = api;
else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.OrbIntegratedRealtime = api;
}
})();
