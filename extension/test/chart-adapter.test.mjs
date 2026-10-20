import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runChartAdapter } from "../src/wts/chart-adapter.mjs";

const OPEN_CHART = "wts.main.p3.chart.open";
const SET_PERIOD = "wts.main.p3.chart.period.set";

class FakeClassList {
  constructor(...names) { this.names = new Set(names); }
  contains(name) { return this.names.has(name); }
  add(name) { this.names.add(name); }
  remove(name) { this.names.delete(name); }
}

class FakeElement {
  constructor(text = "", options = {}) {
    this.innerText = text;
    this.textContent = text;
    this.attributes = { ...(options.attributes || {}) };
    this.hidden = Boolean(options.hidden);
    this.disabled = Boolean(options.disabled);
    this.classList = new FakeClassList(...(options.classes || []));
    this.parentElement = options.parentElement || null;
    this.isConnected = options.isConnected ?? true;
    this.selectors = new Map();
    this.clicks = 0;
    this.onClick = options.onClick || null;
    this.rect = options.rect || { width: 80, height: 20 };
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getBoundingClientRect() { return this.rect; }
  querySelectorAll(selector) { return this.selectors.get(selector) || []; }
  click() { this.clicks += 1; this.onClick?.(); }
}

function makeButton(text, options = {}) {
  const parentElement = new FakeElement("", { classes: options.active ? ["active"] : [] });
  return new FakeElement(text, { ...options, parentElement });
}

function fixture(options = {}) {
  const state = {
    active: options.active || "종목시세",
    selectedPeriod: options.period || "일",
  };
  const articles = Array.from({ length: options.articleCount ?? 4 }, () => new FakeElement());
  const p3 = articles[3];
  const tabNames = ["종목시세", "차트", "뉴스", "잔고", "체결/거래"];
  const tabs = tabNames.map((name) => makeButton(name, {
    active: state.active === name,
    disabled: options.disabledChart && name === "차트",
  }));
  const syncTabs = () => {
    tabs.forEach((button) => {
      button.parentElement.classList.remove("active");
      if (button.innerText === state.active) button.parentElement.classList.add("active");
    });
  };
  const chartButton = tabs.find((button) => button.innerText === "차트");
  chartButton.onClick = () => { state.active = "차트"; syncTabs(); };
  if (options.duplicateChartTab) tabs.push(makeButton("차트"));

  const instrumentCount = options.instrumentCount ?? 1;
  const instruments = Array.from({ length: instrumentCount }, (_, index) => (
    new FakeElement(index === 0 ? (options.stockLabel ?? "삼성전자 005930") : "SK하이닉스 000660")
  ));
  const periodNames = ["일", "주", "월", "년", "분", "1", "3", "5"]
    .filter((name) => !(options.missingMonth && name === "월") && !(options.missingYear && name === "년"));
  const periods = periodNames.map((name) => new FakeElement(name, {
    classes: state.selectedPeriod === name ? ["on"] : [],
    disabled: (options.disabledWeek && name === "주")
      || (options.disabledMonth && name === "월")
      || (options.disabledYear && name === "년"),
  }));
  const syncPeriods = () => {
    periods.forEach((button) => {
      button.classList.remove("on");
      if (button.innerText === state.selectedPeriod) button.classList.add("on");
    });
  };
  for (const button of periods) {
    button.onClick = () => { state.selectedPeriod = button.innerText; syncPeriods(); };
  }
  if (options.duplicateDay) periods.push(new FakeElement("일"));
  if (options.duplicateMonth) periods.push(new FakeElement("월"));
  if (options.duplicateYear) periods.push(new FakeElement("년"));

  const chart = new FakeElement();
  chart.selectors.set("canvas#Main04002Chart_Canvas", options.missingCanvas ? [] : [new FakeElement()]);
  p3?.selectors.set(".default-tab-menu-depth.depth-1 > ul > li > button", tabs);
  p3?.selectors.set("button.jongmok-info", instruments);
  p3?.selectors.set("div.chart", state.active === "차트" && !options.missingChart ? [chart] : []);
  p3?.selectors.set(".setting-area button", state.active === "차트" ? periods : []);

  const modalElement = options.modal ? new FakeElement("상세검색", { rect: options.modalRect }) : null;
  const modal = modalElement ? [modalElement] : [];
  const fakeDocument = new FakeElement();
  fakeDocument.selectors.set("article.article-area", articles);
  fakeDocument.selectors.set(".modal-container, [role='dialog'], [aria-modal='true']", modal);

  const refreshChartSelectors = () => {
    p3.selectors.set("div.chart", state.active === "차트" && !options.missingChart ? [chart] : []);
    p3.selectors.set(".setting-area button", state.active === "차트" ? periods : []);
  };
  const originalChartClick = chartButton.onClick;
  chartButton.onClick = () => { originalChartClick(); refreshChartSelectors(); };
  return {
    document: fakeDocument,
    tabs,
    periods,
    chartButton,
    instruments,
    modal: modalElement,
    setModal(open) {
      fakeDocument.selectors.set(
        ".modal-container, [role='dialog'], [aria-modal='true']",
        open ? [new FakeElement("확인")] : [],
      );
    },
  };
}

async function withFixture(value, run) {
  const previous = {
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
  };
  globalThis.document = value.document;
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible" });
  try { return await run(); } finally { Object.assign(globalThis, previous); }
}

async function observe(value) {
  return withFixture(value, () => runChartAdapter({ mode: "observe" }));
}

async function withCrypto(cryptoValue, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: cryptoValue });
  try { return await run(); } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else delete globalThis.crypto;
  }
}

test("observes the real four-panel P3 chart shape without exposing the stock label", async () => {
  const value = fixture({ active: "차트", period: "일" });
  const result = await observe(value);
  assert.deepEqual({ ...result.state, contextToken: "<hash>" }, {
    screenId: "main-chart",
    activeTab: "chart",
    period: "day",
    blocked: false,
    chartOpenEnabled: true,
    periodEnabled: true,
    instrumentToken: result.state.instrumentToken,
    contextToken: "<hash>",
  });
  assert.match(result.state.instrumentToken, /^[a-f0-9]{64}$/);
  assert.match(result.state.contextToken, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(result), /삼성전자|005930/);
});

test("the exported adapter remains self-contained when serialized for scripting injection", async () => {
  const injected = (0, eval)(`(${runChartAdapter.toString()})`);
  const result = await withFixture(fixture({ active: "차트" }), () => injected({ mode: "observe" }));
  assert.equal(result.state.screenId, "main-chart");
  assert.equal(result.reason, null);
});

test("stock changes invalidate the context token", async () => {
  const first = await observe(fixture({ active: "차트", stockLabel: "삼성전자 005930" }));
  const second = await observe(fixture({ active: "차트", stockLabel: "현대건설 000720" }));
  assert.notEqual(first.state.instrumentToken, second.state.instrumentToken);
  assert.notEqual(first.state.contextToken, second.state.contextToken);
});

test("a missing instrument uses the SHA-256 token of an empty label", async () => {
  const result = await observe(fixture({ active: "차트", instrumentCount: 0 }));
  assert.equal(result.state.screenId, "unknown");
  assert.equal(result.state.instrumentToken, createHash("sha256").update("").digest("hex"));
});

test("day and week states keep the same instrument token while context changes", async () => {
  const value = fixture({ active: "차트", period: "일" });
  await withFixture(value, async () => {
    const day = await runChartAdapter({ mode: "observe" });
    const week = await runChartAdapter({
      mode: "execute",
      expectedState: day.state,
      actionId: SET_PERIOD,
      args: { period: "week" },
    });
    assert.equal(week.acted, true);
    assert.equal(week.state.instrumentToken, day.state.instrumentToken);
    assert.notEqual(week.state.contextToken, day.state.contextToken);
  });
});

test("month and year are observed as distinct supported periods", async () => {
  assert.equal((await observe(fixture({ active: "차트", period: "월" }))).state.period, "month");
  assert.equal((await observe(fixture({ active: "차트", period: "년" }))).state.period, "year");
});

test("opens the chart once only when the full expected state is still current", async () => {
  const value = fixture();
  await withFixture(value, async () => {
    const before = await runChartAdapter({ mode: "observe" });
    const result = await runChartAdapter({ mode: "execute", expectedState: before.state, actionId: OPEN_CHART, args: {} });
    assert.equal(value.chartButton.clicks, 1);
    assert.equal(result.acted, true);
    assert.equal(result.state.screenId, "main-chart");
    assert.equal(result.state.activeTab, "chart");
  });
});

test("full-state comparison is independent of JSON property insertion order", async () => {
  const value = fixture();
  await withFixture(value, async () => {
    const before = await runChartAdapter({ mode: "observe" });
    const reordered = Object.fromEntries(Object.entries(before.state).reverse());
    const result = await runChartAdapter({ mode: "execute", expectedState: reordered, actionId: OPEN_CHART, args: {} });
    assert.equal(result.acted, true);
    assert.equal(value.chartButton.clicks, 1);
  });
});

test("sets week once and returns the fresh post-click state", async () => {
  const value = fixture({ active: "차트", period: "일" });
  await withFixture(value, async () => {
    const before = await runChartAdapter({ mode: "observe" });
    const result = await runChartAdapter({ mode: "execute", expectedState: before.state, actionId: SET_PERIOD, args: { period: "week" } });
    const week = value.periods.find((button) => button.innerText === "주");
    assert.equal(week.clicks, 1);
    assert.equal(result.acted, true);
    assert.equal(result.state.period, "week");
  });
});

test("sets month and year with exactly one click and a fresh post-click state", async () => {
  for (const [period, label] of [["month", "월"], ["year", "년"]]) {
    const value = fixture({ active: "차트", period: "일" });
    await withFixture(value, async () => {
      const before = await runChartAdapter({ mode: "observe" });
      const result = await runChartAdapter({
        mode: "execute",
        expectedState: before.state,
        actionId: SET_PERIOD,
        args: { period },
      });
      assert.equal(value.periods.find((button) => button.innerText === label).clicks, 1);
      assert.equal(value.periods.reduce((sum, button) => sum + button.clicks, 0), 1);
      assert.equal(result.acted, true);
      assert.equal(result.state.period, period);
    });
  }
});

test("a changed stock blocks execution before any click", async () => {
  const first = fixture({ active: "차트", stockLabel: "삼성전자 005930" });
  const expected = await observe(first);
  const changed = fixture({ active: "차트", stockLabel: "현대건설 000720" });
  await withFixture(changed, async () => {
    const result = await runChartAdapter({ mode: "execute", expectedState: expected.state, actionId: SET_PERIOD, args: { period: "week" } });
    assert.equal(result.reason, "PRECONDITION_CHANGED");
    assert.equal(changed.periods.reduce((sum, button) => sum + button.clicks, 0), 0);
  });
});

test("a modal appearing during context hashing is caught by the final synchronous guard", async () => {
  const value = fixture();
  await withFixture(value, async () => {
    const expected = await runChartAdapter({ mode: "observe" });
    const realCrypto = globalThis.crypto;
    const mutatingCrypto = {
      subtle: {
        async digest(algorithm, bytes) {
          value.setModal(true);
          return realCrypto.subtle.digest(algorithm, bytes);
        },
      },
    };
    await withCrypto(mutatingCrypto, async () => {
      const result = await runChartAdapter({ mode: "execute", expectedState: expected.state, actionId: OPEN_CHART, args: {} });
      assert.equal(result.acted, false);
      assert.equal(result.reason, "PRECONDITION_CHANGED");
      assert.equal(value.chartButton.clicks, 0);
    });
  });
});

test("a stock change during context hashing is caught by the final synchronous guard", async () => {
  const value = fixture();
  await withFixture(value, async () => {
    const expected = await runChartAdapter({ mode: "observe" });
    const realCrypto = globalThis.crypto;
    const mutatingCrypto = {
      subtle: {
        async digest(algorithm, bytes) {
          value.instruments[0].innerText = "현대건설 000720";
          value.instruments[0].textContent = "현대건설 000720";
          return realCrypto.subtle.digest(algorithm, bytes);
        },
      },
    };
    await withCrypto(mutatingCrypto, async () => {
      const result = await runChartAdapter({ mode: "execute", expectedState: expected.state, actionId: OPEN_CHART, args: {} });
      assert.equal(result.acted, false);
      assert.equal(result.reason, "PRECONDITION_CHANGED");
      assert.equal(value.chartButton.clicks, 0);
    });
  });
});

test("a stale month or year target discovered after hashing never clicks", async () => {
  for (const [period, label] of [["month", "월"], ["year", "년"]]) {
    const value = fixture({ active: "차트", period: "일" });
    await withFixture(value, async () => {
      const expected = await runChartAdapter({ mode: "observe" });
      const target = value.periods.find((button) => button.innerText === label);
      const realCrypto = globalThis.crypto;
      const mutatingCrypto = {
        subtle: {
          async digest(algorithm, bytes) {
            target.isConnected = false;
            return realCrypto.subtle.digest(algorithm, bytes);
          },
        },
      };
      await withCrypto(mutatingCrypto, async () => {
        const result = await runChartAdapter({
          mode: "execute",
          expectedState: expected.state,
          actionId: SET_PERIOD,
          args: { period },
        });
        assert.equal(result.acted, false);
        assert.equal(result.reason, "PRECONDITION_CHANGED");
        assert.equal(value.periods.reduce((sum, button) => sum + button.clicks, 0), 0);
      });
    });
  }
});

test("a visible modal blocks both chart and period actions", async () => {
  const value = fixture({ active: "차트", modal: true });
  await withFixture(value, async () => {
    const before = await runChartAdapter({ mode: "observe" });
    assert.equal(before.state.blocked, true);
    assert.equal(before.state.chartOpenEnabled, false);
    assert.equal(before.state.periodEnabled, false);
    const result = await runChartAdapter({ mode: "execute", expectedState: before.state, actionId: SET_PERIOD, args: { period: "week" } });
    assert.equal(result.reason, "PRECONDITION_CHANGED");
    assert.equal(value.periods.reduce((sum, button) => sum + button.clicks, 0), 0);
  });
});

test("an offscreen but DOM-visible detailed search modal blocks without clicking", async () => {
  const value = fixture({
    modal: true,
    modalRect: { x: 692.8, y: 443, width: 330, height: 450 },
  });
  await withFixture(value, async () => {
    assert.ok(value.modal.getBoundingClientRect().x > 486);
    const before = await runChartAdapter({ mode: "observe" });
    assert.equal(before.state.blocked, true);
    const result = await runChartAdapter({ mode: "execute", expectedState: before.state, actionId: OPEN_CHART, args: {} });
    assert.equal(result.acted, false);
    assert.equal(result.reason, "PRECONDITION_CHANGED");
    assert.equal(value.tabs.concat(value.periods).reduce((sum, button) => sum + button.clicks, 0), 0);
  });
});

test("missing, duplicate, or disabled controls fail closed", async () => {
  for (const value of [
    fixture({ active: "차트", instrumentCount: 0 }),
    fixture({ active: "차트", instrumentCount: 2 }),
    fixture({ active: "차트", stockLabel: "" }),
    fixture({ active: "차트", duplicateChartTab: true }),
    fixture({ active: "차트", missingCanvas: true }),
    fixture({ active: "차트", duplicateDay: true }),
    fixture({ active: "차트", missingMonth: true }),
    fixture({ active: "차트", missingYear: true }),
    fixture({ active: "차트", duplicateMonth: true }),
    fixture({ active: "차트", duplicateYear: true }),
    fixture({ disabledChart: true }),
    fixture({ active: "차트", disabledWeek: true }),
    fixture({ active: "차트", disabledMonth: true }),
    fixture({ active: "차트", disabledYear: true }),
  ]) {
    await withFixture(value, async () => {
      const before = await runChartAdapter({ mode: "observe" });
      const actionId = before.state.activeTab === "chart" ? SET_PERIOD : OPEN_CHART;
      const args = actionId === SET_PERIOD ? { period: "week" } : {};
      const result = await runChartAdapter({ mode: "execute", expectedState: before.state, actionId, args });
      assert.equal(result.acted, false);
      assert.equal(result.reason, "PRECONDITION_CHANGED");
      assert.equal(value.tabs.concat(value.periods).reduce((sum, button) => sum + button.clicks, 0), 0);
    });
  }
});

test("an execution exception is reported after exactly one click and is never retried", async () => {
  const value = fixture();
  value.chartButton.onClick = () => { throw new Error("synthetic click failure"); };
  await withFixture(value, async () => {
    const before = await runChartAdapter({ mode: "observe" });
    const result = await runChartAdapter({ mode: "execute", expectedState: before.state, actionId: OPEN_CHART, args: {} });
    assert.equal(result.acted, false);
    assert.equal(result.reason, "EXECUTION_ERROR");
    assert.equal(value.chartButton.clicks, 1);
  });
});

test("a post-click observation failure preserves acted true", async () => {
  const value = fixture();
  await withFixture(value, async () => {
    const expected = await runChartAdapter({ mode: "observe" });
    const realCrypto = globalThis.crypto;
    let digestCalls = 0;
    const failingCrypto = {
      subtle: {
        async digest(algorithm, bytes) {
          digestCalls += 1;
          if (digestCalls === 3) throw new Error("post-click hash failed");
          return realCrypto.subtle.digest(algorithm, bytes);
        },
      },
    };
    await withCrypto(failingCrypto, async () => {
      const result = await runChartAdapter({ mode: "execute", expectedState: expected.state, actionId: OPEN_CHART, args: {} });
      assert.equal(value.chartButton.clicks, 1);
      assert.equal(result.acted, true);
      assert.equal(result.reason, "EXECUTION_ERROR");
      assert.deepEqual(result.state, expected.state);
    });
  });
});

test("an out-of-scope panel shape is unknown and cannot click", async () => {
  const value = fixture({ articleCount: 3 });
  await withFixture(value, async () => {
    const before = await runChartAdapter({ mode: "observe" });
    assert.equal(before.state.screenId, "unknown");
    const result = await runChartAdapter({ mode: "execute", expectedState: before.state, actionId: OPEN_CHART, args: {} });
    assert.equal(result.reason, "PRECONDITION_CHANGED");
    assert.equal(value.tabs.reduce((sum, button) => sum + button.clicks, 0), 0);
  });
});

test("invalid modes, action IDs, and arguments never click", async () => {
  for (const request of [
    { mode: "remove" },
    { mode: "execute", actionId: "wts.main.p3.order.buy", args: {} },
    { mode: "execute", actionId: OPEN_CHART, args: { selector: "button" } },
    { mode: "execute", actionId: SET_PERIOD, args: { period: "quarter" } },
    { mode: "execute", actionId: SET_PERIOD, args: { period: "week", extra: true } },
  ]) {
    const value = fixture({ active: "차트" });
    await withFixture(value, async () => {
      const before = await runChartAdapter({ mode: "observe" });
      const result = await runChartAdapter({ ...request, expectedState: before.state });
      assert.equal(result.reason, "EXECUTION_ERROR");
      assert.equal(value.tabs.concat(value.periods).reduce((sum, button) => sum + button.clicks, 0), 0);
    });
  }
});

test("already selected periods and already open charts are never clicked", async () => {
  const chart = fixture({ active: "차트", period: "week" });
  await withFixture(chart, async () => {
    const before = await runChartAdapter({ mode: "observe" });
    const period = await runChartAdapter({ mode: "execute", expectedState: before.state, actionId: SET_PERIOD, args: { period: "week" } });
    const open = await runChartAdapter({ mode: "execute", expectedState: before.state, actionId: OPEN_CHART, args: {} });
    assert.equal(period.reason, "PRECONDITION_CHANGED");
    assert.equal(open.reason, "PRECONDITION_CHANGED");
    assert.equal(chart.tabs.concat(chart.periods).reduce((sum, button) => sum + button.clicks, 0), 0);
  });
});
