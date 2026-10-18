/* Approved visual redesign: broker evidence hierarchy + connected CS workload.
 * Read-only source assets; no narration, cue ordering or media playback changes.
 */
(() => {
 'use strict';
 const scenes=window.ATHENA_SCENES,alive=a=>!a.signal.aborted;
 const head=(title,sub)=>`<header class="e2-head"><h1>${title}</h1><p>${sub}</p></header>`;
 const documents=[
  ['개발자센터','assets/revision/docs/kis-developer-home-existing.png'],
  ['공식 GitHub','assets/revision/docs/kis-github.png'],
  ['Trading MCP','assets/revision/docs/kis-mcp.png'],
  ['Open API','assets/revision/docs/toss-service.png'],
  ['인증과 호출','assets/review-toss/openapi/auth.png'],
  ['실시간 구독','assets/review-toss/openapi/connection.png']
 ];
 const doc=(d,i)=>`<figure class="e2-document e2-document-${i}"><figcaption><span>${String(i%3+1).padStart(2,'0')}</span><b>${d[0]}</b></figcaption><div class="e2-document-image"><img src="${d[1]}" alt="${d[0]} 공식 공개 화면"></div></figure>`;
 scenes['s07-kis']={title:'여러 증권사도 Claude Code를 향해',duration:2700,
  render:()=>`<section class="e2-brokers">${head('여러 증권사도 Claude Code를 향해','하지만, Claude Code와의 연결이 일반 투자자에게도 더 편리한 투자 경험으로 이어질까요?')}<div class="e2-broker-lanes"><section class="e2-broker-lane"><div class="e2-brand-rail"><img class="e2-kis-mark" src="assets/edit1-opening/kis-logo-official.png" alt="한국투자증권 공식 로고"><span>개발자센터에서 Trading MCP까지</span></div><div class="e2-document-grid">${documents.slice(0,3).map(doc).join('')}</div></section><section class="e2-broker-lane"><div class="e2-brand-rail"><img class="e2-toss-mark" src="assets/edit1-opening/toss-logo-official.png" alt="토스증권 공식 로고"><span>Open API에서 실시간 구독까지</span></div><div class="e2-document-grid">${documents.slice(3).map((d,i)=>doc(d,i+3)).join('')}</div></section></div><footer class="e2-source">공식 공개 자료 · 한국투자증권 개발자센터 / GitHub / Trading MCP · 토스증권 Open API / 개발자 문서</footer></section>`,
  play:async(r,a)=>{await Promise.all([...r.querySelectorAll('.e2-broker-lane')].map((el,i)=>a.animate(el,[{opacity:0,transform:'translateY(24px)'},{opacity:1,transform:'translateY(0)'}],{duration:1000,delay:i*220})));if(!alive(a))return;await Promise.all([...r.querySelectorAll('.e2-document')].map((el,i)=>a.animate(el,[{opacity:.45},{opacity:1}],{duration:700,delay:(i%3)*160})));}
 };
 const fieldHost=document.createElement('div');fieldHost.innerHTML=scenes.s10.render();
 const fieldMarkup=fieldHost.querySelector('.cc-field').outerHTML;
 const line=(id,d,cls='')=>`<path class="e2-reveal e2-flow-line ${cls}" data-route="${id}" d="${d}"/>`;
 const diagram=()=>`<div class="e2-diagram"><svg class="e2-system" viewBox="0 0 1920 1080" aria-label="투자 데이터 요청이 인증, API 서비스, 조건 판단, 기록 저장으로 이어지고 시간 초과 재시도와 테스트를 필요로 하는 개발 흐름">
 <defs><marker id="e2-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1 9 5 1 9" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker></defs>
 <g class="e2-layer-routes">
 ${line('request','M325 555 C375 555 390 555 430 555')}
 ${line('auth','M560 475 L560 402 Q560 377 585 377 L680 377')}
 ${line('service','M690 555 C755 555 765 555 822 555')}
 ${line('algorithm','M1042 555 C1125 555 1125 420 1220 420')}
 ${line('relation','M1455 470 L1480 470 Q1515 470 1515 505 L1515 580')}
 ${line('return','M822 600 C735 600 730 754 655 754 L450 754 Q418 754 418 722 L418 625','e2-failure')}
 ${line('tests','M933 666 L933 905 Q933 934 963 934 L1042 934','e2-test-route')}
 ${line('record','M1485 770 L1485 902 Q1485 934 1453 934 L1370 934','e2-test-route')}
 </g>
 <g class="e2-reveal e2-node e2-request" data-origin="220,555"><circle cx="220" cy="555" r="103" class="e2-request-circle"/><path d="M180 516 h80 a12 12 0 0 1 12 12 v29 a12 12 0 0 1-12 12 h-31 l-22 20 v-20 h-27 a12 12 0 0 1-12-12 v-29 a12 12 0 0 1 12-12" class="e2-symbol"/><text x="220" y="633" text-anchor="middle" class="e2-node-small">투자 데이터 요청</text></g>
 <g class="e2-reveal e2-node e2-service" data-origin="560,555"><rect x="430" y="475" width="260" height="160" rx="26" class="e2-service-box"/><text x="463" y="516" class="e2-kicker">COMPUTER SYSTEMS</text><text x="463" y="562" class="e2-node-title">API 서비스</text><text x="463" y="604" class="e2-node-sub">조회 · 해석 · 실행</text></g>
 <g class="e2-reveal e2-node e2-auth" data-origin="783,377"><rect x="680" y="338" width="225" height="78" rx="39" class="e2-auth-box"/><path d="M708 374 v-7 a8 8 0 0 1 16 0 v7 m-19 0 h22 v18 h-22z" class="e2-symbol"/><text x="742" y="386" class="e2-node-sub">인증 · 권한</text></g>
 <g class="e2-reveal e2-node e2-decision" data-origin="933,555"><path d="M933 443 Q943 443 950 450 L1035 535 Q1055 555 1035 575 L950 660 Q933 677 916 660 L831 575 Q811 555 831 535 L916 450 Q923 443 933 443Z" class="e2-decision-shape"/><text x="933" y="534" text-anchor="middle" class="e2-kicker">ALGORITHM</text><text x="933" y="578" text-anchor="middle" class="e2-node-title">조건 충족?</text></g>
 <g class="e2-reveal e2-node e2-storage" data-origin="1330,420"><rect x="1220" y="330" width="235" height="190" rx="17" class="e2-table"/><path d="M1220 389 H1455" class="e2-table-line"/><text x="1247" y="368" class="e2-entity-title">Account</text><text x="1247" y="430" class="e2-field-key">id</text><text x="1416" y="430" text-anchor="end" class="e2-field-meta">PK</text><text x="1247" y="476" class="e2-field-key">permission</text><text x="1472" y="453" class="e2-relationship-label">1</text></g>
 <g class="e2-reveal e2-node e2-record" data-origin="1540,675"><rect x="1400" y="580" width="285" height="190" rx="17" class="e2-table"/><path d="M1400 639 H1685" class="e2-table-line"/><text x="1427" y="618" class="e2-entity-title">Record</text><text x="1427" y="680" class="e2-field-key">owner_id</text><text x="1655" y="680" text-anchor="end" class="e2-field-meta">FK</text><text x="1427" y="726" class="e2-field-key">condition · result</text><text x="1534" y="565" class="e2-relationship-label">N</text></g>
 <g class="e2-reveal e2-node e2-retry" data-origin="555,754"><rect x="448" y="725" width="222" height="58" rx="29" class="e2-retry-box"/><text x="560" y="763" text-anchor="middle" class="e2-retry-text">시간 초과 → 재시도</text></g>
 <g class="e2-reveal e2-labels"><text x="1090" y="441" class="e2-route-label">충족</text><text x="741" y="664" class="e2-route-label e2-pink">실패</text><text x="1288" y="292" class="e2-domain-label">데이터 관계 · 저장</text><text x="473" y="862" class="e2-domain-label">한 번의 요청에도, 설계할 책임은 늘어납니다.</text></g>
 <g class="e2-reveal e2-tests" data-origin="970,930"><path d="M630 934 H1500" class="e2-test-baseline"/><circle cx="716" cy="934" r="8"/><circle cx="1042" cy="934" r="8"/><circle cx="1370" cy="934" r="8"/><text x="716" y="984" text-anchor="middle">정상 응답</text><text x="1042" y="984" text-anchor="middle">시간 초과</text><text x="1370" y="984" text-anchor="middle">중복 실행</text><text x="486" y="942" class="e2-test-label">TEST</text></g>
 </svg><div class="e2-pulse" aria-hidden="true"></div></div>`;
 const render=()=>`<section class="cc-root e2-cs" data-fullscreen="true">${fieldMarkup}${head('투자 지식 밖의 개발 부담','직접 작업 공간을 만들려면, 코드와 시스템도 이해해야 합니다.')}${diagram()}<footer class="e2-source">CS 개념을 연결한 설명용 도식 · 시스템 / 알고리즘 / 데이터베이스 / 소프트웨어 검증 · MIT 6-3 교과과정 참고</footer></section>`;
 async function pulse(root,a,route,duration){const el=root.querySelector(`[data-route="${route}"]`),dot=root.querySelector('.e2-pulse');if(!alive(a)||a.reduced)return;const n=32,length=el.getTotalLength();dot.style.opacity='1';await a.animate(dot,Array.from({length:n+1},(_,i)=>{const p=el.getPointAtLength(length*i/n);return{offset:i/n,transform:`translate(${p.x}px,${p.y}px)`}}),{duration,easing:'linear'});dot.style.opacity='0';}
 scenes.s09={title:'투자 지식 밖의 개발 부담',duration:6900,fullscreen:true,render,
  play:async(r,a)=>{r.querySelector('.cc-field').style.opacity='0';const groups=[...r.querySelectorAll('.e2-reveal')];if(a.reduced)return;groups.forEach(el=>el.style.opacity='0');
   const show=async(selector,duration=600)=>{if(!alive(a))return;await Promise.all([...r.querySelectorAll(selector)].map(el=>a.animate(el,[{opacity:0},{opacity:1}],{duration})));};
   await show('.e2-request,[data-route="request"]',650);if(!alive(a))return;
   await pulse(r,a,'request',500);await show('.e2-service,.e2-auth,[data-route="auth"],[data-route="service"]',750);if(!alive(a))return;
   await pulse(r,a,'auth',450);await pulse(r,a,'service',450);await show('.e2-decision,[data-route="algorithm"]',550);if(!alive(a))return;
   await pulse(r,a,'algorithm',650);await show('.e2-storage,.e2-record,.e2-labels,[data-route="relation"]',750);if(!alive(a))return;
   await pulse(r,a,'relation',500);await show('.e2-retry,[data-route="return"]',500);await pulse(r,a,'return',700);if(!alive(a))return;
   await show('.e2-tests,.e2-test-route',650);
  }
 };
 scenes['s09-dust']={title:'복잡한 작업에서 하나의 시야로',duration:3300,fullscreen:true,render,
  play:async(r,a)=>{const field=r.querySelector('.cc-field'),visual=r.querySelector('.e2-diagram'),heading=r.querySelector('.e2-head'),footer=r.querySelector('.e2-source');field.style.opacity='0';
   if(a.reduced){field.style.opacity='1';visual.style.opacity='0';heading.style.opacity='0';footer.style.opacity='0';return;}
   const routes=[...r.querySelectorAll('.e2-flow-line')],stars=[...field.querySelectorAll('.cc-star')],dust=[];
   stars.forEach((star,i)=>{const route=routes[i%routes.length],p=route.getPointAtLength(route.getTotalLength()*((i*.61803398875)%1)),dot=document.createElement('i');dot.className='e2-dust-dot';dot.style.cssText=`left:${p.x}px;top:${p.y}px;width:${i?2:5}px;height:${i?2:5}px`;r.firstElementChild.append(dot);dust.push({dot,p,star});});
   await Promise.all([
    a.animate(visual,[{opacity:1},{opacity:0}],{duration:650}),
    a.animate(heading,[{opacity:1},{opacity:0}],{duration:600}),a.animate(footer,[{opacity:1},{opacity:0}],{duration:600}),
    ...dust.map(({dot,p,star},i)=>a.animate(dot,[{opacity:0,transform:'translate(0,0)'},{opacity:.9,offset:.14},{opacity:.85,offset:.78},{opacity:0,transform:`translate(${parseFloat(star.style.left)-p.x}px,${parseFloat(star.style.top)-p.y}px)`}],{duration:2650,delay:(i%8)*45,easing:'linear'})),
    a.animate(field,[{opacity:0},{opacity:1}],{duration:750,delay:2300})
   ]);if(!alive(a))return;dust.forEach(({dot})=>dot.remove());r.firstElementChild.classList.add('cc-settled');
  }
 };
})();

