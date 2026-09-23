import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const configPath = resolve(dirname(fileURLToPath(import.meta.url)), "../windows-installer.config.cjs");
const environment = {
  ...process.env,
  ATHENA_INSTALLER_VERSION: "0.1.3",
  ATHENA_INSTALLER_PROJECT_DIR: "fixture/app",
  ATHENA_INSTALLER_BACKEND_DIR: "fixture/backend",
  ATHENA_INSTALLER_OUTPUT_DIR: "fixture/dist",
};

test("installer refuses to silently omit MCP runtimes", () => {
  const env = { ...environment };
  delete env.ATHENA_INSTALLER_MCP_RUNTIME_DIR;
  const result = spawnSync(process.execPath, ["-e", "require(process.argv[1])", configPath], { env, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ATHENA_INSTALLER_MCP_RUNTIME_DIR is required/);
});

test("installer ships MCP runtimes beside the backend outside app resources", () => {
  const result = spawnSync(process.execPath, ["-e", "console.log(JSON.stringify(require(process.argv[1]).extraResources))", configPath], {
    env: { ...environment, ATHENA_INSTALLER_MCP_RUNTIME_DIR: "fixture/mcp-runtime" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const resources = JSON.parse(result.stdout);
  assert.deepEqual(resources.find((entry) => entry.to === "mcp-runtime"), {
    from: resolve("fixture/mcp-runtime"), to: "mcp-runtime", filter: ["**/*"],
  });
  assert.equal(resources.find((entry) => entry.to === "backend").from, resolve("fixture/backend"));
});

test("installer uses the repository-owned destination guard from its snapshot", () => {
  const result = spawnSync(process.execPath, ["-e", "console.log(JSON.stringify(require(process.argv[1]).nsis))", configPath], {
    env: { ...environment, ATHENA_INSTALLER_MCP_RUNTIME_DIR: "fixture/mcp-runtime" }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const nsis = JSON.parse(result.stdout);
  assert.equal(nsis.include, resolve(dirname(configPath), "windows-installer.nsh"));
  assert.equal(nsis.allowToChangeInstallationDirectory, true);
  assert.equal(nsis.allowElevation, false);
  assert.equal(nsis.perMachine, false);
});
