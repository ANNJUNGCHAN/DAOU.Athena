import {
  PROPOSAL_TEXT_MAX_BYTES,
  PROPOSAL_TEXT_MAX_SCALARS,
  assertBoundedUnicodeText,
  parseControlCandidate,
} from './control-candidate.mjs';
import { compileTaskInput, normalizeTaskInput } from '../task-compiler.mjs';

export const MAX_CONTROL_CATALOG_ENTRIES = 100;
export const MAX_CONTROL_CATALOG_BYTES = 8_192;
export const USER_TEXT_MAX_SCALARS = 512;
export const USER_TEXT_MAX_BYTES = 2_048;
export const ACCIDENTAL_DISCLOSURE_PATTERN = /(?:비밀번호|인증번호|계좌번호|access[ _-]?token|refresh[ _-]?token|api[ _-]?key)|[0-9]{7,}/iu;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function validateControlCatalog(entries) {
  if (!Array.isArray(entries) || entries.length === 0
    || entries.length > MAX_CONTROL_CATALOG_ENTRIES) {
    fail('OPENAI_CONTROL_CATALOG_INVALID');
  }
  const deduplicated = [];
  const seen = new Set();
  for (const entry of entries) {
    assertBoundedUnicodeText(entry, {
      code: 'OPENAI_CONTROL_CATALOG_INVALID',
      maxScalars: PROPOSAL_TEXT_MAX_SCALARS,
      maxBytes: PROPOSAL_TEXT_MAX_BYTES,
    });
    if (normalizeTaskInput(entry) !== entry || !compileTaskInput(entry)) {
      fail('OPENAI_CONTROL_CATALOG_INVALID');
    }
    if (!seen.has(entry)) {
      seen.add(entry);
      deduplicated.push(entry);
    }
  }
  if (Buffer.byteLength(JSON.stringify(deduplicated), 'utf8') > MAX_CONTROL_CATALOG_BYTES) {
    fail('OPENAI_CONTROL_CATALOG_INVALID');
  }
  return Object.freeze(deduplicated);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export function createControlCandidateSchema(catalog) {
  return deepFreeze({
    type: 'object',
    additionalProperties: false,
    required: ['assistantText', 'proposal'],
    properties: {
      assistantText: { type: 'string', minLength: 1, maxLength: 4_096 },
      proposal: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'text'],
            properties: {
              kind: { type: 'string', const: 'wts-control' },
              text: { type: 'string', enum: [...catalog] },
            },
          },
        ],
      },
    },
  });
}

export function createPlanningInstructions(catalog) {
  return [
    '사용자의 문장을 해석해 JSON 스키마와 정확히 일치하는 객체 하나만 반환하세요.',
    'assistantText는 해석 또는 제안이며, 화면 동작이 이미 실행되었다고 말하지 마세요.',
    'proposal은 아래 허용 명령 중 정확히 하나가 적합할 때만 사용하고, 그 외에는 null로 두세요.',
    '코드, HTML, 선택자, URL, 셸 명령, 주문 또는 계정 작업을 만들지 마세요.',
    '허용 명령:',
    ...catalog.map((entry) => `- ${entry}`),
  ].join('\n');
}

export class PlanningClient {
  #responsesClient;
  #catalog;
  #instructions;
  #schema;
  #active = null;

  constructor({ responsesClient, catalog } = {}) {
    if (!responsesClient || typeof responsesClient.complete !== 'function'
      || typeof responsesClient.cancel !== 'function') {
      fail('OPENAI_PLANNING_CLIENT_INVALID');
    }
    this.#responsesClient = responsesClient;
    this.#catalog = validateControlCatalog(catalog);
    this.#instructions = createPlanningInstructions(this.#catalog);
    this.#schema = createControlCandidateSchema(this.#catalog);
  }

  cancel() {
    if (!this.#active || this.#active.accepted) return false;
    this.#active.cancelled = true;
    this.#responsesClient.cancel();
    return true;
  }

  async plan(userText) {
    if (this.#active) fail('OPENAI_PLANNING_BUSY');
    const inputText = assertBoundedUnicodeText(userText, {
      code: 'OPENAI_PLANNING_INPUT_INVALID',
      maxScalars: USER_TEXT_MAX_SCALARS,
      maxBytes: USER_TEXT_MAX_BYTES,
    });
    if (ACCIDENTAL_DISCLOSURE_PATTERN.test(inputText)) {
      fail('OPENAI_PLANNING_INPUT_SENSITIVE');
    }

    const active = { cancelled: false, accepted: false };
    this.#active = active;
    try {
      const completedText = await this.#responsesClient.complete({
        inputText,
        instructions: this.#instructions,
        schema: this.#schema,
      });
      if (active.cancelled) fail('OPENAI_PLANNING_CANCELLED');
      const result = parseControlCandidate(completedText, { offeredCatalog: this.#catalog });
      if (active.cancelled) fail('OPENAI_PLANNING_CANCELLED');
      active.accepted = true;
      return result;
    } finally {
      if (this.#active === active) this.#active = null;
    }
  }
}
