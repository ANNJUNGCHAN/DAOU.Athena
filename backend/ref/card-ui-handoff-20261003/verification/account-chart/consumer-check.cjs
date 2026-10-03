const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../../../../..');
const registry = require(path.join(root, 'app/lib/board-template-registry'));
const { mountPlan } = require(path.join(root, 'app/lib/board-mount'));
let checks = 0;
const eq = (actual, expected) => { assert.equal(actual, expected); checks++; };
class Node {
  constructor(classes = '', text = '') {
    this.className = classes; this.textContent = text; this.dataset = {}; this.children = [];
    this.hidden = false; this.style = { display: '', getPropertyValue() { return ''; }, removeProperty() {} };
    this.classList = { contains: c => this.className.split(' ').includes(c),
      add: c => { if (!this.classList.contains(c)) this.className += ' ' + c; },
      toggle: (c, flag) => { this.className = this.className.split(' ').filter(x => x && x !== c).join(' '); if (flag) this.classList.add(c); } };
  }
  setAttribute(key, value) { this[key] = value; }
  getAttribute(key) { return this[key] ?? null; }
  append(node) { node.parentElement = this; node.ownerDocument = this.ownerDocument; this.children.push(node); }
  after(node) { node.parentElement = this.parentElement; node.ownerDocument = this.ownerDocument; this.parentElement.children.splice(this.parentElement.children.indexOf(this) + 1, 0, node); }
  get firstElementChild() { return this.children[0] ?? null; }
  get nextElementSibling() { const rows = this.parentElement?.children ?? []; return rows[rows.indexOf(this) + 1] ?? null; }
  get previousElementSibling() { const rows = this.parentElement?.children ?? []; return rows[rows.indexOf(this) - 1] ?? null; }
  matches(selector) { return selector === '.bs-table' && this.classList.contains('bs-table'); }
  querySelector(selector) {
    if (selector === ':scope > .bs-account-empty-note') return this.children.find(n => n.classList.contains('bs-account-empty-note')) ?? null;
    return this.navigation ?? null;
  }
  querySelectorAll(selector) {
    if (selector === '[data-bs-value-slot="true"]') return this.valueNodes ?? [];
    if (selector === '[data-bs-design-text="true"]') return this.labels ?? [];
    return [];
  }
}
const document = { createElement: () => new Node() };
function body(source, name) {
  const text = source.replaceAll('\r\n', '\n');
  const start = text.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = text.indexOf('\n}', start) + 2;
  assert.ok(end > start, name);
  return text.slice(start, end);
}
function consumer(source) {
  const hooks = body(source, 'applyResponsiveHooks');
  const noopNames = [...hooks.matchAll(/(?<![.\w])([A-Za-z_$][\w$]*)\(/g)].map(m => m[1])
    .filter(name => !['applyResponsiveHooks', 'stripScrollOwnerOverflow', 'layoutGroup', 'if', 'for'].includes(name));
  const context = { registry, document, RESPONSIVE_REGIONS: [], popoverLayout: null,
    getComputedStyle: () => ({}), ...Object.fromEntries(noopNames.map(name => [name, () => false])) };
  vm.createContext(context);
  vm.runInContext(['layoutGroup', 'stripScrollOwnerOverflow', 'updateAccountDetailSections', 'applyResponsiveHooks', 'relaxOverflowRows']
    .map(name => body(source, name)).join('\n'), context);
  return context;
}
function account(board, entries) {
  const surface = new Node(); surface.dataset.bsBoardId = board; surface.ownerDocument = document;
  const section = new Node(); section.ownerDocument = document; section.append(new Node('', '공개 합성 제목'));
  section.valueNodes = entries.map(([text, missing]) => { const node = new Node('', text); node.dataset.missing = String(missing); return node; });
  surface.querySelectorAll = selector => selector === '.bs-rail > [data-node]' ? [section] : [];
  return { surface, section, note: () => section.querySelector(':scope > .bs-account-empty-note') };
}
function scroll(board, node = '14UQ-2', klass = 'bs-r-scroll-table') {
  const parent = new Node(); parent.ownerDocument = document;
  const owner = new Node(klass); owner['data-node'] = node; parent.append(owner);
  const surface = new Node(); surface.dataset.bsBoardId = board; surface.ownerDocument = document;
  surface.clientWidth = 600; surface.scrollWidth = 600;
  surface.querySelectorAll = selector => selector === '.bs-r-scroll, .bs-r-scroll-table' ? [owner]
    : selector === '.bs-readable-hint, .bs-ranking-scroll-hint' ? parent.children.filter(n => n.classList.contains('bs-readable-hint')) : [];
  return { surface, owner, parent, hints: () => parent.children.filter(n => n.classList.contains('bs-readable-hint')) };
}
const original = fs.readFileSync(path.join(__dirname, 'baseline-board-mount.js'), 'utf8');
const candidate = fs.readFileSync(path.join(root, 'app/lib/board-mount.js'), 'utf8');
const baseline = consumer(original), fixed = consumer(candidate);
for (const board of ['2SCE-1', '133H-2']) {
  const partial = account(board, [['공개 합성 수신', false], ['—', true]]);
  baseline.updateAccountDetailSections(partial.surface); eq(partial.note(), null);
  fixed.updateAccountDetailSections(partial.surface); eq(partial.note().hidden, false);
  eq(partial.note().textContent, '미제공 항목은 —로 표시됩니다');
  eq(partial.section.classList.contains('bs-account-empty-section'), false);
  const texts = partial.section.valueNodes.map(n => n.textContent);
  fixed.updateAccountDetailSections(partial.surface); eq(partial.section.children.filter(n => n.classList.contains('bs-account-empty-note')).length, 1);
  assert.deepEqual(partial.section.valueNodes.map(n => n.textContent), texts); checks++;
  partial.section.valueNodes[1].textContent = '공개 합성 수신'; partial.section.valueNodes[1].dataset.missing = 'false';
  fixed.updateAccountDetailSections(partial.surface); eq(partial.note().hidden, true);
  for (const entries of [[['—', true], ['미제공', true]], [['수신 대기', true], ['수신 대기', true]], [['0원', false], ['0%', false]], []]) {
    const a = account(board, entries), b = account(board, entries);
    baseline.updateAccountDetailSections(a.surface); fixed.updateAccountDetailSections(b.surface);
    eq(b.section.classList.contains('bs-account-empty-section'), a.section.classList.contains('bs-account-empty-section'));
    eq(b.note()?.hidden, a.note()?.hidden); eq(b.note()?.textContent, a.note()?.textContent);
  }
  const withNavigation = account(board, [['—', true]]); withNavigation.section.navigation = new Node();
  fixed.updateAccountDetailSections(withNavigation.surface); eq(withNavigation.note(), null);
  const table = account(board, [['—', true], ['0원', false]]); table.section.className = 'bs-table';
  fixed.updateAccountDetailSections(table.surface); eq(table.note(), null);
}
for (const board of ['2SYW-1', '3LGC-0', '2RBO-1']) {
  const a = account(board, [['—', true], ['수신 합성', false]]), b = account(board, [['—', true], ['수신 합성', false]]);
  baseline.updateAccountDetailSections(a.surface); fixed.updateAccountDetailSections(b.surface);
  eq(b.note(), a.note());
}
const before = scroll('133H-2'); baseline.applyResponsiveHooks(before.surface); eq(before.hints().length, 0);
const after = scroll('133H-2'); fixed.applyResponsiveHooks(after.surface); eq(after.hints().length, 1);
eq(after.hints()[0].previousElementSibling, after.owner);
fixed.applyResponsiveHooks(after.surface); eq(after.hints().length, 1);
for (const [clientWidth, scrollWidth, expected] of [[560, 844, 'block'], [844, 844, 'none'], [844, 845, 'none'], [844, 846, 'block'], [0, 844, 'none'], [560, 560, 'none']]) {
  after.owner.clientWidth = clientWidth; after.owner.scrollWidth = scrollWidth;
  fixed.relaxOverflowRows(after.surface); eq(after.hints()[0].style.display, expected);
}
for (const [board, node, klass] of [['2SCE-1', '14UQ-2', 'bs-r-scroll-table'], ['133H-2', 'other', 'bs-r-scroll-table'], ['133H-2', '14UQ-2', 'bs-r-scroll']]) {
  const fixture = scroll(board, node, klass); fixed.applyResponsiveHooks(fixture.surface); eq(fixture.hints().length, 0);
}
for (const [board, slot] of [['2SCE-1', 's163'], ['2SCE-1', 's206'], ['133H-2', 's153']]) {
  const contract = registry.contractFor(board);
  const missing = mountPlan(contract, {}).assignments.find(x => x.slotId === slot);
  eq(missing.missing, true);
  const zero = mountPlan(contract, { [slot]: 0 }).assignments.find(x => x.slotId === slot);
  eq(zero.missing, false);
}
const receipt = { status: 'PUBLIC_CONSUMER_CHECK_PASS', checks, baselinePartialNoteAbsent: true,
  baselineLegacyPanHintAbsent: true, productWrites: 0, nativeRun: false, providerRun: false,
  scope: 'Actual source functions and production mountPlan with controlled minimal DOM; unrelated geometry helpers are no-ops. This is not a browser mount or native UI verification.' };
fs.writeFileSync(path.join(__dirname, 'consumer-result.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
