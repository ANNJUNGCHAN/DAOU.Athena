/**
 * Fail if app, lockfile, and backend versions differ.
 * When RELEASE_TAG or a vX.Y.Z GITHUB_REF_NAME is set, that tag must match.
 *
 * 실행: node scripts/release/check-version.mjs
 * 성공 표지: version ok
 */

import { checkProjectVersions } from "./version.mjs";

try {
  const result = checkProjectVersions(process.cwd(), process.env);
  const tagNote = result.tag ? ` tag=${result.tag}` : "";
  console.log(`version ok ${result.version}${tagNote}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
