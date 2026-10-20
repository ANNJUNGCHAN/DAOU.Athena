export const SOURCE_CARD_NOTICE = "기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;
const OPERATION_REF_PATTERN = /^(?:base:[a-z0-9]+|detail:[a-z0-9]+:[a-z0-9_]+)$/;
const CATALOG_VERSION_PATTERN = /^sha256:[0-9a-f]{64}$/;
const EXECUTION_POLICIES = new Set(["selector_query", "selector_detail", "selector_detail_required"]);

function exactKeys(value, expected, name) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${name} has unsupported properties`);
  }
}

function boundedText(value, name, minimum, maximum, { nullable = false, trim = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string") throw new TypeError(`${name} must be text`);
  const result = trim ? value.trim() : value;
  if (result.length < minimum || result.length > maximum) throw new TypeError(`${name} is out of bounds`);
  return result;
}

function utcTimestamp(value) {
  const result = boundedText(value, "fetchedAt", 1, 64);
  const match = UTC_TIMESTAMP_PATTERN.exec(result);
  if (!match) throw new TypeError("fetchedAt is invalid");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const [year, month, day, hour, minute, second] = [
    yearText, monthText, dayText, hourText, minuteText, secondText,
  ].map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day || calendar.getUTCHours() !== hour ||
      calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) {
    throw new TypeError("fetchedAt is invalid");
  }
  return result;
}

function operationRef(value, name) {
  const result = boundedText(value, name, 1, 128);
  if (!OPERATION_REF_PATTERN.test(result)) throw new TypeError(`${name} is invalid`);
  return result;
}

function catalogVersion(value) {
  const result = boundedText(value, "catalogVersion", 71, 71);
  if (!CATALOG_VERSION_PATTERN.test(result)) throw new TypeError("catalogVersion is invalid");
  return result;
}

function mapDense(values, name, maximum, normalize) {
  if (!Array.isArray(values) || values.length > maximum) throw new TypeError(`${name} is out of bounds`);
  const normalized = [];
  for (let index = 0; index < values.length; index += 1) {
    if (!Object.hasOwn(values, index)) throw new TypeError(`${name}[${index}] is missing`);
    normalized.push(normalize(values[index], index));
  }
  return normalized;
}

function normalizeCommon(card) {
  if (!card || typeof card !== "object" || Array.isArray(card)) throw new TypeError("card is required");
  if (card.schemaVersion !== 1) throw new TypeError("schemaVersion must be 1");
  if (!["capability-list", "capability-detail"].includes(card.kind)) throw new TypeError("kind is unsupported");
  if (typeof card.canvasId !== "string" || !UUID_PATTERN.test(card.canvasId)) throw new TypeError("canvasId is invalid");
  const fetchedAt = utcTimestamp(card.fetchedAt);
  if (card.notice !== SOURCE_CARD_NOTICE) throw new TypeError("notice is invalid");
  return {
    schemaVersion: 1,
    kind: card.kind,
    canvasId: card.canvasId,
    title: boundedText(card.title, "title", 1, 160),
    catalogVersion: catalogVersion(card.catalogVersion),
    fetchedAt,
    notice: SOURCE_CARD_NOTICE,
  };
}

function normalizeListItem(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError(`items[${index}] is invalid`);
  exactKeys(item, ["operationRef", "kind", "domain", "name", "groupTitle"], `items[${index}]`);
  if (item.kind !== "query") throw new TypeError(`items[${index}].kind must be query`);
  return {
    operationRef: operationRef(item.operationRef, `items[${index}].operationRef`),
    kind: "query",
    domain: boundedText(item.domain, `items[${index}].domain`, 1, 64),
    name: boundedText(item.name, `items[${index}].name`, 1, 160),
    groupTitle: boundedText(item.groupTitle, `items[${index}].groupTitle`, 1, 160, { nullable: true }),
  };
}

function normalizeList(card, common) {
  exactKeys(card, [
    "schemaVersion", "kind", "canvasId", "title", "catalogVersion", "fetchedAt", "notice", "query", "items",
  ], "capability-list");
  return {
    ...common,
    query: boundedText(card.query, "query", 2, 500, { trim: true }),
    items: mapDense(card.items, "items", 5, normalizeListItem),
  };
}

function normalizeField(field, name, index) {
  if (!field || typeof field !== "object" || Array.isArray(field)) throw new TypeError(`${name}[${index}] is invalid`);
  exactKeys(field, ["alias", "description", "required"], `${name}[${index}]`);
  if (typeof field.required !== "boolean") throw new TypeError(`${name}[${index}].required must be boolean`);
  return {
    alias: boundedText(field.alias, `${name}[${index}].alias`, 1, 128),
    description: boundedText(field.description, `${name}[${index}].description`, 1, 1000, { nullable: true }),
    required: field.required,
  };
}

function normalizeArgumentJsonSchema(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} is invalid`);
  if (Object.hasOwn(value, "type")) {
    exactKeys(value, ["type"], name);
    if (value.type !== "string") throw new TypeError(`${name} must describe a string`);
    return Object.freeze({ type: "string" });
  }
  exactKeys(value, ["anyOf", "default"], name);
  if (value.default !== null || !Array.isArray(value.anyOf) || value.anyOf.length !== 2 ||
      !Object.hasOwn(value.anyOf, 0) || !Object.hasOwn(value.anyOf, 1)) {
    throw new TypeError(`${name} nullable shape is invalid`);
  }
  const [stringBranch, nullBranch] = value.anyOf;
  if (!stringBranch || typeof stringBranch !== "object" || Array.isArray(stringBranch) ||
      !nullBranch || typeof nullBranch !== "object" || Array.isArray(nullBranch)) {
    throw new TypeError(`${name} nullable branches are invalid`);
  }
  exactKeys(stringBranch, ["type"], `${name}.anyOf[0]`);
  exactKeys(nullBranch, ["type"], `${name}.anyOf[1]`);
  if (stringBranch.type !== "string" || nullBranch.type !== "null") {
    throw new TypeError(`${name} nullable branches are invalid`);
  }
  return Object.freeze({
    anyOf: Object.freeze([Object.freeze({ type: "string" }), Object.freeze({ type: "null" })]),
    default: null,
  });
}

function normalizeArgumentField(field, name, index, required) {
  if (!field || typeof field !== "object" || Array.isArray(field)) throw new TypeError(`${name}[${index}] is invalid`);
  exactKeys(field, ["alias", "description", "required", "jsonSchema"], `${name}[${index}]`);
  if (field.required !== required) throw new TypeError(`${name}[${index}].required must be ${required}`);
  return {
    alias: boundedText(field.alias, `${name}[${index}].alias`, 1, 128),
    description: boundedText(field.description, `${name}[${index}].description`, 1, 1000, { nullable: true }),
    required,
    jsonSchema: normalizeArgumentJsonSchema(field.jsonSchema, `${name}[${index}].jsonSchema`),
  };
}

function normalizeFields(values, name, maximum) {
  return mapDense(values, name, maximum, (field, index) => normalizeField(field, name, index));
}

function normalizeArgumentFields(values, name, required) {
  return mapDense(values, name, 64, (field, index) => normalizeArgumentField(field, name, index, required));
}

function normalizeDetail(card, common) {
  exactKeys(card, [
    "schemaVersion", "kind", "canvasId", "title", "catalogVersion", "fetchedAt", "notice",
    "operationRef", "domain", "name", "executionPolicy", "requiredArguments", "optionalArguments",
    "responseFields", "execution",
  ], "capability-detail");
  if (!EXECUTION_POLICIES.has(card.executionPolicy)) throw new TypeError("executionPolicy is invalid");
  if (!card.execution || typeof card.execution !== "object" || Array.isArray(card.execution)) {
    throw new TypeError("execution is invalid");
  }
  exactKeys(card.execution, ["available", "reason"], "execution");
  if (card.execution.available !== false || card.execution.reason !== "FINANCIAL_QUERY_NOT_CONNECTED") {
    throw new TypeError("execution must be unavailable");
  }
  return {
    ...common,
    operationRef: operationRef(card.operationRef, "operationRef"),
    domain: boundedText(card.domain, "domain", 1, 64),
    name: boundedText(card.name, "name", 1, 160),
    executionPolicy: card.executionPolicy,
    requiredArguments: normalizeArgumentFields(card.requiredArguments, "requiredArguments", true),
    optionalArguments: normalizeArgumentFields(card.optionalArguments, "optionalArguments", false),
    responseFields: normalizeFields(card.responseFields, "responseFields", 128),
    execution: { available: false, reason: "FINANCIAL_QUERY_NOT_CONNECTED" },
  };
}

export function normalizeSourceCard(card) {
  const common = normalizeCommon(card);
  return common.kind === "capability-list" ? normalizeList(card, common) : normalizeDetail(card, common);
}

function element(document, tagName, { className = "", content = "" } = {}) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  node.textContent = content;
  return node;
}

function appendRow(document, parent, label, value) {
  const row = element(document, "div", { className: "source-card-row" });
  row.append(element(document, "dt", { content: label }), element(document, "dd", { content: value }));
  parent.append(row);
}

function renderNotice(document, parent) {
  parent.append(element(document, "p", { className: "source-card-notice", content: SOURCE_CARD_NOTICE }));
}

function statusMessage(document, message) {
  const status = element(document, "p", { className: "source-card-state", content: message });
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  return status;
}

function renderState(document, parent, message) {
  parent.append(element(document, "h3", { content: "조회 기능 찾기" }));
  parent.append(statusMessage(document, message));
  renderNotice(document, parent);
}

function renderHeader(document, parent, card) {
  parent.append(element(document, "h3", { content: card.title }));
  const metadata = element(document, "dl", { className: "source-card-meta" });
  appendRow(document, metadata, "카탈로그 버전", card.catalogVersion);
  appendRow(document, metadata, "가져온 시각", card.fetchedAt);
  parent.append(metadata);
  renderNotice(document, parent);
}

function renderList(document, parent, card, onDescribe) {
  renderHeader(document, parent, card);
  parent.append(element(document, "p", { className: "source-card-query", content: `검색어: ${card.query}` }));
  if (card.items.length === 0) {
    parent.append(statusMessage(document, "조건에 맞는 조회 기능 메타데이터가 없습니다."));
    return;
  }
  const list = element(document, "ul", { className: "source-capability-list" });
  for (const item of card.items) {
    const entry = element(document, "li", { className: "source-capability-item" });
    entry.append(element(document, "strong", { content: item.name }));
    entry.append(element(document, "p", { content: [item.groupTitle, item.domain].filter(Boolean).join(" · ") }));
    entry.append(element(document, "p", { className: "source-capability-kind", content: "조회 기능 메타데이터" }));
    if (typeof onDescribe === "function") {
      const button = element(document, "button", { content: "기능 상세 보기" });
      button.type = "button";
      button.setAttribute("aria-label", `${item.name} (${item.domain}) 기능 상세 보기`);
      button.addEventListener("click", () => onDescribe({
        operationRef: item.operationRef,
        expectedCatalogVersion: card.catalogVersion,
      }));
      entry.append(button);
    }
    list.append(entry);
  }
  parent.append(list);
}

function renderFieldGroup(document, parent, title, fields) {
  const section = element(document, "section", { className: "source-field-group" });
  section.append(element(document, "h4", { content: title }));
  if (fields.length === 0) {
    section.append(element(document, "p", { content: "없음" }));
  } else {
    const list = element(document, "ul");
    for (const field of fields) {
      const requirement = field.required ? "필수" : "선택";
      const description = field.description ? ` — ${field.description}` : "";
      list.append(element(document, "li", { content: `${field.alias} (${requirement})${description}` }));
    }
    section.append(list);
  }
  parent.append(section);
}

function renderDetail(document, parent, card) {
  renderHeader(document, parent, card);
  const metadata = element(document, "dl", { className: "source-card-detail" });
  appendRow(document, metadata, "기능 이름", card.name);
  appendRow(document, metadata, "도메인", card.domain);
  appendRow(document, metadata, "작업 참조", card.operationRef);
  appendRow(document, metadata, "실행 정책", card.executionPolicy);
  parent.append(metadata);
  renderFieldGroup(document, parent, "필수 입력", card.requiredArguments);
  renderFieldGroup(document, parent, "선택 입력", card.optionalArguments);
  renderFieldGroup(document, parent, "응답 필드", card.responseFields);
  parent.append(element(document, "p", {
    className: "source-execution-unavailable",
    content: "실제 금융 조회는 연결되지 않았습니다. FINANCIAL_QUERY_NOT_CONNECTED",
  }));
}

export function renderSourceCard({ document, container, state, onDescribe }) {
  if (!document?.createElement || !container || typeof container.replaceChildren !== "function") {
    throw new TypeError("document and container are required");
  }
  const root = element(document, "article", { className: "source-card" });
  container.replaceChildren(root);
  root.setAttribute("aria-busy", state?.status === "loading" ? "true" : "false");
  if (state?.status === "loading") {
    renderState(document, root, "기능 메타데이터를 불러오는 중입니다.");
    return { status: "loading", kind: null, itemCount: 0 };
  }
  if (state?.status === "error") {
    renderState(document, root, "기능 메타데이터를 불러오지 못했습니다.");
    return { status: "error", kind: null, itemCount: 0 };
  }
  if (state?.status !== "ready" || !state.card) {
    renderState(document, root, "표시할 기능 메타데이터가 없습니다.");
    return { status: "empty", kind: null, itemCount: 0 };
  }
  let card;
  try {
    card = normalizeSourceCard(state.card);
  } catch {
    root.replaceChildren();
    renderState(document, root, "기능 메타데이터 형식이 올바르지 않습니다.");
    return { status: "error", kind: null, itemCount: 0 };
  }
  if (card.kind === "capability-list") renderList(document, root, card, onDescribe);
  else renderDetail(document, root, card);
  return {
    status: card.kind === "capability-list" && card.items.length === 0 ? "empty" : "ready",
    kind: card.kind,
    itemCount: card.kind === "capability-list" ? card.items.length : 1,
  };
}
