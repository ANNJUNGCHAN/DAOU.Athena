// Place authored filter menus beneath their actual wrapped trigger.
(function () {
'use strict';

const MENUS = {
  '4A9H-1': ['4AGC-1', '4AF0-1'],
  '4AGN-1': ['4AGQ-1', '4AME-1'],
  '4ANS-1': ['4ANV-1', '4ATH-1'],
  '4AUX-1': ['4AV0-1', '4B0K-1'],
};

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
