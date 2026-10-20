import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadHostConfig } from '../src/config.mjs';

const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';

async function writeConfig(root, overrides = {}) {
  const configPath = path.join(root, `host-${randomUUID()}.json`);
  await writeFile(configPath, JSON.stringify({
    hostName: 'com.athena.wts',
    allowedOrigin: ORIGIN,
    dataDir: path.join(root, 'data'),
    ...overrides,
  }), 'utf8');
  return configPath;
}

test('chart-only configuration keeps the read-only backend disabled', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-config-'));
  const config = await loadHostConfig(await writeConfig(root));
  assert.equal(config.backendRoot, null);
  assert.equal(config.pythonExecutable, null);
});

test('read-only backend paths must be an absolute pair', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-config-'));
  const backendRoot = path.join(root, 'backend');
  const pythonExecutable = path.join(root, 'python.exe');
  const configured = await loadHostConfig(await writeConfig(root, {
    backendRoot,
    pythonExecutable,
  }));
  assert.equal(configured.backendRoot, path.resolve(backendRoot));
  assert.equal(configured.pythonExecutable, path.resolve(pythonExecutable));

  for (const overrides of [
    { backendRoot },
    { pythonExecutable },
    { backendRoot: 'relative-backend', pythonExecutable },
    { backendRoot, pythonExecutable: 'relative-python' },
    { backendRoot: null, pythonExecutable },
  ]) {
    await assert.rejects(
      loadHostConfig(await writeConfig(root, overrides)),
      (error) => error.code === 'CONFIG_INVALID',
    );
  }
});
