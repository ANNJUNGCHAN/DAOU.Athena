import { compileTaskInput, normalizeTaskInput } from '../task-compiler.mjs';

export const ASSISTANT_TEXT_MAX_SCALARS = 4_096;
export const ASSISTANT_TEXT_MAX_BYTES = 8_192;
export const PROPOSAL_TEXT_MAX_SCALARS = 512;
export const PROPOSAL_TEXT_MAX_BYTES = 2_048;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function assertBoundedUnicodeText(value, {
  code,
  maxScalars,
  maxBytes,
  requireTrimmed = true,
} = {}) {
  if (typeof value !== 'string' || value.length === 0) fail(code);
  if (hasUnpairedSurrogate(value)) fail(code);
  if (requireTrimmed && value.trim() !== value) fail(code);
  if (value.trim().length === 0) fail(code);
  if (Array.from(value).length > maxScalars) fail(code);
  if (Buffer.byteLength(value, 'utf8') > maxBytes) fail(code);
  return value;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length
    && expected.slice().sort().every((key, index) => keys[index] === key);
}

function normalizeCatalog(offeredCatalog) {
  if (!Array.isArray(offeredCatalog)) fail('CONTROL_CANDIDATE_CATALOG_INVALID');
  const catalog = new Set();
  for (const entry of offeredCatalog) {
    if (typeof entry !== 'string') fail('CONTROL_CANDIDATE_CATALOG_INVALID');
    catalog.add(entry);
  }
  return catalog;
}

export function parseControlCandidate(completedText, { offeredCatalog } = {}) {
  assertBoundedUnicodeText(completedText, {
    code: 'CONTROL_CANDIDATE_RESPONSE_INVALID',
    maxScalars: ASSISTANT_TEXT_MAX_BYTES,
    maxBytes: ASSISTANT_TEXT_MAX_BYTES,
    requireTrimmed: false,
  });

  let parsed;
  try {
    parsed = JSON.parse(completedText);
  } catch {
    fail('CONTROL_CANDIDATE_RESPONSE_INVALID');
  }
  if (!exactKeys(parsed, ['assistantText', 'proposal'])) {
    fail('CONTROL_CANDIDATE_RESPONSE_INVALID');
  }

  const assistantText = assertBoundedUnicodeText(parsed.assistantText, {
    code: 'CONTROL_CANDIDATE_ASSISTANT_TEXT_INVALID',
    maxScalars: ASSISTANT_TEXT_MAX_SCALARS,
    maxBytes: ASSISTANT_TEXT_MAX_BYTES,
  });

  if (parsed.proposal === null) {
    return Object.freeze({ assistantText, proposal: null });
  }
  if (!exactKeys(parsed.proposal, ['kind', 'text'])
    || parsed.proposal.kind !== 'wts-control') {
    fail('CONTROL_CANDIDATE_PROPOSAL_INVALID');
  }

  const proposalText = assertBoundedUnicodeText(parsed.proposal.text, {
    code: 'CONTROL_CANDIDATE_PROPOSAL_INVALID',
    maxScalars: PROPOSAL_TEXT_MAX_SCALARS,
    maxBytes: PROPOSAL_TEXT_MAX_BYTES,
  });
  const catalog = normalizeCatalog(offeredCatalog);
  if (!catalog.has(proposalText)) fail('CONTROL_CANDIDATE_NOT_OFFERED');
  if (normalizeTaskInput(proposalText) !== proposalText) {
    fail('CONTROL_CANDIDATE_PROPOSAL_INVALID');
  }
  if (!compileTaskInput(proposalText)) fail('CONTROL_CANDIDATE_PROPOSAL_INVALID');

  const proposal = Object.freeze({ kind: 'wts-control', text: proposalText });
  return Object.freeze({ assistantText, proposal });
}
