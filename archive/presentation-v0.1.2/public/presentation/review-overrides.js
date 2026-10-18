/* Silent, seven-second official-player screen capture; no interpolation.
 * This is not the original video or audio file. */
(() => {
  'use strict';
  const scene=window.ATHENA_SCENES.s08,render=scene.render;
  const assets='assets/revision/boris-guarded-20260921/';
  scene.duration=7000;
  scene.render=()=>render()
    .replace(/<video\b[\s\S]*?<\/video>/,`<video class="rev-wts-video" muted playsinline preload="auto" poster="${assets}first.png"><source src="${assets}speech.mp4" type="video/mp4"></video>`)
    .replace(/<img class="rev-wts-still" hidden[^>]*>/,`<img class="rev-wts-still" hidden src="${assets}last.png" alt="Boris Cherny 실제 재생 화면 캡처의 마지막 프레임">`)
    .replace('Every · AI & I · 49:56–50:03 실제 재생 화면 캡처 · 9프레임 / 약 6.8초 · 무음 · 원본 30fps 영상 아님','Every · AI & I · 49:56–50:03 · 실제 재생 화면 캡처 · 7초 · 무음');
  scene.play=async(root,api)=>{
    const video=root.querySelector('.rev-wts-video'),still=root.querySelector('.rev-wts-still');
    if(api.signal.aborted)return;
    if(!video||!still)throw new Error('S08 capture media is missing');
    if(api.reduced){video.pause();video.hidden=true;still.hidden=false;return;}
    video.hidden=false;still.hidden=true;video.muted=true;video.defaultMuted=true;
    video.loop=false;video.playbackRate=1;
    await new Promise((resolve,reject)=>{
      let settled=false,timer=null,lastTime=0,lastProgress=performance.now();
      const started=lastProgress;
      const cleanup=()=>{
        clearInterval(timer);
        video.removeEventListener('ended',ended);
        video.removeEventListener('error',failed);
        api.signal.removeEventListener('abort',aborted);
      };
      const finish=error=>{if(settled)return;settled=true;cleanup();video.pause();error?reject(error):resolve();};
      const fail=message=>{
        if(settled||api.signal.aborted)return;
        const status=document.createElement('p');status.setAttribute('role','alert');status.textContent=message;
        status.style.cssText='position:absolute;left:18px;right:18px;bottom:18px;padding:12px 16px;background:#202124;color:#fff;font-size:22px;line-height:1.4;z-index:3';
        video.parentElement.style.position='relative';video.parentElement.append(status);
        finish(new Error(message));
      };
      function ended(){
        if(api.signal.aborted){aborted();return;}
        if(video.currentTime<6.85){fail('발언 캡처 영상이 예상보다 일찍 종료됐습니다. 재생을 다시 시도해 주세요.');return;}
        video.hidden=true;still.hidden=false;finish();
      }
      function failed(){fail('발언 캡처 영상을 불러오지 못했습니다. 재생을 다시 시도해 주세요.');}
      function aborted(){finish(new DOMException('S08 playback aborted','AbortError'));}
      video.addEventListener('ended',ended);
      video.addEventListener('error',failed);
      api.signal.addEventListener('abort',aborted,{once:true});
      // Allow metadata loading and recoverable waiting/stalled events. A bounded
      // lack of media-time progress fails instead of pretending playback ended.
      timer=setInterval(()=>{
        const now=performance.now();
        if(video.currentTime>lastTime+.01){lastTime=video.currentTime;lastProgress=now;}
        if(now-lastProgress>15000||now-started>30000)fail('발언 캡처 영상의 재생이 지연되고 있습니다. 재생을 다시 시도해 주세요.');
      },250);
      try{
        video.currentTime=0;
        Promise.resolve(video.play()).catch(()=>fail('발언 캡처 영상의 자동 재생이 시작되지 않았습니다. 재생을 다시 시도해 주세요.'));
      }catch{failed();}
      if(api.signal.aborted)aborted();
    });
  };
})();
