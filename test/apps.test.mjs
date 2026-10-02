import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createResourcesCapability} from '../src/index.js';
const session='ahp-session:/one';
const manifest={version:1,stateSchema:{type:'object',properties:{count:{type:'integer'}},required:['count'],additionalProperties:false},events:{set:{schema:{type:'object',properties:{next:{type:'integer'}},required:['next']},updates:{count:'next'}}},requests:{preview:{action:'theme.preview',schema:{type:'object',properties:{name:{type:'string'},css:{type:'string'}},required:['name','css']}}}};
async function fixture(){const root=await mkdtemp(join(tmpdir(),'unified-apps-')),workspace=join(root,'workspace');await mkdir(workspace);const cap=createResourcesCapability({directory:join(root,'resources'),inspectSession:async s=>{assert.equal(s,session);return {session:s,workingDirectory:workspace};}});return {root,workspace,cap,act:(operation,args={},clientId='client-a')=>cap.action({topic:'canvas',version:1,channel:session,operation:'canvas.apps.'+operation,args},{clientId}),async close(){cap.close();await rm(root,{recursive:true,force:true});}};}
async function create(f){return (await f.act('create',{title:'Counter',content:'<input>',manifest,initialState:{count:1}})).result;}
test('CanvasApp shared state uses two revisions, immutable bodies and metadata-only lists',async()=>{
 const f=await fixture();try{const first=await create(f),id=first.artifact.id;const changed=(await f.act('event',{id,expectedRevision:1,expectedStateRevision:0,name:'set',payload:{next:2}})).result;
  assert.equal(changed.app.state.count,2);assert.equal(changed.app.revision,1);assert.equal(changed.app.stateRevision,1);assert.notEqual(changed.artifact.bodyUri,first.artifact.bodyUri);
  assert.equal(JSON.parse((await f.cap.resourceProvider.read({uri:first.artifact.bodyUri})).data).app.state.count,1);
  assert.equal(JSON.parse((await f.cap.resourceProvider.read({uri:changed.artifact.bodyUri})).data).app.state.count,2);
  const originalResource=await f.cap.resourceProvider.resolve({uri:first.artifact.bodyUri}),updatedResource=await f.cap.resourceProvider.resolve({uri:changed.artifact.bodyUri});
  assert.equal(originalResource.etag,first.artifact.etag);assert.equal(updatedResource.etag,changed.artifact.etag);assert.notEqual(originalResource.etag,updatedResource.etag);
  await assert.rejects(f.cap.resourceProvider.resolve({uri:first.artifact.bodyUri.replace('stateRevision=0','stateRevision=99')}),e=>e.code===-32008);
  await assert.rejects(f.act('state',{id,expectedRevision:1,expectedStateRevision:0,patch:{count:3}}),e=>e.code===-32011);
  await assert.rejects(f.act('state',{id,expectedRevision:1,expectedStateRevision:1,patch:{count:'bad'}}),/schema/);
  const old=f.cap.store.body;f.cap.store.body=()=>{throw Error('Unexpected body read')};
  const page=await f.cap.read({uri:'amplifier-capability://canvas',scope:session});assert.equal(page.data.canvasArtifacts[0].app.stateRevision,1);assert.ok(!('state' in page.data.canvasArtifacts[0].app));f.cap.store.body=old;
  const target=await f.cap.read({uri:'amplifier-capability://canvas?id='+id,scope:session});assert.equal(target.data.canvasArtifacts.length,1);
 }finally{await f.close();}
});
test('refinement preserves compatible state; restores never replay effects or overwrite local source',async()=>{
 const f=await fixture();try{const {artifact:{id}}=await create(f);await f.act('state',{id,expectedRevision:1,expectedStateRevision:0,patch:{count:7}});
  const revised=(await f.act('revise',{id,expectedRevision:1,expectedStateRevision:1,content:'<button>new</button>'})).result;assert.equal(revised.app.revision,2);assert.equal(revised.app.state.count,7);
  const restored=(await f.act('restore',{id,expectedRevision:2,expectedStateRevision:2,version:1})).result;assert.equal(restored.app.revision,3);assert.equal(restored.app.stateRevision,3);assert.equal(restored.app.state.count,7);
  assert.equal(JSON.parse((await f.cap.resourceProvider.read({uri:restored.artifact.bodyUri})).data).content,'<input>');
  await assert.rejects(f.cap.resourceProvider.write({uri:restored.artifact.bodyUri,data:'{}',encoding:'utf-8',ifMatch:restored.artifact.etag}),e=>e.code===-32009);
 }finally{await f.close();}
});
test('local effects are durably admitted once, owner-bound and reconciled without replay across restart',async()=>{
 const f=await fixture();let reopened;try{const {artifact:{id}}=await create(f);const requested=(await f.act('request',{id,expectedRevision:1,expectedStateRevision:0,name:'preview',input:{name:'Mine',css:':root {}'}})).result;const requestId=requested.app.requests[0].id;
  const claimed=(await f.act('resolve',{id,requestId,expectedRevision:1,expectedStateRevision:1,approve:true,phase:'claim'})).result;assert.equal(claimed.effect.action,'theme.preview');assert.equal(claimed.app.requests[0].status,'unknown');
  await assert.rejects(f.act('resolve',{id,requestId,expectedRevision:1,expectedStateRevision:2,approve:true,phase:'claim'}),e=>e.code===-32011);
  await assert.rejects(f.act('resolve',{id,requestId,phase:'complete',token:claimed.effect.token,outcome:'applied'},'client-b'),e=>e.code===-32009);
  f.cap.close();reopened=createResourcesCapability({directory:join(f.root,'resources'),inspectSession:async s=>({session:s,workingDirectory:f.workspace})});
  const action=args=>reopened.action({topic:'canvas',version:1,channel:session,operation:'canvas.apps.resolve',args},{clientId:'client-a'});
  const receipt={id,requestId,phase:'complete',token:claimed.effect.token,outcome:'applied'};const completed=(await action(receipt)).result;assert.equal(completed.app.requests[0].status,'applied');assert.equal(completed.app.stateRevision,3);
  assert.equal((await action(receipt)).result.app.stateRevision,3);
  await assert.rejects(action({...receipt,outcome:'failed'}),e=>e.code===-32011);
 }finally{reopened?.close();await f.close();}
});
test('undeclared operations, unsafe schemas, reserved keys and oversized input are refused',async()=>{
 const f=await fixture();try{await assert.rejects(f.act('create',{title:'X',content:'x',manifest:{...manifest,stateSchema:{type:'object',patternProperties:{'.*':{}}}},initialState:{count:1}}),/regular expressions/);
  const {artifact:{id}}=await create(f);await assert.rejects(f.act('event',{id,expectedRevision:1,expectedStateRevision:0,name:'unknown',payload:{}}),/not declared/);
  await assert.rejects(f.act('state',{id,expectedRevision:1,expectedStateRevision:0,patch:JSON.parse('{"__proto__":{}}')}),/reserved key/);
  await assert.rejects(f.act('state',{id,expectedRevision:1,expectedStateRevision:0,patch:{count:'x'.repeat(100001)}}),/size limit/);
 }finally{await f.close();}
});
