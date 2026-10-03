'use strict';
let current=null,currentEntry=null,mountedIdentity=null,workflowProbeCards=[];
const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
function mountWorkflowProbes(){
 const host=document.getElementById('workflowProbes');host.replaceChildren();
 const specs=[
  {id:'event',type:'event',workflow:'websocket_lifecycle',state:'connected',label:'수신 상태'},
  {id:'action',type:'action',workflow:'guarded_order',state:'review',label:'주문 단계'},
  {id:'status',type:'status',workflow:'oauth_lifecycle',state:'auth_required',label:'인증 상태'},
 ];
 return specs.map((spec,index)=>{const correlation={dataset_id:'public-fixture-dataset',item_id:'workflow-'+spec.id,ordinal:index+10};const {card,body}=makeCard(spec.type,'공개 '+spec.id+' 상태',{},correlation);card.dataset.workflow=spec.workflow;card.dataset.screenState=spec.state;
  const row=document.createElement('div');row.className='workflow-state';const key=document.createElement('span');key.className='workflow-state-label';key.textContent=spec.label;const value=document.createElement('span');value.className='workflow-state-value';value.textContent=spec.state;row.append(key,value);
  const guard=document.createElement('div');guard.className='workflow-guard';guard.textContent='공개 합성 표시 전용';body.append(row,guard);host.appendChild(card);return {id:spec.id,card,body};});
}
function mount(entry){
 grid.replaceChildren();activeDatasetId=null;currentEntry=entry;
 const correlation={dataset_id:'public-fixture-dataset',item_id:'public-state',ordinal:0};
 if(entry.retained){const prior=makeCard('facts','공개 합성 결과',{}, {...correlation,item_id:'public-retained',ordinal:1});prior.body.textContent='공개 합성 데이터';}
 if(entry.normal){const result=makeCard(entry.type==='table'?'mcp-table':entry.type,'공개 정상 카드',{},correlation);current=result.card;result.body.textContent='공개 정상 카드 높이 비교';}
 else {current=renderRestStateCard({canvas_type:entry.type,state:entry.state,layout:{},correlation});attachRestRetryAction(current,'public-fixture-token');}
 if(entry.expanded)current.classList.add('is-expanded');
 const peer=document.createElement('div');peer.className='fixture-control';peer.setAttribute('aria-hidden','true');grid.appendChild(peer);
 workflowProbeCards=mountWorkflowProbes();
 mountedIdentity=current;
 current.scrollIntoView({block:'nearest'});return {mounted:!!current.isConnected,providerInvocations};
}
async function measure(stage){
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const card=current,body=card.querySelector('.card-body'),button=card.querySelector('.rest-retry-action button'),status=card.querySelector('.rest-retry-action [role="status"]');
 const geometry={card:rect(card),body:rect(body)},style=getComputedStyle(card),issues=[];
 const workflowGeometry=workflowProbeCards.map(probe=>{const cardStyle=getComputedStyle(probe.card),bodyStyle=getComputedStyle(probe.body),cardRect=rect(probe.card),bodyRect=rect(probe.body);return {id:probe.id,restState:probe.card.dataset.restState||null,card:{width:cardRect.width,height:cardRect.height},body:{width:bodyRect.width,height:bodyRect.height},minHeight:cardStyle.minHeight,maxHeight:cardStyle.maxHeight,alignSelf:cardStyle.alignSelf,bodyFlex:bodyStyle.flex};});
 if(workflowGeometry.some(probe=>probe.restState!==null))issues.push('workflow-probe-rest-state-leak');
 const glyphs=[];const walker=document.createTreeWalker(card,NodeFilter.SHOW_TEXT);
 let node;while((node=walker.nextNode())){if(!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect();if(!range.getClientRects().length||!r.width||!r.height)continue;const role=node.parentElement.closest('.rest-retry-action')?'action':node.parentElement.closest('.card-head')?'header':'message';glyphs.push({role,...rect({getBoundingClientRect:()=>r})});if(r.left<geometry.card.x-.5||r.right>geometry.card.right+.5||r.top<geometry.card.y-.5||r.bottom>geometry.card.bottom+.5)issues.push('glyph-outside-'+role);}
 let interaction=null;
 if(button){button.focus({preventScroll:true});const focus=getComputedStyle(button);const focused=document.activeElement===button;const outline=parseFloat(focus.outlineWidth)||0;const enabledStyle={opacity:focus.opacity,height:button.getBoundingClientRect().height};button.disabled=true;const disabledStyle={opacity:getComputedStyle(button).opacity};const disabled=button.disabled;button.disabled=false;button.focus({preventScroll:true});interaction={focused,outlineWidth:outline,enabledStyle,disabledStyle,disabledProperty:disabled,typeButton:button.type==='button',statusRole:status?.getAttribute('role')==='status',statusLive:status?.getAttribute('aria-live')==='polite'};if(!focused)issues.push('retry-focus-failed');if(enabledStyle.height<36)issues.push('retry-target-below36');if(outline<2)issues.push('retry-focus-outline-missing');if(Number(disabledStyle.opacity)>=Number(enabledStyle.opacity))issues.push('retry-disabled-style-missing');}
 if(!currentEntry.normal&&!currentEntry.expanded&&geometry.card.height>200)issues.push('state-card-excess-blank-height');
 if(currentEntry.normal&&currentEntry.type==='chart'&&geometry.card.height<420)issues.push('normal-chart-height-regression');
 const requiredGlyphAvailable=['header','message',...(button?['action']:[])].every(role=>glyphs.some(glyph=>glyph.role===role));
 if(!requiredGlyphAvailable)issues.push('required-glyph-unavailable');
 if(card!==mountedIdentity)issues.push('same-dom-failed');
 const retainedDataCount=grid.querySelectorAll('.card[data-dataset-id]:not([data-screen-state])').length;
 if(retainedDataCount!==(currentEntry.normal||currentEntry.retained?1:0))issues.push('retained-data-count-mismatch');
 if(providerInvocations)issues.push('forbidden-provider-invoke');
 return {stage,sameDOM:card===mountedIdentity,mounted:card.isConnected,geometry,workflowGeometry,glyphs,requiredGlyphAvailable,interaction,minHeight:style.minHeight,maxHeight:style.maxHeight,retainedDataCount:grid.querySelectorAll('.card[data-dataset-id]:not([data-screen-state])').length,providerInvocations,issues};
}
window.restPublic={mount,measure,destroy(){grid.replaceChildren();document.getElementById('workflowProbes').replaceChildren();workflowProbeCards=[];current=null;return {cardCount:grid.querySelectorAll('.card').length,providerInvocations};}};
