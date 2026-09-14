import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function listUntrackedFiles(root) {
  const output = execFileSync("git", [
    "-C", root,
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignored=no",
    "--ignore-submodules=all",
  ], { encoding: "utf8" });
  return output
    .split("\0")
    .filter((entry) => entry.startsWith("?? "))
    .map((entry) => entry.slice(3));
}

export function checkInstallerSources(root) {
  const untracked = listUntrackedFiles(root);
  if (untracked.length > 0) {
    throw new Error([
      "Untracked files are excluded from installer staging.",
      "Add intended source files, or remove/ignore local artifacts before building:",
      ...untracked.map((path) => `- ${path}`),
    ].join("\n"));
  }
  return { ok: true };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    checkInstallerSources(resolve(process.argv[2] || process.cwd()));
    console.log("installer sources ok");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
