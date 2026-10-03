const allocation={allocationId:'12345678-1234-1234-1234-123456789abc',executionDirectory:'/owned/managed/files',allocationHash:'a'.repeat(64),treeHash:'b'.repeat(64),entryCount:1,bytes:5};
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ResourceQuiescence} from '../src/quiescence.js';
test('actual managed-files gate retains unknown fence, exact proof and 101-family bounds',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'retention-resources-'));let gate=new ResourceQuiescence(directory);
 const c={fenceId:'hold',commandId:'reviewed-hide',purpose:'managed-files-disposal',instanceId:'instance',dataScope:'owned'},sessions=Array.from({length:101},(_,i)=>'ahp-session:/'+i);
 try{const p=(gate.managedReferences=()=>({coverage:'complete',protected:[],omissions:[]}),gate.participant('actual-resources')),lease=await p.acquire(c);assert.equal(p.managedFiles.version,1);assert.equal(lease.ownerId,'actual-resources');assert.deepEqual(await lease.inspectManagedFilesReferences({allocation,sessions}),{coverage:'complete',protected:[],omissions:[]});
 await assert.rejects(gate.effect(async()=>{throw Error('Effect must not run')}),/closed/);
 await assert.rejects(lease.inspectManagedFilesReferences({allocation:{...allocation,treeHash:'c'.repeat(64)},sessions:['ahp-session:/one']}));await lease.release('unknown');await assert.rejects(lease.inspectManagedFilesReferences({allocation,sessions}));await assert.rejects(lease.release('unchanged',{kind:'admission-refused'}));
 gate.close();gate=new ResourceQuiescence(directory);await assert.rejects((gate.managedReferences=()=>({coverage:'complete',protected:[],omissions:[]}),gate.participant('actual-resources')).acquire(c));
 const proof={verified:true,...c,outcome:'unchanged',receiptId:'exact-host-child'};
 await (gate.managedReferences=()=>({coverage:'complete',protected:[],omissions:[]}),gate.participant('actual-resources')).reconcileRelease({...c,outcome:'unchanged',proof});
 await (gate.managedReferences=()=>({coverage:'complete',protected:[],omissions:[]}),gate.participant('actual-resources')).reconcileRelease({...c,outcome:'unchanged',proof});
 assert.equal(gate.inspect().intakeClosed,false);
 }finally{gate.close();await rm(directory,{recursive:true,force:true})}
});

import {createResourcesCapability} from '../src/index.js';import {createHash} from 'node:crypto';
test('resource factory protects pending attachments and unresolved CanvasApp requests without reading bodies',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'resource-retention-data-')),session='ahp-session:/selected',cap=createResourcesCapability({directory,inspectSession:async session=>({session,workingDirectory:directory})});
 const act=(topic,operation,args)=>cap.action({version:1,topic,channel:session,operation,args,commandId:crypto.randomUUID()},{clientId:'client'});
 try{await act('attachments','attachments.create',{requestId:'upload',name:'private.txt',contentType:'text/plain',size:3,sha256:createHash('sha256').update('abc').digest('hex')});
 const manifest={version:1,stateSchema:{type:'object',properties:{},additionalProperties:false},requests:{preview:{action:'theme.preview',schema:{type:'object',properties:{name:{type:'string'},css:{type:'string'}},required:['name','css']}}}};
 const made=(await act('canvas','canvas.apps.create',{title:'Pending',content:'<div>',manifest,initialState:{}})).result;
 await act('canvas','canvas.apps.request',{id:made.artifact.id,expectedRevision:1,expectedStateRevision:0,name:'preview',input:{name:'theme',css:':root{}'}});
 cap.store.body=()=>{throw Error('Retention must not hydrate bodies')};const context={fenceId:'f',commandId:'c',purpose:'managed-files-disposal',instanceId:'i',dataScope:'d'},lease=await cap.quiescenceParticipant('capability:attachments').acquire(context);
 assert.deepEqual(await lease.inspectManagedFilesReferences({allocation,sessions:[session,'ahp-session:/unrelated']}),{coverage:'complete',protected:[{session,reasons:['attachment-upload','canvas-request']}],omissions:[]});
 await lease.release('unchanged',{verified:true,...context,outcome:'unchanged',receiptId:'r'});
 }finally{cap.close();await rm(directory,{recursive:true,force:true})}
});

test('historical cross-conversation file source remains protected after current version detaches',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'managed-resource-ref-')),cap=createResourcesCapability({directory,inspectSession:async session=>({session,workingDirectory:directory})});
 const selected='ahp-session:/selected',other='ahp-session:/other',context={session:other,workingDirectory:'/owned/managed/files'};
 try{
  const artifact=cap.store.save(context,{kind:'code',title:'Source',path:'/owned/managed/files/code.py',workspacePath:'/owned/managed/files'},{content:'copied'});
  cap.store.save(context,{kind:'code',title:'Detached'},{content:'second'},{id:artifact.id,expectedRevision:1,force:true});
  const query="SELECT 1 FROM versions WHERE json_extract(definition,'$.path')=? OR (json_extract(definition,'$.path')>=? AND json_extract(definition,'$.path')<?) LIMIT 1";
  assert.match(JSON.stringify(cap.store.db.prepare('EXPLAIN QUERY PLAN '+query).all('/owned/managed/files','/owned/managed/files/','/owned/managed/files0')),/managed_version_path/);
  cap.store.body=()=>{throw Error('No body hydration permitted')};
  const c={fenceId:'f',commandId:'reviewed',purpose:'managed-files-disposal',instanceId:'i',dataScope:'d'},lease=await cap.quiescenceParticipant('capability:attachments').acquire(c);
  assert.deepEqual(await lease.inspectManagedFilesReferences({allocation,sessions:[selected]}),{coverage:'complete',protected:[{session:selected,reasons:['artifact-file-source']}],omissions:[]});
  await lease.release('unchanged',{verified:true,...c,outcome:'unchanged',receiptId:'refused'});
  assert.equal(cap.store.db.prepare('SELECT count(*) n FROM versions').get().n,2);
 }finally{cap.close();await rm(directory,{recursive:true,force:true})}
});
