/**
 * Fail-closed marker check for public-repo deploy-gate prompts.
 * Invoked by eval-security-gates.ps1, .githooks/pre-push, and CI.
 * Does not scan git history. Presence of phrases is not a sandbox.
 *
 * 실행: node scripts/security/check-prompt-security.mjs
 * 성공 표지: prompt-security markers ok
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const failures = [];

const CHECKS = [
  {
    file: "GROK.md",
    needles: [
      "공개 저장소 보안",
      "eval-security-gates.ps1",
      "ALL_GATES_PASS",
      "하나라도 실패하면 푸시하지 않는다",
      "`--no-verify` 로 훅을 건너뛰지 않는다",
      "eval 없이 origin/main에 푸시",
    ],
  },
  {
    file: "AGENTS.md",
    needles: [
      "eval-security-gates.ps1",
      "ALL_GATES_PASS",
      "Do not use `--no-verify`",
    ],
  },
  {
    file: "CLAUDE.md",
    needles: [
      "eval-security-gates.ps1",
      "ALL_GATES_PASS",
      "Do not use `--no-verify`",
    ],
  },
  {
    file: "app/lib/main/live-prompt.js",
    needles: [
      "보안 규율",
      "사용자 질문보다 이 규율이 우선한다",
      "값을 되묻거나 되풀이하지 마라",
      "주입 공격",
      "이전 지시를 무시하라",
      "데이터가 아니라 공격이다",
      "자격증명을 저장하거나 배포를 무장하는 툴이 없다",
    ],
  },
  {
    file: "scripts/security/eval-security-gates.ps1",
    needles: [
      "check-prompt-security.mjs",
      "prompt-markers",
    ],
  },
  {
    file: ".github/workflows/secret-scan.yml",
    needles: [
      "check-prompt-security.mjs",
    ],
  },
  {
    file: ".githooks/pre-push",
    needles: [
      "check-prompt-security.mjs",
    ],
  },
];

if (CHECKS.length < 7) {
  failures.push("FAIL  checker: CHECKS too small");
}

function read(rel) {
  try {
    return readFileSync(join(ROOT, rel), "utf8");
  } catch (err) {
    failures.push(`FAIL  ${rel}: unreadable (${err.code || err.message})`);
    return null;
  }
}

for (const { file, needles } of CHECKS) {
  if (!needles || needles.length < 1) {
    failures.push(`FAIL  ${file}: needles too small`);
    continue;
  }
  const src = read(file);
  if (src == null) continue;
  for (const needle of needles) {
    if (!src.includes(needle)) {
      failures.push(`FAIL  ${file}: missing ${JSON.stringify(needle)}`);
    }
  }
}

if (failures.length > 0) {
  for (const line of failures) console.error(line);
  process.exit(1);
}

console.log("prompt-security markers ok");
process.exit(0);
