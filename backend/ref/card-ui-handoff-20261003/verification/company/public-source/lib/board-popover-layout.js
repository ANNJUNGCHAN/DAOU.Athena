// Place authored filter menus beneath their actual wrapped trigger.
(function () {
'use strict';

const MENUS = {
  '4A9H-1': ['4AGC-1', '4AF0-1'],
  '4AGN-1': ['4AGQ-1', '4AME-1'],
  '4ANS-1': ['4ANV-1', '4ATH-1'],
  '4AUX-1': ['4AV0-1', '4B0K-1'],
};

const RAIL_GROUPS = {
  '4A9H-1': { comparison: '4AAD-1', status: '4A9U-1' },
  '4AGN-1': { comparison: '4AHT-1', status: '4AHA-1' },
  '4ANS-1': { comparison: '4AOY-1', status: '4AOF-1' },
  '4AUX-1': { comparison: '4AW3-1', status: '4AVK-1' },
};

function compactUnavailableRail(surface) {
  const groups = RAIL_GROUPS[surface.dataset.bsBoardId];
  if (!groups) return;
  const observed = el => el && el.dataset.bsDesignText !== 'true'
    && el.dataset.missing !== 'true' && el.textContent.trim() && el.textContent.trim() !== '—';
  const comparisons = ['s125', 's127', 's129'].map(id => surface.querySelector('[data-slot-id="' + id + '"]'));
  const statuses = ['s138', 's139', 's140', 's141'].map(id => surface.querySelector('[data-slot-id="' + id + '"]'));
  for (const [node, empty, text] of [
    [groups.comparison, !comparisons.some(observed), '비교 종목 정보 미제공'],
    [groups.status, statuses.every(el => !el || !el.textContent.trim() || el.dataset.missing === 'true'
      || el.textContent.trim() === '상태 미확인'), '거래 상태 정보 미제공'],
  ]) {
    const group = surface.querySelector('[data-node="' + node + '"]');
    if (!group) continue;
    group.classList.toggle('bs-filter-unavailable-group', empty);
    let note = group.querySelector(':scope > .bs-filter-unavailable-note');
    if (empty && !note) {
      note = group.ownerDocument.createElement('div');
      note.className = 'bs-filter-unavailable-note';
      note.textContent = text;
      group.appendChild(note);
    }
    if (note) note.hidden = !empty;
  }
  surface.querySelector('.bs-rail')?.classList.toggle('bs-filter-compact-rail',
    !!surface.querySelector('.bs-filter-unavailable-group'));
}

function menuPosition(surface, trigger, width = 236) {
  const available = Math.max(0, surface.width - 16);
  const menuWidth = Math.min(width, available);
  return {
    width: menuWidth,
    left: Math.max(8, Math.min(trigger.left - surface.left, surface.width - menuWidth - 8)),
    top: trigger.bottom - surface.top + 6,
  };
}

function update(surface) {
  compactUnavailableRail(surface);
  // Width relaxation can move the trigger after the menu resize callback.
  surface.querySelector('.bs-parent-ranking-menu')?.repositionParentRankingMenu?.();
  const ids = MENUS[surface.dataset.bsBoardId];
  if (!ids) return;
  const menu = surface.querySelector(`[data-node="${ids[0]}"]`);
  const trigger = surface.querySelector(`[data-node="${ids[1]}"]`)?.parentElement;
  if (!menu || !trigger) return;
  menu.classList.add('bs-filter-popover');
  menu.style.height = 'auto';
  menu.style.minHeight = '0';
  for (const row of menu.children) {
    row.classList.add('bs-filter-option');
    for (const property of ['height', 'min-height', 'justify-content', 'align-items', 'padding-inline']) row.style.removeProperty(property);
    for (const text of row.children) {
      text.style.removeProperty('width');
      text.style.removeProperty('font-size');
      text.style.removeProperty('line-height');
    }
  }
  const position = menuPosition(surface.getBoundingClientRect(), trigger.getBoundingClientRect());
  menu.style.width = `${position.width}px`;
  menu.style.left = `${position.left + surface.scrollLeft}px`;
  menu.style.top = `${position.top + surface.scrollTop}px`;
}

const api = { MENUS, menuPosition, update };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else { window.AthenaLib = window.AthenaLib || {}; window.AthenaLib.BoardPopoverLayout = api; }
})();
