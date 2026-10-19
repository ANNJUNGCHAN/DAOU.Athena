/* Approved September review: scene content, evidence and click-bounded motion. */
(() => {
  'use strict';
  const scenes=window.ATHENA_SCENES, demo=window.ATHENA_DEMO;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const q=(r,s)=>r.querySelector(s);
  const appear=(api,el,delay=0,duration=650)=>api.animate(el,[{opacity:0,transform:'translateY(24px)'},{opacity:1,transform:'translateY(0)'}],{duration,delay});
  const panel=(title,body,kind='')=>`<div class="rev-window ${kind}"><div class="rev-window-bar"><i></i><i></i><i></i><span>${title}</span></div>${body}</div>`;
  const source=text=>`<footer class="rev-source">${text}</footer>`;
  const define=(id,body,play,duration=4000)=>{scenes[id]={title:scenes[id]?.title||id,revision:true,duration,render:body,play};};
  const headers={
    's02-claude':['소프트웨어를 만드는 방식이 달라집니다','Claude Code는 자연어를 실제 개발 작업으로 연결합니다.'],
    's04-assembly':['컴퓨터에게 모든 단계를 설명하던 언어','1부터 10까지 더하는 작업을 x86-64 Assembly로 작성합니다.'],
    's04-c':['같은 작업, 더 짧은 표현','C는 반복과 출력의 세부 동작을 간결한 문장으로 묶습니다.'],
    s05:['코드를 쓰는 대신, 원하는 결과를 말합니다','같은 쇼핑몰을 코드와 자연어로 만드는 과정을 나란히 봅니다.'],
    's07-kis':['증권사의 기능도 도구로 연결됩니다','한국투자증권은 API와 공식 개발 자료를 제공합니다.'],
    's07-toss':['투자 도구의 문이 열리고 있습니다','토스증권의 공식 API와 문서로 투자 작업을 연결합니다.'],
    s08:['여전히, 엔지니어를 위한 도구입니다','Claude Code가 가장 먼저 집중한 사용자는 엔지니어입니다.'],
    s09:['도구를 쓰려면, 많은 지식이 필요합니다','구조·데이터·알고리즘·테스트를 함께 이해해야 합니다.'],
    's09-dust':['복잡함을 넘어, 판단에 집중하도록','흩어진 지식과 작업을 하나의 시야로 연결합니다.'],
    s10:['정보 너머의 맥락을 향해','투자자가 보고 싶은 것은 더 많은 화면이 아닌 분명한 판단입니다.'],
    's11-en':['시야를 가리던 안개를 걷어내다','아테나가 디오메데스에게 건넨 말에서 시작합니다.'],
    's11-ko':['분명히 구별할 수 있도록','ATHENA가 투자자에게 전하고 싶은 약속입니다.'],
    s12:['투자자의 시야를 여는 이름','ATHENA — 정보 너머의 맥락이 보이도록.'],
    s13:['투자의 시야를 가리던 안개를 걷어내다','정보 너머의 맥락이 보이도록.'],
    s16:['차트에서 판단의 단서를 찾습니다','종목과 구간을 살펴보고 가격과 거래량을 함께 읽습니다.'],
    s17:['뉴스와 공시에서 배경을 확인합니다','검색 결과에서 기사와 공시 원문으로 들어갑니다.'],
    s18:['지난 판단을 다시 읽습니다','기록해 둔 근거와 결과가 다음 질문으로 이어집니다.'],
    s19:['필요한 순간에 알림을 받습니다','설정한 조건의 변화를 놓치지 않고 확인합니다.'],
    s20:['원칙을 코드로 만들고 검증합니다','가상 데이터로 규칙을 실행하고 계산 결과와 거래 내역을 확인합니다.'],
    s21:['투자에는 여러 작업이 함께 필요합니다','차트·뉴스·기록·알림·검증을 오가며 맥락을 연결합니다.'],
    s22:['모든 투자 작업을, 하나의 채팅에서','ATHENA에 말하면 필요한 도구와 맥락이 함께 연결됩니다.']
  };
  Object.assign(headers,window.ATHENA_PLAN_HEADERS||{});
  headers.s24=['이 모든 것을, 하나의 채팅으로','아테나는 이러한 모든 것들을 하나의 채팅으로 연결합니다.'];
  delete headers['s02-question'];
  window.ATHENA_REVIEW_HEADERS=headers;
  window.ATHENA_UPDATE_HEADER=(root,id)=>{const h=headers[id];if(!h)return;const title=root.querySelector('.rev-header h1'),sub=root.querySelector('.rev-header p');if(title)title.textContent=h[0];if(sub)sub.textContent=h[1];};
  define('s02-claude',()=>`<div class="rev-claude"><img src="assets/intro/claude-mark-official.svg" alt="Claude 공식 심벌"><strong>Claude Code</strong></div>`,async(r,a)=>{
    await a.animate(q(r,'.rev-claude'),[{opacity:0,transform:'scale(.35)'},{opacity:1,transform:'scale(1.12)',offset:.44},{opacity:1,transform:'scale(.98)',offset:.72},{opacity:1,transform:'scale(1)'}],{duration:980,easing:'cubic-bezier(.2,.8,.2,1)'});
  },980);
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
  async function typeCode(a,el,text,ms){
    if(a.reduced){el.textContent=text;el.scrollTop=el.scrollHeight;return;}
    const step=Math.max(1,Math.ceil(text.length/(ms/24)));
    for(let n=0;n<=text.length;n+=step){if(a.signal.aborted)return;el.textContent=text.slice(0,n);el.scrollTop=el.scrollHeight;await a.wait(24);}
    el.textContent=text;el.scrollTop=el.scrollHeight;
  }
  define('s04-assembly',()=>`<div class="rev-terminal-single">${panel('sum.asm — NASM x86-64',`<pre class="rev-code rev-asm"></pre><div class="rev-console">$ nasm -f elf64 sum.asm &amp;&amp; ld sum.o -o sum &amp;&amp; ./sum<br><span>OUTPUT　55</span></div>`,'rev-terminal')}</div>${source('동일 작업: 1부터 10까지 합계 · 실제 언어 코드의 입력 재현, 이 장면에서 컴파일하지 않음')}`,async(r,a)=>{q(r,'.rev-console').style.opacity=0;await typeCode(a,q(r,'.rev-asm'),asm,4200);if(a.signal.aborted)return;await appear(a,q(r,'.rev-console'));},4900);
  define('s04-c',()=>`<div class="rev-code-compare">${panel('sum.asm · 같은 작업',`<pre class="rev-code rev-asm-mini">${esc(asm)}</pre>`,'rev-terminal')}${panel('sum.c · C',`<pre class="rev-code rev-c"></pre><div class="rev-console">$ cc sum.c -o sum &amp;&amp; ./sum<br><span>OUTPUT　55</span></div>`,'rev-terminal')}</div>${source('두 코드 모두 1부터 10까지의 합계 55를 출력 · 실제 언어 코드 입력 재현')}`,async(r,a)=>{q(r,'.rev-console').style.opacity=0;await typeCode(a,q(r,'.rev-c'),ccode,2700);if(a.signal.aborted)return;await appear(a,q(r,'.rev-console'));},3400);
  const shopCode=`type Product = { id: string; price: number };
type Order = { id: string; total: number };

export async function checkout(cart: Cart) {
  return db.transaction(async tx => {
    const products = await tx.products.find(cart.ids);
    const total = calculateTotal(products, cart);
    const order = await tx.orders.create({ total });
    await tx.orderItems.insert(order.id, cart.items);
    return order;
  });
}

export function Storefront({ products }) {
  return <main>
    <header>DAILY OBJECTS</header>
    <section className="collection">
      {products.map(product =>
        <ProductCard key={product.id} {...product} />
      )}
    </section>
  </main>;
}`;
  const request='상품, 주문, 결제의 책임을 분리하고, 정규화된 데이터 모델과 트랜잭션 경계를 설계해서 쇼핑몰을 구현해줘.';
  const shop=()=>`<div class="rev-shop"><nav><b>DAILY OBJECTS</b><span>Collection　　Cart 0</span></nav><div class="rev-shop-hero"><small>OBJECTS FOR EVERY DAY</small><h2>조용한 일상을<br>채우는 것들.</h2><div class="rev-vase"></div></div><div class="rev-shop-items"><div>01　Ceramic</div><div>02　Living</div><div>03　Textile</div></div></div>`;
  define('s05',()=>`<div class="rev-split"><div class="rev-vscode">${panel('Visual Studio Code · storefront.tsx',`<div class="rev-editor-row"><aside>EXPLORER<br><br>▾ shop<br>　products.ts<br>　orders.ts<br>　payments.ts<br>　storefront.tsx</aside><pre class="rev-code rev-shop-code"></pre></div>`,'rev-terminal')}</div><div class="rev-chatgpt">${panel('ChatGPT',`<div class="rev-chat-conversation"><div class="rev-chat-request"></div><div class="rev-chat-response"></div></div><div class="rev-shop-preview">${shop()}</div>`)}</div></div>${source('VS Code·ChatGPT 형태의 발표용 동작 재현 · 완성 쇼핑몰 UI는 콘셉트 예시')}`,async(r,a)=>{q(r,'.rev-shop-preview').style.opacity=0;await Promise.all([typeCode(a,q(r,'.rev-shop-code'),shopCode,3600),a.type(q(r,'.rev-chat-request'),request,2300)]);if(a.signal.aborted)return;await a.type(q(r,'.rev-chat-response'),'상품·주문·결제를 분리하고, 홈페이지 미리보기를 만들었습니다.',850);await a.animate(q(r,'.rev-shop-preview'),[{opacity:0,transform:'translateX(100%)'},{opacity:1,transform:'translateX(0)'}],{duration:1000});},5500);
  const docs=(toss)=>{const files=toss?[['공식 API 소개','toss-service.png'],['Open API 가이드','toss-api-docs-existing.png'],['캔들 차트 API','toss-candles.png']]:[['개발자센터','kis-developer-home-existing.png'],['공식 GitHub','kis-github.png'],['Trading MCP','kis-mcp.png']];return `<div class="rev-doc-collage"><div class="rev-doc-logo ${toss?'toss':'kis'}">${toss?'토스증권':'한국투자증권'}<small>${toss?'Open API':'KIS Developers'}</small></div>${files.map(([title,file],i)=>`<article class="rev-doc-card rev-doc-${i}"><b>${title}</b><img src="assets/revision/docs/${file}" alt="${title} 공식 사이트 실제 캡처"></article>`).join('')}</div>${source('공식 사이트 실제 캡처 · 개발자센터/기존 가이드는 09.19 자료, 나머지 09.20 추가 확인')}`;};
  for(const toss of [false,true])define(toss?'s07-toss':'s07-kis',()=>docs(toss),async(r,a)=>{await Promise.all([...r.querySelectorAll('.rev-doc-card')].map((el,i)=>a.animate(el,[{opacity:0,transform:`translateY(${i%2?-80:80}px) scale(.92)`},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:1100,delay:i*160})));},1500);
  // The only available interview asset is an observed frame. Do not disguise it as video.
  define('s08',()=>`<div class="rev-interview"><div class="rev-interview-frame"><img src="assets/intro/boris-official-frame-50m01s.png" alt="Boris Cherny 인터뷰 실제 50분 1초 정지 프레임"><span>원본 정지 프레임 · 발언 영상 미확보</span></div><blockquote>“we’re laser focused on building the best product for the best engineers.”<p>우리는 최고의 엔지니어를 위한 최고의 제품을 만드는 데 집중하고 있습니다.</p><cite>Boris Cherny</cite></blockquote></div>${source('Every · AI & I · Dan Shipper × Boris Cherny · 49:56–50:03')}`,async(r,a)=>{await appear(a,q(r,'.rev-interview'));},650);
  // Retain the existing broad CS diagrams, now in perspective with irregular particle trajectories.
  const oldCS=scenes.s09.render;
  const seed=(n)=>{const x=Math.sin(n*127.1+78.233)*43758.5453;return x-Math.floor(x);};
  const stars=()=>`<div class="rev-stars">${Array.from({length:420},(_,i)=>`<i style="left:${seed(i+1)*100}%;top:${seed(i+900)*100}%;width:${.6+seed(i+430)*2.1}px;height:${.6+seed(i+430)*2.1}px;opacity:${.15+seed(i+1200)*.7}"></i>`).join('')}<b class="rev-central-star"></b></div>`;
  define('s09',()=>`<div class="rev-cs-camera">${oldCS()}</div>`,async(r,a)=>{await Promise.all([...r.querySelectorAll('.intro-cs-fragment')].map((el,i)=>a.animate(el,[{opacity:0,translate:`${i%2?-300:300}px 100px -700px`},{opacity:1,translate:'0px 0px 0px'}],{duration:1300,delay:i*90})));},2200);
  define('s09-dust',()=>`${stars()}<div class="rev-cs-camera">${oldCS()}</div><div class="rev-particles">${Array.from({length:360},(_,i)=>`<i style="left:${seed(i+1)*100}%;top:${seed(i+900)*100}%;--dx:${(seed(i+350)-.5)*1100}px;--dy:${(seed(i+700)-.5)*700}px"></i>`).join('')}</div>`,async(r,a)=>{await Promise.all([
    ...[...r.querySelectorAll('.intro-cs-fragment')].map((el,i)=>a.animate(el,[{opacity:1,filter:'blur(0px)',clipPath:'inset(0 0 0 0)'},{opacity:.6,filter:'blur(3px)',offset:.45},{opacity:0,filter:'blur(18px)',clipPath:'inset(0 0 100% 0)'}],{duration:3300,delay:i*95,easing:'ease-in'})),
    ...[...r.querySelectorAll('.rev-particles i')].map((el,i)=>a.animate(el,[{opacity:0,transform:'translate(var(--dx),var(--dy)) scale(3)'},{opacity:.8,offset:.35},{opacity:.45,transform:'translate(0,0) scale(.5)'}],{duration:4200,delay:seed(i+99)*550,easing:'cubic-bezier(.15,.6,.2,1)'})),
    a.animate(q(r,'.rev-stars'),[{opacity:0},{opacity:1}],{duration:4600})]);},4900);
  define('s10',()=>`${stars()}`,async(r,a)=>{await a.animate(q(r,'.rev-stars'),[{transform:'scale(1)'},{transform:'scale(2.1)'}],{duration:4200,easing:'cubic-bezier(.4,0,.6,1)'});},4200);
  const wordmark=()=>`<div class="rev-wordmark"><span class="rev-word-guide">ATHENA</span><span class="rev-word-ink"></span><i></i></div>`;
  define('s12',()=>`<div class="rev-brand-stage">${wordmark()}<div class="rev-fog rev-fog-a"></div><div class="rev-fog rev-fog-b"></div></div>`,async(r,a)=>{
    await Promise.all([...r.querySelectorAll('.rev-fog')].map((e,i)=>a.animate(e,[{opacity:.9,transform:'translateX(0)'},{opacity:0,transform:`translateX(${i?-1100:1100}px)`}],{duration:1600})));
    if(a.signal.aborted)return;await a.wait(450);for(let i=1;i<=6;i++){if(a.signal.aborted)return;q(r,'.rev-word-ink').textContent='ATHENA'.slice(0,i);await a.wait(210);}q(r,'.rev-wordmark').classList.add('complete');
  },3400);
  define('s13',()=>`<div class="rev-home"><div class="rev-home-logo">ATHENA</div><div class="rev-home-orbit"></div></div>`,async(r,a)=>{await Promise.all([appear(a,q(r,'.rev-header h1'),0,1000),appear(a,q(r,'.rev-header p'),350,900),appear(a,q(r,'.rev-home-logo'),0,850)]);},1400);
  define('s17',()=>`<div class="rev-browser-sequence">${panel('NAVER → 뉴스 → DART → 공시 원문',`<img class="rev-real-sequence" src="assets/revision/s17-real-browser-steps.gif" alt="실제 네이버와 DART를 조작한 10개 화면의 단계 시퀀스"><div class="rev-step-track"><span>뉴스 검색</span><span>기사 읽기</span><span>공시 검색</span><span>본문 확인</span></div>`)}</div>${source('실제 브라우저 캡처 10장 · 6초 단계 시퀀스, 연속 녹화 아님 · 기사와 공시는 동일 사건의 근거 쌍으로 검증하지 않음')}`,async(r,a)=>{await a.wait(6000);if(!a.signal.aborted)q(r,'.rev-real-sequence').src='assets/revision/s17-last.png';},6000);
  define('s18',()=>`<div class="rev-note-desktop"><div class="rev-file-icon"><b>TXT</b><span>투자 검토 노트</span></div>${panel('투자검토노트-가상예시.txt',`<div class="rev-note-body"><pre class="rev-note-text">${esc(demo.note)}</pre></div>`,'rev-note-window')}</div>${source('실제 TXT 파일 내용 · 가상 투자 기록 · 파일 읽기와 스크롤을 웹에서 재현, 문서 앱 녹화 아님')}`,async(r,a)=>{const win=q(r,'.rev-note-window');await a.animate(win,[{opacity:0,transform:'translate(-430px,160px) scale(.05)'},{opacity:1,transform:'translate(0,0) scale(1)'}],{duration:700});await a.wait(950);const text=q(r,'.rev-note-text');await a.animate(text,[{transform:'translateY(0)'},{transform:`translateY(-${Math.max(0,text.scrollHeight-600)}px)`}],{duration:1800,easing:'ease-in-out'});await a.wait(700);},4200);
  const codeExcerpt=()=>demo.code.slice(demo.code.indexOf('def run_backtest'),demo.code.indexOf('def write_csv'));
  define('s20',()=>`<div class="rev-backtest-layout">${panel('backtest.py · 실제 Python 실행',`<pre class="rev-code rev-run-code"></pre><div class="rev-run-console">실행 준비 · 가상 OHLCV 220개</div>`,'rev-terminal')}${panel('실행 결과 · 가상 데이터',`<div class="rev-result-loading">코드를 실행하면 계산 결과를 표시합니다.</div><div class="rev-live-result" hidden><img src="assets/revision/demo/equity-curve.svg" alt="실제로 계산한 가상 데이터 평가액 곡선"><div class="rev-run-summary"></div><pre class="rev-trades"></pre></div>`,'rev-results')}</div>${source('실제 Python 예시 실행 · 합성 데이터, 실제 투자 성과 아님 · 편집기 입력은 웹 재현')}`,async(r,a)=>{
    const consoleEl=q(r,'.rev-run-console');await typeCode(a,q(r,'.rev-run-code'),codeExcerpt(),2600);if(a.signal.aborted)return;consoleEl.textContent='$ python backtest.py\n실행 중…';
    let data;try{const resp=await fetch('/api/demo/run',{method:'POST',signal:a.signal});if(!resp.ok)throw new Error('실행 서버 응답 '+resp.status);data=await resp.json();}catch(e){if(a.signal.aborted)return;consoleEl.textContent='현재 실행 실패 · '+e.message;q(r,'.rev-result-loading').textContent='현재 실행 결과를 확인하지 못했습니다.';return;}
    if(a.signal.aborted)return;consoleEl.textContent='실행 완료 · '+data.summary.bars+'개 가상 봉\n'+data.summary.execution;q(r,'.rev-result-loading').hidden=true;const out=q(r,'.rev-live-result');out.hidden=false;
    q(r,'.rev-run-summary').textContent=data.summary.runs.map(run=>`${run.fast}/${run.slow}일 규칙 · 가상 체결 ${run.fills}회`).join('  /  ');q(r,'.rev-trades').textContent=data.trades.split('\n').slice(0,5).join('\n');q(r,'.rev-live-result img').src='assets/revision/demo/equity-curve.svg?t='+Date.now();await appear(a,out,0,900);
    if(!a.signal.aborted){const live=q(r,'.rev-run-code'),copy=q(r,'.rev-backtest-layout').cloneNode(true);copy.querySelector('.rev-run-code').innerHTML=`<span style="display:block;transform:translateY(-${live.scrollTop}px)">${esc(live.textContent)}</span>`;window.ATHENA_REVIEW_S20=copy.outerHTML;}
  },5000);
  const miniContents=[['차트','assets/actions/kiwoom-hero4-chart.gif'],['뉴스·공시','assets/revision/s17-real-browser-steps.gif'],['투자 기록',null],['알림','assets/actions/toss-price-alert-off.png'],['코드·검증','assets/revision/demo/equity-curve.svg']];
  const mini=(i)=>{const [label,img]=miniContents[i%miniContents.length];return `<b>${label}</b>${img?`<img src="${img}" alt="${label} 참고 화면">`:`<pre>${esc(demo.note.slice(0,330))}</pre>`}`;};
  const tunnel=()=>`<div class="rev-tunnel"><div class="rev-tunnel-world">${Array.from({length:15},(_,i)=>{const side=i%4,depth=-600-Math.floor(i/4)*800;return `<article class="rev-fly-panel" style="--x:${side===0?-650:side===1?650:side===2?-220:240}px;--y:${side===2?-420:side===3?420:(i%3-1)*180}px;--z:${depth}px;--ry:${side===0?38:side===1?-38:0}deg;--rx:${side===2?-30:side===3?30:0}deg">${mini(i)}</article>`;}).join('')}</div></div>`;
  const chat=()=>`<div class="rev-final-chat"><div class="rev-chat-brand">ATHENA</div><h2>무엇을 함께 살펴볼까요?</h2><div class="rev-final-input"><span>투자에 관해 물어보세요</span><b>↑</b></div><div class="rev-tool-labels"><span>차트</span><span>뉴스·공시</span><span>기록</span><span>알림</span><span>검증</span></div></div>`;
  const settledResult=()=>window.ATHENA_REVIEW_S20||`<div class="rev-backtest-layout">${panel('backtest.py · 저장된 실제 실행',`<pre class="rev-code">${esc(codeExcerpt().split('\n').slice(-17).join('\n'))}</pre>`,'rev-terminal')}${panel('가상 데이터 · 저장된 계산 결과',`<img style="width:100%;margin-top:80px" src="assets/revision/demo/equity-curve.svg" alt="가상 데이터 실제 계산 결과">`)}</div>`;
  define('s21',()=>`${tunnel()}<div class="rev-s20-departure">${settledResult()}</div>${source('투자 작업을 공간으로 연결하는 제품 소개 콘셉트 · 차트는 사용자 제공 WTS2 실제 녹화의 마지막 프레임')}`,async(r,a)=>{await Promise.all([a.animate(q(r,'.rev-tunnel-world'),[{transform:'translate3d(0,0,-1000px) rotateY(-8deg)',opacity:0},{transform:'translate3d(0,0,0) rotateY(0deg)',opacity:1}],{duration:2400}),a.animate(q(r,'.rev-s20-departure'),[{transform:'translate(0,0) scale(1)',opacity:1},{transform:'translate(0,0) scale(.37)',opacity:.8}],{duration:2400})]);},2400);
  define('s22',()=>`${tunnel()}<div class="rev-arriving-tools">${miniContents.map((_,i)=>`<article>${mini(i)}</article>`).join('')}</div>${chat()}${source('ATHENA 제품 소개용 콘셉트 · 실제 제품 실행 화면 아님')}`,async(r,a)=>{
    const hero=q(r,'.rev-final-chat'),arrivals=[...r.querySelectorAll('.rev-arriving-tools article')];hero.style.opacity=0;arrivals.forEach(e=>e.style.opacity=0);
    await a.animate(q(r,'.rev-tunnel-world'),[{transform:'translate3d(0,0,0) rotateY(0)',opacity:1},{transform:'translate3d(-260px,60px,1300px) rotateY(6deg)',opacity:1,offset:.5},{transform:'translate3d(300px,-40px,3400px) rotateY(-5deg)',opacity:0}],{duration:3300,easing:'cubic-bezier(.5,.02,.2,1)'});if(a.signal.aborted)return;
    await Promise.all(arrivals.map((el,i)=>a.animate(el,[{opacity:0,transform:`translate(${[-1400,0,1400,-500,500][i]}px,${[0,-900,0,900,900][i]}px) rotateY(${i%2?35:-35}deg) scale(.8)`},{opacity:.9,offset:.5},{opacity:0,transform:'translate(0,0) rotateY(0) scale(.2)'}],{duration:1800,delay:i*100})).concat(a.animate(hero,[{opacity:0,transform:'scale(.65)'},{opacity:1,transform:'scale(1)'}],{duration:2000,delay:500})));},5900);
  const dissolve=scenes['s09-dust'].play;
  scenes['s09-dust'].play=(root,api)=>{
    const panels=[...root.querySelectorAll('.intro-cs-fragment')].map(el=>el.getBoundingClientRect());
    const field=q(root,'.rev-particles').getBoundingClientRect(),scale=field.width/1920;
    root.querySelectorAll('.rev-particles i').forEach((el,i)=>{
      const area=panels[i%panels.length],target=el.getBoundingClientRect();
      el.style.setProperty('--dx',`${(area.left+seed(i+90)*area.width-target.left)/scale}px`);
      el.style.setProperty('--dy',`${(area.top+seed(i+250)*area.height-target.top)/scale}px`);
    });
    return dissolve(root,api);
  };
  const arrivalRender=scenes.s22.render,arrivalPlay=scenes.s22.play;
  scenes.s22.render=()=>arrivalRender()+`<div class="rev-s20-departure rev-departed">${settledResult()}</div>`;
  scenes.s22.play=async(root,api)=>{await Promise.all([arrivalPlay(root,api),api.animate(q(root,'.rev-departed'),[{opacity:.8,transform:'scale(.37)'},{opacity:0,transform:'translate3d(-260px,60px,500px) scale(1.5)'}],{duration:3300})]);};
  define('s16',()=>`<div class="rev-wts-window">${panel('키움 WTS2 · 실제 차트 조작',`<video class="rev-wts-video" muted playsinline preload="auto" poster="assets/workflows/s16-wts-full-first.png"><source src="assets/workflows/s16-wts-full.mp4" type="video/mp4"></video><img class="rev-wts-still" hidden src="assets/workflows/s16-wts-full-last.png" alt="WTS 실제 녹화 전체 화면 · 영상 마지막 프레임">`)}</div>${source('사용자 제공 WTS2 실제 녹화 · 원본 00:02–00:18 · 2.5배속 · 전체 화면 · 원본 해상도 · 음성 제외')}`,async(root,api)=>{
    const video=q(root,'.rev-wts-video'),still=q(root,'.rev-wts-still');
    if(api.reduced){video.hidden=true;still.hidden=false;return;}
    video.muted=true;video.currentTime=0;
    const finished=new Promise((resolve,reject)=>{
      let timer;
      const cleanup=()=>{clearTimeout(timer);video.removeEventListener('ended',ended);video.removeEventListener('error',failed);api.signal.removeEventListener('abort',cancel);};
      const ended=()=>{cleanup();resolve();};
      const failed=()=>{cleanup();reject(new Error('WTS 영상 재생 실패'));};
      const cancel=()=>{video.pause();cleanup();resolve();};
      video.addEventListener('ended',ended,{once:true});video.addEventListener('error',failed,{once:true});api.signal.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(failed,20000);
    });
    await Promise.all([video.play(),finished]);
    if(!api.signal.aborted){video.pause();video.hidden=true;still.hidden=false;}
  },6400);
  miniContents[0]=['차트','assets/workflows/s16-wts-full-last.png'];
  // Homepage source adaptation: original formulas, finite click-bounded segments.
  const homeEN='I have lifted the mist from your eyes,\nso you can clearly distinguish god from mortal.';
  const homeKO='그대의 눈을 가리던 안개를 걷어냈다.\n신과 인간을 분명히 구별할 수 있도록.';
  const homeFog=()=>'<div class="home-fog home-fog-left"></div><div class="home-fog home-fog-right"></div>';
  const homeQuote=(lang,text='')=>`<div class="home-quote-stage"><div class="home-quote" lang="${lang}"><span class="home-quote-text">${esc(text)}</span><i class="home-quote-caret"></i></div><div class="home-citation"><span>${lang==='en'?'Athena to Diomedes':'아테나가 디오메데스에게'}</span><span>${lang==='en'?'Homer, Iliad · Book 5, lines 127–128':'호메로스, 『일리아스』 · 5권 127–128행'}</span><small>${lang==='en'?'Adapted translation':'발췌 번역'}</small></div></div>`;
  const homeMark=(complete=false)=>`<div class="home-wordmark"><span class="sr-only">ATHENA</span><span class="home-track" aria-hidden="true"><span class="home-guide">ATHENA</span><span class="home-ink"><span class="home-prefix"><span class="home-letters">${complete?'ATHENA':''}</span><i class="home-caret"></i></span></span></span></div>`;
  const flightStars=Array.from({length:420},(_,i)=>({x:Math.sin(i*127.1+4)*1.8,y:Math.cos(i*311.7+9)*1.8,z:.2+(((i*73)%419)/419)*3,size:.4+(i%5)*.18}));
  function drawFlight(canvas,t){
    const ctx=canvas.getContext('2d'),w=1720,h=774;canvas.width=w;canvas.height=h;
    ctx.fillStyle='#02030a';ctx.fillRect(0,0,w,h);
    const rush=Math.max(0,Math.min(1,(t-1300)/1600)),travel=t*.000018+rush**3*3.5,focal=Math.max(w,h)*.42;
    for(const star of flightStars){const z=((((star.z-travel)%3.2)+3.2)%3.2)+.07,tail=.003+rush**3*.32;ctx.strokeStyle=`rgba(209,222,255,${Math.min(.9,.25+1/z*.18)})`;ctx.lineWidth=star.size;ctx.beginPath();ctx.moveTo(w/2+star.x/(z+tail)*focal,h/2+star.y/(z+tail)*focal);ctx.lineTo(w/2+star.x/z*focal,h/2+star.y/z*focal);ctx.stroke();}
    const glow=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,35+rush**5*Math.max(w,h)*1.5);
    [[0,'#fff'],[.025,'#f2f5ff'],[.13,'rgba(194,212,255,.8)'],[.45,'rgba(111,143,232,.16)'],[1,'rgba(100,130,255,0)']].forEach(([p,c])=>glow.addColorStop(p,c));ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
    ctx.strokeStyle=`rgba(235,241,255,${.65+Math.sin(t/240)*.2})`;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(w/2-14,h/2);ctx.lineTo(w/2+14,h/2);ctx.moveTo(w/2,h/2-14);ctx.lineTo(w/2,h/2+14);ctx.stroke();ctx.fillStyle=`rgba(255,255,255,${Math.max(0,Math.min(1,(t-2700)/600))})`;ctx.fillRect(0,0,w,h);
  }
  async function flight(api,canvas,from,to){
    if(api.reduced){drawFlight(canvas,to);return;}
    await new Promise(resolve=>{let frame=0,elapsed=0,previous=performance.now();const stop=()=>{cancelAnimationFrame(frame);api.signal.removeEventListener('abort',stop);resolve();};const tick=now=>{if(api.signal.aborted){stop();return;}if(!document.hidden)elapsed+=Math.min(now-previous,100);previous=now;drawFlight(canvas,Math.min(to,from+elapsed));if(elapsed>=to-from)stop();else frame=requestAnimationFrame(tick);};api.signal.addEventListener('abort',stop,{once:true});drawFlight(canvas,from);if(api.signal.aborted)stop();else frame=requestAnimationFrame(tick);});
  }
  // Drift runs only for the quotation playback interval, then pauses with the cue.
  async function quoteInput(r,a,text,ms){
    const fogs=[q(r,'.home-fog-left'),q(r,'.home-fog-right')];
    const motions=a.reduced?[]:fogs.map((el,i)=>el.animate([{translate:'0px 0px'},{translate:i?'-69px 31px':'86px -23px'}],{duration:i?11000:9000,easing:'ease-in-out',fill:'both'}));
    const cancel=()=>motions.forEach(m=>m.cancel());a.signal.addEventListener('abort',cancel,{once:true});
    try{await a.type(q(r,'.home-quote-text'),text,ms);if(a.signal.aborted)return;q(r,'.home-quote-caret').style.opacity='0';await appear(a,q(r,'.home-citation'),0,500);}finally{motions.forEach(m=>a.signal.aborted?m.cancel():m.pause());a.signal.removeEventListener('abort',cancel);}
  }
  define('s10',()=>'<canvas class="home-flight" aria-hidden="true"></canvas>',async(r,a)=>flight(a,q(r,'.home-flight'),0,2700),2700);
  define('s11-en',()=>`<div class="home-intro">${homeFog()}${homeQuote('en')}<canvas class="home-flight home-flight-veil" aria-hidden="true"></canvas></div>`,async(r,a)=>{q(r,'.home-citation').style.opacity=0;await flight(a,q(r,'.home-flight'),2700,3300);if(a.signal.aborted)return;q(r,'.home-flight').hidden=true;await quoteInput(r,a,homeEN,2700);},3800);
  define('s11-ko',()=>`<div class="home-intro">${homeFog()}${homeQuote('en',homeEN)}</div>`,async(r,a)=>{
    const text=q(r,'.home-quote-text'),cite=q(r,'.home-citation');cite.style.opacity=0;
    if(!a.reduced){const start=performance.now();while(!a.signal.aborted){const p=Math.min(1,(performance.now()-start)/800);text.textContent=homeEN.slice(0,Math.floor(homeEN.length*(1-p)));if(p===1)break;await a.wait(24);}}
    if(a.signal.aborted)return;q(r,'.home-quote-stage').outerHTML=homeQuote('ko');q(r,'.home-citation').style.opacity=0;await a.wait(300);if(a.signal.aborted)return;await quoteInput(r,a,homeKO,2200);
  },3800);
  function drawHomeParticles(canvas){
    const ctx=canvas.getContext('2d'),w=1720,h=774;canvas.width=w;canvas.height=h;
    for(let i=0;i<300;i++){const angle=i*2.399963+Math.sin(i*.7)*.25,radius=Math.sqrt((i+.5)/300),wave=Math.sin(angle*3+radius*9)*18,x=w/2+Math.cos(angle)*(radius*w*.75+wave),y=h/2+Math.sin(angle)*(radius*h*.8+wave),central=Math.abs(x-w/2)<w*.36&&y>h*.3&&y<h*.73;ctx.globalAlpha=central?.14:.35+radius*.4;ctx.strokeStyle=i%7===0?'#ee137b':i%4===0?'#9b9fe6':'#4051df';ctx.lineWidth=1+radius*2;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(angle)*radius*4,y+Math.sin(angle)*radius*4);ctx.stroke();}
  }
  const homeSurface=(complete=false)=>`<div class="home-surface"><canvas class="home-particles" aria-hidden="true"></canvas>${homeMark(complete)}</div>`;
  define('s12',()=>`${homeSurface()}<div class="home-clearing">${homeFog()}${homeQuote('ko',homeKO)}</div>`,async(r,a)=>{
    drawHomeParticles(q(r,'.home-particles'));q(r,'.home-quote-caret').style.opacity='0';
    await Promise.all([a.animate(q(r,'.home-quote-stage'),[{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-12px)'}],{duration:650}),...[...r.querySelectorAll('.home-fog')].map((e,i)=>a.animate(e,[{opacity:.85,transform:'translateX(0) scale(1)'},{opacity:0,transform:`translateX(${i?1118:-1118}px) scale(1.2)`}],{duration:1600,easing:'cubic-bezier(.22,.7,.2,1)'})),a.animate(q(r,'.home-clearing'),[{backgroundColor:'#fff'},{backgroundColor:'transparent'}],{duration:1400})]);
    if(a.signal.aborted)return;q(r,'.home-clearing').hidden=true;
    await document.fonts.load('300 148px Daki');if(a.signal.aborted)return;
    const letters=q(r,'.home-letters');if(a.reduced){letters.textContent='ATHENA';return;}await a.wait(450);
    for(let i=1;i<=6;i++){if(a.signal.aborted)return;letters.textContent='ATHENA'.slice(0,i);if(i<6)await a.wait(210);}
    // Static completed caret preserves the hold contract; original homepage blinks.
  },3100);
  define('s13',()=>homeSurface(true),async(r,a)=>{drawHomeParticles(q(r,'.home-particles'));await Promise.all([appear(a,q(r,'.rev-header h1'),0,1000),appear(a,q(r,'.rev-header p'),350,900)]);},1250);
  // Actual speech frames captured during source playback, with their original time intervals.
  define('s08',()=>`<div class="rev-interview"><div class="rev-interview-frame rev-speech-frame"><video class="rev-wts-video" muted playsinline preload="auto" poster="assets/revision/boris-speech-first.png"><source src="assets/revision/boris-speech-captured.mp4" type="video/mp4"></video><img class="rev-wts-still" hidden src="assets/revision/boris-speech-last.png" alt="Boris Cherny 실제 발언 마지막 캡처"></div><blockquote>“we’re laser focused on building the best product for the best engineers.”<p>우리는 최고의 엔지니어를 위한 최고의 제품을 만드는 데 집중하고 있습니다.</p><cite>Boris Cherny</cite></blockquote></div>${source('Every · AI & I · 49:56–50:03 실제 재생 화면 캡처 · 9프레임 / 약 6.8초 · 무음 · 원본 30fps 영상 아님')}`,scenes.s16.play,6820);
  // One consistent header in every visual except the approved opening question.
  const dark=new Set(['s04-assembly','s04-c','s09','s09-dust','s10','s19','s21']);
  Object.entries(headers).forEach(([id,[title,description]])=>{
    const def=scenes[id];if(!def)return;const render=def.render;
    def.render=()=>`<section class="rev-stage ${dark.has(id)?'rev-dark':''} rev-scene-${id}"><header class="rev-header"><h1>${title}</h1><p>${description}</p></header><div class="${def.revision?'rev-main':'rev-legacy'}">${render()}</div></section>`;
  });
})();
