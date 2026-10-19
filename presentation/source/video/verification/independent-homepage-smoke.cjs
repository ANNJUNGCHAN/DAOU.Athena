const fs = require('fs'), path = require('path'), crypto = require('crypto');
const {openAuthoring} = require('../render-film.cjs');
const root = path.resolve(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'interaction-spec.json')));
const tracked = ['stage.js', 'stage.css', 'feature-detail.js', 'stage.html', 'interaction-spec.json', 'stage-sequence.json'];
const hashes = () => Object.fromEntries(tracked.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
(async () => {
  const before = hashes(), app = await openAuthoring({entry:'stage.html'}), samples = [], identities = [], continuity = [];
  try {
    for (const f of spec.features) {
      const at = p => f.range[0] + (f.range[1] - f.range[0]) * p;
      for (const p of [.15, .3, .46, .63, .64, .65, .88]) {
        await app.page.evaluate(async t => window.athenaStage.render(t), at(p));
        samples.push(await app.page.evaluate(({id, p}) => {
          const state = window.athenaStage.getState();
          const bounds = el => {
            if (!el) return null;
            const r = el.getBoundingClientRect(), style = getComputedStyle(el);
            const visibleArea = Math.max(0, Math.min(1920, r.right) - Math.max(0, r.left)) * Math.max(0, Math.min(1080, r.bottom) - Math.max(0, r.top));
            return {text:el.textContent.trim().slice(0,220), x:r.x, y:r.y, width:r.width, height:r.height, areaInFrame:r.width*r.height ? visibleArea/(r.width*r.height) : 0, opacity:style.opacity, display:style.display, visibility:style.visibility};
          };
          return {id, p, time:state.time, camera:state.camera, input:state.inputText, phase:state.phase, targetId:state.cursorTargetId, target:bounds(document.getElementById(state.cursorTargetId)), prompt:bounds(document.querySelector('#prompt,#mini-prompt')), receipts:[...document.querySelectorAll('.receipt,.code,.menu,.glaux-heading')].map(bounds), messages:[...document.querySelectorAll('.chat-history>*')].map(bounds), uiMode:state.domMode};
        }, {id:f.id,p}));
      }
      await app.page.evaluate(async t => {await window.athenaStage.render(t);window.__reviewShell=document.querySelector('.shell');window.__reviewPrompt=document.querySelector('#prompt');}, at(.41));
      await app.page.evaluate(async t => window.athenaStage.render(t), at(.47));
      identities.push(await app.page.evaluate(id => ({id,shellRetained:window.__reviewShell===document.querySelector('.shell'),promptRetained:window.__reviewPrompt===document.querySelector('#prompt')}), f.id));
      for (const [kind,transition] of [['result',at(.64)],['feature-end',f.range[1]]]) {
        const centre=Math.round(transition*30)/30, frames=[];
        for (const t of [centre-1/30,centre,centre+1/30]) {
          if(t<0||t>=60)continue;
          frames.push(await app.page.evaluate(async t=>{await window.athenaStage.render(t);const s=window.athenaStage.getState();return {time:t,id:s.featureId,phase:s.phase,camera:s.camera};},t));
        }
        continuity.push({id:f.id,kind,frames});
        const edge=[];
        for (const t of [transition-.00001,transition+.00001]) {
          if(t<0||t>=60)continue;
          edge.push(await app.page.evaluate(async t=>{await window.athenaStage.render(t);const s=window.athenaStage.getState();return {time:t,id:s.featureId,phase:s.phase,camera:s.camera};},t));
        }
        continuity.push({id:f.id,kind:kind+'-epsilon',frames:edge});
      }
    }
    const geometry = await app.page.evaluate(async () => {
      await window.athenaStage.render(4.31);
      const selectors=['.shell','.side','.operated-canvas','.chat-pane','.composer','.nav','.input'];
      return Object.fromEntries(selectors.map(s=>{const e=document.querySelector(s),c=getComputedStyle(e);return [s,{left:c.left,top:c.top,width:c.width,height:c.height,fontSize:c.fontSize}]}));
    });
    const result = {scope:'Independent authoring runtime: DOM identity, active geometry and semantic visibility metadata; visual judgement is separate.',sourceBefore:before,sourceAfter:hashes(),sourceUnchanged:JSON.stringify(before)===JSON.stringify(hashes()),errors:app.errors,samples,identities,continuity,geometry};
    fs.writeFileSync(path.join(__dirname,'independent-homepage-runtime.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({samples:samples.length,identities:identities.length,errors:app.errors,sourceUnchanged:result.sourceUnchanged}));
  } finally {await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
