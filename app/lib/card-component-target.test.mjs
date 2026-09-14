import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createController, resolveSelection } = require('./card-component-target');

function classes(...initial) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle(name, force) { if (force) values.add(name); else values.delete(name); },
    contains: (name) => values.has(name),
  };
}

function source() {
  const listeners = new Map();
  return {
    classList: classes(),
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    emit(type, event = {}) { const listener = listeners.get(type); if (listener) listener(event); },
    querySelectorAll() { return []; },
  };
}

function target(mapping) {
  return { closest: (selector) => mapping[selector] || null };
}

function card(envelope, nodes = {}) {
  return {
    dataset: { sessionCardId: 'card-1' },
    classList: classes('card'),
    __athenaSessionCard: { envelope },
    querySelectorAll(selector) { return nodes[selector] || []; },
  };
}

test('chart, facts metric, and table row resolve to validated envelope paths', () => {
  const chartNode = { classList: classes() };
  const chartCard = card({ data: { chart: { candles: [1, 2] } } });
  assert.deepEqual(resolveSelection(chartCard, target({ '.chart-card-body, .chart-indicator-panel, [class*="chart-indicator"], [class*="chart-legend"]': chartNode })).selectedComponent, {
    path: 'data.chart', label: '차트',
  });

  const fact = { classList: classes() };
  const factCard = card({ data: { fields: [{ key: 'price', value: 123 }] } }, { '.facts-grid .facts-row': [fact] });
  assert.deepEqual(resolveSelection(factCard, target({ '.facts-row': fact })).selectedComponent, {
    path: 'data.fields.0', label: '지표 1',
  });

  const row = { classList: classes() };
  const table = { querySelectorAll: () => [row] };
  const tableCard = card({ data: { rows: [{ symbol: '023590', price: 22200 }] } });
  assert.deepEqual(resolveSelection(tableCard, target({ 'tbody tr': row, table })).selectedComponent, {
    path: 'data.rows.0', label: '표 1행',
  });
});

test('inactive mode does not intercept card interaction; active mode emits only structured context', () => {
  const root = source();
  const button = { ...source(), setAttribute() {} };
  const clearButton = source();
  const doc = source();
  const selection = { hidden: true };
  const selectionLabel = { textContent: '' };
  const chartNode = { classList: classes(), textContent: '현재가\n22,200   거래량 9,000' };
  const chartCard = card({ data: { chart: { candles: [{ close: 22000 }] } } });
  const clicked = target({
    '.card[data-session-card-id]': chartCard,
    '.chart-card-body, .chart-indicator-panel, [class*="chart-indicator"], [class*="chart-legend"]': chartNode,
  });
  let prevented = 0;
  const event = { target: clicked, preventDefault: () => { prevented += 1; }, stopPropagation() {}, stopImmediatePropagation() {} };
  const controller = createController({ root, button, selection, selectionLabel, clearButton, document: doc });

  root.emit('click', event);
  assert.equal(prevented, 0);
  assert.equal(controller.getContext(), null);

  button.emit('click');
  root.emit('click', event);
  assert.equal(prevented, 1);
  assert.equal(controller.isTargeting(), false);
  assert.equal(selection.hidden, false);
  assert.equal(selectionLabel.textContent, '차트');
  const context = controller.getContext();
  assert.equal(context.selectedCardId, 'card-1');
  assert.deepEqual(context.selectedComponent, { path: 'data.chart', label: '차트' });
  assert.deepEqual(
    { cardId: context.observation.cardId, path: context.observation.path, source: context.observation.source, text: context.observation.text },
    { cardId: 'card-1', path: 'data.chart', source: 'renderer-visible', text: '현재가 22,200 거래량 9,000' },
  );
  assert.equal(context.selectionMode, 'explicit-component');
  assert.match(context.observation.observedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(Object.hasOwn(context, 'snapshot'), false);
  assert.equal(chartNode.classList.contains('component-question-selected'), true);

  clearButton.emit('click');
  assert.equal(controller.getContext(), null);
  assert.equal(chartNode.classList.contains('component-question-selected'), false);
});

test('without an explicit component, the newest active card id grounds natural follow-up', () => {
  const root = source();
  const older = { dataset: { sessionCardId: 'card-old' }, hidden: false };
  const newest = { dataset: { sessionCardId: 'card-new' }, hidden: false };
  root.querySelectorAll = () => [older, newest];
  const controller = createController({ root });
  assert.deepEqual(controller.getContext(), {
    selectedCardId: 'card-new', selectionMode: 'implicit-active-card',
  });
});

test('implicit active-card context carries only a validated bounded visible observation', () => {
  const root = source();
  const observed = {
    dataset: { cardComponentPath: 'surface_contract.slot_values.0.value' },
    textContent: '+80주',
    getClientRects: () => [{}],
  };
  const newest = card({
    surface_contract: { slot_values: [{ slot_id: 'foreign', value: 80 }] },
  }, { '[data-card-component-observation]': [observed] });
  newest.hidden = false;
  newest.getClientRects = () => [{}];
  root.querySelectorAll = () => [newest];
  const context = createController({ root }).getContext();
  assert.equal(context.selectedCardId, 'card-1');
  assert.equal(context.selectionMode, 'implicit-active-card');
  assert.equal(Object.hasOwn(context, 'selectedComponent'), false);
  assert.deepEqual(
    { cardId: context.observation.cardId, path: context.observation.path,
      source: context.observation.source, text: context.observation.text },
    { cardId: 'card-1', path: 'surface_contract.slot_values.0.value',
      source: 'renderer-visible', text: '+80주' },
  );
});

test('unknown renderer components keep exact visible text separate from whole-envelope evidence', () => {
  const metric = { classList: classes(), dataset: { role: 'current-price' }, textContent: '22,350' };
  const metricCard = card({ data: { fields: [{ key: 'cur_prc', value: 22000 }] } });
  const resolved = resolveSelection(metricCard, target({ '[data-role], [role="cell"], li, dt, dd, [class*="metric"], [class*="value"]': metric }));
  assert.deepEqual(resolved.selectedComponent, { path: 'data', label: '현재가' });

  const root = source();
  const button = { ...source(), setAttribute() {} };
  const clicked = target({
    '.card[data-session-card-id]': metricCard,
    '[data-role], [role="cell"], li, dt, dd, [class*="metric"], [class*="value"]': metric,
  });
  const controller = createController({ root, button });
  button.emit('click');
  root.emit('click', { target: clicked, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  const context = controller.getContext();
  assert.equal(context.selectedComponent.path, 'data');
  assert.equal(context.selectedComponent.label, '현재가');
  assert.equal(context.selectionMode, 'explicit-component');
  assert.equal(context.observation.text, '22,350');
  assert.equal(context.observation.source, 'renderer-visible');
});

test('Escape cancels target mode before the canvas clear shortcut can run', () => {
  const root = source();
  const button = { ...source(), setAttribute() {} };
  const doc = source();
  const controller = createController({ root, button, document: doc });
  button.emit('click');
  let stopped = 0;
  doc.emit('keydown', {
    key: 'Escape', preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { stopped += 1; },
  });
  assert.equal(stopped, 1);
  assert.equal(controller.isTargeting(), false);
});

test('keyboard activation focuses a target and Enter selects it without firing its normal action', () => {
  const root = source();
  const button = { ...source(), setAttribute() {} };
  const targetCard = card({ data: { chart: { candles: [] } } });
  const chartNode = {
    classList: classes(), textContent: '차트', focused: false, attributes: new Map(),
    closest(selector) {
      if (selector === '.card[data-session-card-id]') return targetCard;
      if (selector.includes('.chart-card-body')) return this;
      return null;
    },
    hasAttribute(name) { return this.attributes.has(name); },
    getAttribute(name) { return this.attributes.get(name); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    focus() { this.focused = true; },
  };
  root.querySelectorAll = () => [chartNode];
  const controller = createController({ root, button });
  button.emit('click');
  assert.equal(chartNode.focused, true);
  let stopped = 0;
  root.emit('keydown', {
    key: 'Enter', target: chartNode, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { stopped += 1; },
  });
  assert.equal(stopped, 1);
  assert.equal(controller.getContext().selectedComponent.path, 'data.chart');
  assert.equal(chartNode.attributes.has('tabindex'), false, 'temporary focusability is restored after selection');
});

test('a completed request does not clear a newer component selection', () => {
  const root = source();
  const button = { ...source(), setAttribute() {} };
  const firstNode = { classList: classes(), textContent: '첫 항목' };
  const secondNode = { classList: classes(), textContent: '다음 항목' };
  const targetCard = card({ data: { value: 1 } });
  const click = (node) => target({
    '.card[data-session-card-id]': targetCard,
    '[data-role], [role="cell"], li, dt, dd, [class*="metric"], [class*="value"]': node,
  });
  const controller = createController({ root, button });
  button.emit('click');
  root.emit('click', { target: click(firstNode), preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  const submitted = controller.getContext();
  button.emit('click');
  root.emit('click', { target: click(secondNode), preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });

  assert.equal(controller.clearSelection(submitted), false);
  assert.equal(controller.getContext().observation.text, '다음 항목');
  assert.equal(secondNode.classList.contains('component-question-selected'), true);
});

test('a scoped card selector reuses targeting for Orb mini cards', () => {
  const root = source();
  const button = { ...source(), setAttribute() {} };
  const row = { classList: classes(), textContent: '현재가 41,100' };
  const orbCard = card({ data: { fields: [{ key: 'price', value: 41100 }] } }, { '.facts-grid .facts-row': [row] });
  const clicked = target({
    '[data-session-card-id]': orbCard,
    '.facts-row': row,
  });
  const controller = createController({ root, button, cardSelector: '[data-session-card-id]' });
  button.emit('click');
  root.emit('click', { target: clicked, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.deepEqual(controller.getContext().selectedComponent, { path: 'data.fields.0', label: '지표 1' });
});
