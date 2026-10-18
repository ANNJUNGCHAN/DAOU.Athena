import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  assessOwnedCleanup,
  parseBackendAnnouncement,
  validateBackendListenerOwnership,
  validateOwnedBackendAnnouncement,
} = require('./smoke-windows-installer.cjs');

test('installer smoke accepts the dynamically announced loopback backend owned by Athena', () => {
  const announcement = parseBackendAnnouncement([
    '===== 2026-10-18T05:00:00.000Z uvicorn spawn pid=99999 =====',
    'ATHENA_BACKEND_URL=http://127.0.0.1:60000',
    '===== 2026-10-18T05:17:47.151Z uvicorn spawn pid=53496 =====',
    'ATHENA_BACKEND_URL=http://127.0.0.1:61124',
  ].join('\n'));

  assert.deepEqual(announcement, {
    pid: 53496,
    baseUrl: 'http://127.0.0.1:61124',
    port: 61124,
  });
  assert.deepEqual(validateOwnedBackendAnnouncement(announcement, 41000, [
    { ProcessId: 41000, ParentProcessId: 1000 },
    { ProcessId: 42000, ParentProcessId: 41000 },
    { ProcessId: 53496, ParentProcessId: 42000 },
  ]), {
    appPid: 41000,
    backendPid: 53496,
    descendant: true,
  });
  assert.deepEqual(validateBackendListenerOwnership(announcement, [53496]), {
    port: 61124,
    ownerPid: 53496,
  });
});

test('installer smoke does not report cleanup success until the owned process is gone', () => {
  assert.deepEqual(assessOwnedCleanup(0, { running: true, imageMatches: true }), {
    taskkillAccepted: true,
    success: false,
  });
  assert.deepEqual(assessOwnedCleanup(0, { running: false, imageMatches: false }), {
    taskkillAccepted: true,
    success: true,
  });
});

test('installer smoke rejects foreign endpoints and sibling backend processes', () => {
  assert.throws(
    () => parseBackendAnnouncement([
      '===== 2026-10-18T05:17:47.151Z uvicorn spawn pid=53496 =====',
      'ATHENA_BACKEND_URL=http://localhost:61124',
    ].join('\n')),
    /127\.0\.0\.1 HTTP origin/,
  );

  const announcement = parseBackendAnnouncement([
    '===== 2026-10-18T05:17:47.151Z uvicorn spawn pid=53496 =====',
    'ATHENA_BACKEND_URL=http://127.0.0.1:61124',
  ].join('\n'));
  assert.throws(
    () => validateOwnedBackendAnnouncement(announcement, 41000, [
      { ProcessId: 41000, ParentProcessId: 1000 },
      { ProcessId: 53496, ParentProcessId: 1000 },
    ]),
    /not a descendant/,
  );
  assert.throws(
    () => validateBackendListenerOwnership(announcement, [77777]),
    /not owned by announced PID/,
  );
});
