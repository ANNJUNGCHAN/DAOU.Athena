import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = readFileSync(new URL("../build-windows-installer.ps1", import.meta.url), "utf8");

test("installer snapshots the captured commit despite later commits and working-tree edits", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-build-snapshot-"));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  try {
    git("init", "--quiet");
    git("config", "core.autocrlf", "false");
    for (const dir of ["app", "backend", "scripts"]) mkdirSync(join(root, dir));
    const files = ["app/main.js", "app/package-lock.json", "backend/uv.lock", "scripts/windows-installer.config.cjs", "scripts/windows-installer.nsh", "scripts/windows-installer-processes.nsh", "scripts/windows-installer-processes.ps1", "scripts/windows-installer-upgrade.nsh", "scripts/windows-installer-upgrade.ps1"];
    for (const file of files) writeFileSync(join(root, file), "captured\n");
    git("add", ".");
    git("-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "commit", "--quiet", "-m", "captured");
    const commit = git("rev-parse", "HEAD");
    for (const file of files) writeFileSync(join(root, file), "later commit\n");
    git("add", ".");
    git("-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "commit", "--quiet", "-m", "later");
    writeFileSync(join(root, "app/main.js"), "uncommitted\n");
    writeFileSync(join(root, "app/ignored-secret.txt"), "must not enter snapshot\n");
    const harness = join(root, "harness.ps1");
    const functions = script.slice(script.indexOf("function Invoke-Native {"), script.indexOf("$RepoRoot ="));
    writeFileSync(harness, `param($Root, $Commit)\n$ErrorActionPreference = 'Stop'\n${functions}
$SnapshotRoot = Join-Path $Root 'snapshot'
Export-SourceSnapshot $Root $Commit $SnapshotRoot
Copy-TrackedFile 'app/main.js' (Join-Path $Root 'stage')
`);
    execFileSync("pwsh", ["-NoProfile", "-File", harness, root, commit], { encoding: "utf8" });
    for (const file of files) assert.equal(readFileSync(join(root, "snapshot", file), "utf8"), "captured\n");
    assert.equal(readFileSync(join(root, "stage/app/main.js"), "utf8"), "captured\n");
    assert.throws(() => readFileSync(join(root, "snapshot/app/ignored-secret.txt")), { code: "ENOENT" });
    assert.notEqual(git("rev-parse", "HEAD"), commit);
  } finally {
    // Only this test's freshly-created temporary directory is removed.
    rmSync(root, { recursive: true, force: true });
  }
});

test("installer records the captured commit and consumes snapshotted build inputs", () => {
  assert.ok(script.indexOf("$SourceCommit =") < script.indexOf("$packagePath ="));
  assert.match(script, /commit = \$SourceCommit/);
  assert.equal((script.match(/'rev-parse', 'HEAD'/g) || []).length, 1);
  assert.match(script, /'ls-tree', '-r', '--name-only', \$SourceCommit/);
  assert.match(script, /'export'.*\$StageBackend/);
  assert.match(script, /Join-Path \$StageApp 'package-lock.json'/);
  assert.match(script, /Join-Path \$StageBackend 'uv.lock'/);
  assert.match(script, /Join-Path \$SnapshotRoot 'scripts\/windows-installer.config.cjs'/);
  assert.match(script, /Join-Path \$SnapshotRoot 'scripts\/release\/stage-windows-mcp-runtimes.ps1'/);
});
