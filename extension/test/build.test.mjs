import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const extensionRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(extensionRoot, "..");

async function snapshot(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = {};
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    result[entry.name] = entry.isDirectory() ? await snapshot(path) : await readFile(path);
  }
  return result;
}

test("temporary static check packages exact canonical contracts and constrained manifest", async () => {
  const output = await mkdtemp(resolve(tmpdir(), "athena-wts-extension-"));
  try {
    execFileSync(process.execPath, [resolve(extensionRoot, "scripts", "check.mjs")], {
      stdio: "pipe",
      env: { ...process.env, ATHENA_EXTENSION_OUTPUT: output },
    });
    for (const name of ["wts-foundation.mjs", "wts-foundation.protocol.schema.json"]) {
      const canonical = await readFile(resolve(repositoryRoot, "contracts", name));
      const packaged = await readFile(resolve(output, "contracts", name));
      assert.deepEqual(packaged, canonical);
    }
    const generatedSchema = await import(`${pathToFileURL(resolve(output, "contracts", "wts-foundation.schema.mjs")).href}?test=${Date.now()}`);
    const canonicalSchema = JSON.parse(await readFile(resolve(repositoryRoot, "contracts", "wts-foundation.protocol.schema.json"), "utf8"));
    assert.deepEqual(generatedSchema.default, canonicalSchema);
    const manifest = JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8"));
    const packageMetadata = JSON.parse(await readFile(resolve(extensionRoot, "package.json"), "utf8"));
    assert.deepEqual(manifest.permissions, ["nativeMessaging", "scripting", "sidePanel", "storage"]);
    assert.deepEqual(manifest.host_permissions, ["https://wts.kiwoom.com/*"]);
    assert.equal(manifest.externally_connectable, undefined);
    assert.equal(manifest.version, "0.8.0");
    assert.equal(packageMetadata.version, manifest.version);
    assert.match(manifest.description, /금융 카드를 표시합니다/u);

    for (const name of [
      "facts-card.js", "board-format.js", "chart-card.js", "aits-chart-panel.js", "lightweight-charts-axis.mjs",
      "lightweight-charts-axis.LICENSE.txt", "lightweight-charts-axis.NOTICE.txt",
    ]) {
      assert.deepEqual(
        await readFile(resolve(output, "sidepanel", "vendor", name)),
        await readFile(resolve(repositoryRoot, "app", "lib", name)),
        `${name} must be copied byte-for-byte from the reviewed local renderer`,
      );
    }
    await assert.rejects(readFile(resolve(output, "sidepanel", "vendor", "canvas-layout.js")), { code: "ENOENT" });

    const marketAdapterPath = resolve(output, "wts", "market-navigation-adapter.mjs");
    await readFile(marketAdapterPath, "utf8");
    execFileSync(process.execPath, ["--check", marketAdapterPath], { stdio: "pipe" });

    const workerSource = await readFile(resolve(output, "service-worker.mjs"), "utf8");
    assert.doesNotMatch(workerSource, /\bawait\s+fetch\b|\bimport\s*\(/);
    const listeners = [];
    const previousChrome = globalThis.chrome;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error("service worker startup must not fetch"); };
    globalThis.chrome = {
      runtime: {
        id: "mhbcjkjmgabekcakpilhgkgeedhkjfee",
        getURL: (path) => `chrome-extension://mhbcjkjmgabekcakpilhgkgeedhkjfee/${path}`,
        connectNative: () => { throw new Error("not called during startup"); },
        sendMessage: async () => {},
        onMessage: { addListener: (listener) => listeners.push(listener) },
        onConnect: { addListener() {} },
      },
      sidePanel: {
        setPanelBehavior: async () => {},
        setOptions: async () => {},
      },
      tabs: {
        onUpdated: { addListener() {} },
        onActivated: { addListener() {} },
        query: async () => [],
      },
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    };
    try {
      await import(`${pathToFileURL(resolve(output, "service-worker.mjs")).href}?startup=${Date.now()}`);
      assert.equal(listeners.length, 1);
    } finally {
      globalThis.chrome = previousChrome;
      globalThis.fetch = previousFetch;
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("build rejects an unsafe foreign output and preserves its sentinel", async () => {
  const unsafeRoot = resolve(tmpdir(), `foreign-athena-output-${process.pid}-${Date.now()}`);
  const sentinel = resolve(unsafeRoot, "sentinel.txt");
  await mkdir(unsafeRoot, { recursive: true });
  await writeFile(sentinel, "do not remove", "utf8");
  try {
    assert.throws(() => execFileSync(process.execPath, [resolve(extensionRoot, "scripts", "build.mjs")], {
      stdio: "pipe",
      env: { ...process.env, ATHENA_EXTENSION_OUTPUT: unsafeRoot },
    }));
    assert.equal(await readFile(sentinel, "utf8"), "do not remove");
  } finally {
    await rm(unsafeRoot, { recursive: true, force: true });
  }
});

test("default static check uses a temporary build and leaves dist byte-for-byte untouched", async () => {
  const dist = resolve(extensionRoot, "dist");
  const before = await snapshot(dist);
  const env = { ...process.env };
  delete env.ATHENA_EXTENSION_OUTPUT;
  execFileSync(process.execPath, [resolve(extensionRoot, "scripts", "check.mjs")], {
    stdio: "pipe",
    env,
  });
  assert.deepEqual(await snapshot(dist), before);
});
