'use strict';

function probeCodexVersion(runtime, timeoutMs = 5_000) {
  return new Promise((resolve) => {
    let child;
    let output = '';
    let timer;
    let settled = false;
    const finish = (version = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ cliStatus: version ? 'available' : 'unavailable', cliVersion: version });
    };
    try {
      child = runtime.spawnPrivateHomeCommand(['--version'], {
        timeoutMs, stdio: ['ignore', 'pipe', 'ignore'],
      });
      child.stdout.on('data', (chunk) => {
        // Only an exact version line is returned; arbitrary CLI output is never displayed.
        if (output.length < 4096) output += String(chunk).slice(0, 4096 - output.length);
      });
      child.once('error', () => finish());
      child.once('close', (code, signal) => {
        const match = output.trim().match(/^codex-cli ([0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9.+-]*)$/);
        finish(code === 0 && !signal && match ? match[1] : null);
      });
      timer = setTimeout(() => {
        try { child.kill(); } catch { /* The status remains unavailable. */ }
        finish();
      }, timeoutMs);
    } catch { finish(); }
  });
}

function connectionDiagnostics(version, loginStatus) {
  return {
    ...version,
    authentication: loginStatus === 'connected' ? 'authenticated'
      : loginStatus === 'disconnected' ? 'not-authenticated' : 'unknown',
  };
}

module.exports = { probeCodexVersion, connectionDiagnostics };
