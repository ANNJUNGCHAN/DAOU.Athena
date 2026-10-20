import { readFileSync } from "node:fs";

const authoritativeEvidence = JSON.parse(readFileSync(
  new URL("../../../backend/ref/wts/market-menu-navigation-20261019.json", import.meta.url),
  "utf8",
));
const AUTHORITATIVE_TARGETS = authoritativeEvidence.checks.map((entry) => ({
  id: entry.id,
  sitemapGroup: entry.sitemapGroup,
  buttonLabel: entry.buttonLabel,
  assertion: entry.assertionType === "p1-top-active"
    ? { kind: "top-active", topActive: entry.expected.topActive }
    : { kind: "group-child", group: entry.expected.group, child: entry.expected.child },
}));

class FakeClassList {
  constructor(...names) { this.names = new Set(names); }
  contains(name) { return this.names.has(name); }
}

export class StrictMarketElement {
  constructor(text = "", options = {}) {
    this.innerText = text;
    this.textContent = text;
    this.attributes = { ...(options.attributes || {}) };
    this.hidden = Boolean(options.hidden);
    this.disabled = Boolean(options.disabled);
    this.classList = new FakeClassList(...(options.classes || []));
    this.parentElement = options.parentElement || null;
    this.isConnected = options.isConnected ?? true;
    this.clicks = 0;
    this.onClick = options.onClick || null;
    this.rect = options.rect || { width: 80, height: 20 };
    this.styleThrows = Boolean(options.styleThrows);
    this.styleDisplay = options.styleDisplay || "block";
    this.styleVisibility = options.styleVisibility || "visible";
    this.selectors = new Map();
  }

  getAttribute(name) { return this.attributes[name] ?? null; }
  getBoundingClientRect() { return this.rect; }
  querySelectorAll(selector) {
    if (!this.selectors.has(selector)) throw new Error(`Unsupported selector: ${selector}`);
    const value = this.selectors.get(selector);
    return typeof value === "function" ? value() : value;
  }
  closest(selector) {
    if (selector !== "li.depth") throw new Error(`Unsupported ancestor selector: ${selector}`);
    let current = this.parentElement;
    while (current) {
      if (current.classList?.contains("depth")) return current;
      current = current.parentElement;
    }
    return null;
  }
  click() {
    this.clicks += 1;
    this.onClick?.();
  }
}

function button(text, options = {}) {
  return new StrictMarketElement(text, options);
}

export function createMarketNavigationFixture(options = {}) {
  const catalog = options.catalog;
  if (!Array.isArray(catalog) || catalog.length === 0) throw new TypeError("catalog is required");
  const targetId = options.targetId || catalog[0].id;
  const target = AUTHORITATIVE_TARGETS.find((entry) => entry.id === targetId);
  if (!target) throw new TypeError(`Unknown targetId: ${targetId}`);

  const state = {
    sitemapVisible: Boolean(options.sitemapVisible),
    activeTargetId: options.activeTargetId ?? null,
  };
  const document = new StrictMarketElement();
  const openerAncestor = new StrictMarketElement("", {
    hidden: options.hiddenOpenerAncestor,
    attributes: options.ariaHiddenOpenerAncestor ? { "aria-hidden": "true" } : {},
    styleThrows: options.openerAncestorStyleThrows,
    styleDisplay: options.openerAncestorDisplay,
    styleVisibility: options.openerAncestorVisibility,
  });
  let opener = button(options.openerText ?? "사이트맵", {
    attributes: options.openerAriaLabel ? { "aria-label": options.openerAriaLabel } : {},
    hidden: options.hiddenOpener,
    disabled: options.disabledOpener,
    parentElement: openerAncestor,
  });
  const targetAncestor = new StrictMarketElement("", {
    hidden: options.hiddenTargetAncestor,
    attributes: options.ariaHiddenTargetAncestor ? { "aria-hidden": "true" } : {},
    styleThrows: options.targetAncestorStyleThrows,
    styleDisplay: options.targetAncestorDisplay,
    styleVisibility: options.targetAncestorVisibility,
  });
  let targetButton = button(options.targetText ?? target.buttonLabel, {
    attributes: options.targetAriaLabel ? { "aria-label": options.targetAriaLabel } : {},
    hidden: options.hiddenTarget,
    disabled: options.disabledTarget,
    parentElement: targetAncestor,
  });

  const heading = new StrictMarketElement("키움증권 웹트레이딩(WTS) 전체 메뉴");
  const group = new StrictMarketElement();
  const term = new StrictMarketElement(target.sitemapGroup, { parentElement: group });
  targetAncestor.parentElement = group;
  group.selectors.set(
    "dt",
    options.duplicateTerm
      ? [term, new StrictMarketElement(target.sitemapGroup, { parentElement: group })]
      : [term],
  );
  let targetQueryCount = 0;
  group.selectors.set("dd button", () => {
    targetQueryCount += 1;
    if (options.replaceTargetOnFreshQuery && targetQueryCount === 3) {
      targetButton.isConnected = false;
      targetButton = button(target.buttonLabel, { parentElement: targetAncestor });
      targetButton.onClick = navigate;
    }
    if (options.missingTarget) return [];
    if (options.duplicateTarget) return [targetButton, button(target.buttonLabel, { parentElement: targetAncestor })];
    return [targetButton];
  });
  const modalAncestor = new StrictMarketElement("", {
    hidden: options.hiddenModalAncestor,
    attributes: options.ariaHiddenModalAncestor ? { "aria-hidden": "true" } : {},
    styleThrows: options.modalAncestorStyleThrows,
    styleDisplay: options.modalAncestorDisplay,
    styleVisibility: options.modalAncestorVisibility,
  });
  const sitemap = new StrictMarketElement("", { parentElement: modalAncestor });
  heading.parentElement = sitemap;
  group.parentElement = sitemap;
  sitemap.selectors.set(
    "h1, h2, h3, h4, h5, h6, [role='heading']",
    options.duplicateHeading ? [heading, new StrictMarketElement("다른 제목")] : [heading],
  );
  const duplicateGroup = new StrictMarketElement("", { parentElement: sitemap });
  const duplicateGroupTerm = new StrictMarketElement(target.sitemapGroup, { parentElement: duplicateGroup });
  const duplicateGroupDd = new StrictMarketElement("", { parentElement: duplicateGroup });
  const duplicateGroupButton = button(target.buttonLabel, { parentElement: duplicateGroupDd });
  duplicateGroup.selectors.set("dt", [duplicateGroupTerm]);
  duplicateGroup.selectors.set("dd button", [duplicateGroupButton]);

  const wrongGroup = new StrictMarketElement("", { parentElement: sitemap });
  const wrongGroupTerm = new StrictMarketElement("외국인/거래원", { parentElement: wrongGroup });
  const wrongGroupDd = new StrictMarketElement("", { parentElement: wrongGroup });
  const wrongGroupButton = button("종목별투자자", { parentElement: wrongGroupDd });
  wrongGroup.selectors.set("dt", [wrongGroupTerm]);
  wrongGroup.selectors.set("dd button", [wrongGroupButton]);
  sitemap.selectors.set("dl", () => {
    const groups = options.duplicateGroup ? [group, duplicateGroup] : [group];
    if (target.id === "market-menu-022") groups.push(wrongGroup);
    return groups;
  });

  const duplicateSitemap = new StrictMarketElement();
  duplicateSitemap.selectors.set(
    "h1, h2, h3, h4, h5, h6, [role='heading']",
    [new StrictMarketElement("키움증권 웹트레이딩(WTS) 전체 메뉴")],
  );
  duplicateSitemap.selectors.set("dl", [group]);
  const foreignModal = new StrictMarketElement("외부 모달", { attributes: { role: "dialog" } });

  const rankAnchor = button("순위분석");
  const bigDataAnchor = button("빅데이터");
  const p1Ancestor = new StrictMarketElement("", {
    hidden: options.hiddenP1Ancestor,
    attributes: options.ariaHiddenP1Ancestor ? { "aria-hidden": "true" } : {},
    styleThrows: options.p1AncestorStyleThrows,
    styleDisplay: options.p1AncestorDisplay,
    styleVisibility: options.p1AncestorVisibility,
  });
  const p1 = new StrictMarketElement("", { parentElement: p1Ancestor });
  const activeNodes = () => {
    const activeTarget = AUTHORITATIVE_TARGETS.find((entry) => entry.id === state.activeTargetId);
    if (!activeTarget) return { depths: [], allActiveButtons: [] };
    if (activeTarget.assertion.kind === "top-active") {
      const topLi = new StrictMarketElement("", { classes: ["active"] });
      const topButton = button(activeTarget.assertion.topActive, { parentElement: topLi });
      return { depths: [], allActiveButtons: [topButton] };
    }
    const depth = new StrictMarketElement("", { classes: ["depth", "active"] });
    const groupButton = button(activeTarget.assertion.group, { parentElement: depth });
    const activeLi = new StrictMarketElement("", { classes: ["active"], parentElement: depth });
    const childButton = button(activeTarget.assertion.child, { parentElement: activeLi });
    depth.selectors.set("button", [groupButton, childButton]);
    depth.selectors.set("li.active > button", [childButton]);
    return { depths: [depth], allActiveButtons: [childButton] };
  };
  p1.selectors.set("button", () => {
    const active = activeNodes().allActiveButtons;
    const activeTarget = AUTHORITATIVE_TARGETS.find((entry) => entry.id === state.activeTargetId);
    return activeTarget?.assertion.kind === "top-active"
      ? [rankAnchor, ...active]
      : [rankAnchor, bigDataAnchor, ...active];
  });
  p1.selectors.set("li.depth.active", () => activeNodes().depths);
  p1.selectors.set("li.active > button", () => activeNodes().allActiveButtons);

  const ambiguousP1 = new StrictMarketElement();
  ambiguousP1.selectors.set("button", [button("순위분석"), button("빅데이터")]);
  ambiguousP1.selectors.set("li.depth.active", []);
  ambiguousP1.selectors.set("li.active > button", []);
  const fillers = Array.from({ length: 3 }, () => {
    const article = new StrictMarketElement();
    article.selectors.set("button", []);
    return article;
  });
  const p3 = fillers[2];
  const instrumentCount = options.instrumentCount ?? 1;
  const instruments = Array.from({ length: instrumentCount }, (_, index) => (
    button(index === 0 ? (options.stockLabel ?? "삼성전자 005930") : "SK하이닉스 000660", {
      attributes: index === 0 && options.instrumentAriaLabel
        ? { "aria-label": options.instrumentAriaLabel }
        : {},
    })
  ));
  p3.selectors.set("button.jongmok-info", instruments);

  function openSitemap() { state.sitemapVisible = true; }
  function navigate() {
    state.activeTargetId = target.id;
    state.sitemapVisible = false;
  }
  opener.onClick = openSitemap;
  targetButton.onClick = navigate;

  let openerQueryCount = 0;
  document.selectors.set("button", () => {
    openerQueryCount += 1;
    if (options.replaceOpenerOnFreshQuery && openerQueryCount === 3) {
      opener.isConnected = false;
      opener = button("사이트맵", { onClick: openSitemap, parentElement: openerAncestor });
    }
    const values = [opener];
    if (options.duplicateOpener) values.push(button("사이트맵"));
    return values;
  });
  document.selectors.set(".modal-container", () => {
    if (!state.sitemapVisible) return [];
    return options.duplicateSitemap ? [sitemap, duplicateSitemap] : [sitemap];
  });
  document.selectors.set(".modal-container, [role='dialog'], [aria-modal='true']", () => {
    const values = state.sitemapVisible
      ? (options.duplicateSitemap ? [sitemap, duplicateSitemap] : [sitemap])
      : [];
    if (options.foreignModal) values.push(foreignModal);
    return values;
  });
  document.selectors.set("article", () => {
    if (options.missingP1) return fillers;
    const articles = options.duplicateP1 ? [p1, ambiguousP1, ...fillers] : [p1, ...fillers];
    return options.reorderArticles ? articles.reverse() : articles;
  });
  const articleAreas = options.articleAreaCount === undefined
    ? [p1, fillers[0], fillers[1], p3]
    : Array.from({ length: options.articleAreaCount }, (_, index) => (
      index === 0 ? p1 : (index === 3 ? p3 : fillers[Math.min(index - 1, 2)])
    ));
  document.selectors.set("article.article-area", articleAreas);

  const fixture = {
    catalog,
    targetId,
    document,
    state,
    get opener() { return opener; },
    get targetButton() { return targetButton; },
    sitemap,
    foreignModal,
    wrongGroupButton,
    setSitemapVisible(value) { state.sitemapVisible = Boolean(value); },
    setActiveTarget(value) { state.activeTargetId = value; },
    replaceOpener() {
      opener.isConnected = false;
      opener = button("사이트맵", { onClick: openSitemap, parentElement: openerAncestor });
      return opener;
    },
    replaceTarget() {
      targetButton.isConnected = false;
      targetButton = button(target.buttonLabel, { onClick: navigate, parentElement: targetAncestor });
      return targetButton;
    },
    detachOpener() { opener.isConnected = false; },
    detachTarget() { targetButton.isConnected = false; },
  };
  return fixture;
}

export async function withMarketNavigationGlobals(fixture, run) {
  const previousDocument = globalThis.document;
  const previousStyle = globalThis.getComputedStyle;
  globalThis.document = fixture.document;
  globalThis.getComputedStyle = (element) => {
    if (element.styleThrows) throw new Error("synthetic style read failure");
    return { display: element.styleDisplay, visibility: element.styleVisibility };
  };
  try {
    return await run();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousStyle === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = previousStyle;
  }
}
