import { randomUUID } from 'node:crypto';

import {
  BACKEND_API_VERSION,
  BACKEND_PROFILE,
  BackendSupervisorError,
} from './backend-supervisor.mjs';

const NOTICE = '기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.';
const MAX_CANVAS_BYTES = 120 * 1024;
const CATALOG_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OPERATION_REF_PATTERN = /^(?:base:[a-z0-9]+|detail:[a-z0-9]+:[a-z0-9_]+)$/u;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const ARGUMENT_FIELD_PATTERN = /^[a-z0-9][a-z0-9_]{0,127}$/u;
const RESPONSE_FIELD_PATTERN = /^[a-z0-9][A-Za-z0-9_]{0,127}$/u;
const EXECUTION_POLICIES = new Set([
  'selector_query', 'selector_detail', 'selector_detail_required',
]);

export class SourceBridgeError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'SourceBridgeError';
    this.code = code;
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new SourceBridgeError('SOURCE_REQUEST_INVALID', `${label} has an invalid shape.`);
  }
}

function catalogVersion(value, label = 'Catalog version') {
  if (typeof value !== 'string' || !CATALOG_PATTERN.test(value)) {
    throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', `${label} is invalid.`);
  }
  return value;
}

function expectedCatalogVersion(value) {
  if (typeof value !== 'string' || !CATALOG_PATTERN.test(value)) {
    throw new SourceBridgeError('SOURCE_REQUEST_INVALID', 'Expected catalog version is invalid.');
  }
  return value;
}

function operationRef(value) {
  if (typeof value !== 'string' || value.length > 128 || !OPERATION_REF_PATTERN.test(value)) {
    throw new SourceBridgeError('SOURCE_REQUEST_INVALID', 'Operation reference is invalid.');
  }
  return value;
}

function responseOperationRef(value) {
  try {
    return operationRef(value);
  } catch (error) {
    throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', 'Backend operation reference is invalid.', {
      cause: error,
    });
  }
}

function text(value, maximum, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length < 1) {
    throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', `${label} is invalid.`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', `${label} is invalid.`);
  }
  if (value.length > maximum) {
    throw new SourceBridgeError('SOURCE_RESPONSE_TOO_LARGE', `${label} exceeds its bounded length.`);
  }
  return value;
}

function denseArray(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', `${label} is invalid.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', `${label} is invalid.`);
    }
  }
  return value;
}

function boundedCanvas(value) {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_CANVAS_BYTES) {
    throw new SourceBridgeError('SOURCE_RESPONSE_TOO_LARGE', 'Source canvas exceeds its frame budget.');
  }
  return value;
}

function identifier(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', `${label} is invalid.`);
  }
  return value;
}

function assertQueryHit(hit) {
  if (!hit || typeof hit !== 'object' || Array.isArray(hit) || hit.kind !== 'query') {
    throw new SourceBridgeError('SOURCE_NON_QUERY_RESULT', 'Backend returned a non-query operation.');
  }
  return {
    operationRef: responseOperationRef(hit.operation_ref),
    kind: 'query',
    domain: identifier(hit.domain, 'Operation domain'),
    name: text(hit.name, 160, 'Operation name'),
    groupTitle: text(hit.group_title, 160, 'Operation group title', { nullable: true }),
  };
}

function detailField(field) {
  if (!field || typeof field !== 'object' || Array.isArray(field) ||
      typeof field.alias !== 'string' || field.alias.length > 128 ||
      !RESPONSE_FIELD_PATTERN.test(field.alias) ||
      typeof field.required !== 'boolean') {
    throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', 'Operation field metadata is invalid.');
  }
  return {
    alias: field.alias,
    description: text(field.description, 1_000, 'Operation field description', { nullable: true }),
    required: field.required,
  };
}

function responseExactKeys(value, required, optional, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', `${label} is invalid.`);
  }
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !allowed.has(key))) {
    throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', `${label} is invalid.`);
  }
}

function schemaMetadata(value, label) {
  if (value === undefined) return;
  text(value, 1_000, label);
}

function detailArgumentJsonSchema(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', 'Argument JSON schema is invalid.');
  }
  if (Object.hasOwn(value, 'type')) {
    responseExactKeys(value, ['type'], ['description', 'title'], 'Argument JSON schema');
    if (value.type !== 'string') {
      throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', 'Argument JSON schema is invalid.');
    }
    schemaMetadata(value.description, 'Argument schema description');
    schemaMetadata(value.title, 'Argument schema title');
    return { type: 'string' };
  }

  responseExactKeys(
    value,
    ['anyOf', 'default'],
    ['description', 'title'],
    'Argument JSON schema',
  );
  schemaMetadata(value.description, 'Argument schema description');
  schemaMetadata(value.title, 'Argument schema title');
  if (value.default !== null || !Array.isArray(value.anyOf) || value.anyOf.length !== 2) {
    throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', 'Argument JSON schema is invalid.');
  }
  const branchTypes = value.anyOf.map((branch) => {
    responseExactKeys(branch, ['type'], [], 'Argument JSON schema branch');
    if (branch.type !== 'string' && branch.type !== 'null') {
      throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', 'Argument JSON schema is invalid.');
    }
    return branch.type;
  });
  if (new Set(branchTypes).size !== 2 || !branchTypes.includes('string') ||
      !branchTypes.includes('null')) {
    throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', 'Argument JSON schema is invalid.');
  }
  return {
    anyOf: [{ type: 'string' }, { type: 'null' }],
    default: null,
  };
}

function detailArgumentField(field, expectedRequired) {
  responseExactKeys(
    field,
    ['alias', 'description', 'json_schema', 'required'],
    [],
    'Operation argument metadata',
  );
  if (!field || typeof field !== 'object' || Array.isArray(field) ||
      typeof field.alias !== 'string' || field.alias.length > 128 ||
      !ARGUMENT_FIELD_PATTERN.test(field.alias) || field.required !== expectedRequired ||
      !Object.hasOwn(field, 'json_schema')) {
    throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', 'Operation argument metadata is invalid.');
  }
  return {
    alias: field.alias,
    description: text(
      field.description,
      1_000,
      'Operation argument description',
      { nullable: true },
    ),
    required: field.required,
    jsonSchema: detailArgumentJsonSchema(field.json_schema),
  };
}

function boundedFields(value, maximum, label) {
  return denseArray(value, maximum, label).map(detailField);
}

function boundedArgumentFields(value, maximum, label, expectedRequired) {
  return denseArray(value, maximum, label).map((field) =>
    detailArgumentField(field, expectedRequired));
}

function detailCanvas(value, expected, identity) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.kind !== 'query') {
    throw new SourceBridgeError('SOURCE_NON_QUERY_RESULT', 'Backend returned a non-query operation.');
  }
  const catalog = catalogVersion(value.catalog_version);
  if (catalog !== expected) {
    throw new SourceBridgeError('SOURCE_CATALOG_CHANGED', 'Source catalog changed; refresh the manifest.');
  }
  const ref = responseOperationRef(value.operation_ref);
  if (!EXECUTION_POLICIES.has(value.execution_policy)) {
    throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', 'Operation execution policy is invalid.');
  }
  const name = text(value.name, 160, 'Operation name');
  return boundedCanvas({
    ...identity(catalog, 'capability-detail', name),
    operationRef: ref,
    domain: identifier(value.domain, 'Operation domain'),
    name,
    executionPolicy: value.execution_policy,
    requiredArguments: boundedArgumentFields(
      value.required_arguments,
      64,
      'Required arguments',
      true,
    ),
    optionalArguments: boundedArgumentFields(
      value.optional_arguments,
      64,
      'Optional arguments',
      false,
    ),
    responseFields: boundedFields(value.response_fields, 128, 'Response fields'),
    execution: { available: false, reason: 'FINANCIAL_QUERY_NOT_CONNECTED' },
  });
}

function wrapBackendError(error) {
  if (error instanceof SourceBridgeError) return error;
  if (error instanceof BackendSupervisorError) {
    return new SourceBridgeError(error.code, error.message);
  }
  return new SourceBridgeError('SOURCE_BACKEND_FAILED', 'Local read-only source failed.');
}

export class SourceBridge {
  constructor(supervisor, { now = Date.now, createId = randomUUID } = {}) {
    if (!supervisor || typeof supervisor.request !== 'function' ||
        typeof supervisor.ensure !== 'function' || typeof supervisor.status !== 'function') {
      throw new SourceBridgeError('SOURCE_CONFIG_INVALID', 'A backend supervisor is required.');
    }
    this.supervisor = supervisor;
    this.now = now;
    this.createId = createId;
  }

  #identity(catalog, kind, title) {
    const timestamp = this.now();
    if (!Number.isInteger(timestamp)) {
      throw new SourceBridgeError('SOURCE_CLOCK_INVALID', 'Source timestamp is invalid.');
    }
    const instant = new Date(timestamp);
    if (!Number.isFinite(instant.getTime())) {
      throw new SourceBridgeError('SOURCE_CLOCK_INVALID', 'Source timestamp is invalid.');
    }
    const fetchedAt = instant.toISOString();
    const canvasId = this.createId();
    if (typeof canvasId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(canvasId)) {
      throw new SourceBridgeError('SOURCE_ID_INVALID', 'Source canvas id is invalid.');
    }
    return {
      schemaVersion: 1,
      kind,
      canvasId,
      title: text(title, 160, 'Canvas title'),
      catalogVersion: catalogVersion(catalog),
      fetchedAt,
      notice: NOTICE,
    };
  }

  async execute(operation, input = {}, options = {}) {
    try {
      switch (operation) {
        case 'health':
          exactKeys(input, [], 'Health request');
          return this.#health(options);
        case 'capabilities':
          exactKeys(input, [], 'Capabilities request');
          return this.#capabilities(options);
        case 'manifest':
          exactKeys(input, [], 'Manifest request');
          return this.#manifest(options);
        case 'search':
          return this.#search(input, options);
        case 'describe':
          return this.#describe(input, options);
        default:
          throw new SourceBridgeError('SOURCE_OPERATION_NOT_ALLOWED', 'Source operation is not allowed.');
      }
    } catch (error) {
      throw wrapBackendError(error);
    }
  }

  async #health(options) {
    const value = await this.supervisor.request('health', undefined, options);
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.status !== 'ok' || value.profile !== BACKEND_PROFILE) {
      throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', 'Backend health response is invalid.');
    }
    return { status: 'ok', profile: BACKEND_PROFILE };
  }

  async #capabilities(options) {
    const value = await this.supervisor.request('capabilities', undefined, options);
    const expected = {
      profile: BACKEND_PROFILE,
      apiVersion: BACKEND_API_VERSION,
      catalog: true,
      search: true,
      describe: true,
      financialQuery: false,
      credentials: false,
      externalAi: false,
      jobs: false,
      order: false,
      websocket: false,
      canvasKinds: ['capability-list.v1', 'capability-detail.v1'],
    };
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== Object.keys(expected).sort().join(',') ||
        Object.entries(expected).some(([key, expectedValue]) =>
          JSON.stringify(value[key]) !== JSON.stringify(expectedValue))) {
      throw new SourceBridgeError('SOURCE_CAPABILITY_MISMATCH', 'Backend capabilities are not read-only.');
    }
    return expected;
  }

  async #manifest(options) {
    const value = await this.supervisor.request('manifest', undefined, options);
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.profile !== BACKEND_PROFILE || value.apiVersion !== BACKEND_API_VERSION ||
        !Array.isArray(value.operations)) {
      throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', 'Backend manifest is invalid.');
    }
    const catalog = catalogVersion(value.catalogVersion);
    for (const operation of denseArray(value.operations, 10_000, 'Manifest operations')) {
      assertQueryHit(operation);
    }
    return {
      profile: BACKEND_PROFILE,
      apiVersion: BACKEND_API_VERSION,
      catalogVersion: catalog,
      operationCount: value.operations.length,
    };
  }

  async #search(input, options) {
    exactKeys(input, ['expectedCatalogVersion', 'limit', 'query'], 'Search request');
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (query.length < 2 || query.length > 500 ||
        /[\u0000-\u001f\u007f]/u.test(query) ||
        !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 5) {
      throw new SourceBridgeError('SOURCE_REQUEST_INVALID', 'Search query or limit is invalid.');
    }
    const expected = expectedCatalogVersion(input.expectedCatalogVersion);
    const value = await this.supervisor.request('search', {
      query,
      limit: input.limit,
    }, options);
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !Array.isArray(value.results) || value.results.length > input.limit) {
      throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', 'Backend search response is invalid.');
    }
    const actual = catalogVersion(value.catalog_version);
    if (actual !== expected) {
      throw new SourceBridgeError('SOURCE_CATALOG_CHANGED', 'Source catalog changed; refresh the manifest.');
    }
    const items = denseArray(value.results, input.limit, 'Search results').map(assertQueryHit);
    return boundedCanvas({
      ...this.#identity(actual, 'capability-list', '조회 기능 찾기'),
      query,
      items,
    });
  }

  async #describe(input, options) {
    exactKeys(input, ['expectedCatalogVersion', 'operationRef'], 'Describe request');
    const ref = operationRef(input.operationRef);
    const expected = expectedCatalogVersion(input.expectedCatalogVersion);
    const value = await this.supervisor.request('describe', { operation_ref: ref }, options);
    const canvas = detailCanvas(value, expected, (...args) => this.#identity(...args));
    if (canvas.operationRef !== ref) {
      throw new SourceBridgeError('SOURCE_RESPONSE_INVALID', 'Backend described a different operation.');
    }
    return canvas;
  }
}

export const SOURCE_OPERATIONS = Object.freeze([
  'health', 'capabilities', 'manifest', 'search', 'describe',
]);

