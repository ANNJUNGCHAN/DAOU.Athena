/**
 * Set the in-tree release version in app/package.json, package-lock.json,
 * and backend/pyproject.toml. Does not commit or tag.
 *
 * 실행: node scripts/release/set-version.mjs 0.1.0-beta.1
 */

import { setProjectVersion } from "./version.mjs";

const version = String(process.argv[2] || "").trim();
if (!version) {
  console.error("usage: node scripts/release/set-version.mjs <semver>");
  process.exit(2);
}

try {
  setProjectVersion(process.cwd(), version);
  console.log(`version set to ${version}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
