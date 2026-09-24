import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import canvas from './backtest-canvas.js';

const source = fs.readFileSync(new URL('./backtest-canvas.js', import.meta.url), 'utf8');
function render(map, trials) {
  const nodes = [];
  const el = (_tag, className, textContent) => {
    const node = { className, textContent, style: {}, attributes: {}, children: [],
      setAttribute(key, value) { this.attributes[key] = value; },
      appendChild(child) { this.children.push(child); } };
    nodes.push(node);
    return node;
  };
  const context = vm.createContext({ el, heatIntensity: canvas.heatIntensity,
    formatRatioValue: canvas.formatRatioValue, button: () => el('button'), MODE_TABS: [['design', '기법']] });
  const start = source.indexOf('  function renderOptimizeResult(res)');
  vm.runInContext(source.slice(start, source.indexOf('  function renderDeploy()', start)), context);
  if (map) context.renderHeatmap(map, trials);
  else context.renderOptimizeResult({ trials: [{ params: { fast: 5 }, sharpe: 1 }], best: null });
  return nodes;
}

test('the thirty-cell heatmap uses six fast columns and five slow rows regardless of response ordering', () => {
  const cells = [5, 10, 15, 20, 25, 30].flatMap(x => [40, 60, 80, 100, 120].map(y => ({ x, y, sharpe: x / y })));
  const nodes = render({ x_axis: 'fast', y_axis: 'slow', cells: cells.reverse(), min_sharpe: 0, max_sharpe: 1 });
  const grid = nodes.find(n => n.className === 'backtest-heatmap-grid');
  assert.match(grid.attributes.style, /repeat\(6, 42px\)/);
  assert.match(grid.attributes.style, /repeat\(6, 30px\)/);
  const data = nodes.filter(n => n.className === 'backtest-heatmap-cell');
  assert.equal(data.length, 30);
  for (const cell of cells) {
    const node = data.find(n => n.attributes.title.startsWith(`fast ${cell.x} · slow ${cell.y} ·`));
    assert.equal(node.attributes.style, `grid-column:${cell.x / 5 + 1};grid-row:${cell.y / 20}`);
    assert.equal(node.textContent, canvas.formatRatioValue(cell.sharpe));
  }
  assert.deepEqual(nodes.filter(n => n.className === 'backtest-heatmap-axis').map(n => n.textContent),
    ['slow ↓ / fast →', '5', '10', '15', '20', '25', '30', '40', '60', '80', '100', '120']);
});

test('random gaps keep their coordinate positions and failed trials remain distinct from zero Sharpe', () => {
  const nodes = render({ x_axis: 'fast', y_axis: 'slow', min_sharpe: 0, max_sharpe: 1,
    cells: [{ x: 5, y: 40, sharpe: 0 }, { x: 10, y: 60, sharpe: 1 }] }, [
    { params: { fast: 5, slow: 40 }, sharpe: 0 },
    { params: { fast: 10, slow: 60 }, sharpe: 1 },
    { params: { fast: 15, slow: 80 }, sharpe: null },
  ]);
  const data = nodes.filter(n => n.className.startsWith('backtest-heatmap-cell'));
  assert.equal(data.length, 3); // Six unsampled cross-products are genuinely blank.
  assert.equal(data[0].textContent, canvas.formatRatioValue(0));
  assert.equal(data[0].className, 'backtest-heatmap-cell');
  assert.equal(data[1].attributes.style, 'grid-column:3;grid-row:3');
  assert.equal(data[2].attributes.style, 'grid-column:4;grid-row:4');
  assert.equal(data[2].textContent, '—');
  assert.match(data[2].attributes['aria-label'], /결과 없음/);
});

test('empty results and a one-axis optimization render without inventing a second axis', () => {
  const empty = render({ x_axis: 'fast', y_axis: 'slow', cells: [] });
  assert.ok(empty.some(n => n.textContent === '히트맵에 표시할 결과가 없습니다'));
  assert.ok(!empty.some(n => n.className === 'backtest-heatmap-grid'));
  assert.ok(!render(null).some(n => n.className === 'backtest-heatmap-grid'));
});

test('a sparse thousand-sample random result does not allocate a million empty cells', () => {
  const cells = Array.from({ length: 1000 }, (_, i) => ({ x: i, y: i * 2, sharpe: 1 }));
  const nodes = render({ x_axis: 'x', y_axis: 'y', cells, min_sharpe: 1, max_sharpe: 1 });
  assert.equal(nodes.filter(n => n.className === 'backtest-heatmap-cell').length, 1000);
  assert.ok(nodes.length < 3100);
});
