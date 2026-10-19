/* edit-1.pptx comments 15/18. Presentation-only reenactment; no native app control. */
(() => {
  'use strict';
  const scenes = window.ATHENA_SCENES;
  const heading = '일반 투자자는 투자할 때 어떤 과정을 거칠까요?';
  const subtitle = '투자 판단과 근거를 기록하고, 관심 종목의 조건을 설정해 알림을 받습니다.';
  const copy = '투자 검토 노트\n\n관찰 대상: 가상 종목 DEMO-A\n\n판단 근거\n가격 회복과 거래량 변화를 함께 확인한다.\n뉴스와 공시에서 변화의 배경을 찾아 기록한다.\n\n다음에 확인할 조건\n관심 가격에 도달하면 근거를 다시 살펴본다.';
  const render = (final = false) => `<section class="cw-stage e1-workflows" data-step="${final?'reopened':'desktop'}"><header class="cw-title"><h1>${heading}</h1><p>${subtitle}</p></header><div class="e1-halves"><article class="e1-half"><div class="e1-section-label">01 <b>판단과 근거 기록</b><span class="e1-word-status">${final?'저장한 문서 다시 열기':'문서 열기'}</span></div><div class="e1-desktop"><div class="e1-file"><b>W</b><span>투자 검토 노트.docx</span></div><div class="e1-word" style="opacity:${final?1:0}"><div class="e1-word-bar"><b>W</b> 투자 검토 노트.docx <span class="e1-save-state">${final?'저장됨':'편집 중'}</span><span>—　□　×</span></div><div class="e1-word-menu">파일　 홈　 삽입　 레이아웃　 검토　 보기</div><div class="e1-word-ribbon">맑은 고딕　 11　 │　 <b>B</b>　 <i>I</i>　 U　 │　 ≡　 ☷</div><div class="e1-word-paper"><pre>${final?copy:''}</pre></div><div class="e1-word-footer">페이지 1 / 1 <span>한국어　　100%</span></div></div><div class="e1-save-dialog" hidden><strong>다른 이름으로 저장</strong><p>문서 › 투자 기록</p><div>투자 검토 노트.docx</div><b>저장</b></div><div class="e1-taskbar">⊞　⌕　 <b>W</b>　▣</div></div><div class="e1-step-track">열기 <span>→</span> 입력 <span>→</span> 저장 <span>→</span> 다시 확인</div></article><article class="e1-half"><div class="e1-section-label">02 <b>관심 종목 조건 알림</b><span class="e1-phone-status">${final?'가격 알림 도착':'조건 설정'}</span></div><div class="e1-phone-stage"><div class="e1-iphone"><div class="e1-phone-feed"><div class="e1-feed-scroll"><img class="e1-toss-screen" src="assets/actions/toss-price-alert-off.png" alt="사용자 제공 토스 SK하이닉스 가격 알림 원본 화면"><div class="e1-toggle ${final?'is-on':''}" aria-label="1,868,000원 가격 알림 설정 재현"><span></span></div><div class="e1-toss-touch"></div></div></div><div class="e1-notification" style="opacity:${final?1:0};transform:translateY(${final?0:-150}px)"><div><b><i>t</i> 토스</b><span>지금</span></div><strong>SK하이닉스 가격 알림</strong><p>설정한 1,868,000원에 도달했어요.</p></div></div></div><div class="e1-step-track">조건 설정 <span>→</span> 일상 속 사용 <span>→</span> 알림 확인</div></article></div><div class="cw-caption">Word 사용 흐름 재현 · 토스 사용자 제공 원본 화면 / 설정·알림 도착 재현</div></section>`;
  const q = (r,s) => r.querySelector(s);
  const alive = a => !a.signal.aborted;
  async function animate(a,el,frames,duration=550) {
    if(!alive(a)) return;
    await a.animate(el,frames,{duration:a.reduced?1:duration,easing:'cubic-bezier(.22,.7,.2,1)',fill:'forwards'});
    if(alive(a)) Object.assign(el.style,frames[frames.length-1]);
  }
  async function pause(a,ms) { if(alive(a)) await a.wait(a.reduced?0:ms); }
  function finalState(r) {
    q(r,'.e1-workflows').dataset.step='reopened';
    q(r,'.e1-word').style.opacity=1;q(r,'.e1-word').style.transform='none';
    q(r,'.e1-word-paper pre').textContent=copy;
    q(r,'.e1-save-state').textContent='저장됨';q(r,'.e1-word-status').textContent='저장한 문서 다시 열기';
    q(r,'.e1-save-dialog').hidden=true;q(r,'.e1-toggle').classList.add('is-on');
    q(r,'.e1-phone-status').textContent='가격 알림 도착';
    Object.assign(q(r,'.e1-notification').style,{opacity:1,transform:'translateY(0)'});
  }
  async function play(r,a) {
    if(!alive(a))return;if(a.reduced){finalState(r);return;}
    const word=q(r,'.e1-word'), status=q(r,'.e1-word-status');
    await Promise.all([
      (async()=>{
        await pause(a,500);await animate(a,word,[{opacity:0,transform:'scale(.84)'},{opacity:1,transform:'scale(1)'}]);
        if(!alive(a))return;status.textContent='판단과 근거 입력';q(r,'.e1-workflows').dataset.step='typing';
        for(let i=0;i<=copy.length;i+=4){if(!alive(a))return;q(r,'.e1-word-paper pre').textContent=copy.slice(0,i);await pause(a,55);}
        if(!alive(a))return;q(r,'.e1-word-paper pre').textContent=copy;
        status.textContent='문서 저장';q(r,'.e1-save-dialog').hidden=false;await pause(a,1200);
        if(!alive(a))return;q(r,'.e1-save-dialog').hidden=true;q(r,'.e1-save-state').textContent='저장됨';
        await animate(a,word,[{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.84)'}]);
        if(!alive(a))return;status.textContent='저장한 문서 다시 열기';await pause(a,900);
        await animate(a,word,[{opacity:0,transform:'scale(.84)'},{opacity:1,transform:'scale(1)'}]);
      })(),
      (async()=>{
        await pause(a,1500);if(!alive(a))return;q(r,'.e1-toggle').classList.add('is-on');await pause(a,1100);
        if(!alive(a))return;q(r,'.e1-phone-status').textContent='토스 화면 확인 중';
        await animate(a,q(r,'.e1-toss-touch'),[{opacity:0,transform:'scale(.7)'},{opacity:1,transform:'scale(1.2)'},{opacity:0,transform:'scale(1.5)'}],900);
        await animate(a,q(r,'.e1-feed-scroll'),[{transform:'translateY(0)'},{transform:'translateY(-20px)'},{transform:'translateY(0)'}],1600);
        await pause(a,1100);if(!alive(a))return;q(r,'.e1-phone-status').textContent='가격 알림 도착';
        await animate(a,q(r,'.e1-notification'),[{opacity:0,transform:'translateY(-150px)'},{opacity:1,transform:'translateY(0)'}],700);
      })()
    ]);
    if(alive(a))finalState(r);
  }
  scenes.s18={title:'기록과 조건 알림',render:()=>render(false),play,duration:9500,continuity:true};
  scenes.s19={title:'기록과 알림 확인',render:()=>render(true),play:async()=>{},duration:1,continuity:true};
  // Structure follows app/shell.html: mode sidebar, Agora canvas and composer.
  // Only replaces the existing destination contents: same 3D plane, same camera path.
  const app = `<aside class="e1-app-sidebar"><div class="e1-app-brand">ATHENA<span>✦</span></div><div class="e1-new-chat">＋　새 대화</div><div class="e1-app-nav"><b>◈　아고라</b><span>◇　메티스</span><span>⌘　에르가네</span><span>◎　아이기스</span><span>△　팔라스</span></div><small>대화</small><p>새로운 투자 질문</p><footer>투자자의 작업 공간</footer></aside><main class="e1-app-main"><div class="e1-app-top">아고라 <span>새 대화</span></div><div class="e1-app-welcome"><div class="e1-app-symbol">✦</div><span>ATHENA</span><h2>무엇을 함께 살펴볼까요?</h2><p>질문에서 시작해, 필요한 근거를 함께 확인합니다.</p><div class="e1-app-composer"><div>무엇이든 물어보세요</div><footer><span>＋　⌕</span><span>대화 설정　 <b>↑</b></span></footer></div><div class="e1-app-suggestions"><span>시장과 종목 살펴보기</span><span>판단과 근거 돌아보기</span><span>투자 기준 검토하기</span></div></div><small class="e1-app-source">실제 ATHENA 앱 구조 기반 · 소개용 화면 재구성</small></main>`;
  for(const id of ['s21','s22','s23','s24']) {
    if(!scenes[id])continue;
    const original=scenes[id].render;
    scenes[id].render=()=>{const host=document.createElement('div');host.innerHTML=original();for(const plane of host.querySelectorAll('.cw-chat-plane')){plane.classList.add('e1-athena-app');plane.innerHTML=app;}return host.innerHTML;};
  }
  const arrive=scenes.s22.play;
  scenes.s22.play=async(r,a)=>{
    await Promise.all([arrive(r,a),...Array.from(r.querySelectorAll('.cw-floor,.cw-roof')).map(el=>a.animate(el,[{opacity:getComputedStyle(el).opacity},{opacity:0}],{duration:a.reduced?1:650,delay:a.reduced?0:4750,fill:'forwards'}))]);
    if(alive(a))for(const el of r.querySelectorAll('.cw-floor,.cw-roof'))el.style.opacity=0;
  };
})();
