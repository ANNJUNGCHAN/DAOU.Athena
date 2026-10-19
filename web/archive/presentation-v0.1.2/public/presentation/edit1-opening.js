/* User edit-1.pptx opening revisions. Load after review-overrides/review-toss.
 * Scoped visual overrides only: no cue/narration edits, no media replacement.
 */
(() => {
  'use strict';
  const scenes = window.ATHENA_SCENES;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const header = (title, sub) => `<header class="e1-opening-head"><h1>${title}</h1><p>${sub}</p></header>`;
  const alive = a => !a.signal.aborted;
  scenes['s02-claude'] = {
    title:'Claude Code', duration:4400,
    render:()=>`<section class="e1-opening e1-claude"><div class="e1-question-echo"><img src="assets/question-refined.png" alt="앞 장면의 물음표"></div><div class="e1-claude-lockup"><img class="e1-claude-mark" src="assets/intro/claude-mark-official.svg" alt="Claude 공식 심벌"><strong>Claude Code</strong></div></section>`,
    play:async(r,a)=>{
      const echo=r.querySelector('.e1-question-echo'),lockup=r.querySelector('.e1-claude-lockup'),mark=r.querySelector('.e1-claude-mark');
      if(a.reduced){echo.style.opacity='0';lockup.style.opacity='1';return;}
      lockup.style.opacity='0';
      await a.animate(echo,[{opacity:1,transform:'translate(-50%,-50%) scale(1)'},{opacity:.42,transform:'translate(-50%,-50%) scale(.35)',offset:.7},{opacity:0,transform:'translate(-50%,-50%) scale(.12)'}],{duration:1450,easing:'ease-in-out'});
      if(!alive(a))return;
      await Promise.all([
        a.animate(lockup,[{opacity:0,transform:'translateY(32px) scale(.92)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:2300,easing:'cubic-bezier(.2,.5,.25,1)'}),
        a.animate(mark,[{opacity:.28},{opacity:1,offset:.25},{opacity:.38,offset:.46},{opacity:1,offset:.66},{opacity:.55,offset:.82},{opacity:1}],{duration:2800,easing:'ease-in-out'})
      ]);
    }
  };
  const asm=`; NASM x86-64 · Linux · sum 1..10
global _start
section .bss
    buffer resb 24
section .text
_start:
    xor rax, rax
    mov rcx, 1
.sum:
    add rax, rcx
    inc rcx
    cmp rcx, 10
    jle .sum
    lea rsi, [rel buffer + 23]
    mov byte [rsi], 10
    mov rbx, 10
.digit:
    xor rdx, rdx
    div rbx
    add dl, '0'
    dec rsi
    mov [rsi], dl
    test rax, rax
    jnz .digit
    lea rdx, [rel buffer + 24]
    sub rdx, rsi
    mov rax, 1
    mov rdi, 1
    syscall
    mov rax, 60
    xor rdi, rdi
    syscall`;
  const ccode=String.raw`#include <stdio.h>

int main(void) {
    int sum = 0;
    for (int n = 1; n <= 10; ++n) {
        sum += n;
    }
    printf("%d\n", sum);
    return 0;
}`;
  const editor=(language,body)=>`<article class="e1-code-window e1-${language.toLowerCase()}"><div class="e1-code-bar"><i></i><i></i><i></i><b>${language}</b><span>${language==='C'?'sum.c':'sum.asm'}</span></div>${body}<footer>OUTPUT <b>55</b></footer></article>`;
  scenes['s04-c']={
    title:'같은 작업을 더 간결하게',duration:1200,
    render:()=>`<section class="e1-opening e1-code">${header('같은 작업을 더 간결하게','C언어는 개발자가 작업의 논리를 표현하고 컴파일러가 이를 기계어로 변환하는 방식으로 프로그래밍의 추상화 수준을 높였습니다')}<div class="e1-code-pair">${editor('Assembly',`<div class="e1-asm-columns"><pre>${esc(asm.split('\n').slice(0,16).join('\n'))}</pre><pre>${esc(asm.split('\n').slice(16).join('\n'))}</pre></div>`)}${editor('C',`<pre class="e1-c-code">${esc(ccode)}</pre>`)}</div><small class="e1-opening-source">두 코드 모두 1부터 10까지의 합계 55를 출력 · 실제 언어 코드 예시</small></section>`,
    play:async(r,a)=>{
      const blocks=[...r.querySelectorAll('.e1-code-window pre')],footers=[...r.querySelectorAll('.e1-code-window footer')];
      footers.forEach(el=>el.style.opacity='0');
      await Promise.all(blocks.map(el=>a.type(el,el.textContent,1200)));
      if(!alive(a))return;
      footers.forEach(el=>el.style.opacity='1');
    }
  };
  const brokerCards=[
    ['kis-dev','개발자센터','','assets/revision/docs/kis-developer-home-existing.png'],
    ['kis-git','공식 GitHub','','assets/revision/docs/kis-github.png'],
    ['kis-mcp','Trading MCP','','assets/revision/docs/kis-mcp.png'],
    ['toss-api','Open API','국내·미국 주식 API 연결','assets/revision/docs/toss-service.png'],
    ['toss-auth','인증과 호출','OAuth 2.0 토큰 · 공식 curl 예제','assets/review-toss/openapi/auth.png'],
    ['toss-ws','실시간 구독','','assets/review-toss/openapi/connection.png']
  ];
  scenes['s07-kis']={
    title:'여러 증권사도 Claude Code를 향해',duration:1800,
    render:()=>`<section class="e1-opening e1-brokers">${header('여러 증권사도 Claude Code를 향해','하지만, Claude Code와의 연결이 일반 투자자에게도 더 편리한 투자 경험으로 이어질까요?')}<div class="e1-broker-collage">${brokerCards.map(([cls,title,sub,img])=>`<figure class="e1-broker-card e1-${cls}"><figcaption><b>${title}</b>${sub?`<span>${sub}</span>`:''}</figcaption><img src="${img}" alt="${title} 공식 공개 화면"></figure>`).join('')}<img class="e1-kis-logo" src="assets/edit1-opening/kis-logo-official.png" alt="한국투자증권 공식 로고"><img class="e1-toss-logo" src="assets/edit1-opening/toss-logo-official.png" alt="토스증권 공식 로고"></div><small class="e1-opening-source">공식 공개 자료 · 한국투자증권 개발자센터 / GitHub / Trading MCP · 토스증권 Open API / 개발자 문서</small></section>`,
    play:async(r,a)=>{await Promise.all([...r.querySelectorAll('.e1-broker-card')].map((el,i)=>a.animate(el,[{opacity:0,transform:'translateY(35px)'},{opacity:1,transform:'translateY(0)'}],{duration:900,delay:a.reduced?0:i*130})));}
  };
  // Preserve the actual seven-second capture, its error guards and cancellation.
  const speech=scenes.s08, speechRender=speech.render;
  const speechTitle='Claude Code는 누구를 위해 설계되었는가';
  const speechSub='Boris Cherny는 숙련된 소프트웨어 엔지니어를 주요 사용자로 설정하고 Claude Code를 개발했습니다.';
  if(window.ATHENA_REVIEW_HEADERS)window.ATHENA_REVIEW_HEADERS.s08=[speechTitle,speechSub];
  speech.render=()=>{const host=document.createElement('div');host.innerHTML=speechRender();host.firstElementChild.classList.add('e1-interview');const h=host.querySelector('.rev-header');h.classList.add('e1-opening-head');h.querySelector('h1').textContent=speechTitle;h.querySelector('p').textContent=speechSub;host.querySelector('cite').textContent='Claude Code 창시자이자 개발 총괄, Boris Cherny';return host.innerHTML;};
  // Official MIT 6-3 curriculum subject names; examples below are explanatory.
  const courses=[
    ['6.1910','컴퓨터 구조','Computation Structures','instruction → datapath\nregister · ALU · memory\nclock → execute → write'],
    ['6.5831','데이터베이스','Database Systems','SELECT * FROM records\nWHERE owner_id = ?;\nindex · transaction · lock'],
    ['6.1010','프로그래밍 기초','Fundamentals of Programming','def sum_to(n):\n    return sum(range(1, n + 1))\nassert sum_to(10) == 55'],
    ['6.1210','알고리즘','Introduction to Algorithms','binary_search(items, key)\nleft ← mid + 1\nO(log n) · correctness'],
    ['6.1800','컴퓨터 시스템','Computer Systems Engineering','client → service → storage\ntimeout · retry · recovery\natomicity · consistency'],
    ['6.1810','운영체제','Operating System Engineering','process → scheduler → CPU\nvirtual memory · page table\nfile system · concurrency'],
    ['6.1020','소프트웨어 구축','Software Construction','specification → implementation\nunit test · invariant\nmutable state · abstraction'],
    ['6.1200','컴퓨터과학 수학','Mathematics for Computer Science','∀ n ≥ 1: P(n)\ninduction · graph · relation\nproof → bound → verify']
  ];
  const courseMarkup=c=>`<small class="e1-course-id">MIT ${c[0]}</small><h2>${c[1]}</h2><div class="e1-course-en">${c[2]}</div><pre>${esc(c[3])}</pre>`;
  for(const id of ['s09','s09-dust']){
    const def=scenes[id],original=def.render;
    def.render=()=>{const host=document.createElement('div');host.innerHTML=original();host.firstElementChild.classList.add('e1-cs');host.querySelectorAll('.cc-panel').forEach((panel,i)=>panel.querySelectorAll('.cc-tile-content').forEach(tile=>tile.innerHTML=courseMarkup(courses[i])));const h=host.querySelector('.cc-cs-title');h.classList.add('e1-opening-head');h.querySelector('h1').textContent='투자 지식 밖의 개발 부담';h.querySelector('p').textContent='직접 작업 공간을 만들려면, 코드와 시스템도 이해해야 합니다.';h.insertAdjacentHTML('beforeend','<small class="e1-curriculum-source">과목명: MIT 6-3 공식 교과과정 · 코드는 개념 설명 예시</small>');return host.innerHTML;};
  }
})();
