'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../../../..');
const runs=path.join(root,'.omc/artifacts/card-ui-handoff-resume/rest-state/runs');
const baseline=JSON.parse(fs.readFileSync(path.join(runs,'baseline/report.json')));
const candidate=JSON.parse(fs.readFileSync(path.join(runs,'candidate/report.json')));
assert.equal(baseline.states.length,44,'baseline state count');
assert.equal(candidate.states.length,44,'candidate state count');
const key=state=>state.caseId+'/'+state.stage;
const baselineByKey=new Map(baseline.states.map(state=>[key(state),state]));
const mismatches=[];
for(const state of candidate.states){
 const before=baselineByKey.get(key(state));
 if(!before||JSON.stringify(before.workflowGeometry)!==JSON.stringify(state.workflowGeometry))mismatches.push(key(state));
 assert.deepEqual(state.workflowGeometry.map(probe=>probe.id),['event','action','status']);
 assert.ok(state.workflowGeometry.every(probe=>probe.restState===null),'workflow probe gained REST marker');
}
assert.deepEqual(mismatches,[],'workflow card geometry changed');
assert.ok(candidate.states.every(state=>state.issues.length===0),'candidate state issue');
const result={status:'WORKFLOW_GEOMETRY_UNCHANGED',statesCompared:candidate.states.length,workflowKinds:['event','action','status'],geometryMismatches:mismatches,restMarkerLeaks:0};
fs.writeFileSync(path.join(runs,'workflow-regression.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
