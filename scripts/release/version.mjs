/**
 * Athena release version: app/package.json is the in-tree source,
 * Git tag vX.Y.Z is the public identity, GitHub Release is the record.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const RELEASE_TAG = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

export function isPrerelease(version) {
  return String(version).includes("-");
}

export function parseReleaseTag(tag) {
  const match = String(tag || "").trim().match(RELEASE_TAG);
  if (!match) throw new Error(`not a release tag: ${tag}`);
  return match[1];
}

export function tagFromEnv(env = process.env) {
  const explicit = String(env.RELEASE_TAG || "").trim();
  if (explicit) return explicit;
  const ref = String(env.GITHUB_REF_NAME || "").trim();
  if (RELEASE_TAG.test(ref)) return ref;
  return "";
}

export function readAppVersion(root) {
  const pkg = JSON.parse(readFileSync(join(root, "app/package.json"), "utf8"));
  return String(pkg.version || "");
}

export function readLockVersions(root) {
  const lock = JSON.parse(readFileSync(join(root, "app/package-lock.json"), "utf8"));
  return {
    root: String(lock.version || ""),
    package: String(lock.packages?.[""]?.version || ""),
  };
}

export function readBackendVersion(root) {
  const text = readFileSync(join(root, "backend/pyproject.toml"), "utf8");
  const match = text.match(/^version = "([^"]+)"/m);
  if (!match) throw new Error("backend/pyproject.toml is missing version");
  return match[1];
}

export function readBackendLockVersion(root) {
  const text = readFileSync(join(root, "backend/uv.lock"), "utf8");
  const match = text.match(
    /\[\[package\]\]\r?\nname = "daou-athena-backend"\r?\nversion = "([^"]+)"/,
  );
  if (!match) throw new Error("backend/uv.lock is missing daou-athena-backend version");
  return match[1];
}

export function bumpLockVersions(raw, version) {
  let seen = 0;
  const next = raw.replace(
    /("name": "athena-shell",\r?\n\s*"version": ")([^"]+)(")/g,
    (_, prefix, _old, suffix) => {
      seen += 1;
      return `${prefix}${version}${suffix}`;
    },
  );
  if (seen !== 2) {
    throw new Error(`package-lock.json: expected 2 athena-shell version fields, found ${seen}`);
  }
  return next;
}

export function bumpPyprojectVersion(raw, version) {
  const next = raw.replace(/^version = "[^"]+"/m, `version = "${version}"`);
  if (!/^version = "/m.test(raw)) {
    throw new Error("backend/pyproject.toml version field not found");
  }
  return next;
}

export function bumpBackendLockVersion(raw, version) {
  let seen = 0;
  const next = raw.replace(
    /(\[\[package\]\]\r?\nname = "daou-athena-backend"\r?\nversion = ")([^"]+)(")/g,
    (_, prefix, _old, suffix) => {
      seen += 1;
      return `${prefix}${version}${suffix}`;
    },
  );
  if (seen !== 1) {
    throw new Error(`backend/uv.lock: expected 1 daou-athena-backend version field, found ${seen}`);
  }
  return next;
}

export function bumpPackageVersion(raw, version) {
  const next = raw.replace(/^(\s*"version": ")([^"]+)(")/m, `$1${version}$3`);
  if (next === raw && !raw.includes(`"version": "${version}"`)) {
    throw new Error("app/package.json version field not found");
  }
  return next;
}

export function checkProjectVersions(root, env = process.env) {
  const app = readAppVersion(root);
  const lock = readLockVersions(root);
  const backend = readBackendVersion(root);
  const backendLock = readBackendLockVersion(root);
  const versions = {
    app,
    "package-lock": lock.root,
    "package-lock packages['']": lock.package,
    backend,
    "backend uv.lock": backendLock,
  };
  for (const [name, value] of Object.entries(versions)) {
    if (!SEMVER.test(value)) {
      throw new Error(`${name} version is not semver: ${value}`);
    }
  }
  if (lock.root !== app || lock.package !== app || backend !== app || backendLock !== app) {
    throw new Error(
      `version mismatch: app=${app} lock=${lock.root}/${lock.package} backend=${backend}/${backendLock}`,
    );
  }
  const tag = tagFromEnv(env);
  if (tag) {
    const tagged = parseReleaseTag(tag);
    if (tagged !== app) {
      throw new Error(`tag ${tag} does not match version ${app}`);
    }
  }
  return { version: app, tag };
}

export function setProjectVersion(root, version) {
  if (!SEMVER.test(version)) {
    throw new Error(`not a semver version: ${version}`);
  }
  const pkgPath = join(root, "app/package.json");
  const lockPath = join(root, "app/package-lock.json");
  const pyPath = join(root, "backend/pyproject.toml");
  const backendLockPath = join(root, "backend/uv.lock");
  const nextPackage = bumpPackageVersion(readFileSync(pkgPath, "utf8"), version);
  const nextLock = bumpLockVersions(readFileSync(lockPath, "utf8"), version);
  const nextPyproject = bumpPyprojectVersion(readFileSync(pyPath, "utf8"), version);
  const nextBackendLock = bumpBackendLockVersion(
    readFileSync(backendLockPath, "utf8"),
    version,
  );
  writeFileSync(pkgPath, nextPackage);
  writeFileSync(lockPath, nextLock);
  writeFileSync(pyPath, nextPyproject);
  writeFileSync(backendLockPath, nextBackendLock);
  return checkProjectVersions(root, {});
}
