/* User edit-1 source recordings. Load after other scene overrides. */
(() => {
  'use strict';
  const scenes=window.ATHENA_SCENES;
  const assets='assets/edit1/';
  const media=(name,label)=>`<figure class="edit1-media-panel"><figcaption>${label}</figcaption><div class="edit1-media-screen"><video muted playsinline preload="auto" poster="${assets}${name}-first.png" src="${assets}${name}-full-3x.mp4"></video><img hidden src="${assets}${name}-last.png" alt="${label} 마지막 화면"></div></figure>`;
  const news=()=>'<figure class="edit1-media-panel"><figcaption>뉴스와 공시 · 실제 브라우저</figcaption><div class="edit1-media-screen"><video muted playsinline preload="auto" poster="assets/workflows/news-native-20260921/first.png" src="assets/workflows/news-native-20260921/native.mp4"></video><img hidden src="assets/workflows/news-native-20260921/last.png" alt="공시 확인 마지막 화면"></div></figure>';
  const body=(kind,content,caption)=>`<section class="cw-stage edit1-media-stage edit1-${kind}"><header class="edit1-media-header"><h1>${kind==='investing'?'일반 투자자는 투자할 때 어떤 과정을 거칠까요?':'이제는, 원하는 결과를 말로'}</h1><p>${kind==='investing'?'차트의 가격과 거래량에서 투자 아이디어를 찾고, 뉴스와 공시를 통해 그 배경과 판단의 근거를 확인합니다.':'프로그래머가 대화로 자신의 의도를 구체화하며, 프로그래밍의 추상화 수준을 한 단계 더 높입니다.'}</p></header><div class="edit1-media-grid">${content}</div><footer>${caption}</footer></section>`;
  function playPanel(panel,api){
    const video=panel.querySelector('video'),still=panel.querySelector('img');
    const hold=()=>{video.pause();video.hidden=true;still.hidden=false;panel.dataset.mediaState='ended';};
    if(api.reduced){hold();return Promise.resolve();}
    if(api.signal.aborted)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      let timer;
      const cleanup=()=>{clearTimeout(timer);video.removeEventListener('ended',ended);video.removeEventListener('error',failed);api.signal.removeEventListener('abort',abort);};
      const ended=()=>{cleanup();hold();resolve();};
      const failed=()=>{cleanup();video.pause();panel.dataset.mediaState='error';reject(new Error('Edit-1 recording failed: '+video.currentSrc));};
      const abort=()=>{cleanup();video.pause();resolve();};
      video.addEventListener('ended',ended,{once:true});video.addEventListener('error',failed,{once:true});api.signal.addEventListener('abort',abort,{once:true});
      panel.dataset.mediaState='playing';video.hidden=false;still.hidden=true;video.muted=true;video.currentTime=0;timer=setTimeout(failed,65000);video.play().catch(failed);
    });
  }
  const play=(root,api)=>Promise.all([...root.querySelectorAll('.edit1-media-panel')].map(panel=>playPanel(panel,api)));
  const javaCode = `import java.util.List;
import java.util.Optional;

public class EtfIssueStore {
    record Issue(String id, String title,
                 List<String> etfNames) {}

    private final List<Issue> issues = List.of(
        new Issue("ISS-005", "금리 인하 기대 회복",
            List.of("은행·배당 ETF", "채권 ETF")),
        new Issue("ISS-006", "반도체 투자 확대",
            List.of("반도체 ETF"))
    );

    public Optional<Issue> issueById(String id) {
        return issues.stream()
            .filter(issue -> issue.id().equals(id))
            .findFirst();
    }

    public List<String> relatedEtfs(String issueId) {
        return issueById(issueId)
            .map(Issue::etfNames)
            .orElseGet(List::of);
    }
}`;
  const javaPanel=()=>`<figure class="edit1-java-panel"><figcaption>직접 코드로 작성 <span>Java</span></figcaption><div class="edit1-java-tab"><b>J</b> EtfIssueStore.java <small>ETF 이슈 조회</small></div><div class="edit1-java-editor"><div class="edit1-java-lines" aria-hidden="true">${javaCode.split('\n').map((_,i)=>i+1).join('\n')}</div><pre aria-label="ETF 이슈 조회 Java 코드 작성 재현"><code></code><span class="edit1-java-caret" aria-hidden="true"></span></pre></div><div class="edit1-java-status"><span>코드 작성 재현</span><span class="edit1-java-progress">입력 준비</span></div></figure>`;
  const gptPanel=()=>`<figure class="edit1-media-panel"><figcaption>대화로 의도를 전달 <span>실제 화면 · 5배속</span></figcaption><div class="edit1-media-screen"><video muted playsinline preload="auto" poster="${assets}gpt-5x-first.png" src="${assets}gpt-full-5x.mp4"></video><img hidden src="${assets}gpt-5x-last.png" alt="사용자 제공 GPT 전체 영상 마지막 화면"></div></figure>`;
  // Drive typing from media time so buffering and replay cannot desynchronise it.
  async function playGpt(root,api){
    const panel=root.querySelector('.edit1-media-panel'),video=panel.querySelector('video');
    const code=root.querySelector('.edit1-java-editor code'),status=root.querySelector('.edit1-java-progress'),editor=root.querySelector('.edit1-java-editor');
    let frame=0,lastCount=-1;
    const update=progress=>{
      const count=Math.min(javaCode.length,Math.floor(javaCode.length*progress));
      if(count===lastCount)return;lastCount=count;
      // Plain text insertion keeps the example safe and preserves indentation.
      code.textContent=javaCode.slice(0,count);
      status.textContent=count===javaCode.length?'입력 완료':`Ln ${javaCode.slice(0,count).split('\n').length} · Java`;
      root.querySelector('.edit1-java-panel').classList.toggle('is-complete',count===javaCode.length);
      editor.scrollTop=editor.scrollHeight;
    };
    const stop=()=>cancelAnimationFrame(frame);
    if(api.signal.aborted)return;
    if(api.reduced){update(1);await playPanel(panel,api);return;}
    // Brief pauses at line ends give the cursor the cadence of manual typing.
    const boundaries=javaCode.split('\n').reduce((out,line)=>{out.push((out.at(-1)||0)+line.length+1);return out;},[]);
    const tick=()=>{
      if(api.signal.aborted)return;
      const duration=Number.isFinite(video.duration)?video.duration:17.84;
      const elapsed=Math.max(0,video.currentTime-.25),typingDuration=Math.max(1,duration-.6);
      const weightedLength=javaCode.length+boundaries.length*4;
      let budget=Math.min(1,elapsed/typingDuration)*weightedLength,chars=0,previous=0;
      for(const end of boundaries){const length=Math.min(end,javaCode.length)-previous;if(budget<length){chars+=Math.max(0,budget);break;}chars+=length;budget-=length;if(budget<4)break;budget-=4;previous=end;}
      update(Math.min(1,chars/javaCode.length));frame=requestAnimationFrame(tick);
    };
    api.signal.addEventListener('abort',stop,{once:true});frame=requestAnimationFrame(tick);
    try{await playPanel(panel,api);if(!api.signal.aborted&&panel.dataset.mediaState==='ended')update(1);}
    finally{stop();api.signal.removeEventListener('abort',stop);}
  }
  scenes.s05={...scenes.s05,duration:17875,render:()=>body('gpt',javaPanel()+gptPanel(),'왼쪽: Java 코드 작성 재현 / 오른쪽: 사용자 제공 GPT동영상.mp4 · 전체 화면 · 5배속 · 무음'),play:playGpt};
  scenes.s16={...scenes.s16,continuity:false,duration:39000,render:()=>body('investing',media('hts','가격과 거래량 · 실제 HTS')+news(),'HTS: 사용자 제공 전체 화면 · 3배속 · 무음 / 뉴스·공시: 실제 브라우저 캡처 · 무음 · 동일 사건 근거 아님'),play};
})();
