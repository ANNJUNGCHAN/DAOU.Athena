const FIELD_NAME = /^[a-z0-9][a-z0-9_]{0,127}$/u;
const SENSITIVE_ALIAS = /(?:^|_)(?:account|acct|acnt|accno|acno|cano|password|passwd|pswd|pwd|pin)(?:_|$)/u;

function isSensitiveField(domain, alias) {
  return domain === "account" || SENSITIVE_ALIAS.test(alias);
}
function normalizeSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError("금융 조회 입력 스키마가 제공되지 않았습니다.");
  }
  const keys = Object.keys(schema).sort();
  if (keys.length === 1 && keys[0] === "type" && schema.type === "string") {
    return { schema: Object.freeze({ type: "string" }), nullable: false };
  }
  if (keys.join(",") !== "anyOf,default" || schema.default !== null ||
      !Array.isArray(schema.anyOf) || schema.anyOf.length !== 2) {
    throw new TypeError("지원하지 않는 nullable 금융 조회 입력 스키마입니다.");
  }
  const [stringBranch, nullBranch] = schema.anyOf;
  if (Object.keys(stringBranch || {}).join(",") !== "type" || stringBranch.type !== "string" ||
      Object.keys(nullBranch || {}).join(",") !== "type" || nullBranch.type !== "null") {
    throw new TypeError("지원하지 않는 nullable 금융 조회 입력 스키마입니다.");
  }
  return {
    schema: Object.freeze({ type: "string" }),
    nullable: true,
  };
}

function normalizeField(field, required, domain) {
  if (!field || typeof field !== "object" || Array.isArray(field) ||
      typeof field.alias !== "string" || !FIELD_NAME.test(field.alias)) {
    throw new TypeError("금융 조회 입력 필드 형식이 올바르지 않습니다.");
  }
  const normalized = normalizeSchema(field.jsonSchema);
  return Object.freeze({
    name: field.alias,
    label: field.description || field.alias,
    required,
    nullable: normalized.nullable,
    type: normalized.schema.type,
    sensitive: isSensitiveField(domain, field.alias),
    schema: Object.freeze({ ...normalized.schema }),
  });
}

export function compileFinancialFormDefinition(detail) {
  if (!detail || typeof detail !== "object" || typeof detail.operationRef !== "string" ||
      typeof detail.domain !== "string" || detail.domain.length === 0) {
    throw new TypeError("조회 기능 상세가 필요합니다.");
  }
  const required = Array.isArray(detail.requiredArguments) ? detail.requiredArguments : [];
  const optional = Array.isArray(detail.optionalArguments) ? detail.optionalArguments : [];
  const fields = [
    ...required.map((field) => normalizeField(field, true, detail.domain)),
    ...optional.map((field) => normalizeField(field, false, detail.domain)),
  ];
  if (fields.length > 64 || new Set(fields.map((field) => field.name)).size !== fields.length) {
    throw new TypeError("조회 기능 입력 필드가 중복되었거나 제한을 넘었습니다.");
  }
  return Object.freeze({
    operationRef: detail.operationRef,
    domain: detail.domain,
    title: String(detail.name || detail.title || detail.operationRef).slice(0, 160),
    fields: Object.freeze(fields),
  });
}

export function compileFinancialArguments(definition, values) {
  if (!definition?.fields || !values || typeof values !== "object" || Array.isArray(values)) {
    throw new TypeError("조회 입력값이 필요합니다.");
  }
  const argumentsObject = {};
  for (const field of definition.fields) {
    const entry = values[field.name];
    if (!entry || typeof entry !== "object") {
      if (field.required) throw new TypeError(`${field.label} 입력이 필요합니다.`);
      continue;
    }
    const mode = entry.mode || (field.required ? "value" : "omit");
    if (mode === "omit") {
      if (field.required) throw new TypeError(`${field.label} 입력을 생략할 수 없습니다.`);
      continue;
    }
    if (mode === "null") {
      if (field.nullable === false) {
        throw new TypeError(`${field.label} 입력은 null을 허용하지 않습니다.`);
      }
      argumentsObject[field.name] = null;
      continue;
    }
    if (mode !== "value" || typeof entry.value !== "string") {
      throw new TypeError(`${field.label} 입력 형식이 올바르지 않습니다.`);
    }
    argumentsObject[field.name] = entry.value;
  }
  return argumentsObject;
}

function make(document, tagName, className, text = "") {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

export function renderFinancialForm({ document, container, definition, onSubmit }) {
  if (!document?.createElement || !container?.replaceChildren || typeof onSubmit !== "function") {
    throw new TypeError("document, container, and onSubmit are required");
  }
  const form = make(document, "form", "financial-query-form");
  form.append(make(document, "h3", "", definition.title));
  const controls = new Map();
  const preview = make(document, "pre", "financial-query-preview");
  for (const field of definition.fields) {
    const row = make(document, "div", "financial-form-field");
    const label = make(document, "label", "", `${field.label}${field.required ? " · 필수" : " · 선택"}`);
    const input = make(document, "input", "");
    input.name = field.name;
    input.type = field.sensitive ? "password" : "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.maxLength = 8192;
    label.htmlFor = `financial-arg-${field.name}`;
    input.id = label.htmlFor;
    const mode = make(document, "select", "financial-field-mode");
    const options = field.required
      ? [{ value: "value", label: "값" }, ...(field.nullable !== false ? [{ value: "null", label: "null" }] : [])]
      : [
          { value: "omit", label: "생략" },
          { value: "value", label: "값" },
          ...(field.nullable !== false ? [{ value: "null", label: "null" }] : []),
        ];
    for (const optionValue of options) {
      const option = make(document, "option", "", optionValue.label);
      option.value = optionValue.value;
      mode.append(option);
    }
    mode.value = field.required ? "value" : "omit";
    const sync = () => {
      input.disabled = mode.value !== "value";
      updatePreview();
    };
    mode.addEventListener("change", sync);
    input.addEventListener("input", updatePreview);
    sync();
    row.append(label, mode, input);
    form.append(row);
    controls.set(field.name, { field, mode, input });
  }
  const submit = make(document, "button", "primary", "조회");
  submit.type = "submit";
  form.append(preview, submit);
  function currentValues() {
    const values = {};
    for (const [name, control] of controls) values[name] = { mode: control.mode.value, value: control.input.value };
    return values;
  }
  function updatePreview() {
    try {
      const argumentsObject = compileFinancialArguments(definition, currentValues());
      const previewArguments = { ...argumentsObject };
      for (const field of definition.fields) {
        if (field.sensitive && typeof previewArguments[field.name] === "string" && previewArguments[field.name].length > 0) {
          previewArguments[field.name] = "••••";
        }
      }
      preview.textContent = JSON.stringify({
        operationRef: definition.operationRef,
        arguments: previewArguments,
      }, null, 2);
    } catch (error) {
      preview.textContent = error instanceof Error ? error.message : String(error);
    }
  }
  updatePreview();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      onSubmit(compileFinancialArguments(definition, currentValues()));
    } catch (error) {
      preview.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  container.replaceChildren(form);
  return Object.freeze({ form, controls, submit });
}
