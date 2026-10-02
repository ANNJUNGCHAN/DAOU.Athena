// Keep unavailable authoring examples separate from observed values. Pure, DOM-free.
(function () {
'use strict';
const cjs = typeof module !== 'undefined' && module.exports;
const policies = cjs ? require('./board-display-policy-data') : window.AthenaLib.BoardDisplayPolicyData;
const boardFormat = cjs ? require('./board-format') : window.AthenaLib.BoardFormat;
const RANK_NINE_IDS = ["2X5N-0","2XG6-0","2XKO-0","2XP6-0","2XTO-0","2YA8-0","2YEQ-0","2YJ8-0","2YNQ-0"];
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
      // Exact reviewed CC06 quantities use the received number, including zero and sign.
      if (["2X5N-0:s089","2XG6-0:s089","2XKO-0:s048","2XKO-0:s070","2XTO-0:s098","2YJ8-0:s058","2YJ8-0:s069","2YJ8-0:s080","2YJ8-0:s091","2YJ8-0:s092"].includes(contract.board_id + ':' + slot.slot_id)
        && bound && typeof bound === 'object' && !bound.missing && isPresent(value)
        && boardFormat.toNumber(value) !== null) {
        if (changedValues === values) changedValues = { ...values };
        changedValues[slot.slot_id] = { ...bound };
        delete changedValues[slot.slot_id].text;
        return next;
      }
      // These paired values need their meaning even when a response already
      // supplies display text. Keep the global preformatted-text contract intact.
      if ((contract.board_id === '13K0-2' || RANK_NINE_IDS.includes(contract.board_id)) && bound && typeof bound === 'object'
        && typeof bound.text === 'string' && bound.text && !bound.missing) {
        const format = rule[2];
        let text = bound.text;
        if (format.prefix && text.startsWith(format.prefix)) text = text.slice(format.prefix.length);
        const numeric = Number(String(value).replace(/,/g, '').replace('−', '-'));
        if (format.sign && Number.isFinite(numeric) && numeric < 0 && !/^[-−]/.test(text)) text = '-' + text.replace(/^\+/, '');
        if (format.absolute) text = text.replace(/^([+−-])(?=\d)/, '');
        const suffix = format.suffix || (format.unit === 'shares' ? '주' : format.unit === 'percent' ? '%' : '');
        if (suffix && !text.endsWith(suffix)) text += suffix;
        if (changedValues === values) changedValues = { ...values };
        changedValues[slot.slot_id] = { ...bound, text: (format.prefix || '') + text };
      }
      // These five cards add meaning to a received unit without replacing it.
      if (["2YS8-0","2ZBB-0","2ZTA-0","30TY-0","31CL-0","2TZN-1","32S7-0"].includes(contract.board_id) && bound && typeof bound === 'object'
        && typeof bound.text === 'string' && bound.text && !bound.missing && rule[2].prefix) {
        const prefix = rule[2].prefix;
        const text = bound.text.startsWith(prefix) ? bound.text.slice(prefix.length) : bound.text;
        if (changedValues === values) changedValues = { ...values };
        changedValues[slot.slot_id] = { ...bound, text: prefix + text };
      }
      return next;
    }
    if (role === 'bound-identifier') {
      delete next.static;
      next.kind = 'value';
      next.format = { kind: 'text', missing_text: '—' };
      if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
        if (changedValues === values) changedValues = { ...values };
        changedValues[slot.slot_id] = { value, text: String(value) };
      }
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
      if (RANK_NINE_IDS.includes(contract.board_id)) { delete next.static; next.kind = 'value'; }
      next.format = { kind: 'text', missing_text: '—' };
      const label = { '1': '상한가', '2': '상승', '3': '보합', '4': '하한가', '5': '하락' }[String(value ?? '').trim()];
      if (changedValues === values) changedValues = { ...values };
      changedValues[slot.slot_id] = label ? { value, text: label } : null;
      if (((contract.board_id === '13K0-2' && slot.slot_id === 's132') || RANK_NINE_IDS.includes(contract.board_id)) && label) {
        changedValues[slot.slot_id].tone = { '1': 'up', '2': 'up', '3': 'flat', '4': 'down', '5': 'down' }[String(value).trim()];
      }
      return next;
    }
    if (role === 'quote-magnitude') {
      next.format.absolute = true;
      // These exact ELW quote fields retain a received zero. Preformatted units
      // remain intact; only a leading wire direction is removed from their text.
      if (bound && typeof bound === 'object' && typeof bound.text === 'string') {
        if (changedValues === values) changedValues = { ...values };
        changedValues[slot.slot_id] = { ...bound, text: bound.text.replace(/^([+−-])(?=\d)/, '') };
      }
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
