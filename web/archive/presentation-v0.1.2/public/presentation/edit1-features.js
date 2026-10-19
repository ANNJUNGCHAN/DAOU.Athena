/* Homepage footage plus explanatory diagrams. No application/API execution. */
(() => {
 'use strict';
 const scenes=window.ATHENA_SCENES;
 const plans={
  f04:['agora','아고라 · Agora','투자자의 한 문장을, 실제 작업으로',0,37,23000],
  'f04-tool':['agora','TECH 01 · Tool Use','필요한 도구를 좁히고, 검증한 뒤 실행합니다',37,64,18000],
  'f04-result':['metis','메티스 · Metis','관심과 사실을 구분해, 투자 맥락을 기억합니다',0,12,13000],
  'f04-memory':['metis','TECH 02 · Agentic Memory · Graph RAG','기억의 관계에서, 원문 근거까지 되짚습니다',12,30,19000],
  f05:['ergane','에르가네 · Ergane','연결된 도구를, 필요한 권한 안에서',0,9,14000],
  'f05-tool':['ergane','TECH 03 · MCP · 권한 경계','AI의 연결 제안은, 사람의 승인을 거칩니다',9,30,16000],
  'f05-result':['aegis','아이기스 · Aegis','계속 지켜볼 조건을, 대화로 정합니다',0,12,12000],
  'f05-memory':['aegis','TECH 04 · 조건의 구조화','말로 정한 조건을, 프로그램이 반복 확인합니다',12,30,16000],
  f06:['pallas','팔라스 · Pallas','투자 아이디어를, 검증 가능한 전략으로',0,18,18000],
  'f06-tool':['pallas','TECH 05 · 코드 생성 · 계산 엔진','전략은 AI와 만들고, 성과는 엔진으로 계산합니다',18,28.8,19000],
  'f06-result':['glaux','글로우 · Glaux','작은 창에서도, 작업의 맥락은 이어집니다',0,31.8,19000],
  'f06-memory':['glaux','TECH 06 · 통합 워크스페이스','해석·기억·조회·검증이 하나의 작업으로',18,22,16000]
 };
 const montage=[['agora',3,10.5],['metis',22,26],['pallas',24,28.8],['glaux',28,31.8]];
 const tech={
  f04:{kind:'tool',sub:'화면과 문서의 맥락을 더해 질문을 작업으로 바꾸고, 조회 결과를 대화와 화면에 함께 돌려줍니다.',title:'말 → 도구 → 작업 화면',input:'“삼성전자 차트 보여줘”',steps:['요청과 현재 화면의 맥락을 읽습니다','조회 목적에 맞는 도구 후보를 찾습니다','도구·필수 인자를 검증합니다','조회 결과가 대화와 화면으로 돌아옵니다'],value:'화면과 메뉴를 찾는 수고를 줄입니다.',rubric:'고객 가치 · AI 활용 혁신성'},
  'f04-tool':{kind:'tool',sub:'명확한 요청은 규칙으로, 모호한 후보는 제한된 LLM 분류로 처리합니다. 실행 전에는 인자와 스키마를 확인합니다.',title:'선택과 실행을 분리',input:'모호한 분류 경로 · First-valid Hedging',steps:['어휘·요청 유형으로 도구 후보를 줄입니다','모호한 후보에만 제한된 LLM 분류를 씁니다','후보·인자·스키마를 통과한 결과를 채택합니다','선택한 조회 API를 한 번 호출합니다'],value:'AI의 판단을 검증 가능한 도구 호출로 연결합니다.',rubric:'AI 활용 혁신성 · 프로토타입'},
  'f04-result':{kind:'memory',sub:'대화에서 나온 관심과 판단은 출처를 남겨 구조화하고, 체결·잔고 같은 계좌 사실은 별도의 규칙으로 반영합니다.',title:'관심 ≠ 보유 사실',input:'같은 종목, 서로 다른 근거',steps:['대화와 계좌 기록의 입력 경로를 나눕니다','대화는 구조화 추출, 계좌는 규칙으로 반영합니다','직접 발언과 AI의 추론을 구분합니다','관계마다 출처를 남겨 다시 확인합니다'],value:'기억을 쌓아도 관심이 보유 사실로 바뀌지 않습니다.',rubric:'AI 활용 혁신성 · 고객 가치'},
  'f04-memory':{kind:'retrieval',sub:'이름·별칭으로 대상을 찾고, 모호하면 사용자에게 확인합니다. 선택한 관계는 출처와 원문 근거로 이어집니다.',title:'근거를 회수하는 Graph RAG',input:'“이 종목에 관심을 둔 이유는?”',steps:['선택한 노드 ID가 있으면 그 대상을 사용합니다','이름·별칭 후보가 여러 개면 확인을 요청합니다','확정한 대상의 관계와 시점을 찾습니다','출처 ID와 원문을 함께 가져옵니다'],value:'이전 판단을 요약만이 아니라 근거와 함께 돌아봅니다.',rubric:'AI 활용 혁신성 · 프로토타입'},
  f05:{kind:'permission',sub:'시세·기업정보·뉴스를 등록 도구로 연결합니다. 외부 서비스의 범위는 연결 상태·인증·허용 기능에 따릅니다.',title:'등록 도구의 실행 계약',input:'MCP · 연결된 기능과 권한',steps:['도구별로 가능한 기능을 등록합니다','별칭과 입력 스키마로 호출 대상을 정합니다','인증·연결 상태와 허용 기능을 확인합니다','허용된 조회의 결과를 작업 공간으로 보냅니다'],value:'새 정보원을 같은 작업 흐름에서 활용합니다.',rubric:'프로토타입 · 고객 가치'},
  'f05-tool':{kind:'permission',sub:'연결 설정과 허용 기능은 사람이 검토합니다. AI의 제안만으로 권한이 바뀌거나 도구가 활성화되지는 않습니다.',title:'제안 → 검토 → 승인',input:'연결 설정은 승인 전까지 초안',steps:['AI가 필요한 연결 설정을 제안합니다','사람이 허용 기능과 범위를 검토합니다','승인되지 않은 변경은 적용하지 않습니다','승인된 범위와 인증 상태 안에서 사용합니다'],value:'확장 가능한 도구 연결에 사람의 통제권을 남깁니다.',rubric:'AI 활용 혁신성 · 프로토타입'},
  'f05-result':{kind:'monitor',sub:'알림과 반복 작업의 대상·조건·주기를 대화로 정하고, 연결된 데이터에서 필요한 변화를 살펴봅니다.',title:'요청을 실행 가능한 조건으로',input:'“이 조건이 되면 알려줘”',steps:['사용자가 지켜볼 대상과 조건을 말합니다','AI가 대상·조건·주기·쿨다운을 정리합니다','프로그램이 연결된 관측값을 비교합니다','조건에 맞는 변화와 실행 이력을 전달합니다'],value:'매번 화면을 열어 확인하는 수고를 덜어줍니다.',rubric:'고객 가치 · AI 활용 혁신성'},
  'f05-memory':{kind:'monitor',sub:'AI는 요청을 조건으로 구조화하고, 반복 비교는 프로그램이 맡습니다. 쿨다운과 이력으로 중복과 실행 이유를 관리합니다.',title:'해석은 AI, 비교는 프로그램',input:'관측 대상 + 조건 + 주기 + 쿨다운',steps:['자연어 요청을 구조화된 조건으로 바꿉니다','관측값을 정해진 조건과 비교합니다','조건을 만족해도 쿨다운 중이면 재알림을 보류합니다','언제 무엇을 확인했는지 이력을 남깁니다'],value:'반복 감시를 매번의 AI 판단에 의존하지 않습니다.',rubric:'AI 활용 혁신성 · 프로토타입'},
  f06:{kind:'strategy',sub:'부족한 조건을 확인하고 전략 초안을 작성합니다. 특정 노드를 대화로 고친 뒤 과거 데이터에서 결과를 살펴봅니다.',title:'아이디어 → 전략 → 검증',input:'“이 조건으로 전략을 만들어줘”',steps:['빠진 진입·청산 조건을 확인합니다','AI가 전략 초안과 코드를 만듭니다','노드 단위로 수정할 지점을 정합니다','계산 엔진의 결과로 전략을 검토합니다'],value:'코딩의 진입 장벽을 낮추고 판단은 투자자에게 남깁니다.',rubric:'고객 가치 · AI 활용 혁신성'},
  'f06-tool':{kind:'backtest',sub:'종가 신호는 다음 봉 시가에 체결한다고 가정합니다. 비용을 반영한 같은 조건에서 거래와 낙폭을 비교합니다.',title:'신호와 체결 시점을 분리',input:'설명용 계산 흐름 · 성과 수치 아님',steps:['현재 봉이 닫힌 뒤 신호를 판단합니다','다음 봉 시가에 체결한다고 가정합니다','수수료·세금·슬리피지를 반영합니다','거래 내역과 낙폭을 같은 가정으로 비교합니다'],value:'생성된 설명과 계산된 성과를 구분해 검토합니다.',rubric:'AI 활용 혁신성 · 프로토타입'},
  'f06-result':{kind:'delivery',sub:'감시 이벤트와 대화 상태를 작은 창으로 이어줍니다. 주문 내용은 검토용으로 준비하며, 최종 실행은 사용자가 합니다.',title:'작은 창에 이어지는 작업',input:'이벤트 → 미니 대화 → 작업 확인',steps:['감시 이벤트나 작업 결과를 받습니다','관련 맥락을 미니 대화로 이어갑니다','도구의 조회 결과와 근거를 보여줍니다','주문은 사용자가 내용을 확인하고 실행합니다'],value:'다른 작업 중에도 필요한 순간에 대화를 이어갑니다.',rubric:'고객 가치 · 프로토타입'},
  'f06-memory':{kind:'workspace',sub:'Tool Use·Agentic Memory·근거 검색을 투자 작업에 연결합니다. AI, 코드, 사람이 맡는 역할과 책임을 분리합니다.',title:'기술이 하나의 작업을 완성',input:'Tool Use · Agentic Memory · Graph RAG',steps:['AI가 말과 화면의 맥락을 해석합니다','기억과 원문 근거를 찾아 작업에 연결합니다','도구와 코드가 조회·조건 비교·계산을 맡습니다','결과와 근거를 보고 사람이 최종 판단합니다'],value:'핵심 루프의 실제 동작은 이어지는 앱 시연에서 확인합니다.',rubric:'AI 활용 혁신성 · 프로토타입'}
 };
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const txt=(x,y,label,cls='')=>'<text x="'+x+'" y="'+y+'" class="'+cls+'">'+esc(label)+'</text>';
 const edge=(x1,y1,x2,y2,phase)=>'<path class="et-edge" data-phase="'+phase+'" d="M'+x1+' '+y1+'L'+x2+' '+y2+'" marker-end="url(#et-arrow)"/>';
 const box=(x,y,w,h,title,sub,phase,extra='')=>'<g class="et-node '+extra+'" data-phase="'+phase+'"><rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="16"/>'+txt(x+w/2,y+(sub?32:h/2+8),title,'et-node-title')+(sub?txt(x+w/2,y+62,sub,'et-node-sub'):'')+'</g>';
 const flow=(top,left,right,middle,bottom,human=false)=>box(30,15,560,78,...top,0)+edge(310,93,160,120,1)+edge(310,93,460,120,1)+box(25,127,270,80,...left,1)+box(325,127,270,80,...right,1)+edge(160,207,250,240,2)+edge(460,207,370,240,2)+box(80,247,460,83,...middle,2,human?'et-human':'')+edge(310,330,310,358,3)+box(30,365,560,64,bottom,'',3);
 function diagram(kind){
  let s='';
  if(kind==='tool')s=flow(['투자 요청','화면·문서의 맥락'],['명확한 요청','규칙으로 결정'],['모호한 후보','제한된 LLM 분류'],['후보 · 인자 · 스키마 검증','분류 경쟁 시 먼저 검증된 결과 채택'],'조회 API 1회 → 답변 + 화면');
  if(kind==='memory')s=box(25,15,270,88,'대화에서 나온 관심','“배당이 궁금하다”',0)+box(325,15,270,88,'체결·잔고 기록','별도 입력 경로',0)+edge(160,103,160,130,1)+edge(460,103,460,130,1)+box(25,137,270,80,'LLM 구조화 추출','직접 발언 / 추론 구분',1)+box(325,137,270,80,'결정적 규칙','확인된 계좌 사실',1)+edge(160,217,250,248,2)+edge(460,217,370,248,2)+box(80,254,460,74,'주체 — 관계 — 대상','',2)+edge(310,328,310,358,3)+box(30,365,560,64,'출처 · 시점 · 원문과 함께 저장','',3);
  if(kind==='retrieval')s=flow(['선택한 ID / 이름 · 별칭',''],['대상이 하나','관계 조회로'],['후보가 여러 개','사용자 확인 후 진행'],['대상 — 관계 — 근거',''],'출처 ID + 원문 발췌');
  if(kind==='permission')s=flow(['연결 설정 제안','아직 적용되지 않은 초안'],['도구의 입력 계약','별칭 · 스키마'],['사용자가 허용할 범위','기능 · 권한'],['사람의 검토 · 승인','제안만으로 권한 변경 없음'],'인증·연결 상태 안에서 사용',true);
  if(kind==='monitor')s=flow(['AI가 요청을 구조화','대상 · 조건 · 주기 · 쿨다운'],['연결된 관측값','시세 · 뉴스 · 이벤트'],['프로그램 조건 비교','관측값 ↔ 설정 조건'],['조건 충족 + 쿨다운 확인','중복 재알림은 보류'],'알림 + 실행 이력');
  if(kind==='strategy')s=box(30,15,560,77,'진입 · 청산 · 기간 조건','빠진 내용은 대화로 확인',0)+edge(310,92,310,120,1)+box(30,127,560,80,'AI가 전략·코드 초안 생성','',1)+edge(310,207,160,239,2)+edge(310,207,460,239,2)+box(25,246,270,83,'진입 노드','선택한 단계 수정',2)+box(325,246,270,83,'청산 노드','조건을 함께 검토',2)+edge(160,329,250,357,3)+edge(460,329,370,357,3)+box(30,365,560,64,'계산 엔진으로 과거 데이터 검증','',3);
  if(kind==='backtest')s='<g class="et-node et-candle" data-phase="0"><path d="M145 65V204"/><rect x="115" y="98" width="60" height="76" rx="5"/>'+txt(145,40,'현재 봉','et-node-title')+txt(145,240,'종가 → 신호','et-node-title')+'</g><g class="et-node et-candle" data-phase="1"><path d="M475 65V204"/><rect x="445" y="78" width="60" height="94" rx="5"/>'+txt(475,40,'다음 봉','et-node-title')+txt(475,240,'시가 → 체결 가정','et-node-title')+'</g>'+edge(195,141,425,141,1)+txt(310,122,'시간 순서','et-node-sub')+box(30,280,560,67,'수수료 + 세금 + 슬리피지','',2)+edge(310,347,310,372,3)+box(30,378,560,56,'거래 내역 · 자산 변화 · 낙폭','',3);
  if(kind==='delivery')s=box(30,15,560,77,'감시 이벤트 · 작업 결과','아이기스와 작업 공간',0)+edge(310,92,310,120,1)+box(30,127,560,80,'관련 맥락과 대화를 전달','미니 대화로 이어가기',1)+edge(310,207,310,239,2)+box(30,246,560,83,'연결된 도구의 결과 확인','카드 · 차트 · 알림',2)+edge(310,329,310,358,3)+box(30,365,560,64,'주문 내용 검토 → 사용자가 실행','',3,'et-human');
  if(kind==='workspace')s=box(30,15,560,77,'AI · 요청과 맥락 해석','Tool Use',0)+edge(310,92,310,120,1)+box(30,127,560,80,'기억 + 원문 근거 검색','Agentic Memory · Graph RAG',1)+edge(310,207,310,239,2)+box(30,246,560,83,'도구 · 코드의 실행','조회 · 조건 비교 · 성과 계산',2)+edge(310,329,310,358,3)+box(30,365,560,64,'사람의 최종 판단 · 주문 실행','',3,'et-human');
  return '<svg class="et-diagram" viewBox="0 0 620 450" role="img" aria-label="'+esc(kind)+' 처리 흐름"><defs><marker id="et-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs>'+s+'</svg>';
 }
 function render(id){
  const [feature,name,title]=plans[id],t=tech[id];
  return '<section class="cp-scene e1-features" data-feature-cue="'+id+'"><header class="e1-feature-heading"><h1>'+esc(title)+'</h1><p>'+esc(t.sub)+'</p></header><div class="et-panel-label et-demo-label"><span>'+esc(name)+'</span><small>홈페이지 기능 시연</small></div><div class="et-panel-label et-tech-label"><span>어떻게 동작하나요?</span><small>기술 원리 애니메이션</small></div><div class="e1-feature-window"><iframe src="assets/edit1-features/index.html" title="'+esc(name)+' · 홈페이지 설명용 시연" tabindex="-1"></iframe><div class="e1-feature-progress"></div></div><aside class="et-technology" aria-label="'+esc(t.title)+'"><h2>'+esc(t.title)+'</h2><div class="et-input">'+esc(t.input)+'</div>'+diagram(t.kind)+'<div class="et-step"><span class="et-step-index">01 / 04</span><p>'+esc(t.steps[0])+'</p></div></aside><div class="et-takeaway"><span>'+esc(t.rubric)+'</span><p>'+esc(t.value)+'</p></div><footer class="e1-feature-foot"><span class="e1-feature-beat">홈페이지 시연 준비 중</span><span>설명용 시연·기술 모식도 · 실시간 실행 추적 아님'+(feature==='pallas'?' · 과거 결과는 미래 성과를 보장하지 않음':'')+(feature==='glaux'?' · 주문 전송 없음':'')+'</span></footer></section>';
 }
 function phaseAt(p){return Math.min(3,Math.floor(Math.max(0,Math.min(1,p))*4));}
 function clipAt(id,progress){
  const p=Math.max(0,Math.min(1,progress)),plan=plans[id];
  if(id!=='f06-memory')return {feature:plan[0],time:plan[3]+(plan[4]-plan[3])*p};
  const phase=phaseAt(p),[feature,from,to]=montage[phase],local=p===1?1:p*4-phase;
  return {feature,time:from+(to-from)*local};
 }
 async function play(id,root,api){
  const duration=plans[id][5],frame=root.querySelector('iframe'),bar=root.querySelector('.e1-feature-progress'),beat=root.querySelector('.e1-feature-beat');
  const stage=root.querySelector('.e1-features'),nodes=[...root.querySelectorAll('[data-phase]')],caption=root.querySelector('.et-step p'),counter=root.querySelector('.et-step-index');
  const startLoad=performance.now();
  while(!frame.contentWindow?.ATHENA_FEATURE_FRAME){
   if(api.signal.aborted)return;
   if(performance.now()-startLoad>15000){beat.textContent='시연을 불러오지 못했습니다. R 키로 다시 재생해 주세요.';throw new Error('ATHENA feature walkthrough did not load');}
   await new Promise(resolve=>setTimeout(resolve,30));
  }
  if(api.signal.aborted)return;
  let previousPhase=-1;
  const paint=(wide,p)=>{
   if(api.signal.aborted)return;
   const sample=clipAt(id,p);
   beat.textContent=frame.contentWindow.ATHENA_FEATURE_FRAME.paint(sample.feature,sample.time,id==='f06-memory'?true:wide);
   bar.style.transform='scaleX('+p+')';stage.dataset.sourceTime=sample.time.toFixed(2);stage.dataset.sourceFeature=sample.feature;stage.dataset.motion=p===1?'hold':'play';
   const phase=phaseAt(p);
   if(phase===previousPhase)return;
   previousPhase=phase;stage.dataset.techPhase=String(phase);
   for(const node of nodes){const n=Number(node.dataset.phase);node.classList.toggle('is-reached',n<=phase);node.classList.toggle('is-current',n===phase);}
   caption.textContent=tech[id].steps[phase];counter.textContent='0'+(phase+1)+' / 04';
  };
  if(api.reduced){paint(true,1);return;}
  const started=performance.now();
  while(!api.signal.aborted){
   const p=Math.min(1,(performance.now()-started)/duration);
   const clamp=n=>Math.max(0,Math.min(1,n)),ease=n=>n*n*(3-2*n);
   const context=Math.max(1-ease(clamp((p-.045)/.075)),ease(clamp((p-.86)/.10)));
   paint(context,p);
   if(p===1)break;
   await api.wait(50);
  }
 }
 for(const id of Object.keys(plans))scenes[id]={title:plans[id][2],render:()=>render(id),play:(r,a)=>play(id,r,a),duration:plans[id][5],continuity:true,ownHeader:true};
 window.ATHENA_FEATURE_REUSE={source:'ATHENA-Web 6e4e9bd',plans,tech,phaseAt,clipAt,montage};
})();
