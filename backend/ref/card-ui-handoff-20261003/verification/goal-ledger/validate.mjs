#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const readJson=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const dir=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(dir,'../../../../..');
const currentFile=path.join(dir,'current.json');
const q=readJson(path.join(repo,'backend/ref/card-ui-questionnaire.json'));
const index=readJson(path.join(repo,'backend/ref/card-surface-templates/index.json'));
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const targets={max:{width:2560,height:1392},narrow:{width:1411,height:1166},remax:{width:2560,height:1392}};
const stageKeys=['top','core_content','source_and_units','no_clip_overlap_blank','restoration'];
const regionKeys=['bottom','final_row','final_column'];
const contentKeys=['zero','negative','missing','error','loading_or_timeout','long_text','empty'];
const ambiguous=q.templates.filter(t=>t.scope==='in_scope'&&t.ui_steps.some(s=>Array.isArray(s?.ambiguous_targets)&&s.ambiguous_targets.length>1)).map(t=>t.template_id).sort();
const missing=q.templates.filter(t=>t.scope==='in_scope'&&!t.prompt&&t.ui_steps.length===0).map(t=>t.template_id).sort();
const sha=/^[a-f0-9]{64}$/;
const commit=/^[a-f0-9]{40}$/;
const zeros=/^0+$/;
const nonempty=v=>typeof v==='string'&&v.trim().length>0;
const clone=v=>JSON.parse(JSON.stringify(v));
const hashFile=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const exact=(a,b)=>{const x=[...new Set(a)].sort(),y=[...new Set(b)].sort();return x.length===a.length&&x.length===y.length&&x.every((v,i)=>v===y[i]);};
const exactKeys=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&exact(Object.keys(o),k);
const sameSize=(a,b)=>a?.width===b?.width&&a?.height===b?.height;
const safeRelative=p=>nonempty(p)&&!path.isAbsolute(p)&&!p.includes('..')&&!/^[A-Za-z]:/.test(p);
const controls=t=>(t.ui_steps||[]).filter(s=>s&&typeof s==='object').map(s=>({action:s.action??null,control:s.control??null,from_design_reference_id:s.from_template_id??null,to_design_reference_id:s.to_template_id??null}));
const check=()=>({applicability:'UNCONFIRMED',status:'NOT_RUN',justification:null,evidence_ref:null});
const nativeById=new Map(q.templates.filter(t=>t.scope==='in_scope').map(t=>[t.template_id,t]));
const flowById=new Map(q.additional_flows.filter(f=>f.id!=='protected-action').map(f=>[f.id,f]));
function nativeContract(t){return {name:t.name,scope:'in_scope',expected_card_kind:t.expected_card_kind,seed_or_route:{seed_id:t.seed_id??null,prompt:t.prompt??null,steps:controls(t),route_source:t.route_source??null,prerequisites:t.prerequisites??[]},route_caveat:t.route_caveat??null,design_controls:controls(t)};}
function flowContract(f){const pseudo={ui_steps:(f.ui_steps||[]).map(x=>typeof x==='string'?{action:'instruction',control:x}:x)};return {name:f.id,scope:'in_scope',expected_card_kinds:f.expected_card_kinds||[],seed_or_route:{prompt:f.prompt??null,steps:controls(pseudo),prerequisites:f.prerequisites||[]},historical_questionnaire_status:f.status,design_controls:controls(pseudo)};}
function contractFor(i){return nativeById.has(i.item_id)?nativeContract(nativeById.get(i.item_id)):flowById.has(i.item_id)?flowContract(flowById.get(i.item_id)):null;}
function pngSize(file){const b=fs.readFileSync(file);if(b.length<24||b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||b.subarray(12,16).toString('ascii')!=='IHDR')return null;return {width:b.readUInt32BE(16),height:b.readUInt32BE(20)};}
function rasterScaleMatches(pixel,outer,scale){return Number.isFinite(scale)&&scale>0&&pixel?.width===Math.round(outer.width*scale)&&pixel?.height===Math.round(outer.height*scale);}

function evidence(t){
  return {
    source_cohort:null,session_id:null,session_receipt_ref:null,runtime_commit_sha:null,runtime_source_hashes:[],
    route_status:missing.includes(t.template_id)?'MISSING':ambiguous.includes(t.template_id)?'AMBIGUOUS':'UNCONFIRMED',
    observed_route:{prompt:null,steps:[],route_source:null,evidence_ref:null},route_identity_assertions:[],observed_runtime_template_id:null,runtime_identity:{method:null,evidence_ref:null},
    call_status:'NOT_RUN',call_evidence_ref:null,card_instance_marker:null,
    resize_cycle:Object.entries(targets).map(([stage,size])=>({stage,expected_window_outer_size:size,measured_window_outer_size:null,measured_renderer_viewport_size:null,device_scale_factor:null,card_instance_marker:null,raster_evidence_ref:null,checks:{top:'NOT_RUN',core_content:'NOT_RUN',source_and_units:'NOT_RUN',no_clip_overlap_blank:'NOT_RUN',restoration:'NOT_RUN'},checks_evidence_ref:null})),
    regions:{bottom:check(),final_row:check(),final_column:check()},
    control_inventory:{status:'UNCONFIRMED',design_expected:controls(t),observed_controls:[],no_controls:null,inventory_evidence_ref:null},
    content_state_inventory:{status:'UNCONFIRMED',zero:check(),negative:check(),missing:check(),error:check(),loading_or_timeout:check(),long_text:check(),empty:check()},
    privacy_class:'PUBLIC_METADATA_ONLY',evidence_refs:[],bug_ids:[],independent_review:{status:'NOT_RUN',author_id:null,reviewer_id:null,report_ref:null},
    recorded_outcome:'NOT_RUN',freshness_status:'CURRENT',final_status:'NOT_RUN'
  };
}
function native(t){const c=nativeContract(t);return {item_id:t.template_id,expected_design_reference_id:t.template_id,...c,paper_reference:null,...evidence(t)};}
function flow(f){const c=flowContract(f),pseudo={template_id:f.id,seed_id:null,ui_steps:c.design_controls.map(x=>({action:x.action,control:x.control,from_template_id:x.from_design_reference_id,to_template_id:x.to_design_reference_id}))};return {item_id:f.id,expected_design_reference_id:f.id,...c,...evidence(pseudo)};}
function makeInitial(){
  const ins=q.templates.filter(t=>t.scope==='in_scope'),refs=q.templates.filter(t=>t.scope==='reference_only');
  const d={
    schema_version:2,ledger_kind:'CARD_UI_GOAL_CURRENT',lifecycle:'M2_INITIAL',authored_date:'2026-10-04',ledger_author_id:'goal-ledger-author-unassigned',
    sources:{questionnaire:'backend/ref/card-ui-questionnaire.json',design_registry:'backend/ref/card-surface-templates/index.json',goal_plan:'backend/ref/card-ui-handoff-20261003/GOAL-PLAN-20261004.md',independent_plan_review:'backend/ref/card-ui-handoff-20261003/reviews/GOAL-PLAN-20261004-REVIEW.md'},
    starting_receipt:{canonical_design_states:101,native_in_scope:94,native_reference_only:7,additional_flows_in_scope:30,additional_flows_reference_only:1,paper_confirmed:0,native_full_cycles_confirmed:0,questionnaire_observed_runtime_template_ids_non_null:q.templates.filter(t=>t.scope==='in_scope'&&t.observed_template_id!=null).length,historical_passes_promoted:false},
    status_model:{computed_final_statuses:['PASS','FAIL','NOT_RUN','BLOCKED_EXTERNAL'],freshness_statuses:['CURRENT','REVALIDATE'],recorded_outcomes:['PASS','FAIL','NOT_RUN','BLOCKED_EXTERNAL'],excluded_status:'EXCLUDED',pass_is_validator_computed:true,unresolved_route_prevents_pass:true,arbitrary_not_applicable_forbidden:true},
    size_contract:{requirement_basis:'WINDOW_OUTER',target_sequence:Object.entries(targets).map(([stage,window_outer_size])=>({stage,window_outer_size})),renderer_viewport_recorded_separately:true,same_card_instance_required:true,full_window_raster_required:true,viewer_thumbnail_is_evidence:false,offscreen_or_partial_capture_is_pass:false},
    evidence_contract:{private_root_cli:'--evidence-root',manifest_name:'manifest.json',repo_refs_must_exist_and_match_sha256:true,private_refs_must_resolve_in_manifest:true,validator_is_not_an_authority:true,final_independent_review_required:true},
    route_gaps:{ambiguous_count:ambiguous.length,ambiguous_item_ids:ambiguous,missing_count:missing.length,missing_item_ids:missing,resolution_rule:'M1 must confirm a unique executable route and evidence-bound identity assertion before PASS.'},
    paper:{source_cohort:null,session_id:null,before_snapshot_ref:null,after_snapshot_ref:null,mapping_receipt_ref:null,independent_review:{status:'NOT_RUN',author_id:null,reviewer_id:null,report_ref:null},
      items:q.templates.map(t=>({item_id:t.template_id,expected_design_reference_id:t.template_id,name:t.name,scope:t.scope,actual_paper_reference:null,final_status:'NOT_RUN'}))},
    native:{items:ins.map(native),excluded:refs.map(t=>({item_id:t.template_id,expected_design_reference_id:t.template_id,name:t.name,scope:'reference_only',reason:'REAL_ORDER_OR_BROKER_EXECUTION_OUTSIDE_SCOPE',observed_runtime_template_id:null,evidence_refs:[],final_status:'EXCLUDED'}))},
    additional_flows:{in_scope:q.additional_flows.filter(f=>f.id!=='protected-action').map(flow),excluded:q.additional_flows.filter(f=>f.id==='protected-action').map(f=>({item_id:f.id,expected_design_reference_id:f.id,scope:'reference_only',reason:'PROTECTED_ACTION_READ_ONLY_DESIGN_REFERENCE',observed_runtime_template_id:null,evidence_refs:[],final_status:'EXCLUDED'}))},
    aggregates:null
  };
  d.aggregates=makeAggregates(d);return d;
}
function loadEvidenceRoot(rootPath,errors){
  if(!rootPath)return {root:null,manifest:null,entries:new Map(),manifestSha:null};
  const root=path.resolve(rootPath),mf=path.join(root,'manifest.json');
  if(!fs.existsSync(mf)){errors.push('evidence manifest missing: manifest.json');return {root,manifest:null,entries:new Map(),manifestSha:null};}
  let manifest;try{manifest=readJson(mf);}catch{errors.push('evidence manifest invalid JSON');return {root,manifest:null,entries:new Map(),manifestSha:null};}
  const entries=new Map();
  if(manifest.schema_version!==1)errors.push('evidence manifest schema_version must be 1');
  if(!nonempty(manifest.cohort_id))errors.push('evidence manifest cohort_id required');
  if(!commit.test(manifest.source_commit_sha||'')||zeros.test(manifest.source_commit_sha||''))errors.push('evidence manifest source_commit_sha invalid');
  if(!Array.isArray(manifest.product_source_closure)||manifest.product_source_closure.length===0)errors.push('evidence manifest product_source_closure required');
  if(!Array.isArray(manifest.artifacts)||manifest.artifacts.length===0)errors.push('evidence manifest artifacts must be non-empty');
  for(const a of manifest.artifacts||[]){
    if(!nonempty(a?.id)||entries.has(a.id)){errors.push('evidence manifest artifact id missing or duplicate');continue;}entries.set(a.id,a);if(a.kind==='independent-review')errors.push('independent review must not be included in evidence manifest');
    if(!safeRelative(a.relative_path)){errors.push('artifact '+a.id+': unsafe relative_path');continue;}
    const file=path.resolve(root,a.relative_path);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){errors.push('artifact '+a.id+': file missing');continue;}
    if(!sha.test(a.sha256||'')||zeros.test(a.sha256)||hashFile(file)!==a.sha256)errors.push('artifact '+a.id+': sha256 mismatch');
  }
  return {root,manifest,entries,manifestSha:hashFile(mf)};
}
function resolveRef(ref,ctx,errors,label,opt={}){
  const {required=false,kind=null,itemId=null,sessionId=null,cohort=null,stage=null}=opt;
  if(!ref||typeof ref!=='object'){if(required)errors.push(label+': evidence ref required');return null;}
  if(!['REPO','PRIVATE'].includes(ref.scope)){errors.push(label+': invalid evidence scope');return null;}
  if(!sha.test(ref.sha256||'')||zeros.test(ref.sha256||'')){errors.push(label+': invalid evidence sha256');return null;}
  let file,entry=null,document=null;
  if(ref.scope==='REPO'){
    const normalized=(ref.path||'').replaceAll('\\','/');
    if(!safeRelative(ref.path)||!normalized.startsWith('backend/ref/card-ui-handoff-20261003/')||normalized.endsWith('/verification/goal-ledger/current.json')||normalized.endsWith('/verification/goal-ledger/validate.mjs')){errors.push(label+': repo evidence path not allowed');return null;}
    file=path.resolve(repo,ref.path);
    if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)){errors.push(label+': repo evidence file missing');return null;}
    if(hashFile(file)!==ref.sha256){errors.push(label+': repo evidence hash mismatch');return null;}
    try{document=readJson(file);}catch{errors.push(label+': repo evidence must be valid JSON');return null;}
    if(kind&&document?.kind!==kind)errors.push(label+': repo evidence kind mismatch');
    if(itemId&&document?.item_id!==itemId)errors.push(label+': repo evidence item binding mismatch');
    if(sessionId&&document?.session_id!==sessionId)errors.push(label+': repo evidence session binding mismatch');
    if(cohort&&document?.source_cohort!==cohort)errors.push(label+': repo evidence cohort binding mismatch');
    if(stage&&document?.stage!==stage)errors.push(label+': repo evidence stage binding mismatch');
  }else{
    if(!ctx.root||!ctx.manifest){errors.push(label+': --evidence-root with valid manifest required');return null;}
    if(!nonempty(ref.artifact_id)||(entry=ctx.entries.get(ref.artifact_id))==null){errors.push(label+': private artifact missing from manifest');return null;}
    if(entry.sha256!==ref.sha256){errors.push(label+': private artifact hash differs from manifest');return null;}
    file=path.resolve(ctx.root,entry.relative_path);
  }
  if(entry){
    if(kind&&entry.kind!==kind)errors.push(label+': artifact kind mismatch');
    if(itemId&&entry.item_id!==itemId)errors.push(label+': artifact item binding mismatch');
    if(sessionId&&entry.session_id!==sessionId)errors.push(label+': artifact session binding mismatch');
    if(cohort&&entry.source_cohort!==cohort)errors.push(label+': artifact cohort binding mismatch');
    if(stage&&entry.stage!==stage)errors.push(label+': artifact stage binding mismatch');
  }
  return {file,entry,document};
}
function parseEvidence(r,errors,label){if(!r)return null;if(r.document)return r.document;try{return readJson(r.file);}catch{errors.push(label+': evidence must be valid JSON');return null;}}
function hasClaim(r,claimField,claimKey){const claims=(r?.entry?.metadata??r?.document?.metadata)?.[claimField];return Array.isArray(claims)&&claims.includes(claimKey);}
function proveRef(ref,ctx,errors,label,opt,claimField,claimKey){const r=resolveRef(ref,ctx,errors,label,opt);if(!r)return null;if(!hasClaim(r,claimField,claimKey)){errors.push(label+': artifact does not assert '+claimField+' '+claimKey);return null;}return r;}
function validateSource(i,ctx,errors,strict){
  if(!strict)return false;
  let ok=true;
  const closure=ctx.manifest?.product_source_closure;
  if(i.source_cohort!==ctx.manifest?.cohort_id){errors.push(i.item_id+': source cohort does not match manifest');ok=false;}
  const commitBound=i.runtime_commit_sha===ctx.manifest?.source_commit_sha&&commit.test(i.runtime_commit_sha||'')&&!zeros.test(i.runtime_commit_sha||'');if(!commitBound){errors.push(i.item_id+': runtime commit is not bound to manifest');ok=false;}
  if(commitBound)try{execFileSync('git',['cat-file','-e',i.runtime_commit_sha+'^{commit}'],{cwd:repo,stdio:'ignore'});execFileSync('git',['merge-base','--is-ancestor',i.runtime_commit_sha,head],{cwd:repo,stdio:'ignore'});}catch{errors.push(i.item_id+': runtime commit is not valid provenance for current HEAD');ok=false;}
  const normalized=x=>(x||[]).map(v=>({repo_path:v.repo_path,sha256:v.sha256})).sort((a,b)=>a.repo_path.localeCompare(b.repo_path));
  if(!Array.isArray(closure)||closure.length===0||JSON.stringify(normalized(i.runtime_source_hashes))!==JSON.stringify(normalized(closure))){errors.push(i.item_id+': runtime source hashes do not match product source closure');return false;}
  for(const s of closure){
    const p=(s?.repo_path||'').replaceAll('\\','/');
    if(!safeRelative(s?.repo_path)||(!p.startsWith('app/')&&!p.startsWith('backend/'))||p.startsWith('backend/ref/')){errors.push(i.item_id+': invalid product source path');ok=false;continue;}
    const file=path.resolve(repo,s.repo_path);
    let blob=null;try{blob=execFileSync('git',['show',i.runtime_commit_sha+':'+p],{cwd:repo});}catch{}
    if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!sha.test(s.sha256||'')||zeros.test(s.sha256||'')||hashFile(file)!==s.sha256||!blob||crypto.createHash('sha256').update(blob).digest('hex')!==s.sha256){errors.push(i.item_id+': product source closure file/hash mismatch');ok=false;}
  }
  return ok;
}
function validateReview(review,itemId,cohort,runtimeCommit,ctx,errors,strict,paper=false){
  if(!strict)return false;
  if(review?.status!=='APPROVED'||!nonempty(review.author_id)||!nonempty(review.reviewer_id)||review.author_id===review.reviewer_id){errors.push(itemId+': independent reviewer identity invalid');return false;}
  if(review?.report_ref?.scope!=='REPO'){errors.push(itemId+': independent review receipt must be separate REPO evidence');return false;}
  const receipt=parseEvidence(resolveRef(review.report_ref,ctx,errors,itemId+' review',{required:true,kind:'independent-review'}),errors,itemId+' review');
  const ids=paper?receipt?.paper_item_ids:receipt?.item_ids;
  const ok=receipt?.status==='APPROVED'&&receipt.author_id===review.author_id&&receipt.reviewer_id===review.reviewer_id&&receipt.author_id!==receipt.reviewer_id&&receipt.reviewed_commit_sha===runtimeCommit&&receipt.reviewed_source_cohort===cohort&&receipt.reviewed_evidence_manifest_sha256===ctx.manifestSha&&Array.isArray(ids)&&ids.includes(itemId);
  if(!ok)errors.push(itemId+': independent review receipt binding mismatch');return ok;
}
function checked(c,i,ctx,errors,label,strict,kind,key){
  if(!c||!['APPLICABLE','NOT_APPLICABLE_VERIFIED'].includes(c.applicability)){if(strict)errors.push(label+': applicability unresolved');return false;}
  if(c.applicability==='APPLICABLE'&&c.status!=='PASS'){errors.push(label+': applicable check not PASS');return false;}
  if(c.applicability==='NOT_APPLICABLE_VERIFIED'&&!nonempty(c.justification)){errors.push(label+': verified N/A needs justification');return false;}
  return !!proveRef(c.evidence_ref,ctx,errors,label,{required:true,kind,itemId:i.item_id,sessionId:i.session_id,cohort:i.source_cohort},'asserted_checks',key);
}
function validateRoute(i,ctx,errors,strict,g){
  if(!strict)return false;
  if(i.route_status!=='CONFIRMED_UNIQUE'){errors.push(i.item_id+': route is not uniquely confirmed');return false;}
  let ok=true;const observed=i.observed_route;if(!exactKeys(observed,['prompt','steps','route_source','evidence_ref'])||(!nonempty(observed.prompt)&&(!Array.isArray(observed.steps)||observed.steps.length===0)&&!nonempty(observed.route_source))||!proveRef(observed.evidence_ref,ctx,errors,i.item_id+' observed route',{required:true,kind:'observed-route',itemId:i.item_id,sessionId:i.session_id,cohort:i.source_cohort},'asserted_checks','observed_route')){errors.push(i.item_id+': observed route is missing or unbound');ok=false;}
  if(nonempty(i.observed_runtime_template_id)){
    const r=resolveRef(i.runtime_identity?.evidence_ref,ctx,errors,i.item_id+' runtime identity',{required:true,kind:'runtime-metadata',itemId:i.item_id,sessionId:i.session_id,cohort:i.source_cohort});
    ok=i.runtime_identity?.method==='runtime_metadata'&&!!r&&ok;
    if(g.runtimeIds.has(i.observed_runtime_template_id))errors.push(i.item_id+': duplicate observed runtime template ID');
    g.runtimeIds.add(i.observed_runtime_template_id);
  }else{
    if(!Array.isArray(i.route_identity_assertions)||i.route_identity_assertions.length===0){errors.push(i.item_id+': route identity assertion required');return false;}
    for(const a of i.route_identity_assertions){
      if(!exactKeys(a,['assertion_id','item_id','status','signature','evidence_ref'])||a.item_id!==i.item_id||a.status!=='PASS'||!nonempty(a.assertion_id)){errors.push(i.item_id+': invalid route assertion schema/binding');ok=false;continue;}
      const s=a.signature;
      if(!exactKeys(s,['expected_card_kind','selected_control','operation_shape','distinctive_text_sha256'])||(!nonempty(s.expected_card_kind)&&!nonempty(s.selected_control)&&!nonempty(s.operation_shape)&&!sha.test(s.distinctive_text_sha256||''))){errors.push(i.item_id+': route assertion signature is empty');ok=false;}
      const key=JSON.stringify(s);
      if(g.assertionIds.has(a.assertion_id)||g.signatures.has(key)){errors.push(i.item_id+': duplicate route assertion/signature');ok=false;}
      g.assertionIds.add(a.assertion_id);g.signatures.add(key);
      if(!resolveRef(a.evidence_ref,ctx,errors,i.item_id+' route assertion',{required:true,kind:'route-identity',itemId:i.item_id,sessionId:i.session_id,cohort:i.source_cohort}))ok=false;
    }
  }
  return ok;
}
function controlsFromItem(i){return i.seed_or_route?.steps?.filter(s=>s&&typeof s==='object').map(s=>({action:s.action??null,control:s.control??null,from_design_reference_id:s.from_design_reference_id??null,to_design_reference_id:s.to_design_reference_id??null}))||[];}
function validateControls(i,ctx,errors,strict){
  const c=i.control_inventory,expected=controlsFromItem(i);
  if(!c||!exactKeys(c,['status','design_expected','observed_controls','no_controls','inventory_evidence_ref'])){if(strict)errors.push(i.item_id+': control inventory keys invalid');return false;}
  if(JSON.stringify(c.design_expected)!==JSON.stringify(expected)){errors.push(i.item_id+': design control inventory changed');return false;}
  if(!strict)return false;
  let ok=c.status==='CONFIRMED'&&!!proveRef(c.inventory_evidence_ref,ctx,errors,i.item_id+' control inventory',{required:true,kind:'control-inventory',itemId:i.item_id,sessionId:i.session_id,cohort:i.source_cohort},'asserted_checks','inventory_complete');
  if(expected.length===0){
    if(!c.no_controls||c.no_controls.status!=='NOT_APPLICABLE_VERIFIED'||!nonempty(c.no_controls.justification)||!proveRef(c.no_controls.evidence_ref,ctx,errors,i.item_id+' no-controls',{required:true,kind:'control-check',itemId:i.item_id,sessionId:i.session_id,cohort:i.source_cohort},'asserted_checks','no_controls')){errors.push(i.item_id+': empty expected controls require verified no-controls evidence');ok=false;}
  }else{
    if(!Array.isArray(c.observed_controls)||c.observed_controls.length<expected.length){errors.push(i.item_id+': observed controls cannot be empty or incomplete');ok=false;}
    for(const w of expected){const got=c.observed_controls.find(v=>v.action===w.action&&v.control===w.control);
      if(!got||!['PASS','NOT_APPLICABLE_VERIFIED'].includes(got.status)||!proveRef(got.evidence_ref,ctx,errors,i.item_id+' control '+w.control,{required:true,kind:'control-check',itemId:i.item_id,sessionId:i.session_id,cohort:i.source_cohort},'asserted_controls',w.action+':'+w.control)){errors.push(i.item_id+': required control missing evidence');ok=false;}
      if(got?.status==='NOT_APPLICABLE_VERIFIED'&&!nonempty(got.justification)){errors.push(i.item_id+': control N/A needs justification');ok=false;}
    }
  }return ok;
}
function validateCycle(i,ctx,errors,strict){
  if(!Array.isArray(i.resize_cycle)||i.resize_cycle.length!==3||i.resize_cycle.map(s=>s.stage).join(',')!=='max,narrow,remax'){if(strict)errors.push(i.item_id+': exact resize stages required');return false;}
  if(!strict)return false;
  let ok=true;
  if(!nonempty(i.session_id)||!nonempty(i.card_instance_marker)){errors.push(i.item_id+': session/card marker required');ok=false;}
  ok=!!resolveRef(i.session_receipt_ref,ctx,errors,i.item_id+' session',{required:true,kind:'session-receipt',itemId:i.item_id,sessionId:i.session_id,cohort:i.source_cohort})&&ok;
  for(const s of i.resize_cycle){
    if(!sameSize(s.expected_window_outer_size,targets[s.stage])||!sameSize(s.measured_window_outer_size,targets[s.stage])||!Number.isInteger(s.measured_renderer_viewport_size?.width)||s.measured_renderer_viewport_size.width<1||!Number.isInteger(s.measured_renderer_viewport_size?.height)||s.measured_renderer_viewport_size.height<1||!Number.isFinite(s.device_scale_factor)||s.device_scale_factor<=0||s.card_instance_marker!==i.card_instance_marker||!exactKeys(s.checks,stageKeys)||!Object.values(s.checks).every(v=>v==='PASS')){errors.push(i.item_id+': '+s.stage+' geometry/check contract incomplete');ok=false;}
    for(const key of stageKeys)if(!proveRef(s.checks_evidence_ref,ctx,errors,i.item_id+' '+s.stage+' check '+key,{required:true,kind:'stage-checks',itemId:i.item_id,sessionId:i.session_id,cohort:i.source_cohort,stage:s.stage},'asserted_checks',key))ok=false;
    const raster=resolveRef(s.raster_evidence_ref,ctx,errors,i.item_id+' '+s.stage+' raster',{required:true,kind:'full-window-raster',itemId:i.item_id,sessionId:i.session_id,cohort:i.source_cohort,stage:s.stage}),m=raster?.entry?.metadata,actualPixels=raster?pngSize(raster.file):null;
    if(!m||raster?.entry?.mime_type!=='image/png'||!actualPixels||m.full_window!==true||m.clipped!==false||m.card_instance_marker!==i.card_instance_marker||m.device_scale_factor!==s.device_scale_factor||!sameSize(m.window_outer_size,s.measured_window_outer_size)||!sameSize(m.renderer_viewport_size,s.measured_renderer_viewport_size)||!sameSize(m.pixel_size,actualPixels)||!rasterScaleMatches(actualPixels,s.measured_window_outer_size,s.device_scale_factor)){errors.push(i.item_id+': '+s.stage+' raster PNG header/scale/metadata is missing or unbound');ok=false;}
  }return ok;
}
function computedStatus(i,ctx,errors,g){
  if(i.freshness_status==='REVALIDATE')return 'NOT_RUN';
  if(i.recorded_outcome==='BLOCKED_EXTERNAL')return 'BLOCKED_EXTERNAL';
  if(i.recorded_outcome==='FAIL'||i.call_status==='FAIL')return 'FAIL';
  if(i.final_status!=='PASS')return 'NOT_RUN';
  let ok=i.recorded_outcome==='PASS'&&i.freshness_status==='CURRENT'&&i.call_status==='PASS'&&i.privacy_class==='PUBLIC_METADATA_ONLY'&&Array.isArray(i.bug_ids)&&i.bug_ids.length===0;
  if(!ok)errors.push(i.item_id+': PASS outcome/freshness/call/privacy/bugs invalid');
  ok=validateSource(i,ctx,errors,true)&&ok;
  ok=validateRoute(i,ctx,errors,true,g)&&ok;
  ok=!!resolveRef(i.call_evidence_ref,ctx,errors,i.item_id+' call',{required:true,kind:'call-receipt',itemId:i.item_id,sessionId:i.session_id,cohort:i.source_cohort})&&ok;
  ok=validateCycle(i,ctx,errors,true)&&ok;
  if(!exactKeys(i.regions,regionKeys)){errors.push(i.item_id+': exact region keys required');ok=false;}else for(const k of regionKeys)ok=checked(i.regions[k],i,ctx,errors,i.item_id+' region '+k,true,'region-check',k)&&ok;
  if(!i.content_state_inventory||!exactKeys(i.content_state_inventory,['status',...contentKeys])||i.content_state_inventory.status!=='CONFIRMED'){errors.push(i.item_id+': exact content-state keys required');ok=false;}else for(const k of contentKeys)ok=checked(i.content_state_inventory[k],i,ctx,errors,i.item_id+' content '+k,true,'content-state-check',k)&&ok;
  ok=validateControls(i,ctx,errors,true)&&ok;
  if(!Array.isArray(i.evidence_refs)||i.evidence_refs.length===0){errors.push(i.item_id+': item evidence refs required');ok=false;}else for(const [n,r] of i.evidence_refs.entries())ok=!!resolveRef(r,ctx,errors,i.item_id+' evidence '+n,{required:true,itemId:i.item_id,sessionId:i.session_id,cohort:i.source_cohort})&&ok;
  ok=validateReview(i.independent_review,i.item_id,i.source_cohort,i.runtime_commit_sha,ctx,errors,true,false)&&ok;
  return ok?'PASS':'NOT_RUN';
}
function validatePaper(d,ctx,errors){
  const p=d.paper;if(!p.items.some(i=>i.final_status==='PASS'))return new Set();
  if(!nonempty(p.source_cohort)||!nonempty(p.session_id)){errors.push('paper source cohort/session required');return new Set();}
  const before=parseEvidence(resolveRef(p.before_snapshot_ref,ctx,errors,'paper before snapshot',{required:true,kind:'paper-before-snapshot',sessionId:p.session_id,cohort:p.source_cohort}),errors,'paper before snapshot');
  const after=parseEvidence(resolveRef(p.after_snapshot_ref,ctx,errors,'paper after snapshot',{required:true,kind:'paper-after-snapshot',sessionId:p.session_id,cohort:p.source_cohort}),errors,'paper after snapshot');
  const mapping=parseEvidence(resolveRef(p.mapping_receipt_ref,ctx,errors,'paper mapping',{required:true,kind:'paper-mapping',sessionId:p.session_id,cohort:p.source_cohort}),errors,'paper mapping');
  const ids=q.templates.map(t=>t.template_id),okIds=x=>Array.isArray(x?.items)&&exact(x.items.map(v=>v.expected_design_reference_id),ids);
  if(!okIds(before)||!okIds(after)||!okIds(mapping)){errors.push('paper snapshots/mapping must contain exact canonical 101');return new Set();}
  const passed=new Set();
  for(const id of ids){
    const b=before.items.find(x=>x.expected_design_reference_id===id),a=after.items.find(x=>x.expected_design_reference_id===id),m=mapping.items.find(x=>x.expected_design_reference_id===id);
    if(!nonempty(b?.paper_reference)||!nonempty(a?.paper_reference)||b.paper_reference!==a.paper_reference||b.editable!==true||a.editable!==true||!sha.test(b.parent_structure_sha256||'')||zeros.test(b.parent_structure_sha256)||b.parent_structure_sha256!==a.parent_structure_sha256||!nonempty(m?.paper_reference)||m.paper_reference!==a.paper_reference||d.paper.items.find(x=>x.item_id===id)?.actual_paper_reference!==a.paper_reference){errors.push('paper '+id+': before/after structure or mapping invalid');continue;}
    if(validateReview(p.independent_review,id,p.source_cohort,ctx.manifest?.source_commit_sha,ctx,errors,true,true))passed.add(id);
  }return passed;
}
function counts(items){const r={total:items.length,pass:0,fail:0,not_run:0,blocked_external:0};for(const i of items){const k=i.final_status.toLowerCase();if(Object.hasOwn(r,k))r[k]++;}return r;}
function makeAggregates(d){
  const pc=d.paper.items.filter(i=>i.final_status==='PASS').length,n=counts(d.native.items),a=counts(d.additional_flows.in_scope);
  return {paper:{total:d.paper.items.length,confirmed:pc,not_run:d.paper.items.length-pc},
    native:{...n,revalidate:d.native.items.filter(i=>i.freshness_status==='REVALIDATE').length,route_confirmed:d.native.items.filter(i=>i.route_status==='CONFIRMED_UNIQUE').length,route_ambiguous:d.native.items.filter(i=>i.route_status==='AMBIGUOUS').length,route_missing:d.native.items.filter(i=>i.route_status==='MISSING').length},
    excluded_native:{total:d.native.excluded.length},
    additional_flows:{...a,total:a.total+d.additional_flows.excluded.length,in_scope:a.total,excluded:d.additional_flows.excluded.length,revalidate:d.additional_flows.in_scope.filter(i=>i.freshness_status==='REVALIDATE').length},
    goal_complete:pc===101&&n.pass===94&&d.native.excluded.length===7&&a.pass===30&&d.additional_flows.excluded.length===1};
}
function validateCanonical(i,errors){
  const c=contractFor(i);if(!c){errors.push(i.item_id+': missing canonical contract');return;}
  for(const key of ['name','scope'])if(i[key]!==c[key])errors.push(i.item_id+': canonical '+key+' drift');
  if(nativeById.has(i.item_id)){if(i.expected_card_kind!==c.expected_card_kind)errors.push(i.item_id+': canonical card kind drift');if(i.route_caveat!==c.route_caveat)errors.push(i.item_id+': canonical route caveat drift');}
  else{if(JSON.stringify(i.expected_card_kinds)!==JSON.stringify(c.expected_card_kinds))errors.push(i.item_id+': canonical card kinds drift');if(i.historical_questionnaire_status!==c.historical_questionnaire_status)errors.push(i.item_id+': canonical historical status drift');}
  if(JSON.stringify(i.seed_or_route)!==JSON.stringify(c.seed_or_route))errors.push(i.item_id+': canonical seed/source route drift');
  if(JSON.stringify(i.control_inventory?.design_expected)!==JSON.stringify(c.design_controls))errors.push(i.item_id+': canonical control inventory drift');
}
function validate(d,ctx){
  const errors=[],add=m=>errors.push(m),all=q.templates.map(t=>t.template_id),ins=q.templates.filter(t=>t.scope==='in_scope').map(t=>t.template_id),refs=q.templates.filter(t=>t.scope==='reference_only').map(t=>t.template_id),flows=q.additional_flows.map(f=>f.id),flowIn=flows.filter(id=>id!=='protected-action');
  if(d.schema_version!==2)add('schema_version must be 2');if(!['M2_INITIAL','ACTIVE','COMPLETE_REVIEWED'].includes(d.lifecycle))add('invalid lifecycle');if(!nonempty(d.ledger_author_id))add('ledger_author_id required');
  if(d.starting_receipt?.questionnaire_observed_runtime_template_ids_non_null!==0)add('starting questionnaire runtime ID receipt must be 0');if(d.starting_receipt?.historical_passes_promoted!==false)add('historical passes must not be promoted');
  if(!exact(index.boards.map(b=>b.board_id),all))add('design registry IDs do not match questionnaire 101');if(!exact(d.paper.items.map(i=>i.item_id),all))add('paper item set must exactly match canonical 101');
  if(!exact(d.native.items.map(i=>i.item_id),ins))add('native item set must exactly match canonical 94');if(!exact(d.native.excluded.map(i=>i.item_id),refs))add('native excluded set must exactly match canonical 7');
  if(!exact(d.additional_flows.in_scope.map(i=>i.item_id),flowIn))add('additional in-scope set must exactly match canonical 30');if(!exact(d.additional_flows.excluded.map(i=>i.item_id),['protected-action']))add('protected-action must be the only excluded additional flow');
  if(!exact([...d.additional_flows.in_scope,...d.additional_flows.excluded].map(i=>i.item_id),flows))add('additional flow set must exactly match canonical 31');
  const paperPassed=validatePaper(d,ctx,errors);
  for(const i of d.paper.items){if(i.expected_design_reference_id!==i.item_id)add('paper '+i.item_id+': design reference mismatch');const s=paperPassed.has(i.item_id)?'PASS':'NOT_RUN';if(i.final_status!==s)add('paper '+i.item_id+': final_status '+i.final_status+' must be computed as '+s);}
  const g={assertionIds:new Set(),signatures:new Set(),runtimeIds:new Set()};
  for(const i of [...d.native.items,...d.additional_flows.in_scope]){
    if(!['PASS','FAIL','NOT_RUN','BLOCKED_EXTERNAL'].includes(i.final_status))add(i.item_id+': invalid final_status');if(!['UNCONFIRMED','AMBIGUOUS','MISSING','CONFIRMED_UNIQUE'].includes(i.route_status))add(i.item_id+': invalid route_status');
    if(!['NOT_RUN','PASS','FAIL','BLOCKED_EXTERNAL'].includes(i.recorded_outcome))add(i.item_id+': invalid recorded_outcome');if(!['CURRENT','REVALIDATE'].includes(i.freshness_status))add(i.item_id+': invalid freshness_status');
    if(!['NOT_RUN','PASS','FAIL'].includes(i.call_status))add(i.item_id+': invalid call_status');if(!['NOT_RUN','APPROVED','REJECTED'].includes(i.independent_review?.status))add(i.item_id+': invalid review status');
    if(i.expected_design_reference_id!==i.item_id)add(i.item_id+': design reference mismatch');validateCanonical(i,errors);if(i.observed_runtime_template_id===i.expected_design_reference_id){const bound=resolveRef(i.runtime_identity?.evidence_ref,ctx,errors,i.item_id+' copied design ID',{required:true,kind:'runtime-metadata',itemId:i.item_id,sessionId:i.session_id,cohort:i.source_cohort});if(i.runtime_identity?.method!=='runtime_metadata'||!bound)add(i.item_id+': copied design ID lacks bound runtime metadata');}if(i.privacy_class!=='PUBLIC_METADATA_ONLY')add(i.item_id+': invalid privacy_class');
    if(!Array.isArray(i.resize_cycle)||i.resize_cycle.length!==3||i.resize_cycle.map(s=>s.stage).join(',')!=='max,narrow,remax')add(i.item_id+': exact resize stages required');else for(const s of i.resize_cycle){if(!sameSize(s.expected_window_outer_size,targets[s.stage]))add(i.item_id+': invalid expected outer size');if(!exactKeys(s.checks,stageKeys))add(i.item_id+': exact stage check keys required');}
    if(!exactKeys(i.regions,regionKeys))add(i.item_id+': exact region keys required');if(!i.content_state_inventory||!exactKeys(i.content_state_inventory,['status',...contentKeys]))add(i.item_id+': exact content-state keys required');
    validateControls(i,ctx,errors,false);const s=computedStatus(i,ctx,errors,g);if(i.final_status!==s)add(i.item_id+': final_status '+i.final_status+' must be computed as '+s);
  }
  for(const i of [...d.native.excluded,...d.additional_flows.excluded]){if(i.final_status!=='EXCLUDED')add(i.item_id+': excluded item must remain EXCLUDED');if(i.observed_runtime_template_id!==null)add(i.item_id+': excluded runtime ID must remain null');}
  if(d.lifecycle==='M2_INITIAL'){if(d.starting_receipt.paper_confirmed!==0)add('M2_INITIAL paper_confirmed must be 0');if(d.native.items.some(i=>i.observed_runtime_template_id!==null))add('M2_INITIAL native runtime IDs must all be null');if(!exact(d.native.items.filter(i=>i.route_status==='AMBIGUOUS').map(i=>i.item_id),ambiguous))add('M2_INITIAL ambiguous route set must match canonical 21');if(!exact(d.native.items.filter(i=>i.route_status==='MISSING').map(i=>i.item_id),missing))add('M2_INITIAL missing route set mismatch');}
  const a=makeAggregates(d);if(JSON.stringify(d.aggregates)!==JSON.stringify(a))add('aggregates must equal machine-computed values');if(a.additional_flows.total!==31||a.additional_flows.in_scope!==30||a.additional_flows.excluded!==1)add('additional aggregate must be total 31 = in-scope 30 + excluded 1');if(a.goal_complete&&d.lifecycle!=='COMPLETE_REVIEWED')add('goal_complete requires COMPLETE_REVIEWED lifecycle');
  const raw=JSON.stringify(d);if(/[A-Za-z]:[\\/]Users[\\/]/.test(raw))add('personal absolute path is forbidden');if(/(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["'][^"']+/i.test(raw))add('credential-like value is forbidden');
  return {errors,aggregates:a};
}
function print(r){console.log('CANONICAL_COUNTS paper='+r.aggregates.paper.total+' native='+r.aggregates.native.total+' excluded='+r.aggregates.excluded_native.total+' additional_total='+r.aggregates.additional_flows.total+' additional_in_scope='+r.aggregates.additional_flows.in_scope+' additional_excluded='+r.aggregates.additional_flows.excluded);console.log('CURRENT_COUNTS paper_confirmed='+r.aggregates.paper.confirmed+' native_pass='+r.aggregates.native.pass+' additional_pass='+r.aggregates.additional_flows.pass+' route_ambiguous='+r.aggregates.native.route_ambiguous+' route_missing='+r.aggregates.native.route_missing);console.log('GOAL_COMPLETE='+r.aggregates.goal_complete);}
function forgeAll(d){
  const fake={scope:'REPO',kind:'fake',path:'backend/ref/card-ui-handoff-20261003/verification/missing-evidence.json',sha256:'0'.repeat(64)};d.lifecycle='COMPLETE_REVIEWED';
  d.paper.source_cohort='fake';d.paper.session_id='same';d.paper.before_snapshot_ref=fake;d.paper.after_snapshot_ref=fake;d.paper.mapping_receipt_ref=fake;d.paper.independent_review={status:'APPROVED',author_id:'same',reviewer_id:'same',report_ref:fake};for(const p of d.paper.items)p.final_status='PASS';
  for(const i of [...d.native.items,...d.additional_flows.in_scope]){i.source_cohort='fake';i.session_id='same';i.session_receipt_ref=fake;i.runtime_commit_sha='0'.repeat(40);i.runtime_source_hashes=[{repo_path:'backend/ref/fake.js',sha256:'0'.repeat(64)}];i.route_status='CONFIRMED_UNIQUE';i.route_identity_assertions=[{assertion_id:'same',item_id:i.item_id,status:'PASS',signature:{expected_card_kind:'same',selected_control:null,operation_shape:null,distinctive_text_sha256:null},evidence_ref:fake}];i.call_status='PASS';i.call_evidence_ref=fake;i.card_instance_marker='same';
    for(const s of i.resize_cycle){s.measured_window_outer_size=s.expected_window_outer_size;s.measured_renderer_viewport_size={width:1,height:1};s.device_scale_factor=1;s.card_instance_marker='same';s.raster_evidence_ref=fake;s.checks={};s.checks_evidence_ref=fake;}
    i.regions={};i.control_inventory={status:'CONFIRMED',design_expected:[],observed_controls:[],no_controls:null,inventory_evidence_ref:fake};i.content_state_inventory={status:'CONFIRMED'};i.evidence_refs=[fake];i.bug_ids=[];i.independent_review={status:'APPROVED',author_id:'same',reviewer_id:'same',report_ref:fake};i.recorded_outcome='PASS';i.freshness_status='CURRENT';i.final_status='PASS';}
  d.aggregates=makeAggregates(d);
}
function selfTest(base,ctx){
  const cases=[
    ['reject-unproven-pass',x=>x.native.items[0].final_status='PASS','evidence ref required'],
    ['reject-design-id-copy',x=>{x.native.items[0].final_status='PASS';x.native.items[0].observed_runtime_template_id=x.native.items[0].expected_design_reference_id;},'copied design ID'],
    ['reject-excluded-flow-in-native-queue',x=>x.additional_flows.in_scope.push(x.additional_flows.excluded[0]),'additional in-scope set must exactly match canonical 30'],
    ['reject-nonexistent-evidence',x=>{x.native.items[0].evidence_refs=[{scope:'REPO',path:'backend/ref/card-ui-handoff-20261003/missing.json',sha256:'1'.repeat(64)}];x.native.items[0].final_status='PASS';},'repo evidence file missing'],
    ['reject-zero-source-hash',x=>{x.native.items[0].final_status='PASS';x.native.items[0].runtime_source_hashes=[{repo_path:'app/main.js',sha256:'0'.repeat(64)}];},'runtime source hashes do not match product source closure'],
    ['reject-empty-required-scopes',x=>{x.native.items[0].final_status='PASS';x.native.items[0].regions={};x.native.items[0].content_state_inventory={status:'CONFIRMED'};x.native.items[0].resize_cycle[0].checks={};},'exact region keys required'],
    ['reject-duplicate-route',x=>{for(const i of x.native.items.slice(0,2)){i.final_status='PASS';i.route_status='CONFIRMED_UNIQUE';i.route_identity_assertions=[{assertion_id:'same',item_id:i.item_id,status:'PASS',signature:{expected_card_kind:'same',selected_control:null,operation_shape:null,distinctive_text_sha256:null},evidence_ref:null}];}},'duplicate route assertion/signature'],
    ['reject-missing-raster',x=>{x.native.items[0].final_status='PASS';x.native.items[0].resize_cycle[0].raster_evidence_ref=null;},'raster'],
    ['reject-arbitrary-freshness',x=>x.native.items[0].freshness_status='STALE_BUT_ACCEPTED','invalid freshness_status'],
    ['reject-self-review',x=>{x.native.items[0].final_status='PASS';x.native.items[0].independent_review={status:'APPROVED',author_id:'same',reviewer_id:'same',report_ref:null};},'independent reviewer identity invalid'],
    ['reject-canonical-route-drift',x=>{const i=x.native.items[0];i.expected_card_kind='fake';i.seed_or_route={seed_id:'fake',prompt:'fake',steps:[],route_source:'fake',prerequisites:[]};i.control_inventory.design_expected=[];},'canonical card kind drift'],
    ['reject-forged-completion',forgeAll,null]
  ];
  let ok=0;for(const [name,mutate,needle] of cases){const x=clone(base);mutate(x);const r=validate(x,ctx);const rejected=r.errors.length>0&&(name==='reject-forged-completion'?r.aggregates.goal_complete===true:r.errors.some(v=>v.includes(needle)));if(rejected){ok++;console.log('NEGATIVE_CHECK '+name+'=PASS');}else console.error('NEGATIVE_CHECK '+name+'=FAIL');}
  const pngHeader=(w,h)=>{const b=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(b,0);b.writeUInt32BE(13,8);b.write('IHDR',12,'ascii');b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return b;};
  const tmp=fs.mkdtempSync(path.join(process.env.TEMP||process.env.TMP||repo,'goal-ledger-')),one=path.join(tmp,'one.png');fs.writeFileSync(one,pngHeader(1,1));
  const focused=[['reject-generic-subcheck-reuse',!hasClaim({entry:{metadata:{asserted_checks:['bottom']}}},'asserted_checks','error')],['reject-non-image-raster',pngSize(currentFile)===null],['reject-1x1-raster',!rasterScaleMatches(pngSize(one),targets.max,1)]];for(const [name,pass] of focused){if(pass){ok++;console.log('NEGATIVE_CHECK '+name+'=PASS');}else console.error('NEGATIVE_CHECK '+name+'=FAIL');}fs.unlinkSync(one);fs.rmdirSync(tmp);
  let audit=false;try{const parent=execFileSync('git',['rev-parse','HEAD^'],{cwd:repo,encoding:'utf8'}).trim(),files=execFileSync('git',['ls-tree','-r','--name-only',parent,'--','app','backend'],{cwd:repo,encoding:'utf8'}).split(/\r?\n/).filter(p=>p&&!p.startsWith('backend/ref/')&&fs.existsSync(path.join(repo,p)));let source=null;for(const p of files){const blob=execFileSync('git',['show',parent+':'+p],{cwd:repo});if(crypto.createHash('sha256').update(blob).digest('hex')===hashFile(path.join(repo,p))){source={repo_path:p,sha256:hashFile(path.join(repo,p))};break;}}if(source){const errs=[],auditCtx={manifest:{cohort_id:'audit-descendant',source_commit_sha:parent,product_source_closure:[source]}},item={item_id:'audit-descendant',source_cohort:'audit-descendant',runtime_commit_sha:parent,runtime_source_hashes:[source]};audit=validateSource(item,auditCtx,errs,true)&&errs.length===0;}}catch{}if(audit){ok++;console.log('POSITIVE_CHECK allow-audit-descendant-commit=PASS');}else console.error('POSITIVE_CHECK allow-audit-descendant-commit=FAIL');
  const total=cases.length+focused.length+1;console.log('NEGATIVE_FALSE_PASS_CHECKS='+ok+'/'+total);return ok===total;
}
const args=process.argv.slice(2),ri=args.indexOf('--evidence-root'),evidenceRoot=ri>=0?args[ri+1]:null;
if(ri>=0&&!evidenceRoot){console.error('--evidence-root requires a directory');process.exit(1);}
if(args.includes('--init')){if(fs.existsSync(currentFile)&&!args.includes('--force')){console.error('current.json exists; use --force only for intentional regeneration');process.exit(1);}const d=makeInitial(),pre=[],ctx=loadEvidenceRoot(evidenceRoot,pre),r=validate(d,ctx);r.errors.unshift(...pre);if(r.errors.length){console.error(r.errors.join('\n'));process.exit(1);}fs.writeFileSync(currentFile,JSON.stringify(d,null,2)+'\n');print(r);console.log('INITIAL_LEDGER_WRITTEN=current.json');process.exit(0);}
const fi=args.indexOf('--file'),file=fi>=0?path.resolve(process.cwd(),args[fi+1]):currentFile,d=readJson(file),pre=[],ctx=loadEvidenceRoot(evidenceRoot,pre),r=validate(d,ctx);r.errors.unshift(...pre);
if(r.errors.length){console.error(r.errors.map(x=>'ERROR: '+x).join('\n'));process.exit(1);}print(r);console.log('VALIDATION=PASS');if(args.includes('--self-test')&&!selfTest(d,ctx))process.exit(1);
