import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const canvas = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');

function functionSource(name, nextMarker) {
  const start = canvas.indexOf(`function ${name}`);
  const end = canvas.indexOf(nextMarker, start + 1);
  assert.notEqual(start, -1, `${name} source missing`);
  assert.notEqual(end, -1, `${nextMarker} source missing`);
  return canvas.slice(start, end);
}

function makeElement(className = '') {
  const classes = new Set(className.split(/\s+/).filter(Boolean));
  return {
    hidden: false,
    style: {},
    parentElement: null,
    classList: { contains: (name) => classes.has(name) },
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    },
  };
}

function orderbookHarness() {
  const metrics = { renders: 0, acquires: 0, releases: 0, collapses: 0 };
  const mountPoint = {
    children: [makeElement('paper-orderbook-mockup')],
    dataset: {},
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
  };
  mountPoint.children[0].parentElement = mountPoint;
  const context = {
    BOARD_ORDERBOOK_RENDERER: 'orderbook-ladder',
    window: {
      AthenaLib: {
        CardKinds: {
          resolve: () => (envelope) => {
            metrics.renders += 1;
            const built = makeElement('card-kit-hoga-live');
            built.envelope = envelope;
            return built;
          },
        },
        CardKindHoga: { supportsLive0D: () => true, applyLiveTick() {} },
      },
    },
    boardMount: {
      collapsePrimaryMockup(target) {
        metrics.collapses += 1;
        for (const child of target.children) if (!child.hidden) child.hidden = true;
      },
    },
    wireOrderbookRealtime() {
      metrics.acquires += 1;
      let released = false;
      return () => {
        if (released) return false;
        released = true;
        metrics.releases += 1;
        return true;
      };
    },
  };
  const mount = vm.runInNewContext(
    `(${functionSource('mountBoardOrderbook', 'async function mountBoardPrimary')})`,
    context,
  );
  return {
    mount,
    metrics,
    mountPoint,
    primary: { mountPoint },
    state: { primaryOrderbookEnvelope: null, primaryRelease: null },
    card: {},
  };
}

function visibleLadders(mountPoint) {
  return mountPoint.children.filter(
    (child) => child.classList.contains('card-kit-hoga-live') && !child.hidden,
  );
}

test('동일 load cycle의 같은 호가 봉투는 render와 acquire를 한 번만 수행한다', () => {
  const h = orderbookHarness();
  const envelope = { operation_ref: 'detail:ka10007:bid_prices', symbol: '005930' };
  const first = h.mount(h.card, h.state, h.primary, envelope);
  const second = h.mount(h.card, h.state, h.primary, envelope);

  assert.equal(second, first);
  assert.equal(h.metrics.renders, 1);
  assert.equal(h.metrics.acquires, 1);
  assert.equal(h.metrics.releases, 0);
  assert.deepEqual(visibleLadders(h.mountPoint), [first]);
});

test('새 hydrate 봉투나 다른 종목 봉투는 이전 lease와 DOM을 놓고 다시 마운트한다', () => {
  const h = orderbookHarness();
  const initial = { operation_ref: 'detail:ka10007:bid_prices', symbol: '005930', snapshot: 1 };
  const hydrated = { operation_ref: 'detail:ka10007:bid_prices', symbol: '005930', snapshot: 2 };
  const otherSymbol = { operation_ref: 'detail:ka10007:bid_prices', symbol: '000660', snapshot: 3 };

  const first = h.mount(h.card, h.state, h.primary, initial);
  const second = h.mount(h.card, h.state, h.primary, hydrated);
  assert.equal(first.parentElement, null);
  assert.equal(h.metrics.releases, 1);
  assert.equal(h.metrics.renders, 2);
  assert.equal(h.metrics.acquires, 2);
  assert.deepEqual(visibleLadders(h.mountPoint), [second]);

  const third = h.mount(h.card, h.state, h.primary, otherSymbol);
  assert.equal(second.parentElement, null);
  assert.equal(h.metrics.releases, 2);
  assert.equal(h.metrics.renders, 3);
  assert.equal(h.metrics.acquires, 3);
  assert.deepEqual(visibleLadders(h.mountPoint), [third]);
  assert.equal(h.state.primaryOrderbookEnvelope, otherSymbol);
});

test('primary destroy는 호가 envelope 신원을 지우고 lease를 한 번만 놓는다', () => {
  let releases = 0;
  const destroy = vm.runInNewContext(
    `(${functionSource('destroyBoardPrimary', 'function boardChartDescriptor')})`,
    {
      clearTimeout() {},
      settleBoardChartMount() {},
      aitsChartPanels: { destroyPanel: () => false },
      window: { athena: { send() {} } },
    },
  );
  const state = {
    primaryRefreshTimer: null,
    primaryRefreshing: false,
    primaryEnvelope: {},
    primaryOrderbookEnvelope: {},
    primaryDescriptor: null,
    primaryMount: null,
    primaryRelease: () => { releases += 1; return true; },
    primaryPanelId: '',
  };

  assert.equal(destroy(state), true);
  assert.equal(state.primaryOrderbookEnvelope, null);
  assert.equal(state.primaryRelease, null);
  assert.equal(releases, 1);
  assert.equal(destroy(state), false);
  assert.equal(releases, 1);
});
