(() => {
 'use strict';
 const wrap=(body,note='',light=false)=>`<section class="biz ${light?'light':''}">${body}<p class="biz-note">${note}</p></section>`;
 const head=(label,title)=>`<div data-reveal><div class="biz-kicker">${label}</div><h1>${title}</h1></div>`;
 const content=[
 ()=>wrap(`${head('BUSINESS · 확장 제안','투자 작업에서,<br>지속 가능한 사업으로')}<div class="biz-orbit" data-reveal></div><div class="biz-intro" data-reveal>두 가지 수익 축.<br>세 단계의 검증.</div>`,'사업 검토안 · 가격과 매출 전망 미확정'),
 ()=>wrap(`${head('REVENUE','서로 다른 두 수익 축')}<div class="biz-columns"><div class="biz-column" data-reveal><div class="biz-tag">키움증권</div><h2>연결 계좌<br>거래 수수료</h2><p>신규·재활성 고객의 기여와<br>기존 채널 이동을 구분합니다.</p></div><div class="biz-column" data-reveal><div class="biz-tag">ATHENA</div><h2>프리미엄 기능 구독</h2><p>향후 관리형 AI 사용료 검토</p><p class="biz-small">외부 AI 공급자 직접 결제는 ATHENA 매출 제외</p></div></div>`,'수익 구조 제안 · 가격·포함량·번들 구성 미확정'),
 ()=>wrap(`${head('PHASE 01','먼저 쓰고, 깊게 검증하도록')}<div class="biz-split"><div data-reveal><div class="biz-big biz-em">무료</div><p>기본 앱으로 가볍게 시작</p><div class="biz-budget">잠정 한도 제안<br>알림 5개 · MCP 연결 10개</div></div><div class="biz-column" data-reveal><div class="biz-tag">유료 기능 제안</div><h2>팔라스<br>백테스트</h2><p>반복되는 전략 검증을 구독 가치로</p></div></div>`,'한도 단위·기능 소속, 구독 가격·포함 실행량·AI 비용 부담 주체 미정',true),
 ()=>wrap(`${head('PHASE 02','낮은 단가보다,<br>성공한 작업의 원가')}<div class="biz-columns"><div class="biz-column" data-reveal><div class="biz-tag">정형 요청</div><h2>판단·선택 모델<br>+ 준비된 도구</h2><p>Jev 검토: 도구와 허용 인자 선택 보조</p></div><div class="biz-column" data-reveal><div class="biz-tag">자유 설명 · 새 코드</div><h2>생성 모델</h2><p>한국어 품질 · 재시도 · 지연<br>전체 비용을 함께 검증</p></div></div>`,'Jev는 자유 문장·코드 생성 모델이 아님 · ATHENA 적용 성과 및 비용 절감 미검증'),
 ()=>wrap(`${head('PHASE 03','데이터에서<br>투자 도구 전문성으로')}<div class="biz-path"><div class="biz-step" data-reveal><div class="biz-tag">01</div><strong>허용 데이터</strong><small>동의 · 비식별 · 이용 조건<br>약 1년은 제안 목표 기간</small></div><div class="biz-step" data-reveal><div class="biz-tag">02</div><strong>특화 모델</strong><small>투자·MCP 도구 호출<br>미세조정과 기반 모델 개발 구분</small></div><div class="biz-step" data-reveal><div class="biz-tag">03</div><strong>그룹 인프라</strong><small>설치 공간 · GPU · 모델 운영<br>각각의 공급 범위와 비용 검토</small></div></div>`,'데이터·성능 확보 보장 아님 · 다우 GPU 임대 미확인 · Jev 자체 호스팅을 전제하지 않음'),
 ()=>wrap(`${head('VALIDATION','확장 전에 확인할 네 가지')}<div class="biz-metrics"><div class="biz-metric" data-reveal><b>첫 작업 성공</b><span>요청이 실제 작업 완료로 이어지는가</span></div><div class="biz-metric" data-reveal><b>반복 사용</b><span>다시 찾을 만큼 유용한가</span></div><div class="biz-metric" data-reveal><b>유료 전환 · 유지</b><span>팔라스의 검증 가치가 지속되는가</span></div><div class="biz-metric" data-reveal><b>비용을 뺀 지속 가능성</b><span>AI · GPU · 데이터 · 운영 비용 반영</span></div></div>`,'검증 지표 제안 · 신규·재활성 고객과 기존 채널 이동 구분 · 실적 수치 없음'),
 ()=>`<section class="biz light biz-close"><img data-reveal class="biz-logo" src="assets/brand/athena.png" alt="ATHENA"><h1 data-reveal>투자자의 말이 작업으로.<br>반복할 가치가 있는 서비스로.</h1><div class="biz-rule" data-reveal></div><p data-reveal>무료 진입 · 기능 구독 · 품질과 비용 검증 · 투자 도구 전문성</p></section>`
 ];
 window.ATHENA_SCENES ||= {};
 window.ATHENA_BUSINESS_DATA.forEach((data,i)=>{
  window.ATHENA_SCENES[data.id]={title:data.title,duration:2400,render:content[i],play:async(root,api)=>{
   const elements=[...root.querySelectorAll('[data-reveal]')];
   if(api.reduced){elements.forEach(e=>e.style.opacity='1');return;}
   await Promise.all(elements.map((el,j)=>api.animate(el,[{opacity:0,translate:'0 36px'},{opacity:1,translate:'0 0'}],{duration:1000,delay:j*300,easing:'cubic-bezier(.22,.7,.2,1)',fill:'both'})));
  }};
 });
})();
