import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkInstallerSources, listUntrackedFiles } from "./check-installer-sources.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const cli = join(here, "check-installer-sources.mjs");

function gitFixture() {
  const dir = mkdtempSync(join(tmpdir(), "athena-installer-source-gate-"));
  execFileSync("git", ["init", "--quiet", dir]);
  writeFileSync(join(dir, ".gitignore"), ".omc/\napp/captures/\n", "utf8");
  writeFileSync(join(dir, "README.md"), "fixture\n", "utf8");
  execFileSync("git", ["-C", dir, "-c", "core.autocrlf=false", "add", ".gitignore", "README.md"]);
  return dir;
}

test("installer source gate rejects an untracked runtime file but ignores operational artifacts", () => {
  const dir = gitFixture();
  try {
    mkdirSync(join(dir, "app", "lib", "main"), { recursive: true });
    mkdirSync(join(dir, ".omc", "artifacts"), { recursive: true });
    mkdirSync(join(dir, "app", "captures"), { recursive: true });
    writeFileSync(join(dir, "app", "lib", "main", "new-runtime.js"), "module.exports = {};\n", "utf8");
    writeFileSync(join(dir, ".omc", "artifacts", "report.json"), "{}\n", "utf8");
    writeFileSync(join(dir, "app", "captures", "screen.png"), "fixture\n", "utf8");

    assert.deepEqual(listUntrackedFiles(dir), ["app/lib/main/new-runtime.js"]);
    assert.throws(
      () => checkInstallerSources(dir),
      /Untracked files are excluded[\s\S]*app\/lib\/main\/new-runtime\.js/,
    );

    const result = spawnSync(process.execPath, [cli, dir], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Add intended source files, or remove\/ignore local artifacts/);
    assert.doesNotMatch(result.stderr, /\.omc|captures/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installer source gate passes when only tracked and ignored files exist", () => {
  const dir = gitFixture();
  try {
    mkdirSync(join(dir, ".omc", "artifacts"), { recursive: true });
    writeFileSync(join(dir, ".omc", "artifacts", "report.json"), "{}\n", "utf8");
    assert.deepEqual(checkInstallerSources(dir), { ok: true });

    const result = spawnSync(process.execPath, [cli, dir], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "installer sources ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Windows installer invokes the untracked source gate before git ls-files staging", () => {
  const script = readFileSync(join(root, "scripts", "build-windows-installer.ps1"), "utf8");
  const gateAt = script.indexOf("scripts/release/check-installer-sources.mjs");
  const stagingAt = script.indexOf("$tracked = @(");
  assert.ok(gateAt >= 0 && stagingAt > gateAt);
});
