function library() {
  const chartCard = globalThis.window?.AthenaLib?.ChartCard;
  const aits = globalThis.window?.AthenaLib?.AitsChartPanel;
  if (typeof chartCard?.createChartCard !== "function" || typeof aits?.createAitsChartPanelAdapter !== "function") {
    throw new Error("로컬 차트 라이브러리를 불러오지 못했습니다.");
  }
  return { chartCard, aits };
}

export function createFinancialChartRenderer() {
  let current = null;

  function dispose(state) {
    if (!state || state.destroyed) return;
    state.destroyed = true;
    state.adapter.destroyAll();
  }

  async function mount(container, card) {
    destroy();
    const { chartCard, aits } = library();
    const state = {
      adapter: aits.createAitsChartPanelAdapter({
        maxPanels: 1,
        renderChart: (host, options) => chartCard.createChartCard(host, {
          ...options,
          // Financial paging is explicit. Reaching the left edge never performs
          // a Native request by itself.
          onHistoryRequest: undefined,
          onReloadRequest: undefined,
          authoringStorage: null,
        }),
      }),
      card,
      destroyed: false,
      session: null,
    };
    current = state;
    try {
      state.session = await state.adapter.openPanel(container, card.data.chart, {
        panelId: `financial:${card.jobId}`,
        scopeId: `financial:${card.jobId}`,
        stock: card.data.symbol,
        symbol: card.data.symbol,
        source: "financial-query",
        generation: card.page.pageIndex + 1,
      });
      if (current !== state) throw new Error("차트 마운트가 새 요청으로 교체되었습니다.");
      return state.session;
    } catch (error) {
      dispose(state);
      if (current === state) current = null;
      throw error;
    }
  }

  async function prepend(card) {
    const state = current;
    if (!state || !state.session || state.card.jobId !== card.jobId) {
      throw new Error("과거 차트 페이지를 붙일 현재 차트가 없습니다.");
    }
    const added = await state.adapter.prependHistory(state.session.panelId, card.data.chart.candles);
    if (current === state) state.card = card;
    return added;
  }

  function destroy() {
    const state = current;
    current = null;
    dispose(state);
  }

  return Object.freeze({ mount, prepend, destroy });
}
