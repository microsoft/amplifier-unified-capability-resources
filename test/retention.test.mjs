import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ResourceQuiescence} from '../src/quiescence.js';
test('actual owner retention gate retains unknown fence, exact proof and 101-family bounds',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'retention-resources-'));let gate=new ResourceQuiescence(directory);
 const c={fenceId:'hold',commandId:'reviewed-hide',purpose:'retention-hide',instanceId:'instance',dataScope:'owned'},sessions=Array.from({length:101},(_,i)=>'ahp-session:/'+i);
 try{const p=gate.participant('actual-resources'),lease=await p.acquire(c);assert.equal(p.retentionHide.version,1);assert.equal(lease.ownerId,'actual-resources');assert.deepEqual(await lease.inspectRetentionReferences({sessions}),{coverage:'complete',protected:[],omissions:[]});
 await assert.rejects(gate.effect(async()=>{throw Error('Effect must not run')}),/closed/);
 await lease.release('unknown');await assert.rejects(lease.inspectRetentionReferences({sessions}));await assert.rejects(lease.release('unchanged',{kind:'admission-refused'}));
 gate.close();gate=new ResourceQuiescence(directory);await assert.rejects(gate.participant('actual-resources').acquire(c));
 const proof={verified:true,...c,outcome:'unchanged',receiptId:'exact-host-child'};
 await gate.participant('actual-resources').reconcileRelease({...c,outcome:'unchanged',proof});
 await gate.participant('actual-resources').reconcileRelease({...c,outcome:'unchanged',proof});
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
 cap.store.body=()=>{throw Error('Retention must not hydrate bodies')};const context={fenceId:'f',commandId:'c',purpose:'retention-hide',instanceId:'i',dataScope:'d'},lease=await cap.quiescenceParticipant('capability:attachments').acquire(context);
 assert.deepEqual(await lease.inspectRetentionReferences({sessions:[session,'ahp-session:/unrelated']}),{coverage:'complete',protected:[{session,reasons:['attachment-upload','canvas-request']}],omissions:[]});
 await lease.release('unchanged',{verified:true,...context,outcome:'unchanged',receiptId:'r'});
 }finally{cap.close();await rm(directory,{recursive:true,force:true})}
});
