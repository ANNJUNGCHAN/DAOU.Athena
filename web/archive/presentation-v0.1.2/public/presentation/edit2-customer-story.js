/* Development cards -> pixel dust -> star field -> ATHENA.
 * Same deterministic geometry across cues; abort-safe, reduced-motion aware.
 * The protected manuscript and narration data are never changed here.
 */
(() => {
'use strict';
const scenes=window.ATHENA_SCENES,data=window.ATHENA_REVIEW_DATA,W=1920,H=1080;
const clamp=x=>Math.max(0,Math.min(1,x)),ease=x=>{x=clamp(x);return x*x*(3-2*x);};
const rand=n=>{const v=Math.sin(n*127.1+71.3)*43758.5453;return v-Math.floor(v);};
const topics=[
['프로그래밍 언어','LANGUAGES','async / await','Python · JavaScript','code'],
['시스템 아키텍처','ARCHITECTURE','Client → Service → Storage','계층 · 의존성 · 책임 분리','nodes'],
['API 연결','INTEGRATION','GET /market/quotes','요청 · 응답 · 호출 제한','nodes'],
['인증과 권한','AUTHENTICATION','access_token / refresh_token','키 관리 · 만료 · 권한','lock'],
['데이터베이스','DATABASE','SELECT / JOIN / INDEX','저장 · 관계 · 트랜잭션','database'],
['오류 해결','DEBUGGING','Traceback · timeout','원인 분석 · 복구 · 재시도','bug'],
['MCP 서버','MODEL CONTEXT','tools/list → tools/call','서버 설정 · 도구 스키마','nodes'],
['CLI 명령','COMMAND LINE','$ connect --server market','명령어 · 인자 · 실행 환경','code'],
['비동기 처리','CONCURRENCY','Promise.all / event loop','동시 요청 · 순서 · 대기','nodes'],
['환경 구성','ENVIRONMENT','PATH / .env / packages','의존성 · 버전 · 설치','code'],
['데이터 변환','DATA PIPELINE','JSON → normalize → validate','타입 · 누락값 · 형식','database'],
['실시간 구독','STREAMING','WebSocket / reconnect','연결 유지 · 이벤트 처리','nodes'],
['테스트','VERIFICATION','assert result.is_valid','경계 조건 · 통합 검증','check'],
['예외와 재시도','ERROR HANDLING','try / catch / backoff','실패 처리 · 중복 방지','bug'],
['로그 분석','OBSERVABILITY','INFO → WARN → ERROR','이력 · 추적 · 진단','code'],
['배포와 운영','OPERATIONS','build → deploy → monitor','프로세스 · 배포 · 유지보수','nodes'],
['알고리즘','LOGIC','if condition: evaluate()','조건 · 흐름 · 상태','nodes'],
['보안','SECURITY','secrets / permission','민감 정보 · 접근 제어','lock']];
const planes=[
[145,310,350,-.065,.94],[705,260,430,.025,1],[1340,310,375,.065,.96],
[-90,205,245,-.13,.30],[1460,720,360,.055,.9],[170,725,390,-.035,1],
[1210,705,210,-.08,.36],[40,520,245,.09,.65],[1430,115,235,.09,.27],
[410,110,235,-.09,.27],[670,825,295,.06,.68],[1080,125,210,.02,.25],
[1510,530,310,-.06,.65],[990,815,250,-.06,.50],[1730,285,255,.1,.34],
[780,80,250,.025,.2],[455,830,210,-.13,.32],[1755,770,220,.13,.26]];
const stars=Array.from({length:360},(_,i)=>({x:rand(i+10)*W,y:rand(i+910)*H,z:1.04+rand(i+30)*2.6,r:.6+rand(i+55)*1.4,a:.2+rand(i+500)*.65}));
const heading=(t,s)=>'<header class="e4-heading"><h1>'+t+'</h1><p>'+s+'</p></header>';
const shell=(mode,copy)=>'<section class="cc-root e4-stage e4-'+mode+'" data-fullscreen="true"><canvas class="e4-canvas" width="1920" height="1080" aria-hidden="true"></canvas>'+copy+'</section>';
const context=r=>r.querySelector('.e4-canvas').getContext('2d');
function line(c,pts){c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
function icon(c,type){
 c.save();c.strokeStyle='#9bc6ff';c.lineWidth=2;c.lineCap='round';c.lineJoin='round';
 if(type==='code'){line(c,[[17,4],[4,17],[17,30]]);line(c,[[35,4],[48,17],[35,30]]);line(c,[[29,0],[23,34]]);}
 else if(type==='nodes'){for(const [x,y] of [[0,10],[36,0],[36,24]])c.strokeRect(x,y,15,12);line(c,[[15,16],[26,16],[26,6],[36,6]]);line(c,[[26,16],[26,30],[36,30]]);}
 else if(type==='database'){c.beginPath();c.ellipse(25,5,22,7,0,0,Math.PI*2);c.stroke();line(c,[[3,5],[3,30]]);line(c,[[47,5],[47,30]]);for(const y of [18,30]){c.beginPath();c.ellipse(25,y,22,7,0,0,Math.PI);c.stroke();}}
 else if(type==='lock'){c.strokeRect(8,16,34,26);c.beginPath();c.arc(25,16,11,Math.PI,0);c.stroke();line(c,[[25,25],[25,32]]);}
 else if(type==='check'){c.strokeRect(4,3,36,33);line(c,[[12,18],[21,27],[35,10]]);}
 else{c.beginPath();c.ellipse(25,21,12,16,0,0,Math.PI*2);c.stroke();for(const y of [10,22,32]){line(c,[[5,y],[13,y+2]]);line(c,[[37,y+2],[46,y]]);}line(c,[[20,5],[15,0]]);line(c,[[30,5],[35,0]]);}
 c.restore();
}
function drawCard(c,i,alpha=1){
 const [x,y,w,rot,depth]=planes[i],t=topics[i],s=w/360;
 c.save();c.globalAlpha=depth*alpha;c.translate(x+w/2,y+110*s);c.rotate(rot);c.scale(s,s);c.translate(-180,-110);
 const g=c.createLinearGradient(0,0,360,220);g.addColorStop(0,'#1b2639');g.addColorStop(1,'#0a101b');
 c.fillStyle=g;c.strokeStyle='#3f648b';c.lineWidth=1;c.beginPath();c.roundRect(0,0,360,220,18);c.fill();c.stroke();
 c.fillStyle='#7191b6';c.font='11px Consolas';c.fillText(t[1],24,27);
 c.save();c.translate(25,50);icon(c,t[4]);c.restore();
 c.fillStyle='#edf4ff';c.font='28px "Noto Sans KR",sans-serif';c.fillText(t[0],95,78);
 c.strokeStyle='#2a3b52';line(c,[[24,106],[336,106]]);
 c.fillStyle='#a4c7ed';c.font='15px Consolas,monospace';c.fillText(t[2],24,140);
 c.fillStyle='#8695ad';c.font='15px "Noto Sans KR",sans-serif';c.fillText(t[3],24,177);c.restore();
}
function base(c){c.globalAlpha=1;c.fillStyle='#050911';c.fillRect(0,0,W,H);}
function field(c,travel=0,alpha=1){
 c.save();c.globalAlpha=alpha;
 for(const s of stars){
  const f=s.z/Math.max(.008,s.z-travel),x=960+(s.x-960)*f,y=540+(s.y-540)*f;
  if(x<0||x>W||y<0||y>H)continue;
  c.fillStyle='rgba(189,214,246,'+s.a+')';c.beginPath();c.arc(x,y,s.r*Math.min(f,2),0,Math.PI*2);c.fill();
  if(travel>.45){c.strokeStyle='rgba(175,205,248,'+(s.a*.38)+')';c.lineWidth=s.r*.5;line(c,[[x,y],[x+(x-960)*travel*.025,y+(y-540)*travel*.025]]);}
 }
 const r=3/(1-Math.min(.998,travel)),halo=Math.max(26,r*9);
 const g=c.createRadialGradient(960,540,0,960,540,halo);g.addColorStop(0,'rgba(247,251,255,.98)');g.addColorStop(.07,'rgba(214,232,255,.8)');g.addColorStop(.25,'rgba(111,158,230,.20)');g.addColorStop(1,'rgba(93,136,202,0)');
 c.fillStyle=g;c.fillRect(960-halo,540-halo,halo*2,halo*2);c.fillStyle='#f4f8ff';c.beginPath();c.arc(960,540,Math.max(1.8,r*.45),0,Math.PI*2);c.fill();c.restore();
}
function cardField(c,count=18,p=1){
 base(c);field(c,0,.12);
 [...Array(count).keys()].sort((a,b)=>planes[a][4]-planes[b][4]).forEach(i=>drawCard(c,i,ease(p*1.7-i*.035)));
}
function animate(api,ms,draw){
 if(api.signal.aborted)return Promise.resolve();
 if(api.reduced){draw(1);return Promise.resolve();}
 return new Promise((resolve,reject)=>{
  let raf=0,start;
  const cleanup=()=>{cancelAnimationFrame(raf);api.signal.removeEventListener('abort',abort);};
  const abort=()=>{cleanup();resolve();};
  const frame=t=>{
   if(api.signal.aborted){abort();return;}
   try{start??=t;const p=clamp((t-start)/ms);draw(p);if(p<1)raf=requestAnimationFrame(frame);else{cleanup();resolve();}}
   catch(error){cleanup();reject(error);}
  };
  api.signal.addEventListener('abort',abort,{once:true});raf=requestAnimationFrame(frame);
 });
}
const labels={s09:'S09-A','s09-dust':'S09-B',s10:'S10','s11-en':'S11-A','s11-ko':'S11-B',s12:'S12'};
const titles={s09:'AI를 투자에 활용하고 싶은 일반 투자자','s09-dust':'투자 지식에 더해지는 개발 역량',s10:'투자자가 직접 떠안아야 하는 개발 부담','s11-en':'개발 부담을 걷어내고','s11-ko':'투자 판단에 집중할 수 있도록',s12:'ATHENA'};
function define(id,mode,copy,duration,play){scenes[id]={title:titles[id],fullscreen:true,ownHeader:true,duration,render:()=>shell(mode,copy),play};}
define('s09','customer','<div class="e4-customer"><p>AI를 투자에 활용하고 싶은</p><h1>일반 투자자</h1><div>초보자부터 경험 많은 투자자까지</div><small>소프트웨어를 직접 개발하는 엔지니어는 아닙니다.</small></div>',1500,async(r,a)=>{
 const c=context(r);base(c);[3,8,9,11,14,17].forEach(i=>drawCard(c,i,.25));
 await a.animate(r.querySelector('.e4-customer'),[{opacity:0,transform:'translateY(20px)'},{opacity:1,transform:'translateY(0)'}],{duration:1100});
});
const knowledge='<div class="sr-only">'+topics.map(t=>t[0]).join(', ')+'</div>';
define('s09-dust','cards',heading(titles['s09-dust'],'도구를 연결하고, 시스템을 구성하며, 오류를 해결하는 능력까지.')+knowledge,2600,async(r,a)=>{
 await document.fonts.ready;if(a.signal.aborted)return;await animate(a,2600,p=>cardField(context(r),12,p));
});
define('s10','burden',heading(titles.s10,'API · MCP · CLI가 제공되어도, 직접 만들어야 할 작업은 남아 있습니다.')+knowledge+'<div class="e4-problem"><span>투자를 하기 위해</span><strong>개발까지 해야 한다면.</strong></div>',1800,async(r,a)=>{
 await document.fonts.ready;if(a.signal.aborted)return;const c=context(r);
 await animate(a,1800,p=>{base(c);[...Array(18).keys()].sort((a,b)=>planes[a][4]-planes[b][4]).forEach(i=>drawCard(c,i,i<12?1:ease(p*1.5-(i-12)*.08)));});
});
let dustCache=null;
function dust(){
 if(dustCache)return dustCache;
 const layer=document.createElement('canvas');layer.width=W;layer.height=H;const c=layer.getContext('2d',{willReadFrequently:true});
 [...Array(18).keys()].sort((a,b)=>planes[a][4]-planes[b][4]).forEach(i=>drawCard(c,i));
 const pixels=c.getImageData(0,0,W,H).data,points=[];
 for(let y=0;y<H;y+=5)for(let x=0;x<W;x+=5){
  const k=(y*W+x)*4,light=Math.max(pixels[k],pixels[k+1],pixels[k+2]);
  if(pixels[k+3]>35&&light>65){const n=points.length,star=stars[n%stars.length];points.push({x,y,a:pixels[k+3]/255,tx:star.x,ty:star.y,dx:(rand(n+220)-.5)*700,dy:(rand(n+380)-.5)*400,size:1+rand(n+900)*1.5});}
 }
 dustCache={layer,points};return dustCache;
}
define('s11-en','dissolve',heading('개발 부담 없이,','자신의 투자 판단에 집중할 수 있도록.'),5100,async(r,a)=>{
 await document.fonts.ready;if(a.signal.aborted)return;
 const c=context(r),h=r.querySelector('.e4-heading');
 if(a.reduced){base(c);field(c);h.style.opacity='0';return;}
 const {layer,points}=dust();
 await animate(a,5100,p=>{
  base(c);field(c,0,ease((p-.18)/.7));
  const q=ease((p-.08)/.82),surface=1-ease(p/.46);
  c.globalAlpha=surface;c.drawImage(layer,0,0);c.globalAlpha=1;
  const opacity=Math.min(1,p*12)*(1-ease((p-.68)/.32));c.fillStyle='#b3d2f8';
  for(const t of points){c.globalAlpha=t.a*opacity;const bend=Math.sin(q*Math.PI),x=t.x+(t.tx-t.x)*q+t.dx*bend,y=t.y+(t.ty-t.y)*q+t.dy*bend;c.fillRect(x,y,t.size,t.size);}
  c.globalAlpha=1;h.style.opacity=String(1-ease((p-.28)/.35));
 });
});
define('s11-ko','flight','<p class="sr-only">개발 부담이 사라진 우주에서 별 한 점으로 들어갑니다.</p>',2300,async(r,a)=>{
 const c=context(r);await animate(a,2300,p=>{
  base(c);field(c,.998*Math.pow(ease(p),2.2));c.fillStyle='rgba(255,255,255,'+ease((p-.84)/.16)+')';c.fillRect(0,0,W,H);
 });
});
define('s12','arrival','<div class="e4-brand"><h1 aria-label="ATHENA"><span class="e4-brand-measure" aria-hidden="true">ATHENA</span><span class="e4-brand-typed" aria-hidden="true"></span></h1><p>투자자의 말이 실제 작업으로 이어지는 공간</p></div>',2180,async(r,a)=>{
 const c=context(r);c.fillStyle='#fff';c.fillRect(0,0,W,H);
 const typed=r.querySelector('.e4-brand-typed'),subtitle=r.querySelector('.e4-brand p');
 if(a.reduced){typed.textContent='ATHENA';subtitle.style.opacity='1';return;}
 await document.fonts.ready;if(a.signal.aborted)return;
 // Hidden guide reserves width; only typed blue letters and a pink caret appear.
 typed.classList.add('is-typing');
 if(!await a.wait(240))return;
 if(!await a.type(typed,'ATHENA',1260))return;
 typed.classList.replace('is-typing','is-complete');
 if(!await a.wait(260))return;
 await a.animate(subtitle,[{opacity:0},{opacity:1}],{duration:420});
});
for(const cue of data.cues){if(!labels[cue.id])continue;cue.script=labels[cue.id];cue.note=labels[cue.id]+' · 개발 카드 → 먼지 → 우주 → 별 → ATHENA';cue.autoNext=cue.id==='s11-ko';}
})();
