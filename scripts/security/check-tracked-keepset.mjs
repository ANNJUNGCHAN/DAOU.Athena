/**
 * Fail-closed: every git-indexed path must be in the dest keep-set.
 * Invoked by eval-security-gates.ps1 and .githooks.
 *
 * 실행: node scripts/security/check-tracked-keepset.mjs
 * 성공 표지: tracked-keepset ok
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { forbiddenTrackedPaths } from "./keepset.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function listIndexedPaths(root = ROOT) {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "buffer",
  });
  return out
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

const forbidden = forbiddenTrackedPaths(listIndexedPaths(ROOT));
if (forbidden.length > 0) {
  const preview = forbidden.slice(0, 50);
  for (const p of preview) console.error(`FAIL  tracked outside keep-set: ${p}`);
  if (forbidden.length > preview.length) {
    console.error(`FAIL  ... ${forbidden.length - preview.length} more`);
  }
  process.exit(1);
}

console.log("tracked-keepset ok");
process.exit(0);
