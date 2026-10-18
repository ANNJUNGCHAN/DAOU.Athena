import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const hook = fileURLToPath(new URL('../../.githooks/pre-push', import.meta.url));
const bash = process.env.ATHENA_BASH || (process.platform === 'win32'
  ? join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe') : 'bash');

function runHook(mode, bypass = '') {
  const directory = mkdtempSync(join(tmpdir(), 'athena-push-hook-'));
  const environment = join(directory, 'environment.sh');
  writeFileSync(environment, `
git() { printf '%s\\n' "$ATHENA_TEST_ROOT"; }
gitleaks() { return 0; }
node() { return 0; }
command() {
  if [[ "$*" == '-v gh' && "$ATHENA_TEST_MODE" == 'missing' ]]; then return 1; fi
  builtin command "$@"
}
gh() {
  case "$ATHENA_TEST_MODE" in
    enabled) printf 'enabled\\n' ;;
    disabled) printf 'disabled\\n' ;;
    empty) return 0 ;;
    error) printf 'authentication failed\\n' >&2; return 1 ;;
    *) printf 'null\\n' ;;
  esac
}
`);
  try {
    const result = spawnSync(bash, ['--noprofile', '--norc', hook.replaceAll('\\', '/')], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, BASH_ENV: environment.replaceAll('\\', '/'),
        ATHENA_TEST_ROOT: resolve(directory).replaceAll('\\', '/'), ATHENA_TEST_MODE: mode,
        ATHENA_SKIP_PUSH_PROTECTION_CHECK: bypass },
    });
    assert.ifError(result.error);
    return result;
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('athena-push-hook-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('public push is allowed only after a successful enabled response', () => {
  assert.equal(runHook('enabled').status, 0);
});

for (const mode of ['missing', 'error', 'empty', 'disabled', 'unknown']) {
  test(`public push fails closed when GitHub protection is ${mode}`, () => {
    const result = runHook(mode);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
  });
}

test('legacy bypass cannot permit disabled protection', () => {
  assert.notEqual(runHook('disabled', '1').status, 0);
});
