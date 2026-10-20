import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = await mkdtemp(resolve(tmpdir(), "athena-wts-extension-chart-"));
const profile = await mkdtemp(resolve(tmpdir(), "athena-wts-chrome-profile-"));
const chrome = [
  resolve(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
  resolve(process.env["ProgramFiles(x86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
  resolve(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
].find((candidate) => {
  try { return execFileSync("powershell", ["-NoProfile", "-Command", `Test-Path -LiteralPath '${candidate.replaceAll("'", "''")}'`], { encoding: "utf8" }).trim() === "True"; }
  catch { return false; }
});

if (!chrome) throw new Error("Chrome executable was not found");

const harnessHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
body{margin:0;background:#0c1016}.financial-chart-host{display:flex;flex-direction:column;width:420px;height:440px;position:relative}.chart-price-pane{flex:1;min-height:0;position:relative}.chart-toolbar{display:flex}.chart-indicator-panel,.chart-drawbar{display:none}
</style></head><body>
<section id="financial-section">
  <p id="financial-readiness"></p><button id="financial-refresh" type="button"></button>
  <select id="financial-profile"></select><details id="financial-credentials"></details>
  <form id="financial-credentials-form"><input id="financial-profile-id"><input id="financial-profile-label">
    <select id="financial-environment"><option value="mock">mock</option></select>
    <input id="financial-app-key"><input id="financial-secret-key">
    <button id="financial-credential-save" type="submit"></button><button id="financial-credential-delete" type="button"></button>
  </form>
  <div id="financial-query-form"></div><button id="financial-query-stop" type="button"></button>
  <p id="financial-query-status"></p><div id="financial-card"></div>
</section>
<div id="host" class="financial-chart-host"></div>
<script src="sidepanel/vendor/facts-card.js"></script><script src="sidepanel/vendor/board-format.js"></script>
<script src="sidepanel/vendor/ui-kit.js"></script><script src="sidepanel/vendor/chart-resample.js"></script>
<script src="sidepanel/vendor/chart-indicator-registry.js"></script><script src="sidepanel/vendor/chart-indicators.js"></script>
<script src="sidepanel/vendor/chart-indicator-render.js"></script><script src="sidepanel/vendor/chart-volume-profile.js"></script>
<script src="sidepanel/vendor/chart-authoring-store.js"></script><script src="sidepanel/vendor/chart-drawings.js"></script>
<script src="sidepanel/vendor/chart-toolbar.js"></script><script src="sidepanel/vendor/chart-indicator-panel.js"></script>
<script src="sidepanel/vendor/chart-card.js"></script><script src="sidepanel/vendor/chart-tick-fold.js"></script>
<script src="sidepanel/vendor/aits-chart-panel.js"></script><script type="module" src="harness.mjs"></script></body></html>`;

const harnessModule = `
import { createFinancialChartRenderer } from "./sidepanel/financial-chart-renderer.mjs";
import { createFinancialPanelController } from "./sidepanel/panel-financial.mjs";
const wait = (ms=100) => new Promise((resolve) => setTimeout(resolve, ms));
const waitUntil = async (read, label, timeoutMs=3000) => {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = read();
    if (value) return value;
    await wait(10);
  }
  throw new Error(label + " timed out");
};
const snapshotRange = (chart) => {
  const range = chart.timeScale().getVisibleLogicalRange();
  return range ? {from:range.from,to:range.to} : null;
};
const state = {ready:false,rafObserved:false,error:null,result:null};
window.__athenaHarness = state;
const profileId = "00000000-0000-4000-8000-000000000003";
const provenance = {
  provider:"kiwoom-rest",environment:"mock",profileId,trId:"ka10001",endpoint:"/api/dostk/stkinfo",
  catalogVersion:"sha256:"+"a".repeat(64),fetchedAt:"2026-10-19T00:00:00.000Z",sourceAsOf:null,
  sourceStatusCode:"0",argumentsSha256:"sha256:"+"b".repeat(64),
};
const page = {
  pageIndex:0,pageCount:2,itemStart:0,itemEndExclusive:1,itemCount:1,totalItems:2,initial:true,
  previousPageToken:null,nextPageToken:"x".repeat(43),expiresAt:"2026-10-19T00:05:00.000Z",
};
const continuation = {available:true,continuationToken:"y".repeat(43),expiresAt:"2026-10-19T00:05:00.000Z"};
const makeCard = (renderKind, rendererId, data, jobIndex) => ({
  cardVersion:"wts-financial-card-1",jobId:"00000000-0000-4000-8000-"+String(jobIndex).padStart(12,"0"),
  submissionId:"10000000-0000-4000-8000-"+String(jobIndex).padStart(12,"0"),operationRef:"base:ka10001",
  renderKind,rendererId,title:renderKind+" browser proof",provenance:{...provenance},page:{...page},
  continuation:{...continuation},data,
});
const factsFields = [
  {key:"cur_prc",label:"현재가",value:"001234"},{key:"pred_pre",label:"전일대비",value:"+50"},
  {key:"pred_pre_sig",label:"기호",value:5},{key:"trde_qty",label:"거래량",value:1000},
  {key:"dt",label:"일자",value:"20261019"},{key:"stk_cd",label:"종목코드",value:"005930"},
  {key:"empty",label:"없음",value:null},...Array.from({length:4},(_,index)=>({key:"field_"+index,label:"항목 "+index,value:index})),
];
const cards = [
  makeCard("facts","facts-card-v1",{kind:"facts",fields:factsFields},1),
  makeCard("table","table-card-v1",{kind:"table",columns:[
    {key:"dt",label:"일자"},{key:"cur_prc",label:"현재가"},{key:"stk_cd",label:"종목"},{key:"empty",label:"없음"},
  ],rows:[{dt:"20261019",cur_prc:"001234",stk_cd:"005930",empty:null}]},2),
  makeCard("compound","compound-card-v1",{kind:"compound",header:factsFields,columns:[
    {key:"cur_prc",label:"현재가"},{key:"empty",label:"없음"},
  ],rows:[{cur_prc:"001234",empty:null}]},3),
  makeCard("facts","facts-card-v1",{kind:"facts",fields:factsFields.slice(0,2)},4),
];
let queryStarts = 0;
const scheduled = [];
const panelChartRenderer = createFinancialChartRenderer();
const controller = createFinancialPanelController({
  document,
  chartRenderer:panelChartRenderer,
  createId:()=>"20000000-0000-4000-8000-"+String(queryStarts+1).padStart(12,"0"),
  schedule:(callback)=>{scheduled.push(callback);return scheduled.length;},cancelSchedule:()=>{},
  send:async(type)=>{
    if(type==="panel.financial.credentials.status") return {profiles:[{profileId,label:"브라우저 검증",environment:"mock",revision:1,state:"ready"}],mutation:null};
    if(type==="panel.financial.query.start") {
      const card=cards[queryStarts++];
      if(!card) throw new Error("unexpected extra query start");
      return {job:{jobId:card.jobId,state:"completed",card}};
    }
    throw new Error("unexpected panel message: "+type);
  },
});
const submitQuery = async () => {
  const before=queryStarts;
  const form=document.querySelector("#financial-query-form form");
  if(!form) throw new Error("financial query form was not rendered");
  form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
  await waitUntil(()=>queryStarts===before+1,"financial query submission");
  await wait(0);
};
const original = window.AthenaLib.ChartCard.createChartCard;
window.AthenaLib.ChartCard.createChartCard = async (...args) => {
  const renderer = await original(...args);
  state.renderer = renderer;
  return renderer;
};
const candles = Array.from({length:80}, (_, index) => ({
  time: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0,10),
  open: 100 + index, high: 103 + index, low: 98 + index, close: 101 + index, volume: 1000 + index,
}));
const card = {jobId:"00000000-0000-4000-8000-000000000001",page:{pageIndex:1},data:{symbol:"005930",chart:{period:"day",target:"stock",trId:"ka10081",candles}}};
const host = document.querySelector("#host");
const facade = createFinancialChartRenderer();
try {
  if(!controller.showOperation({kind:"capability-detail",operationRef:"base:ka10001",domain:"quotes",name:"브라우저 카드 검증",requiredArguments:[],optionalArguments:[]})) {
    throw new Error("financial operation form was rejected");
  }
  await controller.applyConnection({connected:true,runtime:{financial:{configured:true}},financial:{}});
  await waitUntil(()=>document.querySelector("#financial-readiness").textContent==="금융 조회 준비가 완료되었습니다.","financial profile readiness");
  const profile=document.querySelector("#financial-profile");
  profile.value=profileId;
  profile.dispatchEvent(new Event("change",{bubbles:true}));
  const cardHost=document.querySelector("#financial-card");
  await submitQuery();
  const factsValues=[...cardHost.querySelectorAll(".financial-facts dd")].map((node)=>node.textContent);
  const factsProof={
    twoGroups:cardHost.querySelectorAll(".financial-fact-group").length===2,
    formatted:JSON.stringify(factsValues.slice(0,7))===JSON.stringify(["1,234","+50","5","1,000","2026-10-19","005930","—"]),
    tones:cardHost.querySelectorAll(".tone-up").length===1&&cardHost.querySelectorAll(".tone-down").length===1,
  };
  await submitQuery();
  const tableProof={
    columns:JSON.stringify([...cardHost.querySelectorAll("th")].map((node)=>node.textContent))===JSON.stringify(["일자","현재가","종목","없음"]),
    rawValues:JSON.stringify([...cardHost.querySelectorAll("td")].map((node)=>node.textContent))===JSON.stringify(["20261019","001234","005930","—"]),
  };
  await submitQuery();
  const compoundBand=cardHost.querySelector(".financial-compound-header");
  const compoundProof={
    oneBand:compoundBand?.querySelectorAll(".financial-fact-group").length===1,
    ordered:JSON.stringify([...compoundBand.querySelectorAll("dt")].map((node)=>node.textContent))===JSON.stringify(factsFields.map((field)=>field.label)),
    formatted:JSON.stringify([...compoundBand.querySelectorAll("dd")].map((node)=>node.textContent).slice(0,7))===JSON.stringify(["1,234","+50","5","1,000","2026-10-19","005930","—"]),
    rawTable:JSON.stringify([...cardHost.querySelectorAll("td")].map((node)=>node.textContent))===JSON.stringify(["001234","—"]),
  };
  const previousRoot=cardHost.firstElementChild;
  const previousPaging=previousRoot.querySelector(".financial-card-paging");
  const previousText=previousRoot.textContent;
  const actualFacts=window.AthenaLib.FactsCard;
  const originalFormatNumeric=actualFacts.formatNumeric;
  actualFacts.formatNumeric=undefined;
  try { await submitQuery(); } finally { actualFacts.formatNumeric=originalFormatNumeric; }
  const failureProof={
    exactStatus:document.querySelector("#financial-query-status").textContent==="금융 카드 렌더러를 사용할 수 없습니다.",
    noCompletionStatus:document.querySelector("#financial-query-status").textContent!=="조회가 완료되었습니다.",
    rootPreserved:cardHost.firstElementChild===previousRoot,
    pagingPreserved:previousRoot.querySelector(".financial-card-paging")===previousPaging,
    textPreserved:previousRoot.textContent===previousText,
  };
  state.cards={facts:factsProof,table:tableProof,compound:compoundProof,failure:failureProof,
    actualFactsFacade:["classifyCell","changeTone","formatNumeric","formatDatetime","groupFactsFields"].every((method)=>typeof actualFacts[method]==="function")};
  state.cards.ok=[...Object.values(factsProof),...Object.values(tableProof),...Object.values(compoundProof),...Object.values(failureProof),state.cards.actualFactsFacade].every(Boolean);
  if(!state.cards.ok) throw new Error("financial card browser proof failed: "+JSON.stringify(state.cards));
  document.querySelector("#financial-section").hidden=true;
  await facade.mount(host, card); await wait(300);
  const chart = state.renderer.chart;
  state.chart = chart;
  state.before = snapshotRange(chart);
  const canvasBefore = Math.max(...[...host.querySelectorAll("canvas")].map((canvas) => canvas.getBoundingClientRect().width));
  host.style.width = "680px"; await wait(300);
  const canvasAfter = Math.max(...[...host.querySelectorAll("canvas")].map((canvas) => canvas.getBoundingClientRect().width));
  state.resized = canvasAfter > canvasBefore;
  const pane = host.querySelector(".chart-price-pane");
  const topCanvases = [...pane.querySelectorAll("canvas")].filter((canvas) => (
    canvas.style.zIndex === "2" || getComputedStyle(canvas).zIndex === "2"
  ));
  const surface = topCanvases.sort((left,right) => {
    const a = left.getBoundingClientRect(), b = right.getBoundingClientRect();
    return (b.width*b.height)-(a.width*a.height);
  })[0];
  if (!surface) throw new Error("lightweight-charts top interaction canvas was not found");
  const rect = surface.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  state.inputEvents = [];
  const recordInput = (event) => state.inputEvents.push({type:event.type,isTrusted:event.isTrusted,timeStamp:event.timeStamp,sourceTouch:event.sourceCapabilities?.firesTouchEvents??null,button:event.button,buttons:event.buttons,x:event.clientX,y:event.clientY,target:event.target?.tagName||null});
  for (const type of ["wheel","mousedown","mousemove","mouseup"]) document.documentElement.addEventListener(type, recordInput, true);
  state.surface = {x:rect.left,y:rect.top,width:rect.width,height:rect.height,zIndex:getComputedStyle(surface).zIndex,topCanvasCount:topCanvases.length,hitTag:hit?.tagName||null,hitZIndex:hit?getComputedStyle(hit).zIndex:null};
  await new Promise((resolve) => requestAnimationFrame(() => { state.rafObserved = true; resolve(); }));
  state.recordZoom = () => { state.zoomed = snapshotRange(chart); return state.zoomed; };
  state.recordPan = () => { state.panned = snapshotRange(chart); return state.panned; };
  state.finish = async () => {
    const rangeBeforePrepend = snapshotRange(chart);
    const older = {...card,page:{pageIndex:0},data:{...card.data,chart:{...card.data.chart,candles:[
      {time:"2025-12-30",open:98,high:101,low:97,close:100,volume:900},
      {time:"2025-12-31",open:99,high:102,low:98,close:101,volume:950},
    ]}}};
    const prepended = await facade.prepend(older); await wait(100);
    const rangeAfterPrepend = snapshotRange(chart);
    const handleScroll = chart.options().handleScroll;
    const result = {
      mounted: host.querySelectorAll("canvas").length > 0,
      rafObserved: state.rafObserved,
      panZoomOptions: chart.options().handleScroll !== false && chart.options().handleScale !== false,
      panConfigured: handleScroll === true || handleScroll?.pressedMouseMove === true,
      zoomed: Boolean(state.before && state.zoomed && Math.abs((state.zoomed.to-state.zoomed.from)-(state.before.to-state.before.from)) > 0.01),
      panned: Boolean(state.zoomed && state.panned && Math.abs(state.panned.from-state.zoomed.from) > 0.01),
      resized: state.resized,
      prepended,
      viewportPreserved: Boolean(rangeBeforePrepend && rangeAfterPrepend && Math.abs((rangeAfterPrepend.from-rangeBeforePrepend.from)-2) < 0.2),
      ranges: {before:state.before,zoomed:state.zoomed,panned:state.panned,rangeBeforePrepend,rangeAfterPrepend},
      interactionSurface: state.surface,
    };
    facade.destroy(); await wait(50);
    result.destroyed = host.querySelectorAll("canvas").length === 0;
    result.cards = state.cards;
    result.ok = ["mounted","rafObserved","panZoomOptions","panConfigured","zoomed","panned","resized","viewportPreserved","destroyed"]
      .every((key) => result[key] === true) && result.prepended === 2 && result.cards.ok === true;
    state.result = result;
    return result;
  };
  state.ready = true;
} catch (error) {
  state.error = error?.message || String(error);
}
`;

function contentType(path) {
  return ({ ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".txt": "text/plain; charset=utf-8" })[extname(path)] || "application/octet-stream";
}

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function waitForActivePort(child, timeoutMs = 10_000) {
  const path = resolve(profile, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`owned Chrome exited before CDP startup (${child.exitCode})`);
    try {
      const [port, browserPath] = (await readFile(path, "utf8")).trim().split(/\r?\n/u);
      if (/^\d+$/u.test(port) && browserPath?.startsWith("/devtools/browser/")) {
        return `ws://127.0.0.1:${port}${browserPath}`;
      }
    } catch {}
    await delay(50);
  }
  throw new Error("owned Chrome did not publish DevToolsActivePort");
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await Promise.race([
    new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", () => rejectOpen(new Error("CDP WebSocket connection failed")), { once: true });
    }),
    delay(5_000).then(() => { throw new Error("CDP WebSocket connection timed out"); }),
  ]);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
    else entry.resolve(message.result || {});
  });
  function send(method, params = {}, sessionId) {
    if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`CDP socket is not open for ${method}`));
    const id = nextId++;
    return new Promise((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectSend(new Error(`${method} timed out`));
      }, 5_000);
      pending.set(id, { resolve: resolveSend, reject: rejectSend, timer, method });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  function close() {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`${entry.method}: CDP connection closed`));
    }
    pending.clear();
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
  return { send, close };
}

async function evaluate(cdp, sessionId, expression, awaitPromise = false) {
  const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true }, sessionId);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Runtime.evaluate failed");
  return response.result?.value;
}

async function pollValue(read, accept, label, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (accept(value)) return value;
    await delay(50);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(value)}`);
}

async function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return true;
  return Promise.race([
    new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
    delay(timeoutMs).then(() => false),
  ]);
}

let server;
let ownedChrome;
let cdp;
let targetId;
try {
  execFileSync(process.execPath, [resolve(root, "scripts", "build.mjs")], {
    stdio: "inherit", env: { ...process.env, ATHENA_EXTENSION_OUTPUT: output },
  });
  await writeFile(resolve(output, "harness.html"), harnessHtml, "utf8");
  await writeFile(resolve(output, "harness.mjs"), harnessModule, "utf8");
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const path = resolve(output, `.${decodeURIComponent(url.pathname)}`);
      if (path !== output && !path.startsWith(`${output}${sep}`)) throw new Error("invalid path");
      const body = await readFile(path);
      response.writeHead(200, { "content-type": contentType(path), "cache-control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const { port } = server.address();
  ownedChrome = spawn(chrome, [
    "--headless=new", "--disable-background-networking", "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "--window-size=900,700", "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  cdp = await connectCdp(await waitForActivePort(ownedChrome));
  ({ targetId } = await cdp.send("Target.createTarget", { url: "about:blank" }));
  await cdp.send("Target.activateTarget", { targetId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.bringToFront", {}, sessionId);
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/harness.html` }, sessionId);
  await pollValue(
    () => evaluate(cdp, sessionId, "({ready:window.__athenaHarness?.ready===true,error:window.__athenaHarness?.error||null})"),
    (value) => value?.ready === true || typeof value?.error === "string",
    "chart harness readiness",
  ).then((value) => { if (value.error) throw new Error(value.error); });
  const surface = await evaluate(cdp, sessionId, "window.__athenaHarness.surface");
  const before = await evaluate(cdp, sessionId, "window.__athenaHarness.before");
  const x = surface.x + surface.width / 2;
  const y = surface.y + surface.height / 2;
  // Official CDP contract: https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchMouseEvent
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: -240, button: "none", buttons: 0, pointerType: "mouse" }, sessionId);
  const beforeSpan = before.to - before.from;
  const zoomed = await pollValue(
    () => evaluate(cdp, sessionId, "window.__athenaHarness.recordZoom()"),
    (range) => range && Math.abs((range.to - range.from) - beforeSpan) > 0.01,
    "trusted wheel zoom",
  );
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0, pointerType: "mouse" }, sessionId);
  await delay(50);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" }, sessionId);
  await delay(50);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x - 12, y, buttons: 1, pointerType: "mouse" }, sessionId);
  await delay(50);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x - 120, y, buttons: 1, pointerType: "mouse" }, sessionId);
  await delay(50);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x - 200, y, buttons: 1, pointerType: "mouse" }, sessionId);
  let panned;
  try {
    panned = await pollValue(
      () => evaluate(cdp, sessionId, "window.__athenaHarness.recordPan()"),
      (range) => range && Math.abs(range.from - zoomed.from) > 0.01,
      "trusted mouse pan",
    );
  } catch (error) {
    const diagnostics = await evaluate(cdp, sessionId, "({surface:window.__athenaHarness.surface,inputEvents:window.__athenaHarness.inputEvents,range:window.__athenaHarness.recordPan()})");
    throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`);
  } finally {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x - 200, y, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse" }, sessionId);
  }
  const result = await evaluate(cdp, sessionId, "window.__athenaHarness.finish()", true);
  if (!result?.ok) throw new Error(`Chrome chart harness failed: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result));
} finally {
  if (cdp && targetId) {
    try { await cdp.send("Target.closeTarget", { targetId }); } catch {}
  }
  if (cdp) {
    try { await cdp.send("Browser.close"); } catch {}
  }
  if (ownedChrome && !await waitForExit(ownedChrome, 3_000)) {
    ownedChrome.kill();
    if (!await waitForExit(ownedChrome, 3_000)) throw new Error("owned Chrome did not exit");
  }
  if (cdp) cdp.close();
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  await rm(output, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  for (const path of [output, profile]) {
    try { await access(path); throw new Error(`temporary path cleanup failed: ${path}`); } catch (error) {
      if (error?.message?.startsWith("temporary path cleanup failed")) throw error;
    }
  }
}
