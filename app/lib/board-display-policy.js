// Keep unavailable authoring examples separate from observed values. Pure, DOM-free.
(function () {
'use strict';
const cjs = typeof module !== 'undefined' && module.exports;
const policies = cjs ? require('./board-display-policy-data') : window.AthenaLib.BoardDisplayPolicyData;
const isPresent = (value) => value !== undefined && value !== null && value !== '';
const rawValue = (value) => value && typeof value === 'object' && 'value' in value ? value.value : value;
const zeroPrice = (value) => isPresent(value) && /^[+−-]?0+(?:\.0+)?$/.test(String(value).trim());

function prepareDisplayInput(contract, values) {
  const rules = policies[contract && contract.board_id];
  if (!rules || !Array.isArray(contract.slots)) return { contract, values };
  let changedValues = values;
  const slots = contract.slots.map((slot) => {
    const rule = rules[slot.slot_id];
    // A changed template must be reviewed again; a node/slot id alone is not provenance.
    if (!rule || rule[0] !== slot.paper_text) return slot;
    const role = rule[1];
    const bound = values && values[slot.slot_id];
    const value = rawValue(bound);
    const next = { ...slot, format: { ...slot.format } };
    if (role === 'caption') {
      next.paper_text = rule[2];
      next.static = 'text';
      next.kind = 'label';
      if (changedValues === values) changedValues = { ...values };
      changedValues[slot.slot_id] = rule[2];
      return next;
    }
    if (role === 'bound-format') {
      delete next.static;
      next.kind = 'value';
      next.format = { ...rule[2], missing_text: '—' };
      return next;
    }
    if (role === 'bound-name' || role === 'bound-label') {
      // Generated chunks omit mapping metadata. A mapped label must never fall back
      // to a specimen company name or cash type when that response row is absent.
      delete next.static;
      next.kind = 'value';
      next.f = rule[2];
      return next;
    }
    if (role === 'price-composite') {
      next.format.missing_text = '—';
      if (bound && bound.composite && Array.isArray(bound.composite.parts)) {
        const parts = bound.composite.parts.map((part) => rule[2].includes(part.f)
          ? { ...part, value: zeroPrice(part.value) ? null : part.value,
            format: { ...part.format, absolute: true } } : part);
        if (changedValues === values) changedValues = { ...values };
        changedValues[slot.slot_id] = { ...bound, composite: { ...bound.composite, parts } };
      }
      return next;
    }
    if (role === 'direction') {
      next.format = { kind: 'text', missing_text: '—' };
      const label = { '1': '상한가', '2': '상승', '3': '보합', '4': '하한가', '5': '하락' }[String(value ?? '').trim()];
      if (changedValues === values) changedValues = { ...values };
      changedValues[slot.slot_id] = label ? { value, text: label } : null;
      return next;
    }
    if (role === 'price') {
      next.format.absolute = true;
      next.format.missing_text = '—';
      if (next.format.unit === 'shares' || next.format.kind === 'shares') {
        delete next.format.unit;
        next.format.kind = 'number';
        next.format.suffix = '원';
      }
      // Price zero is not a traded price. Quantities and price changes keep real zeroes.
      if (zeroPrice(value)) {
        if (changedValues === values) changedValues = { ...values };
        changedValues[slot.slot_id] = null;
      }
      return next;
    }
    if (role === 'bound-time') {
      next.format = { ...next.format, kind: 'time', missing_text: '시각 미제공' };
      if (isPresent(value) && /^0{6,14}$/.test(String(value).trim())) {
        if (changedValues === values) changedValues = { ...values };
        changedValues[slot.slot_id] = null;
        next.format.missing_text = '시각 미제공';
      } else if (typeof value === 'string' && /^\d{6}$/.test(value)
        && Number(value.slice(0, 2)) < 24 && Number(value.slice(2, 4)) < 60 && Number(value.slice(4)) < 60) {
        // The generic formatter preserves leading-zero six-digit stock codes.
        // Here provenance proves this field is a clock, so give it explicit text.
        if (changedValues === values) changedValues = { ...values };
        changedValues[slot.slot_id] = { ...(typeof bound === 'object' ? bound : {}), value,
          text: `${value.slice(0, 2)}:${value.slice(2, 4)}:${value.slice(4)}` };
      }
      return next;
    }
    delete next.static;
    next.kind = 'value';
    next.format = {
      kind: 'text',
      missing_text: role === 'status' ? '상태 미확인' : role === 'time' ? '시각 미제공' : '—',
    };
    // A later real value is still allowed to replace the unavailable display.
    return next;
  });
  return { contract: { ...contract, slots }, values: changedValues };
}

function identityText(value) {
  const raw = rawValue(value);
  return typeof raw === 'string' ? raw.trim() : '';
}

function correctBoardIdentity(envelope = {}, values, identity = {}, contract) {
  contract = contract || envelope.surface_contract || envelope.surfaceContract
    || envelope.initial_surface_contract || envelope.initialSurfaceContract;
  const code = identityText(identity.code);
  const validName = (value) => {
    const text = identityText(value);
    if (!text || /^[0-9]{6}(?:\s*·.*)?$/.test(text) || text === code || /통합 호가/.test(text)) return '';
    return text;
  };
  const args = envelope.operation_args || envelope.arguments || {};
  let name = validName(envelope.data && envelope.data.stk_nm)
    || validName(envelope.stk_nm) || validName(args.stk_nm);
  for (const source of [envelope.surface_contract || envelope.surfaceContract,
    envelope.initial_surface_contract || envelope.initialSurfaceContract]) {
    if (name || !source || policies[source.board_id]?.s001?.[1] !== 'bound-name') continue;
    const raw = source.slot_values || source.slotValues || {};
    name = validName(Array.isArray(raw) ? (raw.find((slot) => slot.slot_id === 's001') || {}).value : raw.s001);
  }
  if (!name && policies[contract && contract.board_id]?.s001?.[1] === 'bound-name') {
    name = validName(values && values.s001);
  }
  name = name || validName(identity.name);
  return { ...identity, name, code };
}

const api = { prepareDisplayInput, correctBoardIdentity };
if (cjs) module.exports = api;
else { window.AthenaLib = window.AthenaLib || {}; window.AthenaLib.BoardDisplayPolicy = api; }
})();
