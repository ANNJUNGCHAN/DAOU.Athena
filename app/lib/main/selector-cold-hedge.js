'use strict';

const { isDeepStrictEqual } = require('node:util');
const { acceptedCatalogSelection } = require('./laya-routing');

const CLASSIFIERS_PER_TURN = 2;
const GLOBAL_CLASSIFIER_LIMIT = 4;

function abortError(signal) {
  const error = signal && signal.reason instanceof Error
    ? signal.reason
    : new Error('Selector cold-path classification이 중단됐다');
  if (!error.name || error.name === 'Error') error.name = 'AbortError';
  return error;
}

function createPairLimiter(limit = GLOBAL_CLASSIFIER_LIMIT) {
  let active = 0;
  const queue = [];

  function drain() {
    for (let i = 0; i < queue.length;) {
      const entry = queue[i];
      if (entry.signal && entry.signal.aborted) {
        queue.splice(i, 1);
        entry.reject(abortError(entry.signal));
        continue;
      }
      if (active + entry.count > limit) break;
      queue.splice(i, 1);
      active += entry.count;
      if (entry.signal) entry.signal.removeEventListener('abort', entry.onAbort);
      let released = false;
      entry.resolve(() => {
        if (released) return;
        released = true;
        active -= entry.count;
        drain();
      });
    }
  }

  return {
    acquire(count, signal) {
      if (count > limit) return Promise.reject(new Error('요청 슬롯이 전역 한도를 초과했다'));
      if (signal && signal.aborted) return Promise.reject(abortError(signal));
      return new Promise((resolve, reject) => {
        const entry = { count, signal, resolve, reject, onAbort: null };
        entry.onAbort = () => {
          const index = queue.indexOf(entry);
          if (index >= 0) queue.splice(index, 1);
          reject(abortError(signal));
        };
        if (signal) signal.addEventListener('abort', entry.onAbort, { once: true });
        queue.push(entry);
        drain();
      });
    },
    active: () => active,
  };
}

const globalPairLimiter = createPairLimiter();

function compactCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const operationRef = String(candidate.operation_ref || candidate.ref || '').trim();
  if (!operationRef) return null;
  return {
    operation_ref: operationRef,
    kind: candidate.kind || null,
    detail_group: candidate.detail_group || null,
    required_arguments: candidate.required_arguments || candidate.required_args || candidate.required_fields || null,
    argument_contracts: candidate.argument_contracts || candidate.arguments || candidate.argument_schema || null,
  };
}

const DEFAULT_DECISION_TTL_MS = 60_000;
const DEFAULT_DECISION_MAX_ENTRIES = 128;

function normalizeDecisionQuestion(question) {
  return String(question || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[?!.…~\s]+$/g, '')
    .toLocaleLowerCase('ko-KR');
}

function compactBoundArguments(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.hasOwn(value, 'plan_token')) {
    return {};
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key, entry]) => key !== 'plan_token' && entry != null && String(entry).trim() !== ''));
}

function createDecisionCache({
  ttlMs = DEFAULT_DECISION_TTL_MS,
  maxEntries = DEFAULT_DECISION_MAX_ENTRIES,
  clock = Date.now,
} = {}) {
  const map = new Map();

  function fingerprint(question, preflight) {
    const refs = (Array.isArray(preflight && preflight.candidates) ? preflight.candidates : [])
      .slice(0, 3)
      .map((candidate) => String(candidate.operation_ref || candidate.ref || '').trim())
      .filter(Boolean)
      .join(',');
    const bound = compactBoundArguments(preflight && preflight.bound_arguments);
    const boundKey = JSON.stringify(bound, Object.keys(bound).sort());
    return `${normalizeDecisionQuestion(question)}\x1f${String((preflight && preflight.catalog_version) || '')}\x1f${refs}\x1f${boundKey}`;
  }

  return {
    get(question, preflight) {
      const key = fingerprint(question, preflight);
      const entry = map.get(key);
      if (!entry) return null;
      if (clock() - entry.storedAt > ttlMs) {
        map.delete(key);
        return null;
      }
      return entry.proposal;
    },
    set(question, preflight, proposal) {
      if (!proposal || typeof proposal !== 'object' || Object.hasOwn(proposal, 'plan_token')) return;
      const key = fingerprint(question, preflight);
      if (map.has(key)) map.delete(key);
      map.set(key, { storedAt: clock(), proposal });
      while (map.size > maxEntries) {
        map.delete(map.keys().next().value);
      }
    },
    size: () => map.size,
    clear: () => map.clear(),
  };
}

function schemaGatedProposal(preflight) {
  const candidates = Array.isArray(preflight && preflight.candidates) ? preflight.candidates.slice(0, 3) : [];
  if (candidates.length !== 1) return null;
  const candidate = candidates[0];
  const kind = candidateKind(candidate);
  if (kind !== 'query' && kind !== 'detail') return null;
  const bound = compactBoundArguments(preflight && preflight.bound_arguments);
  const { required, specs } = collectArgumentContract(candidate);
  const args = {};
  for (const name of required) {
    if (!Object.prototype.hasOwnProperty.call(bound, name)) return null;
    if (!valueMatches(bound[name], specs.get(name) || {})) return null;
    args[name] = bound[name];
  }
  for (const [name, value] of Object.entries(bound)) {
    if (!specs.has(name)) continue;
    if (!valueMatches(value, specs.get(name))) return null;
    args[name] = value;
  }
  const operationRef = String(candidate.operation_ref || candidate.ref || '').trim();
  const detailGroup = candidate.detail_group == null
    ? (operationRef.startsWith('detail:') ? operationRef.split(':').slice(2).join(':') || null : null)
    : String(candidate.detail_group);
  try {
    return validateProposal({
      intent: 'query',
      operation_ref: operationRef,
      detail_group: detailGroup,
      arguments: args,
    }, preflight);
  } catch {
    return null;
  }
}

function buildClassificationPrompt(question, preflight) {
  const candidates = (Array.isArray(preflight && preflight.candidates) ? preflight.candidates : [])
    .slice(0, 3)
    .map(compactCandidate)
    .filter(Boolean);
  return [
    'You are a side-effect-free route classifier. Do not call tools.',
    'Return exactly one JSON object and no markdown or explanation.',
    'Schema: {"intent":"query","operation_ref":"...","detail_group":null,"arguments":{}}',
    'Choose exactly one operation_ref from candidates. Fill only arguments supported by its contract.',
    'Use Bound arguments when they already satisfy a candidate contract.',
    `Question: ${String(question || '')}`,
    `Catalog version: ${String(preflight && preflight.catalog_version || '')}`,
    `Bound arguments: ${JSON.stringify(compactBoundArguments(preflight && preflight.bound_arguments))}`,
    `Candidates: ${JSON.stringify(candidates)}`,
  ].join('\n');
}

function buildArgumentExtractionPrompt(question, preflight) {
  const candidate = compactCandidate(preflight.candidates[0]);
  const contract = candidate.argument_contracts;
  if (contract && contract.type === 'object' && contract.properties && !Array.isArray(contract.properties)
      && Array.isArray(contract.required) && contract.additionalProperties === false) {
    // A complete catalog schema already contains every required field and its
    // constraints. Keep that schema intact instead of sending those fields twice.
    delete candidate.required_arguments;
    candidate.name = preflight.candidates[0].name || null;
  }
  return [
    'Extract arguments for the already selected read-only operation. Do not choose a route or call tools.',
    'Return exactly one JSON object: {"arguments":{}}. Fill only fields in the contract; do not invent missing values.',
    `Question: ${String(question || '')}`,
    `Bound arguments: ${JSON.stringify(compactBoundArguments(preflight.bound_arguments))}`,
    `Argument contract: ${JSON.stringify(candidate)}`,
  ].join('\n');
}

function buildOperationChoices(preflight) {
  return (preflight.candidates || []).filter((candidate) => candidateKind(candidate)).map((candidate, index) => ({
    id: `candidate_${index + 1}`,
    label: String(candidate.name || candidate.title || candidate.operation_ref || candidate.ref),
    description: [candidate.operation_ref || candidate.ref, candidate.detail_group,
      candidate.group_title_ko || candidate.group_title_en, candidate.description || candidate.summary]
      .filter(Boolean).join(' · '),
  }));
}

function strictJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const text = String(value || '').trim();
  if (!text.startsWith('{') || !text.endsWith('}')) throw new Error('strict_json_required');
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('json_object_required');
  return parsed;
}

function extractClassifierText(result) {
  if (!result || result.ok !== true) throw new Error('classifier_failed');
  if (result.finalResult && typeof result.finalResult.result === 'string') return result.finalResult.result;
  if (typeof result.result === 'string' || (result.result && typeof result.result === 'object')) return result.result;
  throw new Error('classifier_result_missing');
}

function candidateKind(candidate) {
  const kind = String(candidate.kind || '').toLowerCase();
  if (kind === 'websocket' && ['base:ka10171', 'base:ka10172'].includes(candidate.operation_ref)) return 'query';
  if (kind === 'detail' || String(candidate.operation_ref || candidate.ref || '').startsWith('detail:')) return 'detail';
  if (['query', 'base', 'tr'].includes(kind)) return 'query';
  return null;
}

function collectArgumentContract(candidate) {
  const required = new Set();
  const specs = new Map();
  const add = (entry, requiredByContainer = false) => {
    if (typeof entry === 'string') {
      specs.set(entry, {});
      if (requiredByContainer) required.add(entry);
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    const name = String(entry.alias || entry.name || entry.key || entry.field || '').trim();
    if (!name) return;
    specs.set(name, entry.json_schema && typeof entry.json_schema === 'object'
      ? { ...entry, ...entry.json_schema }
      : entry);
    if (requiredByContainer || entry.required === true) required.add(name);
  };

  const requiredEntries = candidate.required_arguments || candidate.required_args || candidate.required_fields;
  if (Array.isArray(requiredEntries)) requiredEntries.forEach((entry) => add(entry, true));

  const contract = candidate.argument_contracts || candidate.arguments || candidate.argument_schema;
  if (Array.isArray(contract)) contract.forEach((entry) => add(entry));
  if (contract && typeof contract === 'object' && !Array.isArray(contract)) {
    if (Array.isArray(contract.required)) contract.required.forEach((entry) => add(entry, true));
    const properties = contract.properties && typeof contract.properties === 'object'
      ? contract.properties
      : contract;
    for (const [name, spec] of Object.entries(properties)) {
      if (['required', 'additionalProperties'].includes(name)) continue;
      add({ name, ...(spec && typeof spec === 'object' ? spec : {}) });
    }
  }
  return { required, specs };
}

function valueMatches(value, spec) {
  if (value == null || (typeof value === 'string' && !value.trim())) return false;
  const type = String(spec.type || '').toLowerCase();
  if ((type === 'integer' || type === 'int') && !/^-?\d+$/.test(String(value))) return false;
  if (type === 'number' && !Number.isFinite(Number(value))) return false;
  if (type === 'boolean' && typeof value !== 'boolean') return false;
  const choices = spec.enum || spec.choices || spec.allowed_values;
  if (Array.isArray(choices) && !choices.map(String).includes(String(value))) return false;
  if (spec.pattern) {
    try {
      if (!(new RegExp(spec.pattern)).test(String(value))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function mergeSelectedArguments(extracted, candidate, boundArguments) {
  if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) {
    throw new Error('arguments_object_required');
  }
  const { specs } = collectArgumentContract(candidate);
  const validBound = Object.entries(compactBoundArguments(boundArguments))
    .filter(([name, value]) => specs.has(name) && valueMatches(value, specs.get(name)));
  for (const [name, value] of validBound) {
    if (Object.hasOwn(extracted, name) && !isDeepStrictEqual(extracted[name], value)) {
      throw new Error('bound_argument_conflict');
    }
  }
  return { ...Object.fromEntries(validBound), ...extracted };
}

function validateProposal(raw, preflight) {
  const proposal = strictJson(raw);
  const operationRef = String(proposal.operation_ref || '').trim();
  const candidates = Array.isArray(preflight && preflight.candidates) ? preflight.candidates.slice(0, 3) : [];
  const candidate = candidates.find((item) => String(item.operation_ref || item.ref || '') === operationRef);
  if (!candidate) throw new Error('candidate_mismatch');
  const kind = candidateKind(candidate);
  if (!kind) throw new Error('unsupported_candidate_kind');
  const intent = String(proposal.intent || '').toLowerCase();
  if (!['query', 'detail', 'auto'].includes(intent)) throw new Error('unsupported_intent');
  if (intent === 'detail' && kind !== 'detail') throw new Error('intent_kind_mismatch');
  if (intent === 'query' && kind === 'detail') {
    // Backend dispatch의 public intent는 detail projection도 query로 받는다.
  }
  if (Object.hasOwn(proposal, 'plan_token')) throw new Error('plan_token_forbidden');
  const args = proposal.arguments && typeof proposal.arguments === 'object' && !Array.isArray(proposal.arguments)
    ? proposal.arguments
    : null;
  if (!args) throw new Error('arguments_object_required');
  const { required, specs } = collectArgumentContract(candidate);
  for (const name of required) {
    if (!Object.prototype.hasOwnProperty.call(args, name)) {
      throw new Error('required_argument_missing');
    }
    if (!valueMatches(args[name], specs.get(name) || {})) throw new Error('argument_contract_mismatch');
  }
  if (specs.size) {
    for (const [name, value] of Object.entries(args)) {
      const spec = specs.get(name);
      if (!spec || !valueMatches(value, spec)) throw new Error('argument_contract_mismatch');
    }
  }
  const candidateDetailGroup = candidate.detail_group == null ? null : String(candidate.detail_group);
  const proposalDetailGroup = proposal.detail_group == null ? null : String(proposal.detail_group);
  if (candidateDetailGroup && proposalDetailGroup && candidateDetailGroup !== proposalDetailGroup) {
    throw new Error('detail_group_mismatch');
  }
  return Object.freeze({
    intent: kind === 'detail' ? 'query' : (intent === 'auto' ? 'query' : intent),
    operation_ref: operationRef,
    detail_group: candidateDetailGroup || proposalDetailGroup,
    arguments: Object.freeze({ ...args }),
  });
}

async function dispatchValidated(proposal, {
  dispatchProposal,
  signal,
  isCurrent,
  decisionCache,
  question,
  preflight,
  modelCalls,
  extras = {},
}) {
  if ((signal && signal.aborted) || !isCurrent()) throw abortError(signal);
  const dispatched = await dispatchProposal(proposal);
  if ((signal && signal.aborted) || !isCurrent()) throw abortError(signal);
  if (!dispatched || dispatched.handled !== true) {
    return { handled: false, reason: 'proposal_rejected', modelCalls };
  }
  if (decisionCache) decisionCache.set(question, preflight, proposal);
  return {
    ...dispatched,
    source: 'selector-cold',
    modelCalls,
    classifiedOperationRef: proposal.operation_ref,
    ...extras,
  };
}

function createSelectorColdHedge({
  limiter = globalPairLimiter,
  decisionCache = createDecisionCache(),
} = {}) {
  return async function runSelectorColdHedge({
    question,
    preflight,
    classify,
    selectOperation,
    selectCatalogOperation,
    dispatchProposal,
    signal,
    isCurrent = () => true,
  } = {}) {
    if (typeof classify !== 'function' || typeof dispatchProposal !== 'function') {
      throw new TypeError('classify와 dispatchProposal이 필요하다');
    }
    if (signal && signal.aborted) throw abortError(signal);
    const candidates = Array.isArray(preflight && preflight.candidates) ? preflight.candidates : [];
    if (!candidates.length || candidates.length > 3 || Object.hasOwn(preflight, 'plan_token')) {
      return { handled: false, reason: 'invalid_preflight', modelCalls: 0 };
    }
    if (!candidates.some((candidate) => candidateKind(candidate))) {
      return { handled: false, reason: 'unsupported_candidates', modelCalls: 0 };
    }

    const cached = decisionCache ? decisionCache.get(question, preflight) : null;
    if (cached) {
      try {
        const proposal = validateProposal(cached, preflight);
        return await dispatchValidated(proposal, {
          dispatchProposal,
          signal,
          isCurrent,
          decisionCache,
          question,
          preflight,
          modelCalls: 0,
          extras: { cacheHit: true },
        });
      } catch {
        // Stale cache entries fall through to schema gating / classifiers.
      }
    }

    const gated = schemaGatedProposal(preflight);
    if (gated) {
      return dispatchValidated(gated, {
        dispatchProposal,
        signal,
        isCurrent,
        decisionCache,
        question,
        preflight,
        modelCalls: 0,
        extras: { schemaGated: true },
      });
    }

    let classificationPreflight = preflight;
    let layaSelected = false;
    let layaCatalogSelected = false;
    const selectable = candidates.filter((candidate) => candidateKind(candidate));
    const fullCatalog = typeof selectCatalogOperation === 'function';
    if (fullCatalog || (typeof selectOperation === 'function' && selectable.length >= 2)) {
      const choices = fullCatalog ? null : buildOperationChoices(preflight);
      let selection = null;
      try {
        selection = fullCatalog
          ? await selectCatalogOperation({ question, catalog_version: preflight.catalog_version, signal, isCurrent })
          : await selectOperation({ question, candidates: choices, signal, isCurrent });
      }
      catch (error) {
        if ((signal && signal.aborted) || !isCurrent() || error.name === 'AbortError') throw abortError(signal);
      }
      if ((signal && signal.aborted) || !isCurrent()) throw abortError(signal);
      const catalogSelection = fullCatalog ? acceptedCatalogSelection(selection, preflight.catalog_version) : null;
      const index = !fullCatalog && selection && selection.task === 'operation_selection'
        ? choices.findIndex((choice) => choice.id === selection.choice) : -1;
      const selected = catalogSelection ? catalogSelection.candidate : (index >= 0 ? selectable[index] : null);
      if (selected) {
        classificationPreflight = { ...preflight, candidates: [selected] };
        layaSelected = true;
        layaCatalogSelected = fullCatalog;
        const selectedProposal = schemaGatedProposal(classificationPreflight);
        if (selectedProposal) {
          return dispatchValidated(selectedProposal, {
            dispatchProposal, signal, isCurrent, decisionCache: fullCatalog ? null : decisionCache, question, preflight,
            modelCalls: 0, extras: { layaSelected: true, ...(fullCatalog ? { layaCatalogSelected: true } : {}) },
          });
        }
      }
    }

    const release = await limiter.acquire(CLASSIFIERS_PER_TURN, signal);
    if ((signal && signal.aborted) || !isCurrent()) {
      release();
      throw abortError(signal);
    }
    const controllers = [new AbortController(), new AbortController()];
    const abortChildren = () => controllers.forEach((controller) => {
      if (!controller.signal.aborted) controller.abort(signal && signal.reason);
    });
    if (signal) signal.addEventListener('abort', abortChildren, { once: true });
    // A finite selection never supplies dates, symbols or other free arguments.
    // The existing CLI fills missing values under the selected candidate schema.
    const prompt = layaSelected
      ? buildArgumentExtractionPrompt(question, classificationPreflight)
      : buildClassificationPrompt(question, classificationPreflight);
    const tasks = controllers.map((controller, index) => Promise.resolve()
      .then(() => classify({ prompt, signal: controller.signal, index }))
      .then(extractClassifierText)
      .then((text) => {
        if (!layaSelected) return validateProposal(text, classificationPreflight);
        const extracted = strictJson(text);
        if (Object.keys(extracted).some((key) => key !== 'arguments')) throw new Error('arguments_only_required');
        const selected = classificationPreflight.candidates[0];
        const selectedRef = String(selected.operation_ref || selected.ref);
        return validateProposal({
          intent: 'query', operation_ref: selectedRef,
          detail_group: selected.detail_group || (selectedRef.startsWith('detail:')
            ? selectedRef.split(':').slice(2).join(':') || null : null),
          arguments: mergeSelectedArguments(extracted.arguments, selected, classificationPreflight.bound_arguments),
        }, classificationPreflight);
      }));
    Promise.allSettled(tasks).finally(() => {
      if (signal) signal.removeEventListener('abort', abortChildren);
      release();
    });

    let proposal;
    try {
      proposal = await Promise.any(tasks);
    } catch {
      abortChildren();
      if (signal && signal.aborted) throw abortError(signal);
      return { handled: false, reason: 'classification_failed', modelCalls: CLASSIFIERS_PER_TURN };
    }
    // 첫 유효안이 도착해도 나머지 분류 턴은 중단하지 않는다. 지속형 Claude
    // worker는 턴 중단 시 프로세스 자체를 교체해야 하므로, 정상 hedge마다 loser를
    // abort하면 매 요청마다 다시 CLI를 기동하게 된다. 늦은 결과는 버리되 worker는
    // 같은 프로세스에서 턴을 끝내고 warm 상태로 돌아간다. 부모 signal(사용자 취소·
    // 새 질의 선점)은 위 리스너가 두 턴을 계속 중단하므로 취소 계약은 유지된다.
    if ((signal && signal.aborted) || !isCurrent()) throw abortError(signal);

    return dispatchValidated(proposal, {
      dispatchProposal,
      signal,
      isCurrent,
      // Full-catalog decisions cannot share the old three-candidate fingerprint.
      decisionCache: layaCatalogSelected ? null : decisionCache,
      question,
      preflight,
      modelCalls: CLASSIFIERS_PER_TURN,
      extras: { layaSelected, ...(layaCatalogSelected ? { layaCatalogSelected: true } : {}) },
    });
  };
}

const runSelectorColdHedge = createSelectorColdHedge();

module.exports = {
  CLASSIFIERS_PER_TURN,
  DEFAULT_DECISION_MAX_ENTRIES,
  DEFAULT_DECISION_TTL_MS,
  GLOBAL_CLASSIFIER_LIMIT,
  buildClassificationPrompt,
  buildArgumentExtractionPrompt,
  buildOperationChoices,
  createDecisionCache,
  createPairLimiter,
  createSelectorColdHedge,
  runSelectorColdHedge,
  schemaGatedProposal,
  validateProposal,
};
