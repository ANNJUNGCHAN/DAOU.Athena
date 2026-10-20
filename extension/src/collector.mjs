export function collectCurrentFrame(options = {}) {
  const maxHeadings = Number.isInteger(options.maxHeadings) ? options.maxHeadings : 40;
  const maxControls = Number.isInteger(options.maxControls) ? options.maxControls : 120;
  const maxFrames = Number.isInteger(options.maxFrames) ? options.maxFrames : 30;
  const maxTextLength = Number.isInteger(options.maxTextLength) ? options.maxTextLength : 160;

  const sensitivePattern = /(?:auth|login|cert|security|secure|keyboard|otp|password|pin|koscom|yettie|library)/i;
  const numberSequencePattern = /(?<!\d)(?:\d[\s-]?){6,}(?!\d)/g;
  const inlineStockPattern = /(?:종목(?:코드)?|symbol|ticker)\s*[:#]?\s*(\d{6})(?!\d)/gi;
  const compact = (value, verifiedStockCodes = [], allowInlineStockCode = true) => {
    const source = String(value ?? "");
    const allowed = new Set(verifiedStockCodes);
    if (allowInlineStockCode) {
      for (const match of source.matchAll(inlineStockPattern)) allowed.add(match[1]);
    }
    return source
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(numberSequencePattern, (candidate) => {
        const digits = candidate.replace(/\D/g, "");
        return digits.length === 6 && allowed.has(digits) ? candidate : "[번호 숨김]";
      })
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxTextLength);
  };
  const safeUrlParts = (value) => {
    try {
      const parsed = new URL(value, location.href);
      const path = (parsed.pathname || "/").replace(/(?<!\d)(?:\d[\s-]?){6,}(?!\d)/g, "[redacted]");
      return { origin: parsed.origin, path };
    } catch {
      return { origin: null, path: null };
    }
  };
  const isVisible = (element) => {
    if (element.hidden || element.getAttribute?.("aria-hidden") === "true") return false;
    const rect = element.getBoundingClientRect?.();
    if (rect && rect.width === 0 && rect.height === 0) return false;
    try {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    } catch {
      return true;
    }
  };
  const inDataGrid = (element) => Boolean(element.closest?.("table, tr, [role='row'], [role='grid'], [role='treegrid']"));
  const inferRole = (element, tag) => {
    const explicit = compact(element.getAttribute?.("role"));
    if (explicit) return explicit;
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") return element.type === "checkbox" ? "checkbox" : element.type === "radio" ? "radio" : "textbox";
    return "button";
  };
  const controlName = (element) => {
    const rawName = element.getAttribute?.("aria-label")
      || element.getAttribute?.("title")
      || element.getAttribute?.("placeholder")
      || element.innerText
      || element.textContent;
    const verifiedStockCodes = [
      element.getAttribute?.("data-stock-code"),
      element.getAttribute?.("data-symbol"),
    ].filter((value) => /^\d{6}$/.test(value || ""));
    const securityContext = [
      rawName,
      element.getAttribute?.("id"),
      element.getAttribute?.("name"),
      element.getAttribute?.("autocomplete"),
      element.getAttribute?.("type"),
    ].join(" ");
    const sensitiveControl = /(?:계좌|account|비밀번호|password|인증|보안|otp|pin|주민|전화|phone|security|cert)/i.test(securityContext);
    return compact(rawName, sensitiveControl ? [] : verifiedStockCodes, !sensitiveControl);
  };

  let isTop = true;
  try { isTop = window.top === window; } catch { isTop = false; }
  const current = safeUrlParts(location.href);
  const hasPasswordField = document.querySelectorAll?.("input[type='password']")?.length > 0;
  if (!isTop && (sensitivePattern.test(current.path || "") || hasPasswordField)) {
    return { excluded: true, reason: "sensitive-frame" };
  }

  let truncated = false;
  const headingElements = Array.from(document.querySelectorAll?.("h1, h2, h3, [role='heading']") || []);
  if (headingElements.length > maxHeadings) truncated = true;
  const headings = headingElements
    .filter(isVisible)
    .map((element) => compact(element.innerText || element.textContent))
    .filter(Boolean)
    .slice(0, maxHeadings);

  const selector = "button, a[href], select, textarea, input:not([type='hidden']):not([type='password']), [role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='combobox'], [role='textbox'], [role='tab'], [role='menuitem']";
  const controlElements = Array.from(document.querySelectorAll?.(selector) || [])
    .filter((element) => !inDataGrid(element) && isVisible(element));
  if (controlElements.length > maxControls) truncated = true;
  const controls = controlElements.slice(0, maxControls).map((element, index) => {
    const tag = String(element.tagName || "unknown").toLowerCase();
    return {
      ref: `control-${String(index + 1).padStart(3, "0")}`,
      tag,
      role: inferRole(element, tag),
      name: controlName(element),
      type: compact(element.getAttribute?.("type") || ""),
      disabled: Boolean(element.disabled || element.getAttribute?.("aria-disabled") === "true"),
      visible: true,
    };
  });

  const frameElements = Array.from(document.querySelectorAll?.("iframe") || []);
  const safeFrames = frameElements
    .map((element) => ({
      source: element.getAttribute?.("src") || "",
      identity: `${element.getAttribute?.("id") || ""} ${element.getAttribute?.("name") || ""} ${element.getAttribute?.("title") || ""}`,
    }))
    .filter((frame) => !sensitivePattern.test(`${frame.source} ${frame.identity}`))
    .map((frame) => safeUrlParts(frame.source));
  if (safeFrames.length > maxFrames) truncated = true;

  return {
    excluded: false,
    source: current,
    title: compact(document.title),
    headings,
    controls,
    frames: safeFrames.slice(0, maxFrames),
    canvasCount: Math.min(Number(document.querySelectorAll?.("canvas")?.length || 0), 999),
    truncated,
  };
}
