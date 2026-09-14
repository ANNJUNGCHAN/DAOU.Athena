(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.AthenaLib = root.AthenaLib || {};
    root.AthenaLib.CardComponentTarget = api;
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const KEYBOARD_TARGET_SELECTOR = [
    '.chart-card-body', '.chart-indicator-panel', '[class*="chart-indicator"]', '[class*="chart-legend"]',
    '.facts-row', 'tbody tr', '.card-kit-hoga-live-row', '.semantic-workspace-slot-row',
    '.semantic-workspace-table-row', '[data-card-component-path]', '[data-role]', '[role="cell"]',
    'li', 'dt', 'dd', '[class*="metric"]', '[class*="value"]',
  ].join(', ');

  function pathValue(root, path) {
    const parts = String(path || '').split('.').filter(Boolean);
    if (!parts.length) return { ok: false };
    let value = root;
    for (const part of parts) {
      if (value == null || typeof value !== 'object' || !Object.hasOwn(value, part)) return { ok: false };
      value = value[part];
    }
    return { ok: true, value };
  }

  function closest(node, selector) {
    return node && typeof node.closest === 'function' ? node.closest(selector) : null;
  }

  function indexWithin(root, selector, node) {
    if (!root || typeof root.querySelectorAll !== 'function') return -1;
    return Array.from(root.querySelectorAll(selector)).indexOf(node);
  }

  function firstExistingPath(envelope, paths) {
    return paths.find((path) => pathValue(envelope, path).ok) || null;
  }

  function rowLabel(row, fallback) {
    if (row && row.dataset && row.dataset.side && row.dataset.level) {
      const side = row.dataset.side === 'ask' ? '매도' : row.dataset.side === 'bid' ? '매수' : '';
      if (side) return `${side} ${row.dataset.level}호가`;
    }
    return fallback;
  }

  function visibleObservation(node, cardId, path, now = new Date()) {
    if (!node) return null;
    const raw = typeof node.innerText === 'string' ? node.innerText : node.textContent;
    const text = String(raw || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400);
    if (!text) return null;
    return {
      cardId,
      path,
      observedAt: now.toISOString(),
      source: 'renderer-visible',
      text,
    };
  }

  function componentLabel(node) {
    const role = node && node.dataset && node.dataset.role;
    const labels = {
      price: '가격', quantity: '수량', change: '등락', count: '건수',
      'current-price': '현재가', 'expected-execution': '예상 체결',
      'sell-total': '매도 잔량', 'buy-total': '매수 잔량', time: '시각',
    };
    return labels[role] || '선택 항목';
  }

  function resolveSelection(card, target) {
    const cardId = card && card.dataset && String(card.dataset.sessionCardId || '').trim();
    const envelope = card && card.__athenaSessionCard && card.__athenaSessionCard.envelope;
    if (!cardId || !envelope || typeof envelope !== 'object') return null;

    const annotated = closest(target, '[data-card-component-path]');
    if (annotated && annotated.dataset && pathValue(envelope, annotated.dataset.cardComponentPath).ok) {
      return {
        node: annotated,
        selectedCardId: cardId,
        selectedComponent: {
          path: annotated.dataset.cardComponentPath,
          label: String(annotated.dataset.cardComponentLabel || '선택 항목').slice(0, 80),
        },
      };
    }

    const factsRow = closest(target, '.facts-row');
    if (factsRow) {
      const headerBand = closest(factsRow, '.compound-header-band');
      const selector = headerBand ? '.compound-header-band .facts-row' : '.facts-grid .facts-row';
      const index = indexWithin(card, selector, factsRow);
      const path = index >= 0 ? `${headerBand ? 'data.header' : 'data.fields'}.${index}` : null;
      if (path && pathValue(envelope, path).ok) {
        return { node: factsRow, selectedCardId: cardId, selectedComponent: { path, label: `지표 ${index + 1}` } };
      }
    }

    const tableRow = closest(target, 'tbody tr');
    if (tableRow) {
      const table = closest(target, 'table');
      const index = indexWithin(table || card, 'tbody tr', tableRow);
      const path = index >= 0 ? firstExistingPath(envelope, [`data.rows.${index}`, `data.table.rows.${index}`]) : null;
      if (path) return { node: tableRow, selectedCardId: cardId, selectedComponent: { path, label: `표 ${index + 1}행` } };
    }

    const hogaRow = closest(target, '.card-kit-hoga-live-row');
    if (hogaRow) {
      const path = firstExistingPath(envelope, ['data.fields', 'data']);
      if (path) return {
        node: hogaRow,
        selectedCardId: cardId,
        selectedComponent: { path, label: rowLabel(hogaRow, '호가 행') },
      };
    }

    const semanticRow = closest(target, '.semantic-workspace-slot-row, .semantic-workspace-table-row, [role="row"]');
    if (semanticRow) {
      const index = indexWithin(card, '.semantic-workspace-slot-row, .semantic-workspace-table-row, [role="row"]', semanticRow);
      const path = firstExistingPath(envelope, [
        `data.rows.${index}`,
        `data.table.rows.${index}`,
        `data.fields.${index}`,
        'data',
      ]);
      if (path) return { node: semanticRow, selectedCardId: cardId, selectedComponent: { path, label: `표 ${index + 1}행` } };
    }

    const chart = closest(target, '.chart-card-body, .chart-indicator-panel, [class*="chart-indicator"], [class*="chart-legend"]');
    if (chart) {
      const path = firstExistingPath(envelope, ['data.chart', 'data']);
      if (path) return { node: chart, selectedCardId: cardId, selectedComponent: { path, label: '차트' } };
    }

    if (pathValue(envelope, 'data').ok) {
      const observable = closest(target, '[data-role], [role="cell"], li, dt, dd, [class*="metric"], [class*="value"]');
      const node = observable || (target !== card ? target : card);
      return {
        node,
        selectedCardId: cardId,
        selectedComponent: { path: 'data', label: observable ? componentLabel(observable) : '선택 항목' },
      };
    }
    return null;
  }

  function createController({
    root,
    button,
    selection,
    selectionLabel,
    clearButton,
    document: doc,
    cardSelector = '.card[data-session-card-id]',
    implicitObservationSelector = '[data-card-component-observation]',
  }) {
    let targeting = false;
    let current = null;
    let selectedNode = null;
    let selectedCard = null;
    let selectionRevision = 0;
    const issuedContexts = new WeakMap();
    const temporaryTabIndexes = new Map();

    function restoreKeyboardTargets() {
      for (const [node, prior] of temporaryTabIndexes) {
        if (prior === null) node.removeAttribute('tabindex');
        else node.setAttribute('tabindex', prior);
      }
      temporaryTabIndexes.clear();
    }

    function prepareKeyboardTargets() {
      restoreKeyboardTargets();
      if (!root || typeof root.querySelectorAll !== 'function') return;
      let candidates = Array.from(root.querySelectorAll(KEYBOARD_TARGET_SELECTOR))
        .filter((node) => closest(node, cardSelector));
      if (!candidates.length) {
        candidates = Array.from(root.querySelectorAll(cardSelector));
      }
      for (const node of candidates) {
        if (!node || typeof node.setAttribute !== 'function' || typeof node.hasAttribute !== 'function') continue;
        temporaryTabIndexes.set(node, node.hasAttribute('tabindex') ? node.getAttribute('tabindex') : null);
        node.setAttribute('tabindex', '0');
      }
      const first = candidates[0];
      if (first && typeof first.focus === 'function') first.focus({ preventScroll: true });
    }

    function render() {
      if (button) {
        button.setAttribute('aria-pressed', targeting ? 'true' : 'false');
        button.classList.toggle('is-active', targeting);
      }
      if (root) root.classList.toggle('is-component-question-targeting', targeting);
      if (selection) selection.hidden = !current && !targeting;
      if (selectionLabel) selectionLabel.textContent = current
        ? current.selectedComponent.label
        : targeting ? '카드 안에서 항목을 선택하세요 · Enter 또는 Space' : '';
      if (clearButton) clearButton.hidden = !current;
    }

    function setTargeting(value) {
      targeting = Boolean(value);
      if (targeting) prepareKeyboardTargets();
      else restoreKeyboardTargets();
      render();
    }

    function clearSelection(expectedContext) {
      if (expectedContext && issuedContexts.get(expectedContext) !== selectionRevision) return false;
      if (selectedNode && selectedNode.classList) selectedNode.classList.remove('component-question-selected');
      if (selectedCard && selectedCard.classList) selectedCard.classList.remove('component-question-card-selected');
      current = null;
      selectedNode = null;
      selectedCard = null;
      selectionRevision += 1;
      render();
      return true;
    }

    function onRootClick(event) {
      if (!targeting) return;
      const card = closest(event.target, cardSelector);
      if (!card) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      const next = resolveSelection(card, event.target);
      if (!next) return;
      clearSelection();
      current = {
        selectedCardId: next.selectedCardId,
        selectedComponent: { ...next.selectedComponent },
        selectionMode: 'explicit-component',
      };
      selectedNode = next.node;
      selectedCard = card;
      if (selectedNode && selectedNode.classList) selectedNode.classList.add('component-question-selected');
      if (selectedCard && selectedCard.classList) selectedCard.classList.add('component-question-card-selected');
      targeting = false;
      restoreKeyboardTargets();
      render();
    }

    function onRootKeyDown(event) {
      if (!targeting || (event.key !== 'Enter' && event.key !== ' ')) return;
      if (!closest(event.target, KEYBOARD_TARGET_SELECTOR)
        && !closest(event.target, cardSelector)) return;
      onRootClick(event);
    }

    function onKeyDown(event) {
      if (!targeting || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      setTargeting(false);
    }

    function getContext() {
      if (!current) {
        if (!root || typeof root.querySelectorAll !== 'function') return null;
        const cards = Array.from(root.querySelectorAll(cardSelector))
          .filter((card) => {
            if (card.hidden || !card.dataset || !card.dataset.sessionCardId) return false;
            if (typeof card.closest === 'function' && card.closest('[hidden]')) return false;
            return typeof card.getClientRects !== 'function' || card.getClientRects().length > 0;
          });
        const activeCard = cards[cards.length - 1];
        if (!activeCard) return null;
        const context = {
          selectedCardId: String(activeCard.dataset.sessionCardId),
          selectionMode: 'implicit-active-card',
        };
        const observationNodes = implicitObservationSelector && typeof activeCard.querySelectorAll === 'function'
          ? Array.from(activeCard.querySelectorAll(implicitObservationSelector)) : [];
        const observedNode = observationNodes.filter((node) => {
          if (!node || !node.dataset || !node.dataset.cardComponentPath) return false;
          if (!pathValue(activeCard.__athenaSessionCard && activeCard.__athenaSessionCard.envelope,
            node.dataset.cardComponentPath).ok) return false;
          return typeof node.getClientRects !== 'function' || node.getClientRects().length > 0;
        }).at(-1);
        if (observedNode) {
          const observation = visibleObservation(
            observedNode,
            context.selectedCardId,
            observedNode.dataset.cardComponentPath,
          );
          if (observation) context.observation = observation;
        }
        issuedContexts.set(context, selectionRevision);
        return context;
      }
      const context = {
        selectedCardId: current.selectedCardId,
        selectedComponent: { ...current.selectedComponent },
        selectionMode: current.selectionMode,
      };
      const observation = visibleObservation(
        selectedNode,
        current.selectedCardId,
        current.selectedComponent.path,
      );
      if (observation) context.observation = observation;
      issuedContexts.set(context, selectionRevision);
      return context;
    }

    const onButtonClick = () => setTargeting(!targeting);
    const onClearClick = () => clearSelection();
    if (root) root.addEventListener('click', onRootClick, true);
    if (root) root.addEventListener('keydown', onRootKeyDown, true);
    if (button) button.addEventListener('click', onButtonClick);
    if (clearButton) clearButton.addEventListener('click', onClearClick);
    if (doc) doc.addEventListener('keydown', onKeyDown, true);
    const observer = typeof MutationObserver === 'function' && root
      ? new MutationObserver(() => {
        if (selectedCard && !selectedCard.isConnected) clearSelection();
      })
      : null;
    if (observer) observer.observe(root, { childList: true, subtree: true });
    render();

    return {
      clearSelection,
      getContext,
      isTargeting: () => targeting,
      setTargeting,
      destroy() {
        clearSelection();
        if (observer) observer.disconnect();
        restoreKeyboardTargets();
        if (root) root.removeEventListener('click', onRootClick, true);
        if (root) root.removeEventListener('keydown', onRootKeyDown, true);
        if (button) button.removeEventListener('click', onButtonClick);
        if (clearButton) clearButton.removeEventListener('click', onClearClick);
        if (doc) doc.removeEventListener('keydown', onKeyDown, true);
      },
    };
  }

  return { createController, pathValue, resolveSelection, visibleObservation };
});
