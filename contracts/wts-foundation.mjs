export const PROTOCOL_VERSION = 8;
export const HOST_NAME = 'com.athena.wts';
export const MAX_MESSAGE_BYTES = 131072;
export const FINANCIAL_MAX_PAGE_BYTES = 98304;
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
export const FINANCIAL_PROFILE = 'wts-financial-read-v1';
export const FINANCIAL_API_VERSION = 'selector-financial-read-v1';
export const FINANCIAL_CARD_VERSION = 'wts-financial-card-1';
export const FINANCIAL_METHODS = Object.freeze([
  'source.credentials.status',
  'source.credentials.configure',
  'source.credentials.delete',
  'source.query.start',
  'source.query.status',
  'source.query.page',
  'source.query.continue',
  'source.query.cancel',
]);
export const FINANCIAL_RENDER_KINDS = Object.freeze(['facts', 'table', 'compound', 'chart']);
export const FINANCIAL_ERROR_CODES = Object.freeze([
  'REQUEST_INVALID',
  'LOCAL_AUTH_FAILED',
  'RESOURCE_NOT_FOUND',
  'STATE_CONFLICT',
  'BUSY',
  'PAYLOAD_TOO_LARGE',
  'UPSTREAM_UNAVAILABLE',
  'OPERATION_TIMEOUT',
  'INTERNAL_ERROR',
  'FINANCIAL_BACKEND_STARTING',
  'CREDENTIAL_MUTATION_NOT_FOUND',
  'IDEMPOTENCY_CONFLICT',
  'QUERY_JOB_NOT_FOUND',
  'QUERY_CANCELLED',
  'QUERY_RESULT_ITEM_TOO_LARGE',
  'QUERY_RESULT_TOO_LARGE',
  'QUERY_RESULT_UNSUPPORTED_VALUE',
  'CONTINUATION_ALREADY_USED',
  'LOCK_CONFLICT',
  'TOKEN_REFRESHING',
  'TOKEN_REJECTED',
  'NETWORK_UNAVAILABLE',
  'VAULT_UNAVAILABLE',
  'DELETING',
]);
export const FINANCIAL_ERROR_MESSAGES = Object.freeze({
  REQUEST_INVALID: 'Request is invalid.',
  LOCAL_AUTH_FAILED: 'Local authorization failed.',
  RESOURCE_NOT_FOUND: 'Requested local resource was not found.',
  STATE_CONFLICT: 'Requested operation conflicts with current state.',
  BUSY: 'Local financial runtime is busy.',
  PAYLOAD_TOO_LARGE: 'Payload is too large.',
  UPSTREAM_UNAVAILABLE: 'Financial data source is unavailable.',
  OPERATION_TIMEOUT: 'Financial operation timed out.',
  INTERNAL_ERROR: 'Financial operation failed.',
  FINANCIAL_BACKEND_STARTING: 'Local financial runtime is starting.',
  CREDENTIAL_MUTATION_NOT_FOUND: 'Credential mutation was not found.',
  IDEMPOTENCY_CONFLICT: 'Request identity conflicts with prior input.',
  QUERY_JOB_NOT_FOUND: 'Financial query job was not found.',
  QUERY_CANCELLED: 'Financial query was cancelled.',
  QUERY_RESULT_ITEM_TOO_LARGE: 'Financial result item is too large.',
  QUERY_RESULT_TOO_LARGE: 'Financial result is too large.',
  QUERY_RESULT_UNSUPPORTED_VALUE: 'Financial result contains an unsupported value.',
  CONTINUATION_ALREADY_USED: 'Financial continuation was already used.',
  LOCK_CONFLICT: 'Credential profile is locked by another process.',
  TOKEN_REFRESHING: 'Credential token is refreshing.',
  TOKEN_REJECTED: 'Credential token request was rejected.',
  NETWORK_UNAVAILABLE: 'Credential network is unavailable.',
  VAULT_UNAVAILABLE: 'Credential vault is unavailable.',
  DELETING: 'Credential profile is being deleted.',
});
export const PROVIDER_METHODS = Object.freeze([
  'provider.status',
  'provider.connect.start',
  'provider.models.start',
  'provider.model.select',
  'provider.plan.start',
  'provider.operation.get',
  'provider.operation.cancel',
  'provider.disconnect.start',
  'provider.account.reset.start',
]);
export const PROVIDER_ERROR_CODES = Object.freeze([
  'PROVIDER_BUSY',
  'PROVIDER_PREVIOUS_RESULT_PENDING',
  'PROVIDER_STATE_INVALID',
  'PROVIDER_MODEL_CATALOG_REQUIRED',
  'PROVIDER_MODEL_NOT_SELECTED',
  'PROVIDER_MODEL_INVALID',
  'PROVIDER_OPERATION_NOT_FOUND',
  'PROVIDER_OPERATION_NOT_TERMINAL',
  'PROVIDER_OPERATION_CONFLICT',
  'PROVIDER_OPERATION_NOT_CANCELLABLE',
  'PROVIDER_CONNECT_FAILED',
  'PROVIDER_CONNECT_EXCHANGE_FAILED',
  'PROVIDER_CONNECT_EXCHANGE_TIMEOUT',
  'PROVIDER_CONNECT_TOKEN_REJECTED',
  'PROVIDER_CONNECT_TOKEN_RESPONSE_INVALID',
  'PROVIDER_CONNECT_IDENTITY_INVALID',
  'PROVIDER_CONNECT_ACCOUNT_MISMATCH',
  'PROVIDER_CONNECT_REGISTRATION_FAILED',
  'PROVIDER_CONNECT_SESSION_FAILED',
  'PROVIDER_CONNECT_TIMEOUT',
  'PROVIDER_CONNECT_CANCELLED',
  'PROVIDER_MODELS_FAILED',
  'PROVIDER_MODELS_AUTH_REQUIRED',
  'PROVIDER_MODELS_ACCESS_DENIED',
  'PROVIDER_MODELS_RATE_LIMITED',
  'PROVIDER_MODELS_SERVICE_UNAVAILABLE',
  'PROVIDER_MODELS_HTTP_FAILED',
  'PROVIDER_MODELS_TIMEOUT',
  'PROVIDER_MODELS_NETWORK_FAILED',
  'PROVIDER_MODELS_SESSION_UNAVAILABLE',
  'PROVIDER_MODELS_RESPONSE_TOO_LARGE',
  'PROVIDER_MODELS_RESPONSE_FORMAT_INVALID',
  'PROVIDER_MODELS_RESPONSE_READ_FAILED',
  'PROVIDER_MODELS_RESPONSE_SCHEMA_INVALID',
  'PROVIDER_MODELS_MODEL_METADATA_INVALID',
  'PROVIDER_MODELS_REDIRECT_REJECTED',
  'PROVIDER_MODELS_COUNT_EXCEEDED',
  'PROVIDER_MODELS_CANCELLED',
  'PROVIDER_PLAN_FAILED',
  'PROVIDER_PLAN_CANCELLED',
  'PROVIDER_PLAN_INPUT_SENSITIVE',
  'PROVIDER_DISCONNECT_FAILED',
  'PROVIDER_ACCOUNT_RESET_FAILED',
]);
export const PROVIDER_ERROR_MESSAGES = Object.freeze({
  PROVIDER_BUSY: '다른 ChatGPT 작업이 진행 중입니다.',
  PROVIDER_PREVIOUS_RESULT_PENDING: '이전 ChatGPT 작업 결과를 먼저 확인해 주세요.',
  PROVIDER_STATE_INVALID: '현재 연결 상태에서는 이 작업을 실행할 수 없습니다.',
  PROVIDER_MODEL_CATALOG_REQUIRED: '사용할 수 있는 모델 목록을 먼저 가져와 주세요.',
  PROVIDER_MODEL_NOT_SELECTED: '사용할 모델을 먼저 선택해 주세요.',
  PROVIDER_MODEL_INVALID: '현재 모델 목록에 없는 모델입니다.',
  PROVIDER_OPERATION_NOT_FOUND: '해당 ChatGPT 작업을 찾을 수 없습니다.',
  PROVIDER_OPERATION_NOT_TERMINAL: '아직 완료되지 않은 ChatGPT 작업입니다.',
  PROVIDER_OPERATION_CONFLICT: 'ChatGPT 작업 상태가 변경되었습니다.',
  PROVIDER_OPERATION_NOT_CANCELLABLE: '현재 ChatGPT 작업은 취소할 수 없습니다.',
  PROVIDER_CONNECT_FAILED: 'ChatGPT 계정 연결을 완료하지 못했습니다.',
  PROVIDER_CONNECT_EXCHANGE_FAILED: '로그인 응답은 도착했지만 OpenAI 연결 토큰을 받아오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 로그인해 주세요.',
  PROVIDER_CONNECT_EXCHANGE_TIMEOUT: '로그인 응답은 도착했지만 OpenAI 연결 토큰을 기다리는 시간이 초과되었습니다. 다시 로그인해 주세요.',
  PROVIDER_CONNECT_TOKEN_REJECTED: 'OpenAI가 연결 토큰 요청을 승인하지 않았습니다. 다시 로그인해 주세요.',
  PROVIDER_CONNECT_TOKEN_RESPONSE_INVALID: 'OpenAI 연결 토큰 응답을 안전하게 확인하지 못했습니다. 연결을 완료하지 않았습니다.',
  PROVIDER_CONNECT_IDENTITY_INVALID: 'OpenAI 계정의 인증 서명과 정보를 안전하게 확인하지 못했습니다. 연결을 완료하지 않았습니다.',
  PROVIDER_CONNECT_ACCOUNT_MISMATCH: '로그인한 ChatGPT 계정이 저장된 연결 계정과 다릅니다. 기존 계정으로 다시 로그인해 주세요.',
  PROVIDER_CONNECT_REGISTRATION_FAILED: '인증 후 로컬 계정 연결 정보를 안전하게 저장하지 못했습니다. 연결을 완료하지 않았습니다.',
  PROVIDER_CONNECT_SESSION_FAILED: '인증 후 로컬 ChatGPT 연결 세션을 시작하지 못했습니다. 연결을 완료하지 않았습니다.',
  PROVIDER_CONNECT_TIMEOUT: 'ChatGPT 로그인 제한 시간이 초과되었습니다. 다시 로그인해 주세요.',
  PROVIDER_CONNECT_CANCELLED: 'ChatGPT 계정 연결을 취소했습니다.',
  PROVIDER_MODELS_FAILED: 'ChatGPT 모델 목록을 가져오지 못했습니다.',
  PROVIDER_MODELS_AUTH_REQUIRED: 'OpenAI가 연결 인증을 인정하지 않아 모델 목록을 가져오지 못했습니다. 다시 로그인해 주세요.',
  PROVIDER_MODELS_ACCESS_DENIED: 'OpenAI가 이 연결의 모델 목록 접근을 허용하지 않았습니다. 계정의 ChatGPT 사용 권한을 확인해 주세요.',
  PROVIDER_MODELS_RATE_LIMITED: 'OpenAI의 요청 한도에 도달해 모델 목록을 가져오지 못했습니다. 잠시 후 다시 요청해 주세요.',
  PROVIDER_MODELS_SERVICE_UNAVAILABLE: 'OpenAI 서비스 오류로 모델 목록을 가져오지 못했습니다. 잠시 후 다시 요청해 주세요.',
  PROVIDER_MODELS_HTTP_FAILED: 'OpenAI 모델 목록 요청이 정상적으로 완료되지 않았습니다.',
  PROVIDER_MODELS_TIMEOUT: 'ChatGPT 모델 목록을 기다리는 시간이 초과되었습니다. 네트워크 연결을 확인한 뒤 다시 요청해 주세요.',
  PROVIDER_MODELS_NETWORK_FAILED: 'OpenAI 모델 목록 서버에 연결하지 못했습니다. 네트워크 연결을 확인해 주세요.',
  PROVIDER_MODELS_SESSION_UNAVAILABLE: '모델 목록 요청에 필요한 ChatGPT 연결 세션을 사용할 수 없습니다. 연결 상태를 확인해 주세요.',
  PROVIDER_MODELS_RESPONSE_TOO_LARGE: 'OpenAI 모델 목록 응답이 허용된 크기를 초과해 처리하지 않았습니다.',
  PROVIDER_MODELS_RESPONSE_FORMAT_INVALID: 'OpenAI 모델 목록 응답의 데이터 형식을 안전하게 확인하지 못했습니다.',
  PROVIDER_MODELS_RESPONSE_READ_FAILED: 'OpenAI 모델 목록 응답을 읽는 중 연결이 끊기거나 읽기에 실패했습니다.',
  PROVIDER_MODELS_RESPONSE_SCHEMA_INVALID: 'OpenAI 모델 목록 응답의 필수 구조가 예상 형식과 다릅니다.',
  PROVIDER_MODELS_MODEL_METADATA_INVALID: 'OpenAI 모델 목록에 안전하게 표시할 수 없는 모델 정보가 있어 처리하지 않았습니다.',
  PROVIDER_MODELS_REDIRECT_REJECTED: 'OpenAI 모델 목록 요청의 주소 변경 응답을 허용하지 않았습니다.',
  PROVIDER_MODELS_COUNT_EXCEEDED: 'OpenAI 모델 목록의 모델 수가 허용된 개수를 초과해 처리하지 않았습니다.',
  PROVIDER_MODELS_CANCELLED: 'ChatGPT 모델 목록 요청을 취소했습니다.',
  PROVIDER_PLAN_FAILED: 'ChatGPT 명령 제안을 완료하지 못했습니다.',
  PROVIDER_PLAN_CANCELLED: 'ChatGPT 명령 제안을 취소했습니다.',
  PROVIDER_PLAN_INPUT_SENSITIVE: '입력에 민감한 정보가 포함되어 요청하지 않았습니다.',
  PROVIDER_DISCONNECT_FAILED: 'ChatGPT 연결 종료 결과를 확인하지 못했습니다.',
  PROVIDER_ACCOUNT_RESET_FAILED: 'ChatGPT 계정 연결 정보를 초기화하지 못했습니다.',
});
export const RUNTIME_HELLO_PROVIDER_METADATA = Object.freeze({
  id: 'openai-chatgpt-siwc-v1',
  apiVersion: 'openai-provider-native-v1',
  methods: PROVIDER_METHODS,
  asyncJobs: true,
  auth: 'explicit-browser-consent',
  tokenStorage: 'native-memory-only',
  planner: 'proposal-only',
  modelCatalog: true,
  tools: false,
  order: false,
  dataSent: 'user-text-and-fixed-control-catalog',
});
const PROVIDER_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROVIDER_MODEL_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PROVIDER_DISPLAY_NAME_FORBIDDEN_PATTERN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Noncharacter_Code_Point}]/u;
const PROVIDER_CANCELLABLE_KINDS = Object.freeze(['connect', 'models', 'plan']);
const PROVIDER_TERMINAL_STATES = Object.freeze(['succeeded', 'failed', 'cancelled']);
const PROVIDER_IMMEDIATE_ERROR_CODES = Object.freeze(PROVIDER_ERROR_CODES.slice(0, 10));
const PROVIDER_START_KIND = Object.freeze({
  'provider.connect.start': 'connect',
  'provider.models.start': 'models',
  'provider.plan.start': 'plan',
  'provider.disconnect.start': 'disconnect',
  'provider.account.reset.start': 'account-reset',
});
const PROVIDER_FAILURE_CODES = Object.freeze({
  connect: Object.freeze({
    failed: [
      'PROVIDER_CONNECT_FAILED',
      'PROVIDER_CONNECT_EXCHANGE_FAILED',
      'PROVIDER_CONNECT_EXCHANGE_TIMEOUT',
      'PROVIDER_CONNECT_TOKEN_REJECTED',
      'PROVIDER_CONNECT_TOKEN_RESPONSE_INVALID',
      'PROVIDER_CONNECT_IDENTITY_INVALID',
      'PROVIDER_CONNECT_ACCOUNT_MISMATCH',
      'PROVIDER_CONNECT_REGISTRATION_FAILED',
      'PROVIDER_CONNECT_SESSION_FAILED',
      'PROVIDER_CONNECT_TIMEOUT',
    ],
    cancelled: ['PROVIDER_CONNECT_CANCELLED'],
  }),
  models: Object.freeze({
    failed: [
      'PROVIDER_MODELS_FAILED',
      'PROVIDER_MODELS_AUTH_REQUIRED',
      'PROVIDER_MODELS_ACCESS_DENIED',
      'PROVIDER_MODELS_RATE_LIMITED',
      'PROVIDER_MODELS_SERVICE_UNAVAILABLE',
      'PROVIDER_MODELS_HTTP_FAILED',
      'PROVIDER_MODELS_TIMEOUT',
      'PROVIDER_MODELS_NETWORK_FAILED',
      'PROVIDER_MODELS_SESSION_UNAVAILABLE',
      'PROVIDER_MODELS_RESPONSE_TOO_LARGE',
      'PROVIDER_MODELS_RESPONSE_FORMAT_INVALID',
      'PROVIDER_MODELS_RESPONSE_READ_FAILED',
      'PROVIDER_MODELS_RESPONSE_SCHEMA_INVALID',
      'PROVIDER_MODELS_MODEL_METADATA_INVALID',
      'PROVIDER_MODELS_REDIRECT_REJECTED',
      'PROVIDER_MODELS_COUNT_EXCEEDED',
    ],
    cancelled: ['PROVIDER_MODELS_CANCELLED'],
  }),
  plan: Object.freeze({
    failed: ['PROVIDER_PLAN_FAILED', 'PROVIDER_PLAN_INPUT_SENSITIVE'],
    cancelled: ['PROVIDER_PLAN_CANCELLED'],
  }),
  disconnect: Object.freeze({ failed: ['PROVIDER_DISCONNECT_FAILED'], cancelled: [] }),
  'account-reset': Object.freeze({ failed: ['PROVIDER_ACCOUNT_RESET_FAILED'], cancelled: [] }),
});
const PROVIDER_CONTROL_PROPOSALS = new Set([
  '차트 열어줘',
  '일봉으로',
  '주봉으로',
  '월봉으로',
  '년봉으로',
  ...MARKET_MENU_TARGETS.map(
    ({ sitemapGroup, buttonLabel }) => `시장 메뉴 열어줘: ${sitemapGroup} > ${buttonLabel}`,
  ),
]);
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
    if (Number.isInteger(schema.minProperties) && Object.keys(value).length < schema.minProperties) {
      issues.push(`${path} contains too few properties`);
    }
    if (Number.isInteger(schema.maxProperties) && Object.keys(value).length > schema.maxProperties) {
      issues.push(`${path} contains too many properties`);
    }
    if (schema.propertyNames) {
      for (const key of Object.keys(value)) {
        issues.push(...validateNode(rootSchema, schema.propertyNames, key, joinPath(path, key)));
      }
    }
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
    } else if (isPlainObject(schema.additionalProperties)) {
      for (const [key, additionalValue] of Object.entries(value)) {
        if (!Object.hasOwn(properties, key)) {
          issues.push(...validateNode(
            rootSchema,
            schema.additionalProperties,
            additionalValue,
            joinPath(path, key),
          ));
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
    const prefixItems = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
    for (let index = 0; index < Math.min(value.length, prefixItems.length); index += 1) {
      issues.push(...validateNode(rootSchema, prefixItems[index], value[index], joinPath(path, index)));
    }
    if (schema.items === false && value.length > prefixItems.length) {
      issues.push(`${path} contains unsupported trailing items`);
    } else if (isPlainObject(schema.items)) {
      for (let index = prefixItems.length; index < value.length; index += 1) {
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

  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return [`${path} must be a finite number`];
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

function hasValidBoundedUnicodeText(value, { maxScalars, maxBytes, requireTrimmed = true }) {
  if (typeof value !== 'string' || value.length === 0 ||
      (requireTrimmed && (value.trim() !== value || value.trim().length === 0)) ||
      new TextEncoder().encode(value).byteLength > maxBytes) {
    return false;
  }
  let scalars = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
    scalars += 1;
    if (scalars > maxScalars) return false;
  }
  return true;
}

function hasValidProviderDisplayName(value) {
  return hasValidBoundedUnicodeText(value, {
    maxScalars: 128,
    maxBytes: 512,
    requireTrimmed: false,
  }) &&
    !PROVIDER_DISPLAY_NAME_FORBIDDEN_PATTERN.test(value);
}

function validateProviderRequestSemantics(request) {
  const issues = [];
  if (!PROVIDER_METHODS.includes(request.method)) return issues;
  const { params } = request;
  if (['provider.operation.get', 'provider.operation.cancel'].includes(request.method) &&
      !PROVIDER_UUID_PATTERN.test(params.operationId)) {
    issues.push('$.params.operationId must be a lowercase canonical UUID');
  }
  if (request.method === 'provider.operation.cancel' &&
      !PROVIDER_UUID_PATTERN.test(params.cancellationId)) {
    issues.push('$.params.cancellationId must be a lowercase canonical UUID');
  }
  if (request.method === 'provider.plan.start') {
    if (!PROVIDER_UUID_PATTERN.test(params.submissionId)) {
      issues.push('$.params.submissionId must be a lowercase canonical UUID');
    }
    if (!hasValidBoundedUnicodeText(params.text, { maxScalars: 512, maxBytes: 2_048 })) {
      issues.push('$.params.text must be trimmed valid Unicode within 512 scalars and 2048 UTF-8 bytes');
    }
  }
  if (request.method === 'provider.model.select' &&
      !PROVIDER_MODEL_SLUG_PATTERN.test(params.slug)) {
    issues.push('$.params.slug must use the approved model slug grammar');
  }
  return issues;
}

function validateProviderError(error, allowedCodes, path) {
  const expectedMessage = PROVIDER_ERROR_MESSAGES[error?.code];
  return allowedCodes.includes(error?.code) && error?.message === expectedMessage
    ? []
    : [`${path} must use an approved provider code and constant message`];
}

function validateProviderModelsResult(result, path) {
  const issues = [];
  if (!Array.isArray(result.models)) return [`${path} must be the models result`];
  if (result.models.length > 100) issues.push(`${path}.models contains too many items`);
  const slugs = new Set();
  result.models.forEach((model, index) => {
    if (!PROVIDER_MODEL_SLUG_PATTERN.test(model.slug)) {
      issues.push(`${path}.models[${index}].slug must use the approved model slug grammar`);
    }
    if (!hasValidProviderDisplayName(model.displayName)) {
      issues.push(`${path}.models[${index}].displayName is invalid`);
    }
    if (slugs.has(model.slug)) {
      issues.push(`${path}.models[${index}].slug is duplicated`);
    }
    slugs.add(model.slug);
  });
  return issues;
}

function validateProviderPlanResult(result, path) {
  const issues = [];
  if (!Object.hasOwn(result, 'submissionId') || !Object.hasOwn(result, 'catalogVersion') ||
      !Object.hasOwn(result, 'assistantText') || !Object.hasOwn(result, 'proposal')) {
    return [`${path} must be the plan result`];
  }
  if (!PROVIDER_UUID_PATTERN.test(result.submissionId)) {
    issues.push(`${path}.submissionId must be a lowercase canonical UUID`);
  }
  if (result.catalogVersion !== CONTROL_CATALOG_VERSION) {
    issues.push(`${path}.catalogVersion must match the fixed control catalog`);
  }
  if (!hasValidBoundedUnicodeText(result.assistantText, {
    maxScalars: 4_096,
    maxBytes: 8_192,
  })) {
    issues.push(`${path}.assistantText is outside the approved Unicode bounds`);
  }
  if (result.proposal !== null &&
      (!isPlainObject(result.proposal) ||
      !hasValidBoundedUnicodeText(result.proposal.text, {
        maxScalars: 512,
        maxBytes: 2_048,
      }) || !PROVIDER_CONTROL_PROPOSALS.has(result.proposal.text))) {
    issues.push(`${path}.proposal.text is not an offered compilable control command`);
  }
  return issues;
}

function validateProviderSucceededResult(snapshot, path) {
  const { kind, result } = snapshot;
  if (kind === 'connect') {
    return sameJson(result, { connection: 'connected' })
      ? [] : [`${path}.result must be the connect result`];
  }
  if (kind === 'models') return validateProviderModelsResult(result, `${path}.result`);
  if (kind === 'plan') return validateProviderPlanResult(result, `${path}.result`);
  if (kind === 'disconnect') {
    return result.connection === 'signed-out' && ['revoked', 'unconfirmed'].includes(result.revocation)
      ? [] : [`${path}.result must be the disconnect result`];
  }
  return result.connection === 'signed-out' && ['reset', 'already-empty'].includes(result.registration)
    ? [] : [`${path}.result must be the account reset result`];
}

function validateProviderOperationSemantics(snapshot, path = '$.result', { summary = false } = {}) {
  const issues = [];
  if (!PROVIDER_UUID_PATTERN.test(snapshot.operationId)) {
    issues.push(`${path}.operationId must be a lowercase canonical UUID`);
  }
  if (!summary && messageSizeInBytes(snapshot) > FINANCIAL_MAX_PAGE_BYTES) {
    issues.push(`${path} exceeds the 96 KiB provider snapshot limit`);
  }
  const active = ['running', 'cancelling'].includes(snapshot.state);
  const cancellableKind = PROVIDER_CANCELLABLE_KINDS.includes(snapshot.kind);
  if (active) {
    if (snapshot.cancellable !== cancellableKind) {
      issues.push(`${path}.cancellable is inconsistent with the operation kind`);
    }
    if (snapshot.state === 'cancelling' && !cancellableKind) {
      issues.push(`${path}.state cannot be cancelling for this operation kind`);
    }
    const expectedRevision = snapshot.state === 'running' ? 1 : 2;
    if (snapshot.revision !== expectedRevision) {
      issues.push(`${path}.revision is inconsistent with the active lifecycle`);
    }
    if (!summary && (snapshot.result !== null || snapshot.error !== null)) {
      issues.push(`${path} active operation must have null result and error`);
    }
    return issues;
  }
  if (!PROVIDER_TERMINAL_STATES.includes(snapshot.state)) {
    issues.push(`${path}.state is not an allowed provider lifecycle state`);
    return issues;
  }
  if (snapshot.cancellable !== false) {
    issues.push(`${path}.cancellable must be false for terminal operations`);
  }
  const expectedRevision = snapshot.state === 'cancelled' ? 3 : 2;
  if (snapshot.revision !== expectedRevision) {
    issues.push(`${path}.revision is inconsistent with the terminal lifecycle`);
  }
  if (summary) return issues;
  if (snapshot.state === 'succeeded') {
    if (snapshot.error !== null || snapshot.result === null) {
      issues.push(`${path} succeeded operation requires a result and null error`);
    } else {
      issues.push(...validateProviderSucceededResult(snapshot, path));
    }
  } else {
    if (snapshot.result !== null || snapshot.error === null) {
      issues.push(`${path} failed or cancelled operation requires null result and one error`);
    } else {
      issues.push(...validateProviderError(
        snapshot.error,
        PROVIDER_FAILURE_CODES[snapshot.kind][snapshot.state],
        `${path}.error`,
      ));
    }
  }
  return issues;
}

function validateProviderStatusSemantics(status, path = '$.result') {
  const issues = [];
  if (status.provider !== RUNTIME_HELLO_PROVIDER_METADATA.id) {
    issues.push(`${path}.provider must match the fixed provider id`);
  }
  if (status.operation !== null) {
    issues.push(...validateProviderOperationSemantics(status.operation, `${path}.operation`, {
      summary: true,
    }));
  }
  if (status.connection === 'signed-out' &&
      (status.catalog !== 'unavailable' || status.selectedModel !== null)) {
    issues.push(`${path} signed-out state must clear catalog and selected model`);
  }
  if (status.connection === 'connected' && status.catalog === 'unavailable') {
    issues.push(`${path} connected state cannot have an unavailable catalog`);
  }
  if (status.connection !== 'connected' && status.catalog !== 'unavailable') {
    issues.push(`${path} disconnected lifecycle must have an unavailable catalog`);
  }
  if (status.connection !== 'connected' && status.selectedModel !== null) {
    issues.push(`${path}.selectedModel requires a connected provider`);
  }
  if (status.catalog !== 'ready' && status.selectedModel !== null) {
    issues.push(`${path}.selectedModel requires a ready catalog`);
  }
  if (status.selectedModel !== null) {
    if (!PROVIDER_MODEL_SLUG_PATTERN.test(status.selectedModel.slug) ||
        !hasValidProviderDisplayName(status.selectedModel.displayName)) {
      issues.push(`${path}.selectedModel does not match the approved model grammar`);
    }
  }
  const activeOperation = status.operation &&
    ['running', 'cancelling'].includes(status.operation.state)
    ? status.operation : null;
  const expectedTransient = {
    connecting: 'connect',
    disconnecting: 'disconnect',
    resetting: 'account-reset',
  };
  if (expectedTransient[status.connection] &&
      activeOperation?.kind !== expectedTransient[status.connection]) {
    issues.push(`${path}.operation does not match the connection lifecycle`);
  }
  if (status.catalog === 'loading' && activeOperation?.kind !== 'models') {
    issues.push(`${path}.operation must be active models while the catalog is loading`);
  }
  if (activeOperation?.kind === 'connect' && status.connection !== 'connecting') {
    issues.push(`${path}.connection must be connecting for an active connect operation`);
  }
  if (activeOperation?.kind === 'models' &&
      (status.connection !== 'connected' || status.catalog !== 'loading' ||
        status.selectedModel !== null)) {
    issues.push(`${path} active models operation has inconsistent provider state`);
  }
  if (activeOperation?.kind === 'plan' &&
      (status.connection !== 'connected' || status.catalog !== 'ready' ||
        status.selectedModel === null)) {
    issues.push(`${path} active plan operation requires a selected ready model`);
  }
  if (activeOperation?.kind === 'disconnect' && status.connection !== 'disconnecting') {
    issues.push(`${path}.connection must be disconnecting for an active disconnect operation`);
  }
  if (activeOperation?.kind === 'account-reset' && status.connection !== 'resetting') {
    issues.push(`${path}.connection must be resetting for an active account reset operation`);
  }
  if (status.accountResetAvailable &&
      (status.connection !== 'signed-out' || activeOperation !== null)) {
    issues.push(`${path}.accountResetAvailable is inconsistent with the provider lifecycle`);
  }
  if (status.connection === 'signed-out' && status.operation === null &&
      status.accountResetAvailable !== true) {
    issues.push(`${path}.accountResetAvailable must be true while signed out and idle`);
  }
  const terminalOperation = status.operation &&
    PROVIDER_TERMINAL_STATES.includes(status.operation.state)
    ? status.operation : null;
  if (terminalOperation?.kind === 'connect') {
    const expectedConnection = terminalOperation.state === 'succeeded' ? 'connected' : 'signed-out';
    if (status.connection !== expectedConnection) {
      issues.push(`${path}.connection does not match the terminal connect operation`);
    }
    if (terminalOperation.state === 'succeeded' &&
        (status.catalog !== 'not-loaded' || status.selectedModel !== null)) {
      issues.push(`${path} does not match the successful connect operation`);
    }
  }
  if (terminalOperation?.kind === 'models' && terminalOperation.state === 'succeeded' &&
      (status.connection !== 'connected' || status.catalog !== 'ready' ||
        status.selectedModel !== null)) {
    issues.push(`${path} does not match the successful models operation`);
  }
  if (terminalOperation?.kind === 'models' && terminalOperation.state !== 'succeeded') {
    const retainedConnection = status.connection === 'connected' &&
      status.catalog === 'not-loaded' && status.selectedModel === null;
    const invalidatedConnection = status.connection === 'signed-out' &&
      status.catalog === 'unavailable' && status.selectedModel === null;
    if (!retainedConnection && !invalidatedConnection) {
      issues.push(`${path} does not match the terminal models failure state`);
    }
  }
  if (terminalOperation?.kind === 'plan' &&
      (status.connection !== 'connected' || status.catalog !== 'ready' ||
        status.selectedModel === null)) {
    issues.push(`${path} terminal plan operation requires the selected ready model`);
  }
  if (terminalOperation && ['disconnect', 'account-reset'].includes(terminalOperation.kind) &&
      status.connection !== 'signed-out') {
    issues.push(`${path}.connection does not match the terminal signed-out operation`);
  }
  return issues;
}

function validateProviderResponseSemantics(response) {
  if (response.ok === false) {
    return validateProviderError(response.error, PROVIDER_IMMEDIATE_ERROR_CODES, '$.error');
  }
  if (['provider.status', 'provider.model.select'].includes(response.method)) {
    return validateProviderStatusSemantics(response.result);
  }
  const issues = validateProviderOperationSemantics(response.result);
  const expectedKind = PROVIDER_START_KIND[response.method];
  if (expectedKind && response.result.kind !== expectedKind) {
    issues.push('$.result.kind does not match the provider method');
  }
  if (expectedKind && response.result.state !== 'running') {
    issues.push('$.result.state must be running for a provider start response');
  }
  if (response.method === 'provider.operation.cancel' &&
      (!PROVIDER_CANCELLABLE_KINDS.includes(response.result.kind) ||
        !['cancelling', 'cancelled'].includes(response.result.state))) {
    issues.push('$.result must be a cancelling or cancelled cancellable provider operation');
  }
  return issues;
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
  if (!sameJson(result.financial.methods, FINANCIAL_METHODS)) {
    issues.push('$.result.financial.methods must match the fixed financial method order');
  }
  if (!sameJson(result.financial.renderKinds, FINANCIAL_RENDER_KINDS)) {
    issues.push('$.result.financial.renderKinds must match the fixed render kind order');
  }
  if (!sameJson(result.provider, RUNTIME_HELLO_PROVIDER_METADATA)) {
    issues.push('$.result.provider must match the fixed provider metadata');
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
  if (card.kind === 'capability-detail') {
    if (card.requiredArguments.some((field) => field.required !== true)) {
      issues.push('$.requiredArguments entries must have required true');
    }
    if (card.optionalArguments.some((field) => field.required !== false)) {
      issues.push('$.optionalArguments entries must have required false');
    }
  }
  return issues;
}

function parseCanonicalUtc(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/u.exec(value);
  if (!match) return null;
  const parts = match.slice(1, 7).map(Number);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  return date.getUTCFullYear() === parts[0] &&
      date.getUTCMonth() === parts[1] - 1 &&
      date.getUTCDate() === parts[2] &&
      date.getUTCHours() === parts[3] &&
      date.getUTCMinutes() === parts[4] &&
      date.getUTCSeconds() === parts[5]
    ? parsed
    : null;
}

function validateTimestampOrder(value, fields, issues, path) {
  const parsed = Object.fromEntries(fields.map((field) => [
    field,
    value[field] === null ? null : parseCanonicalUtc(value[field]),
  ]));
  for (const field of fields) {
    if (value[field] !== null && parsed[field] === null) {
      issues.push(`${path}.${field} must be a real canonical UTC timestamp`);
    }
  }
  if (parsed.createdAt !== null && parsed.updatedAt !== null &&
      parsed.updatedAt < parsed.createdAt) {
    issues.push(`${path}.updatedAt must not precede createdAt`);
  }
  return parsed;
}

function validateCredentialProfileSemantics(profile, path) {
  const issues = [];
  const expectedReason = {
    locked: 'LOCK_CONFLICT',
    refreshing: 'TOKEN_REFRESHING',
    deleting: 'DELETING',
  };
  if (profile.state === 'ready') {
    const expiry = profile.tokenExpiresAt === null ? null : parseCanonicalUtc(profile.tokenExpiresAt);
    if (profile.reasonCode !== null || expiry === null || expiry <= Date.now()) {
      issues.push(`${path} ready profile must have a future token expiry and no reason`);
    }
  } else if (profile.state === 'error') {
    if (!['TOKEN_REJECTED', 'NETWORK_UNAVAILABLE', 'VAULT_UNAVAILABLE'].includes(profile.reasonCode) ||
        profile.tokenExpiresAt !== null) {
      issues.push(`${path} error profile has inconsistent safe status`);
    }
  } else if (profile.reasonCode !== expectedReason[profile.state] ||
      profile.tokenExpiresAt !== null) {
    issues.push(`${path} profile state has an inconsistent safe reason`);
  }
  return issues;
}

function validateCredentialMutationSemantics(mutation, path) {
  const issues = [];
  validateTimestampOrder(
    mutation,
    ['createdAt', 'updatedAt', 'queueDeadlineAt', 'runDeadlineAt', 'terminalAt'],
    issues,
    path,
  );
  if (mutation.errorCode !== null && !FINANCIAL_ERROR_CODES.includes(mutation.errorCode)) {
    issues.push(`${path}.errorCode is not in the safe allowlist`);
  }
  const nullRun = mutation.runDeadlineAt === null;
  const nullTerminal = mutation.terminalAt === null;
  const nullError = mutation.errorCode === null;
  if (mutation.state === 'queued' && (!nullRun || !nullTerminal || !nullError)) {
    issues.push(`${path} queued mutation has terminal fields`);
  } else if (mutation.state === 'running' && (nullRun || !nullTerminal || !nullError)) {
    issues.push(`${path} running mutation has inconsistent deadlines`);
  } else if (mutation.state === 'succeeded' && (nullTerminal || !nullError)) {
    issues.push(`${path} succeeded mutation has inconsistent terminal fields`);
  } else if (mutation.state === 'failed' && (nullTerminal || nullError)) {
    issues.push(`${path} failed mutation requires a safe error`);
  }
  return issues;
}

function validateRows(data, path) {
  const issues = [];
  const keys = data.columns.map((column) => column.key);
  if (new Set(keys).size !== keys.length) {
    issues.push(`${path}.columns contains duplicate keys`);
  }
  data.rows.forEach((row, index) => {
    if (!sameJson(Object.keys(row), keys)) {
      issues.push(`${path}.rows[${index}] keys must exactly match ordered columns`);
    }
  });
  return issues;
}

function validateFinancialCardSemantics(card, path = '$.result') {
  const issues = [];
  const rendererByKind = {
    facts: 'facts-card-v1',
    table: 'table-card-v1',
    compound: 'compound-card-v1',
    chart: 'aits-chart-v1',
  };
  if (card.rendererId !== rendererByKind[card.renderKind] ||
      card.data.kind !== card.renderKind) {
    issues.push(`${path} render kind, renderer, and data kind must match`);
  }
  const page = card.page;
  if (page.itemEndExclusive - page.itemStart !== page.itemCount ||
      page.pageIndex >= page.pageCount ||
      page.itemEndExclusive > page.totalItems) {
    issues.push(`${path}.page has inconsistent bounds`);
  }
  if ((page.pageIndex === 0) !== (page.previousPageToken === null) ||
      (page.pageIndex === page.pageCount - 1) !== (page.nextPageToken === null)) {
    issues.push(`${path}.page boundary tokens are inconsistent`);
  }
  const expectedInitial = card.renderKind === 'chart'
    ? page.pageIndex === page.pageCount - 1
    : page.pageIndex === 0;
  if (page.initial !== expectedInitial) {
    issues.push(`${path}.page.initial is inconsistent with the render order`);
  }
  const continuation = card.continuation;
  const continuationPresent =
    continuation.continuationToken !== null && continuation.expiresAt !== null;
  const continuationAbsent =
    continuation.continuationToken === null && continuation.expiresAt === null;
  if ((continuation.available && !continuationPresent) ||
      (!continuation.available && !continuationAbsent)) {
    issues.push(`${path}.continuation fields are inconsistent`);
  }
  if (parseCanonicalUtc(page.expiresAt) === null ||
      (continuation.expiresAt !== null && parseCanonicalUtc(continuation.expiresAt) === null) ||
      parseCanonicalUtc(card.provenance.fetchedAt) === null) {
    issues.push(`${path} contains an invalid canonical UTC timestamp`);
  }
  let actualItems;
  if (card.data.kind === 'facts') {
    actualItems = card.data.fields.length;
    const keys = card.data.fields.map((field) => field.key);
    if (new Set(keys).size !== keys.length) issues.push(`${path}.data.fields contains duplicate keys`);
  } else if (card.data.kind === 'chart') {
    actualItems = card.data.chart.candles.length;
    if (card.data.chart.trId !== card.provenance.trId) {
      issues.push(`${path}.data.chart.trId must match provenance.trId`);
    }
    const times = card.data.chart.candles.map((candle) => candle.time);
    if (times.some((time) => typeof time !== typeof times[0]) ||
        times.some((time, index) => index > 0 && time < times[index - 1])) {
      issues.push(`${path}.data.chart.candles must be chronological`);
    }
  } else {
    actualItems = card.data.rows.length;
    issues.push(...validateRows(card.data, `${path}.data`));
    if (card.data.kind === 'compound') {
      const keys = card.data.header.map((field) => field.key);
      if (new Set(keys).size !== keys.length) {
        issues.push(`${path}.data.header contains duplicate keys`);
      }
    }
  }
  if (actualItems !== page.itemCount) {
    issues.push(`${path}.page.itemCount must match the card data`);
  }
  if (messageSizeInBytes(card) > FINANCIAL_MAX_PAGE_BYTES) {
    issues.push(`${path} exceeds the 96 KiB card page limit`);
  }
  return issues;
}

function validateQueryJobSemantics(job, path) {
  const issues = [];
  validateTimestampOrder(
    job,
    ['createdAt', 'updatedAt', 'queueDeadlineAt', 'runDeadlineAt', 'terminalAt'],
    issues,
    path,
  );
  if (job.errorCode !== null && !FINANCIAL_ERROR_CODES.includes(job.errorCode)) {
    issues.push(`${path}.errorCode is not in the safe allowlist`);
  }
  const active = ['queued', 'running', 'cancelling'].includes(job.state);
  if (active && (job.terminalAt !== null || job.errorCode !== null || job.card !== null)) {
    issues.push(`${path} active job has terminal data`);
  }
  if (job.state === 'queued' && job.runDeadlineAt !== null) {
    issues.push(`${path} queued job has a run deadline`);
  }
  if (['running', 'cancelling'].includes(job.state) && job.runDeadlineAt === null) {
    issues.push(`${path} active dispatched job lacks a run deadline`);
  }
  if (job.state === 'completed' &&
      (job.terminalAt === null || job.errorCode !== null || job.card === null)) {
    issues.push(`${path} completed job requires only a card and terminal time`);
  }
  if (job.state === 'failed' &&
      (job.terminalAt === null || job.errorCode === null || job.card !== null)) {
    issues.push(`${path} failed job requires only a safe error and terminal time`);
  }
  if (job.state === 'cancelled' &&
      (job.terminalAt === null || job.errorCode !== 'QUERY_CANCELLED' || job.card !== null)) {
    issues.push(`${path} cancelled job requires QUERY_CANCELLED and no card`);
  }
  if (job.card !== null) {
    if (job.card.jobId !== job.jobId || job.card.submissionId !== job.submissionId ||
        job.card.operationRef !== job.operationRef) {
      issues.push(`${path}.card identity does not match the job`);
    }
    if (job.card.provenance.profileId !== job.profileId) {
      issues.push(`${path}.card provenance profile does not match the job`);
    }
    issues.push(...validateFinancialCardSemantics(job.card, `${path}.card`));
  }
  return issues;
}

function validateFinancialResponseSemantics(response) {
  const issues = [];
  const { method, result } = response;
  if (method === 'source.credentials.status') {
    result.profiles.forEach((profile, index) => {
      issues.push(...validateCredentialProfileSemantics(profile, `$.result.profiles[${index}]`));
    });
    if (result.mutation !== null) {
      issues.push(...validateCredentialMutationSemantics(result.mutation, '$.result.mutation'));
    }
  } else if (method === 'source.credentials.configure') {
    issues.push(...validateCredentialMutationSemantics(result.mutation, '$.result.mutation'));
    if (result.mutation.kind !== 'configure') {
      issues.push('$.result.mutation.kind must be configure for source.credentials.configure');
    }
  } else if (method === 'source.credentials.delete') {
    issues.push(...validateCredentialMutationSemantics(result.mutation, '$.result.mutation'));
    if (result.mutation.kind !== 'delete') {
      issues.push('$.result.mutation.kind must be delete for source.credentials.delete');
    }
  } else if (method === 'source.query.start') {
    issues.push(...validateQueryJobSemantics(result.job, '$.result.job'));
    if (result.job.parentJobId !== null) {
      issues.push('$.result.job.parentJobId must be null for source.query.start');
    }
  } else if (method === 'source.query.status') {
    issues.push(...validateQueryJobSemantics(result.job, '$.result.job'));
  } else if (method === 'source.query.continue') {
    issues.push(...validateQueryJobSemantics(result.job, '$.result.job'));
    if (result.job.parentJobId === null) {
      issues.push('$.result.job.parentJobId is required for source.query.continue');
    }
  } else if (method === 'source.query.page') {
    if (result.card.jobId !== result.jobId) {
      issues.push('$.result.card.jobId must match $.result.jobId');
    }
    issues.push(...validateFinancialCardSemantics(result.card, '$.result.card'));
  } else if (method === 'source.query.cancel') {
    issues.push(...validateQueryJobSemantics(result.job, '$.result.job'));
    const allowedState = result.accepted
      ? ['cancelling', 'cancelled'].includes(result.job.state)
      : ['completed', 'failed', 'cancelled'].includes(result.job.state);
    if (!allowedState) {
      issues.push('$.result.accepted is inconsistent with the cancelled job lifecycle');
    }
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
    'sourceArgumentJsonSchema',
    'sourceArgumentField',
    'conversationRouteResult',
    'financialCardPage',
    'queryJobSnapshot',
    'credentialProfileSummary',
    'credentialMutation',
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
      const request = validate('request', value);
      const issues = validateProviderRequestSemantics(request);
      if (issues.length > 0) throw new ProtocolValidationError(issues);
      return request;
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
      if (response.ok === true && FINANCIAL_METHODS.includes(response.method)) {
        const issues = validateFinancialResponseSemantics(response);
        if (issues.length > 0) throw new ProtocolValidationError(issues);
      }
      if (PROVIDER_METHODS.includes(response.method)) {
        const issues = validateProviderResponseSemantics(response);
        if (issues.length > 0) throw new ProtocolValidationError(issues);
      }
      if (response.ok === false && FINANCIAL_METHODS.includes(response.method)) {
        const expectedMessage = FINANCIAL_ERROR_MESSAGES[response.error.code];
        if (expectedMessage === undefined || response.error.message !== expectedMessage) {
          throw new ProtocolValidationError([
            '$.error must use an approved financial code and constant message',
          ]);
        }
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
