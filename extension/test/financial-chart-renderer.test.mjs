import test from "node:test";
import assert from "node:assert/strict";
import { createFinancialChartRenderer } from "../src/sidepanel/financial-chart-renderer.mjs";

function card(pageIndex = 0) {
  return {
    jobId: "00000000-0000-4000-8000-000000000001",
    page: { pageIndex },
    data: {
      symbol: "005930",
      chart: {
        period: "day", target: "stock", trId: "ka10081",
        candles: [{ time: "2026-10-19", open: 1, high: 2, low: 1, close: 2, volume: 3 }],
      },
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("chart facade reuses ChartCard/AITS, disables automatic history, prepends, and destroys", async (t) => {
  const previousWindow = globalThis.window;
  const calls = { render: [], prepend: [], destroy: 0 };
  globalThis.window = { AthenaLib: {
    ChartCard: {
      async createChartCard(_host, options) {
        calls.render.push(options);
        return { setData() {}, destroy() {} };
      },
    },
    AitsChartPanel: {
      createAitsChartPanelAdapter({ renderChart }) {
        return {
          async openPanel(host, body, context) {
            await renderChart(host, { ...context, ohlcv: body.candles, onHistoryRequest: () => "must be removed" });
            return { panelId: context.panelId };
          },
          async prependHistory(panelId, candles) { calls.prepend.push({ panelId, candles }); return candles.length; },
          destroyAll() { calls.destroy += 1; },
        };
      },
    },
  } };
  t.after(() => { globalThis.window = previousWindow; });
  const renderer = createFinancialChartRenderer();
  await renderer.mount({}, card());
  assert.equal(calls.render[0].onHistoryRequest, undefined);
  assert.equal(calls.render[0].onReloadRequest, undefined);
  assert.equal(calls.render[0].authoringStorage, null);
  assert.equal(await renderer.prepend(card(1)), 1);
  renderer.destroy();
  assert.equal(calls.destroy, 1);
});

test("a partially initialized adapter is disposed when its mount rejects", async (t) => {
  const previousWindow = globalThis.window;
  const calls = { destroy: 0 };
  globalThis.window = { AthenaLib: {
    ChartCard: { async createChartCard() { return {}; } },
    AitsChartPanel: {
      createAitsChartPanelAdapter() {
        return {
          async openPanel() { throw new Error("partial setup failed"); },
          destroyAll() { calls.destroy += 1; },
        };
      },
    },
  } };
  t.after(() => { globalThis.window = previousWindow; });

  const renderer = createFinancialChartRenderer();
  await assert.rejects(renderer.mount({}, card()), /partial setup failed/);
  assert.equal(calls.destroy, 1);
  await assert.rejects(renderer.prepend(card(1)), /과거 차트 페이지/);
  renderer.destroy();
  assert.equal(calls.destroy, 1);
});

test("a late rejection from adapter A cannot destroy or clear mounted adapter B", async (t) => {
  const previousWindow = globalThis.window;
  const firstOpen = deferred();
  const adapters = [];
  globalThis.window = { AthenaLib: {
    ChartCard: { async createChartCard() { return {}; } },
    AitsChartPanel: {
      createAitsChartPanelAdapter() {
        const index = adapters.length;
        const calls = { destroy: 0, prepend: 0 };
        const adapter = {
          calls,
          openPanel: index === 0
            ? () => firstOpen.promise
            : async (_host, _body, context) => ({ panelId: context.panelId }),
          async prependHistory(_panelId, candles) { calls.prepend += 1; return candles.length; },
          destroyAll() { calls.destroy += 1; },
        };
        adapters.push(adapter);
        return adapter;
      },
    },
  } };
  t.after(() => { globalThis.window = previousWindow; });

  const renderer = createFinancialChartRenderer();
  const firstMount = renderer.mount({}, card());
  const firstRejected = assert.rejects(firstMount, /adapter A failed late/);
  await renderer.mount({}, card());
  firstOpen.reject(new Error("adapter A failed late"));
  await firstRejected;

  assert.equal(adapters[0].calls.destroy, 1);
  assert.equal(adapters[1].calls.destroy, 0);
  assert.equal(await renderer.prepend(card(1)), 1);
  assert.equal(adapters[1].calls.prepend, 1);
  renderer.destroy();
  assert.equal(adapters[1].calls.destroy, 1);
});
