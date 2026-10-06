const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const source = fs.readFileSync(path.join(__dirname, 'renderer-check.cjs'), 'utf8');
const start = source.indexOf('function publicFailure(');
const end = source.indexOf('\n}', start) + 2;
assert.ok(start >= 0 && end > start);
const context = vm.createContext({ Error, TypeError, ReferenceError, SyntaxError, RangeError });
vm.runInContext(source.slice(start, end), context);
let checks = 0, getterReads = 0;
for (const kind of ['TypeError','ReferenceError','SyntaxError','RangeError','Error','private-sentinel']) {
  const result = context.publicFailure({ name: kind, stack: 'at f (renderer-check.cjs:42:7)', message: 'public-test-message-not-read' });
  assert.equal(result.kind, kind === 'private-sentinel' ? 'unknown' : kind); checks++;
  assert.equal(result.publicEntryLine, 42); checks++;
  assert.equal(result.publicEntryColumn, 7); checks++;
  assert.equal(Object.keys(result).length, 3); checks++;
}
const getters = {};
for (const field of ['name','stack','message']) Object.defineProperty(getters, field, { get() { getterReads++; throw new Error('getter must not execute'); } });
const result = context.publicFailure(getters);
assert.equal(result.kind, 'unknown'); checks++;
assert.equal(result.publicEntryLine, null); checks++;
assert.equal(result.publicEntryColumn, null); checks++;
assert.equal(getterReads, 0); checks++;
for (const error of [new TypeError(), new ReferenceError(), new SyntaxError(), new RangeError(), new Error(), null, undefined]) {
  const result = context.publicFailure(error);
  assert.ok(['TypeError','ReferenceError','SyntaxError','RangeError','Error','unknown'].includes(result.kind)); checks++;
  assert.equal(Object.keys(result).length, 3); checks++;
}
for (const stack of ['at f (unrelated-entry.cjs:42:7)', '', undefined]) {
  const result = context.publicFailure({ stack });
  assert.equal(result.publicEntryLine, null); checks++;
  assert.equal(result.publicEntryColumn, null); checks++;
}
fs.writeFileSync(path.join(__dirname, 'classifier-result.json'), JSON.stringify({ status: 'PUBLIC_METADATA_CLASSIFIER_PASS', checks, getterReads, rendererRun: false, nativeRun: false, messagesExported: false, stacksExported: false }, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PUBLIC_METADATA_CLASSIFIER_PASS', checks, getterReads, rendererRun: false }));
