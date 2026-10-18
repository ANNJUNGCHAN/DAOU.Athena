/* Registry overrides only. No controller/header mutation. Original source adaptation:
 * components/athena-intro.tsx; app/page.tsx of .omc/athena-homepage-reference.
 * Stage coordinates, IDs and radiance are invariant across dust -> flight.
 */
(() => {
 'use strict';
 const registry=window.ATHENA_SCENES ||= {};
 const rand=i=>{const v=Math.sin(i*127.1+78.233)*43758.5453;return v-Math.floor(v);};
 const stars=Object.freeze(Array.from({length:192},(_,i)=>Object.freeze({id:`star-${String(i).padStart(3,'0')}`,x:i?40+rand(i+11)*1840:960,y:i?35+rand(i+670)*1010:540,z:i?430+rand(i+910)*1250:400,size:i?1+rand(i+340)*2:5,alpha:i?.28+rand(i+710)*.62:1})));
 const esc=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
 const cameraEnd=399.4;
 const targetScale=camera=>stars[0].z/(stars[0].z-camera);
 const mistOpacity=camera=>Math.max(0,Math.min(1,(Math.log(targetScale(camera))-Math.log(40))/(Math.log(targetScale(cameraEnd))-Math.log(40))));
 const projection=(s,camera)=>{const factor=s.z/(s.z-camera);return {x:960+(s.x-960)*factor,y:540+(s.y-540)*factor,scale:factor};};
 const starTransform=(s,camera)=>{const p=projection(s,camera);return 'translate('+(p.x-s.x)+'px,'+(p.y-s.y)+'px) scale('+p.scale+')';};
 const field=(camera=0)=>'<div class="cc-field" data-camera="'+camera+'">'+stars.map(s=>'<i class="cc-star" data-star-id="'+s.id+'" style="left:'+(s.x-s.size/2)+'px;top:'+(s.y-s.size/2)+'px;width:'+s.size+'px;height:'+s.size+'px;opacity:'+s.alpha+';transform:'+starTransform(s,camera)+'"></i>').join('')+'<div class="cc-light-mist" data-light-source="star-000" style="opacity:'+mistOpacity(camera)+'"></div></div>';

 const shell=body=>`<section class="cc-root" data-fullscreen="true">${body}</section>`;
 const diagrams=[
 ['아키텍처','<svg viewBox="0 0 312 132"><rect x="5" y="8" width="85" height="40"/><rect x="180" y="8" width="110" height="40"/><rect x="180" y="83" width="110" height="40"/><path d="M90 28H135V103H180 M135 28H180"/><text x="20" y="34">Client</text><text x="196" y="34">Service</text><text x="194" y="108">Storage</text></svg>'],
 ['ERD','<svg viewBox="0 0 312 132"><rect x="5" y="5" width="120" height="118"/><rect x="190" y="5" width="115" height="118"/><path d="M5 40H125 M190 40H305 M125 68H190"/><text x="18" y="29">Account</text><text x="201" y="29">Record</text><text x="17" y="65">id · key</text><text x="202" y="65">owner_id</text><text x="17" y="97">relation</text><text x="202" y="97">value</text></svg>'],
 ['코드','<pre>async function evaluate() {\n  const input = await read();\n  return validate(input);\n}</pre>'],
 ['알고리즘','<svg viewBox="0 0 312 132"><path d="M20 24H130V72H235 M130 72V119H235"/><rect x="4" y="5" width="95" height="38"/><rect x="232" y="52" width="75" height="37"/><rect x="232" y="99" width="75" height="30"/><text x="13" y="30">condition</text><text x="243" y="77">true</text><text x="240" y="120">false</text></svg>'],
 ['데이터 흐름','<pre>request → parse → validate\nstream  → transform → store\nresult  ← query ← index</pre>'],
 ['데이터베이스','<pre>PRIMARY KEY · FOREIGN KEY\ntransaction / isolation\nindex / partition / lock\nCOMMIT · ROLLBACK</pre>'],
 ['테스트','<pre>□ boundary conditions\n□ concurrent requests\n□ error recovery\n□ integration contract</pre>'],
 ['성능','<svg viewBox="0 0 312 132"><path d="M20 5V116H305 M20 88L55 85 88 90 120 66 150 69 182 44 215 48 251 27 297 18"/><text x="28" y="26">latency / load</text></svg>']
 ];
 const panelPerspective=1600;
 // Centers are stage coordinates; depth is distance behind the stage camera plane.
 // These are eight upright surfaces at different distances, with restrained yaw/pitch.
 const panelPlanes=Object.freeze([
  [310,300,90,-26,3,1.14],[950,250,570,19,-2,1.03],
  [1580,318,180,-31,2,1.10],[650,580,-140,24,-2,1.10],
  [1285,583,310,-21,2.5,1.18],[265,878,390,22,-2,.95],
  [955,880,-70,-16,1.5,1.15],[1640,868,490,27,-3,1.02]
 ].map(([x,y,depth,yaw,pitch,size],id)=>{
  const ry=yaw*Math.PI/180,rx=pitch*Math.PI/180;
  return Object.freeze({id,x,y,depth,yaw,pitch,size,
   u:Object.freeze([size*Math.cos(ry),0,size*Math.sin(ry)]),
   v:Object.freeze([-size*Math.sin(ry)*Math.sin(rx),size*Math.cos(rx),size*Math.cos(ry)*Math.sin(rx)])});
 }));
 function panelPoint(p,x,y){
  const plane=panelPlanes[p],lx=x-180,ly=y-110,d=panelPerspective+plane.depth;
  const wx=(plane.x-960)*d/panelPerspective+plane.u[0]*lx+plane.v[0]*ly;
  const wy=(plane.y-540)*d/panelPerspective+plane.u[1]*lx+plane.v[1]*ly;
  const w=d+plane.u[2]*lx+plane.v[2]*ly;
  return {x:960+panelPerspective*wx/w,y:540+panelPerspective*wy/w,w};
 }
 const smooth=(a,b,t)=>{const u=Math.max(0,Math.min(1,(t-a)/(b-a)));return u*u*(3-2*u);};
 // A surface's centered homography is expressed entirely in stage coordinates.
 // The denominator is normalized at its center. No CSS perspective ancestor,
 // inverse-parent guess, or preserve-3d group is involved in either scene.
 function surfaceProjection(p,tx,ty,cx,cy){
  const plane=panelPlanes[p],center=panelPoint(p,tx+cx,ty+cy),f=panelPerspective,w=center.w;
  return {p,tx,ty,cx,cy,x:center.x,y:center.y,
   ax:(f*plane.u[0]+(960-center.x)*plane.u[2])/w,
   ay:(f*plane.u[1]+(540-center.y)*plane.u[2])/w,
   bx:(f*plane.v[0]+(960-center.x)*plane.v[2])/w,
   by:(f*plane.v[1]+(540-center.y)*plane.v[2])/w,
   g:plane.u[2]/w,h:plane.v[2]/w};
 }
 function pieceMatrix(i,t=0,offsetX=0,offsetY=0){
  const m=shardMatrix(i,t);
  for(const index of [0,4,12]){m[index]+=offsetX*m[index+3];m[index+1]+=offsetY*m[index+3];}
  return m;
 }
 const matrixCss=m=>`matrix3d(${m.join(',')})`;
 function polygonCenter(points){
  let area=0,x=0,y=0;
  points.forEach(([ax,ay],j)=>{const [bx,by]=points[(j+1)%points.length],cross=ax*by-bx*ay;area+=cross;x+=(ax+bx)*cross;y+=(ay+by)*cross;});
  return {x:x/(3*area),y:y/(3*area),area:area/2};
 }
 function coveragePolygon(points,tx,ty){
  // Expand identical source coverage by .4 local pixels to close antialias seams.
  // Only a panel's outside edges are clamped. Canonical polygons share exactly
  // the same jittered vertices and partition the complete source surface.
  const edges=points.map(([x,y],j)=>{const [ex,ey]=points[(j+1)%4],dx=ex-x,dy=ey-y,len=Math.hypot(dx,dy);return {x:x+.4*dy/len,y:y-.4*dx/len,dx,dy};});
  return points.map((_,j)=>{
   const a=edges[(j+3)%4],b=edges[j],cross=a.dx*b.dy-a.dy*b.dx;
   const t=((b.x-a.x)*b.dy-(b.y-a.y)*b.dx)/cross;
   return [Math.max(-tx,Math.min(360-tx,a.x+t*a.dx)),Math.max(-ty,Math.min(220-ty,a.y+t*a.dy))];
  });
 }
 // Jitter shared mesh vertices across the whole panel, rather than subdividing
 // fixed rectangular macro tiles. One actual surface fragment maps to each star.
 const shards=Object.freeze(panelPlanes.flatMap(plane=>{
  const grid=Array.from({length:5},(_,row)=>Array.from({length:7},(_,col)=>{
   const seed=plane.id*35+row*7+col;
   return [col*60+(col>0&&col<6?(rand(seed+3000)-.5)*26:0),row*55+(row>0&&row<4?(rand(seed+4000)-.5)*24:0)];
  }));
  return Array.from({length:24},(_,k)=>{
   const row=Math.floor(k/6),col=k%6,globalPolygon=[grid[row][col],grid[row][col+1],grid[row+1][col+1],grid[row+1][col]];
   const tx=Math.min(...globalPolygon.map(p=>p[0])),ty=Math.min(...globalPolygon.map(p=>p[1]));
   const width=Math.max(...globalPolygon.map(p=>p[0]))-tx,height=Math.max(...globalPolygon.map(p=>p[1]))-ty;
   const polygon=globalPolygon.map(([x,y])=>[x-tx,y-ty]),centroid=polygonCenter(polygon),origin=surfaceProjection(plane.id,tx,ty,centroid.x,centroid.y);
   const radius=.8*Math.min(...polygon.map(([x,y],j)=>{const [ex,ey]=polygon[(j+1)%4];return Math.abs((ex-x)*(centroid.y-y)-(ey-y)*(centroid.x-x))/Math.hypot(ex-x,ey-y);}));
   const id=plane.id*24+k;
   return Object.freeze({...origin,id,group:id,k,width,height,area:centroid.area,radius,
    polygon:Object.freeze(polygon.map(p=>Object.freeze(p))),coverage:Object.freeze(coveragePolygon(polygon,tx,ty).map(p=>Object.freeze(p)))});
  });
 }));
 const pieceOrigins=shards;
 function dustCenter(i,t){
  const o=shards[i],s=stars[i],travel=smooth(.02,.88,t);
  if(t>=.88)return {x:s.x,y:s.y};
  const angle=rand(i+5000)*Math.PI*2,spread=50+rand(i+5200)*55;
  const scatter=smooth(0,.045,t)*(1-smooth(.10,.78,t));
  return {x:o.x+(s.x-o.x)*travel+Math.cos(angle)*spread*scatter,
   y:o.y+(s.y-o.y)*travel+Math.sin(angle)*spread*scatter-Math.sin(Math.PI*travel)*(25+rand(i+1200)*25)};
 }
 function shardMatrix(id,t=0){
  const o=shards[id],s=stars[id],{x,y}=dustCenter(id,t);
  // The physical surface collapses before its emissive material is revealed.
  // By .075 (172.5 ms) the core's projected diameter is exactly the star diameter.
  const remaining=Math.pow(1-smooth(0,.075,t),3),scale=s.size/(2*o.radius);
  const ax=o.ax*remaining+scale*(1-remaining),ay=o.ay*remaining;
  const bx=o.bx*remaining,by=o.by*remaining+scale*(1-remaining),g=o.g*remaining,h=o.h*remaining;
  const w=1-o.cx*g-o.cy*h;
  return [(ax+x*g)/w,(ay+y*g)/w,0,g/w,(bx+x*h)/w,(by+y*h)/w,0,h/w,0,0,1,0,
   (x-o.cx*(ax+x*g)-o.cy*(bx+x*h))/w,(y-o.cx*(ay+y*g)-o.cy*(by+y*h))/w,0,1];
 }
 function shardOpacity(group,t){
  const alpha=stars[group].alpha,core=alpha*smooth(.72,.90,t);
  if(t>=.90)return 0;
  const material=1+(alpha-1)*smooth(.12,.28,t);
  return (material-core)/(1-core);
 }
 const shardClip=o=>`polygon(${o.coverage.map(([x,y])=>`${x}px ${y}px`).join(',')})`;
 const dustOffsets=[0,.0125,.025,.0375,.05,.0625,.075,.09,.11,.15,.22,.30,.40,.50,.60,.68,.72,.76,.80,.84,.86,.88,.90,1];
 const dustTiming=i=>{const o=shards[i];return {duration:2300,delay:Math.max(0,(360-o.tx-o.cx)/360*570+(rand(i+5400)-.5)*80+o.p*13),easing:'linear'};};
 // Precompute 9,216 small keyframes at module load; scene start creates no mesh
 // or matrix sample arrays. Source fades only after physical core size is reached.
 const dustFrames=Object.freeze(shards.map((o,i)=>Object.freeze({
  surface:dustOffsets.map(t=>({offset:t,transform:matrixCss(shardMatrix(i,t)),opacity:shardOpacity(i,t)})),
  star:dustOffsets.map(t=>{const center=dustCenter(i,t),s=stars[i];return {offset:t,transform:`translate(${center.x-s.x}px,${center.y-s.y}px) scale(1)`,opacity:s.alpha*smooth(.72,.90,t)};})
 })));
 // 192 identity groups contain 192 irregular real surfaces. Groups have no card,
 // transform, clipping, or separate dust overlay; each leaf projects itself.
 function panels(){return panelPlanes.map(plane=>`<div class="cc-panel" data-panel="${plane.id}" data-depth="${plane.depth}" data-yaw="${plane.yaw}" style="z-index:${Math.round(800-plane.depth)}">${Array.from({length:24},(_,k)=>{
  const i=plane.id*24+k,o=pieceOrigins[i];
  return `<div class="cc-piece" data-piece="${i}" data-star-id="${stars[i].id}" data-origin-x="${o.x}" data-origin-y="${o.y}"><div class="cc-shard" data-shard="${i}" data-star-id="${stars[i].id}" data-origin-x="${o.x}" data-origin-y="${o.y}" style="width:${o.width}px;height:${o.height}px;transform:${dustFrames[i].surface[0].transform};clip-path:${shardClip(o)};background:radial-gradient(circle ${o.radius}px at ${o.cx}px ${o.cy}px,${i?'#e5edff':'#fff'} 99%,transparent 100%)"><div class="cc-tile-content" style="left:${-o.tx}px;top:${-o.ty}px"><h2>${diagrams[plane.id][0]}</h2>${diagrams[plane.id][1]}</div></div></div>`;
 }).join('')}</div>`).join('');}
 const csTitle='<header class="cc-cs-title"><h1>투자 지식 밖의 개발 부담</h1><p>직접 작업 공간을 만들려면, 코드와 시스템도 이해해야 합니다.</p></header>';
 const en='I have lifted the mist from your eyes,\nso you can clearly distinguish god from mortal.';
 const ko='그대의 눈을 가리던 안개를 걷어냈다.\n신과 인간을 분명히 구별할 수 있도록.';
 const fog=()=>'<div class="cc-fog"></div><div class="cc-fog b"></div>';
 const quote=(language,text)=>`<div class="cc-quote"><div class="cc-quote-text" lang="${language}">${esc(text)}</div><div class="cc-cite">${language==='en'?'Athena to Diomedes<br>Homer, Iliad · Book 5, lines 127–128<br>Adapted translation':'아테나가 디오메데스에게<br>호메로스, 『일리아스』 · 5권 127–128행<br>발췌 번역'}</div></div>`;
 const quoteSurface=(lang,text)=>`<div class="cc-white">${field(cameraEnd)}${quote(lang,text)}</div>`;
 const mark=text=>`<div class="cc-mark"><span class="cc-mark-track"><span class="cc-mark-guide">ATHENA</span><span class="cc-mark-ink"><span class="cc-letters">${text}</span><i class="cc-caret"></i></span></span></div>`;
 const home=(complete=true)=>`<div class="cc-home ${complete?'':'cc-home-hidden'}"><div class="cc-home-dots">${stars.filter(s=>Math.abs(s.x-960)>610||s.y<150||s.y>940).map(s=>`<i style="left:${s.x}px;top:${s.y}px"></i>`).join('')}</div>${mark(complete?'ATHENA':'')}<div class="cc-home-copy"><h1>투자의 시야를 가리던<br>안개를 걷어내다.</h1><p class="cc-home-sub">정보 너머의 맥락이 보이도록.</p></div></div>`;
 const q=(r,s)=>r.querySelector(s);
 async function motion(a,el,frames,options){if(a.signal.aborted)return;await a.animate(el,frames,{fill:'both',...options});if(a.signal.aborted)return;const final=frames.at(-1);for(const key of ['transform','opacity','clipPath'])if(final[key]!==undefined)el.style[key]=final[key];}
 const define=(id,duration,render,play)=>{registry[id]={title:registry[id]?.title||id,duration,fullscreen:true,render,play};};
 define('s09',1700,()=>shell(field()+panels()+csTitle),async(r,a)=>{
  q(r,'.cc-field').style.opacity='0';
  // Every leaf already has a flattened stage homography (z=0); these eight
  // ordinary 2D groups can enter together without a preserve-3d flattening change.
  await Promise.all([...r.querySelectorAll('.cc-panel')].map((el,p)=>motion(a,el,[{opacity:0,transform:`translate(${p%2?85:-85}px,22px)`},{opacity:1,transform:'translate(0,0)'}],{duration:1000,delay:p*90,easing:'cubic-bezier(.2,.7,.2,1)'})));
 });
 define('s09-dust',3400,()=>shell(field()+panels()+csTitle),async(r,a)=>{
  const starEls=[...r.querySelectorAll('.cc-star')];starEls.forEach(el=>el.style.opacity='0');
  await Promise.all([
   motion(a,q(r,'.cc-cs-title'),[{opacity:1},{opacity:0}],{duration:450}),
   ...[...r.querySelectorAll('.cc-shard')].flatMap((el,id)=>{
    const options=dustTiming(id);
    return [motion(a,el,dustFrames[id].surface,options),
     motion(a,q(el,'.cc-tile-content'),[{opacity:1},{opacity:1,offset:.075},{opacity:0,offset:.11},{opacity:0}],options)];
   }),
   ...starEls.map((el,i)=>motion(a,el,dustFrames[i].star,dustTiming(i)))
  ]);
  if(!a.signal.aborted)r.firstElementChild.classList.add('cc-settled');
 });
 define('s10',1550,()=>shell(field()),async(r,a)=>{
  await Promise.all([...r.querySelectorAll('.cc-star')].map((el,i)=>motion(a,el,Array.from({length:121},(_,j)=>{const t=j/120,u=t*t*(3-2*t),scale=Math.exp(Math.log(targetScale(cameraEnd))*u),camera=stars[0].z*(1-1/scale);return {offset:t,transform:starTransform(stars[i],camera)};}),{duration:1550,easing:'linear'})).concat(motion(a,q(r,'.cc-light-mist'),Array.from({length:121},(_,j)=>{const t=j/120,u=t*t*(3-2*t),camera=stars[0].z*(1-1/Math.exp(Math.log(targetScale(cameraEnd))*u));return {offset:t,opacity:mistOpacity(camera)};}),{duration:1550,easing:'linear'})));
 });
 define('s11-en',2200,()=>shell(quoteSurface('en','')),async(r,a)=>{
  q(r,'.cc-cite').style.opacity='0';
  await a.wait(150);if(a.signal.aborted)return;
  await a.type(q(r,'.cc-quote-text'),en,1400);if(a.signal.aborted)return;await motion(a,q(r,'.cc-cite'),[{opacity:0},{opacity:1}],{duration:350});
 });
 define('s11-ko',1800,()=>shell(quoteSurface('en',en)),async(r,a)=>{
  await motion(a,q(r,'.cc-quote'),[{opacity:1},{opacity:0}],{duration:250});if(a.signal.aborted)return;
  q(r,'.cc-quote').outerHTML=quote('ko','');q(r,'.cc-cite').style.opacity='0';await a.type(q(r,'.cc-quote-text'),ko,1150);if(a.signal.aborted)return;await motion(a,q(r,'.cc-cite'),[{opacity:0},{opacity:1}],{duration:300});
 });
 define('s12',1900,()=>shell(home(false)+quoteSurface('ko',ko)),async(r,a)=>{
  await Promise.all([motion(a,q(r,'.cc-quote'),[{opacity:1},{opacity:0}],{duration:350}),...[...r.querySelectorAll('.cc-fog')].map((el,i)=>motion(a,el,[{transform:i?'rotate(180deg)':'translateX(0)'},{transform:`translateX(${i?1700:-1700}px)`}],{duration:850})),motion(a,q(r,'.cc-white'),[{opacity:1},{opacity:0}],{duration:1000})]);
  if(a.signal.aborted)return;await a.type(q(r,'.cc-letters'),'ATHENA',800);
 });
 define('s13',850,()=>shell(home(true)),async(r,a)=>motion(a,q(r,'.cc-home-copy'),[{opacity:0,transform:'translateY(15px)'},{opacity:1,transform:'translateY(0)'}],{duration:850}));
 for(const id of ['s14','s15'])define(id,0,()=>shell(home(true)),async()=>{});
 window.ATHENA_COSMOS=Object.freeze({stars,stage:Object.freeze({width:1920,height:1080}),targetId:'star-000',cameraEnd,targetScale,mistOpacity,projection,renderField:field,renderHome:()=>shell(home(true)),panels:panelPlanes,panelPoint,pieceOrigins,pieceMatrix,shards,shardMatrix,shardOpacity,dustCenter,dustTiming});
})();

/* Prepare the existing dust effects during the settled S09 surface, then reuse
 * them only for the normal S09-to-dust transition. Direct entry and replay keep
 * their original playback path; preparation moves work into S09's static tail.
 */
(() => {
 'use strict';
 const scenes=window.ATHENA_SCENES,baseS09=scenes.s09.play,baseDust=scenes['s09-dust'].play;
 let cached=null,sequence=0;
 function phase(name,r,extra={}){
  const detail={phase:name,at:performance.now(),source:'cosmos-preparation',id:r.id,origin:r.origin,tracks:r.tracks.length,...extra};
  document.dispatchEvent(new CustomEvent('athena:startup-phase',{detail}));
 }
 function cancelRecord(r,reason){
  if(!r||r.disposed)return;
  r.disposed=true;r.status='cancelled';r.controller.abort();
  for(const animation of r.tracks)animation.cancel();
  r.detachDust?.();r.detachDust=null;
  if(cached===r)cached=null;
  phase('cancel',r,{reason,wasCompleted:!!r.completedAt});
 }
 function discard(reason='discard'){cancelRecord(cached,reason);}
 function nextFrame(signal){return new Promise(resolve=>{
  if(signal.aborted){resolve(false);return;}
  let frame;
  const finish=value=>{signal.removeEventListener('abort',abort);resolve(value);};
  const abort=()=>{cancelAnimationFrame(frame);finish(false);};
  signal.addEventListener('abort',abort,{once:true});
  frame=requestAnimationFrame(()=>finish(!signal.aborted));
 });}
 function prepare(root,origin){
  if(cached&&cached.root===root&&cached.surface===root.firstElementChild&&!cached.disposed)return cached;
  discard('replace-preparation');
  const r={id:++sequence,root,surface:root.firstElementChild,origin,status:'preparing',tracks:[],controller:new AbortController(),prepareStart:performance.now(),disposed:false};
  cached=r;phase('prepare-start',r);
  // This signal belongs to preparation itself, never to the outgoing S09 task.
  const signal=r.controller.signal;
  const api={signal,reduced:false,animate:async(el,frames,options={})=>{
   if(!el||signal.aborted)return false;
   const animation=el.animate(frames,{easing:'cubic-bezier(.22,.7,.2,1)',fill:'both',...options,iterations:1});
   r.tracks.push(animation);animation.pause();animation.currentTime=0;
   try{await animation.finished;return !signal.aborted;}catch{return false;}
  }};
  r.sceneFinished=Promise.resolve(baseDust(root,api));
  // baseDust hides all individual stars synchronously before this restoration.
  // The initial S09 pixels remain identical while the field gets its final ancestry.
  const field=root.querySelector('.cc-field');if(field)field.style.opacity='1';
  r.createdAt=performance.now();
  r.sceneFinished.catch(error=>{r.error=error;cancelRecord(r,'prepare-scene-error');});
  r.ready=(async()=>{
   await Promise.allSettled(r.tracks.map(animation=>animation.ready));
   if(r.disposed)return false;
   r.readyAt=performance.now();r.status='pause-ready';
   phase('pause-ready',r,{createdAt:r.createdAt,readyAt:r.readyAt,
    pausedTracks:r.tracks.filter(animation=>animation.playState==='paused'&&animation.currentTime===0).length});
   // Separate track readiness from two rendering opportunities. Neither is
   // claimed to prove raster completion; startup telemetry measures the result.
   if(!await nextFrame(signal)||!await nextFrame(signal)||r.disposed)return false;
   r.preparedAt=performance.now();r.status='ready';
   phase('prepared',r,{creationMs:r.createdAt-r.prepareStart,readyMs:r.readyAt-r.createdAt,
    paintOpportunityMs:r.preparedAt-r.readyAt,preparationMs:r.preparedAt-r.prepareStart});
   return true;
  })();
  return r;
 }
 function hasReady(root){return !!(cached&&!cached.disposed&&cached.status==='ready'&&cached.root===root&&cached.surface===root.firstElementChild);}
 scenes.s09.play=async(root,api)=>{
  await baseS09(root,api);if(api.signal.aborted||api.reduced)return;
  const r=prepare(root,'s09-hold');
  const abort=()=>cancelRecord(r,'s09-left-during-prepare');
  api.signal.addEventListener('abort',abort,{once:true});
  try{await r.ready;}finally{api.signal.removeEventListener('abort',abort);}
  if(api.signal.aborted)cancelRecord(r,'s09-left-during-prepare');
  if(r.error)throw r.error;
 };
 scenes['s09-dust'].play=async(root,api)=>{
  if(api.reduced||!hasReady(root)){discard('unprepared-dust');return baseDust(root,api);}
  const calledAt=performance.now(),r=cached;
  r.dustCalledAt=calledAt;
  const abort=()=>cancelRecord(r,'dust-abort');
  r.detachDust=()=>api.signal.removeEventListener('abort',abort);
  api.signal.addEventListener('abort',abort,{once:true});
  if(api.signal.aborted){abort();return;}
  try{
   if(!await r.ready||r.disposed||api.signal.aborted)return;
   const field=root.querySelector('.cc-field');if(field)field.style.opacity='1';
   // Starting the already-created tracks does not create another 577 animations.
   // All effects keep their original duration, delay, keyframes and shared epoch.
   r.status='playing';r.startedAt=performance.now();
   const epoch=document.timeline.currentTime;r.timelineStart=epoch;
   for(const animation of r.tracks){animation.play();animation.startTime=epoch;}
   phase('dust-start',r,{warm:true,creationMs:r.createdAt-r.prepareStart,preparationMs:r.preparedAt-r.prepareStart,
    callToMotionMs:r.startedAt-calledAt,startDispatchMs:performance.now()-r.startedAt,
    timelineStart:epoch,distinctStartTimes:new Set(r.tracks.map(animation=>animation.startTime)).size,
    nativeCallsAtPrepare:r.tracks.length,nativeCallsAtStart:0});
   await r.sceneFinished;
   if(r.error)throw r.error;
   if(!r.disposed&&!api.signal.aborted){r.status='completed';r.completedAt=performance.now();}
  }finally{r.detachDust?.();r.detachDust=null;}
 };
 window.ATHENA_DUST_PREP=Object.freeze({discard,hasReady});
 addEventListener('pagehide',()=>discard('pagehide'));
})();
