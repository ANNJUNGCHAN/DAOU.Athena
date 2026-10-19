(() => {
 'use strict';
 const scenes=window.ATHENA_SCENES ||= {};
 const disclaimer='기능 설명·소스 확인 / 실제 실행 검증 별도';
 const wrap=(body,label=disclaimer,kind='')=>`<section class="cp-scene ${kind}">${body}<div class="cp-disclaimer">${label}</div></section>`;
 const title=(n,t)=>`<header class="cp-head"><span>${n}</span><h1>${t}</h1></header>`;
 const chat=(text,detail='질문 → 필요한 도구 → 결과와 근거')=>`<div class="cp-chat" data-cp><img class="cp-app-screen" src="assets/continuity/agora.png" alt="ATHENA 홈페이지의 아고라 설명 화면"><div class="cp-chat-brand">ATHENA</div><p>${text}</p><div class="cp-input"><span>${detail}</span><i></i></div></div>`;
 const lines=(entries)=>entries.map(([name,meaning])=>`<p class="cp-feature-line"><b>${name}</b><span>${meaning}</span></p>`).join('');
 const end=(a,b)=>`<div class="cp-responsibility" data-cp><span><b>AI</b>${a}</span><span><b>도구·코드</b>${b}</span></div>`;
 const play=async(root,api)=>{
  // Individual translate preserves the reference panel's CSS perspective/rotateY.
  const show=(el,delay=0,duration=700)=>api.animate(el,[{opacity:0,translate:api.reduced?'0 0':'0 22px'},{opacity:1,translate:'0 0'}],{duration:api.reduced?1:duration,delay:api.reduced?0:delay,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'});
  const chatEl=root.querySelector('.cp-chat');
  if(!chatEl){await Promise.all([...root.querySelectorAll('[data-cp]')].map((el,i)=>show(el,i*190,850)));return;}
  const image=chatEl.querySelector('img').getAttribute('src');
  let schedule;
  if(image.includes('ergane')){
   // Proposal -> human review -> observed condition -> auditable history.
   schedule=[['.cp-chat',0],['.cp-left',450],['.cp-process',1200],['.cp-right',1850],['.cp-observation',2400],['.cp-evidence',3000],['.cp-responsibility',3600]];
  }else if(image.includes('pallas')){
   // Strategy conditions -> cost/price assumptions -> desktop continuation.
   schedule=[['.cp-chat',0],['.cp-left',550],['.cp-evidence',1450],['.cp-responsibility',2200],['.cp-right',2900],['.cp-mini',3500]];
  }else{
   // A question stays at the center as tools, source memory and its boundary appear.
   schedule=[['.cp-chat',0],['.cp-left',850],['.cp-right',1800],['.cp-evidence',2750],['.cp-responsibility',3500]];
  }
  schedule.push(['.cp-tool-network',650]);
  await Promise.all(schedule.map(([selector,delay])=>show(root.querySelector(selector),delay)));
 };
 function register(id,name,render){scenes[id]={title:name,duration:id.startsWith('f')?4300:1900,render:()=>{let html=render();const labels={f04:['04 ·','F01 ·'],f05:['05 ·','F02 ·'],f06:['06 ·','F03 ·'],d07:['07 ·','D01 ·'],d08:['08 ·','D02 ·'],d09:['09 ·','D03 ·'],d10:['10 ·','D04 ·'],b01:['11 ·','B01 ·']};if(labels[id])html=html.replace(...labels[id]);if(id==='f05')html=html.replace('assets/continuity/agora.png','assets/continuity/ergane.png').replace('아고라 설명 화면','에르가네 설명 화면');if(id==='f06')html=html.replace('assets/continuity/agora.png','assets/continuity/pallas.png').replace('아고라 설명 화면','팔라스 설명 화면');if(id.startsWith('f')){const headline={f04:['질문에서 기억으로','필요한 도구와 출처가 같은 작업에 이어집니다.'],f05:['연결에서 관측으로','제안을 검토하고, 조건과 관측값을 확인합니다.'],f06:['원칙에서 검증으로','계산의 가정을 확인하고, 작은 창에서 이어갑니다.']}[id];html=html.replace(/<h1>[\s\S]*?<\/h1>/,`<h1>${headline[0]}</h1><p class="cp-head-sub">${headline[1]}</p>`);html=html.replace(disclaimer,disclaimer+' · 홈페이지 원본 설명 화면');const nodes={f04:['질문','허용 도구 조회','작업 화면','출처가 있는 기억','이전 판단 검색'],f05:['연결 제안','설정·권한 검토','승인된 도구','관측값 비교','쿨다운·이력'],f06:['투자 원칙','조건 구체화','비용·체결 가정','계산·결과 검토','작은 창의 대화']}[id];html=html.replace('<div class="cp-evidence"',`<div class="cp-tool-network" data-cp><div class="cp-network-plane">${nodes.map((n,i)=>`<div class="cp-network-node cp-node-${i} ${i===2?'cp-node-selected':''}"><span>${n}</span></div>`).join('')}<div class="cp-network-rail cp-rail-a"></div><div class="cp-network-rail cp-rail-b"></div><div class="cp-network-rail cp-rail-c"></div><div class="cp-network-rail cp-rail-d"></div></div></div><div class="cp-evidence"`);}return html;},play};}
 register('f04','아고라와 메티스: 질문에서 근거 있는 기억으로',()=>wrap(`${title('04 · AGORA / METIS','질문은 작업으로,<br>판단은 출처가 있는 기억으로')}${chat('이 자료를 보고, 이전 판단의 근거를 함께 살펴봐 줘.')}<div class="cp-left cp-module" data-cp><h2>아고라 <small>Agora</small></h2>${lines([['화면 호출','필요한 차트와 자료 열기'],['화면 대화','보고 있는 항목을 짚어 질문'],['자료 대화','첨부 문서·폴더 함께 보기'],['대화 설정','목표·계획·모델·사고 정도'],['대화주문','종목·수량·가격 준비']])}<em>최종 주문 실행은 사용자</em></div><div class="cp-right cp-module" data-cp><h2>메티스 <small>Metis</small></h2>${lines([['활동 기억','관심과 판단 기록'],['지식 대화','이전에 관심을 가진 이유'],['맞춤 추천','자료·비교 대상·다음 질문'],['클러스터','관련 기록 묶기'],['기억 수정','잘못 이해한 내용 바로잡기']])}<em>직접 말한 내용 · 추론 · 원문 출처</em></div><div class="cp-evidence" data-cp><span>관심 있다</span><strong>≠</strong><span>보유했다</span><small>체결·잔고는 별도 규칙으로 반영</small></div>${end('말의 의미·관심·판단 구조화','허용된 조회 · 이름·별칭·관계·근거 검색')}`));
 register('f05','에르가네와 아이기스: 연결한 정보를 반복 작업으로',()=>wrap(`${title('05 · ERGANE / AEGIS','연결한 정보를,<br>계속 확인할 조건으로')}${chat('필요한 정보를 연결하고, 관심 조건을 계속 확인해 줘.')}<div class="cp-left cp-module" data-cp><h2>에르가네 <small>Ergane</small></h2>${lines([['투자정보 연동','시세·기업정보·뉴스 도구'],['도구 호출','@ 등록 서버 지정'],['서비스 연동','디스코드·텔레그램·슬랙 등']])}<em>메신저 접점은 확장 방향</em><div class="cp-process"><span>연결 제안</span><b>사람의 설정·권한 검토</b><span>승인 후 적용</span></div></div><div class="cp-right cp-module" data-cp><h2>아이기스 <small>Aegis</small></h2>${lines([['맞춤 알람','관심·이전 판단에 맞는 변화'],['대화형 자동화','장 마감 정리 등 반복 작업'],['통합 감시','키움 REST API · 연결한 MCP']])}<div class="cp-observation"><span>조건</span><strong>관측값과 비교</strong><span>쿨다운 · 실행 이력</span></div></div><div class="cp-evidence" data-cp><span>무엇을 맡겼는가</span><strong>·</strong><span>어떤 값이 바뀌었는가</span><small>연결 도구의 기능·인증·권한 범위에서 실행</small></div>${end('연결 제안 · 요청을 조건으로 구체화','관측값 비교 · 반복 알림 조절 · 이력')}`));
 register('f06','팔라스와 글로우: 검증하고 일상에서 이어갑니다',()=>wrap(`${title('06 · PALLAS / GLAUX','생각을 검증 가능한 규칙으로,<br>결과를 일상의 대화로')}${chat('이 투자 원칙을 검토하고, 결과와 근거를 이어서 보여줘.')}<div class="cp-left cp-module" data-cp><h2>팔라스 <small>Pallas</small></h2>${lines([['바이브코딩','빠진 조건을 확인하며 전략 작성'],['노드 대화','특정 전략 단계를 짚어 수정'],['백테스트','과거 데이터에서 규칙 실행'],['투자 진단','손실 구간·거래 검토'],['조건 탐색','설정에 따른 결과 비교']])}<em>기간 · 수수료 · 세금 · 슬리피지</em></div><div class="cp-right cp-module" data-cp><h2>글로우 <small>Glaux</small></h2>${lines([['미니 대화','작은 창의 질문과 핵심 카드'],['능동 알림','소식·작업 결과에서 대화 계속']])}<div class="cp-mini"><b>ATHENA</b><p>작업 결과와 근거를<br>이어서 확인합니다.</p><span>감시 이벤트 · 대화 진행 상태</span></div><em>주문 준비 이후 최종 실행은 사용자</em></div><div class="cp-evidence" data-cp><span>종가에서 신호 확정</span><strong>→</strong><span>다음 봉 시가 체결 가정</span><small>동일한 데이터·비용 가정에서 결과와 낙폭·거래 내역 검토</small></div>${end('해석 · 기억 구조화 · 조건 구체화','조회 · 비교 · 성과 계산')}`));
 const guide=(num,heading,focus,sub,footer)=>wrap(`${title(num,heading)}<div class="cp-demo-focus" data-cp><span class="cp-demo-label">${focus}</span><p>${sub}</p></div><div class="cp-demo-foot" data-cp>${footer}</div>`,'검증된 기록 재현 · 실제 열리는 범위만 확인','cp-demo');
 register('d07','최신 이슈: 기존 RSS 실행 기록 확인',()=>guide('07 · 실제 앱','다우키움그룹 이슈의<br>기존 조회 기록을 확인합니다.','invest-fetch · 공개 Bing 뉴스 RSS','준비 과정에서 확인한 실행 기록 · 제목과 링크가 담긴 카드<br>네이버 검색 도구는 아직 연결되지 않았습니다.','과거 실행 기록 재현 · 새 조회 성공이나 전체 기사 본문 검증을 뜻하지 않습니다.'));
 register('d08','메티스: 기존 삼성전자 기록',()=>guide('08 · 실제 앱','이미 남아 있는<br>기록을 살펴봅니다.','메티스 · 삼성전자','선택한 삼성전자 기록과 연결된 근거<br>실제로 열리는 상세와 근거만 확인','이번 뉴스 요청이 만든 기억이 아닙니다.'));
 register('d09','원문 확인과 다음 작업',()=>guide('09 · 기능 설명으로 연결','날짜와 원문을 확인하는 흐름,<br>다음 작업을 살펴봅니다.','기사 날짜 · 원문 → 조건 · 규칙','준비 중 확인한 카드 시각과 원문의 차이<br>아이기스: 조건·이력 · 팔라스: 기간·비용 가정','기능 설명 예시 · 뉴스 요청의 자동 실행 결과가 아닙니다.'));
 register('d10','시연에서 사업화로',()=>wrap(`${title('10 · 9:40–10:00','알고 싶은 것부터 말하고,<br>근거를 보며 다음 작업을 선택합니다.')}<div class="cp-demo-focus" data-cp><div class="cp-return-brand">ATHENA</div><p>이 경험을 고객에게 어떻게 제공하고 확장할까요?</p></div>`,'10:00 사업화 제안으로 전환','cp-demo'));
 register('b01','고객의 활용 확대와 새로운 진입점',()=>wrap(`${title('11 · 사업화 제안','고객의 활용을 넓히고,<br>새로운 진입점을 만듭니다.')}<div class="cp-customer cp-customer-left" data-cp><span>기존 키움 고객</span><h2>조사 · 기록 · 감시를<br>다시 활용하도록</h2></div><div class="cp-customer cp-customer-right" data-cp><span>새로운 고객</span><h2>첫 투자 작업을<br>완성할 수 있도록</h2></div><div class="cp-customer-center" data-cp><b>ATHENA</b><span>완성한 작업 · 다음 주 재사용</span></div><div class="cp-business-evidence" data-cp><div><span>토스증권 AI 어닝콜</span><strong>2주 · 20만 명 이상</strong><small>공식 공개 기능 이용 수치 · AI로 인한 신규 계좌 증가 수치 아님</small></div><a href="https://toss.tech/article/toss-securities-earnings-call" target="_blank" rel="noopener noreferrer">토스 공식 기술 블로그 ↗</a></div>`,'사업화 제안 · 고객 유입을 약속하기보다 작업 완성과 반복 사용부터 검증','cp-business'));
 // Four presenter-controlled stages per feature pair. Each call settles without advancing.
 const stages={
  f04:[
   {name:'질문과 작업 화면',asset:'agora',node:0,rail:'a',prompt:'보고 있는 항목을 짚어 질문합니다.',heading:'아고라 · 질문의 맥락',items:[['화면 호출','차트와 자료 열기'],['화면 대화','현재 항목을 짚어 질문'],['자료 대화','첨부 문서·폴더 함께 보기'],['대화 설정','목표·계획·모델'],['대화주문','주문 준비 · 최종 실행은 사용자']],ai:'말의 의미와 필요한 작업 해석',code:'허용된 화면·자료 연결'},
   {name:'허용 도구와 결과 화면',asset:'agora',node:1,rail:'b',prompt:'필요한 조회는 허용된 도구가 맡습니다.',heading:'아고라 · 도구와 사용자',items:[['도구 조회','허용된 도구가 조회'],['결과 반환','답변과 화면으로 연결']],ai:'필요한 도구와 요청 의도 해석',code:'허용된 조회 · 결과 반환'},
   {name:'출처가 있는 기억',asset:'metis',node:3,rail:'c',prompt:'관심과 판단을 출처와 함께 남깁니다.',heading:'메티스 · 맥락 구조화',items:[['활동 기억','관심·판단과 출처 기록'],['직접 말한 내용','추론과 구분'],['체결·잔고','별도 규칙으로 반영']],ai:'관심과 판단을 구조화',code:'출처 저장 · 체결·잔고 규칙'},
   {name:'이전 판단과 근거 검색',asset:'metis',node:4,rail:'d',prompt:'이전에 왜 관심을 가졌는지 다시 묻습니다.',heading:'메티스 · 근거로 돌아가기',items:[['지식 대화','이전 판단을 다시 질문'],['맞춤 추천','자료·비교 대상·다음 질문'],['클러스터','관련 기록 묶기'],['기억 수정','잘못 이해한 내용 바로잡기']],ai:'질문의 맥락과 기억 해석',code:'이름·별칭·관계·원문 근거 검색'}
  ],
  f05:[
   {name:'연결 제안',asset:'ergane',node:0,rail:'a',prompt:'필요한 외부 정보와 도구를 제안합니다.',heading:'에르가네 · 제안',items:[['투자정보 연동','시세·기업정보·뉴스 도구'],['도구 호출','별칭으로 등록 도구 지정'],['서비스 연동','메신저 접점은 확장 방향'],['제공 범위','기능·인증·권한에 따라 결정']],ai:'연결 제안 작성',code:'현재 설정·도구 범위 확인'},
   {name:'사람의 권한 검토',asset:'ergane',node:1,rail:'b',prompt:'설정과 허용 기능을 사람이 확인합니다.',heading:'에르가네 · 검토와 적용',items:[['설정·권한','사람이 확인한 뒤 승인'],['연결 제안','즉시 권한 변경과 구분']],ai:'제안의 의도와 설정 설명',code:'승인된 설정과 도구 적용'},
   {name:'조건과 관측값 비교',asset:'aegis',node:3,rail:'c',prompt:'요청을 계속 확인할 조건으로 구체화합니다.',heading:'아이기스 · 조건',items:[['맞춤 알람','관심과 이전 판단에 맞는 변화'],['대화형 자동화','장 마감 정리 등 반복 작업'],['통합 감시','키움 REST API · 연결 MCP']],ai:'요청을 실행 조건으로 구체화',code:'관측값과 조건 비교'},
   {name:'쿨다운과 실행 이력',asset:'aegis',node:4,rail:'d',prompt:'무엇을 맡겼고 어떤 값이 바뀌었는지 확인합니다.',heading:'아이기스 · 확인 가능한 이력',items:[['쿨다운','반복 알림 줄이기'],['실행 이력','조건과 관측값 확인'],['자료의 범위','연결된 데이터와 권한']],ai:'조건의 의미와 맥락 설명',code:'쿨다운 · 이력 기록'}
  ],
  f06:[
   {name:'원칙과 빠진 조건',asset:'pallas',node:0,rail:'a',prompt:'투자 아이디어의 빠진 조건을 확인합니다.',heading:'팔라스 · 원칙',items:[['바이브코딩','설명에서 전략 작성'],['조건 확인','규칙을 검증 가능하게 구체화']],ai:'의도 해석 · 빠진 조건 질문',code:'전략 구조와 입력 연결'},
   {name:'특정 전략 단계 수정',asset:'pallas',node:1,rail:'b',prompt:'전략의 특정 단계를 짚어 고칩니다.',heading:'팔라스 · 노드 대화',items:[['노드 대화','특정 전략 단계 선택·수정'],['조건 탐색','설정 변경에 따른 결과 비교']],ai:'수정 의도와 조건 해석',code:'지정한 전략 단계 반영'},
   {name:'가정과 계산 결과 검토',asset:'pallas',node:3,rail:'c',prompt:'같은 데이터와 비용 가정에서 결과를 검토합니다.',heading:'팔라스 · 계산의 가정',items:[['백테스트','과거 데이터에서 규칙 실행'],['체결 가정','종가 신호 → 다음 봉 시가'],['비용','수수료 · 세금 · 슬리피지'],['투자 진단','손실 구간·낙폭·거래 내역']],ai:'조건과 검토 맥락 설명',code:'가격·비용·성과 계산'},
   {name:'작은 창에서 대화 계속',asset:'agora',node:4,rail:'d',prompt:'작은 창에서 소식과 작업 결과를 확인합니다.',heading:'글로우 · 일상의 접점',items:[['미니 대화','질문과 핵심 카드'],['능동 알림','소식·작업 결과에서 대화 계속'],['상태 전달','감시 이벤트·대화 진행'],['최종 주문','사용자가 직접 실행']],ai:'해석 · 기억 구조화',code:'조회 · 비교 · 계산 · 상태 전달'}
  ]
 };
 // Keep each click aligned to the corresponding one of the four source paragraphs.
 stages.f04[2]={...stages.f04[2],name:'메티스의 기억 활용',items:[['활동 기억','관심과 판단 기록'],['지식 대화','이전 관심의 이유 질문'],['맞춤 추천','자료·비교 대상·다음 질문'],['클러스터','관련 기록 묶기'],['기억 수정','잘못 이해한 내용 바로잡기']]};
 stages.f04[3]={...stages.f04[3],name:'기억의 출처와 사실 구분',prompt:'관심 표현을 보유 사실로 바꾸지 않습니다.',items:[['직접 말한 내용','추론과 구분'],['이름·별칭','관계와 원문 근거 검색'],['체결·잔고','별도 규칙으로 반영'],['관심 ≠ 보유','출처와 사실 구분']]};
 const pallasFeatures=stages.f06[0],pallasEngine=stages.f06[2],glaux=stages.f06[3];
 stages.f06=[
  {...pallasFeatures,items:[['바이브코딩','빠진 조건을 확인하며 전략 작성'],['노드 대화','특정 전략 단계 수정'],['백테스트','과거 데이터에서 규칙 실행'],['투자 진단','손실 구간·거래 검토'],['조건 탐색','설정 변경 결과 비교']]},
  {...pallasEngine,node:2,rail:'b'},
  {...glaux,node:4,rail:'d'},
  {name:'AI와 도구의 역할',asset:'agora',node:3,rail:'c',prompt:'결과와 근거를 같은 작업 공간에서 확인합니다.',heading:'같은 작업 공간으로',items:[['AI','말의 해석 · 기억 구조화'],['도구·코드','조회 · 조건 비교 · 성과 계산'],['결과·근거','같은 작업 공간에서 확인']],ai:'해석 · 기억 구조화',code:'조회 · 비교 · 성과 계산'}
 ];
 // Focus layouts follow the source reference: enlarged source UI, foreground status,
 // and long paths with small touchpoints. Each click exposes only its paragraph.
 const focusLayouts={f04:['agora','agora-query','metis','metis-source'],f05:['ergane','permissions','aegis','history'],f06:['pallas','engine','glaux','synthesis']};
 const contextLabels={f04:['질문에서 시작','허용된 조회','아고라에서 시작한 질문','기억의 출처 확인'],f05:['연결을 제안','사람의 검토','승인 범위에서 관측','조건에서 실행 이력으로'],f06:['원칙을 구체화','계산 가정 확인','작은 창으로 이어서','같은 작업 공간']};
 const focusNodes={f04:['질문','허용 도구','작업 화면','출처 기억','근거 검색'],f05:['연결 제안','권한 검토','승인 범위','조건 비교','실행 이력'],f06:['투자 원칙','조건','비용 가정','계산 검토','작은 창']};
 const paths=['M20 45 H130 V155 H345','M130 155 H565 V270 H970','M345 155 V420 H790 V550 H980','M20 550 H180 V420 H345'];
 for(const [base,steps] of Object.entries(stages)){
  steps.forEach((step,i)=>{
   const id=base+['','-tool','-result','-memory'][i],mode=focusLayouts[base][i];
   scenes[id]={title:step.name,duration:1000,render:()=>{
    const headline={f04:'질문에서 기억으로',f05:'연결에서 관측으로',f06:'원칙에서 검증으로'}[base];
    const layout=mode==='glaux'?'glaux':['metis','metis-source','permissions','history','engine','synthesis'].includes(mode)?'focus':'overview';
    const sourceLabel=mode==='agora-query'?'홈페이지 리더·차트 예시 · 허용 도구/주문 실행을 검증한 화면 아님':mode==='metis-source'?'홈페이지 관계 지도 예시 · 직접 발언/추론 분리 화면은 아님':mode==='engine'?'계산 가정 설명 · 실제 실행 화면이나 계산 결과가 아닙니다':mode==='glaux'?'Glaux · 기능 설명 예시 / 실제 실행 결과 아님':`${step.asset.toUpperCase()} · 홈페이지 원본 설명 화면의 관련 영역 확대`;
    const hero=mode==='engine'?'<div class="cp-assumptions"><span>계산 가정 · 설명</span><h3>같은 조건에서 비교합니다.</h3><p>종가에서 신호 확정 <b>→</b> 다음 봉 시가 체결 가정</p><div>기간 · 수수료 · 세금 · 슬리피지</div><small>성과 · 낙폭 · 거래 내역을 같은 가정으로 검토</small></div>':mode==='glaux'?`<div class="cp-focus-mini"><div class="cp-focus-mini-bar">ATHENA <span>Glaux</span></div><p>작업 결과와 근거를<br>이어서 확인합니다.</p><div class="cp-focus-mini-input">이 결과에서 더 살펴볼 것은?</div><small>기능 설명 예시 · 실제 알림 수신 아님</small></div>`:`<div class="cp-focus-crop"><img class="cp-app-screen" src="assets/continuity/${step.asset}.png" alt="${sourceLabel}"></div>`;
    return `<section class="cp-scene cp-step-scene cp-focus-scene cp-focus-${mode} cp-layout-${layout}" data-feature-step="${id}"><header class="cp-head"><span>${{f04:'F01 · AGORA / METIS',f05:'F02 · ERGANE / AEGIS',f06:'F03 · PALLAS / GLAUX'}[base]}</span><h1>${headline}</h1><p class="cp-head-sub">${step.name}</p></header><div class="cp-focus-pathfield" aria-label="현재 기능의 도구 연결"><svg viewBox="0 0 1000 600" aria-hidden="true">${paths.map((d,j)=>`<path class="${j===['a','b','c','d'].indexOf(step.rail)?'cp-focus-path-active':''}" d="${d}"/>`).join('')}</svg>${focusNodes[base].map((n,j)=>`<span class="cp-focus-pill cp-focus-pill-${j} ${j===step.node?'cp-focus-pill-active':''}">${n}</span>`).join('')}</div><figure class="cp-focus-hero">${hero}<figcaption>${sourceLabel}</figcaption></figure><div class="cp-focus-context">${contextLabels[base][i]}</div><aside class="cp-right cp-module"><div class="cp-stage-count">기능 설명 · ${i+1} / 4</div><h2>${step.heading}</h2>${lines(step.items)}<p class="cp-focus-prompt">${step.prompt}</p></aside>${end(step.ai,step.code)}<div class="cp-disclaimer">${disclaimer}</div></section>`;
   },play:async(root,api)=>{
    await Promise.all(['.cp-focus-hero','.cp-focus-pill-active','.cp-right','.cp-responsibility'].map((sel,j)=>api.animate(root.querySelector(sel),[{opacity:.3,translate:api.reduced?'0 0':'0 10px'},{opacity:1,translate:'0 0'}],{duration:api.reduced?1:650,delay:api.reduced?0:j*90,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'})));
   }};
  });
 }
})();
