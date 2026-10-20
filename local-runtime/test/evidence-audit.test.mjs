import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { auditPilotEvidence } from '../scripts/audit-pilot-evidence.mjs';

const AUDIT_SCRIPT = fileURLToPath(new URL('../scripts/audit-pilot-evidence.mjs', import.meta.url));

const ORIGIN = 'https://wts.kiwoom.com';
const TOKEN = 'a'.repeat(64);
const CONTEXT = 'b'.repeat(64);
const BASE_TIME = Date.parse('2026-10-18T12:00:00.000Z');

function uuid(index) {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function controlObservation(index, state, at = BASE_TIME + index * 1_000) {
  return {
    id: uuid(index),
    capturedAt: new Date(at).toISOString(),
    source: {
      origin: ORIGIN, path: '/', tabId: 12, windowId: 3, frameId: 0, documentId: 'document-1',
    },
    state: {
      screenId: 'main-chart', activeTab: 'chart', period: 'day', blocked: false,
      chartOpenEnabled: true, periodEnabled: true, instrumentToken: TOKEN, contextToken: CONTEXT,
      ...state,
    },
  };
}

function receipt(index, kind, overrides = {}) {
  let actionId;
  let args;
  let beforeState;
  let afterState;
  if (kind === 'open') {
    actionId = 'wts.main.p3.chart.open';
    args = {};
    beforeState = { screenId: 'main-other', activeTab: 'quote', period: 'none', periodEnabled: false };
    afterState = { screenId: 'main-chart', activeTab: 'chart', period: 'day' };
  } else {
    actionId = 'wts.main.p3.chart.period.set';
    const target = { week: 'week', day: 'day', month: 'month', year: 'year' }[kind];
    const source = { week: 'day', day: 'week', month: 'week', year: 'month' }[kind];
    args = { period: target };
    beforeState = { period: source };
    afterState = { period: target };
  }
  const before = controlObservation(index * 2, beforeState, BASE_TIME + index * 10_000);
  const after = controlObservation(index * 2 + 1, afterState, BASE_TIME + index * 10_000 + 1_000);
  return {
    id: uuid(100 + index),
    proposalId: uuid(200 + index),
    catalogVersion: 'wts-chart-pilot-1',
    actionId,
    args,
    before,
    after,
    status: 'verified',
    reason: 'POSTCONDITION_MET',
    completedAt: new Date(BASE_TIME + index * 10_000 + 2_000).toISOString(),
    ...overrides,
  };
}

function currentReceipt(index, kind, overrides = {}) {
  return receipt(index, kind, { catalogVersion: 'wts-chart-pilot-2', ...overrides });
}

function catalog3ChartReceipt(index, overrides = {}) {
  return receipt(index, 'open', { catalogVersion: 'wts-main-control-3', ...overrides });
}

function marketObservation(index, state, at = BASE_TIME + index * 1_000) {
  return {
    id: uuid(index),
    capturedAt: new Date(at).toISOString(),
    source: {
      origin: ORIGIN, path: '/', tabId: 12, windowId: 3, frameId: 0, documentId: 'document-1',
    },
    state: {
      stateKind: 'market-navigation',
      screenId: 'main-market-navigation',
      targetId: 'market-menu-001',
      blocked: false,
      sitemapVisible: false,
      sitemapOpenEnabled: true,
      targetAvailable: false,
      activeTargetId: null,
      instrumentToken: TOKEN,
      contextToken: CONTEXT,
      ...state,
    },
  };
}

function catalog3MarketReceipt(index, overrides = {}) {
  const before = marketObservation(index * 2, {}, BASE_TIME + index * 10_000);
  const after = marketObservation(index * 2 + 1, {
    sitemapVisible: true,
    targetAvailable: true,
  }, BASE_TIME + index * 10_000 + 1_000);
  return {
    id: uuid(100 + index),
    proposalId: uuid(200 + index),
    catalogVersion: 'wts-main-control-3',
    actionId: 'wts.main.sitemap.open',
    args: { targetId: 'market-menu-001' },
    before,
    after,
    status: 'verified',
    reason: 'POSTCONDITION_MET',
    completedAt: new Date(BASE_TIME + index * 10_000 + 2_000).toISOString(),
    ...overrides,
  };
}

function capture(index = 1) {
  const capturedAt = new Date(BASE_TIME).toISOString();
  return {
    id: uuid(300 + index),
    capturedAt,
    observations: [{
      id: uuid(400 + index), capturedAt,
      source: { origin: ORIGIN, path: '/', tabId: 12, windowId: 3, frameId: 0, documentId: 'capture-document' },
      title: '', headings: [], controls: [], frames: [], canvasCount: 1, truncated: false,
    }],
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-evidence-audit-'));
  await mkdir(path.join(root, 'captures'));
  await mkdir(path.join(root, 'receipts'));
  return root;
}

async function store(root, folder, value, name = `${value.id}.json`) {
  await writeFile(path.join(root, folder, name), `${JSON.stringify(value)}\n`);
}

async function addHappyEvidence(root, includeNonVerified = true) {
  await store(root, 'captures', capture());
  await store(root, 'receipts', receipt(1, 'open'));
  await store(root, 'receipts', receipt(2, 'week'));
  await store(root, 'receipts', receipt(3, 'day'));
  if (includeNonVerified) {
    await store(root, 'receipts', receipt(4, 'week', {
      status: 'cancelled', reason: 'CANCELLED', after: null,
    }));
  }
}

async function addCurrentHappyEvidence(root) {
  await store(root, 'captures', capture());
  await store(root, 'receipts', currentReceipt(11, 'open'));
  await store(root, 'receipts', currentReceipt(12, 'week'));
  await store(root, 'receipts', currentReceipt(13, 'day'));
  await store(root, 'receipts', currentReceipt(14, 'month'));
  await store(root, 'receipts', currentReceipt(15, 'year'));
}

async function snapshot(root) {
  const result = [];
  async function walk(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const childRelative = path.join(relative, entry.name);
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(child, childRelative);
      else {
        const metadata = await stat(child);
        const body = await readFile(child);
        result.push([childRelative, metadata.size, metadata.mtimeMs,
          createHash('sha256').update(body).digest('hex')]);
      }
    }
  }
  await walk(root);
  return result.sort((a, b) => a[0].localeCompare(b[0]));
}

test('passes a complete three-transition audit while keeping non-verified receipts distinct', async () => {
  const root = await fixture();
  await addHappyEvidence(root);
  const frozenLegacyReceipt = await readFile(path.join(root, 'receipts', `${uuid(101)}.json`));
  assert.equal(
    createHash('sha256').update(frozenLegacyReceipt).digest('hex'),
    'b0bdcbce076585dd086ce79f1d2aaa9e68088c867945954dccb976c0a0e98e0b',
  );
  const report = await auditPilotEvidence(root);
  assert.equal(report.audit, 'offline evidence audit');
  assert.equal(report.status, 'pass');
  assert.equal(report.exitCode, 0);
  assert.deepEqual(report.happyPathCoverage, { chartOpen: true, dayToWeek: true, weekToDay: true });
  assert.deepEqual(report.currentCatalogCoverage, {
    chartOpen: false, dayToWeek: false, weekToDay: false, toMonth: false, toYear: false,
  });
  assert.equal(report.legacyComplete, true);
  assert.equal(report.currentComplete, false);
  assert.equal(report.captureCount, 1);
  assert.equal(report.receiptCount, 4);
  assert.equal(report.verifiedReceiptCount, 3);
  assert.equal(report.nonVerifiedReceiptCount, 1);
  assert.equal(report.overallWtsCoverage, 'partial');
  assert.equal(report.trainingApproved, false);
  assert.equal(report.layaReady, false);
  assert.equal(report.liveFailureGuardsVerified, false);
});

test('passes a complete current-catalog audit without borrowing legacy coverage', async () => {
  const root = await fixture();
  await addCurrentHappyEvidence(root);
  const report = await auditPilotEvidence(root);
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.happyPathCoverage, {
    chartOpen: false, dayToWeek: false, weekToDay: false,
  });
  assert.deepEqual(report.currentCatalogCoverage, {
    chartOpen: true, dayToWeek: true, weekToDay: true, toMonth: true, toYear: true,
  });
  assert.equal(report.legacyComplete, false);
  assert.equal(report.currentComplete, true);
});

test('never combines partial legacy and current evidence into a pass', async () => {
  const root = await fixture();
  await store(root, 'captures', capture());
  await store(root, 'receipts', receipt(21, 'open'));
  await store(root, 'receipts', receipt(22, 'week'));
  await store(root, 'receipts', currentReceipt(23, 'day'));
  await store(root, 'receipts', currentReceipt(24, 'month'));
  await store(root, 'receipts', currentReceipt(25, 'year'));
  const report = await auditPilotEvidence(root);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.legacyComplete, false);
  assert.equal(report.currentComplete, false);
});

test('catalog 3 verified chart and market receipts are non-applicable to historical coverage', async () => {
  const root = await fixture();
  await store(root, 'captures', capture());
  await store(root, 'receipts', catalog3ChartReceipt(31));
  await store(root, 'receipts', catalog3MarketReceipt(32));
  const report = await auditPilotEvidence(root);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.verifiedReceiptCount, 2);
  assert.equal(report.nonApplicableVerifiedReceiptCount, 2);
  assert.equal(report.nonVerifiedReceiptCount, 0);
  assert.deepEqual(report.happyPathCoverage, {
    chartOpen: false, dayToWeek: false, weekToDay: false,
  });
  assert.deepEqual(report.currentCatalogCoverage, {
    chartOpen: false, dayToWeek: false, weekToDay: false, toMonth: false, toYear: false,
  });
  assert.equal(
    report.diagnostics.some((item) => item.code === 'VERIFIED_RECEIPT_PROOF_INVALID'),
    false,
  );
});

test('schema-invalid catalog 3 receipts remain invalid evidence', async () => {
  const root = await fixture();
  await store(root, 'captures', capture());
  const invalid = catalog3MarketReceipt(33);
  invalid.after.state.targetAvailable = false;
  await store(root, 'receipts', invalid);
  const report = await auditPilotEvidence(root);
  assert.equal(report.status, 'invalid');
  assert.equal(report.nonApplicableVerifiedReceiptCount, 0);
  assert.ok(report.diagnostics.some((item) => item.code === 'RECORD_INVALID'));
});

test('invalid evidence takes precedence over complete catalog coverage', async () => {
  const root = await fixture();
  await addHappyEvidence(root, false);
  await writeFile(path.join(root, 'receipts', `${uuid(999)}.json`), '{');
  const report = await auditPilotEvidence(root);
  assert.equal(report.legacyComplete, true);
  assert.equal(report.status, 'invalid');
  assert.equal(report.exitCode, 2);
});

test('reports missing evidence directories and incomplete coverage without creating them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-evidence-missing-'));
  const report = await auditPilotEvidence(root);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.exitCode, 1);
  assert.equal(report.diagnostics.filter((item) => item.code === 'EXPECTED_DIRECTORY_MISSING').length, 2);
  assert.deepEqual(await readdir(root), []);
});

test('rejects corrupt records, unknown fields, mismatched context and instrument, unknown catalog/action, invalid transitions, no-ops, and inverted timestamps', async () => {
  const cases = [
    '{',
    JSON.stringify({ ...receipt(1, 'open'), privateCanary: 'ACCOUNT-SECRET-991122' }),
    JSON.stringify(receipt(1, 'open', { after: controlObservation(3, { instrumentToken: 'c'.repeat(64) }) })),
    JSON.stringify(receipt(1, 'open', { after: { ...receipt(1, 'open').after, source: { ...receipt(1, 'open').after.source, documentId: 'other' } } })),
    JSON.stringify(receipt(1, 'open', { catalogVersion: 'unknown-catalog' })),
    JSON.stringify(receipt(1, 'open', { actionId: 'unknown.action' })),
    JSON.stringify(receipt(1, 'open', { before: controlObservation(2, { screenId: 'main-chart', activeTab: 'chart' }) })),
    JSON.stringify(receipt(1, 'week', { before: controlObservation(2, { period: 'week' }) })),
    JSON.stringify(receipt(1, 'open', { completedAt: new Date(BASE_TIME).toISOString() })),
    JSON.stringify(receipt(1, 'open', {
      completedAt: '2026-02-30T12:00:00.000Z',
      after: { ...receipt(1, 'open').after, capturedAt: '2026-02-30T11:59:59.000Z' },
    })),
  ];
  for (const body of cases) {
    const root = await fixture();
    await writeFile(path.join(root, 'receipts', `${uuid(101)}.json`), body);
    const report = await auditPilotEvidence(root);
    assert.notEqual(report.status, 'pass');
    assert.deepEqual(report.happyPathCoverage, { chartOpen: false, dayToWeek: false, weekToDay: false });
    assert.equal(JSON.stringify(report).includes('ACCOUNT-SECRET-991122'), false);
  }
});

test('quarantines every receipt sharing a proposal id so conflicts cannot inflate coverage', async () => {
  const root = await fixture();
  await store(root, 'captures', capture());
  const open = receipt(1, 'open');
  const conflicting = receipt(2, 'week', { proposalId: open.proposalId.toUpperCase() });
  await store(root, 'receipts', open);
  await store(root, 'receipts', conflicting);
  const report = await auditPilotEvidence(root);
  assert.equal(report.status, 'invalid');
  assert.equal(report.quarantinedReceiptCount, 2);
  assert.deepEqual(report.happyPathCoverage, { chartOpen: false, dayToWeek: false, weekToDay: false });
  assert.ok(report.diagnostics.some((item) => item.code === 'DUPLICATE_PROPOSAL_ID'));
});

test('quarantines a previously accepted receipt when another canonical body repeats its receipt id', async () => {
  const root = await fixture();
  await store(root, 'captures', capture());
  const open = receipt(1, 'open');
  await store(root, 'receipts', open);
  await store(root, 'receipts', { ...open, id: open.id.toUpperCase() }, `${uuid(998)}.json`);
  const report = await auditPilotEvidence(root);
  assert.equal(report.status, 'invalid');
  assert.equal(report.quarantinedReceiptCount, 1);
  assert.equal(report.happyPathCoverage.chartOpen, false);
  assert.ok(report.diagnostics.some((item) => item.code === 'DUPLICATE_RECEIPT_ID'));
});

test('accepts uppercase UUID bodies and filenames using the store lowercase identity contract', async () => {
  const root = await fixture();
  await store(root, 'captures', capture());
  const uppercase = receipt(1, 'open');
  uppercase.id = uppercase.id.toUpperCase();
  uppercase.proposalId = uppercase.proposalId.toUpperCase();
  await store(root, 'receipts', uppercase, `${uppercase.id}.JSON`);
  const report = await auditPilotEvidence(root);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.receiptCount, 1);
  assert.equal(report.happyPathCoverage.chartOpen, true);
  assert.equal(report.diagnostics.some((item) => item.code === 'RECORD_ID_MISMATCH'), false);
});

test('accepts the actual blocked, unverified, and cancelled producer outcomes without coverage', async () => {
  const root = await fixture();
  await store(root, 'captures', capture());
  const outcomes = [
    receipt(1, 'week', { status: 'blocked', reason: 'PRECONDITION_CHANGED' }),
    receipt(2, 'week', { status: 'blocked', reason: 'EXECUTION_ERROR', after: null }),
    receipt(3, 'week', { status: 'unverified', reason: 'DOCUMENT_CHANGED', after: null }),
    receipt(4, 'week', { status: 'unverified', reason: 'POSTCONDITION_TIMEOUT' }),
    receipt(5, 'week', { status: 'unverified', reason: 'EXECUTION_ERROR' }),
    receipt(6, 'week', { status: 'cancelled', reason: 'CANCELLED', after: null }),
  ];
  for (const value of outcomes) await store(root, 'receipts', value);
  const report = await auditPilotEvidence(root);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.receiptCount, outcomes.length);
  assert.equal(report.verifiedReceiptCount, 0);
  assert.equal(report.nonVerifiedReceiptCount, outcomes.length);
  assert.equal(report.diagnostics.some((item) => item.code === 'RECEIPT_OUTCOME_INVALID'), false);
});

test('rejects impossible status, reason, and after combinations', async () => {
  const impossible = [
    receipt(1, 'open', { status: 'cancelled', reason: 'POSTCONDITION_MET' }),
    receipt(2, 'open', { status: 'blocked', reason: 'CANCELLED', after: null }),
    receipt(3, 'open', { status: 'unverified', reason: 'POSTCONDITION_TIMEOUT', after: null }),
  ];
  for (const value of impossible) {
    const root = await fixture();
    await store(root, 'captures', capture());
    await store(root, 'receipts', value);
    const report = await auditPilotEvidence(root);
    assert.equal(report.status, 'invalid');
    assert.ok(report.diagnostics.some((item) => item.code === 'RECEIPT_OUTCOME_INVALID'));
  }
});

test('accepts a valid other-to-day receipt without counting it as week-to-day coverage', async () => {
  const root = await fixture();
  await store(root, 'captures', capture());
  const otherToDay = receipt(1, 'day');
  otherToDay.before.state.period = 'other';
  await store(root, 'receipts', otherToDay);
  const report = await auditPilotEvidence(root);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.receiptCount, 1);
  assert.equal(report.verifiedReceiptCount, 1);
  assert.equal(report.nonVerifiedReceiptCount, 0);
  assert.equal(report.diagnostics.some((item) => item.code === 'VERIFIED_RECEIPT_PROOF_INVALID'), false);
  assert.equal(report.happyPathCoverage.weekToDay, false);
});

test('rejects a valid UUID filename whose body id differs and reports unknown entries', async () => {
  const root = await fixture();
  await store(root, 'receipts', receipt(1, 'open'), `${uuid(999)}.json`);
  await writeFile(path.join(root, 'captures', 'private-canary-ACCOUNT-SECRET-991122.txt'), 'private');
  const report = await auditPilotEvidence(root);
  assert.equal(report.status, 'invalid');
  assert.ok(report.diagnostics.some((item) => item.code === 'RECORD_ID_MISMATCH'));
  assert.ok(report.diagnostics.some((item) => item.code === 'UNKNOWN_DIRECTORY_ENTRY'));
  assert.equal(JSON.stringify(report).includes('ACCOUNT-SECRET-991122'), false);
});

test('treats owned temporary files as explicit in-progress evidence, never a pass', async () => {
  const root = await fixture();
  await addHappyEvidence(root, false);
  await writeFile(path.join(root, 'receipts', `.${uuid(777)}.1-2-abcdefabcdef.tmp`), 'pending');
  const report = await auditPilotEvidence(root);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.exitCode, 1);
  assert.ok(report.diagnostics.some((item) => item.code === 'OWNED_TEMP_FILE_PRESENT'));
});

test('rejects oversized records and symlinked roots and subdirectories', async () => {
  const oversizedRoot = await fixture();
  await writeFile(path.join(oversizedRoot, 'captures', `${uuid(1)}.json`), Buffer.alloc(128 * 1024 + 1));
  const oversized = await auditPilotEvidence(oversizedRoot);
  assert.equal(oversized.status, 'invalid');
  assert.ok(oversized.diagnostics.some((item) => item.code === 'RECORD_SIZE_LIMIT_EXCEEDED'));

  const target = await fixture();
  const parent = await mkdtemp(path.join(os.tmpdir(), 'athena-evidence-links-'));
  const rootLink = path.join(parent, 'root-link');
  await symlink(target, rootLink, 'junction');
  const linkedRoot = await auditPilotEvidence(rootLink);
  assert.equal(linkedRoot.status, 'invalid');
  assert.ok(linkedRoot.diagnostics.some((item) => item.code === 'DATA_DIRECTORY_NOT_REGULAR'));

  const subdirRoot = await mkdtemp(path.join(os.tmpdir(), 'athena-evidence-subdir-'));
  await mkdir(path.join(subdirRoot, 'receipts'));
  await symlink(path.join(target, 'captures'), path.join(subdirRoot, 'captures'), 'junction');
  const linkedSubdir = await auditPilotEvidence(subdirRoot);
  assert.equal(linkedSubdir.status, 'invalid');
  assert.ok(linkedSubdir.diagnostics.some((item) => item.code === 'DIRECTORY_NOT_REGULAR'));
});

test('does not modify evidence files during an audit', async () => {
  const root = await fixture();
  await addHappyEvidence(root);
  const before = await snapshot(root);
  await auditPilotEvidence(root);
  const after = await snapshot(root);
  assert.deepEqual(after, before);
});

test('CLI returns bounded code-only JSON and a nonzero exit for incomplete evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-evidence-cli-private-canary-'));
  const result = spawnSync(process.execPath, [AUDIT_SCRIPT, '--data-dir', root], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.length < 8_192);
  assert.equal(result.stdout.includes(root), false);
  assert.equal(result.stdout.includes('private-canary'), false);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'incomplete');
  assert.ok(report.diagnostics.every((item) => (
    typeof item.code === 'string' && typeof item.scope === 'string' && Number.isInteger(item.count)
  )));
});
