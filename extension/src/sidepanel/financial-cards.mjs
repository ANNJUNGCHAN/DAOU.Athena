const RENDERER_UNAVAILABLE_CODE = "FINANCIAL_RENDERER_UNAVAILABLE";
const RENDERER_UNAVAILABLE_MESSAGE = "금융 카드 렌더러를 사용할 수 없습니다.";

const CARD_RENDERERS = Object.freeze({
  facts: Object.freeze({ rendererId: "facts-card-v1", dataKind: "facts", facts: true }),
  table: Object.freeze({ rendererId: "table-card-v1", dataKind: "table" }),
  compound: Object.freeze({ rendererId: "compound-card-v1", dataKind: "compound", facts: true }),
  chart: Object.freeze({ rendererId: "aits-chart-v1", dataKind: "chart", chart: true }),
});

const REQUIRED_FACTS_METHODS = Object.freeze([
  "classifyCell",
  "changeTone",
  "formatNumeric",
  "formatDatetime",
  "groupFactsFields",
]);

function rendererUnavailable() {
  const error = new Error(RENDERER_UNAVAILABLE_MESSAGE);
  error.code = RENDERER_UNAVAILABLE_CODE;
  return error;
}

function preflight(card, chartRenderer) {
  const contract = CARD_RENDERERS[card.renderKind];
  if (!contract || card.rendererId !== contract.rendererId || card.data?.kind !== contract.dataKind) {
    throw rendererUnavailable();
  }

  let facts = null;
  if (contract.facts) {
    facts = globalThis.window?.AthenaLib?.FactsCard;
    if (!facts || REQUIRED_FACTS_METHODS.some((method) => typeof facts[method] !== "function")) {
      throw rendererUnavailable();
    }
  }

  if (contract.chart &&
      (typeof chartRenderer?.mount !== "function" || typeof chartRenderer?.destroy !== "function")) {
    throw rendererUnavailable();
  }

  return facts;
}

function element(document, tagName, className = "", text = "") {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function factScalar(facts, key, value) {
  const kind = facts.classifyCell(key);
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "change") return String(value);
  if (kind === "price" || kind === "quantity") return facts.formatNumeric(value);
  if (kind === "datetime") return facts.formatDatetime(value);
  return String(value);
}

function rawScalar(value) {
  return value === null || value === undefined ? "—" : String(value);
}

function renderFactsGroup(document, fields, facts) {
  const group = element(document, "div", "financial-fact-group");
  for (const field of fields) {
    const row = element(document, "div", "financial-fact-row");
    const kind = facts.classifyCell(field.key);
    const value = element(document, "dd", `financial-fact-value financial-fact-value-${kind}`,
      factScalar(facts, field.key, field.value));
    if (kind === "change") value.classList.add(`tone-${facts.changeTone(field.key, field.value)}`);
    row.append(element(document, "dt", "", field.label), value);
    group.append(row);
  }
  return group;
}

function renderFacts(document, parent, fields, facts, className = "financial-facts", grouped = true) {
  const list = element(document, "dl", className);
  const groups = grouped ? facts.groupFactsFields(fields) : [fields];
  for (const group of groups) list.append(renderFactsGroup(document, group, facts));
  parent.append(list);
}

function renderTable(document, parent, columns, rows) {
  const scroll = element(document, "div", "financial-table-scroll");
  const table = element(document, "table", "financial-table");
  const head = element(document, "thead");
  const headRow = element(document, "tr");
  for (const column of columns) headRow.append(element(document, "th", "", column.label));
  head.append(headRow);
  const body = element(document, "tbody");
  for (const row of rows) {
    const item = element(document, "tr");
    for (const column of columns) item.append(element(document, "td", "", rawScalar(row[column.key])));
    body.append(item);
  }
  table.append(head, body);
  scroll.append(table);
  parent.append(scroll);
}

function renderProvenance(document, parent, provenance) {
  const source = element(document, "dl", "financial-provenance");
  const fields = [
    ["환경", provenance.environment === "real" ? "실전 조회" : "모의 조회"],
    ["TR", provenance.trId],
    ["수신 시각", provenance.fetchedAt],
    ["자료 기준", provenance.sourceAsOf ? `${provenance.sourceAsOf.value} (${provenance.sourceAsOf.kind})` : `제공되지 않음 · ${provenance.fetchedAt} 수신`],
  ];
  for (const [label, value] of fields) {
    const row = element(document, "div");
    row.append(element(document, "dt", "", label), element(document, "dd", "", value));
    source.append(row);
  }
  parent.append(source);
}

export function renderFinancialCard({
  document,
  container,
  card,
  chartRenderer,
  onPage = () => {},
  onContinue = () => {},
}) {
  if (!document?.createElement || !container?.replaceChildren || !card) {
    throw new TypeError("document, container, and card are required");
  }

  const facts = preflight(card, chartRenderer);
  chartRenderer?.destroy?.();

  const root = element(document, "article", `financial-card financial-card-${card.renderKind}`);
  root.append(element(document, "h3", "", card.title));
  renderProvenance(document, root, card.provenance);
  if (card.renderKind === "facts") renderFacts(document, root, card.data.fields, facts);
  else if (card.renderKind === "table") renderTable(document, root, card.data.columns, card.data.rows);
  else if (card.renderKind === "compound") {
    renderFacts(document, root, card.data.header, facts, "financial-facts financial-compound-header", false);
    renderTable(document, root, card.data.columns, card.data.rows);
  } else {
    const chartHost = element(document, "div", "financial-chart-host");
    root.append(chartHost);
    const failChartMount = () => {
      chartHost.replaceChildren(element(document, "p", "financial-card-error", "차트를 표시하지 못했습니다."));
    };
    try {
      Promise.resolve(chartRenderer.mount(chartHost, card)).catch(failChartMount);
    } catch {
      failChartMount();
    }
  }

  const footer = element(document, "div", "financial-card-paging");
  function renderPaging(nextCard) {
    footer.replaceChildren();
    footer.append(element(document, "span", "", `${nextCard.page.pageIndex + 1} / ${nextCard.page.pageCount} 페이지`));
    for (const [label, token, direction] of [
      ["이전 페이지", nextCard.page.previousPageToken, "previous"],
      ["다음 페이지", nextCard.page.nextPageToken, "next"],
    ]) {
      if (!token) continue;
      const button = element(document, "button", "secondary", label);
      button.type = "button";
      button.addEventListener("click", () => onPage({ jobId: nextCard.jobId, pageToken: token, direction }));
      footer.append(button);
    }
    if (nextCard.continuation.available && nextCard.continuation.continuationToken) {
      const more = element(document, "button", "secondary", "브로커 다음 조회");
      more.type = "button";
      more.addEventListener("click", () => onContinue({
        parentJobId: nextCard.jobId,
        continuationToken: nextCard.continuation.continuationToken,
      }));
      footer.append(more);
    }
  }
  renderPaging(card);
  root.append(footer);
  container.replaceChildren(root);
  return Object.freeze({ root, renderKind: card.renderKind, updatePaging: renderPaging });
}
