/* Slide 16: official public BuntTrader materials, replacing the synthetic backtest. */
(() => {
  'use strict';
  const scenes=window.ATHENA_SCENES;
  const assets='assets/edit1/';
  const body=(moving=true)=>`<div class="e1-bunt-grid"><article class="e1-bunt-info"><div class="e1-bunt-label">조건검색 기반 자동매매 프로그램</div><h2>번개트레이더</h2><a class="e1-bunt-site" href="https://tv.naver.com/bunt" target="_blank" rel="noopener noreferrer"><img src="${assets}bunt-channel.png" alt="번개트레이더 공식 네이버TV 채널"><span>공식 채널 · 사용법과 기능 소개 ↗</span></a><a class="e1-bunt-cafe" href="https://cafe.naver.com/buntstock" target="_blank" rel="noopener noreferrer">공식 홈페이지·고객지원 카페 ↗</a></article><article class="e1-bunt-demo"><div class="e1-bunt-demo-top"><b>공식 프로그램 시연</b><span>2배속 · 화면 녹화</span></div><div class="e1-bunt-player">${moving?`<video class="e1-bunt-video" muted playsinline preload="auto" poster="${assets}bunt-official-demo-first.png" src="${assets}bunt-official-demo.mp4"></video>`:''}<img class="e1-bunt-still" ${moving?'hidden':''} src="${assets}bunt-official-demo-last.png" alt="번개트레이더 공식 2017년 영상의 종료 프레임"><p class="e1-bunt-error" hidden></p></div><div class="e1-bunt-source"><span>공식 공개 영상 · 프로그램 사용 장면</span><a href="https://www.youtube.com/watch?v=S7ds1n0yS1k" target="_blank" rel="noopener noreferrer">원본 영상 ↗</a></div><p class="e1-bunt-scope">공식 영상 재생 화면을 녹화한 자료입니다. 이번 발표에서 새로 실행한 모의투자 결과가 아닙니다.</p></article></div>`;
  scenes.s20={title:'번개트레이더 · 자동매매 프로그램 사례',duration:16000,continuity:true,render:()=>`<section class="cw-stage e1-bunt"><header class="cw-title"><h1>일반 투자자는 투자할 때 어떤 과정을 거칠까요?</h1><p>조건검색과 자동매매 프로그램을 활용하는 사례도 있습니다.</p></header>${body()}<div class="cw-caption">번개트레이더 공식 채널 · 시연 영상 출처: 2017년 공개 영상</div></section>`,play:async(root,api)=>{
    const video=root.querySelector('.e1-bunt-video'),still=root.querySelector('.e1-bunt-still'),owner=root.querySelector('.e1-bunt');
    if(api.signal.aborted)return;
    if(api.reduced){video.hidden=true;still.hidden=false;owner.dataset.mediaState='reduced';return;}
    video.muted=true;video.defaultMuted=true;video.playbackRate=1;video.loop=false;
    await new Promise((resolve,reject)=>{
      let settled=false,timer,lastTime=0,lastProgress=performance.now(),started=false;
      const clean=()=>{clearInterval(timer);video.removeEventListener('playing',playing);video.removeEventListener('ended',ended);video.removeEventListener('error',error);api.signal.removeEventListener('abort',abort);};
      const finish=(failure)=>{if(settled)return;settled=true;clean();video.pause();if(failure){owner.dataset.mediaState='error';const el=root.querySelector('.e1-bunt-error');el.hidden=false;el.textContent='공식 시연 영상을 불러오지 못했습니다. 원본 영상 링크를 확인해 주세요.';reject(failure);}else resolve();};
      const playing=()=>{started=true;owner.dataset.mediaState='playing';};
      const ended=()=>{if(!started||video.currentTime<1){finish(new Error('Bunt capture did not play'));return;}video.hidden=true;still.hidden=false;owner.dataset.mediaState='ended';finish();};
      const error=()=>finish(new Error('Bunt official capture unavailable'));
      const abort=()=>{owner.dataset.mediaState='aborted';finish();};
      video.addEventListener('playing',playing);video.addEventListener('ended',ended);video.addEventListener('error',error);api.signal.addEventListener('abort',abort,{once:true});
      timer=setInterval(()=>{if(video.currentTime>lastTime+.02){lastTime=video.currentTime;lastProgress=performance.now();}else if(performance.now()-lastProgress>12000)finish(new Error('Bunt capture stalled'));},500);
      video.play().catch(finish);
    });
  }};
  // Carry the actual Bunt ending into the existing corridor instead of an unrelated
  // synthetic backtest. Keep the established camera, wall geometry and chat arrival.
  for(const id of ['s21','s22']){const original=scenes[id].render;scenes[id].render=()=>{const host=document.createElement('div');host.innerHTML=original();const origin=host.querySelector('.cw-origin');if(origin){origin.innerHTML=`<div class="e1-bunt-corridor"><img src="${assets}bunt-official-demo-last.png" alt="번개트레이더 공식 시연 종료 화면"><span>번개트레이더 · 공식 시연 영상</span></div>`;}return host.innerHTML;};}
})();
