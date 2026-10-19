import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isForbiddenPublicSubtreePath, isKeepPath } from "./keepset.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC_ROOTS = new Set(["web", "presentation"]);
const ALLOWED_MODES = new Set(["100644", "100755"]);
const LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";
const TEMP_PREFIX = "athena-public-artifacts-";

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(resolve(left)) === normalize(resolve(right));
}

function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function assertPublicGitPath(path) {
  if (!path || isAbsolute(path) || path.includes("\\") || /[\0\r\n]/.test(path)) {
    throw new Error(`invalid public Git path: ${JSON.stringify(path)}`);
  }
  const normalized = posix.normalize(path);
  if (normalized !== path || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`escaping public Git path: ${JSON.stringify(path)}`);
  }
  const root = path.split("/", 1)[0];
  if (!PUBLIC_ROOTS.has(root) || path === root) {
    throw new Error(`path outside public subtrees: ${JSON.stringify(path)}`);
  }
  if (isForbiddenPublicSubtreePath(path) || !isKeepPath(path)) {
    throw new Error(`forbidden public Git path: ${JSON.stringify(path)}`);
  }
  return path;
}

export function parseStagedEntries(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean).map((record) => {
    const match = /^(\d{6}) ([0-9a-f]+) (\d)\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error("unparseable git index entry");
    const [, mode, , stage, path] = match;
    if (!ALLOWED_MODES.has(mode) || stage !== "0") {
      throw new Error(`unsupported public index entry: mode=${mode} stage=${stage}`);
    }
    return { mode, path: assertPublicGitPath(path) };
  });
}

export function parseLfsPaths(buffer) {
  return buffer.toString("utf8").split(/\r?\n/).filter(Boolean)
    .filter((path) => PUBLIC_ROOTS.has(path.split("/", 1)[0]))
    .map(assertPublicGitPath);
}

function assertSourceBoundary(root, path) {
  const rootReal = realpathSync.native(root);
  const parts = path.split("/");
  const publicRoot = resolve(root, parts[0]);
  const expectedPublicReal = resolve(rootReal, parts[0]);
  if (!samePath(realpathSync.native(publicRoot), expectedPublicReal)) {
    throw new Error(`public subtree reparse boundary: ${parts[0]}`);
  }

  let current = publicRoot;
  for (const part of parts.slice(1)) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`public path uses a reparse link: ${path}`);
  }

  const sourceReal = realpathSync.native(current);
  const expectedReal = resolve(rootReal, ...parts);
  if (!samePath(sourceReal, expectedReal) || !isWithin(expectedPublicReal, sourceReal)) {
    throw new Error(`public path escapes its subtree: ${path}`);
  }
  if (!lstatSync(current).isFile()) throw new Error(`public path is not a regular file: ${path}`);
  return current;
}

export function isMaterializedLfsFile(path) {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(128);
    const size = readSync(descriptor, buffer, 0, buffer.length, 0);
    return !buffer.subarray(0, size).toString("utf8").startsWith(LFS_POINTER_PREFIX);
  } finally {
    closeSync(descriptor);
  }
}

export function materializePublicFiles(root, destination, entries, lfsPaths) {
  const indexedPaths = new Set(entries.map(({ path }) => path));
  for (const path of lfsPaths) {
    if (!indexedPaths.has(path)) throw new Error(`LFS path is not indexed: ${path}`);
  }

  for (const { path } of entries) {
    const source = assertSourceBoundary(root, path);
    if (lfsPaths.has(path) && !isMaterializedLfsFile(source)) {
      throw new Error(`LFS file is not materialized: ${path}`);
    }
    const target = resolve(destination, ...path.split("/"));
    if (!isWithin(destination, target)) throw new Error(`temporary path escape: ${path}`);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding,
    input: undefined,
    stdio: ["ignore", options.capture ? "pipe" : "inherit", "inherit"],
  });
}

function removeTemporaryDirectory(directory, base) {
  const baseReal = realpathSync.native(base);
  const directoryReal = realpathSync.native(directory);
  if (!isWithin(baseReal, directoryReal) || !samePath(dirname(directoryReal), baseReal) ||
      !basename(directoryReal).startsWith(TEMP_PREFIX) || lstatSync(directory).isSymbolicLink()) {
    throw new Error("refusing unsafe public-artifact cleanup");
  }
  rmSync(directory, { recursive: true, force: false });
}

export function checkPublicArtifacts({
  root = ROOT,
  tempBase = tmpdir(),
  runCommand = run,
  removeDirectory = removeTemporaryDirectory,
} = {}) {
  const entries = parseStagedEntries(runCommand("git", [
    "-C", root, "ls-files", "--stage", "-z", "--", "web", "presentation",
  ], { capture: true }));
  if (entries.length === 0) throw new Error("no indexed public artifacts found");

  const lfsPaths = new Set(parseLfsPaths(runCommand("git", [
    "-C", root, "lfs", "ls-files", "-n",
  ], { capture: true })));
  const baseReal = realpathSync.native(tempBase);
  const temporaryDirectory = mkdtempSync(join(baseReal, TEMP_PREFIX));
  let primaryError;
  try {
    materializePublicFiles(root, temporaryDirectory, entries, lfsPaths);
    const config = join(temporaryDirectory, "presentation", "scripts", "security", "gitleaks.toml");
    runCommand("gitleaks", [
      "dir", temporaryDirectory,
      "--no-banner", "--redact=100", "--ignore-gitleaks-allow",
      "--max-archive-depth", "2", "--max-decode-depth", "3", "--config", config,
    ]);
    runCommand("git", ["-C", root, "lfs", "fsck"]);
  } catch (error) {
    primaryError = error;
  }

  try {
    removeDirectory(temporaryDirectory, baseReal);
  } catch (cleanupError) {
    if (primaryError) {
      throw new AggregateError([primaryError, cleanupError],
        `public artifact check failed and cleanup failed: ${primaryError.message}; ${cleanupError.message}`);
    }
    throw cleanupError;
  }
  if (primaryError) throw primaryError;

  console.log(`public-artifacts ok tracked=${entries.length} lfs=${lfsPaths.size}`);
  return { tracked: entries.length, lfs: lfsPaths.size };
}

if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  try {
    checkPublicArtifacts();
  } catch (error) {
    console.error(`public-artifacts failed: ${error.message}`);
    process.exit(1);
  }
}
