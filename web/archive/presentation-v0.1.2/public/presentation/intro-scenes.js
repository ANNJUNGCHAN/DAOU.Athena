/* Click-bounded opening scenes. Original script and source quotations are preserved. */
(() => {
  'use strict';
  const scenes = window.ATHENA_SCENES ||= {};
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const wrap = (kind, body) => `<div class="intro-scene intro-${kind}">${body}</div>`;
  const ease = 'cubic-bezier(.22,1,.36,1)';
  const enter = (api, el, delay = 0, duration = 700) => api.animate(el, [{opacity:0,transform:`translateY(${api.reduced?0:28}px)`},{opacity:1,transform:'translateY(0)'}], {duration:api.reduced?120:duration,delay:api.reduced?0:delay,easing:ease,fill:'both'});
  const revealAll = (root, api, sel = '.intro-reveal', gap = 180) => Promise.all([...root.querySelectorAll(sel)].map((el,i)=>enter(api,el,i*gap)));
  function bars(count, compact = false) {
    return `<div class="intro-code-lines ${compact?'intro-code-short':''}" aria-label="추상 코드 표현">${Array.from({length:count},(_,i)=>`<div class="intro-code-line" style="--indent:${[0,0,24,48,24,48,48,24,0][i%9]}px"><span class="intro-code-num">${String(i+1).padStart(2,'0')}</span><span class="intro-code-symbol">${['{','&lt;','[','::','(',')','&gt;',';','}'][i%9]}</span><i style="width:${[170,240,115,195,85,215,135][i%7]}px"></i><i class="intro-code-muted" style="width:${[90,45,125,70][i%4]}px"></i><span class="intro-code-symbol">${i%3===0?';':'_'}</span></div>`).join('')}</div>`;
  }
  const assembly = () => `<div class="intro-language-col intro-assembly"><h2>Assembly</h2>${bars(17)}</div>`;
  scenes['s04-assembly'] = { title:'Assembly', duration:1900, render:()=>wrap('language',assembly()), play:async(root,api)=>{
    root.querySelectorAll('.intro-code-line').forEach(el=>el.style.opacity=0);
    await enter(api,root.querySelector('h2'));
    if(api.signal.aborted)return;
    await revealAll(root,api,'.intro-code-line',45);
  }};
  scenes['s04-c'] = { title:'Assembly → C', duration:2100, render:()=>wrap('language',`${assembly()}<div class="intro-language-transition intro-reveal" aria-hidden="true">→</div><div class="intro-language-col intro-c"><h2 class="intro-reveal">C</h2>${bars(5,true)}</div>`),play:async(root,api)=>{
    root.querySelectorAll('.intro-c .intro-code-line').forEach(el=>el.style.opacity=0);
    await revealAll(root,api,'.intro-reveal',180);
    if(api.signal.aborted)return;
    await revealAll(root,api,'.intro-c .intro-code-line',100);
  }};
  const shopRequest = '상품, 주문, 결제의 책임을 분리하고, 정규화된 데이터 모델과 트랜잭션 경계를 설계해서 쇼핑몰을 구현해줘.';
  scenes.s05 = {title:'자연어 → 쇼핑몰',duration:4200,render:()=>wrap('shop',`<div class="intro-shop-code">${['&lt;product /&gt;','&lt;order /&gt;','&lt;payment /&gt;','function checkout…','schema / routes…'].map(t=>`<div>${t}</div>`).join('')}</div><div class="intro-shop-main"><p class="intro-shop-request"><span class="intro-typed"></span><i class="intro-caret"></i></p><div class="intro-shop-window intro-reveal"><header><b>SHOP</b><span>상품　　주문　　결제</span><span class="intro-shop-bag">Bag　0</span></header><div class="intro-shop-hero"><div><small>DAILY OBJECTS</small><h3>일상의 새로운 발견</h3><span>Collection 01</span></div><div class="intro-product-vase"></div></div><div class="intro-shop-products">${['일상','공간','취향'].map((t,i)=>`<div><div class="intro-product-object intro-product-${i}"></div><span>${t}</span></div>`).join('')}</div></div></div>`),play:async(root,api)=>{
    const shop=root.querySelector('.intro-shop-window');shop.style.opacity=0;
    await enter(api,root.querySelector('.intro-shop-code'),0,450);
    if(api.signal.aborted)return;
    await api.type(root.querySelector('.intro-typed'),shopRequest,api.reduced?0:2100);
    if(api.signal.aborted)return;
    root.querySelector('.intro-caret').style.opacity=0;
    await enter(api,shop,0,1050);
  }};
  const docScene = (isToss) => {
    const file=isToss?'toss-docs.png':'kis-home.png';
    const name=isToss?'토스증권':'한국투자증권';
    return {title:name+' 공식 문서',duration:1500,render:()=>wrap('docs',`<div class="intro-doc-brand intro-reveal ${isToss?'intro-brand-toss':'intro-brand-kis'}"><img src="assets/intro/${file}" alt="${name} 공식 사이트 헤더" /></div><div class="intro-doc-main intro-reveal"><img src="assets/intro/${file}" alt="${name} ${isToss?'Open API 가이드':'Open API 개발자센터'} 원본 캡처" /></div>${isToss?`<div class="intro-doc-detail intro-reveal"><img src="assets/intro/${file}" alt="토스증권 API 카테고리 원문 확대" /></div>`:''}`),play:async(root,api)=>revealAll(root,api,'.intro-reveal',250)};
  };
  scenes['s07-kis']=docScene(false);scenes['s07-toss']=docScene(true);
  scenes.s08={title:'Boris Cherny · AI & I',duration:1200,render:()=>wrap('interview',`<header class="intro-interview-head intro-reveal"><strong>AI & I <span>/ Every</span></strong><small>Dan Shipper 인터뷰 · Every</small></header><div class="intro-interview-media intro-reveal"><div class="intro-video-frame"><img class="intro-video-poster" src="assets/intro/boris-official-frame-50m01s.png" alt="Every 공식 인터뷰의 50분 1초 실제 영상 프레임"><div class="intro-video-actions"><a href="https://www.youtube.com/watch?v=IDSAMqip6ms&amp;t=2996s" target="_blank" rel="noopener noreferrer">49:56 원본 영상 보기 ↗</a><button class="intro-embed-open" type="button">슬라이드에서 열기</button></div><div class="intro-embed-host" hidden></div></div><div class="intro-interview-source"><span>공식 자막 49:56–50:03 · 원본 50:01 프레임</span><button class="intro-embed-close" type="button" hidden>정지 화면으로</button></div></div><div class="intro-interview-quote intro-reveal"><blockquote>“we’re laser focused on building the best product for the best engineers.”</blockquote><p>우리는 최고의 엔지니어를 위한 최고의 제품을 만드는 데 집중하고 있습니다.</p><footer>Boris Cherny<span>Claude Code 개발자</span></footer></div>`),play:async(root,api)=>{const host=root.querySelector('.intro-embed-host'),close=root.querySelector('.intro-embed-close');root.querySelector('.intro-embed-open').addEventListener('click',()=>{host.hidden=false;close.hidden=false;host.innerHTML='<iframe class="intro-interview-player" title="Every 공식 인터뷰 · 49:56" src="https://www.youtube.com/embed/IDSAMqip6ms?start=2996&amp;end=3003&amp;autoplay=0&amp;playsinline=1&amp;rel=0" allow="encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';});close.addEventListener('click',()=>{host.innerHTML='';host.hidden=true;close.hidden=true;});await revealAll(root,api,'.intro-reveal',200);}};
  const fragments = [
    ['Architecture','<div class="intro-diagram-stack"><b>CLIENT</b><span>↓</span><b>GATEWAY</b><span>↙　↓　↘</span><div><b>SERVICE</b><b>CACHE</b><b>EVENT</b></div></div>'],
    ['Data model','<div class="intro-erd"><div><b>ENTITY A</b><p>id　PK<br>created_at<br>relation_id　FK</p></div><span>1 — n</span><div><b>ENTITY B</b><p>id　PK<br>type<br>updated_at</p></div></div>'],
    ['Source code','<pre>async function resolve(context) {\n  const state = await load(context);\n  return evaluate(state);\n}\n\nexport { resolve };</pre>'],
    ['Algorithms','<div class="intro-tree"><b>O(n log n)</b><p>○</p><p>╱　　　 ╲</p><p>○　　　　 ○</p><p>╱　╲　　 ╱　╲</p><p>○　 ○　 ○　 ○</p></div>'],
    ['Operating system','<div class="intro-os"><span>PROCESS 01</span><span>PROCESS 02</span><span>THREAD</span><b>SCHEDULER</b><span>VIRTUAL MEMORY</span><b>KERNEL</b></div>'],
    ['Network','<div class="intro-network"><b>Application</b><b>Transport</b><b>Network</b><b>Data link</b><small>TCP · TLS · DNS</small></div>'],
    ['Distributed systems','<div class="intro-distributed"><span>NODE A</span><span>NODE B</span><span>NODE C</span><p>REPLICATION　/　CONSENSUS</p><small>consistency · availability</small></div>'],
    ['Testing','<pre>describe("state transition")\n  input → expected\n  boundary conditions\n  concurrent updates\n  failure recovery</pre>'],
    ['Performance','<div class="intro-perf"><div>'+[24,38,32,55,48,69,63,82,75,92,86].map(v=>`<i style="height:${v}%"></i>`).join('')+'</div><small>latency　　throughput　　memory</small></div>'],
  ];
  function csField(){return `<div class="intro-cs-field">${fragments.map(([title,body],i)=>`<article class="intro-cs-fragment intro-cs-${i}" data-fragment="${i}"><h3>${title}</h3>${body}</article>`).join('')}</div>`;}
  function stars(){return `<div class="intro-starfield">${Array.from({length:170},(_,i)=>{const x=((i*167+79)%1901),y=((i*281+43)%1061);return `<i class="intro-star" style="left:${x}px;top:${y}px;--size:${i%9===0?3:1.5}px;opacity:${.22+(i%7)*.09}"></i>`;}).join('')}<div class="intro-central-star"></div></div>`;}
  scenes.s09={title:'컴퓨터 사이언스의 지식 부담',duration:2500,render:()=>wrap('cs',csField()),play:async(root,api)=>revealAll(root,api,'.intro-cs-fragment',160)};
  scenes['s09-dust']={title:'지식의 단편에서 별로',duration:2700,render:()=>wrap('space',`${stars()}${csField()}<div class="intro-dust">${Array.from({length:135},(_,i)=>`<i style="left:${150+(i*173)%1610}px;top:${120+(i*217)%830}px;--dx:${Math.sin(i*12.7)*580}px;--dy:${Math.cos(i*7.3)*370}px"></i>`).join('')}</div>`),play:async(root,api)=>{
    await Promise.all([
      api.animate(root.querySelector('.intro-starfield'),[{opacity:0},{opacity:1}],{duration:api.reduced?120:2300,fill:'both'}),
      ...[...root.querySelectorAll('.intro-cs-fragment')].map((el,i)=>api.animate(el,[{opacity:1,filter:'blur(0px)',transform:'scale(1)'},{opacity:0,filter:api.reduced?'none':'blur(10px)',transform:api.reduced?'none':`translate(${Math.sin(i)*80}px,${Math.cos(i)*60}px) scale(.95)`}],{duration:api.reduced?120:1500,delay:api.reduced?0:i*50,fill:'both',easing:'ease-in'})),
      ...[...root.querySelectorAll('.intro-dust i')].map((el,i)=>api.animate(el,[{opacity:0,transform:'translate(0,0) scale(2)'},{opacity:.6,offset:.25},{opacity:0,transform:api.reduced?'none':'translate(var(--dx),var(--dy)) scale(.4)'}],{duration:api.reduced?120:2400,delay:api.reduced?0:(i%7)*45,fill:'both',easing:ease}))
    ]);
  }};
  scenes.s10={title:'중앙의 별',duration:5500,render:()=>wrap('space',stars()),play:async(root,api)=>{
    await Promise.all([api.animate(root.querySelector('.intro-starfield'),[{transform:'scale(1)'},{transform:api.reduced?'scale(1)':'scale(1.55)'}],{duration:api.reduced?150:5500,easing:'cubic-bezier(.25,.1,.25,1)',fill:'both'}),api.animate(root.querySelector('.intro-central-star'),[{transform:'translate(-50%,-50%) scale(1)'},{transform:'translate(-50%,-50%) scale(3.6)'}],{duration:api.reduced?150:5500,easing:'ease-in-out',fill:'both'})]);
  }};
  const en='I have lifted the mist from your eyes,\nso you can clearly distinguish god from mortal.';
  const ko='그대의 눈을 가리던 안개를 걷어냈다.\n신과 인간을 분명히 구별할 수 있도록.';
  const fog=()=>'<div class="intro-fog intro-fog-left"></div><div class="intro-fog intro-fog-right"></div>';
  function quote(lang){const english=lang==='en';return `<div class="intro-quote-stage"><div class="intro-quote" lang="${lang}"><span class="intro-typed"></span><i class="intro-caret"></i></div><div class="intro-citation"><span>${english?'Athena to Diomedes':'아테나가 디오메데스에게'}</span><span>${english?'Homer, Iliad · Book 5, lines 127–128':'호메로스, 『일리아스』 · 5권 127–128행'}</span><small>${english?'Adapted translation':'발췌 번역'}</small></div></div>`;}
  for(const lang of ['en','ko']) scenes['s11-'+lang]={title:lang==='en'?'Athena to Diomedes':'아테나가 디오메데스에게',duration:lang==='en'?4700:2900,render:()=>wrap('quotation',`${fog()}${quote(lang)}${lang==='en'?'<div class="intro-space-veil">'+stars()+'</div>':''}`),play:async(root,api)=>{
    const cite=root.querySelector('.intro-citation');cite.style.opacity=0;
    if(lang==='en')await api.animate(root.querySelector('.intro-space-veil'),[{opacity:1,transform:'scale(1)'},{opacity:1,offset:.6,transform:'scale(3)'},{opacity:0,transform:'scale(6)'}],{duration:api.reduced?150:1600,easing:'ease-in',fill:'both'});
    if(api.signal.aborted)return;
    await api.type(root.querySelector('.intro-typed'),lang==='en'?en:ko,api.reduced?0:lang==='en'?2700:2200);
    if(api.signal.aborted)return;
    root.querySelector('.intro-caret').style.opacity=0;
    await enter(api,cite,0,500);
  }};
  const brand=()=>'<img class="intro-athena-brand" src="assets/intro/athena.png" alt="ATHENA" />';
  scenes.s12={title:'ATHENA',duration:2400,render:()=>wrap('brand',`${brand()}<div class="intro-clearing-layer">${fog()}<div class="intro-clearing-copy">${esc(ko).replace('\n','<br>')}</div></div>`),play:async(root,api)=>{
    await Promise.all([api.animate(root.querySelector('.intro-clearing-copy'),[{opacity:1},{opacity:0}],{duration:api.reduced?120:650,fill:'both'}),...[...root.querySelectorAll('.intro-fog')].map((el,i)=>api.animate(el,[{transform:'translateX(0)',opacity:1},{transform:api.reduced?'none':`translateX(${i===0?-1350:1350}px)`,opacity:0}],{duration:api.reduced?120:2200,easing:ease,fill:'both'})),api.animate(root.querySelector('.intro-clearing-layer'),[{backgroundColor:'#eef0f4'},{backgroundColor:'transparent'}],{duration:api.reduced?120:1900,fill:'both'}),api.animate(root.querySelector('.intro-athena-brand'),[{opacity:0,transform:'scale(.96)'},{opacity:1,transform:'scale(1)'}],{duration:api.reduced?120:1600,delay:api.reduced?0:600,easing:ease,fill:'both'})]);
  }};
  scenes.s13={title:'ATHENA 홈',duration:1500,render:()=>wrap('home',`<div class="intro-home-brand">${brand()}</div><div class="intro-home-copy"><h1 class="intro-reveal">투자의 시야를 가리던<br>안개를 걷어내다.</h1><p class="intro-reveal">정보 너머의 맥락이 보이도록.</p></div>`),play:async(root,api)=>revealAll(root,api,'.intro-reveal',250)};
})();
