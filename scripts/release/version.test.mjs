import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  bumpLockVersions,
  bumpPackageVersion,
  bumpPyprojectVersion,
  checkProjectVersions,
  isPrerelease,
  parseReleaseTag,
  setProjectVersion,
  tagFromEnv,
} from "./version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const checkCli = fileURLToPath(new URL("./check-version.mjs", import.meta.url));
const setCli = fileURLToPath(new URL("./set-version.mjs", import.meta.url));

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "athena-release-"));
  for (const [rel, source] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source, "utf8");
  }
  return dir;
}

const packageJson = `{
  "name": "athena-shell",
  "version": "0.1.0",
  "private": true
}
`;

const packageLock = `{
  "name": "athena-shell",
  "version": "0.1.0",
  "lockfileVersion": 3,
  "packages": {
    "": {
      "name": "athena-shell",
      "version": "0.1.0"
    }
  }
}
`;

const pyproject = `[build-system]
requires = ["hatchling"]

[project]
name = "daou-athena-backend"
version = "0.1.0"
description = "test"
target-version = "py311"
`;

function alignedTree() {
  return fixture({
    "app/package.json": packageJson,
    "app/package-lock.json": packageLock,
    "backend/pyproject.toml": pyproject,
  });
}

test("current repo versions are aligned", () => {
  const version = JSON.parse(readFileSync(join(root, "app/package.json"), "utf8")).version;
  const result = spawnSync(process.execPath, [checkCli], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, RELEASE_TAG: "", GITHUB_REF_NAME: "main" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `version ok ${version}`);
});

test("parseReleaseTag strips the v prefix", () => {
  assert.equal(parseReleaseTag("v0.1.0-beta.1"), "0.1.0-beta.1");
  assert.throws(() => parseReleaseTag("0.1.0"), /not a release tag/);
  assert.throws(() => parseReleaseTag("v1.2"), /not a release tag/);
});

test("tagFromEnv prefers RELEASE_TAG and ignores branch names", () => {
  assert.equal(tagFromEnv({ RELEASE_TAG: "v1.2.3", GITHUB_REF_NAME: "main" }), "v1.2.3");
  assert.equal(tagFromEnv({ GITHUB_REF_NAME: "v0.1.0-beta.1" }), "v0.1.0-beta.1");
  assert.equal(tagFromEnv({ GITHUB_REF_NAME: "main" }), "");
});

test("hyphenated versions are prereleases", () => {
  assert.equal(isPrerelease("0.1.0"), false);
  assert.equal(isPrerelease("0.1.0-beta.1"), true);
});

test("aligned fixture passes, tag must match", () => {
  const dir = alignedTree();
  try {
    assert.deepEqual(checkProjectVersions(dir, {}), { version: "0.1.0", tag: "" });
    assert.deepEqual(checkProjectVersions(dir, { RELEASE_TAG: "v0.1.0" }), {
      version: "0.1.0",
      tag: "v0.1.0",
    });
    assert.throws(
      () => checkProjectVersions(dir, { RELEASE_TAG: "v0.2.0" }),
      /tag v0\.2\.0 does not match version 0\.1\.0/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("backend drift fails the check", () => {
  const dir = alignedTree();
  try {
    writeFileSync(
      join(dir, "backend/pyproject.toml"),
      pyproject.replace('version = "0.1.0"', 'version = "0.2.0"'),
    );
    assert.throws(() => checkProjectVersions(dir, {}), /version mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("set-version updates package, lock, and pyproject together", () => {
  const dir = alignedTree();
  try {
    setProjectVersion(dir, "0.1.0-beta.1");
    assert.equal(JSON.parse(readFileSync(join(dir, "app/package.json"), "utf8")).version, "0.1.0-beta.1");
    const lock = JSON.parse(readFileSync(join(dir, "app/package-lock.json"), "utf8"));
    assert.equal(lock.version, "0.1.0-beta.1");
    assert.equal(lock.packages[""].version, "0.1.0-beta.1");
    assert.match(readFileSync(join(dir, "backend/pyproject.toml"), "utf8"), /^version = "0\.1\.0-beta\.1"$/m);
    assert.doesNotMatch(readFileSync(join(dir, "backend/pyproject.toml"), "utf8"), /target-version = "0\.1\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("set-version CLI rejects missing and invalid versions", () => {
  const dir = alignedTree();
  try {
    const missing = spawnSync(process.execPath, [setCli], { cwd: dir, encoding: "utf8" });
    assert.equal(missing.status, 2);
    const invalid = spawnSync(process.execPath, [setCli, "1.0"], { cwd: dir, encoding: "utf8" });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /not a semver version/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lock bump requires both athena-shell version fields", () => {
  assert.throws(() => bumpLockVersions('{ "version": "0.1.0" }\n', "0.2.0"), /expected 2/);
  const bumped = bumpLockVersions(packageLock, "0.2.0");
  assert.equal(JSON.parse(bumped).version, "0.2.0");
  assert.equal(JSON.parse(bumped).packages[""].version, "0.2.0");
  assert.equal(JSON.parse(bumpPackageVersion(packageJson, "0.2.0")).version, "0.2.0");
  assert.match(bumpPyprojectVersion(pyproject, "0.2.0"), /^version = "0\.2\.0"$/m);
});
