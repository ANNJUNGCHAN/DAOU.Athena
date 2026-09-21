import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createCodexConfig } = require('./codex-config');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-codex-config-test-'));
  t.after(() => {
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('athena-codex-config-test-'));
    fs.rmSync(resolved, { recursive: true });
  });
  const legacy = path.join(dir, 'legacy'); fs.mkdirSync(legacy);
  const publicFile = path.join(legacy, 'config.toml');
  const config = createCodexConfig({ userDataPath: path.join(dir, 'athena'), env: { CODEX_HOME: legacy } });
  return { config, publicFile };
}

test('first read preserves only existing model/effort in Athena private home without changing public config', t => {
  const { config, publicFile } = fixture(t);
  const original = '# shared\nmodel = "gpt-6-astra"\nmodel_reasoning_effort = "medium"\nother_key = "fixture-private-value"\n';
  fs.writeFileSync(publicFile, original);
  assert.deepEqual(config.readModelSettings(), { model: 'gpt-6-astra', effort: 'medium', exists: true });
  assert.equal(fs.readFileSync(publicFile, 'utf8'), original);
  assert.doesNotMatch(fs.readFileSync(config.configPath(), 'utf8'), /other_key|fixture-private-value/);
  fs.writeFileSync(publicFile, 'model = "other-client-model"\nmodel_reasoning_effort = "low"\n');
  assert.equal(config.readModelSettings().model, 'gpt-6-astra');
});

test('model edits and defaults change only the private file and preserve other private settings', t => {
  const { config, publicFile } = fixture(t);
  fs.writeFileSync(publicFile, 'model = "shared-model"\n');
  fs.mkdirSync(config.codexHome(), { recursive: true });
  fs.writeFileSync(path.join(config.codexHome(), 'models_cache.json'), JSON.stringify({ models: [{ slug: 'gpt-6-astra', visibility: 'list' }] }));
  const extra = '# keep\n[features]\nshell_tool = false\n';
  fs.writeFileSync(config.configPath(), 'model = "private-model"\n' + extra);
  assert.equal(config.readModelSettings().model, 'private-model');
  assert.equal(config.writeModelSettings({ model: 'gpt-6-astra', effort: 'medium' }).ok, true);
  assert.ok(fs.readFileSync(config.configPath(), 'utf8').includes(extra));
  assert.equal(fs.readFileSync(publicFile, 'utf8'), 'model = "shared-model"\n');
  config.writeModelSettings({ model: null, effort: null });
  assert.equal(config.readModelSettings().model, null);
});

test('missing legacy settings freeze defaults locally; invalid edits do not create files', t => {
  const { config } = fixture(t);
  assert.equal(config.writeModelSettings({ effort: 'invalid' }).ok, false);
  assert.equal(fs.existsSync(config.configPath()), false);
  assert.deepEqual(config.readModelSettings(), { model: null, effort: null, exists: true });
});

test('only visible private cache models can be newly saved; absent cache preserves existing choice', t => {
  const { config, publicFile } = fixture(t);
  fs.writeFileSync(publicFile, 'model = "saved-model"\n');
  config.readModelSettings();
  assert.deepEqual(config.readModelCatalog(), { status: 'unavailable', models: [] });
  assert.equal(config.writeModelSettings({ model: 'invented-model' }).ok, false);
  assert.equal(config.readModelSettings().model, 'saved-model');
  fs.writeFileSync(path.join(config.codexHome(), 'models_cache.json'), JSON.stringify({
    identity: { value: 'fixture-private-identity' }, models: [
      { slug: 'gpt-6-astra', visibility: 'list' }, { slug: 'hidden-model', visibility: 'hide' },
    ],
  }));
  assert.deepEqual(config.readModelCatalog().models, ['gpt-6-astra']);
  assert.doesNotMatch(JSON.stringify(config.readModelCatalog()), /fixture-private-identity/);
  assert.equal(config.writeModelSettings({ model: 'hidden-model' }).ok, false);
  assert.equal(config.writeModelSettings({ model: 'gpt-6-astra' }).ok, true);
});
