import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// These policy tests must not load Electron safeStorage or a user's MCP secrets.
const envModulePath = require.resolve('./mcp-env');
const previousEnvModule = require.cache[envModulePath];
require.cache[envModulePath] = { id: envModulePath, filename: envModulePath, loaded: true,
  exports: { buildEnvOverrides() { throw new Error('Policy tests must not read runtime secrets'); } } };
const { DISABLED_FEATURES, buildCodexAppServerArgs, createMcpAudit, gatewayEnvVarNames } = require('./codex-chat-runtime');
if (previousEnvModule) require.cache[envModulePath] = previousEnvModule;
else delete require.cache[envModulePath];
const gateway = { command: 'fixture-gateway', args: ['serve'], env: {} };
const allowedTools = ['mcp__athena__athena_search', 'mcp__athena__athena_call'];

function auditInput() {
  return {
    configAudit: { config: {
      web_search: 'disabled',
      features: { ...Object.fromEntries(DISABLED_FEATURES.map(name => [name, false])), code_mode_host: true },
      mcp_servers: { athena: { ...gateway, required: true, enabled_tools: ['athena_call', 'athena_search'] } },
    } },
    servers: [{ name: 'athena', tools: [{ name: 'athena_search' }, { name: 'athena_call' }] }],
  };
}

test('spawn explicitly enables code-mode execution while disabling other capabilities', () => {
  const args = buildCodexAppServerArgs({ gateway, allowedTools });
  assert.equal(args[args.indexOf('--enable') + 1], 'code_mode_host');
  const disabled = args.flatMap((value, index) => value === '--disable' ? [args[index + 1]] : []);
  assert.ok(!disabled.includes('code_mode_host'));
  for (const name of ['shell_tool', 'computer_use', 'browser_use', 'apps', 'plugins', 'multi_agent']) {
    assert.ok(disabled.includes(name), `${name} stays disabled`);
  }
  assert.ok(args.includes('web_search="disabled"'));
});

test('audit requires enabled code-mode host and the exact approved Athena tool inventory', () => {
  const audit = createMcpAudit(allowedTools, gateway);
  assert.equal(audit.validate(auditInput()), true);
  for (const enabled of [false, undefined]) {
    const input = auditInput();
    input.configAudit.config.features.code_mode_host = enabled;
    assert.throws(() => audit.validate(input), { code: 'CODEX_BUILTIN_POLICY_MISMATCH' });
  }
  const extraTool = auditInput();
  extraTool.servers[0].tools.push({ name: 'unapproved_tool' });
  assert.throws(() => audit.validate(extraTool), { code: 'CODEX_MCP_TOOL_INVENTORY_MISMATCH' });
});

test('enabling code-mode does not weaken shell or external-server restrictions', () => {
  const audit = createMcpAudit(allowedTools, gateway);
  const shell = auditInput();
  shell.configAudit.config.features.shell_tool = true;
  assert.throws(() => audit.validate(shell), { code: 'CODEX_BUILTIN_POLICY_MISMATCH' });
  const external = auditInput();
  external.configAudit.config.mcp_servers.other = { command: 'external' };
  assert.throws(() => audit.validate(external), { code: 'CODEX_MCP_CONFIG_MISMATCH' });
});


test('upstream credentials cross the MCP subprocess boundary by name, never value', () => {
  const overrides = {
    ATHENA_MCP_ENV__naver_news__NCP_APIGW_API_KEY: 'fixture-private-value',
    ATHENA_MCP_ENV__discord__DISCORD_TOKEN: 'fixture-discord-value',
    UNRELATED_SECRET: 'must-not-forward',
  };
  const names = gatewayEnvVarNames(overrides, { ATHENA_MCP_REGISTRY_PATH: 'fixture-registry', PATH: 'system-path' });
  assert.deepEqual(names, ['ATHENA_MCP_ENV__discord__DISCORD_TOKEN',
    'ATHENA_MCP_ENV__naver_news__NCP_APIGW_API_KEY', 'ATHENA_MCP_REGISTRY_PATH']);
  const configured = { ...gateway, env_vars: names };
  const args = buildCodexAppServerArgs({ gateway: configured, allowedTools });
  const text = args.join(' ');
  assert.ok(text.includes('env_vars = ['));
  for (const name of names) assert.ok(text.includes(name));
  for (const value of Object.values(overrides)) assert.ok(!text.includes(value));
  const input = auditInput();
  input.configAudit.config.mcp_servers.athena.env_vars = names;
  const audit = createMcpAudit(allowedTools, configured);
  assert.equal(audit.validate(input), true);
  input.configAudit.config.mcp_servers.athena.env_vars = [];
  assert.throws(() => audit.validate(input), { code: 'CODEX_MCP_CONFIG_MISMATCH' });
  input.configAudit.config.mcp_servers.athena.env_vars = [...names, 'UNRELATED_SECRET'];
  assert.throws(() => audit.validate(input), { code: 'CODEX_MCP_CONFIG_MISMATCH' });
});
