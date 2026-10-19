(() => {
  'use strict';
  const ESC = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cursor = '<i class="act-cursor" aria-hidden="true"></i>';
  const stage = (title,body,source,extra='') => `<section class="act-stage ${extra}"><h1 class="act-heading">${title}</h1>${body}<div class="act-source">${source}</div>${cursor}</section>`;
  function check(api){if(api.signal.aborted)throw new DOMException('Cancelled','AbortError');}
  const q=(root,s)=>root.querySelector(s);
  async function fx(api,el,frames,duration=600,extra={}){check(api);await api.animate(el,frames,{duration,easing:'cubic-bezier(.25,.1,.25,1)',fill:'forwards',...extra});check(api);const last=frames[frames.length-1];for(const k of ['opacity','transform','filter','clipPath'])if(last[k]!==undefined)el.style[k]=last[k];}
  const show=(api,el,d=500)=>fx(api,el,[{opacity:0,transform:'translateY(15px)'},{opacity:1,transform:'translateY(0px)'}],d);
  const move=(root,api,x,y,d=450)=>{const el=q(root,'.act-cursor');return fx(api,el,[{transform:el.style.transform||'translate(180px, 500px)'},{transform:`translate(${x}px, ${y}px)`}],d);};
  const wait=async(api,ms)=>{check(api);await api.wait(ms);check(api);};
  const hideCursor=root=>q(root,'.act-cursor').style.opacity='0';
  function chart(){
    let grid='',bars='',candles='',points=[];
    for(let i=0;i<6;i++){let y=45+i*78;grid+=`<line class="grid" x1="70" y1="${y}" x2="1500" y2="${y}"/>`;}
    for(let i=0;i<50;i++){
      const x=88+i*27.5, center=335-i*4.3+Math.sin(i*.53)*37+Math.cos(i*1.4)*12;
      const rising=i%5!==1&&i%7!==0, h=12+(i*13)%31, color=rising?'#df647b':'#7396cb';
      candles+=`<line x1="${x}" y1="${center-h-13}" x2="${x}" y2="${center+h+14}" stroke="${color}" stroke-width="2"/><rect x="${x-7}" y="${center-h/2}" width="14" height="${h}" fill="${color}"/>`;
      const v=34+(i*23)%80+(i>34?32:0);bars+=`<rect x="${x-8}" y="${615-v}" width="16" height="${v}" fill="${color}" opacity=".65"/>`;points.push(`${x},${center+24}`);
    }
    return `<svg class="act-chart" viewBox="0 0 1560 660" aria-label="합성 가격 및 거래량 차트">${grid}<text x="70" y="25">가격 · 합성 시계열</text>${candles}<polyline class="act-indicator" points="${points.join(' ')}" fill="none" stroke="#0e20b2" stroke-width="3" opacity="0"/><line class="grid" x1="70" y1="465" x2="1500" y2="465"/><text x="70" y="497">거래량</text>${bars}<text x="75" y="648">시간</text><text x="1390" y="648">최근 구간</text></svg>`;
  }
  const scenes={
    s16:{title:'차트와 투자 시점',duration:5200,render:()=>stage('차트에서 투자 시점을 찾습니다',`<div class="act-window act-real-chart"><div class="act-toolbar"><b>영웅문4 HTS · 키움종합차트</b><span class="act-chip act-period">기간</span><span class="act-chip act-indicator-button">가격 · 거래량</span></div><div class="act-chart-wrap"><img class="act-real-chart-image" src="assets/actions/kiwoom-hero4-chart.gif" alt="키움 공식 영웅문4 도움말 차트, 2023년 6월 28일 예시"><div class="act-price-focus"></div></div><div class="act-chart-label price">가격의 움직임</div><div class="act-chart-label volume">거래량</div></div>`,'<a href="https://download.kiwoom.com/hero4_help_new/0600.htm" target="_blank" rel="noopener">키움 공식 도움말 [0600]</a> · 영웅문4 HTS, WTS 아님 · 과거 화면 확대 연출, 현재 시세 아님'),play:async(root,api)=>{
      const end=()=>{q(root,'.act-chart-wrap').style.transform='scale(1.08)';root.querySelectorAll('.act-chart-label,.act-price-focus').forEach(e=>e.style.opacity='1');hideCursor(root);};if(api.reduced){end();return;}
      await move(root,api,1420,223,650);q(root,'.act-period').classList.add('selected');await wait(api,350);await move(root,api,1600,223,450);q(root,'.act-indicator-button').classList.add('selected');await wait(api,550);await move(root,api,1220,450,650);await Promise.all([fx(api,q(root,'.act-chart-wrap'),[{transform:'scale(1)'},{transform:'scale(1.08)'}],900),show(api,q(root,'.act-price-focus'),900),show(api,q(root,'.price'),650)]);await move(root,api,1220,800,550);await show(api,q(root,'.volume'),550);await wait(api,550);end();}},
    s17:{title:'뉴스와 공시',duration:5800,render:()=>stage('숫자 너머의 정보를 찾습니다',`<div class="act-news-grid act-verified-news"><div class="act-news-pane"><div class="act-news-brand">SK hynix Newsroom</div><div class="act-search act-news-query"></div><div class="act-results"><div class="act-result">2025년 경영실적 발표<small>SK하이닉스 공식 보도자료 · 2026.01.28</small></div><img class="act-doc-proof" src="assets/actions/sk-hynix-news-20260128.png" alt="실제 뉴스룸 기사 화면"></div><article class="act-article act-news-article"><div class="act-doc-meta">SK하이닉스 · 2026.01.28 · 공식 보도자료</div><h2>SK하이닉스, 2025년 경영실적 발표</h2><div class="act-highlight">AI 메모리와 고부가 제품 확대가<br>연간 실적 성장에 기여</div><p class="act-doc-summary">회사는 HBM 경쟁력과 고부가 제품 비중 확대를 실적 성장의 배경으로 설명했습니다.</p><a class="act-doc-link" href="https://news.skhynix.co.kr/2025-business-results/" target="_blank" rel="noopener">뉴스룸 원문 확인 ↗</a><img class="act-doc-proof" src="assets/actions/sk-hynix-news-20260128.png" alt="뉴스룸 원문 캡처"></article></div><div class="act-news-pane act-dart act-hidden"><div class="act-news-brand">DART · 전자공시</div><div class="act-search">SK하이닉스 · 2026.01.28</div><div class="act-results"><div class="act-result">매출액 또는 손익구조 변경<small>대규모법인 15% 이상 변경 공시</small></div></div><article class="act-article act-dart-article"><div class="act-doc-meta">SK하이닉스 · 2026.01.28 · 연결 기준</div><h2>매출액 또는 손익구조<br>30%(대규모법인 15%) 이상 변경</h2><div class="act-highlight">2025년 매출 전년 대비 +46.8%<br>영업이익 전년 대비 +101.2%</div><p class="act-doc-summary">메모리 수요 증가를 실적 개선의 원인으로 제시했습니다.</p><p class="act-doc-note">외부감사 전 잠정실적 · 감사 결과에 따라 변경 가능</p><a class="act-doc-link" href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260128800679" target="_blank" rel="noopener">DART 공시 원문 확인 ↗</a><img class="act-doc-proof" src="assets/actions/dart-proof-crop.png" alt="실제 DART 공시 원문 캡처"></article></div></div>`,'2026.01.28 실제 보도자료·공시 검증 요약 · 원문 캡처 포함 · 검색·확대는 발표용 연출, 서비스 원본 UI 재현 아님'),play:async(root,api)=>{
      const end=()=>{q(root,'.act-news-query').textContent='SK하이닉스 2025년 실적';root.querySelectorAll('.act-article,.act-dart').forEach(e=>e.style.opacity='1');hideCursor(root);};if(api.reduced){end();return;}await move(root,api,370,300,400);await api.type(q(root,'.act-news-query'),'SK하이닉스 2025년 실적',550);check(api);await move(root,api,380,420,450);await show(api,q(root,'.act-news-article'),650);await wait(api,450);await show(api,q(root,'.act-dart'),650);await move(root,api,1250,420,550);await show(api,q(root,'.act-dart-article'),700);await wait(api,1400);end();}},
    s18:{title:'경험과 투자 기록',duration:5100,render:()=>stage('판단이 나만의 기록으로 쌓입니다',`<div class="act-file"><div class="act-file-icon">W</div>투자 노트</div><div class="act-note"><h2>투자 노트</h2><div class="act-note-date">09.20 · 합성 시연자료</div><div class="act-note-row"><strong>판단 근거</strong><span>가격과 거래량의 변화,<br>뉴스와 공시를 함께 살펴봤다.</span></div><div class="act-note-row"><strong>예상</strong><span>조건이 유지되는지 더 확인한다.</span></div><div class="act-note-row act-note-result"><strong>실제 결과</strong><span>예상과 달랐던 점을 기록하고<br>다음 판단에 참고한다.</span></div></div><div class="act-history"><div>09.06 · 판단 기록</div><div>09.13 · 판단 기록</div><div>09.20 · 현재 노트</div></div>`,'가상 데스크톱 · 합성 투자 기록 · 실제 투자 성과 아님','act-desktop'),play:async(root,api)=>{
      const end=()=>{q(root,'.act-note').style.opacity='1';q(root,'.act-note').style.transform='translateX(-120px)';q(root,'.act-history').style.opacity='1';hideCursor(root);};if(api.reduced){end();return;}await move(root,api,210,315,500);await show(api,q(root,'.act-note'),650);await move(root,api,685,405,550);await wait(api,350);await move(root,api,720,705,650);await fx(api,q(root,'.act-note-result'),[{backgroundColor:'#fff'},{backgroundColor:'#eef0f4'}],500);await Promise.all([fx(api,q(root,'.act-note'),[{transform:'translateX(0px)'},{transform:'translateX(-120px)'}],850),show(api,q(root,'.act-history'),850)]);await wait(api,1050);end();}},
    s19:{title:'가격 알림과 대응 판단',duration:6000,render:()=>stage('필요한 순간에 알림을 받습니다',`<div class="act-phone"><img src="assets/actions/toss-price-alert-off.png" alt="사용자 제공 토스 SK하이닉스 가격 알림 설정, 모든 스위치 OFF"><div class="act-toggle-on" aria-label="플러스 1퍼센트 알림 ON 재현"></div></div><div class="act-alert-copy"><div class="eyebrow">SK하이닉스 · 가격 알림</div><h2>설정한 가격에<br>도달하면</h2><div class="act-time">시간 경과 · 시연<div class="act-time-line"></div></div><div class="act-price-arrive">1,868,000원 도달</div></div><div class="act-push"><small>푸시 예시 · 실제 알림 이미지 미확보</small><h3>설정한 가격에 도달했어요</h3><p>SK하이닉스 · 1,868,000원</p></div>`,'설정 화면: 사용자 제공 원본 · ON 상태/가격 도달/푸시는 재현 · 실제 설정·주문 없음','act-dark'),play:async(root,api)=>{
      const end=()=>{root.querySelectorAll('.act-toggle-on,.act-time,.act-price-arrive,.act-push').forEach(e=>e.style.opacity='1');q(root,'.act-time-line').style.transform='scaleX(1)';hideCursor(root);};if(api.reduced){end();return;}await move(root,api,647,496,650);await show(api,q(root,'.act-toggle-on'),350);await wait(api,400);await show(api,q(root,'.act-time'),400);await fx(api,q(root,'.act-time-line'),[{transform:'scaleX(0)'},{transform:'scaleX(1)'}],1100,{easing:'linear'});await show(api,q(root,'.act-price-arrive'),700);await show(api,q(root,'.act-push'),650);await move(root,api,1630,830,650);await wait(api,1100);end();}},
    s20:{title:'전략 조건과 검증',duration:5500,render:()=>stage('원칙을 만들고 검증하며 다듬습니다',`<div class="act-window act-editor"><div class="act-toolbar"><b>전략 조건 · 시연용 편집기</b><span class="act-soft">실행하지 않은 예시</span></div><pre class="act-code"><span class="muted"># 조건을 명시하고 검증한다</span>\n<span class="pink">def</span> <span class="blue">check_condition</span>(price, threshold):\n    <span class="act-code-typed"></span></pre><div class="act-backtest"><h2>백테스트 결과 확인</h2><div class="act-backtest-status">미실행 · 결과 화면의 레이아웃 예시</div><div class="act-result-grid"><div class="act-result-empty"><span>성과 추이</span><em>실행 결과 없음</em><span class="act-soft">수익률과 성과 그래프를 생성하지 않았습니다</span></div><div class="act-result-list"><div>검증 기간<span>미설정</span></div><div>입력 데이터<span>미확보</span></div><div>수익률<span>—</span></div><div>실행 상태<span>미실행</span></div></div></div></div></div>`,'전략 작성·결과 확인 흐름의 예시 · 코드/백테스트 미실행 · 성과 수치 없음'),play:async(root,api)=>{
      const text='return price >= threshold';const end=()=>settleS20(root);if(api.reduced){end();return;}await move(root,api,470,413,600);await api.type(q(root,'.act-code-typed'),text,1500);check(api);await wait(api,450);await move(root,api,1480,223,500);await show(api,q(root,'.act-backtest'),950);await move(root,api,1330,642,600);await wait(api,900);end();}}
  };
  // Shared final state: the next scene can reuse this exact full-stage surface.
  function settleS20(root) {
    q(root,'.act-code-typed').textContent='return price >= threshold';
    Object.assign(q(root,'.act-backtest').style,{opacity:'1',transform:'translateY(0px)'});
    Object.assign(q(root,'.act-cursor').style,{opacity:'0',transform:'translate(1330px, 642px)'});
  }
  function renderS20Final() {
    const template=document.createElement('template');
    template.innerHTML=scenes.s20.render();
    settleS20(template.content);
    return template.innerHTML;
  }
  window.ATHENA_ACTIONS=Object.freeze({
    renderS20Final,
    settleS20,
    logicalSize:Object.freeze({width:1920,height:1080}),
    backtestPanelRect:Object.freeze({x:112,y:180,width:1696,height:780}),
  });
  window.ATHENA_SCENES ||= {};
  Object.assign(window.ATHENA_SCENES,scenes);
})();
