import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const { createLayaRouting } = require('./laya-routing');
const { buildLayaTurnContext } = require('./laya-turn-context');
const { runConversationSessionTurn } = require('./conversation-session-turn');
const { createProviderRuntimeController } = require('./provider-runtime-bootstrap');
const { runSelectorFastPath } = require('./selector-fast-path');

test('LAYA provider handoff presents a recommendation without binding tool or supplied arguments', () => {
  const { ticketPrompt } = require('./laya-routing');
  const prompt = ticketPrompt('선택한 알림을 멈춰 줘', 'fixture-ticket', {
    tool_name: 'athena_routine', arguments: { action: 'draft' },
  });
  assert.match(prompt, /LAYA 추천/);
  assert.match(prompt, /사용자 요청과 명시된 도구·인수를 우선/);
  assert.match(prompt, /다른 도구를 사용할 수 있다/);
  assert.ok(prompt.includes('"action":"draft"'));
});

const context = (conversation = 'shell-a', turn = 'turn-1') => ({
  conversation_id: conversation, turn_id: turn, origin: 'shell',
  utterance: '지도를 화면에 맞춰줘', context: { canvasMode: 'graph' },
});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(handler) {
  const calls = [];
  let serial = 0;
  const routing = createLayaRouting({ baseUrl: 'http://127.0.0.1:18765', bearerToken: 'fixture-only',
    uuid: () => `fixture-private-${String(++serial).padStart(32, '0')}`,
    async fetchImpl(url, options) {
      const call = { path: url.pathname, method: options.method, body: options.body ? JSON.parse(options.body) : null,
        headers: options.headers };
      calls.push(call);
      const value = await handler(call);
      return { ok: true, status: 200, json: async () => value };
    },
  });
  return { routing, calls };
}
function normal(call) {
  if (call.path.endsWith('/turns')) return { ticket: `ticket-${call.body.turn_id}`,
    conversation_id: call.body.conversation_id, turn_id: call.body.turn_id };
  if (call.path.endsWith('/plan')) return { complete: false, tool_name: 'athena_graph_view', arguments: { action: 'fit' } };
  return {};
}

test('warm leases are unique, bound only on claim, and private identity never enters provider prompt', async () => {
  const { routing, calls } = fixture(normal);
  const a = routing.createSession(), b = routing.createSession();
  assert.notDeepEqual(a.env(), b.env());
  assert.equal(calls.length, 0);
  let request;
  await a.run({ prompt: 'Original provider prompt', layaContext: context() }, async x => { request = x; return { ok: true }; });
  assert.equal(calls[0].body.utterance, context().utterance);
  assert.deepEqual(calls[0].body.context, context().context);
  assert.ok(request.prompt.includes('ticket-turn-1'));
  for (const value of Object.values(a.env())) assert.ok(!request.prompt.includes(value));
  assert.deepEqual(request.envOverrides, a.env());
  assert.equal(calls.at(-1).method, 'DELETE');
  assert.throws(() => a.bind('another-conversation'), /ownership mismatch/);
  b.bind('orb-a');
  assert.equal(calls[0].headers['X-Athena-Laya-Lease'], a.env().ATHENA_LAYA_LEASE_ID);
});

test('confirmed direct dispatch forwards one real envelope and does not call the provider', async () => {
  const events = [], text = [];
  const envelope = { status: 'ok', data: { kind: 'fit', delivered: 'canvas' } };
  const { routing, calls } = fixture(call => call.path.endsWith('/plan')
    ? { complete: true, tool_name: 'athena_graph_view', arguments: { action: 'fit' } }
    : call.path.endsWith('/dispatch') ? { applied: true, tool_name: 'athena_graph_view', arguments: { action: 'fit' },
      result: { content: [{ type: 'text', text: JSON.stringify(envelope) }], isError: false } } : normal(call));
  const result = await routing.createSession().run({ prompt: 'question', layaContext: context(),
    onEvent: e => events.push(e), onTextDelta: t => text.push(t) }, () => assert.fail('provider must not execute'));
  assert.equal(result.ok, true);
  assert.equal(events.length, 2);
  assert.equal(events[1].message.content[0].content[0].text, JSON.stringify(envelope));
  assert.equal(events[0].message.content[0].input.action, 'fit');
  assert.equal(calls.filter(c => c.path.endsWith('/dispatch')).length, 1);
  assert.equal(text.length, 1);
});

async function confirmedRead(tool, action, content, isError = false) {
  const events = [], text = [];
  const { routing, calls } = fixture(call => call.path.endsWith('/plan')
    ? { complete: true, tool_name: tool, arguments: { action } }
    : call.path.endsWith('/dispatch') ? { applied: true, tool_name: tool, arguments: { action },
      result: { content, isError } } : normal(call));
  const result = await routing.createSession().run({ prompt: '조회해 줘', layaContext: context(),
    onEvent: e => events.push(e), onTextDelta: t => text.push(t) }, () => assert.fail('confirmed execution must not invoke provider'));
  assert.equal(calls.filter(c => c.path.endsWith('/dispatch')).length, 1);
  assert.equal(calls.at(-1).method, 'DELETE');
  if (!isError) assert.deepEqual(events[1].message.content[0].content, content);
  return { result, events, text };
}

test('routine list formats actual native fields while retaining the complete tool payload', async () => {
  const payload = { routines: [
    { id: 'fixture-1', symbol: '005930', note: '장 마감\n요약', status: 'active', mode: 'scheduled', activation_blocker: null },
    { id: 'fixture-2', symbol: '000660', note: '[가격] 확인', status: 'paused', mode: 'periodic', activation_blocker: 'fixture-blocker' },
  ], last_error: 'fixture-only detail', fired_today: 2 };
  const { result, text } = await confirmedRead('athena_routine', 'list', [{ type: 'text', text: JSON.stringify(payload) }]);
  assert.equal(result.ok, true);
  assert.equal(text[0], '루틴 2개가 있습니다.\n\n- 장 마감 요약 (005930) · 활성\n- \\[가격\\] 확인 (000660) · 일시정지 · 실행 조건 확인 필요\n\n오늘 발생 횟수: 2회.\n현재 루틴 처리 오류가 기록되어 있습니다.');
  assert.equal(result.finalResult.result, text[0]);
  assert.ok(!text[0].includes('fixture-only detail'));
  const empty = await confirmedRead('athena_routine', 'list', [{ type: 'text', text: JSON.stringify({ routines: [], last_error: null, fired_today: 0 }) }]);
  assert.equal(empty.text[0], '등록된 루틴이 없습니다.\n\n오늘 발생 횟수: 0회.');
});

test('nudge get formats validated limits, quiet hours and booleans without claiming changes', async () => {
  const payload = { max_daily_nudges: 3, max_daily_briefings: 10,
    quiet_hours: { start: '22:00', end: '07:30' }, show_rationale: true, learn_from_dismissals: false };
  const { result, text } = await confirmedRead('athena_nudge_guard', 'get', [{ type: 'text', text: JSON.stringify(payload) }]);
  assert.equal(result.ok, true);
  assert.equal(text[0], '현재 말걸기 설정입니다.\n\n- 하루 말걸기 최대: 3회\n- 하루 자동 브리핑 최대: 10회\n- 방해 금지 시간: 22:00~07:30 (한국시간)\n- 알림 근거 표시: 켜짐\n- 알림 닫기 반응 학습: 꺼짐');
  const noQuiet = await confirmedRead('athena_nudge_guard', 'get', [{ type: 'text', text: JSON.stringify({ ...payload, quiet_hours: { start: '00:00', end: '00:00' } }) }]);
  assert.ok(noQuiet.text[0].includes('방해 금지 시간: 사용 안 함'));
});

test('malformed or unknown read payload stays terminal without raw JSON answers or duplicate execution', async () => {
  for (const [tool, action, content] of [
    ['athena_routine', 'list', [{ type: 'text', text: '{' }]],
    ['athena_routine', 'list', [{ type: 'text', text: JSON.stringify({ routines: [{ note: 'fixture', symbol: '005930', status: 'unknown' }] }) }]],
    ['athena_nudge_guard', 'get', [{ type: 'text', text: JSON.stringify({ max_daily_nudges: 3 }) }]],
    ['athena_nudge_guard', 'get', [{ type: 'text', text: '{}' }, { type: 'text', text: '{}' }]],
    ['athena_brain', 'profile', [{ type: 'text', text: '{"unexpected":"fixture"}' }]],
  ]) {
    const { result, text } = await confirmedRead(tool, action, content);
    assert.equal(result.ok, true);
    assert.equal(text[0], '조회를 완료했지만 결과 내용을 표시하지 못했습니다.');
  }
  const failure = await confirmedRead('athena_routine', 'list', [{ type: 'text', text: 'fixture handler error' }], true);
  assert.equal(failure.result.ok, false);
  assert.equal(failure.result.submitted, true);
  assert.deepEqual(failure.text, []);
});

test('unavailable registration and incomplete classification fall back; ambiguous dispatch never re-executes', async () => {
  const down = fixture(() => { throw Error('offline'); });
  let count = 0;
  await down.routing.createSession().run({ prompt: 'unchanged', layaContext: context() }, async options => {
    count++; assert.equal(options.prompt, 'unchanged'); return { ok: true };
  });
  assert.equal(count, 1);
  const fail = fixture(call => {
    if (call.path.endsWith('/plan')) return { complete: true, tool_name: 'athena_graph_view' };
    if (call.path.endsWith('/dispatch')) throw Error('response lost after execution');
    return normal(call);
  });
  const outcome = await fail.routing.createSession().run({ prompt: 'question', layaContext: context() }, () => assert.fail('duplicate'));
  assert.equal(outcome.ok, false); assert.equal(outcome.submitted, true);
  assert.equal(fail.calls.at(-1).method, 'DELETE');
});

test('cancel while registration is pending revokes returned ticket and never spawns', async () => {
  const registration = deferred();
  const { routing, calls } = fixture(call => call.path.endsWith('/turns') ? registration.promise : normal(call));
  let handle;
  const result = routing.createSession().run({ prompt: 'question', layaContext: context(), onSpawn: h => { handle = h; } }, () => assert.fail('canceled spawn'));
  handle.kill();
  registration.resolve({ ticket: 'late-ticket', conversation_id: 'shell-a', turn_id: 'turn-1' });
  assert.equal((await result).aborted, true);
  assert.equal(calls.at(-1).path, '/api/v1/laya/turns/late-ticket');
  assert.equal(calls.at(-1).method, 'DELETE');
  assert.equal(calls.filter(c => c.path.endsWith('/plan')).length, 0);
});

test('stale completion cannot revoke a newer turn; concurrent conversations remain isolated', async () => {
  const { routing, calls } = fixture(normal);
  const lease = routing.createSession();
  const oldProvider = deferred(), entered = deferred(), newProvider = deferred(), enteredNew = deferred();
  const old = lease.run({ prompt: 'old', layaContext: context() }, async () => { entered.resolve(); return oldProvider.promise; });
  await entered.promise;
  const fresh = lease.run({ prompt: 'new', layaContext: context('shell-a','turn-2') }, async () => { enteredNew.resolve(); return newProvider.promise; });
  await enteredNew.promise;
  oldProvider.resolve({ ok: false }); await old;
  assert.equal(calls.filter(c => c.method === 'DELETE' && c.path.endsWith('ticket-turn-2')).length, 0);
  const other = routing.createSession();
  await other.run({ prompt: 'orb', layaContext: context('orb-b', 'turn-3') }, async () => ({ ok: true }));
  assert.notEqual(calls.find(c => c.body?.turn_id === 'turn-2').body.lease_id,
    calls.find(c => c.body?.turn_id === 'turn-3').body.lease_id);
  newProvider.resolve({ ok: true }); await fresh;
  assert.equal(calls.filter(c => c.method === 'DELETE' && c.path.endsWith('ticket-turn-2')).length, 1);
});

test('backtest is bypassed and closing a generation cancels its active provider', async () => {
  const { routing, calls } = fixture(normal);
  const lease = routing.createSession();
  await lease.run({ prompt: 'backtest', layaContext: { ...context(), context: { canvasMode: 'backtest' } } }, async o => {
    assert.equal(o.prompt, 'backtest'); return { ok: true };
  });
  assert.equal(calls.length, 0);
  const entered = deferred(), done = deferred(); let killed = 0;
  const pending = lease.run({ prompt: 'q', layaContext: context() }, async o => {
    o.onSpawn({ pid: 123, kill: () => { killed++; done.resolve({ ok: false }); } }); entered.resolve(); return done.promise;
  });
  await entered.promise; lease.close(); await pending;
  assert.equal(killed, 1);
  assert.throws(() => lease.bind('shell-a'), /ownership mismatch/);
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 1);
});

test('provider callbacks redact the opaque ticket and cannot deliver after cancellation', async () => {
  const { routing } = fixture(normal);
  const lease = routing.createSession(); const events = [], texts = [], canvases=[];
  const result = await lease.run({ prompt: 'q', layaContext: context(), onEvent:e=>events.push(e), onTextDelta:t=>texts.push(t), onCanvasResult:r=>canvases.push(r) }, async o => {
    o.onEvent({ type:'assistant', message:{ content:[{ type:'tool_use', input:{ action:'fit', _athena_turn_ticket:'ticket-turn-1' } }] } });
    o.onTextDelta('ticket-turn-1'); lease.cancel();
    o.onEvent({ type:'late' }); o.onTextDelta('late'); o.onCanvasResult({status:'success'});
    return { ok:true };
  });
  assert.equal(result.aborted,true);
  assert.equal(events.length,1); assert.equal(texts.length,1);
  assert.equal(canvases.length,0);
  assert.ok(!JSON.stringify(events).includes('ticket-turn-1'));
  assert.ok(!JSON.stringify(events).includes('_athena_turn_ticket'));
  assert.equal(texts[0],'[turn ticket]');
});

test('actual cold runners pass private env to injected child spawn without argv exposure', async () => {
  for (const provider of ['claude','grok']) {
    let spawned;
    const source=fs.readFileSync(new URL(`./${provider}-runner.js`,import.meta.url),'utf8');
    const child=new EventEmitter();
    child.pid=999; child.stdout=new EventEmitter(); child.stderr=new EventEmitter(); child.stdin=new EventEmitter();
    child.stdout.setEncoding=child.stderr.setEncoding=()=>{}; child.stdin.end=()=>{};
    const module={ exports:{} };
    const fakeRequire = name => {
      if(name==='child_process')return { spawn:(bin,args,options)=>{ spawned={bin,args,options}; queueMicrotask(()=>{ child.stdout.emit('data',JSON.stringify({type:'result',result:'ok',is_error:false})+'\n'); child.emit('close',0); });return child; } };
      if(name==='./mcp-env')return { buildEnvOverrides:()=>({}) };
      if(name==='./proc-utils')return { killTree:()=>{} };
      if(name==='./claude-bin')return { getClaudeBin:()=>'fixture-claude' };
      if(name==='./grok-bin')return { getGrokBin:()=>'fixture-grok' };
      if(name==='node:fs')return { mkdtempSync:()=>'/fixture',writeFileSync:()=>{},rmSync:()=>{} };
      return require(name);
    };
    vm.runInNewContext(source,{ require:fakeRequire,module,exports:module.exports,process:{env:{}},setTimeout,clearTimeout,Buffer });
    const run=provider==='claude'?module.exports.runClaudeQuery:module.exports.runGrokQuery;
    const result=await run({ prompt:'q',cwd:'fixture',envOverrides:{ATHENA_LAYA_LEASE_ID:'private-lease',ATHENA_LAYA_GENERATION_ID:'private-generation'} });
    assert.equal(result.ok,true);
    assert.equal(spawned.options.env.ATHENA_LAYA_LEASE_ID,'private-lease');
    assert.ok(!JSON.stringify(spawned.args).includes('private-lease'));
  }
});

test('actual briefing runner keeps approved note separate and preemption revokes its late ticket', async () => {
  const briefing = require('./briefing-runner'); briefing._resetForTest();
  const registration=deferred(), entered=deferred();
  const { routing,calls }=fixture(call=>{
    if(call.path.endsWith('/turns')){entered.resolve();return registration.promise;}
    return normal(call);
  });
  const event={type:'routine-fired',mode:'scheduled',routine_id:'r1',fired_at:'now',note:'승인된 요청',symbol:'fixture'};
  let providerCalls=0;
  const result=briefing.runBriefingTurn({event,isUserBusy:()=>false,briefingBusy:{increment(){},decrement(){}},
    fetchBudget:async()=>({remaining:1}),reportResult:async()=>{},
    ipc:{sendTextDelta(){},sendToolStep(){},sendQueryState(){}},
    claudeRunner:{runClaudeQuery:()=>{providerCalls++;return {ok:true};}},
    runBoundQuery:(run,options,approved)=>routing.createSession().run({...options,allowLayaDirect:false,
      layaContext:{...context('briefing-r1'),origin:'briefing',utterance:approved.note,context:{symbol:approved.symbol}}},run),
  });
  await entered.promise;
  assert.equal(calls[0].body.utterance,'승인된 요청');
  assert.equal(briefing.killInProgressBriefing(),true);
  registration.resolve({ticket:'briefing-ticket',conversation_id:'briefing-r1',turn_id:'turn-1'});
  assert.equal((await result).aborted,true); assert.equal(providerCalls,0);
  assert.equal(calls.at(-1).method,'DELETE'); briefing._resetForTest();
});

// Execute actual factory bodies with injected providers; no Electron/user profile/CLI is loaded.
const mainSource = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function mainFunction(name, globals) {
  let start = mainSource.indexOf(`function ${name}(`);
  if (mainSource.slice(start - 6, start) === 'async ') start -= 6;
  const end = mainSource.indexOf('\n}', start + 1) + 2;
  return vm.runInNewContext(`(${mainSource.slice(start, end).trim()})`, globals);
}
test('actual warm Claude/Grok/Codex factories propagate one private lease into child and gateway env', () => {
  for (const provider of ['Claude', 'Grok', 'Codex']) {
    let options, runtimeOptions, attached;
    const { routing } = fixture(normal);
    const globals = { layaRouting: routing,
      getLiveMcpConfig: () => ({ dir: 'fixture-dir', configFile: '.mcp.json', configPath: 'fixture-config', grokProfilePath: 'fixture-profile' }),
      mcpEnv: { buildEnvOverrides: () => ({ ATHENA_MCP_ENV__TEST: 'fixture' }) },
      buildLiveSystemPrompt: () => 'system', fs: { readFileSync: () => JSON.stringify({ mcpServers: { athena: { command: 'fixture', args: [], env: {} } } }) },
      attachLayaSession: (s,l) => { attached=l; return s; },
      createClaudeChatSession: o => { options=o; return {}; }, createGrokAcpSession: o => { options=o; return {}; },
      terminateGrokProcessTree: () => { throw new Error('unexpected process termination'); },
      createCodexChatSession: o => { options=o; return {}; },
      createCodexChatRuntime: o => { runtimeOptions=o; return { sessionOptions: {} }; },
      createCodexUserInputDialog: () => ({}), dialog: {}, shellWin: null,
      app: { getPath: () => 'fixture-userdata' }, GATEWAY_ALLOWED_TOOLS: 'fixture', liveGrokSecurityKey: () => 'key',
      currentProviderSelection: { activeAccount: {} }, cliAccounts: {},
    };
    const name = provider === 'Claude' ? 'createLiveChatSessionForConversation' : `createLive${provider}ChatSession`;
    mainFunction(name, globals)();
    const env = (runtimeOptions || options).envOverridesFn();
    assert.equal(env.ATHENA_LAYA_LEASE_ID, attached.env().ATHENA_LAYA_LEASE_ID);
    if (provider === 'Grok') assert.equal(options.mcpServersFn()[0].env.find(x => x.name === 'ATHENA_LAYA_LEASE_ID').value, env.ATHENA_LAYA_LEASE_ID);
  }
});

test('isolated Codex briefing stops its child without closing the outer turn before success', async () => {
  const { routing,calls }=fixture(normal);
  const outer=routing.createSession(); let stopped=0,owns;
  const globals={layaRouting:routing,getLiveMcpConfig:()=>({dir:'fixture',configPath:'fixture'}),
    fs:{readFileSync:()=>JSON.stringify({mcpServers:{athena:{command:'fixture',args:[],env:{}}}})},
    app:{getPath:()=> 'fixture'},GATEWAY_ALLOWED_TOOLS:'fixture',mcpEnv:{buildEnvOverrides:()=>({})},
    liveGrokSecurityKey:()=> 'key',currentProviderSelection:{activeAccount:{}},cliAccounts:{},
    createCodexChatRuntime:()=>({sessionOptions:{}}),buildLiveSystemPrompt:()=> 'system',
    createCodexUserInputDialog:()=>({}),dialog:{},shellWin:null,
    createCodexChatSession:()=>({stop(){stopped++;},async run(){return {ok:true,finalResult:{result:'done'}};}}),
    sessionLayaLeases:new WeakMap(),process:{env:{}},AbortController,liveProviderWarmOptions:()=>({})};
  globals.attachLayaSession=(session,lease,closeOnStop)=>{owns=closeOnStop;return mainFunction('attachLayaSession',globals)(session,lease,closeOnStop);};
  globals.createLiveCodexChatSession=mainFunction('createLiveCodexChatSession',globals);
  const run=mainFunction('runIsolatedCodexBriefingQuery',globals);
  const result=await outer.run({prompt:'approved note',allowLayaDirect:false,layaContext:{...context('briefing'),origin:'briefing'}},
    options=>run({...options,layaSession:outer}));
  assert.equal(result.ok,true);assert.equal(owns,false);assert.equal(stopped,1);
  assert.equal(calls.filter(c=>c.method==='DELETE').length,1);
  outer.close();
});

test('actual claimed-session wrapper binds the selected session and passes cancellation through', async () => {
  const { routing } = fixture(normal);
  const lease = routing.createSession(); let stopped = 0, request;
  const session = { snapshot: () => ({ pid: 42 }), stop: () => { stopped++; }, run: async o => { request=o; return { ok:true }; } };
  const wrapped = mainFunction('runLiveProviderChatTurn', { getLiveProviderChatSession: () => session,
    sessionLayaLeases: new WeakMap([[session,lease]]), runConversationSessionTurn,
    liveRuntimes: { stopChatSession: (_id,s) => s.stop() } });
  await wrapped('grok','shell-a',{ prompt:'question', layaContext:context() });
  assert.ok(request.prompt.includes('ticket-turn-1')); assert.equal(stopped,0);
  assert.throws(() => wrapped('grok','other',{ prompt:'question',layaContext:context('other') }),/ownership mismatch/);
});

test('main briefing wiring preserves approved note and linked symbol authority; empty note is explicit fallback', async () => {
  let args;
  const event={note:'승인 메모',symbol:'005930',routine_id:'r1',fired_at:'now',observed:'actual observation'};
  const nothing=()=>{};
  mainFunction('runBriefingTurnWired', {
    historyConversationId:()=> 'history',getLiveMcpConfig:()=>({dir:'fixture',configFile:'.mcp.json'}),
    createToolStepTracker:()=>nothing,sendBriefingToolStep:nothing,briefingBackendOverrides:null,
    briefingRunner:{runBriefingTurn:input=>{args=input;}},liveQueryBusyDepth:0,briefingBusy:{},
    sendBriefingTextDelta:nothing,sendBriefingQueryState:nothing,briefingClaudeRunner:null,
    runClaudeQuery:nothing,runGrokQuery:nothing,runIsolatedCodexBriefingQuery:nothing,
    resolveActiveModelSelection:nothing,crypto:{randomUUID:()=> 'turn'},
    runLayaColdQuery:(_run,options)=>options,
  })(event);
  const bound=args.runBoundQuery(nothing,{prompt:'generated instructions'},event);
  assert.equal(bound.layaContext.utterance,event.note);
  assert.equal(bound.layaContext.context.approved_note,event.note);
  assert.equal(bound.layaContext.context.linked_symbols[0],event.symbol);
  assert.equal(bound.allowLayaDirect,false);
  const {routing,calls}=fixture(normal);
  const empty=await routing.createSession().run({prompt:'Existing scheduled default',
    layaContext:{...context(),origin:'briefing',utterance:'',context:{approved_note:''}}},async o=>{
    assert.equal(o.prompt,'Existing scheduled default');return {ok:true};
  });
  assert.equal(calls.length,0); assert.equal(empty.layaRouting.reason,'empty_approved_note');
});

test('actual submit ownership preserves raw utterance across holdings/gold routing rewrites and re-entry', async () => {
  const contexts=new Map(); const input={canvasMode:'shell'}; const runtime={busyDepth:0};
  const originalLine=mainSource.match(/const originalUtterance = [^\n]+/)[0];
  const holdingsLine=mainSource.match(/if \(holdingsRequest\) query = holdingsRequest.question;/)[0];
  const goldLine=mainSource.match(/if \(goldQuote.routeQuery\) query = goldQuote.routeQuery;/)[0];
  const contextStart=mainSource.indexOf('  const layaContext = {');
  const contextCode=mainSource.slice(contextStart,mainSource.indexOf('\n  };',contextStart)+5);
  const nothing=()=>{};
  for(const rewritten of [{holdingsRequest:{question:'보유주식 수익률'},goldQuote:{}},
    {holdingsRequest:null,goldQuote:{routeQuery:'금 현물 현재가'}}]) {
    const run=mainFunction('runLiveQuery',{
      isQuitting:false,backendEndpoint:{getBackendUrl:()=> 'fixture'},
      historySink:{saveChatMessage:()=>({messageId:'m'})},emitHistorySaveFailed:nothing,mdlog:nothing,
      touchConversationEntry:nothing,beginSessionTurn:()=>null,liveRuntimes:{get:()=>runtime},
      liveQueryBusyDepth:0,broadcastLiveQueryBusy:nothing,liveSubmitContexts:contexts,
      activeCardQna:{deleteSubmitContextIfSame:(map,id,expected)=>{assert.equal(map.get(id),expected);map.delete(id);}},
      runLiveQueryInner:async raw=>{
        const submit=contexts.get('conversation');
        assert.notEqual(submit,input);assert.equal(submit.layaOriginalUtterance,raw);
        const result=vm.runInNewContext(`${originalLine}\n${holdingsLine}\n${goldLine}\n${contextCode}\nlayaContext`,{
          buildLayaTurnContext,query:raw,submit,...rewritten,turnConversationId:'conversation',sessionAssistantId:'turn',origin:'shell',activeCardContext:null,liveTurnInput:{today:'20261004'}});
        assert.equal(result.utterance,raw);
        assert.equal(result.context.app_clarified_question,rewritten.holdingsRequest?.question||rewritten.goldQuote.routeQuery);
        // Recursive provider fallback still reads the same original submit authority.
        assert.equal(contexts.get('conversation').layaOriginalUtterance,raw);
        return result;
      },
    });
    await run('그거 보여줘',false,'shell','conversation',input);
    assert.equal(contexts.size,0);assert.equal(runtime.busyDepth,0);
    assert.ok(!Object.hasOwn(input,'layaOriginalUtterance'));
  }
});

test('opt-in runtime rotates actual generation env and registers before supervisor send', async () => {
  const { routing, calls } = fixture(normal);
  const seen = []; let generation = 0;
  class Supervisor {
    constructor(options) { this.options=options; }
    start(desired) { generation++; this.ctx=this.options.generationContextFactory({ desiredState:desired, runtimeGeneration:generation }); seen.push(this.ctx.spawnContext.buildEnv()); }
    rotate(desired) { this.start(desired); }
    ready() { return Promise.resolve(); }
    snapshot() { return { runtimeGeneration:generation }; }
    sendTurn(request) { assert.ok(request.userText.includes('ticket-turn-1')); return Promise.resolve({ ok:true, turnId:'provider-turn' }); }
    stop() {} interrupt() {}
  }
  const controller=createProviderRuntimeController({ persistentEnabled:true, layaRouting:routing,
    requireFn: name => ({ './provider-session-supervisor':{ ProviderSessionSupervisor:Supervisor },
      './provider-event-router':{ createProviderEventRouter:()=>({ route(){} }) },
      './claude-agent-session':{ createClaudeAgentSession(){} }, './proc-utils':{ terminateTree(){} } }[name]) });
  const desired={ provider:'claude',conversationId:'shell-a',configGeneration:1,securityGeneration:1 };
  const capability={ stamp:{ securityGeneration:1 },buildCapabilityEnv:()=>({}) };
  await controller.start(desired,capability);
  await controller.sendTurn({request:{clientSubmitId:'submit',conversationId:'shell-a',origin:'shell',userText:'original'},layaContext:context()});
  assert.equal(calls[0].body.generation_id,seen[0].ATHENA_LAYA_GENERATION_ID);
  await controller.rotate(desired,'test',capability);
  assert.notEqual(seen[0].ATHENA_LAYA_GENERATION_ID,seen[1].ATHENA_LAYA_GENERATION_ID);
  await controller.stop();
});

test('opt-in supervisor events redact each submission ticket before UI/router forwarding', async () => {
  const { routing } = fixture(normal); const forwarded=[], bound=[];
  let supervisor;
  class Supervisor {
    constructor(options) { this.options=options;supervisor=this; }
    start(desired) { this.options.generationContextFactory({desiredState:desired,runtimeGeneration:1}); }
    ready() { return Promise.resolve(); }
    snapshot() { return {runtimeGeneration:1}; }
    sendTurn(request) {
      this.options.onEvent({clientSubmitId:request.clientSubmitId,conversationId:request.conversationId,
        runtimeGeneration:1,turnId:'provider-'+request.clientSubmitId,payload:{input:{_athena_turn_ticket:'ticket-'+request.clientSubmitId},text:'ticket-'+request.clientSubmitId}});
      return Promise.resolve({ok:true,turnId:'provider-'+request.clientSubmitId});
    }
    stop() {}
  }
  const controller=createProviderRuntimeController({persistentEnabled:true,layaRouting:routing,callbacks:{onTurnBound:e=>bound.push(e)},
    requireFn:name=>({'./provider-session-supervisor':{ProviderSessionSupervisor:Supervisor},
      './provider-event-router':{createProviderEventRouter:()=>({route:e=>forwarded.push(e)})},
      './claude-agent-session':{createClaudeAgentSession(){}},'./proc-utils':{terminateTree(){}}}[name])});
  await controller.start({provider:'claude',conversationId:'shell-a',configGeneration:1,securityGeneration:1},
    {stamp:{securityGeneration:1},buildCapabilityEnv:()=>({})});
  for(const id of ['turn-1','turn-2']) await controller.sendTurn({request:{clientSubmitId:id,conversationId:'shell-a',userText:'q'},layaContext:context('shell-a',id)});
  const late={clientSubmitId:'turn-1',conversationId:'shell-a',runtimeGeneration:1,turnId:'provider-turn-1',payload:{text:'ticket-turn-1',input:{_athena_turn_ticket:'ticket-turn-1'}}};
  supervisor.options.onEvent(late);
  supervisor.options.onEvent({...late,conversationId:'wrong'});
  assert.equal(forwarded.length,3); assert.equal(bound.length,2);
  assert.ok(!JSON.stringify([forwarded,bound]).includes('ticket-turn-'));
  assert.ok(!JSON.stringify([forwarded,bound]).includes('_athena_turn_ticket'));
  assert.equal(late.payload.input._athena_turn_ticket,'ticket-turn-1');
  await controller.stop();
});

test('selector fast/cold transport authenticates original semantic authority separately from deterministic routing', async () => {
  for (const selection of [{intent:'auto'}, {intent:'query',preferredRef:'base:ka10081',candidateRefs:['base:ka10081'],arguments:{stk_cd:'005930'}}]) {
    let captured;
    const result=await runSelectorFastPath({question:'삼성전자 일봉 차트',originalQuestion:'@기능 그거 일봉으로',
      semanticContext:{app_clarified_question:'삼성전자 일봉 차트',selected_symbol:'005930'},
      authorization:'Bearer fixture-local-only',backendBase:'http://127.0.0.1:18765',backendAccountAlias:'fixture',...selection,
      fetchImpl:async (_url,options)=>{captured=options;return {ok:true,json:async()=>({status:'ambiguous'})};},
    });
    assert.equal(result.handled,false);
    assert.equal(captured.headers.Authorization,'Bearer fixture-local-only');
    const body=JSON.parse(captured.body);
    assert.equal(body.question,'삼성전자 일봉 차트'); assert.equal(body.original_question,'@기능 그거 일봉으로');
    assert.equal(body.semantic_context.selected_symbol,'005930'); assert.equal(body.intent,selection.intent);
    if(selection.preferredRef){assert.equal(body.preferred_ref,selection.preferredRef);assert.deepEqual(body.arguments,selection.arguments);}
    assert.ok(!Object.hasOwn(body,'lease_id')); assert.ok(!captured.body.includes('fixture-local-only'));
  }
});
