/* B01–B07 reference-based business sequence. No narration or cue changes.
 * Reference roles: F02 single evidence; F06a thin paths; F12 conditional stages;
 * F14 differently proportioned surfaces. Source assets retain their own colours.
 */
(() => {
  'use strict';
  const scenes = window.ATHENA_SCENES ||= {};
  const brand = '<img class="cb-brand" data-business-anchor="athena" src="assets/brand/athena.png" alt="ATHENA">';
  const head = (number,title,sub) => `<header class="cb-head"><span>BUSINESS · ${number}</span><h1>${title}</h1><p>${sub}</p></header>`;
  const wrap = (id,title,sub,body,note) => `<section class="cb-root cb-${id}">${brand}${head(id.slice(1),title,sub)}${body}<footer class="cb-foot"><span>사업화 제안</span><p>${note}</p></footer></section>`;
  const arrow = '<span class="cb-arrow" aria-hidden="true">→</span>';
  const scene = (id,title,render,duration=1600) => {
    scenes[id] = {title,duration,render,play:async(root,api)=>{
      if(api.signal.aborted || api.reduced) return;
      // The anchor never fades: identical coordinates preserve it across root replacement.
      const items=[...root.querySelectorAll('[data-cb-enter]')];
      await Promise.all(items.map((el,i)=>api.animate(el,[{opacity:el.hasAttribute('data-cb-evidence')?1:.65,translate:'0 16px'},{opacity:1,translate:'0 0'}],{duration:850,delay:Math.min(i,4)*150,easing:'cubic-bezier(.22,.7,.2,1)',fill:'both'})));
    }};
  };

  scene('b01','고객의 활용 확대와 새로운 진입점',()=>wrap('b01','고객의 활용을 넓히고,<br>새로운 진입점을 만듭니다.','완성한 투자 작업이 다음 사용으로 이어지는지 검증합니다.',`
    <div class="cb-customer-work" data-cb-enter>
      <div class="cb-customer-line"><span>기존 키움 고객</span><h2>조사 · 기록 · 감시를<br>다시 활용하도록</h2></div>
      <div class="cb-work-surface"><img src="assets/continuity/agora.png" alt="ATHENA 홈페이지의 리더와 차트 기능 설명 예시"><div>ATHENA · 같은 작업 공간</div></div>
      <div class="cb-customer-line cb-customer-new"><span>새로운 고객</span><h2>첫 투자 작업을<br>완성할 수 있도록</h2></div>
      <p class="cb-work-caption">홈페이지 기능 설명 예시 · 실제 고객 성과 아님</p>
    </div>
    <aside class="cb-demand" data-cb-enter data-cb-evidence>
      <span class="cb-demand-owner">토스증권 · AI 어닝콜</span><p class="cb-demand-period">출시 2주</p><div class="cb-demand-value">20만<span>명 이상</span></div><p class="cb-demand-unit">서비스 이용</p>
      <div class="cb-demand-limit">기능 이용 수치입니다.<br>AI로 인한 신규 계좌 증가 수치가 아닙니다.</div>
      <a href="https://toss.tech/article/toss-securities-earnings-call" target="_blank" rel="noopener noreferrer">토스 공식 기술 블로그 · 2025.06.27 ↗</a>
    </aside>`, '일반 투자자 대상 · 고객 증가 약속이 아닌 작업 완성과 반복 사용의 검증'));

  scene('b02','서로 다른 두 수익 축',()=>wrap('b02','수익은 두 축입니다.','거래의 기여와 기능의 대가를 나눠 확인합니다.',`
    <div class="cb-revenue-origin" data-cb-enter><span>고객의 투자 작업</span><strong>ATHENA</strong><small>개념 경로 · 거래·결제 실행 화면 아님</small></div>
    <div class="cb-revenue-track cb-revenue-kiwoom" data-cb-enter><div class="cb-track-from"><small>연결 계좌</small><b>거래</b></div>${arrow}<div class="cb-track-to"><small>수익 주체</small><h2>키움증권</h2><p>거래 수수료</p></div></div>
    <div class="cb-revenue-track cb-revenue-athena" data-cb-enter><div class="cb-track-from"><small>팔라스 등</small><b>프리미엄 기능</b></div>${arrow}<div class="cb-track-to"><small>수익 주체</small><h2>ATHENA</h2><p>기능 구독 · 향후 관리형 AI 검토</p></div></div>
    <div class="cb-revenue-check" data-cb-enter>신규 · 재활성 고객의 기여 <span>≠</span> 기존 HTS 채널 이동</div>
    <div class="cb-external-cost" data-cb-enter><span>사용자의 외부 AI 직접 결제</span>${arrow}<b>외부 공급자</b><em>ATHENA 매출 제외</em></div>`, '가격·포함량 미정 · 무료 고객의 AI·감시·지원 원가도 계산'));

  scene('b03','무료 진입에서 깊은 검증으로',()=>wrap('b03','먼저 쓰고,<br>더 깊게 검증하도록','기본 앱은 무료로, 반복 전략 검증은 유료 기능 후보로 검토합니다.',`
    <div class="cb-free" data-cb-enter><span>기본 앱</span><strong>무료</strong><p>정보 확인 · 판단 기록 · 변화 관찰</p><div class="cb-free-limits"><b>초기 한도 후보</b><span>알림 <em>5</em>개 · MCP 연결 <em>10</em>개</span><small>한도 단위·포함 사용량 미정</small></div></div>
    <figure class="cb-pallas-evidence" data-cb-enter><figcaption><span>유료 기능 후보</span><h2>팔라스 · 반복 전략 검증</h2></figcaption><img src="assets/revision/demo/equity-curve.svg" alt="기존 Python 예시가 합성 데이터로 계산한 평가액 곡선"><p>기존 Python 실행 예시 · 합성 데이터<br>실제 투자 성과 또는 팔라스 실앱 실행 증거가 아닙니다.</p></figure>
    <div class="cb-depth-bridge" data-cb-enter><span>일상적인 이용</span>${arrow}<span>더 깊은 검증의 필요</span></div>`, '가격·포함 실행량·전환율은 파일럿 검증 · 무료 앱이 외부 AI 비용의 무제한 제공을 뜻하지 않음'));

  scene('b04','성공한 작업의 원가',()=>wrap('b04','낮은 호출 단가보다,<br>성공한 작업의 원가','정형 선택과 자유로운 생성을 나누고 전체 비용을 검증합니다.',`
    <div class="cb-request" data-cb-enter><span>사용자 요청</span><strong>의도와 작업 구분</strong><small>개념 구조 · 실제 실행 결과 아님</small></div>
    <svg class="cb-request-paths" viewBox="0 0 1700 520" aria-hidden="true"><path d="M340 245 H530 V110 H720"/><path d="M530 245 V390 H720"/><path d="M1330 110 H1550 V250"/><path d="M1280 390 H1550 V270"/></svg>
    <article class="cb-choice-surface" data-cb-enter><div class="cb-surface-label">정형 요청</div><h2>도구와 허용 인자 선택</h2><div class="cb-tool-pills"><span>준비된 도구</span><span>허용 인자</span></div><p><b>JEV</b> · 선택 보조 API 후보</p><small>자유 설명 전체 대체 · 자체 호스팅 전제 없음</small></article>
    <article class="cb-generation-surface" data-cb-enter><div class="cb-surface-label">자유 설명 · 새 코드</div><h2>생성 모델</h2><p>해석과 생성이 필요한 요청</p></article>
    <aside class="cb-cost-ledger" data-cb-enter><span>성공 작업 원가</span><strong>품질 + 비용</strong><p>한국어 · 모호한 입력</p><p>재시도 · 응답 지연</p><p>운영비</p></aside>`, 'JEV 적용 성과·원가 절감 미입증 · 품질 유지 범위에서 관리형 AI 제공 검토'));

  scene('b05','투자 업무와 도구 호출의 전문성',()=>wrap('b05','투자 업무와 도구 호출에<br>특화하는 계획입니다.','허용된 자료와 평가 사례를 쌓고, 검증 뒤 운영 조건을 확인합니다.',`
    <div class="cb-horizon" data-cb-enter><strong>약 1년</strong><span>자료·평가 사례 축적 목표<br>모델 완성 시한이 아닙니다.</span></div>
    <div class="cb-development-field">
      <article class="cb-data-sheet" data-cb-enter><div class="cb-surface-label">입력 조건</div><h2>허용된 자료</h2><div class="cb-record-example"><span>요청 · 도구 · 결과</span><i></i><i></i><i></i><small>자료 구조 예시 · 실제 수집 기록 아님</small></div><p>학습 동의 · 비식별 · 이용 조건</p></article>
      <span class="cb-stage-arrow cb-stage-arrow-a" aria-hidden="true">→</span>
      <article class="cb-evaluation-plane" data-cb-enter><div class="cb-surface-label">모델 검토</div><h2>평가 사례<br>미세조정 검토</h2><div class="cb-eval-structure"><span>투자 업무</span><span>도구 호출</span><b>품질 평가</b></div><p>JEV와 별개 기반 모델 선정<br>기초모델 신규 개발과 구분</p></article>
      <span class="cb-stage-arrow cb-stage-arrow-b" aria-hidden="true">→</span>
      <article class="cb-operations-plane" data-cb-enter><div class="cb-surface-label">검증 후 협의</div><h2>운영 후보</h2><p><b>다우기술</b><br>데이터센터 · 클라우드</p><p><b>다우데이타</b><br>외부 자원 공급 경로</p><small>GPU · 추론 서비스 미확보</small></article>
    </div>`, '계획·협력 후보 · 공급 조건·운영 책임·유휴 GPU를 포함한 비용 확인 후 확장'));

  scene('b06','확장 전에 검증할 가치',()=>wrap('b06','다시 사용할 이유를<br>증명하겠습니다.','같은 조사 과제를 비교하고, 반복 사용과 사업성을 확인합니다.',`
    <div class="cb-pilot" data-cb-enter><span>제한된 파일럿 제안</span><h2>같은 조사 과제</h2><div class="cb-pilot-comparison"><span>기존 방식</span><b>↔</b><span>ATHENA</span></div><p>기존 키움 고객 · 관심 투자자</p></div>
    <div class="cb-validation-path"><div data-cb-enter><b>작업 완성</b><span>성공률 · 완료 시간</span></div><div data-cb-enter><b>다음 주 재사용</b><span>다시 찾는가</span></div><div data-cb-enter><b>유료 전환 · 유지</b><span>팔라스의 반복 가치</span></div><div data-cb-enter><b>지속 가능성</b><span>고객당 원가 · 연결계좌 순증 기여</span></div></div>
    <p class="cb-closing-anchor" data-cb-enter>투자자의 말이 작업으로.<br><span>반복할 가치가 있는 서비스로.</span></p>`, '검증 지표 제안 · 실측 값 없음 · 채널 이동과 순증 기여 구분'));

  // Existing last click and existing closing words, with the same mark moving home.
  scenes.b07={title:scenes.b07?.title||'ATHENA',duration:1600,render:()=>`<section class="cb-root cb-close"><img class="cb-close-brand" data-business-anchor="athena" src="assets/brand/athena.png" alt="ATHENA"><h1>투자자의 말이 작업으로.<br>반복할 가치가 있는 서비스로.</h1><div class="cb-close-rule"></div><p>무료 진입 · 기능 구독 · 품질과 비용 검증 · 투자 도구 전문성</p></section>`,play:async(root,api)=>{
    if(api.signal.aborted||api.reduced)return;
    await Promise.all([api.animate(root.querySelector('.cb-close-brand'),[{transform:'translate(945px,-200px) scale(.364)'},{transform:'translate(0,0) scale(1)'}],{duration:1200,easing:'cubic-bezier(.22,.7,.2,1)',fill:'both'}),...[...root.querySelectorAll('h1,.cb-close-rule,p')].map((el,i)=>api.animate(el,[{opacity:0,translate:'0 12px'},{opacity:1,translate:'0 0'}],{duration:650,delay:600+i*150,fill:'both'}))]);
  }};
})();
