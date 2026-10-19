/* The arrival plane reuses the actual app/shell.html DOM and original styles.
 * Only its contents change. Existing 3D stations, camera and heading survive.
 */
(()=>{
 'use strict';
 const scenes=window.ATHENA_SCENES;
 for(const id of ['s21','s22']){
  const original=scenes[id];if(!original)continue;
  const render=original.render,play=original.play;
  original.render=()=>{
   const host=document.createElement('div');host.innerHTML=render();
   for(const plane of host.querySelectorAll('.cw-chat-plane')){
    plane.classList.add('e1-real-app-arrival');
    plane.innerHTML='<iframe class="e1-real-app-frame" src="assets/edit1-app-arrival/index.html" title="ATHENA 실제 앱 셸 · 화면 구조 재사용" tabindex="-1"></iframe>';
   }
   return host.innerHTML;
  };
  original.play=async(root,api)=>{
   const frame=root.querySelector('.e1-real-app-frame'),started=performance.now();
   while(frame&&frame.contentDocument?.documentElement?.dataset.ready!=='true'){
    if(api.signal.aborted)return;
    if(performance.now()-started>15000)throw new Error('Actual ATHENA app shell did not load');
    await new Promise(resolve=>setTimeout(resolve,25));
   }
   if(!api.signal.aborted)await play(root,api);
  };
 }
 window.ATHENA_APP_ARRIVAL_SOURCE={repo:'DAOU.Athena',commit:'b7e8923',path:'app/shell.html',static:true};
})();
