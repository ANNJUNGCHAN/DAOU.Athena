import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const hook = fileURLToPath(new URL('../../.githooks/pre-push', import.meta.url));
const bash = process.env.ATHENA_BASH || (process.platform === 'win32'
  ? join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe') : 'bash');

function runHook(mode, bypass = '', input = '') {
  const directory = mkdtempSync(join(tmpdir(), 'athena-push-hook-'));
  const environment = join(directory, 'environment.sh');
  writeFileSync(environment, `
git() {
  if [[ "$1" == 'rev-parse' ]]; then printf '%s\\n' "$ATHENA_TEST_ROOT"; return 0; fi
  if [[ "$1 $2" == 'lfs pre-push' ]]; then
    printf '%s\\n' "$*" > "$ATHENA_LFS_LOG"
    cat >> "$ATHENA_LFS_LOG"
    return 0
  fi
  return 0
}
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
    const lfsLog = join(directory, 'lfs.log');
    const result = spawnSync(bash, ['--noprofile', '--norc', hook.replaceAll('\\', '/'),
      'origin', 'https://github.com/example/athena.git'], {
      encoding: 'utf8', timeout: 10000, input,
      env: { ...process.env, BASH_ENV: environment.replaceAll('\\', '/'),
        ATHENA_TEST_ROOT: resolve(directory).replaceAll('\\', '/'), ATHENA_TEST_MODE: mode,
        ATHENA_SKIP_PUSH_PROTECTION_CHECK: bypass,
        ATHENA_LFS_LOG: lfsLog.replaceAll('\\', '/') },
    });
    assert.ifError(result.error);
    return { ...result, lfsLog: existsSync(lfsLog) ? readFileSync(lfsLog, 'utf8') : '' };
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('athena-push-hook-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('public push is allowed only after a successful enabled response', () => {
  assert.equal(runHook('enabled').status, 0);
});

test('successful security gates forward arguments and ref updates to Git LFS', () => {
  const refs = 'local remote refs/heads/main refs/heads/main\\n';
  const result = runHook('enabled', '', refs);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.lfsLog, /^lfs pre-push origin https:\/\/github\.com\/example\/athena\.git$/m);
  assert.match(result.lfsLog, /local remote refs\/heads\/main refs\/heads\/main/);
});

for (const mode of ['missing', 'error', 'empty', 'disabled', 'unknown']) {
  test(`public push fails closed when GitHub protection is ${mode}`, () => {
    const result = runHook(mode);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.lfsLog, '', 'Git LFS must not run after a failed security gate');
  });
}

test('legacy bypass cannot permit disabled protection', () => {
  assert.notEqual(runHook('disabled', '1').status, 0);
});
