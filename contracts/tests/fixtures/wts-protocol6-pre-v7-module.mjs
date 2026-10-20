export const PROTOCOL_VERSION = 6;
export const HOST_NAME = 'com.athena.wts';
export const MAX_MESSAGE_BYTES = 131072;
export const CONTROL_CATALOG_VERSION = 'wts-main-control-3';
export const LEGACY_CONTROL_CATALOG_VERSION = 'wts-chart-pilot-1';
export const PREVIOUS_CONTROL_CATALOG_VERSION = 'wts-chart-pilot-2';
export const CHART_OPEN_ACTION_ID = 'wts.main.p3.chart.open';
export const CHART_PERIOD_SET_ACTION_ID = 'wts.main.p3.chart.period.set';
export const SITEMAP_OPEN_ACTION_ID = 'wts.main.sitemap.open';
export const MARKET_NAVIGATE_ACTION_ID = 'wts.main.p1.market.navigate';
export const CONTROL_ACTION_IDS = Object.freeze([
  CHART_OPEN_ACTION_ID,
  CHART_PERIOD_SET_ACTION_ID,
  SITEMAP_OPEN_ACTION_ID,
  MARKET_NAVIGATE_ACTION_ID,
]);
export const MARKET_MENU_PROFILE = Object.freeze({
  id: 'market-menu-navigation-20261019',
  targetCount: 25,
});

function freezeTarget(target) {
  return Object.freeze({ ...target, assertion: Object.freeze({ ...target.assertion }) });
}

export const MARKET_MENU_TARGETS = Object.freeze([
  { id: 'market-menu-001', sitemapGroup: '시세분석', buttonLabel: '급등락', assertion: { kind: 'group-child', group: '시세분석', child: '급등락' } },
  { id: 'market-menu-002', sitemapGroup: '시세분석', buttonLabel: 'VI발동종목', assertion: { kind: 'group-child', group: '시세분석', child: 'VI발동종목' } },
  { id: 'market-menu-003', sitemapGroup: '시세분석', buttonLabel: '거래량급증', assertion: { kind: 'group-child', group: '시세분석', child: '거래량급증' } },
  { id: 'market-menu-004', sitemapGroup: '시세분석', buttonLabel: '관리종목', assertion: { kind: 'group-child', group: '시세분석', child: '관리종목' } },
  { id: 'market-menu-005', sitemapGroup: '시세분석', buttonLabel: '상하한가', assertion: { kind: 'group-child', group: '시세분석', child: '상하한가' } },
  { id: 'market-menu-006', sitemapGroup: '시세분석', buttonLabel: '신규상장', assertion: { kind: 'group-child', group: '시세분석', child: '신규상장' } },
  { id: 'market-menu-007', sitemapGroup: '시세분석', buttonLabel: '신고신저가', assertion: { kind: 'group-child', group: '시세분석', child: '신고신저가' } },
  { id: 'market-menu-008', sitemapGroup: '시세분석', buttonLabel: '증거금률별', assertion: { kind: 'group-child', group: '시세분석', child: '증거금률별' } },
  { id: 'market-menu-009', sitemapGroup: '시세분석', buttonLabel: '거래량갱신', assertion: { kind: 'group-child', group: '시세분석', child: '거래량갱신' } },
  { id: 'market-menu-010', sitemapGroup: '순위', buttonLabel: '전일대비 등락률 순위', assertion: { kind: 'group-child', group: '순위분석', child: '전일대비등락률상위' } },
  { id: 'market-menu-011', sitemapGroup: '순위', buttonLabel: '당일 거래상위', assertion: { kind: 'group-child', group: '순위분석', child: '당일거래상위(거래량/회전율/거래대금)' } },
  { id: 'market-menu-012', sitemapGroup: '테마/업종', buttonLabel: '인포스탁섹터그룹', assertion: { kind: 'group-child', group: '테마/업종', child: '인포스탁섹터그룹' } },
  { id: 'market-menu-013', sitemapGroup: '테마/업종', buttonLabel: '인포스탁섹터구성종목', assertion: { kind: 'group-child', group: '테마/업종', child: '인포스탁섹터구성종목' } },
  { id: 'market-menu-014', sitemapGroup: '테마/업종', buttonLabel: '전업종지수', assertion: { kind: 'group-child', group: '테마/업종', child: '전업종지수' } },
  { id: 'market-menu-015', sitemapGroup: '테마/업종', buttonLabel: '업종현재가', assertion: { kind: 'group-child', group: '테마/업종', child: '업종현재가' } },
  { id: 'market-menu-016', sitemapGroup: '외국인/거래원', buttonLabel: '외국인 기간별매매 상위', assertion: { kind: 'group-child', group: '외국인/거래원', child: '외국인기간별매매상위' } },
  { id: 'market-menu-017', sitemapGroup: '외국인/거래원', buttonLabel: '외국인 연속순매매 상위', assertion: { kind: 'group-child', group: '외국인/거래원', child: '외국인연속순매매상위' } },
  { id: 'market-menu-018', sitemapGroup: '외국인/거래원', buttonLabel: '종목별 증권사 순위', assertion: { kind: 'group-child', group: '외국인/거래원', child: '종목별증권사순위' } },
  { id: 'market-menu-019', sitemapGroup: '외국인/거래원', buttonLabel: '거래원 순간 거래량', assertion: { kind: 'group-child', group: '외국인/거래원', child: '거래원순간거래량' } },
  { id: 'market-menu-020', sitemapGroup: '투자자별/프로그램', buttonLabel: '투자자별매매동향', assertion: { kind: 'group-child', group: '투자자별/프로그램', child: '투자자별매매동향' } },
  { id: 'market-menu-021', sitemapGroup: '투자자별/프로그램', buttonLabel: '투자자별매매일별', assertion: { kind: 'group-child', group: '투자자별/프로그램', child: '투자자별매매일별' } },
  { id: 'market-menu-022', sitemapGroup: '투자자별/프로그램', buttonLabel: '종목별투자자', assertion: { kind: 'group-child', group: '투자자별/프로그램', child: '종목별투자자' } },
  { id: 'market-menu-023', sitemapGroup: '투자자별/프로그램', buttonLabel: '프로그램매매', assertion: { kind: 'group-child', group: '투자자별/프로그램', child: '프로그램매매' } },
  { id: 'market-menu-024', sitemapGroup: '투자자별/프로그램', buttonLabel: '프로그램종목별매매', assertion: { kind: 'group-child', group: '투자자별/프로그램', child: '프로그램종목별매매' } },
  { id: 'market-menu-025', sitemapGroup: '빅데이터', buttonLabel: '실시간종목조회순위', assertion: { kind: 'top-active', topActive: '빅데이터' } },
].map(freezeTarget));
export const SOURCE_PROFILE = 'wts-readonly-v1';
export const SOURCE_API_VERSION = 'selector-readonly-v1';
export const SOURCE_CARD_NOTICE = '기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.';
export const CONVERSATION_ROUTER_ID = 'deterministic-wts-conversation-v1';
export const CONVERSATION_UNSUPPORTED_MESSAGE =
  '지금은 차트 명령, “시장 메뉴 열어줘: 그룹 > 메뉴”, “조회 기능 찾아줘: 검색어”만 지원합니다.';

const ERROR_CODE = 'INVALID_PROTOCOL_MESSAGE';
const MAX_REPORTED_ISSUES = 8;

export class ProtocolValidationError extends Error {
  constructor(issues) {
    super('WTS protocol message is invalid');
    this.name = 'ProtocolValidationError';
    this.code = ERROR_CODE;
    this.issues = issues.slice(0, MAX_REPORTED_ISSUES);
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function joinPath(path, segment) {
  if (typeof segment === 'number') {
    return `${path}[${segment}]`;
  }
  return `${path}.${segment}`;
}

function resolveReference(rootSchema, reference) {
  if (!reference.startsWith('#/')) {
    throw new TypeError('Only local JSON Schema references are supported');
  }

  let current = rootSchema;
  for (const rawSegment of reference.slice(2).split('/')) {
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isPlainObject(current) || !(segment in current)) {
      throw new TypeError('JSON Schema contains an unresolved reference');
    }
    current = current[segment];
  }
  return current;
}

function validateNode(rootSchema, schema, value, path) {
  if (schema.$ref) {
    return validateNode(rootSchema, resolveReference(rootSchema, schema.$ref), value, path);
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter(
      (candidate) => validateNode(rootSchema, candidate, value, path).length === 0,
    );
    return matches.length === 1 ? [] : [`${path} must match exactly one allowed shape`];
  }

  if (Object.hasOwn(schema, 'const') && !Object.is(value, schema.const)) {
    return [`${path} has an unsupported value`];
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return [`${path} has an unsupported value`];
  }

  const issues = [];
  if (schema.type === 'object') {
    if (!isPlainObject(value)) {
      return [`${path} must be an object`];
    }

    const properties = schema.properties ?? {};
    for (const requiredName of schema.required ?? []) {
      if (!Object.hasOwn(value, requiredName)) {
        issues.push(`${joinPath(path, requiredName)} is required`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) {
          issues.push(`${joinPath(path, key)} is not allowed`);
        }
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) {
        issues.push(...validateNode(rootSchema, propertySchema, value[key], joinPath(path, key)));
      }
    }
    return issues;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      return [`${path} must be an array`];
    }
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      issues.push(`${path} contains too few items`);
    }
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      issues.push(`${path} contains too many items`);
    }
    if (schema.uniqueItems === true) {
      const serialized = value.map((item) => JSON.stringify(item));
      if (new Set(serialized).size !== serialized.length) {
        issues.push(`${path} contains duplicate items`);
      }
    }
    if (schema.items) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          issues.push(`${joinPath(path, index)} is required`);
          continue;
        }
        issues.push(...validateNode(rootSchema, schema.items, value[index], joinPath(path, index)));
      }
    }
    return issues;
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      return [`${path} must be a string`];
    }
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      issues.push(`${path} is too short`);
    }
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
      issues.push(`${path} is too long`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
      issues.push(`${path} has an invalid format`);
    }
    return issues;
  }

  if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value)) {
      return [`${path} must be a safe integer`];
    }
    if (Number.isFinite(schema.minimum) && value < schema.minimum) {
      issues.push(`${path} is below the allowed minimum`);
    }
    if (Number.isFinite(schema.maximum) && value > schema.maximum) {
      issues.push(`${path} exceeds the allowed maximum`);
    }
    return issues;
  }

  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    return [`${path} must be a boolean`];
  }

  if (schema.type === 'null' && value !== null) {
    return [`${path} must be null`];
  }

  return issues;
}

function messageSizeInBytes(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ProtocolValidationError(['$ cannot be serialized as JSON']);
  }
  if (serialized === undefined) {
    throw new ProtocolValidationError(['$ cannot be serialized as JSON']);
  }
  return new TextEncoder().encode(serialized).byteLength;
}

function validateVerifiedReceipt(receipt) {
  const issues = [];
  const marketAction = [SITEMAP_OPEN_ACTION_ID, MARKET_NAVIGATE_ACTION_ID]
    .includes(receipt.actionId);
  if (marketAction) {
    const before = receipt.before.state;
    const after = receipt.after?.state ?? null;
    if (before.stateKind !== 'market-navigation' || before.targetId !== receipt.args.targetId ||
        (after !== null &&
          (after.stateKind !== 'market-navigation' || after.targetId !== receipt.args.targetId))) {
      issues.push('$.before and $.after must match the market action target');
    }
  } else if (receipt.before.state.stateKind === 'market-navigation' ||
      receipt.after?.state?.stateKind === 'market-navigation') {
    issues.push('$.before and $.after must use chart state for chart actions');
  }
  if (receipt.status !== 'verified') return issues;
  if (receipt.after === null) return [...issues, '$.after is required for a verified receipt'];
  if (receipt.before.state.instrumentToken !== receipt.after.state.instrumentToken) {
    issues.push('$.after.state.instrumentToken must match the verified precondition');
  }
  if (marketAction) {
    const before = receipt.before.state;
    const after = receipt.after.state;
    if (receipt.actionId === SITEMAP_OPEN_ACTION_ID &&
        (after.blocked || !after.sitemapVisible || !after.targetAvailable)) {
      issues.push('$.after must verify the requested sitemap target is visible and available');
    }
    if (receipt.actionId === MARKET_NAVIGATE_ACTION_ID &&
        (after.blocked || after.sitemapVisible || after.activeTargetId !== receipt.args.targetId)) {
      issues.push('$.after must verify the requested market target is active and the sitemap is closed');
    }
  }
  for (const key of ['tabId', 'windowId', 'documentId']) {
    if (receipt.before.source[key] !== receipt.after.source[key]) {
      issues.push(`$.after.source.${key} must match the verified precondition`);
    }
  }
  return issues;
}

function validateProposalSemantics(proposal) {
  const issues = [];
  const observedAt = Date.parse(proposal.observation.capturedAt);
  const expiresAt = Date.parse(proposal.expiresAt);
  if (!Number.isFinite(observedAt) || !Number.isFinite(expiresAt)) {
    issues.push('$.observation.capturedAt and $.expiresAt must be real timestamps');
  }
  if (proposal.actionId === CHART_OPEN_ACTION_ID && Object.keys(proposal.args).length !== 0) {
    issues.push('$.args must be empty for chart open');
  }
  const allowedPeriods = proposal.catalogVersion === LEGACY_CONTROL_CATALOG_VERSION
    ? ['day', 'week']
    : ['day', 'week', 'month', 'year'];
  if (proposal.actionId === CHART_PERIOD_SET_ACTION_ID && !allowedPeriods.includes(proposal.args.period)) {
    issues.push('$.args.period is invalid for chart period');
  }
  if ([SITEMAP_OPEN_ACTION_ID, MARKET_NAVIGATE_ACTION_ID].includes(proposal.actionId) &&
      (proposal.observation.state.stateKind !== 'market-navigation' ||
        proposal.observation.state.targetId !== proposal.args.targetId)) {
    issues.push('$.observation.state.targetId must match $.args.targetId');
  }
  if ([CHART_OPEN_ACTION_ID, CHART_PERIOD_SET_ACTION_ID].includes(proposal.actionId) &&
      proposal.observation.state.stateKind === 'market-navigation') {
    issues.push('$.observation.state must use chart state for chart actions');
  }
  if (Number.isFinite(observedAt) && Number.isFinite(expiresAt) && expiresAt <= observedAt) {
    issues.push('$.expiresAt must be later than the observation');
  }
  return issues;
}

function validateTaskSemantics(task) {
  const issues = [];
  const createdAt = Date.parse(task.createdAt);
  const updatedAt = Date.parse(task.updatedAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) {
    issues.push('$.createdAt and $.updatedAt must be real timestamps');
  } else if (updatedAt < createdAt) {
    issues.push('$.updatedAt must not precede $.createdAt');
  }
  if (task.cursor > task.steps.length) issues.push('$.cursor exceeds the step count');
  const ids = new Set();
  const allowedPeriods = task.catalogVersion === LEGACY_CONTROL_CATALOG_VERSION
    ? ['day', 'week']
    : ['day', 'week', 'month', 'year'];
  task.steps.forEach((step, index) => {
    if (step.index !== index) issues.push(`$.steps[${index}].index must be contiguous`);
    if (ids.has(step.id.toLowerCase())) issues.push(`$.steps[${index}].id is duplicated`);
    ids.add(step.id.toLowerCase());
    if (step.actionId === CHART_OPEN_ACTION_ID && Object.keys(step.args).length !== 0) {
      issues.push(`$.steps[${index}].args must be empty for chart open`);
    }
    if (step.actionId === CHART_PERIOD_SET_ACTION_ID && !allowedPeriods.includes(step.args.period)) {
      issues.push(`$.steps[${index}].args.period is invalid for chart period`);
    }
    if ([SITEMAP_OPEN_ACTION_ID, MARKET_NAVIGATE_ACTION_ID].includes(step.actionId) &&
        !MARKET_MENU_TARGETS.some((target) => target.id === step.args.targetId)) {
      issues.push(`$.steps[${index}].args.targetId is invalid for market navigation`);
    }
    if (step.status === 'pending' && (step.proposalId !== null || step.receiptId !== null)) {
      issues.push(`$.steps[${index}] pending state has execution ids`);
    }
    if (step.status === 'satisfied' && (step.proposalId !== null || step.receiptId !== null)) {
      issues.push(`$.steps[${index}] satisfied state has execution ids`);
    }
    if (step.status === 'awaiting_receipt' && (step.proposalId === null || step.receiptId !== null)) {
      issues.push(`$.steps[${index}] awaiting state is not bound to one proposal`);
    }
    if (['verified', 'unverified'].includes(step.status) &&
        (step.proposalId === null || step.receiptId === null)) {
      issues.push(`$.steps[${index}] executed state lacks binding ids`);
    }
    if (index < task.cursor && !['satisfied', 'verified'].includes(step.status)) {
      issues.push(`$.steps[${index}] precedes the cursor without completion`);
    }
  });
  const activeStatuses = ['awaiting_receipt', 'cancel_requested'];
  if (activeStatuses.includes(task.status) !== (task.activeProposal !== null)) {
    issues.push('$.activeProposal does not match the task status');
  }
  if (task.activeProposal) {
    const current = task.steps[task.cursor];
    if (!current || current.status !== 'awaiting_receipt' || current.proposalId !== task.activeProposal.id) {
      issues.push('$.activeProposal does not match the current step');
    } else if (task.activeProposal.catalogVersion !== task.catalogVersion ||
        task.activeProposal.actionId !== current.actionId ||
        !sameJson(task.activeProposal.args, current.args)) {
      issues.push('$.activeProposal action does not match the current step');
    }
    issues.push(...validateProposalSemantics(task.activeProposal));
  }
  if (task.status === 'completed' && task.cursor !== task.steps.length) {
    issues.push('$.cursor must finish every completed task step');
  }
  if (task.status === 'unsupported' && task.steps.length !== 0) {
    issues.push('$.steps must be empty for unsupported input');
  }
  if (task.status === 'cancel_requested' && task.cancelRequested !== true) {
    issues.push('$.cancelRequested must be true after a cancellation request');
  }
  return issues;
}

function validateBackendStatusSemantics(status) {
  if (status.configured === false) {
    return status.state === 'unconfigured' && status.apiVersion === null &&
        status.catalogVersion === null && status.ownedChild === false
      ? []
      : ['$.result unconfigured backend status is inconsistent'];
  }
  return status.state === 'unconfigured'
    ? ['$.result configured backend cannot be unconfigured']
    : [];
}

function validateHelloSemantics(result) {
  const issues = [];
  if (!sameJson(result.conversation.routes, ['wts-control', 'source-search'])) {
    issues.push('$.result.conversation.routes must match the deterministic route order');
  }
  if (!sameJson(result.control.actions, CONTROL_ACTION_IDS)) {
    issues.push('$.result.control.actions must match the current action order');
  }
  if (!sameJson(result.control.market, MARKET_MENU_PROFILE)) {
    issues.push('$.result.control.market must match the fixed market profile');
  }
  return issues;
}

function validateSourceCardSemantics(card) {
  const issues = [];
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/u.exec(card.fetchedAt);
  const parts = match?.slice(1, 7).map(Number);
  const calendar = new Date(0);
  if (parts) {
    calendar.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
    calendar.setUTCHours(parts[3], parts[4], parts[5], 0);
  }
  if (!parts || calendar.getUTCFullYear() !== parts[0] ||
      calendar.getUTCMonth() !== parts[1] - 1 || calendar.getUTCDate() !== parts[2] ||
      calendar.getUTCHours() !== parts[3] || calendar.getUTCMinutes() !== parts[4] ||
      calendar.getUTCSeconds() !== parts[5]) {
    issues.push('$.fetchedAt must be a real canonical UTC timestamp');
  }
  if (card.kind === 'capability-list' && card.query !== card.query.trim()) {
    issues.push('$.query must be trimmed');
  }
  return issues;
}

function assertSchema(schema) {
  if (!isPlainObject(schema) || !isPlainObject(schema.$defs)) {
    throw new TypeError('WTS protocol schema must contain $defs');
  }
  for (const name of [
    'request',
    'response',
    'observation',
    'capture',
    'controlObservation',
    'controlProposal',
    'controlReceipt',
    'controlTask',
    'legacyControlObservation',
    'legacyControlProposal',
    'legacyControlReceipt',
    'legacyControlTask',
    'previousControlObservation',
    'previousControlProposal',
    'previousControlReceipt',
    'previousControlTask',
    'currentControlProposal',
    'currentControlReceipt',
    'currentControlTask',
    'backendStatusResult',
    'sourceManifestResult',
    'sourceCard',
    'conversationRouteResult',
  ]) {
    if (!isPlainObject(schema.$defs[name])) {
      throw new TypeError(`WTS protocol schema is missing $defs.${name}`);
    }
  }
}

export function createProtocolValidator(schema) {
  assertSchema(schema);

  function validate(definitionName, value) {
    const size = messageSizeInBytes(value);
    if (size > MAX_MESSAGE_BYTES) {
      throw new ProtocolValidationError(['$ exceeds the 128 KiB protocol limit']);
    }

    const issues = validateNode(schema, schema.$defs[definitionName], value, '$');
    if (issues.length > 0) {
      throw new ProtocolValidationError(issues);
    }
    return value;
  }

  return Object.freeze({
    validateRequest(value) {
      return validate('request', value);
    },
    validateResponse(value) {
      const response = validate('response', value);
      const task = response.ok === true ? response.result?.task : null;
      if (task) {
        const issues = validateTaskSemantics(task);
        if (issues.length > 0) throw new ProtocolValidationError(issues);
      }
      if (response.ok === true && response.method === 'control.task.next') {
        const { task: nextTask, outcome } = response.result;
        const expectedStatus = nextTask.activeProposal ? 'proposed' : nextTask.status;
        if (outcome.status !== expectedStatus ||
            !sameJson(outcome.proposal, nextTask.activeProposal) ||
            outcome.message !== nextTask.message) {
          throw new ProtocolValidationError(['$.result.outcome does not match $.result.task']);
        }
      }
      if (response.ok === true && response.method === 'control.task.step.commit') {
        const matches = response.result.task.steps.some(
          (step) => step.receiptId === response.result.receiptId,
        );
        if (!matches) {
          throw new ProtocolValidationError(['$.result.receiptId is not committed by $.result.task']);
        }
      }
      if (response.ok === true && response.method === 'backend.status') {
        const issues = validateBackendStatusSemantics(response.result);
        if (issues.length > 0) throw new ProtocolValidationError(issues);
      }
      if (response.ok === true && response.method === 'runtime.hello') {
        const issues = validateHelloSemantics(response.result);
        if (issues.length > 0) throw new ProtocolValidationError(issues);
      }
      if (response.ok === true && ['source.search', 'source.describe'].includes(response.method)) {
        const issues = validateSourceCardSemantics(response.result);
        if (issues.length > 0) throw new ProtocolValidationError(issues);
      }
      return response;
    },
    validateObservation(value) {
      return validate('observation', value);
    },
    validateCapture(value) {
      return validate('capture', value);
    },
    validateControlObservation(value) {
      return validate('controlObservation', value);
    },
    validateControlProposal(value) {
      const proposal = validate('controlProposal', value);
      const issues = validateProposalSemantics(proposal);
      if (issues.length > 0) throw new ProtocolValidationError(issues);
      return proposal;
    },
    validateControlReceipt(value) {
      const receipt = validate('controlReceipt', value);
      const issues = validateVerifiedReceipt(receipt);
      if (issues.length > 0) throw new ProtocolValidationError(issues);
      return receipt;
    },
    validateControlTask(value) {
      const task = validate('controlTask', value);
      const issues = validateTaskSemantics(task);
      if (issues.length > 0) throw new ProtocolValidationError(issues);
      return task;
    },
    validateBackendStatus(value) {
      const status = validate('backendStatusResult', value);
      const issues = validateBackendStatusSemantics(status);
      if (issues.length > 0) throw new ProtocolValidationError(issues);
      return status;
    },
    validateSourceManifest(value) {
      return validate('sourceManifestResult', value);
    },
    validateSourceCard(value) {
      const card = validate('sourceCard', value);
      const issues = validateSourceCardSemantics(card);
      if (issues.length > 0) throw new ProtocolValidationError(issues);
      return card;
    },
    validateConversationRoute(value) {
      return validate('conversationRouteResult', value);
    },
  });
}
