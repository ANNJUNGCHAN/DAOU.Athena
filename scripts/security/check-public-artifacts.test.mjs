import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  assertPublicGitPath,
  checkPublicArtifacts,
  isMaterializedLfsFile,
  materializePublicFiles,
  parseLfsPaths,
  parseStagedEntries,
} from "./check-public-artifacts.mjs";

test("public Git paths are limited to normalized web and presentation descendants", () => {
  for (const path of ["web/app/page.tsx", "presentation/source/video/stage.js"]) {
    assert.equal(assertPublicGitPath(path), path);
  }
  for (const path of ["/web/app/page.tsx", "../web/app/page.tsx", "web/../private.txt",
    "web\\app\\page.tsx", "backend/main.py", "web", "web/private/session.json",
    "web/cache/account.json", "presentation/.private/token.txt"]) {
    assert.throws(() => assertPublicGitPath(path), path);
  }
});

test("index parser accepts only stage-zero regular executable or non-executable files", () => {
  const good = Buffer.from("100644 aaaa 0\tweb/a.txt\0" +
    "100755 bbbb 0\tpresentation/run.ps1\0");
  assert.deepEqual(parseStagedEntries(good), [
    { mode: "100644", path: "web/a.txt" },
    { mode: "100755", path: "presentation/run.ps1" },
  ]);
  assert.throws(() => parseStagedEntries(Buffer.from("120000 aaaa 0\tweb/link\0")), /mode=120000/);
  assert.throws(() => parseStagedEntries(Buffer.from("100644 aaaa 2\tweb/conflict\0")), /stage=2/);
});

test("LFS parser keeps only public subtree paths", () => {
  assert.deepEqual(parseLfsPaths(Buffer.from([
    "web/public.bin",
    "presentation/public.mp4",
    "backend/private.bin",
    "",
  ].join("\n"))), ["web/public.bin", "presentation/public.mp4"]);
});

test("forbidden tracked paths fail before LFS discovery or source access", () => {
  let calls = 0;
  const runCommand = () => {
    calls++;
    if (calls === 1) return Buffer.from("100644 aaaa 0\tweb/private/session.json\0");
    throw new Error("content access occurred");
  };
  assert.throws(() => checkPublicArtifacts({ root: "unused", runCommand }),
    /forbidden public Git path/);
  assert.equal(calls, 1);
});

test("materialization rejects an ancestor reparse link that escapes its public subtree", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-artifact-test-root-"));
  const outside = mkdtempSync(join(tmpdir(), "athena-artifact-test-outside-"));
  const destination = mkdtempSync(join(tmpdir(), "athena-artifact-test-dest-"));
  try {
    mkdirSync(join(root, "web"));
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(outside, join(root, "web", "linked"), process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => materializePublicFiles(root, destination,
      [{ mode: "100644", path: "web/linked/secret.txt" }], new Set()), /reparse|escapes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    rmSync(destination, { recursive: true, force: true });
  }
});

test("LFS pointer files must be materialized", () => {
  const directory = mkdtempSync(join(tmpdir(), "athena-artifact-lfs-"));
  try {
    const pointer = join(directory, "asset.mp4");
    const content = join(directory, "asset.bin");
    writeFileSync(pointer, "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1\n");
    writeFileSync(content, Buffer.from([0, 1, 2, 3]));
    assert.equal(isMaterializedLfsFile(pointer), false);
    assert.equal(isMaterializedLfsFile(content), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("artifact check scans only copied tracked files with strict archive flags and cleans up", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-artifact-run-root-"));
  const tempBase = mkdtempSync(join(tmpdir(), "athena-artifact-run-temp-"));
  let scanDirectory;
  const calls = [];
  try {
    for (const path of [
      "web/app/page.tsx",
      "presentation/asset.mp4",
      "presentation/scripts/security/gitleaks.toml",
    ]) {
      const target = join(root, ...path.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, path.endsWith(".mp4") ? Buffer.from([0, 1, 2]) : "public");
    }
    const index = Buffer.from([
      "100644 aaaa 0\tweb/app/page.tsx",
      "100644 bbbb 0\tpresentation/asset.mp4",
      "100644 cccc 0\tpresentation/scripts/security/gitleaks.toml",
      "",
    ].join("\0"));
    const runCommand = (command, args) => {
      calls.push([command, ...args]);
      if (command === "git" && args.includes("ls-files") && args.includes("--stage")) return index;
      if (command === "git" && args.includes("ls-files") && args.includes("-n")) {
        return Buffer.from("presentation/asset.mp4\n");
      }
      if (command === "gitleaks") {
        scanDirectory = args[1];
        assert.equal(existsSync(join(scanDirectory, "web", "app", "page.tsx")), true);
        assert.equal(existsSync(join(scanDirectory, "presentation", "asset.mp4")), true);
        return Buffer.alloc(0);
      }
      if (command === "git" && args.includes("fsck")) return Buffer.alloc(0);
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    assert.deepEqual(checkPublicArtifacts({ root, tempBase, runCommand }), { tracked: 3, lfs: 1 });
    assert.equal(existsSync(scanDirectory), false);
    const gitleaks = calls.find(([command]) => command === "gitleaks");
    assert.ok(gitleaks.includes("--redact=100"));
    assert.ok(gitleaks.includes("--ignore-gitleaks-allow"));
    assert.deepEqual(gitleaks.slice(gitleaks.indexOf("--max-archive-depth"),
      gitleaks.indexOf("--max-archive-depth") + 4),
    ["--max-archive-depth", "2", "--max-decode-depth", "3"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(tempBase, { recursive: true, force: true });
  }
});

test("artifact scan failure is preserved after temporary files are removed", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-artifact-fail-root-"));
  const tempBase = mkdtempSync(join(tmpdir(), "athena-artifact-fail-temp-"));
  let scanDirectory;
  try {
    const config = join(root, "presentation", "scripts", "security", "gitleaks.toml");
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, "public");
    const runCommand = (command, args) => {
      if (command === "git" && args.includes("--stage")) {
        return Buffer.from("100644 aaaa 0\tpresentation/scripts/security/gitleaks.toml\0");
      }
      if (command === "git" && args.includes("ls-files")) return Buffer.alloc(0);
      if (command === "gitleaks") {
        scanDirectory = args[1];
        throw new Error("scan failed");
      }
      throw new Error("unexpected command");
    };
    assert.throws(() => checkPublicArtifacts({ root, tempBase, runCommand }), /scan failed/);
    assert.equal(existsSync(scanDirectory), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(tempBase, { recursive: true, force: true });
  }
});

test("artifact scan and cleanup failures preserve both causes", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-artifact-double-fail-root-"));
  const tempBase = mkdtempSync(join(tmpdir(), "athena-artifact-double-fail-temp-"));
  try {
    const config = join(root, "presentation", "scripts", "security", "gitleaks.toml");
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, "public");
    const runCommand = (command, args) => {
      if (command === "git" && args.includes("--stage")) {
        return Buffer.from("100644 aaaa 0\tpresentation/scripts/security/gitleaks.toml\0");
      }
      if (command === "git" && args.includes("ls-files")) return Buffer.alloc(0);
      if (command === "gitleaks") throw new Error("scan failed");
      throw new Error("unexpected command");
    };
    assert.throws(() => checkPublicArtifacts({
      root,
      tempBase,
      runCommand,
      removeDirectory: () => { throw new Error("cleanup failed"); },
    }), (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.match(error.message, /scan failed/);
      assert.match(error.message, /cleanup failed/);
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(tempBase, { recursive: true, force: true });
  }
});
