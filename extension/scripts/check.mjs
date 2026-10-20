import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const explicitOutput = process.env.ATHENA_EXTENSION_OUTPUT;
const outputRoot = explicitOutput
  ? resolve(explicitOutput)
  : await mkdtemp(resolve(tmpdir(), "athena-wts-extension-check-"));
const EXPECTED_AXIS_VARIANT_SHA256 = "7ae82ad415d76d0e4926ac34b7711931a35ba9f28572639a1a12230569beac48";
const EXPECTED_UPSTREAM_521_SHA256 = "faf0924968b1cbb9ea5bb6baa43a27ed6a0802341c07238b72ae869ffebab90c";
const EXPECTED_LICENSE_SHA256 = "70c9d5382506dd184465425c08a99ad9bd6d9ac1313c252968ba0b585e5ef823";
const EXPECTED_NOTICE_SHA256 = "0113d041489a7d311dc241018d213f2b16f7977f6def008def32c77d0afbde30";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

try {
  execFileSync(process.execPath, [resolve(root, "scripts", "build.mjs")], {
    stdio: "inherit",
    env: {
      ...process.env,
      ATHENA_EXTENSION_OUTPUT: explicitOutput || outputRoot,
    },
  });

  for (const file of await walk(outputRoot)) {
    if (file.endsWith(".mjs")) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
  }

  const manifest = JSON.parse(await readFile(resolve(outputRoot, "manifest.json"), "utf8"));
  const expectedPermissions = ["nativeMessaging", "scripting", "sidePanel", "storage"];
  if (JSON.stringify(manifest.permissions) !== JSON.stringify(expectedPermissions)) {
    throw new Error("manifest permissions differ from the reviewed minimum");
  }
  if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(["https://wts.kiwoom.com/*"])) {
    throw new Error("manifest host permissions are broader than Kiwoom WTS");
  }
  if (manifest.externally_connectable || manifest.content_security_policy?.extension_pages?.includes("http")) {
    throw new Error("manifest enables an unreviewed external connection or remote script policy");
  }
  const chartLicense = await readFile(resolve(outputRoot, "sidepanel", "vendor", "lightweight-charts-axis.LICENSE.txt"));
  const chartNotice = await readFile(resolve(outputRoot, "sidepanel", "vendor", "lightweight-charts-axis.NOTICE.txt"));
  const chartModule = await readFile(resolve(outputRoot, "sidepanel", "vendor", "lightweight-charts-axis.mjs"));
  const upstreamModule = await readFile(resolve(root, "..", "app", "node_modules", "lightweight-charts", "dist", "lightweight-charts.production.mjs"));
  if (sha256(chartModule) !== EXPECTED_AXIS_VARIANT_SHA256 ||
      sha256(upstreamModule) !== EXPECTED_UPSTREAM_521_SHA256 ||
      sha256(chartLicense) !== EXPECTED_LICENSE_SHA256 ||
      sha256(chartNotice) !== EXPECTED_NOTICE_SHA256 ||
      EXPECTED_AXIS_VARIANT_SHA256 === EXPECTED_UPSTREAM_521_SHA256) {
    throw new Error("reviewed Lightweight Charts variant, upstream pin, license, or notice hash differs");
  }
  if (!chartLicense.toString("utf8").includes("Apache License") ||
      !chartModule.toString("utf8").includes("Lightweight Charts™ v5.2.1") ||
      !chartNotice.toString("utf8").includes("time-axis label alignment variant")) {
    throw new Error("reviewed Lightweight Charts 5.2.1 asset or license is missing");
  }
  console.log("Extension static checks passed");
} finally {
  if (!explicitOutput) await rm(outputRoot, { recursive: true, force: true });
}
