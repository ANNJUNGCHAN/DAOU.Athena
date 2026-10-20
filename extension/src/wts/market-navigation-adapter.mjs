export async function runMarketNavigationAdapter({ mode, expectedState, actionId, args, catalog } = {}) {
  const OPEN_SITEMAP = "wts.main.sitemap.open";
  const NAVIGATE_MARKET = "wts.main.p1.market.navigate";
  const SITEMAP_HEADING = "키움증권 웹트레이딩(WTS) 전체 메뉴";
  const STATE_KEYS = [
    "stateKind",
    "targetId",
    "blocked",
    "sitemapVisible",
    "sitemapOpenEnabled",
    "targetAvailable",
    "activeTargetId",
    "screenId",
    "instrumentToken",
    "contextToken",
  ];

  const compact = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  const visible = (element) => {
    if (!element) return false;
    for (let current = element; current; current = current.parentElement) {
      if (current.hidden || current.getAttribute?.("aria-hidden") === "true") return false;
      const rect = current.getBoundingClientRect?.();
      if (rect && rect.width === 0 && rect.height === 0) return false;
      try {
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden") return false;
      } catch {
        return false;
      }
    }
    return true;
  };
  const disabled = (element) => Boolean(
    element?.disabled
    || element?.getAttribute?.("disabled") !== null
    || element?.getAttribute?.("aria-disabled") === "true"
  );
  const label = (element) => {
    const accessible = compact(element?.getAttribute?.("aria-label"));
    return accessible || compact(element?.innerText || element?.textContent);
  };
  const queryVisible = (root, selector) => Array.from(root?.querySelectorAll?.(selector) || []).filter(visible);
  const exactObject = (value, keys) => (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key))
  );
  const digest = async (value) => {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const validTarget = (target) => {
    if (!exactObject(target, ["id", "sitemapGroup", "buttonLabel", "assertion"])) return false;
    if (![target.id, target.sitemapGroup, target.buttonLabel].every((value) => typeof value === "string" && value.length > 0)) {
      return false;
    }
    const assertion = target.assertion;
    if (assertion?.kind === "group-child") {
      return exactObject(assertion, ["kind", "group", "child"])
        && typeof assertion.group === "string"
        && assertion.group.length > 0
        && typeof assertion.child === "string"
        && assertion.child.length > 0;
    }
    return assertion?.kind === "top-active"
      && exactObject(assertion, ["kind", "topActive"])
      && typeof assertion.topActive === "string"
      && assertion.topActive.length > 0;
  };
  const normalizeCatalog = (value) => {
    if (!Array.isArray(value) || value.length === 0 || !value.every(validTarget)) return null;
    const ids = value.map((target) => target.id);
    return new Set(ids).size === ids.length ? value : null;
  };

  const safeTargetId = typeof args?.targetId === "string" ? compact(args.targetId) : "";
  const normalizedCatalog = normalizeCatalog(catalog);
  const matchingTargets = normalizedCatalog?.filter((target) => target.id === safeTargetId) || [];
  const targetDefinition = matchingTargets.length === 1 ? matchingTargets[0] : null;
  const validArgs = exactObject(args, ["targetId"]) && args.targetId === safeTargetId && Boolean(targetDefinition);
  const validAction = actionId === OPEN_SITEMAP || actionId === NAVIGATE_MARKET;

  const snapshot = () => {
    const allButtons = queryVisible(document, "button");
    const openers = allButtons.filter((button) => label(button) === "사이트맵");
    const opener = openers.length === 1 ? openers[0] : null;
    const sitemapOpenEnabled = Boolean(opener && !disabled(opener));

    const broadModals = Array.from(new Set(queryVisible(
      document,
      ".modal-container, [role='dialog'], [aria-modal='true']",
    )));
    const modalContainers = queryVisible(document, ".modal-container");
    const sitemapModals = modalContainers.filter((modal) => {
      const headings = queryVisible(modal, "h1, h2, h3, h4, h5, h6, [role='heading']");
      return headings.length === 1 && label(headings[0]) === SITEMAP_HEADING;
    });
    const sitemap = sitemapModals.length === 1 ? sitemapModals[0] : null;
    const sitemapVisible = Boolean(sitemap);
    const foreignModal = broadModals.some((modal) => modal !== sitemap);
    const modalAmbiguous = sitemapModals.length > 1;

    let targetButton = null;
    if (sitemap && targetDefinition) {
      const groups = queryVisible(sitemap, "dl").filter((group) => {
        const terms = queryVisible(group, "dt");
        return terms.length === 1 && label(terms[0]) === targetDefinition.sitemapGroup;
      });
      if (groups.length === 1) {
        const targets = queryVisible(groups[0], "dd button")
          .filter((button) => label(button) === targetDefinition.buttonLabel);
        if (targets.length === 1 && !disabled(targets[0])) targetButton = targets[0];
      }
    }
    const targetAvailable = Boolean(targetButton);

    const articles = queryVisible(document, "article");
    const p1Candidates = articles.filter((article) => {
      const buttons = queryVisible(article, "button");
      return buttons.filter((button) => label(button) === "순위분석").length === 1
        && buttons.filter((button) => label(button) === "빅데이터").length === 1;
    });
    const p1 = p1Candidates.length === 1 ? p1Candidates[0] : null;

    let activeTargetId = null;
    if (p1 && normalizedCatalog) {
      const activePairs = [];
      for (const depth of queryVisible(p1, "li.depth.active")) {
        const groupButtons = queryVisible(depth, "button");
        if (groupButtons.length === 0) continue;
        const group = label(groupButtons[0]);
        for (const childButton of queryVisible(depth, "li.active > button")) {
          activePairs.push({ group, child: label(childButton) });
        }
      }
      const topActiveLabels = queryVisible(p1, "li.active > button")
        .filter((button) => !button.closest?.("li.depth"))
        .map(label);
      if (activePairs.length + topActiveLabels.length === 1) {
        const activeMatches = normalizedCatalog.filter((target) => (
          target.assertion.kind === "group-child"
            ? activePairs.some((pair) => pair.group === target.assertion.group && pair.child === target.assertion.child)
            : topActiveLabels[0] === target.assertion.topActive
        ));
        if (activeMatches.length === 1) activeTargetId = activeMatches[0].id;
      }
    }

    const articleAreas = queryVisible(document, "article.article-area");
    const p3 = articleAreas.length === 4 ? articleAreas[3] : null;
    const instruments = queryVisible(p3, "button.jongmok-info")
      .map((element) => ({ element, stockLabel: compact(element.innerText || element.textContent) }));
    const stockLabel = instruments.length === 1 ? instruments[0].stockLabel : "";
    const instrumentReady = instruments.length === 1 && stockLabel.length > 0;
    const screenId = p1 && instrumentReady ? "main-market-navigation" : "unknown";
    const blocked = Boolean(
      screenId === "unknown"
      || foreignModal
      || modalAmbiguous
      || (sitemapVisible ? !targetAvailable : !sitemapOpenEnabled)
    );
    const baseState = {
      stateKind: "market-navigation",
      targetId: targetDefinition?.id || safeTargetId,
      blocked,
      sitemapVisible,
      sitemapOpenEnabled,
      targetAvailable,
      activeTargetId,
      screenId,
    };
    return {
      baseState,
      stockLabel,
      rawState: JSON.stringify({ ...baseState, stockLabel }),
      targets: { opener, targetButton },
    };
  };
  const observe = async () => {
    const current = snapshot();
    const instrumentToken = await digest(current.stockLabel);
    const contextToken = await digest(current.rawState);
    return {
      ...current,
      state: { ...current.baseState, instrumentToken, contextToken },
    };
  };
  const result = (state, acted, reason) => ({ state, acted, reason });
  const fallbackState = async () => {
    const instrumentToken = await digest("");
    const contextToken = await digest("athena-wts-market-navigation-adapter-error");
    return {
      stateKind: "market-navigation",
      targetId: targetDefinition?.id || safeTargetId,
      blocked: true,
      sitemapVisible: false,
      sitemapOpenEnabled: false,
      targetAvailable: false,
      activeTargetId: null,
      screenId: "unknown",
      instrumentToken,
      contextToken,
    };
  };

  let acted = false;
  let lastState = null;
  try {
    if (!validAction || !validArgs) return result(await fallbackState(), false, "EXECUTION_ERROR");
    const before = await observe();
    lastState = before.state;
    if (mode === "observe") return result(before.state, false, null);
    if (mode !== "execute") return result(before.state, false, "EXECUTION_ERROR");
    if (
      !exactObject(expectedState, STATE_KEYS)
      || STATE_KEYS.some((key) => expectedState[key] !== before.state[key])
    ) {
      return result(before.state, false, "PRECONDITION_CHANGED");
    }

    const openReady = actionId === OPEN_SITEMAP
      && before.state.screenId === "main-market-navigation"
      && !before.state.blocked
      && !before.state.sitemapVisible
      && before.state.sitemapOpenEnabled
      && before.state.activeTargetId !== targetDefinition.id;
    const navigateReady = actionId === NAVIGATE_MARKET
      && before.state.screenId === "main-market-navigation"
      && !before.state.blocked
      && before.state.sitemapVisible
      && before.state.targetAvailable
      && before.state.activeTargetId !== targetDefinition.id;
    if (!openReady && !navigateReady) return result(before.state, false, "PRECONDITION_CHANGED");

    const target = openReady ? before.targets.opener : before.targets.targetButton;
    const fresh = snapshot();
    const freshTarget = openReady ? fresh.targets.opener : fresh.targets.targetButton;
    if (
      fresh.rawState !== before.rawState
      || !target
      || target.isConnected !== true
      || freshTarget !== target
      || disabled(target)
      || !visible(target)
    ) {
      return result(before.state, false, "PRECONDITION_CHANGED");
    }

    target.click();
    acted = true;
    const after = await observe();
    lastState = after.state;
    return result(after.state, true, null);
  } catch {
    if (lastState) return result(lastState, acted, "EXECUTION_ERROR");
    try {
      return result((await observe()).state, false, "EXECUTION_ERROR");
    } catch {
      return result(await fallbackState(), false, "EXECUTION_ERROR");
    }
  }
}
