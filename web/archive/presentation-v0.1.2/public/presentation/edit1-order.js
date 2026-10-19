/* Edited opening: 18 slides. The user subsequently requested the F feature segment. */
(() => {
 'use strict';
 const old=window.ATHENA_REVIEW_DATA;
 const rows=[
 ['s02-question',['S01','S02']],['s02-claude',['S03']],['s04-c',['S04']],['s05',['S05']],['s07-kis',['S07']],['s08',['S08']],['s09',['S09']],['s09-dust',[]],['s10',['S10']],['s11-en',['S11']],['s11-ko',[]],['s12',['S12']],['s13',['S13','S14','S15']],['s16',['S16','S17']],['s18',['S18','S19']],['s20',['S20']],['s21',['S21']],['s22',['S22','S23','S24']]
 ];
 const original=new Map(old.cues.map(c=>[c.id,c]));
 const narrationSource={...old.mainNarration,...old.activeNarration};
 const cues=rows.map(([id,sourceIds],index)=>{
   const narration=sourceIds.map(key=>narrationSource[key]||'').filter(Boolean).join('\n\n');
   return {...original.get(id),id,script:'R'+String(index+1).padStart(2,'0'),sourceIds:[...sourceIds],narration,unitNarration:narration,stepNarration:undefined,unit:index,hold:null,autoNext:id==='s21',note:'사용자 편집본의 '+(index+1)+' / 18 장면'};
 });
 // Preserve only the explicitly re-requested feature segment, not removed D/B scenes.
 const features=old.cues.filter(c=>/^f0[456](?:-|$)/.test(c.id));
 for(const feature of features){
   const index=cues.length, sourceIds=feature.sourceIds.length?feature.sourceIds:[old.featureSteps[feature.id]?.source].filter(Boolean);
   cues.push({...feature,unit:index,sourceIds:[...sourceIds],script:'R'+String(index+1).padStart(2,'0'),hold:null,autoNext:false,note:'추가 요청된 ATHENA 기능 소개 · '+(index-17)+' / '+features.length});
 }
 const units=cues.map((cue,index)=>({number:index+1,first:index,last:index,sourceIds:[...cue.sourceIds]}));
 const kept=Object.fromEntries(rows.flatMap(([,ids])=>ids.map(key=>[key,narrationSource[key]])));
 for(const id of ['F01','F02','F03'])if(narrationSource[id])kept[id]=narrationSource[id];
 window.ATHENA_REVIEW_DATA={...old,cues,units,mainNarration:kept,activeNarration:{...kept}};
 window.ATHENA_SCRIPT=Object.fromEntries(cues.map(c=>[c.script,c.narration.replace(/\*\*/g,' ')]));
})();
