import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(extensionRoot, "..");
const sourceRoot = resolve(extensionRoot, "src");
const defaultOutputRoot = resolve(extensionRoot, "dist");
const explicitOutput = process.env.ATHENA_EXTENSION_OUTPUT;
const outputRoot = explicitOutput ? resolve(explicitOutput) : defaultOutputRoot;
const contractNames = ["wts-foundation.mjs", "wts-foundation.protocol.schema.json"];
const browserSafeChartFiles = [
  "facts-card.js",
  "board-format.js",
  "ui-kit.js",
  "chart-resample.js",
  "chart-indicator-registry.js",
  "chart-indicators.js",
  "chart-indicator-render.js",
  "chart-volume-profile.js",
  "chart-authoring-store.js",
  "chart-drawings.js",
  "chart-toolbar.js",
  "chart-indicator-panel.js",
  "chart-card.js",
  "chart-tick-fold.js",
  "aits-chart-panel.js",
  "lightweight-charts-axis.mjs",
  "lightweight-charts-axis.LICENSE.txt",
  "lightweight-charts-axis.NOTICE.txt",
];
const ownershipMarker = ".athena-wts-build-output";
const ownershipText = "ATHENA WTS extension build output v1\n";

function isSameOrAncestor(candidate, target) {
  const path = relative(candidate, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function rejectSymlinkChain(path) {
  let current = path;
  while (true) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Build output cannot use a symlink: ${current}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function validateOutputRoot() {
  if (explicitOutput && !isAbsolute(explicitOutput)) {
    throw new Error("ATHENA_EXTENSION_OUTPUT must be an absolute path");
  }
  for (const protectedPath of [repositoryRoot, extensionRoot, sourceRoot]) {
    if (isSameOrAncestor(outputRoot, protectedPath)) {
      throw new Error("Build output cannot be the repository, extension source, or an ancestor");
    }
  }
  if (isSameOrAncestor(sourceRoot, outputRoot)) {
    throw new Error("Build output cannot be inside the extension source directory");
  }
  if (explicitOutput) {
    const temporaryRoot = resolve(tmpdir());
    if (dirname(outputRoot) !== temporaryRoot || !basename(outputRoot).startsWith("athena-wts-extension-")) {
      throw new Error("Explicit build output must be a direct ATHENA test directory under the OS temp directory");
    }
  } else if (outputRoot !== defaultOutputRoot) {
    throw new Error("Default build output path is invalid");
  }
  await rejectSymlinkChain(outputRoot);

  let entries;
  try { entries = await readdir(outputRoot); } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (entries.length === 0) return;
  const marker = resolve(outputRoot, ownershipMarker);
  let markerText;
  try { markerText = await readFile(marker, "utf8"); } catch { markerText = null; }
  if (markerText !== ownershipText) {
    throw new Error("Refusing to replace a non-empty directory without the ATHENA build ownership marker");
  }
}

await validateOutputRoot();
await rm(outputRoot, { recursive: true, force: true });
await mkdir(resolve(outputRoot, "contracts"), { recursive: true });
await writeFile(resolve(outputRoot, ownershipMarker), ownershipText, "utf8");
await cp(sourceRoot, outputRoot, { recursive: true });

const vendorRoot = resolve(outputRoot, "sidepanel", "vendor");
await mkdir(vendorRoot, { recursive: true });
for (const name of browserSafeChartFiles) {
  await writeFile(
    resolve(vendorRoot, name),
    await readFile(resolve(repositoryRoot, "app", "lib", name)),
  );
}

for (const name of contractNames) {
  const source = resolve(repositoryRoot, "contracts", name);
  const destination = resolve(outputRoot, "contracts", name);
  await writeFile(destination, await readFile(source));
}
const canonicalSchemaText = await readFile(resolve(repositoryRoot, "contracts", "wts-foundation.protocol.schema.json"), "utf8");
const canonicalSchema = JSON.parse(canonicalSchemaText);
await writeFile(
  resolve(outputRoot, "contracts", "wts-foundation.schema.mjs"),
  `const schema = ${JSON.stringify(canonicalSchema)};\nexport default schema;\n`,
  "utf8",
);

const manifest = JSON.parse(await readFile(resolve(outputRoot, "manifest.json"), "utf8"));
const keyBytes = Buffer.from(manifest.key, "base64");
if (keyBytes.length === 0) throw new Error("manifest.key must contain a public key");
const alphabet = "abcdefghijklmnop";
const extensionId = createHash("sha256")
  .update(keyBytes)
  .digest("hex")
  .slice(0, 32)
  .split("")
  .map((digit) => alphabet[Number.parseInt(digit, 16)])
  .join("");

console.log(`Built ${outputRoot}`);
console.log(`Unpacked extension ID: ${extensionId}`);
