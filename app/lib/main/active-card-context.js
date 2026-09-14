'use strict';

const { matchesMarketOrderGrammar } = require('./selector-fast-path');

const MAX_CARDS = 6;
const MAX_ARRAY_ITEMS = 240;
const MAX_OBJECT_KEYS = 80;
const MAX_STRING_LENGTH = 2000;
const MAX_DEPTH = 8;
const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_CONTEXT_NODES = 2000;
const MAX_SERIALIZED_CONTEXT_BYTES = 96 * 1024;
const MAX_OBSERVATION_TEXT = 400;
const TRUNCATED = '[context budget limit]';
const SAFE_PATH_PART = /^[A-Za-z0-9_$-]+$/;
const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);
const SENSITIVE_KEY_RE = /(?:account[_-]?(?:no|number|id)|acnt[_-]?(?:no|number|id)|acct[_-]?(?:no|number|id)|계좌.*(?:번호|id)|token|토큰|authorization|bearer|secret|password|비밀번호|credential|api[_-]?key)/iu;
const SENSITIVE_RECORD_DISCRIMINATORS = [
  'key', 'field', 'f', 'name', 'label', 'id', 'title', 'kor', 'header_ko', 'headerKo',
];
const SENSITIVE_RECORD_VALUES = [
  'value', 'text', 'display', 'formatted', 'raw', 'v',
  'paper_text', 'paperText', 'paper_text_override', 'paperTextOverride',
  'node_name', 'nodeName', 'control_text', 'controlText',
];

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function boundedText(value, maxLength) {
  const text = cleanText(value);
  return text.length <= maxLength ? text : '';
}

function isSensitiveKey(value) {
  return SENSITIVE_KEY_RE.test(String(value || ''));
}

function sensitiveRecord(object) {
  return SENSITIVE_RECORD_DISCRIMINATORS
    .some((key) => typeof object[key] === 'string' && isSensitiveKey(object[key]));
}

function sensitiveColumnIndexes(object) {
  const definitions = ['fields', 'header', 'headers', 'columns']
    .map((key) => object[key]).find(Array.isArray);
  if (!definitions) return null;
  const indexes = new Set();
  definitions.forEach((definition, index) => {
    if ((typeof definition === 'string' && isSensitiveKey(definition))
        || (definition && typeof definition === 'object' && sensitiveRecord(definition))) indexes.add(index);
  });
  return indexes.size ? indexes : null;
}

function visibleMetadataChildren(value, state) {
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) state.truncated = true;
    return value.slice(Math.max(0, value.length - MAX_ARRAY_ITEMS));
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_OBJECT_KEYS) state.truncated = true;
  return keys.slice(0, MAX_OBJECT_KEYS).map((key) => ({ key, value: value[key] }));
}

function containsSensitiveMetadata(value, seen = new Set(), depth = 0,
    state = { remainingNodes: MAX_CONTEXT_NODES, truncated: false }) {
  if (typeof value === 'string') return isSensitiveKey(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  if (depth >= MAX_DEPTH) {
    state.truncated = true;
    return true;
  }
  if (state.remainingNodes <= 0) {
    state.truncated = true;
    return false;
  }
  state.remainingNodes -= 1;
  seen.add(value);
  const children = visibleMetadataChildren(value, state);
  if (Array.isArray(value)) {
    return children.some((child) => containsSensitiveMetadata(child, seen, depth + 1, state));
  }
  for (const { key, value: child } of children) {
    if (key === 'slot_values' || key === 'slotValues') continue;
    if (isSensitiveKey(key) || containsSensitiveMetadata(child, seen, depth + 1, state)) return true;
  }
  return false;
}

function collectSensitiveSlotIds(value, ids = new Set(), seen = new Set(), depth = 0,
    state = { remainingNodes: MAX_CONTEXT_NODES, truncated: false }) {
  if (!value || typeof value !== 'object' || seen.has(value)) return ids;
  if (depth >= MAX_DEPTH) {
    state.truncated = true;
    ids.truncated = true;
    return ids;
  }
  if (state.remainingNodes <= 0) {
    state.truncated = true;
    ids.truncated = true;
    return ids;
  }
  state.remainingNodes -= 1;
  seen.add(value);
  const metadataState = { remainingNodes: state.remainingNodes, truncated: false };
  if (containsSensitiveMetadata(value, new Set(), depth, metadataState)) {
    for (const key of ['slot_id', 'source_slot_id', 'slotId', 'sourceSlotId']) {
      if (typeof value[key] === 'string' && value[key]) ids.add(value[key]);
    }
  }
  if (metadataState.truncated) {
    state.truncated = true;
    ids.truncated = true;
    return ids;
  }
  const children = visibleMetadataChildren(value, state);
  if (Array.isArray(value)) {
    for (const child of children) collectSensitiveSlotIds(child, ids, seen, depth + 1, state);
  } else {
    for (const { key, value: child } of children) {
      if (key !== 'slot_values' && key !== 'slotValues') {
        collectSensitiveSlotIds(child, ids, seen, depth + 1, state);
      }
    }
  }
  if (state.truncated) ids.truncated = true;
  return ids;
}

function slotValueId(value) {
  if (!value || typeof value !== 'object') return '';
  return cleanText(value.slot_id) || cleanText(value.source_slot_id)
    || cleanText(value.slotId) || cleanText(value.sourceSlotId);
}

function requiresGroundedCardAnswer(question, requested, { closedDatasetMatched = false } = {}) {
  const text = String(question || '').normalize('NFKC').toLocaleLowerCase('ko-KR');
  if (!text.trim()) return false;
  if (matchesMarketOrderGrammar(question)) return false;
  const selectedCardId = cleanText(requested && requested.selectedCardId);
  const selectionMode = cleanText(requested && requested.selectionMode);
  const hasExplicitComponent = selectedCardId && (selectionMode === 'explicit-component'
    || !!(requested && requested.selectedComponent));
  if (hasExplicitComponent) return true;
  if (closedDatasetMatched) return false;
  return /(?:분석|해석|설명|어때|어떻|상황|전망|추세|흐름|신호|의미|왜|리스크|위험|지지선|저항선|과매수|과매도|진입|청산)/u.test(text)
    || /(?:사야(?:\s*해)?|살까|사는\s*게|팔아야|팔까|매수(?:해도|할까|가\s*(?:좋|나)|\s*타이밍|\s*시점)|매도(?:해도|할까|가\s*(?:좋|나)|\s*타이밍|\s*시점)|업종\s*평균|싼\s*거|비싼\s*거|얼마나\s*(?:늘|줄)|요약|(?:per|pbr|roe|roa)\s*(?:이|가|은|는)?\s*(?:낮|높))/u.test(text);
}

function shouldAttemptCardFirstLookup(question, requested, activeCardContext) {
  if (!requiresGroundedCardAnswer(question, requested) || matchesMarketOrderGrammar(question)) return false;
  const selectionMode = cleanText(requested && requested.selectionMode);
  if (selectionMode === 'explicit-component' || (requested && requested.selectedComponent)) return false;
  if (!activeCardContext || activeCardContext.status !== 'available') {
    return !cleanText(requested && requested.selectedCardId);
  }
  const text = String(question || '').normalize('NFKC').toLocaleLowerCase('ko-KR');
  const screen = /(?:차트|일봉|시세|현재가|호가|수급|거래원|종목정보|프로그램매매)/u.exec(text);
  if (!screen || !/(?:분석|해석|설명|어때|어떻|상황|전망|추세|흐름|신호|의미|왜)/u.test(text)) return false;
  const subject = text.slice(0, screen.index)
    .replace(/^\s*(?:지금|현재)\s*/u, '')
    .replace(/(?:의|주식)\s*$/u, '')
    .trim();
  return !!subject && !/^(?:이|그|저|이거|그거|저거|이건|그건|저건|여기|거기|저기|해당|위|아래)$/u.test(subject);
}

function createBudget() {
  return { remainingBytes: MAX_CONTEXT_BYTES, remainingNodes: MAX_CONTEXT_NODES, truncated: false };
}

function consumeBudget(budget, value) {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (budget.remainingNodes <= 0 || budget.remainingBytes < bytes) {
    budget.truncated = true;
    return false;
  }
  budget.remainingNodes -= 1;
  budget.remainingBytes -= bytes;
  return true;
}

function compactString(value, budget) {
  const limit = Math.min(value.length, MAX_STRING_LENGTH);
  let low = 0;
  let high = limit;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = value.slice(0, middle);
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= budget.remainingBytes) low = middle;
    else high = middle - 1;
  }
  const omitted = value.length - low;
  const suffix = omitted > 0 ? `…[truncated ${omitted} chars]` : '';
  let result = `${value.slice(0, low)}${suffix}`;
  while (result && Buffer.byteLength(JSON.stringify(result), 'utf8') > budget.remainingBytes) {
    result = result.slice(0, -1);
  }
  if (omitted > 0 || low < limit) budget.truncated = true;
  return consumeBudget(budget, result) ? result : TRUNCATED;
}

function compactValue(value, depth = 0, budget = createBudget(), options = {}) {
  if (budget.remainingNodes <= 0 || budget.remainingBytes <= 0) {
    budget.truncated = true;
    return TRUNCATED;
  }
  if (value == null || typeof value === 'boolean' || typeof value === 'number') {
    return consumeBudget(budget, value) ? value : TRUNCATED;
  }
  if (typeof value === 'string') return compactString(value, budget);
  if (depth >= MAX_DEPTH) {
    budget.truncated = true;
    return '[depth limit]';
  }
  if (Array.isArray(value)) {
    const start = Math.max(0, value.length - MAX_ARRAY_ITEMS);
    const items = [];
    if (start > 0) {
      budget.truncated = true;
      items.push(`[${start} earlier items omitted]`);
    }
    for (let index = start; index < value.length; index += 1) {
      if (budget.remainingNodes <= 0 || budget.remainingBytes <= 0) {
        budget.truncated = true;
        items.push(TRUNCATED);
        break;
      }
      const item = value[index];
      const redactSlotValue = options.slotValues === true && (options.redactAllSlotValues === true
        || (options.sensitiveSlotIds && options.sensitiveSlotIds.has(slotValueId(item))));
      items.push(options.redactIndices && options.redactIndices.has(index)
        ? '[redacted]'
        : compactValue(item, depth + 1, budget, {
          sensitiveSlotIds: options.sensitiveSlotIds,
          redactAllSlotValues: options.redactAllSlotValues,
          redactSlotValue,
          ...(options.rowIndexes ? { redactIndices: options.rowIndexes } : {}),
        }));
    }
    return items;
  }
  if (typeof value !== 'object') {
    const converted = String(value);
    return consumeBudget(budget, converted) ? converted : TRUNCATED;
  }
  const slotValuesKey = Object.hasOwn(value, 'slot_values') ? 'slot_values'
    : Object.hasOwn(value, 'slotValues') ? 'slotValues' : null;
  const sensitiveSlotIds = options.sensitiveSlotIds
    || (slotValuesKey ? collectSensitiveSlotIds(value) : new Set());
  const redactAllSlotValues = options.redactAllSlotValues === true || sensitiveSlotIds.truncated === true;
  if (options.slotValues === true) {
    const projectedSlotValues = {};
    for (const [slotId, slotValue] of Object.entries(value)) {
      projectedSlotValues[slotId] = redactAllSlotValues || sensitiveSlotIds.has(slotId)
        ? '[redacted]' : slotValue;
    }
    return compactValue(projectedSlotValues, depth, budget, { sensitiveSlotIds });
  }
  const result = {};
  const redactRecordValue = sensitiveRecord(value);
  const redactRowIndexes = sensitiveColumnIndexes(value);
  let keys = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (keys >= MAX_OBJECT_KEYS || budget.remainingNodes <= 0 || budget.remainingBytes <= 0) {
      budget.truncated = true;
      result.__truncated__ = TRUNCATED;
      break;
    }
    if (!consumeBudget(budget, key)) {
      result.__truncated__ = TRUNCATED;
      break;
    }
    const isRecordValue = redactRecordValue
      && SENSITIVE_RECORD_VALUES.includes(key);
    const isLinkedSlotValue = options.redactSlotValue
      && SENSITIVE_RECORD_VALUES.includes(key);
    if (isSensitiveKey(key) || isRecordValue || isLinkedSlotValue) result[key] = '[redacted]';
    else if (key === 'rows' && redactRowIndexes && Array.isArray(value[key])) {
      result[key] = compactValue(value[key], depth + 1, budget, {
        rowIndexes: redactRowIndexes,
      });
    } else if ((key === 'slot_values' || key === 'slotValues')
        && value[key] && typeof value[key] === 'object') {
      if (Array.isArray(value[key])) {
        result[key] = compactValue(value[key], depth + 1, budget, {
          sensitiveSlotIds, redactAllSlotValues, slotValues: true,
        });
      } else {
        const redactedSlotValues = {};
        for (const [slotId, slotValue] of Object.entries(value[key])) {
          redactedSlotValues[slotId] = redactAllSlotValues || sensitiveSlotIds.has(slotId)
            ? '[redacted]' : slotValue;
        }
        result[key] = compactValue(redactedSlotValues, depth + 1, budget, { sensitiveSlotIds });
      }
    } else result[key] = compactValue(value[key], depth + 1, budget);
    keys += 1;
  }
  return result;
}

function sourceCard(card) {
  if (!card || typeof card !== 'object') return null;
  const cardId = boundedText(card.cardId, 128);
  if (!cardId || !card.envelope || typeof card.envelope !== 'object' || Array.isArray(card.envelope)) return null;
  return {
    cardId,
    kind: boundedText(card.kind, 80) || null,
    capturedAt: boundedText(card.createdAt, 64) || boundedText(card.capturedAt, 64) || null,
    envelope: card.envelope,
  };
}

function safeCard(card, budget) {
  const source = sourceCard(card);
  return source ? { ...source, envelope: compactValue(source.envelope, 0, budget) } : null;
}

function pathParts(path) {
  const value = cleanText(path);
  if (!value || value.length > 240) return null;
  const parts = value.split('.');
  if (parts.some((part) => !SAFE_PATH_PART.test(part) || FORBIDDEN_PATH_PARTS.has(part))) return null;
  return parts;
}

function selectedPathIsSensitive(envelope, parts, sensitiveSlotIds) {
  if (parts.some(isSensitiveKey)) return true;
  const slotValuesIndex = Math.max(parts.lastIndexOf('slot_values'), parts.lastIndexOf('slotValues'));
  if (slotValuesIndex < 0 || slotValuesIndex + 1 >= parts.length) return false;
  let slotValues = envelope;
  for (const part of parts.slice(0, slotValuesIndex + 1)) {
    if (!slotValues || typeof slotValues !== 'object' || !Object.hasOwn(slotValues, part)) return false;
    slotValues = slotValues[part];
  }
  const slotRef = parts[slotValuesIndex + 1];
  if (Array.isArray(slotValues)) return sensitiveSlotIds.has(slotValueId(slotValues[Number(slotRef)]));
  return sensitiveSlotIds.has(slotRef);
}

function sensitiveSlotIdsForPath(envelope, parts) {
  let value = envelope;
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return new Set();
    if (part === 'slot_values' || part === 'slotValues') return collectSensitiveSlotIds(value);
    value = value[part];
  }
  return new Set();
}

function selectedProjection(envelope, parts, sensitiveSlotIds) {
  let value = envelope;
  for (let index = 0; index < parts.length; index += 1) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, parts[index])) return null;
    const part = parts[index];
    const remaining = parts.slice(index + 1);
    if (sensitiveRecord(value) && SENSITIVE_RECORD_VALUES.includes(part)) {
      return { sensitive: true, redactWhole: true, options: { sensitiveSlotIds } };
    }
    if (part === 'slot_values' || part === 'slotValues') {
      if (!remaining.length) {
        return { sensitive: sensitiveSlotIds.size > 0,
          options: { sensitiveSlotIds, slotValues: true } };
      }
      const slotRef = remaining[0];
      const slotId = Array.isArray(value[part])
        ? slotValueId(value[part][Number(slotRef)]) : slotRef;
      if (sensitiveSlotIds.has(slotId)) return { sensitive: true, options: { sensitiveSlotIds } };
    }
    if (part === 'rows') {
      const indexes = sensitiveColumnIndexes(value);
      if (indexes) {
        if (!remaining.length) return { sensitive: true, options: { sensitiveSlotIds, rowIndexes: indexes } };
        if (remaining.length === 1) {
          return { sensitive: true, options: { sensitiveSlotIds, redactIndices: indexes } };
        }
        if (indexes.has(Number(remaining[1]))) {
          return { sensitive: true, redactWhole: true, options: { sensitiveSlotIds } };
        }
      }
    }
    value = value[part];
  }
  const metadataState = { remainingNodes: MAX_CONTEXT_NODES, truncated: false };
  const sensitive = value && typeof value === 'object'
    && (containsSensitiveMetadata(value, new Set(), 0, metadataState)
      || metadataState.truncated || sensitiveColumnIndexes(value));
  return { sensitive: !!sensitive, options: { sensitiveSlotIds } };
}

function readSelectedValue(envelope, path, budget = createBudget()) {
  const parts = pathParts(path);
  if (!parts) return { ok: false };
  const sensitiveSlotIds = sensitiveSlotIdsForPath(envelope, parts);
  if (sensitiveSlotIds.truncated) return { ok: true, value: '[redacted]', sensitive: true };
  if (selectedPathIsSensitive(envelope, parts, sensitiveSlotIds)) return { ok: true, value: '[redacted]', sensitive: true };
  const projection = selectedProjection(envelope, parts, sensitiveSlotIds);
  if (!projection) return { ok: false };
  let value = envelope;
  for (const part of parts) {
    if (value == null || typeof value !== 'object' || !Object.hasOwn(value, part)) return { ok: false };
    value = value[part];
  }
  return projection.redactWhole
    ? { ok: true, value: '[redacted]', sensitive: true }
    : { ok: true, value: compactValue(value, 0, budget, projection.options), sensitive: projection.sensitive };
}

function normalizeObservation(observation, selectedCardId, selectedPath, sensitive = false) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) return null;
  const parts = pathParts(selectedPath);
  if (!parts || sensitive || parts.some(isSensitiveKey)
      || observation.cardId !== selectedCardId
      || observation.path !== selectedPath
      || observation.source !== 'renderer-visible') return null;
  const observedAt = cleanText(observation.observedAt);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(observedAt)
      || !Number.isFinite(Date.parse(observedAt))) return null;
  if (typeof observation.text !== 'string') return null;
  const text = observation.text.replace(/[\u0000-\u001F\u007F]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!text || text.length > MAX_OBSERVATION_TEXT) return null;
  return { cardId: selectedCardId, path: selectedPath, observedAt,
    source: 'renderer-visible', text };
}

function finalizeContext(context, budget) {
  context.truncated = budget.truncated;
  if (Buffer.byteLength(JSON.stringify(context), 'utf8') <= MAX_SERIALIZED_CONTEXT_BYTES) return context;
  return {
    ...context,
    truncated: true,
    selection: context.selection && Object.hasOwn(context.selection, 'value')
      ? { ...context.selection, value: TRUNCATED }
      : context.selection,
    cards: context.cards.length ? [{ __truncated__: TRUNCATED }] : [],
  };
}

function buildActiveCardContext({ cards, requested, now } = {}) {
  const allCards = Array.isArray(cards) ? cards : [];
  const budget = createBudget();
  const selectedCardId = boundedText(requested && requested.selectedCardId, 128);
  const selectedComponent = requested && requested.selectedComponent
    && typeof requested.selectedComponent === 'object'
    ? requested.selectedComponent : null;
  const selectedPath = cleanText(selectedComponent && selectedComponent.path);
  const selectedLabel = boundedText(selectedComponent && selectedComponent.label, 200);
  const observedAt = boundedText(now, 64) || null;

  if (selectedCardId) {
    let selectedCard = null;
    for (const card of allCards) {
      const source = sourceCard(card);
      if (source && source.cardId === selectedCardId) {
        selectedCard = source;
        break;
      }
    }
    const selected = selectedCard
      ? (selectedPath
        ? readSelectedValue(selectedCard.envelope, selectedPath, budget)
        : { ok: true, value: compactValue(selectedCard.envelope, 0, budget) })
      : { ok: false };
    if (!selectedCard || !selected.ok) {
      return finalizeContext({
        status: 'selection_invalid',
        selectionStatus: 'invalid',
        observedAt,
        capturedAt: selectedCard ? selectedCard.capturedAt : null,
        selection: {
          cardId: selectedCardId,
          path: selectedPath || null,
          label: selectedLabel || null,
        },
        observationStatus: requested && requested.observation ? 'invalid' : 'none',
        observation: null,
        cards: [],
      }, budget);
    }
    const selectedLabelIsSensitive = isSensitiveKey(selectedLabel);
    const requestedObservation = requested && requested.observation;
    const observationPath = selectedPath || cleanText(requestedObservation && requestedObservation.path);
    const observationTarget = selectedPath
      ? selected
      : requestedObservation && observationPath
        ? readSelectedValue(selectedCard.envelope, observationPath, createBudget())
        : { ok: false };
    const observation = observationTarget.ok
      ? normalizeObservation(requestedObservation, selectedCardId, observationPath,
        observationTarget.sensitive === true || selectedLabelIsSensitive)
      : null;
    return finalizeContext({
      status: 'available',
      selectionStatus: 'valid',
      observedAt,
      capturedAt: selectedCard.capturedAt,
      selection: {
        cardId: selectedCardId,
        path: selectedPath || null,
        label: selected.sensitive === true || selectedLabelIsSensitive ? '[redacted]' : selectedLabel || null,
        value: selected.value,
      },
      observationStatus: requested && requested.observation ? (observation ? 'valid' : 'invalid') : 'none',
      observation,
      cards: [],
    }, budget);
  }

  const sourceCards = allCards.map(sourceCard).filter(Boolean).slice(-MAX_CARDS);
  const safeCards = sourceCards.map((card) => safeCard(card, budget)).filter(Boolean);
  return finalizeContext({
    status: safeCards.length ? 'available' : 'unavailable',
    selectionStatus: 'none',
    observedAt,
    capturedAt: safeCards.length ? safeCards[safeCards.length - 1].capturedAt : null,
    selection: null,
    observationStatus: requested && requested.observation ? 'invalid' : 'none',
    observation: null,
    cards: safeCards,
  }, budget);
}

async function continueAfterDisplayedCards({ result, cards, requested, now, isCurrent, runProvider } = {}) {
  const displayed = (Array.isArray(cards) ? cards : []).filter((card) => card
    && card.envelope && card.verifiedVisible === true && card.isDataCanvas !== false);
  if (!result || result.ok !== true || !displayed.length || typeof runProvider !== 'function') {
    return { continued: false, result };
  }
  if (typeof isCurrent === 'function' && !isCurrent()) {
    return {
      continued: false,
      result: { ...result, ok: false, error: '새 질문이 표시된 카드 설명을 대체했습니다.', answerText: null },
    };
  }
  // 새 조회가 방금 만든 카드가 근거다. 이전 카드의 implicit 선택은 새 결과를
  // 가리키지 않으므로 이어받지 않는다. explicit component는 애초 빠른 조회를
  // 타지 않지만, 호출자가 명시했다면 정확한 cardId/path 검증은 그대로 유지한다.
  const continuationRequest = requested && requested.selectionMode === 'explicit-component'
    ? requested : null;
  const context = buildActiveCardContext({ cards: displayed, requested: continuationRequest, now });
  if (context.status !== 'available') return { continued: false, result };
  return { continued: true, result: await runProvider(context, result) };
}

async function finishDisplayedCardResult({
  result,
  cards,
  requested,
  now,
  isCurrent,
  providerRequest,
  runProvider,
  persistReceipt,
} = {}) {
  const capturedAt = cleanText(now) || new Date().toISOString();
  const acceptedCards = (Array.isArray(cards) ? cards : []).map((card, index) => ({
    ...card,
    cardId: card.cardId || `${(result && result.datasetId) || 'selector'}:${card.ordinal || index + 1}`,
    createdAt: card.createdAt || capturedAt,
  }));
  const outcome = await continueAfterDisplayedCards({
    result,
    cards: acceptedCards,
    requested,
    now: capturedAt,
    isCurrent,
    runProvider: (activeCardContext, initialResult) => runProvider({
      ...(providerRequest || {}),
      activeCardContext,
      initialResult,
    }),
  });
  if (outcome.continued && outcome.result) {
    outcome.result = {
      ...outcome.result,
      canvasTypes: outcome.result.canvasTypes || (result && result.canvasTypes),
      canvasCaptions: outcome.result.canvasCaptions || (result && result.canvasCaptions),
    };
  }
  if (!outcome.continued && outcome.result && outcome.result.answerText !== null
      && typeof persistReceipt === 'function') await persistReceipt(outcome.result.answerText);
  return outcome.result;
}

function deleteSubmitContextIfSame(map, key, expected) {
  if (!map || typeof map.get !== 'function' || typeof map.delete !== 'function') return false;
  if (map.get(key) !== expected) return false;
  return map.delete(key);
}

module.exports = {
  buildActiveCardContext,
  compactValue,
  continueAfterDisplayedCards,
  deleteSubmitContextIfSame,
  finishDisplayedCardResult,
  readSelectedValue,
  requiresGroundedCardAnswer,
  shouldAttemptCardFirstLookup,
};
