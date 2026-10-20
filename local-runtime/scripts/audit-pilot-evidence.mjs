import { open, lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CHART_OPEN_ACTION_ID,
  CHART_PERIOD_SET_ACTION_ID,
  CONTROL_CATALOG_VERSION,
  LEGACY_CONTROL_CATALOG_VERSION,
  PREVIOUS_CONTROL_CATALOG_VERSION,
  createProtocolValidator,
} from '../../contracts/wts-foundation.mjs';

const MAX_RECORDS = 10_000;
const MAX_RECORD_BYTES = 128 * 1024;
const MAX_OWNED_TEMP_FILES = 1_024;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_FILE_PATTERN = new RegExp(`^${UUID}\\.json$`, 'iu');
const UUID_VALUE_PATTERN = new RegExp(`^${UUID}$`, 'iu');
const OWNED_TEMP_PATTERN = new RegExp(`^\\.${UUID}\\.\\d+-\\d+-[0-9a-f]{12}\\.tmp$`, 'iu');
const SAME_CONTEXT_KEYS = ['origin', 'path', 'frameId', 'tabId', 'windowId', 'documentId'];

const schema = JSON.parse(await readFile(
  new URL('../../contracts/wts-foundation.protocol.schema.json', import.meta.url),
  'utf8',
));
const validator = createProtocolValidator(schema);

function diagnosticCollector() {
  const counts = new Map();
  return {
    add(code, scope) {
      const key = `${scope}:${code}`;
      const current = counts.get(key) ?? { code, scope, count: 0 };
      current.count += 1;
      counts.set(key, current);
    },
    list() {
      return [...counts.values()].sort((left, right) => (
        left.scope.localeCompare(right.scope) || left.code.localeCompare(right.code)
      ));
    },
  };
}

function validTime(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour = '00', offsetMinute = '00'] = match;
  const [y, m, d, h, min, sec, oh, om] =
    [year, month, day, hour, minute, second, offsetHour, offsetMinute].map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth && h <= 23 && min <= 59 &&
    sec <= 59 && oh <= 23 && om <= 59 && Number.isFinite(Date.parse(value));
}

function validateCaptureSemantics(capture) {
  if (!validTime(capture.capturedAt)) return false;
  const first = capture.observations[0];
  const frameIds = new Set();
  const identities = new Set();
  let topFrames = 0;
  for (const observation of capture.observations) {
    if (!validTime(observation.capturedAt) || observation.capturedAt !== capture.capturedAt) return false;
    if (observation.source.tabId !== first.source.tabId ||
        observation.source.windowId !== first.source.windowId) return false;
    if (frameIds.has(observation.source.frameId)) return false;
    frameIds.add(observation.source.frameId);
    const identity = JSON.stringify([
      observation.source.tabId,
      observation.source.windowId,
      observation.source.frameId,
      observation.source.documentId,
    ]);
    if (identities.has(identity)) return false;
    identities.add(identity);
    if (observation.source.frameId === 0) topFrames += 1;
  }
  return topFrames === 1;
}

async function inspectDirectory(directory, scope, validate, diagnostics) {
  let directoryStat;
  try {
    directoryStat = await lstat(directory);
  } catch (error) {
    diagnostics.add(error?.code === 'ENOENT' ? 'EXPECTED_DIRECTORY_MISSING' : 'DIRECTORY_UNREADABLE', scope);
    return [];
  }
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    diagnostics.add('DIRECTORY_NOT_REGULAR', scope);
    return [];
  }

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    diagnostics.add('DIRECTORY_UNREADABLE', scope);
    return [];
  }
  let ownedTempCount = 0;
  const recordNames = [];
  for (const entry of entries) {
    if (entry.isFile() && UUID_FILE_PATTERN.test(entry.name)) {
      recordNames.push(entry.name);
    } else if (entry.isFile() && OWNED_TEMP_PATTERN.test(entry.name)) {
      ownedTempCount += 1;
    } else {
      diagnostics.add('UNKNOWN_DIRECTORY_ENTRY', scope);
    }
  }
  if (ownedTempCount > 0) diagnostics.add('OWNED_TEMP_FILE_PRESENT', scope);
  if (recordNames.length > MAX_RECORDS) diagnostics.add('RECORD_COUNT_LIMIT_EXCEEDED', scope);
  if (ownedTempCount > MAX_OWNED_TEMP_FILES) diagnostics.add('TEMP_FILE_COUNT_LIMIT_EXCEEDED', scope);
  if (recordNames.length > MAX_RECORDS) return [];

  const records = [];
  for (const name of recordNames) {
    const filePath = path.join(directory, name);
    let handle;
    try {
      const linkStat = await lstat(filePath);
      if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
        diagnostics.add('RECORD_NOT_REGULAR', scope);
        continue;
      }
      if (linkStat.size > MAX_RECORD_BYTES) {
        diagnostics.add('RECORD_SIZE_LIMIT_EXCEEDED', scope);
        continue;
      }
      handle = await open(filePath, 'r');
      const before = await handle.stat();
      if (!before.isFile() || before.size > MAX_RECORD_BYTES) {
        diagnostics.add('RECORD_NOT_BOUNDED', scope);
        continue;
      }
      const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (offset > MAX_RECORD_BYTES) {
        diagnostics.add('RECORD_SIZE_LIMIT_EXCEEDED', scope);
        continue;
      }
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || offset !== after.size) {
        diagnostics.add('RECORD_CHANGED_DURING_READ', scope);
        continue;
      }
      let record;
      try {
        record = JSON.parse(buffer.subarray(0, offset).toString('utf8'));
        validate(record);
      } catch {
        diagnostics.add('RECORD_INVALID', scope);
        continue;
      }
      const expectedName = `${record.id}.json`.toLowerCase();
      const eligible = UUID_VALUE_PATTERN.test(record.id) && name.toLowerCase() === expectedName;
      if (!eligible) {
        diagnostics.add('RECORD_ID_MISMATCH', scope);
      }
      records.push({ record, eligible });
    } catch {
      diagnostics.add('RECORD_UNREADABLE', scope);
    } finally {
      await handle?.close().catch(() => {});
    }
  }
  return records;
}

function assessReceipt(receipt) {
  const { before, after } = receipt;
  const beforeTime = validTime(before.capturedAt) ? Date.parse(before.capturedAt) : Number.NaN;
  const completedTime = validTime(receipt.completedAt) ? Date.parse(receipt.completedAt) : Number.NaN;
  const afterTime = after && validTime(after.capturedAt) ? Date.parse(after.capturedAt) : null;
  const invalidTime = !Number.isFinite(beforeTime) || !Number.isFinite(completedTime) ||
    beforeTime > completedTime || (after !== null && (
      !Number.isFinite(afterTime) || beforeTime > afterTime || afterTime > completedTime
    ));
  if (invalidTime) {
    return {
      proof: null, validVerified: false, invalidVerified: false,
      invalidRecord: true, invalidOutcome: false,
    };
  }
  const hasAfter = after !== null;
  const validOutcome = (
    receipt.status === 'verified' && receipt.reason === 'POSTCONDITION_MET' && hasAfter
  ) || (
    receipt.status === 'cancelled' && receipt.reason === 'CANCELLED' && !hasAfter
  ) || (
    receipt.status === 'blocked' && (
      (receipt.reason === 'PRECONDITION_CHANGED' && hasAfter) ||
      (['DOCUMENT_CHANGED', 'EXECUTION_ERROR'].includes(receipt.reason) && !hasAfter)
    )
  ) || (
    receipt.status === 'unverified' && (
      (['DOCUMENT_CHANGED', 'EXECUTION_ERROR'].includes(receipt.reason) && !hasAfter) ||
      (['PRECONDITION_CHANGED', 'POSTCONDITION_TIMEOUT', 'EXECUTION_ERROR'].includes(receipt.reason) && hasAfter)
    )
  );
  if (!validOutcome) {
    return {
      proof: null, validVerified: false, invalidVerified: false,
      invalidRecord: false, invalidOutcome: true,
    };
  }
  if (receipt.status !== 'verified') {
    return {
      proof: null, validVerified: false, invalidVerified: false,
      invalidRecord: false, invalidOutcome: false,
    };
  }
  if (!after) {
    return {
      proof: null, validVerified: false, invalidVerified: true,
      invalidRecord: false, invalidOutcome: false,
    };
  }
  const sameContext = SAME_CONTEXT_KEYS.every((key) => before.source[key] === after.source[key]);
  if (!sameContext || before.state.instrumentToken !== after.state.instrumentToken ||
      before.state.blocked || after.state.blocked) {
    return {
      proof: null, validVerified: false, invalidVerified: true,
      invalidRecord: false, invalidOutcome: false,
    };
  }

  if (receipt.catalogVersion === CONTROL_CATALOG_VERSION) {
    return {
      proof: null, validVerified: true, nonApplicableVerified: true,
      invalidVerified: false, invalidRecord: false, invalidOutcome: false,
    };
  }

  if (receipt.actionId === CHART_OPEN_ACTION_ID &&
      Object.keys(receipt.args).length === 0 &&
      before.state.screenId === 'main-other' &&
      !['chart', 'unknown'].includes(before.state.activeTab) &&
      before.state.chartOpenEnabled === true &&
      after.state.screenId === 'main-chart' && after.state.activeTab === 'chart') {
    return {
      proof: 'chartOpen', validVerified: true, invalidVerified: false,
      invalidRecord: false, invalidOutcome: false,
    };
  }
  const allowedPeriods = receipt.catalogVersion === LEGACY_CONTROL_CATALOG_VERSION
    ? ['day', 'week']
    : receipt.catalogVersion === PREVIOUS_CONTROL_CATALOG_VERSION
      ? ['day', 'week', 'month', 'year']
      : [];
  if (receipt.actionId === CHART_PERIOD_SET_ACTION_ID &&
      allowedPeriods.includes(receipt.args.period) &&
      before.state.screenId === 'main-chart' && before.state.activeTab === 'chart' &&
      before.state.periodEnabled === true && before.state.period !== receipt.args.period &&
      after.state.screenId === 'main-chart' && after.state.activeTab === 'chart' &&
      after.state.period === receipt.args.period) {
    if (before.state.period === 'day' && receipt.args.period === 'week') {
      return {
        proof: 'dayToWeek', validVerified: true, invalidVerified: false,
        invalidRecord: false, invalidOutcome: false,
      };
    }
    if (before.state.period === 'week' && receipt.args.period === 'day') {
      return {
        proof: 'weekToDay', validVerified: true, invalidVerified: false,
        invalidRecord: false, invalidOutcome: false,
      };
    }
    if (receipt.catalogVersion === PREVIOUS_CONTROL_CATALOG_VERSION && receipt.args.period === 'month') {
      return {
        proof: 'toMonth', validVerified: true, invalidVerified: false,
        invalidRecord: false, invalidOutcome: false,
      };
    }
    if (receipt.catalogVersion === PREVIOUS_CONTROL_CATALOG_VERSION && receipt.args.period === 'year') {
      return {
        proof: 'toYear', validVerified: true, invalidVerified: false,
        invalidRecord: false, invalidOutcome: false,
      };
    }
    return {
      proof: null, validVerified: true, invalidVerified: false,
      invalidRecord: false, invalidOutcome: false,
    };
  }
  return {
    proof: null, validVerified: false, invalidVerified: true,
    invalidRecord: false, invalidOutcome: false,
  };
}

export async function auditPilotEvidence(dataDir) {
  const diagnostics = diagnosticCollector();
  if (typeof dataDir !== 'string' || dataDir.length === 0) {
    diagnostics.add('DATA_DIRECTORY_REQUIRED', 'root');
  }
  let rootUsable = typeof dataDir === 'string' && dataDir.length > 0;
  if (rootUsable) {
    try {
      const rootStat = await lstat(dataDir);
      rootUsable = rootStat.isDirectory() && !rootStat.isSymbolicLink();
      if (!rootUsable) diagnostics.add('DATA_DIRECTORY_NOT_REGULAR', 'root');
    } catch (error) {
      rootUsable = false;
      diagnostics.add(error?.code === 'ENOENT' ? 'DATA_DIRECTORY_MISSING' : 'DATA_DIRECTORY_UNREADABLE', 'root');
    }
  }

  const captureEntries = rootUsable
    ? await inspectDirectory(path.join(dataDir, 'captures'), 'captures', (record) => {
      validator.validateCapture(record);
      if (!validateCaptureSemantics(record)) throw new Error('invalid');
    }, diagnostics)
    : [];
  const receiptEntries = rootUsable
    ? await inspectDirectory(path.join(dataDir, 'receipts'), 'receipts', validator.validateControlReceipt, diagnostics)
    : [];
  const captures = captureEntries.filter(({ eligible }) => eligible).map(({ record }) => record);
  const receipts = receiptEntries.filter(({ eligible }) => eligible).map(({ record }) => record);
  if (rootUsable && captures.length === 0) diagnostics.add('NO_CAPTURE_RECORDS', 'captures');
  if (rootUsable && receipts.length === 0) diagnostics.add('NO_RECEIPT_RECORDS', 'receipts');

  const receiptIds = new Map();
  const proposalGroups = new Map();
  for (const { record: receipt } of receiptEntries) {
    const receiptKey = receipt.id.toLowerCase();
    const proposalKey = receipt.proposalId.toLowerCase();
    receiptIds.set(receiptKey, (receiptIds.get(receiptKey) ?? 0) + 1);
    const group = proposalGroups.get(proposalKey) ?? [];
    group.push(receipt);
    proposalGroups.set(proposalKey, group);
  }
  const quarantinedReceiptIds = new Set();
  for (const [id, count] of receiptIds) {
    if (count > 1) {
      diagnostics.add('DUPLICATE_RECEIPT_ID', 'receipts');
      quarantinedReceiptIds.add(id);
    }
  }
  for (const group of proposalGroups.values()) {
    if (group.length > 1) {
      diagnostics.add('DUPLICATE_PROPOSAL_ID', 'receipts');
      for (const receipt of group) quarantinedReceiptIds.add(receipt.id.toLowerCase());
    }
  }

  const happyPathCoverage = { chartOpen: false, dayToWeek: false, weekToDay: false };
  const currentCatalogCoverage = {
    chartOpen: false,
    dayToWeek: false,
    weekToDay: false,
    toMonth: false,
    toYear: false,
  };
  let verifiedReceiptCount = 0;
  let nonVerifiedReceiptCount = 0;
  let nonApplicableVerifiedReceiptCount = 0;
  for (const receipt of receipts) {
    if (quarantinedReceiptIds.has(receipt.id.toLowerCase())) continue;
    const {
      proof, validVerified, nonApplicableVerified,
      invalidVerified, invalidRecord, invalidOutcome,
    } =
      assessReceipt(receipt);
    if (invalidRecord) diagnostics.add('RECEIPT_TIME_INVALID', 'receipts');
    if (invalidOutcome) diagnostics.add('RECEIPT_OUTCOME_INVALID', 'receipts');
    if (invalidVerified) diagnostics.add('VERIFIED_RECEIPT_PROOF_INVALID', 'receipts');
    if (validVerified) verifiedReceiptCount += 1;
    if (nonApplicableVerified) nonApplicableVerifiedReceiptCount += 1;
    if (proof) {
      if (receipt.catalogVersion === LEGACY_CONTROL_CATALOG_VERSION) {
        happyPathCoverage[proof] = true;
      } else if (receipt.catalogVersion === PREVIOUS_CONTROL_CATALOG_VERSION) {
        currentCatalogCoverage[proof] = true;
      }
    } else if (!validVerified && !invalidVerified && !invalidRecord && !invalidOutcome) {
      nonVerifiedReceiptCount += 1;
    }
  }

  const diagnosticList = diagnostics.list();
  const invalidCodes = new Set([
    'DATA_DIRECTORY_NOT_REGULAR', 'DATA_DIRECTORY_UNREADABLE', 'DIRECTORY_NOT_REGULAR',
    'DIRECTORY_UNREADABLE', 'UNKNOWN_DIRECTORY_ENTRY', 'RECORD_COUNT_LIMIT_EXCEEDED',
    'TEMP_FILE_COUNT_LIMIT_EXCEEDED', 'RECORD_NOT_REGULAR', 'RECORD_NOT_BOUNDED',
    'RECORD_SIZE_LIMIT_EXCEEDED', 'RECORD_CHANGED_DURING_READ', 'RECORD_INVALID',
    'RECORD_ID_MISMATCH', 'RECORD_UNREADABLE', 'DUPLICATE_RECEIPT_ID',
    'DUPLICATE_PROPOSAL_ID', 'VERIFIED_RECEIPT_PROOF_INVALID', 'RECEIPT_TIME_INVALID',
    'RECEIPT_OUTCOME_INVALID',
  ]);
  const invalid = diagnosticList.some(({ code }) => invalidCodes.has(code));
  const legacyComplete = Object.values(happyPathCoverage).every(Boolean);
  const currentComplete = Object.values(currentCatalogCoverage).every(Boolean);
  const complete = legacyComplete || currentComplete;
  const status = invalid ? 'invalid' : complete && diagnosticList.length === 0 ? 'pass' : 'incomplete';
  const exitCode = status === 'pass' ? 0 : status === 'incomplete' ? 1 : 2;

  return {
    audit: 'offline evidence audit',
    status,
    exitCode,
    captureCount: captures.length,
    observationCount: captures.reduce((sum, capture) => sum + capture.observations.length, 0),
    receiptCount: receipts.length,
    verifiedReceiptCount,
    nonVerifiedReceiptCount,
    nonApplicableVerifiedReceiptCount,
    quarantinedReceiptCount: quarantinedReceiptIds.size,
    diagnostics: diagnosticList,
    happyPathCoverage,
    currentCatalogCoverage,
    legacyComplete,
    currentComplete,
    overallWtsCoverage: 'partial',
    evidenceScope: 'saved-record-integrity-and-recorded-postconditions',
    behavioralReplay: false,
    browserExecutionIndependentlyProven: false,
    proposalProvenanceIndependentlyProven: false,
    userInstructionIndependentlyProven: false,
    trainingGold: false,
    trainingApproved: false,
    layaReady: false,
    liveFailureGuardsVerified: false,
  };
}

function parseDataDir(args) {
  if (args.length !== 2 || args[0] !== '--data-dir') return null;
  return args[1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = await auditPilotEvidence(parseDataDir(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.exitCode;
}
