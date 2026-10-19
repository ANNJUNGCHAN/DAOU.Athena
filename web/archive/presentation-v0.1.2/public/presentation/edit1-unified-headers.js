/* Visual-only header contract. Load after all scene overrides and edit1-order,
 * before review-presentation. Existing animation target headers remain in DOM. */
(() => {
  'use strict';
  const scenes=window.ATHENA_SCENES, data=window.ATHENA_REVIEW_DATA;
  const excluded=new Set(['s02-question','s02-claude']);
  const dark=new Set(['s04-c','s09','s09-dust','s10','s21','s22']);
  // Missing subtitles are condensed from review-script-data mainNarration /
  // featureSteps. This does not replace or mutate any presenter narration.
  const missing={
    s10:['투자 판단에 집중할 수 있도록','개발 부담 없이, 투자자가 자신의 투자 판단에 집중할 수 있어야 합니다.'],
    's11-en':['투자의 시야를 가리던 안개를 걷어내다','정보 너머의 맥락을 보며 투자자가 스스로 판단할 수 있도록 돕고자 했습니다.'],
    's11-ko':['투자의 시야를 가리던 안개를 걷어내다','정보 너머의 맥락을 보며 투자자가 스스로 판단할 수 있도록 돕고자 했습니다.'],
    s12:['그 질문에서 출발한 제품, ATHENA','개발 부담을 덜고 투자자의 판단을 돕는 작업 공간을 소개합니다.'],
    s13:['투자자의 말이 실제 작업으로 이어지는 공간','ATHENA는 차트와 정보, 판단과 기록으로 이어지는 투자자의 작업을 연결합니다.'],
    s21:[null,'차트와 정보, 판단과 기록으로 이어지는 투자자의 작업을 하나의 채팅으로 연결합니다.'],
    s22:[null,'차트와 정보, 판단과 기록으로 이어지는 투자자의 작업을 하나의 채팅으로 연결합니다.'],
    f04:[null,'아고라는 차트와 자료를 열고, 보고 있는 화면과 문서를 바탕으로 대화를 이어갑니다.'],
    'f04-tool':[null,'AI가 요청을 해석하면 허용된 도구가 조회하고, 결과를 답변과 화면으로 돌려줍니다.'],
    'f04-result':[null,'메티스는 관심과 판단을 기록하고, 이전 근거와 관련 자료를 다시 살펴보도록 돕습니다.'],
    'f04-memory':[null,'직접 말한 내용과 추론을 구분하고, 기억의 출처를 확인하며 잘못 이해한 내용을 바로잡습니다.'],
    f05:[null,'에르가네는 시세와 기업정보, 뉴스 등 필요한 정보를 연결된 도구의 기능과 권한 안에서 활용합니다.'],
    'f05-tool':[null,'AI가 제안한 연결 설정과 허용 기능을 사람이 검토하고 승인합니다.'],
    'f05-result':[null,'아이기스는 관심에 맞는 변화를 살피고, 정해 둔 조건에 따라 알림과 반복 작업을 수행합니다.'],
    'f05-memory':[null,'설정한 조건과 관측값을 비교하고, 반복 알림을 줄이며 실행 이력으로 변화를 확인합니다.'],
    f06:[null,'팔라스는 빠진 조건을 확인하며 전략을 작성하고, 과거 데이터에서 규칙과 결과를 검토합니다.'],
    'f06-tool':[null,'체결 시점과 수수료, 세금, 슬리피지를 반영해 같은 가정으로 결과와 낙폭을 비교합니다.'],
    'f06-result':[null,'글로우는 데스크톱의 작은 창에서 질문하고, 소식과 작업 결과를 확인하며 대화를 이어갑니다.'],
    'f06-memory':[null,'AI는 해석과 기억 구조화를, 도구와 코드는 조회와 계산을 맡고 결과와 근거를 같은 공간에 모읍니다.']
  };
  const selector=':scope > header, :scope > .cc-cs-title, :scope > .rev-header';
  const clean=text=>text.replace(/\s+/g,' ').trim();
  const applied=[];
  for(const cue of data.cues){
    const id=cue.hold||cue.id;
    if(excluded.has(id)||applied.includes(id)||!scenes[id]||scenes[id].ownHeader)continue;
    applied.push(id);
    const def=scenes[id],original=def.render;
    def.render=()=>{
      const host=document.createElement('div');host.innerHTML=original();
      const stage=host.firstElementChild;if(!stage)return host.innerHTML;
      stage.classList.add('e1-unified-scene');stage.dataset.unifiedCue=id;
      const old=stage.querySelector(selector);
      const title=clean(old?.querySelector('h1')?.textContent||missing[id]?.[0]||def.title||'');
      const sub=clean(old?.querySelector('p')?.textContent||missing[id]?.[1]||'');
      if(old){old.classList.add('e1-original-header');old.setAttribute('aria-hidden','true');}
      const header=document.createElement('header');header.className='e1-unified-header'+(dark.has(id)?' e1-unified-dark':'');
      const h1=document.createElement('h1'),p=document.createElement('p');h1.textContent=title;p.textContent=sub;header.append(h1,p);stage.append(header);
      return host.innerHTML;
    };
  }
  // The presentation controller's legacy postprocessor must not rewrite the
  // agreed titles after a new scene has rendered or while a previous cue exits.
  const legacy=window.ATHENA_UPDATE_HEADER;
  window.ATHENA_UPDATE_HEADER=(root,id)=>{if(root.querySelector('.e1-unified-header'))return;legacy?.(root,id);};
  window.ATHENA_UNIFIED_HEADERS=Object.freeze({ids:applied,excluded:[...excluded],source:'S08 typography / existing titles and review-script-data narration'});
})();
