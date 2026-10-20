import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  REGISTRATION_STORE_EXECUTABLE,
  REGISTRATION_STORE_HELPER,
  RegistrationStore,
} from '../src/chatgpt-provider/registration-store.mjs';

const EXACT_ENV = Object.freeze({
  SystemRoot: 'C:\\Windows',
  windir: 'C:\\Windows',
  PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules',
});
const BINDING_A = 'a'.repeat(64);
const BINDING_B = 'b'.repeat(64);

function encodedCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function runProcess(executable, args, { input = '', env = EXACT_ENV } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= 8192) stdout.push(Buffer.from(chunk));
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 8192) stderr.push(Buffer.from(chunk));
    });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      stdoutBytes,
      stderrBytes,
    }));
    child.stdin.end(input);
  });
}

async function runHelperScript(script, operation, dataRoot, input) {
  const result = await runProcess(REGISTRATION_STORE_EXECUTABLE, [
    '-NoLogo', '-NoProfile', '-NonInteractive',
    '-File', script,
    '-Operation', operation,
    '-DataRoot', dataRoot,
  ], { input: input === undefined ? '' : JSON.stringify(input) });
  assert.equal(result.stdoutBytes <= 4096, true);
  assert.equal(result.stderrBytes <= 4096, true);
  return { ...result, value: JSON.parse(result.stdout) };
}

function runHelper(operation, dataRoot, input) {
  return runHelperScript(REGISTRATION_STORE_HELPER, operation, dataRoot, input);
}

async function runWindowsCommand(script) {
  return runProcess(REGISTRATION_STORE_EXECUTABLE, [
    '-NoLogo', '-NoProfile', '-NonInteractive',
    '-EncodedCommand', encodedCommand(script),
  ]);
}

async function privateRoot(prefix = 'athena-registration-test') {
  const root = path.join(os.tmpdir(), `${prefix}-${randomUUID()}`);
  const literal = root.replaceAll("'", "''");
  const result = await runWindowsCommand(`
$root='${literal}'
$user=[Security.Principal.WindowsIdentity]::GetCurrent().User
$system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($user)
$acl.SetAccessRuleProtection($true,$false)
$inherit=[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
foreach($sid in @($user,$system)){
  [void]$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)))
}
[void][IO.Directory]::CreateDirectory($root,$acl)
`);
  assert.equal(result.code, 0, result.stderr);
  return root;
}

async function cleanup(...roots) {
  for (const root of roots) await rm(root, { recursive: true, force: true });
}

async function grantEveryoneFullControl(target, directory) {
  const literal = target.replaceAll("'", "''");
  const access = directory ? 'Directory' : 'File';
  const result = await runWindowsCommand(`
$path='${literal}'
$acl=[IO.${access}]::GetAccessControl($path)
$everyone=New-Object Security.Principal.SecurityIdentifier('S-1-1-0')
$rule=New-Object Security.AccessControl.FileSystemAccessRule($everyone,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]::None,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
[void]$acl.AddAccessRule($rule)
[IO.${access}]::SetAccessControl($path,$acl)
`);
  assert.equal(result.code, 0, result.stderr);
}

async function registrationSecurity(registration) {
  const literal = registration.replaceAll("'", "''");
  const result = await runWindowsCommand(`
$path='${literal}'
$current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$security=[IO.File]::GetAccessControl($path)
$rules=@($security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object {
  [ordered]@{
    sid=[string]$_.IdentityReference.Value
    type=[string]$_.AccessControlType
    rights=[string]$_.FileSystemRights
  }
})
[ordered]@{
  current=$current
  owner=$security.GetOwner([Security.Principal.SecurityIdentifier]).Value
  canonical=$security.AreAccessRulesCanonical
  sddl=$security.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
  rules=$rules
} | ConvertTo-Json -Compress -Depth 4
`);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function assertCanonicalPrivateRegistration(registration, document) {
  const bytes = await readFile(registration);
  assert.deepEqual(bytes, Buffer.from(JSON.stringify(document), 'utf8'));
  const security = await registrationSecurity(registration);
  assert.equal(security.owner, security.current);
  assert.equal(security.canonical, true);
  assert.deepEqual(
    security.rules.map((rule) => ({ ...rule })).sort((left, right) => left.sid.localeCompare(right.sid)),
    [
      { sid: security.current, type: 'Allow', rights: 'FullControl' },
      { sid: 'S-1-5-18', type: 'Allow', rights: 'FullControl' },
    ].sort((left, right) => left.sid.localeCompare(right.sid)),
  );
  return security;
}

async function makeFaultHelper(root, placement) {
  const sourceBytes = await readFile(REGISTRATION_STORE_HELPER);
  const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
  const source = sourceBytes.toString('utf8');
  const anchor = '            [AthenaRegistrationPhysicalPath.NativeMethods]::Replace($Target, $temporary)';
  assert.equal(source.split(anchor).length, 2, 'fault-injection anchor must remain unique');
  const fault = "            Stop-Registration 'OPENAI_REGISTRATION_IO_FAILED'";
  const replacement = placement === 'before'
    ? `${fault}\n${anchor}`
    : `${anchor}\n${fault}`;
  const injected = source.replace(anchor, replacement);
  const helper = path.join(root, `openai-registration-${placement}-fault.ps1`);
  await writeFile(helper, injected, 'utf8');
  assert.notEqual(createHash('sha256').update(await readFile(helper)).digest('hex'), sourceHash);
  return { helper, sourceHash };
}

test('real helper serializes two-process creation and preserves one host identity', async (t) => {
  assert.equal(process.platform, 'win32');
  const root = await privateRoot();
  t.after(() => cleanup(root));
  const [left, right] = await Promise.all([
    runHelper('ensure-host', root),
    runHelper('ensure-host', root),
  ]);
  assert.equal(left.code, 0, left.stderr);
  assert.equal(right.code, 0, right.stderr);
  assert.deepEqual(left.value, right.value);
  assert.match(left.value.hostId,
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  const lock = await lstat(path.join(root, 'openai-registration-v1', 'registration.lock'));
  assert.equal(lock.size, 0);
});

test('real helper read of a missing registration is side-effect-free', async (t) => {
  const root = await privateRoot();
  t.after(() => cleanup(root));
  const result = await runHelper('read', root);
  assert.equal(result.value.code, 'OPENAI_REGISTRATION_NOT_FOUND');
  await assert.rejects(
    lstat(path.join(root, 'openai-registration-v1')),
    { code: 'ENOENT' },
  );
});

test('helper source enforces fixed local drive type before physical storage access', async () => {
  const source = await readFile(REGISTRATION_STORE_HELPER, 'utf8');
  assert.match(source, /\$drive\.DriveType -ne \[IO\.DriveType\]::Fixed/u);
  const normalize = source.indexOf('$DataRoot = Resolve-NormalizedPath $DataRoot');
  const driveCheck = source.indexOf('Assert-FixedLocalDrive $DataRoot');
  const physicalCheck = source.indexOf("Assert-PhysicalItem $DataRoot 'Directory'");
  assert.equal(normalize >= 0 && driveCheck > normalize && physicalCheck > driveCheck, true);
});

test('real helper permits one first binding, idempotence, and compare-and-set reset', async (t) => {
  const root = await privateRoot();
  t.after(() => cleanup(root));
  const initial = await runHelper('ensure-host', root);
  const [left, right] = await Promise.all([
    runHelper('bind', root, { issuedClientId: 'oaiapp_first', accountBindingSha256: BINDING_A }),
    runHelper('bind', root, { issuedClientId: 'oaiapp_second', accountBindingSha256: BINDING_B }),
  ]);
  const winner = [left, right].find((result) => result.code === 0);
  const loser = [left, right].find((result) => result.code !== 0);
  assert.ok(winner);
  assert.equal(loser.value.code, 'OPENAI_REGISTRATION_BINDING_CONFLICT');
  assert.equal((await runHelper('bind', root, {
    issuedClientId: winner.value.issuedClientId,
    accountBindingSha256: winner.value.accountBindingSha256,
  })).code, 0);
  const wrongReset = await runHelper('reset', root, {
    expectedIssuedClientId: 'oaiapp_wrong',
    expectedAccountBindingSha256: BINDING_A,
  });
  assert.equal(wrongReset.value.code, 'OPENAI_REGISTRATION_RESET_CONFLICT');
  const reset = await runHelper('reset', root, {
    expectedIssuedClientId: winner.value.issuedClientId,
    expectedAccountBindingSha256: winner.value.accountBindingSha256,
  });
  assert.equal(reset.code, 0, reset.stderr);
  assert.equal(reset.value.hostId, initial.value.hostId);
  assert.equal(reset.value.issuedClientId, null);
  assert.equal(reset.value.accountBindingSha256, null);
});

test('isolated helper-copy faults prove atomic replace recovery and exact bytes and ACLs', async (t) => {
  const root = await privateRoot();
  t.after(() => cleanup(root));
  const registration = path.join(root, 'openai-registration-v1', 'registration.json');
  const initial = (await runHelper('ensure-host', root)).value;
  const initialSecurity = await assertCanonicalPrivateRegistration(registration, initial);
  const initialBytes = await readFile(registration);

  const before = await makeFaultHelper(root, 'before');
  const proposed = { issuedClientId: 'oaiapp_fault-test', accountBindingSha256: BINDING_A };
  const beforeFailure = await runHelperScript(before.helper, 'bind', root, proposed);
  assert.equal(beforeFailure.value.code, 'OPENAI_REGISTRATION_IO_FAILED');
  assert.deepEqual(await readFile(registration), initialBytes);
  assert.equal((await registrationSecurity(registration)).sddl, initialSecurity.sddl);

  const after = await makeFaultHelper(root, 'after');
  assert.equal(after.sourceHash, before.sourceHash);
  const afterFailure = await runHelperScript(after.helper, 'bind', root, proposed);
  assert.equal(afterFailure.value.code, 'OPENAI_REGISTRATION_IO_FAILED');
  const committed = (await runHelper('read', root)).value;
  assert.deepEqual(committed, {
    version: 1,
    hostId: initial.hostId,
    issuedClientId: proposed.issuedClientId,
    accountBindingSha256: proposed.accountBindingSha256,
  });
  await assertCanonicalPrivateRegistration(registration, committed);
  assert.equal(
    createHash('sha256').update(await readFile(REGISTRATION_STORE_HELPER)).digest('hex'),
    before.sourceHash,
  );
});

test('real helper rejects corrupt schema and identity without replacing the file', async (t) => {
  const root = await privateRoot();
  t.after(() => cleanup(root));
  const initial = (await runHelper('ensure-host', root)).value;
  const registration = path.join(root, 'openai-registration-v1', 'registration.json');
  const corrupt = JSON.stringify({ ...initial, extra: true });
  await writeFile(registration, corrupt, 'utf8');
  const schema = await runHelper('read', root);
  assert.equal(schema.value.code, 'OPENAI_REGISTRATION_CORRUPT');
  assert.equal(await readFile(registration, 'utf8'), corrupt);

  const second = await privateRoot();
  t.after(() => cleanup(second));
  const other = (await runHelper('ensure-host', second)).value;
  const otherFile = path.join(second, 'openai-registration-v1', 'registration.json');
  const badIdentity = JSON.stringify({
    ...other,
    hostId: 'urn:uuid:123e4567-e89b-12d3-a456-426614174000',
  });
  await writeFile(otherFile, badIdentity, 'utf8');
  const identity = await runHelper('read', second);
  assert.equal(identity.value.code, 'OPENAI_REGISTRATION_CORRUPT');
  assert.equal(await readFile(otherFile, 'utf8'), badIdentity);

  const legacyRoot = await privateRoot();
  t.after(() => cleanup(legacyRoot));
  const legacy = (await runHelper('ensure-host', legacyRoot)).value;
  const legacyFile = path.join(legacyRoot, 'openai-registration-v1', 'registration.json');
  const legacyIdentity = JSON.stringify({
    ...legacy,
    hostId: Buffer.alloc(32, 7).toString('base64url'),
  });
  await writeFile(legacyFile, legacyIdentity, 'utf8');
  const unsupported = await runHelper('read', legacyRoot);
  assert.equal(unsupported.value.code, 'OPENAI_REGISTRATION_HOST_ID_UNSUPPORTED');
  assert.equal(await readFile(legacyFile, 'utf8'), legacyIdentity);

  const third = await privateRoot();
  t.after(() => cleanup(third));
  const arrayIdentity = (await runHelper('ensure-host', third)).value;
  const arrayFile = path.join(third, 'openai-registration-v1', 'registration.json');
  const arrayHostId = JSON.stringify({ ...arrayIdentity, hostId: [arrayIdentity.hostId] });
  await writeFile(arrayFile, arrayHostId, 'utf8');
  const typedIdentity = await runHelper('read', third);
  assert.equal(typedIdentity.value.code, 'OPENAI_REGISTRATION_CORRUPT');
  assert.equal(await readFile(arrayFile, 'utf8'), arrayHostId);
});

test('real helper rejects insecure child ACL and reparse data roots', async (t) => {
  const root = await privateRoot();
  t.after(() => cleanup(root));
  await runHelper('ensure-host', root);
  const directory = path.join(root, 'openai-registration-v1');
  await grantEveryoneFullControl(directory, true);
  const badAcl = await runHelper('read', root);
  assert.equal(badAcl.value.code, 'OPENAI_REGISTRATION_ACL_UNSAFE');

  const badParent = await privateRoot();
  t.after(() => cleanup(badParent));
  await grantEveryoneFullControl(badParent, true);
  assert.equal(
    (await runHelper('ensure-host', badParent)).value.code,
    'OPENAI_REGISTRATION_ACL_UNSAFE',
  );

  const badFileRoot = await privateRoot();
  t.after(() => cleanup(badFileRoot));
  await runHelper('ensure-host', badFileRoot);
  await grantEveryoneFullControl(
    path.join(badFileRoot, 'openai-registration-v1', 'registration.json'),
    false,
  );
  assert.equal(
    (await runHelper('read', badFileRoot)).value.code,
    'OPENAI_REGISTRATION_ACL_UNSAFE',
  );

  const target = await privateRoot();
  const linkParent = path.join(os.tmpdir(), `athena-registration-link-${randomUUID()}`);
  const link = path.join(linkParent, 'redirected');
  await mkdir(linkParent);
  await symlink(target, link, 'junction');
  t.after(() => cleanup(linkParent, target));
  const redirected = await runHelper('ensure-host', link);
  assert.equal(redirected.value.code, 'OPENAI_REGISTRATION_PATH_UNSAFE');
});

test('real helper lock contention stops within the bounded five-second window', async (t) => {
  const root = await privateRoot();
  t.after(() => cleanup(root));
  await runHelper('ensure-host', root);
  const lockPath = path.join(root, 'openai-registration-v1', 'registration.lock');
  const literal = lockPath.replaceAll("'", "''");
  const holder = spawn(REGISTRATION_STORE_EXECUTABLE, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand(`
$stream=[IO.FileStream]::new('${literal}',[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
[Console]::Out.WriteLine('LOCKED')
[Console]::Out.Flush()
Start-Sleep -Seconds 60
$stream.Dispose()
`)], { shell: false, windowsHide: true, env: EXACT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  const holderClosed = new Promise((resolve) => holder.once('close', resolve));
  t.after(async () => {
    if (holder.exitCode === null) holder.kill();
    await holderClosed;
  });
  await new Promise((resolve, reject) => {
    let text = '';
    holder.once('error', reject);
    holder.stdout.on('data', (chunk) => {
      text += chunk.toString('utf8');
      if (text.includes('LOCKED')) resolve();
    });
  });
  const started = Date.now();
  const blocked = await runHelper('read', root);
  const elapsed = Date.now() - started;
  assert.equal(blocked.value.code, 'OPENAI_REGISTRATION_LOCK_TIMEOUT');
  assert.equal(elapsed >= 4500 && elapsed <= 20000, true, `elapsed=${elapsed}`);
  holder.kill();
  await holderClosed;
});

test('real RegistrationStore scrubs a canary and returns frozen exact metadata', async (t) => {
  const root = await privateRoot();
  t.after(() => cleanup(root));
  process.env.ATHENA_REGISTRATION_CANARY = 'never-inherit';
  let captured;
  const spawnImpl = (executable, args, options) => {
    captured = options;
    return spawn(executable, args, options);
  };
  try {
    const result = await new RegistrationStore({ dataRoot: root, spawnImpl }).ensureHost();
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(Object.keys(result), [
      'version', 'hostId', 'issuedClientId', 'accountBindingSha256',
    ]);
    assert.deepEqual(captured.env, EXACT_ENV);
    assert.equal(Object.hasOwn(captured.env, 'ATHENA_REGISTRATION_CANARY'), false);
  } finally {
    delete process.env.ATHENA_REGISTRATION_CANARY;
  }
});
