import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

test("financial UI keeps secrets transient and exposes only explicit side-effect controls", async () => {
  const [html, panel, form, worker, control] = await Promise.all([
    readFile(resolve(root, "src", "sidepanel", "index.html"), "utf8"),
    readFile(resolve(root, "src", "sidepanel", "panel-financial.mjs"), "utf8"),
    readFile(resolve(root, "src", "sidepanel", "financial-form.mjs"), "utf8"),
    readFile(resolve(root, "src", "service-worker.mjs"), "utf8"),
    readFile(resolve(root, "src", "financial-control.mjs"), "utf8"),
  ]);
  assert.match(html, /id="financial-app-key" type="password"/u);
  assert.match(html, /id="financial-secret-key" type="password"/u);
  assert.match(form, /"button", "primary", "조회"/u);
  assert.match(html, /id="financial-query-stop"/u);
  assert.match(panel, /finally\s*\{\s*clearSecrets\(\)/u);
  assert.doesNotMatch(`${panel}\n${form}`, /chrome\.storage|localStorage|sessionStorage|indexedDB|\bfetch\s*\(/u);
  for (const method of [
    "source.credentials.status", "source.credentials.configure", "source.credentials.delete",
    "source.query.start", "source.query.status", "source.query.page", "source.query.continue", "source.query.cancel",
  ]) assert.match(`${worker}\n${control}`, new RegExp(method.replaceAll(".", "\\."), "u"));
});

test("financial panel never automatically retries a start, configure, delete, cancel, page, or continuation request", async () => {
  const panel = await readFile(resolve(root, "src", "sidepanel", "panel-financial.mjs"), "utf8");
  const scheduledBodies = [...panel.matchAll(/schedule\(async \(\) => \{([\s\S]*?)\}, 500\)/gu)].map((match) => match[1]);
  assert.equal(scheduledBodies.length, 2);
  for (const body of scheduledBodies) {
    assert.doesNotMatch(body, /query\.start|credentials\.configure|credentials\.delete|query\.cancel|query\.page|query\.continue/u);
  }
});
