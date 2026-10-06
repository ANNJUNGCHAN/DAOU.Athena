// Feed the authored regular-session tables from the same typed 0D stream as
// the live ladder. After-hours and gold have different quote contracts.
(function () {
'use strict';
const bindings = typeof module !== 'undefined' && module.exports
  ? require('./board-orderbook-bindings') : window.AthenaLib.BoardOrderbookBindings;

function supports(boardId) { return Object.hasOwn(bindings, String(boardId || '')); }

function updatesFor(boardId, tick) {
  const updates = {};
  if (!supports(boardId) || !tick || typeof tick !== 'object') return updates;
  for (const entry of bindings[boardId]) {
    const raw = entry.index === undefined ? tick[entry.key] : tick[entry.key]?.[entry.index];
    // Absent fields in a partial tick leave the previous snapshot untouched.
    if (raw === null || raw === undefined || raw === '') continue;
    if (entry.key === 'time') {
      if (/^\d{6}$/.test(String(raw))) updates[entry.slot] = String(raw);
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      updates[entry.slot] = raw;
    }
  }
  return updates;
}

const api = { supports, updatesFor };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else { window.AthenaLib = window.AthenaLib || {}; window.AthenaLib.BoardOrderbook = api; }
})();
