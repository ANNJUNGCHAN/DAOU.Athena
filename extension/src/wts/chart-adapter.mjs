export async function runChartAdapter({ mode, expectedState, actionId, args } = {}) {
  const OPEN_CHART = "wts.main.p3.chart.open";
  const SET_PERIOD = "wts.main.p3.chart.period.set";
  const TAB_LABELS = new Map([
    ["종목시세", "quote"],
    ["차트", "chart"],
    ["뉴스", "news"],
    ["잔고", "balance"],
    ["체결/거래", "trades"],
  ]);
  const PERIOD_LABELS = new Map([
    ["일", "day"],
    ["주", "week"],
    ["월", "month"],
    ["년", "year"],
    ["분", "other"],
    ["1", "other"],
    ["3", "other"],
    ["5", "other"],
  ]);

  const compact = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  const visible = (element) => {
    if (!element || element.hidden || element.getAttribute?.("aria-hidden") === "true") return false;
    const rect = element.getBoundingClientRect?.();
    if (rect && rect.width === 0 && rect.height === 0) return false;
    try {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    } catch {
      return true;
    }
  };
  const disabled = (element) => Boolean(
    element?.disabled
    || element?.getAttribute?.("disabled") !== null
    || element?.getAttribute?.("aria-disabled") === "true"
  );
  const selected = (element) => Boolean(
    element?.classList?.contains?.("on")
    || element?.getAttribute?.("aria-selected") === "true"
  );
  const activeTabButton = (element) => Boolean(
    element?.parentElement?.classList?.contains?.("active")
    || element?.classList?.contains?.("active")
    || element?.getAttribute?.("aria-selected") === "true"
  );
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

  const snapshot = () => {
    const modalBlocked = queryVisible(document, ".modal-container, [role='dialog'], [aria-modal='true']").length > 0;
    const articles = queryVisible(document, "article.article-area");
    const p3 = articles.length === 4 ? articles[3] : null;
    const tabButtons = queryVisible(p3, ".default-tab-menu-depth.depth-1 > ul > li > button");
    const tabsByName = new Map();
    for (const button of tabButtons) {
      const name = compact(button.innerText || button.textContent);
      if (!tabsByName.has(name)) tabsByName.set(name, []);
      tabsByName.get(name).push(button);
    }
    const exactTabs = TAB_LABELS.size === tabButtons.length
      && Array.from(TAB_LABELS.keys()).every((name) => tabsByName.get(name)?.length === 1);
    const activeButtons = exactTabs ? tabButtons.filter(activeTabButton) : [];
    const activeTab = activeButtons.length === 1
      ? TAB_LABELS.get(compact(activeButtons[0].innerText || activeButtons[0].textContent)) || "unknown"
      : "unknown";

    const instruments = queryVisible(p3, "button.jongmok-info")
      .map((element) => ({ element, label: compact(element.innerText || element.textContent) }));
    const stockLabel = instruments.length === 1 ? instruments[0].label : "";
    const instrumentReady = instruments.length === 1 && stockLabel.length > 0;

    const charts = queryVisible(p3, "div.chart");
    const chart = charts.length === 1 ? charts[0] : null;
    const chartCanvases = queryVisible(chart, "canvas#Main04002Chart_Canvas");
    const chartShapeReady = charts.length === 1 && chartCanvases.length === 1;
    const periodButtons = queryVisible(p3, ".setting-area button")
      .filter((button) => PERIOD_LABELS.has(compact(button.innerText || button.textContent)));
    const periodByName = new Map();
    for (const button of periodButtons) {
      const name = compact(button.innerText || button.textContent);
      if (!periodByName.has(name)) periodByName.set(name, []);
      periodByName.get(name).push(button);
    }
    const selectedPeriods = periodButtons.filter(selected);
    const periodShapeReady = periodByName.get("일")?.length === 1
      && periodByName.get("주")?.length === 1
      && periodByName.get("월")?.length === 1
      && periodByName.get("년")?.length === 1
      && selectedPeriods.length === 1;
    const selectedPeriodName = selectedPeriods.length === 1
      ? compact(selectedPeriods[0].innerText || selectedPeriods[0].textContent)
      : "";
    const period = selectedPeriodName ? PERIOD_LABELS.get(selectedPeriodName) || "other" : "none";

    let screenId = "unknown";
    if (p3 && exactTabs && activeTab !== "unknown" && instrumentReady) {
      if (activeTab === "chart") {
        if (chartShapeReady && periodShapeReady) screenId = "main-chart";
      } else {
        screenId = "main-other";
      }
    }
    const chartButton = exactTabs ? tabsByName.get("차트")?.[0] : null;
    const dayButton = periodByName.get("일")?.length === 1 ? periodByName.get("일")[0] : null;
    const weekButton = periodByName.get("주")?.length === 1 ? periodByName.get("주")[0] : null;
    const monthButton = periodByName.get("월")?.length === 1 ? periodByName.get("월")[0] : null;
    const yearButton = periodByName.get("년")?.length === 1 ? periodByName.get("년")[0] : null;
    const chartOpenEnabled = Boolean(
      screenId !== "unknown" && !modalBlocked && chartButton && !disabled(chartButton)
    );
    const periodEnabled = Boolean(
      screenId === "main-chart"
      && !modalBlocked
      && periodShapeReady
      && !disabled(dayButton)
      && !disabled(weekButton)
      && !disabled(monthButton)
      && !disabled(yearButton)
    );
    const baseState = {
      screenId,
      activeTab,
      period: screenId === "main-chart" ? period : "none",
      blocked: modalBlocked,
      chartOpenEnabled,
      periodEnabled,
    };
    return {
      baseState,
      stockLabel,
      rawState: JSON.stringify({ ...baseState, stockLabel }),
      targets: { chartButton, dayButton, weekButton, monthButton, yearButton },
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
  let acted = false;
  let lastState = null;
  try {
    const before = await observe();
    lastState = before.state;
    if (mode === "observe") return result(before.state, false, null);
    if (mode !== "execute") return result(before.state, false, "EXECUTION_ERROR");

    const validOpenArgs = actionId === OPEN_CHART && exactObject(args, []);
    const validPeriodArgs = actionId === SET_PERIOD
      && exactObject(args, ["period"])
      && ["day", "week", "month", "year"].includes(args.period);
    if (!validOpenArgs && !validPeriodArgs) return result(before.state, false, "EXECUTION_ERROR");
    const stateKeys = [
      "screenId",
      "activeTab",
      "period",
      "blocked",
      "chartOpenEnabled",
      "periodEnabled",
      "instrumentToken",
      "contextToken",
    ];
    if (
      !exactObject(expectedState, stateKeys)
      || stateKeys.some((key) => expectedState[key] !== before.state[key])
    ) {
      return result(before.state, false, "PRECONDITION_CHANGED");
    }

    let target = null;
    if (validOpenArgs) {
      if (
        before.state.screenId !== "main-other"
        || before.state.activeTab === "chart"
        || !before.state.chartOpenEnabled
      ) return result(before.state, false, "PRECONDITION_CHANGED");
      target = before.targets.chartButton;
    } else {
      if (
        before.state.screenId !== "main-chart"
        || !before.state.periodEnabled
        || before.state.period === args.period
      ) return result(before.state, false, "PRECONDITION_CHANGED");
      target = {
        day: before.targets.dayButton,
        week: before.targets.weekButton,
        month: before.targets.monthButton,
        year: before.targets.yearButton,
      }[args.period];
    }
    const fresh = snapshot();
    const freshTarget = validOpenArgs
      ? fresh.targets.chartButton
      : {
        day: fresh.targets.dayButton,
        week: fresh.targets.weekButton,
        month: fresh.targets.monthButton,
        year: fresh.targets.yearButton,
      }[args.period];
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
      const fallback = await observe();
      return result(fallback.state, false, "EXECUTION_ERROR");
    } catch {
      const contextToken = await digest("athena-wts-chart-adapter-error");
      const instrumentToken = await digest("");
      return result({
        screenId: "unknown",
        activeTab: "unknown",
        period: "none",
        blocked: true,
        chartOpenEnabled: false,
        periodEnabled: false,
        instrumentToken,
        contextToken,
      }, false, "EXECUTION_ERROR");
    }
  }
}
