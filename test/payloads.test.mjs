import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {createResourcesCapability} from '../src/index.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),session='ahp-session:/destination';
test('detached historical payloads require configured authentication, exact plan and signed release binding; reads remain bounded and inactive',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'resource-payloads-')),raw=Buffer.alloc(8*1024*1024+3,13),path=join(directory,'original'),sha256=hash(raw);await writeFile(path,raw);
 let binding;const inspectSession=async session=>({session,workingDirectory:directory}),source=createResourcesCapability({directory:join(directory,'source'),inspectSession}),destination=createResourcesCapability({directory:join(directory,'destination'),inspectSession,verifyTransferPayloadPlan:async requested=>{assert.equal(requested.capsule,'fixture-authenticated-capsule');return binding;}});
 try{const evidence=await source.exportTransferEvidence({session:'ahp-session:/source',transferId:'transfer'});await destination.stageTransferEvidence({transferId:'transfer',sourceHost:'source',nativeSessionId:'native',evidence});
  const args={transferId:'transfer',sourceHost:'source',destinationHost:'destination',ownerRevision:evidence.revision,evidenceHash:evidence.sha256,planHash:'a'.repeat(64),capsule:'fixture-authenticated-capsule',bodies:[{id:'large-resource',path}]};binding={owner:'unified.resources',...args,bodies:[{id:'large-resource',size:raw.length,sha256}]};
  const readArgs={session,transferId:'transfer',evidenceHash:evidence.sha256,planHash:args.planHash,resourceId:'large-resource'};
  await assert.rejects(source.stageTransferPayloads(args),/verifier/);binding=true;await assert.rejects(destination.stageTransferPayloads(args),/binding/);binding={owner:'unified.resources',...args,bodies:[{id:'large-resource',size:raw.length,sha256}]};
  await destination.stageTransferPayloads(args);await assert.rejects(destination.readTransferPayloadMetadata(readArgs),/unavailable/);
  const activate={session,transferId:'transfer',evidenceHash:evidence.sha256,releaseHash:'c'.repeat(64)};await assert.rejects(destination.activateTransferEvidence(activate),/bind/);await destination.activateTransferEvidence({...activate,payloadPlanHash:args.planHash});
  assert.equal((await destination.stageTransferPayloads(args)).staged,true);
  const page=await destination.readTransferPayloadMetadata(readArgs);assert.equal(page.items[0].size,raw.length);assert.equal(page.items[0].path,undefined);assert.equal(page.items[0].executionAuthority,false);assert.equal(destination.store.list(session).items.length,0);
  const part=await destination.readTransferPayloadBody({...readArgs,offset:262143,maxBytes:3});assert.deepEqual(Buffer.from(part.data,'base64'),raw.subarray(262143,262146));assert.equal(part.sha256,sha256);
  await assert.rejects(destination.readTransferPayloadBody({...readArgs,planHash:'b'.repeat(64)}),/identity/);await assert.rejects(destination.readTransferPayloadBody({...readArgs,maxBytes:262145}),/bounded/);
  await writeFile(join(destination.store.directory,'historical-payloads',sha256+'.blob'),Buffer.alloc(raw.length,7));await assert.rejects(destination.readTransferPayloadBody(readArgs),/integrity/);assert.equal(hash(await readFile(path)),sha256);
 }finally{source.close();destination.close();await rm(directory,{recursive:true,force:true});}
});

test('in-flight and restarted unknown payload imports block activation and changed plans without replay',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'resource-payload-gate-')),inspectSession=async session=>({session,workingDirectory:directory});let release,entered;const ready=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);let cap=createResourcesCapability({directory,inspectSession,verifyTransferPayloadPlan:async()=>{entered();await wait;throw Error('authentication unavailable');}});
 try{const evidence=await cap.exportTransferEvidence({session,transferId:'pending'});await cap.stageTransferEvidence({transferId:'pending',sourceHost:'source',nativeSessionId:'native',evidence});const args={transferId:'pending',sourceHost:'source',destinationHost:'destination',ownerRevision:evidence.revision,evidenceHash:evidence.sha256,planHash:'f'.repeat(64),bodies:[]};
  const staging=cap.stageTransferPayloads(args);await ready;assert.equal(await cap.quiescenceParticipant().acquire({fenceId:'busy',commandId:'command',purpose:'recovery',instanceId:'instance',dataScope:'owned'}),null);
  await assert.rejects(cap.activateTransferEvidence({session,transferId:'pending',evidenceHash:evidence.sha256,releaseHash:'b'.repeat(64)}),/pending or unknown/);release();await assert.rejects(staging,/authentication unavailable/);cap.close();cap=createResourcesCapability({directory,inspectSession,verifyTransferPayloadPlan:async requested=>({owner:'unified.resources',...requested,bodies:[]})});
  await assert.rejects(cap.activateTransferEvidence({session,transferId:'pending',evidenceHash:evidence.sha256,releaseHash:'b'.repeat(64)}),/pending or unknown/);await assert.rejects(cap.stageTransferPayloads({...args,planHash:'a'.repeat(64)}),/another plan/);assert.equal((await cap.stageTransferPayloads(args)).staged,true);
 }finally{release?.();cap.close();await rm(directory,{recursive:true,force:true});}
});
