import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {validateMedia,MAX_MEDIA_BYTES} from '../src/media-validation.js';
import {createResourcesCapability} from '../src/index.js';
const hash=data=>createHash('sha256').update(data).digest('hex');
export function gif(w=1,h=1,frames=2){const header=Buffer.from('47494638396101000100800000ff00000000ff21ff0b4e45545343415045322e300301010000','hex');header.writeUInt16LE(w,6);header.writeUInt16LE(h,8);return Buffer.concat([header,...Array.from({length:frames},(_,i)=>Buffer.from(`21f90404${i%2?'1300':'0700'}00002c0000000001000100000202440100`,'hex')),Buffer.from([0x3b])]);}
function atom(kind,body){const out=Buffer.alloc(8+body.length);out.writeUInt32BE(out.length);out.write(kind,4);body.copy(out,8);return out;}
function mp4(){const tkhd=Buffer.alloc(84),sample=Buffer.alloc(78),handler=Buffer.alloc(24),description=Buffer.alloc(8);tkhd.writeUInt32BE(320<<16,76);tkhd.writeUInt32BE(240<<16,80);sample.writeUInt16BE(320,24);sample.writeUInt16BE(240,26);handler.write('vide',8);description.writeUInt32BE(1,4);return Buffer.concat([atom('ftyp',Buffer.from('69736f6d0000000069736f6d6d703432','hex')),atom('moov',atom('trak',Buffer.concat([atom('tkhd',tkhd),atom('mdia',Buffer.concat([atom('hdlr',handler),atom('minf',atom('stbl',atom('stsd',Buffer.concat([description,atom('avc1',sample)]))))]))]))),atom('mdat',Buffer.from([0]))]);}
test('GIF timing and loop and MP4 dimensions match Main without claiming decoding',()=>{
 assert.deepEqual(validateMedia(gif()),{mimeType:'image/gif',width:1,height:1,frameCount:2,durationMs:260,loopCount:1,decodedPixelBytesEstimate:8});
 assert.deepEqual(validateMedia(mp4()),{mimeType:'video/mp4',width:320,height:240,codedWidth:320,codedHeight:240});
 assert.equal(validateMedia(gif(1280,720,26)).decodedPixelBytesEstimate,95846400);
});
for(const [name,bytes] of Object.entries({empty:Buffer.alloc(0),header:Buffer.from('GIF89a'),trailer:gif().subarray(0,-1),suffix:Buffer.concat([gif(),Buffer.from('extra')]),zero:gif(0),side:gif(4097),pixels:gif(2048,2048),frames:gif(1,1,501),decoded:gif(1280,720,37),mp4short:mp4().subarray(0,-1),noVideo:Buffer.from(mp4().toString('latin1').replace('vide','soun'),'latin1'),codec:Buffer.from(mp4().toString('latin1').replace('avc1','xxxx'),'latin1')}))test('rejects invalid media: '+name,()=>assert.throws(()=>validateMedia(bytes)));
test('media capture is saved assistant scoped, immutable, retryable and authenticated UI reports are ephemeral',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'saved-media-'))),workspace=join(root,'work');await mkdir(workspace);const session='ahp-session:/one';let currentProof='saved',bound=true,rootAllowed=true,cap;
 const options={directory:join(root,'resources'),inspectSession:async s=>({session:s,executionDirectory:workspace,executionRevision:1}),withSessionWorkspace:async(s,e,fn)=>fn({executionDirectory:workspace}),verifyOutputMessage:async(s,id)=>id==='assistant',verifyMediaMessage:async(s,id)=>{if(id!=='assistant')throw Error('Saved assistant required');return {messageId:id,sourceDigest:currentProof};},verifyMediaAuthority:async()=>{if(!rootAllowed)throw Error('Root unavailable');},mediaClientBound:(s,c)=>bound&&s===session&&c==='browser'};
 cap=createResourcesCapability(options);const action=(op,args,caller={origin:'ui',clientId:'browser'},commandId=randomUUID())=>cap.action({version:1,topic:'outputs',channel:session,operation:op,args:{sessionId:session,...args},commandId},caller);
 const data=gif(),args={messageId:'assistant',title:'Animation',path:'demo.gif',expectedSha256:hash(data)};await writeFile(join(workspace,'demo.gif'),data);
 try{
  await assert.rejects(action('outputs.attachMedia',{...args,messageId:'user'}),/Saved assistant/);
  const command=randomUUID(),saved=(await action('outputs.attachMedia',args,undefined,command)).result;
  assert.equal(saved.kind,'media');assert.equal(saved.bytes,data.length);assert.equal(saved.media.durationMs,260);
  assert.equal((await action('outputs.attachMedia',args,undefined,command)).result.id,saved.id);
  const tuple={id:saved.id,messageId:'assistant',version:saved.version,sha256:saved.sha256},provider=cap.resourceProviders.find(p=>p.scheme==='amplifier-output');
  await writeFile(join(workspace,'demo.gif'),'changed');
  const read=()=>provider.read({uri:saved.resourceUri,encoding:'base64'},{clientId:'browser'});
  assert.deepEqual(Buffer.from((await read()).data,'base64'),data);
  assert.equal((await action('outputs.media',{messageId:'assistant'})).result.items[0].id,saved.id);
  const report={...tuple,generation:1,sequence:1,renderState:'ready',playback:'playing',presentedFrames:2,mediaTime:0.07};
  await assert.rejects(action('outputs.mediaReport',report,{origin:'agent',clientId:'browser'}),/authenticated browser/);
  assert.equal((await action('outputs.mediaReport',report)).result.modelAttestation,false);
  await assert.rejects(action('outputs.mediaReport',report),/stale/);
  assert.equal((await action('outputs.read',{id:saved.id})).result.browserObservation.presentedFrames,2);
  assert.equal((await action('outputs.read',{id:saved.id},{origin:'agent'})).result.browserObservation.status,'unbound');
  bound=false;await assert.rejects(read(),/connected browser/);bound=true;
  const wrong=new URL(saved.resourceUri);wrong.searchParams.set('version','2');await assert.rejects(provider.read({uri:wrong.href,encoding:'base64'},{clientId:'browser'}),/exact linked/);
  rootAllowed=false;await assert.rejects(read(),/Root unavailable/);rootAllowed=true;
  cap.close();cap=createResourcesCapability(options);
  assert.equal((await action('outputs.read',{id:saved.id})).result.browserObservation.status,'not_observed');
  const refs=cap.outputForkReferences(session),proof={version:1,complete:true,execution:false,items:refs.map(r=>({key:r.key,disposition:'retained',sourceMessageId:'native:original',targetMessageId:'native:copied'}))};
  const fork=await cap.forkOutputs({source:session,target:'ahp-session:/copy',commandId:'fork',historyRevision:'exact',proof,workingDirectory:workspace});
  assert.deepEqual(cap.outputs.content(cap.outputs.record('ahp-session:/copy',fork.items[0].id)),data);
  await action('outputs.unlink',{id:saved.id,expectedRevision:1});await assert.rejects(cap.resourceProviders.find(p=>p.scheme==='amplifier-output').read({uri:saved.resourceUri,encoding:'base64'},{clientId:'browser'}),/exact linked/);
 }finally{cap.close();await rm(root,{recursive:true,force:true});}
});
test('media workers reject changed hashes, symlink sources and oversized files without changing ordinary output limits',async()=>{
 const {captureMedia}=await import('../src/media-capture.js');const root=await realpath(await mkdtemp(join(tmpdir(),'media-read-')));try{const data=gif();await writeFile(join(root,'good.gif'),data);await symlink(join(root,'good.gif'),join(root,'link.gif'));
 await assert.rejects(captureMedia(root,'link.gif',hash(data)));await assert.rejects(captureMedia(root,'good.gif','0'.repeat(64)),/changed/);await assert.rejects(captureMedia(root,'../good.gif',hash(data)),/canonical/);
 await writeFile(join(root,'large.gif'),Buffer.alloc(MAX_MEDIA_BYTES+1));await assert.rejects(captureMedia(root,'large.gif',hash(data)),/32 MiB/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('identity changes during asynchronous capture leave no published media',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'media-race-')));let reads=0;
 const cap=createResourcesCapability({directory:join(root,'resources'),inspectSession:async session=>({session,executionDirectory:root,executionRevision:1}),withSessionWorkspace:async(s,e,fn)=>fn({executionDirectory:root}),verifyMediaAuthority:async()=>{},verifyMediaMessage:async()=>({messageId:'assistant',sourceDigest:String(++reads)})});
 try{
  const data=gif();await writeFile(join(root,'source.gif'),data);
  await assert.rejects(cap.action({version:1,topic:'outputs',channel:'ahp-session:/race',operation:'outputs.attachMedia',commandId:randomUUID(),args:{sessionId:'ahp-session:/race',messageId:'assistant',title:'Race',path:'source.gif',expectedSha256:hash(data)}},{origin:'ui'}),/identity changed/);
  assert.equal(cap.outputs.list('ahp-session:/race').items.length,0);
  assert.equal(reads,2);
 }finally{cap.close();await rm(root,{recursive:true,force:true});}
});

test('ownership changes between preflight and captured bytes publish nothing',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'media-owner-race-')));let checks=0;
 const cap=createResourcesCapability({directory:join(root,'resources'),inspectSession:async session=>({session,executionDirectory:root,executionRevision:1}),withSessionWorkspace:async(s,e,fn)=>fn({executionDirectory:root}),verifyMediaAuthority:async()=>({locationRevision:Math.floor(checks++/2)}),verifyMediaMessage:async()=>({messageId:'assistant',sourceDigest:'stable'})});
 try{
  const data=gif();await writeFile(join(root,'source.gif'),data);
  await assert.rejects(cap.action({version:1,topic:'outputs',channel:'ahp-session:/race',operation:'outputs.attachMedia',commandId:randomUUID(),args:{sessionId:'ahp-session:/race',messageId:'assistant',title:'Race',path:'source.gif',expectedSha256:hash(data)}},{origin:'ui'}),/identity changed/);
  assert.equal(cap.outputs.list('ahp-session:/race').items.length,0);
 }finally{cap.close();await rm(root,{recursive:true,force:true});}
});
test('browser must still be bound after native proof resolves',async()=>{
 const {OutputMedia}=await import('../src/output-media.js');let bound=true;
 const media=new OutputMedia({}, {verifyMediaAuthority:async()=>({revision:1}),mediaClientBound:()=>bound,verifyMediaMessage:async()=>{bound=false;return {messageId:'assistant'};}});
 await assert.rejects(media.check('ahp-session:/one','assistant',undefined,{clientId:'browser'},true),/connected browser/);
});
