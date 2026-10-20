import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runMarketNavigationAdapter } from "../src/wts/market-navigation-adapter.mjs";
import {
  createMarketNavigationFixture,
  withMarketNavigationGlobals,
} from "./helpers/market-navigation-dom.mjs";

const OPEN_SITEMAP = "wts.main.sitemap.open";
const NAVIGATE_MARKET = "wts.main.p1.market.navigate";
const evidence = JSON.parse(readFileSync(
  new URL("../../backend/ref/wts/market-menu-navigation-20261019.json", import.meta.url),
  "utf8",
));
const CATALOG = evidence.checks.map((entry) => ({
  id: entry.id,
  sitemapGroup: entry.sitemapGroup,
  buttonLabel: entry.buttonLabel,
  assertion: entry.assertionType === "p1-top-active"
    ? { kind: "top-active", topActive: entry.expected.topActive }
    : { kind: "group-child", group: entry.expected.group, child: entry.expected.child },
}));

function request(fixture, overrides = {}) {
  return {
    mode: "observe",
    actionId: OPEN_SITEMAP,
    args: { targetId: fixture.targetId },
    catalog: fixture.catalog,
    ...overrides,
  };
}

async function observe(fixture, actionId = OPEN_SITEMAP) {
  return withMarketNavigationGlobals(
    fixture,
    () => runMarketNavigationAdapter(request(fixture, { actionId })),
  );
}

async function execute(fixture, actionId, expectedState, args = { targetId: fixture.targetId }) {
  return withMarketNavigationGlobals(fixture, () => runMarketNavigationAdapter(request(fixture, {
    mode: "execute",
    expectedState,
    actionId,
    args,
  })));
}

test("all 25 authoritative mappings open and navigate with one click per action", async () => {
  assert.equal(CATALOG.length, 25);
  for (const target of CATALOG) {
    const fixture = createMarketNavigationFixture({ catalog: CATALOG, targetId: target.id });
    await withMarketNavigationGlobals(fixture, async () => {
      const closed = await runMarketNavigationAdapter(request(fixture));
      assert.equal(closed.state.stateKind, "market-navigation", target.id);
      assert.equal(closed.state.targetId, target.id, target.id);
      assert.equal(closed.state.sitemapVisible, false, target.id);
      assert.equal(closed.state.targetAvailable, false, target.id);
      assert.equal(closed.state.sitemapOpenEnabled, true, target.id);
      assert.equal(closed.state.blocked, false, target.id);

      const opened = await runMarketNavigationAdapter(request(fixture, {
        mode: "execute",
        expectedState: closed.state,
      }));
      assert.equal(opened.acted, true, target.id);
      assert.equal(opened.reason, null, target.id);
      assert.equal(opened.state.sitemapVisible, true, target.id);
      assert.equal(opened.state.targetAvailable, true, target.id);
      assert.equal(fixture.opener.clicks, 1, target.id);

      const navigated = await runMarketNavigationAdapter(request(fixture, {
        mode: "execute",
        expectedState: opened.state,
        actionId: NAVIGATE_MARKET,
      }));
      assert.equal(navigated.acted, true, target.id);
      assert.equal(navigated.reason, null, target.id);
      assert.equal(navigated.state.sitemapVisible, false, target.id);
      assert.equal(navigated.state.activeTargetId, target.id, target.id);
      assert.equal(fixture.targetButton.clicks, 1, target.id);
    });
  }
});

test("the exported adapter remains self-contained when serialized for injection", async () => {
  const injected = (0, eval)(`(${runMarketNavigationAdapter.toString()})`);
  const fixture = createMarketNavigationFixture({ catalog: CATALOG, targetId: CATALOG[0].id });
  const result = await withMarketNavigationGlobals(
    fixture,
    () => injected(request(fixture)),
  );
  assert.equal(result.state.screenId, "main-market-navigation");
  assert.equal(result.reason, null);
});

test("market observations hash the same P3 label without exposing it", async () => {
  const fixture = createMarketNavigationFixture({
    catalog: CATALOG,
    targetId: CATALOG[0].id,
    stockLabel: "삼성전자 005930",
  });
  const result = await observe(fixture);
  assert.equal(result.state.instrumentToken, createHash("sha256").update("삼성전자 005930").digest("hex"));
  assert.match(result.state.contextToken, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(result), /삼성전자|005930|시세분석|급등락|innerHTML|input|rows/i);
});

test("P3 instrument hashing matches the chart adapter and ignores aria-label", async () => {
  const fixture = createMarketNavigationFixture({
    catalog: CATALOG,
    targetId: CATALOG[0].id,
    stockLabel: "삼성전자 005930",
    instrumentAriaLabel: "다른 접근성 이름 999999",
  });
  const result = await observe(fixture);
  assert.equal(result.state.instrumentToken, createHash("sha256").update("삼성전자 005930").digest("hex"));
  assert.notEqual(result.state.instrumentToken, createHash("sha256").update("다른 접근성 이름 999999").digest("hex"));
});

test("bounded aria-label fallback identifies the exact opener and scoped target", async () => {
  const fixture = createMarketNavigationFixture({
    catalog: CATALOG,
    targetId: CATALOG[0].id,
    openerText: "",
    openerAriaLabel: "사이트맵",
    targetText: "",
    targetAriaLabel: CATALOG[0].buttonLabel,
  });
  const closed = await observe(fixture);
  assert.equal(closed.state.sitemapOpenEnabled, true);
  const opened = await execute(fixture, OPEN_SITEMAP, closed.state);
  assert.equal(opened.state.targetAvailable, true);
  const navigated = await execute(fixture, NAVIGATE_MARKET, opened.state);
  assert.equal(navigated.state.activeTargetId, CATALOG[0].id);
});

test("missing or ambiguous P1 and P3 bindings fail closed", async () => {
  for (const options of [
    { missingP1: true },
    { duplicateP1: true },
    { articleAreaCount: 3 },
    { instrumentCount: 0 },
    { instrumentCount: 2 },
  ]) {
    const fixture = createMarketNavigationFixture({ catalog: CATALOG, targetId: CATALOG[0].id, ...options });
    const result = await observe(fixture);
    assert.equal(result.state.screenId, "unknown");
    assert.equal(result.state.blocked, true);
  }
});

test("semantic P1 binding is independent of article order", async () => {
  const fixture = createMarketNavigationFixture({
    catalog: CATALOG,
    targetId: CATALOG[0].id,
    reorderArticles: true,
  });
  const result = await observe(fixture);
  assert.equal(result.state.screenId, "main-market-navigation");
  assert.equal(result.state.blocked, false);
});

test("hidden ancestors fail closed for opener, target, sitemap modal, and P1", async () => {
  const cases = [
    [{ hiddenOpenerAncestor: true }, (state) => state.sitemapOpenEnabled === false && state.blocked],
    [{ sitemapVisible: true, ariaHiddenTargetAncestor: true }, (state) => state.targetAvailable === false && state.blocked],
    [{ sitemapVisible: true, modalAncestorDisplay: "none" }, (state) => state.sitemapVisible === false],
    [{ p1AncestorVisibility: "hidden" }, (state) => state.screenId === "unknown" && state.blocked],
  ];
  for (const [options, assertion] of cases) {
    const fixture = createMarketNavigationFixture({ catalog: CATALOG, targetId: CATALOG[0].id, ...options });
    const result = await observe(fixture, options.sitemapVisible ? NAVIGATE_MARKET : OPEN_SITEMAP);
    assert.equal(assertion(result.state), true);
  }
});

test("computed-style read failures fail closed instead of treating nodes as visible", async () => {
  const fixture = createMarketNavigationFixture({
    catalog: CATALOG,
    targetId: CATALOG[0].id,
    openerAncestorStyleThrows: true,
  });
  const result = await observe(fixture);
  assert.equal(result.state.sitemapOpenEnabled, false);
  assert.equal(result.state.blocked, true);
});

test("foreign and ambiguous sitemap modals block both actions", async () => {
  for (const options of [
    { foreignModal: true },
    { sitemapVisible: true, foreignModal: true },
    { sitemapVisible: true, duplicateSitemap: true },
    { sitemapVisible: true, duplicateHeading: true },
  ]) {
    const fixture = createMarketNavigationFixture({ catalog: CATALOG, targetId: CATALOG[0].id, ...options });
    const before = await observe(fixture, options.sitemapVisible ? NAVIGATE_MARKET : OPEN_SITEMAP);
    assert.equal(before.state.blocked, true);
    const result = await execute(
      fixture,
      options.sitemapVisible ? NAVIGATE_MARKET : OPEN_SITEMAP,
      before.state,
    );
    assert.equal(result.acted, false);
    assert.equal(result.reason, "PRECONDITION_CHANGED");
  }
});

test("duplicate, hidden, and disabled opener nodes cannot open the sitemap", async () => {
  for (const options of [
    { duplicateOpener: true },
    { hiddenOpener: true },
    { disabledOpener: true },
  ]) {
    const fixture = createMarketNavigationFixture({ catalog: CATALOG, targetId: CATALOG[0].id, ...options });
    const before = await observe(fixture);
    assert.equal(before.state.sitemapOpenEnabled, false);
    assert.equal(before.state.blocked, true);
    const result = await execute(fixture, OPEN_SITEMAP, before.state);
    assert.equal(result.acted, false);
    assert.equal(result.reason, "PRECONDITION_CHANGED");
  }
});

test("group scope, uniqueness, visibility, and enabled state govern target availability", async () => {
  for (const options of [
    { missingTarget: true },
    { duplicateGroup: true },
    { duplicateTerm: true },
    { duplicateTarget: true },
    { hiddenTarget: true },
    { disabledTarget: true },
  ]) {
    const fixture = createMarketNavigationFixture({
      catalog: CATALOG,
      targetId: "market-menu-022",
      sitemapVisible: true,
      ...options,
    });
    const before = await observe(fixture, NAVIGATE_MARKET);
    assert.equal(before.state.targetAvailable, false);
    assert.equal(before.state.blocked, true);
    const result = await execute(fixture, NAVIGATE_MARKET, before.state);
    assert.equal(result.acted, false);
    assert.equal(result.reason, "PRECONDITION_CHANGED");
  }
});

test("the real duplicate 종목별투자자 label is selected only from 투자자별/프로그램", async () => {
  const fixture = createMarketNavigationFixture({
    catalog: CATALOG,
    targetId: "market-menu-022",
    sitemapVisible: true,
  });
  const before = await observe(fixture, NAVIGATE_MARKET);
  assert.equal(before.state.targetAvailable, true);
  const result = await execute(fixture, NAVIGATE_MARKET, before.state);
  assert.equal(result.state.activeTargetId, "market-menu-022");
  assert.equal(fixture.targetButton.clicks, 1);
  assert.equal(fixture.wrongGroupButton.clicks, 0);
});

test("a corrupted catalog assertion cannot self-confirm the authoritative postcondition", async () => {
  const corrupted = CATALOG.map((target, index) => index === 0
    ? { ...target, assertion: { kind: "group-child", group: "오염된그룹", child: "오염된메뉴" } }
    : target);
  const fixture = createMarketNavigationFixture({ catalog: corrupted, targetId: corrupted[0].id });
  const closed = await observe(fixture);
  const opened = await execute(fixture, OPEN_SITEMAP, closed.state);
  const navigated = await execute(fixture, NAVIGATE_MARKET, opened.state);
  assert.equal(navigated.acted, true);
  assert.equal(navigated.state.activeTargetId, null);
});

test("fresh-node identity changes prevent opener and target clicks", async () => {
  const opener = createMarketNavigationFixture({
    catalog: CATALOG,
    targetId: CATALOG[0].id,
    replaceOpenerOnFreshQuery: true,
  });
  const closed = await observe(opener);
  const openResult = await execute(opener, OPEN_SITEMAP, closed.state);
  assert.equal(openResult.acted, false);
  assert.equal(openResult.reason, "PRECONDITION_CHANGED");

  const target = createMarketNavigationFixture({
    catalog: CATALOG,
    targetId: CATALOG[0].id,
    sitemapVisible: true,
    replaceTargetOnFreshQuery: true,
  });
  const visible = await observe(target, NAVIGATE_MARKET);
  const navigateResult = await execute(target, NAVIGATE_MARKET, visible.state);
  assert.equal(navigateResult.acted, false);
  assert.equal(navigateResult.reason, "PRECONDITION_CHANGED");
});

test("detached opener and target nodes fail the fresh precondition", async () => {
  const opener = createMarketNavigationFixture({ catalog: CATALOG, targetId: CATALOG[0].id });
  const closed = await observe(opener);
  opener.detachOpener();
  const openResult = await execute(opener, OPEN_SITEMAP, closed.state);
  assert.equal(openResult.acted, false);
  assert.equal(openResult.reason, "PRECONDITION_CHANGED");

  const target = createMarketNavigationFixture({
    catalog: CATALOG,
    targetId: CATALOG[0].id,
    sitemapVisible: true,
  });
  const visible = await observe(target, NAVIGATE_MARKET);
  target.detachTarget();
  const navigateResult = await execute(target, NAVIGATE_MARKET, visible.state);
  assert.equal(navigateResult.acted, false);
  assert.equal(navigateResult.reason, "PRECONDITION_CHANGED");
});

test("stale or structurally different expected states never click", async () => {
  const fixture = createMarketNavigationFixture({ catalog: CATALOG, targetId: CATALOG[0].id });
  const before = await observe(fixture);
  for (const expectedState of [
    { ...before.state, contextToken: "0".repeat(64) },
    { ...before.state, extra: true },
    Object.fromEntries(Object.entries(before.state).slice(1)),
  ]) {
    const result = await execute(fixture, OPEN_SITEMAP, expectedState);
    assert.equal(result.acted, false);
    assert.equal(result.reason, "PRECONDITION_CHANGED");
  }
  const reordered = Object.fromEntries(Object.entries(before.state).reverse());
  const result = await execute(fixture, OPEN_SITEMAP, reordered);
  assert.equal(result.acted, true);
  assert.equal(fixture.opener.clicks, 1);
});

test("action, target, args, catalog, and mode mismatches fail without DOM actions", async () => {
  const cases = [
    { mode: "remove", actionId: OPEN_SITEMAP, args: { targetId: CATALOG[0].id }, catalog: CATALOG },
    { mode: "observe", actionId: "wts.main.p3.order.buy", args: { targetId: CATALOG[0].id }, catalog: CATALOG },
    { mode: "observe", actionId: OPEN_SITEMAP, args: { targetId: "unknown" }, catalog: CATALOG },
    { mode: "observe", actionId: OPEN_SITEMAP, args: { targetId: CATALOG[0].id, selector: "button" }, catalog: CATALOG },
    { mode: "observe", actionId: OPEN_SITEMAP, args: { targetId: CATALOG[0].id }, catalog: [...CATALOG, CATALOG[0]] },
  ];
  for (const invalid of cases) {
    const fixture = createMarketNavigationFixture({ catalog: CATALOG, targetId: CATALOG[0].id });
    const result = await withMarketNavigationGlobals(
      fixture,
      () => runMarketNavigationAdapter(invalid),
    );
    assert.equal(result.acted, false);
    assert.equal(result.reason, "EXECUTION_ERROR");
    assert.equal(fixture.opener.clicks, 0);
    assert.equal(fixture.targetButton.clicks, 0);
  }
});

test("an already active closed target and target mismatch never click", async () => {
  const fixture = createMarketNavigationFixture({
    catalog: CATALOG,
    targetId: CATALOG[0].id,
    activeTargetId: CATALOG[0].id,
  });
  const before = await observe(fixture);
  assert.equal(before.state.activeTargetId, CATALOG[0].id);
  const active = await execute(fixture, OPEN_SITEMAP, before.state);
  assert.equal(active.reason, "PRECONDITION_CHANGED");
  const mismatch = await execute(fixture, OPEN_SITEMAP, before.state, { targetId: CATALOG[1].id });
  assert.equal(mismatch.reason, "PRECONDITION_CHANGED");
  assert.equal(fixture.opener.clicks, 0);
});

test("unsupported selectors in the strict fixture throw", () => {
  const fixture = createMarketNavigationFixture({ catalog: CATALOG, targetId: CATALOG[0].id });
  assert.throws(() => fixture.document.querySelectorAll("article:nth-child(1)"), /Unsupported selector/);
  assert.throws(() => fixture.opener.closest("div.some-framework-class"), /Unsupported ancestor selector/);
});
