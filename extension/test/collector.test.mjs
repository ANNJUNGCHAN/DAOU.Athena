import test from "node:test";
import assert from "node:assert/strict";
import { collectCurrentFrame } from "../src/collector.mjs";

class Element {
  constructor(tagName, attributes = {}, text = "", options = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes;
    this.innerText = text;
    this.textContent = text;
    this.hidden = false;
    this.disabled = Boolean(options.disabled);
    this.type = attributes.type || "";
    this.inGrid = Boolean(options.inGrid);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getBoundingClientRect() { return { width: 80, height: 20 }; }
  closest() { return this.inGrid ? {} : null; }
}

function withDocument({ selectors, title = "키움 WTS", url = "https://wts.kiwoom.com/trade?secret=1#hash", isTop = true }, run) {
  const previous = {
    document: globalThis.document,
    location: globalThis.location,
    window: globalThis.window,
    getComputedStyle: globalThis.getComputedStyle,
  };
  globalThis.document = {
    title,
    querySelectorAll(selector) { return selectors.get(selector) || []; },
  };
  globalThis.location = new URL(url);
  const windowObject = {};
  windowObject.top = isTop ? windowObject : {};
  globalThis.window = windowObject;
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible" });
  try { return run(); } finally { Object.assign(globalThis, previous); }
}

test("collector returns bounded metadata without values, account numbers, or table rows", () => {
  const headingSelector = "h1, h2, h3, [role='heading']";
  const controlSelector = "button, a[href], select, textarea, input:not([type='hidden']):not([type='password']), [role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='combobox'], [role='textbox'], [role='tab'], [role='menuitem']";
  const secretInput = new Element("input", { type: "text", "aria-label": "계좌 1234-56-789012" });
  secretInput.value = "NEVER-COLLECT-THIS";
  const verifiedStock = new Element("button", { "data-stock-code": "005930" }, "삼성전자 005930");
  const ambiguousSixDigits = new Element("button", {}, "006123");
  const misleadingSecurityControl = new Element("input", {
    type: "text",
    name: "accountNumber",
    "aria-label": "계좌 종목코드 005930",
    "data-stock-code": "005930",
  });
  const genericDataCodeSecurity = new Element("input", {
    type: "text",
    "aria-label": "보안코드 654321",
    "data-code": "654321",
  });
  const longAccount = new Element("input", { type: "text", "aria-label": "계좌 12345678901234567890" });
  const tableButton = new Element("button", {}, "매수 70,000원", { inGrid: true });
  const selectors = new Map([
    ["input[type='password']", []],
    [headingSelector, [new Element("h1", {}, "시장 종합")]],
    [controlSelector, [secretInput, verifiedStock, ambiguousSixDigits, misleadingSecurityControl, genericDataCodeSecurity, longAccount, new Element("button", {}, "차트 열기"), tableButton]],
    ["iframe", [new Element("iframe", { src: "/chart?symbol=005930" }), new Element("iframe", { id: "yettie_library_iframe", src: "/fsm/js/koscom/app/views/library.html" })]],
    ["canvas", [new Element("canvas")]],
  ]);

  const result = withDocument({ selectors }, () => collectCurrentFrame());
  assert.deepEqual(result.source, { origin: "https://wts.kiwoom.com", path: "/trade" });
  assert.equal(result.controls.length, 7);
  assert.match(result.controls[0].name, /번호 숨김/);
  assert.equal(result.controls[1].name, "삼성전자 005930");
  assert.equal(result.controls[2].name, "[번호 숨김]");
  assert.equal(result.controls[3].name, "계좌 종목코드 [번호 숨김]");
  assert.equal(result.controls[4].name, "보안코드 [번호 숨김]");
  assert.equal(result.controls[5].name, "계좌 [번호 숨김]");
  assert.doesNotMatch(JSON.stringify(result), /NEVER-COLLECT-THIS|70,000|654321|12345678901234567890|koscom|yettie|library/);
  assert.deepEqual(result.frames, [{ origin: "https://wts.kiwoom.com", path: "/chart" }]);
  assert.equal(result.canvasCount, 1);
});

test("collector excludes a sensitive child frame entirely", () => {
  const selectors = new Map([["input[type='password']", [new Element("input", { type: "password" })]]]);
  const result = withDocument({ selectors, url: "https://wts.kiwoom.com/auth/cert", isTop: false }, () => collectCurrentFrame());
  assert.deepEqual(result, { excluded: true, reason: "sensitive-frame" });
});

test("collector reports truncation when controls exceed the configured bound", () => {
  const controlSelector = "button, a[href], select, textarea, input:not([type='hidden']):not([type='password']), [role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='combobox'], [role='textbox'], [role='tab'], [role='menuitem']";
  const selectors = new Map([
    ["input[type='password']", []],
    ["h1, h2, h3, [role='heading']", []],
    [controlSelector, [new Element("button", {}, "A"), new Element("button", {}, "B")]],
    ["iframe", []],
    ["canvas", []],
  ]);
  const result = withDocument({ selectors }, () => collectCurrentFrame({ maxControls: 1 }));
  assert.equal(result.controls.length, 1);
  assert.equal(result.truncated, true);
});
