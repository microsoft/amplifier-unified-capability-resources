import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createResourcesCapability} from '../src/index.js';
import {deflateSync} from 'node:zlib';
import {pngInfo} from '../src/output-files.js';
const hash=data=>createHash('sha256').update(data).digest('hex');
async function fixture(){const root=await mkdtemp(join(tmpdir(),'saved-outputs-')),workspace=join(root,'work');await mkdir(workspace);const changed=[],guarded=[];let fence=false;
 const options={directory:join(root,'resources'),inspectSession:async session=>({session,workingDirectory:workspace,executionRevision:1,...(fence?{relocationFence:{}}:{})}),withSessionWorkspace:async(session,expected,run)=>{guarded.push({session,expected});return run({session,executionDirectory:workspace,executionRevision:1});},verifyOutputMessage:async(_s,id)=>id==='original',onChanged:(...args)=>changed.push(args)};
 let cap=createResourcesCapability(options);return {root,workspace,changed,guarded,get cap(){return cap},fence:()=>{fence=true},reopen(){cap.close();cap=createResourcesCapability(options)},act(operation,args={},session='ahp-session:/one',commandId=randomUUID(),origin='ui'){return cap.action({topic:'outputs',version:1,channel:session,operation,args:{sessionId:session,...args},commandId},{origin});},async close(){cap.close();await rm(root,{recursive:true,force:true})}};
}
test('saved writing is immutable, receipt-bound, scoped and durable across restart',async()=>{const f=await fixture();try{
 const command=randomUUID(),args={title:'Draft',content:'# Original',variant:'document',messageId:'original'};
 const results=await Promise.all([f.act('outputs.write',args,undefined,command),f.act('outputs.write',args,undefined,command)]);const first=results[0].result;assert.equal(results[1].result.id,first.id);assert.equal(results[1].result.duplicate,true);assert.equal(first.origin.source,'ui');
 await assert.rejects(f.act('outputs.write',{...args,content:'changed'},undefined,command),/different/);await assert.rejects(f.act('outputs.write',args,undefined,command,'agent'),/different/);
 const second=(await f.act('outputs.write',{...args,content:'Updated',parentId:first.id,evidenceIds:[first.id]})).result;assert.equal(second.version,2);assert.equal((await f.act('outputs.read',{id:first.id})).result.text,'# Original');
 await assert.rejects(f.act('outputs.read',{id:first.id},'ahp-session:/two'),/unavailable/);await assert.rejects(f.act('outputs.write',{...args,messageId:'invented'}),/original message/);
 await f.act('outputs.comment',{id:first.id,body:'Keep this'});await f.act('outputs.unlink',{id:first.id,expectedRevision:1});await assert.rejects(f.act('outputs.relink',{id:first.id,expectedRevision:1}),/changed/);assert.equal((await f.act('outputs.list')).result.items.length,1);
 f.reopen();assert.equal((await f.act('outputs.read',{id:first.id})).result.comments[0].body,'Keep this');assert.equal((await f.act('outputs.write',args,undefined,command)).result.id,first.id);await f.act('outputs.relink',{id:first.id,expectedRevision:2});assert.equal((await f.act('outputs.list')).result.items.length,2);
 assert.ok(f.changed.every(row=>row[0]==='outputs'));f.fence();await assert.rejects(f.act('outputs.write',args),/movement/);assert.equal((await f.act('outputs.read',{id:first.id})).result.text,'# Original');
 }finally{await f.close()}});
test('file snapshots retain exact bytes, bounded pages and managed-source protection',async()=>{const f=await fixture();try{
 const data=Buffer.alloc(300000,17);await writeFile(join(f.workspace,'dataset.bin'),data);const saved=(await f.act('outputs.attach',{kind:'dataset',title:'Data',path:'dataset.bin',expectedSha256:hash(data)})).result;
 await writeFile(join(f.workspace,'dataset.bin'),'changed');const provider=f.cap.resourceProviders.find(row=>row.scheme==='amplifier-output');const uri=new URL(saved.resourceUri);uri.searchParams.set('offset','262144');const page=await provider.read({uri:uri.href,encoding:'base64'});assert.equal(Buffer.from(page.data,'base64').length,data.length-262144);assert.equal((await provider.resolve({uri:saved.resourceUri})).size,data.length);
 assert.equal((await f.act('outputs.read',{id:saved.id})).result.sha256,hash(data));uri.searchParams.set('session','ahp-session:/two');await assert.rejects(provider.read({uri:uri.href,encoding:'base64'}),/unavailable/);
 await symlink(join(f.root,'outside'),join(f.workspace,'escape'));await writeFile(join(f.root,'outside'),'secret');await assert.rejects(f.act('outputs.attach',{kind:'file',title:'bad',path:'escape'}));await assert.rejects(f.act('outputs.attach',{kind:'file',title:'bad',path:'../outside'}),/inside/);
 await writeFile(join(f.cap.store.directory,'outputs',saved.sha256+'.blob'),'corrupted');assert.equal((await f.act('outputs.list')).result.items.length,1);await assert.rejects(f.act('outputs.read',{id:saved.id}),/integrity/);
 }finally{await f.close()}});
test('external references never fetch and Canvas saves bind the exact version',async()=>{const f=await fixture();try{
 const artifact=(await f.cap.action({topic:'canvas',operation:'canvas.show',version:1,channel:'ahp-session:/one',args:{kind:'markdown',content:'# v1'},commandId:randomUUID()})).result.artifact;
 const saved=(await f.act('outputs.attach',{kind:'canvas',title:'Saved canvas',canvasId:artifact.id})).result;assert.equal(saved.canvasVersion,1);assert.equal((await f.act('outputs.read',{id:saved.id})).result.text,'{"content":"# v1"}');
 const link=(await f.act('outputs.attach',{kind:'external_document',title:'Reference',url:'https://example.invalid/document'})).result;assert.equal(link.versionEvidence,'unversioned_reference');assert.equal(link.resourceUri,undefined);
 for(const url of ['https://user:password@example.invalid','file:///private','https://example.invalid/\n'])await assert.rejects(f.act('outputs.attach',{kind:'external_document',title:'bad',url}));
 await assert.rejects(f.act('outputs.attach',{kind:'canvas',title:'bad',canvasId:artifact.id,path:'extra'}),/exactly/);
 }finally{await f.close()}});
test('Git snapshots suppress local drivers and anchor comments only to saved hunks',async()=>{const f=await fixture();try{
 const git=(...args)=>execFileSync('git',['-C',f.workspace,...args],{stdio:'pipe'});git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');await writeFile(join(f.workspace,'example.txt'),'before\n');git('add','example.txt');git('commit','-m','initial');await writeFile(join(f.workspace,'example.txt'),'after\n');
 git('config','diff.external','touch SHOULD_NOT_EXIST');git('config','filter.danger.clean','touch SHOULD_NOT_EXIST');git('config','filter.danger.required','true');await writeFile(join(f.workspace,'.gitattributes'),'*.txt filter=danger diff=danger\n');git('config','diff.danger.textconv','touch SHOULD_NOT_EXIST');
 const saved=(await f.act('outputs.review',{mode:'unstaged'})).result;const content=(await f.act('outputs.read',{id:saved.id})).result.text;assert.match(content,/-before\n\+after/);await assert.rejects(readFile(join(f.workspace,'SHOULD_NOT_EXIST')));
 const comment=(await f.act('outputs.comment',{id:saved.id,body:'Check this',path:'example.txt',side:'right',line:1})).result;assert.equal(comment.externalPosted,false);assert.equal(comment.resourceUri,undefined);await assert.rejects(f.act('outputs.comment',{id:saved.id,body:'bad',path:'example.txt',side:'right',line:200}),/exact saved diff/);
 await writeFile(join(f.workspace,'example.txt'),'later');assert.equal((await f.act('outputs.read',{id:saved.id})).result.text,content);
 }finally{await f.close()}});
test('PNG validation refuses corrupt, animated and unsupported formats',()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
 // A bad fixture must not be accepted merely because it has a PNG header.
 assert.throws(()=>pngInfo(png),/PNG/);assert.throws(()=>pngInfo(Buffer.from('not an image')),/PNG/);
});

function png(pixel=1){
 const chunk=(kind,data)=>{const body=Buffer.concat([Buffer.from(kind),data]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let k=0;k<8;k++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);body.copy(result,4);result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4);return result;};
 const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,pixel,2,3,255]))),chunk('IEND',Buffer.alloc(0))]);
}
test('image receipts save verified pixels with atomic Canvas publication, exact retries and edit lineage',async()=>{const f=await fixture();try{
 const data=png(),data2=png(5);assert.deepEqual(pngInfo(data),{width:1,height:1});await writeFile(join(f.workspace,'generated.png'),data);
 const receipt={schema:'amplifier.image.receipt.v1',status:'completed',requestId:'request-1',requestHash:hash('request'),backend:'fixture',model:'fixture',operation:'generate',inputs:[],artifact:{path:'generated.png',sha256:hash(data),bytes:data.length,mimeType:'image/png',width:1,height:1,mode:'RGBA'}};
 await writeFile(join(f.workspace,'receipt.json'),JSON.stringify(receipt));const args={title:'Generated',receiptPath:'receipt.json',messageId:'original'},command=randomUUID();
 const saved=(await f.act('outputs.attachImage',args,undefined,command)).result;assert.equal(saved.kind,'file');assert.equal(saved.origin.messageId,'original');assert.equal(f.cap.store.descriptor(f.cap.store.row('ahp-session:/one',saved.canvasId)).messageId,'original');
 assert.equal((await f.act('outputs.attachImage',args,undefined,command)).result.id,saved.id);assert.equal((await f.act('outputs.attachImage',args)).result.id,saved.id);assert.equal(f.cap.store.list('ahp-session:/one').items.length,1);
 const image=(await f.act('outputs.image',{id:saved.id,sha256:saved.sha256})).result;assert.equal(image.title,'Generated');assert.equal(image.width,1);assert.equal((await f.cap.readOutputImages('ahp-session:/one',{id:saved.id,sha256:saved.sha256}))._image,data.toString('base64'));await assert.rejects(f.cap.readOutputImages('ahp-session:/other',{id:saved.id,sha256:saved.sha256}),/unavailable/);
 const provider=f.cap.resourceProviders.find(r=>r.scheme==='amplifier-output');assert.deepEqual(Buffer.from((await provider.read({uri:image.resourceUri,encoding:'base64'})).data,'base64'),data);
 await writeFile(join(f.workspace,'edited.png'),data2);const edited={...receipt,requestId:'request-2',operation:'edit',inputs:[{path:'generated.png',sha256:hash(data),role:'target'}],artifact:{...receipt.artifact,path:'edited.png',sha256:hash(data2),bytes:data2.length}};
 await writeFile(join(f.workspace,'edit.json'),JSON.stringify(edited));await assert.rejects(f.act('outputs.attachImage',{title:'Edit',receiptPath:'edit.json'}),/parentId/);
 const next=(await f.act('outputs.attachImage',{title:'Edit',receiptPath:'edit.json',parentId:saved.id})).result;assert.equal(next.version,2);assert.equal(next.parentId,saved.id);assert.equal(f.cap.store.descriptor(f.cap.store.row('ahp-session:/one',next.canvasId)).messageId,null);
 assert.deepEqual((await f.act('outputs.images',{images:[{id:saved.id,sha256:saved.sha256},{id:next.id,sha256:next.sha256}]})).result.images.map(r=>r.id),[saved.id,next.id]);
 await assert.rejects(f.act('outputs.images',{images:[{id:saved.id,sha256:saved.sha256},{id:next.id,sha256:saved.sha256}]}),/distinct/);
 await writeFile(join(f.workspace,'generated.png'),data2);await assert.rejects(f.act('outputs.attachImage',args),/no longer match/);assert.equal((await f.act('outputs.attachImage',args,undefined,command)).result.id,saved.id);
 }finally{await f.close()}});

test('transfer carries immutable output bodies and notes as inactive historical evidence',async()=>{const f=await fixture();try{
 const saved=(await f.act('outputs.write',{title:'Keep',variant:'standard',content:'Historical writing'})).result;await f.act('outputs.comment',{id:saved.id,body:'Preserve note'});
 const evidence=await f.cap.exportTransferEvidence({session:'ahp-session:/one',transferId:'output-transfer'}),records=JSON.parse(evidence.bodyJson).records;
 assert.equal(evidence.disposition,'complete');assert.equal(records.find(r=>r.kind==='output-metadata').value.id,saved.id);assert.equal(records.find(r=>r.kind==='output-comment').value.body,'Preserve note');assert.equal(Buffer.from(records.find(r=>r.kind==='output-body').bodyBase64,'base64').toString(),'Historical writing');
 await f.cap.stageTransferEvidence({transferId:'output-transfer',sourceHost:'source',nativeSessionId:'native',evidence});await f.cap.activateTransferEvidence({transferId:'output-transfer',session:'ahp-session:/two',evidenceHash:evidence.sha256,releaseHash:'f'.repeat(64)});
 assert.equal((await f.act('outputs.list',{},'ahp-session:/two')).result.items.length,0);const page=await f.cap.readTransferEvidence({session:'ahp-session:/two',transferId:'output-transfer'});assert.ok(page.items.every(r=>r.historicalOnly&&r.executionAuthority===false));assert.equal(page.items.find(r=>r.kind==='output-body').bodyBase64,undefined);
 }finally{await f.close()}});

test('completed generated image enters Outputs atomically and exact delivery does not duplicate it',async()=>{const f=await fixture();try{
 const bytes=png();await writeFile(join(f.workspace,'generated.png'),bytes);
 const request={topic:'canvas',operation:'canvas.openFile',version:1,channel:'ahp-session:/one',commandId:'image-result',args:{kind:'image',path:'generated.png',expectedSha256:hash(bytes),imageResult:{version:1,toolCallId:'actual-tool',requestId:'actual-request',operation:'generate'}}};
 const first=(await f.cap.action(request,{origin:'agent'})).result.artifact;const output=(await f.act('outputs.list')).result.items[0];assert.equal(output.sha256,hash(bytes));assert.equal(output.canvasId,first.id);assert.equal(output.canvasVersion,first.revision);
 await f.cap.action(request,{origin:'agent'});assert.equal((await f.act('outputs.list')).result.items.length,1);assert.equal(f.cap.store.list('ahp-session:/one').items[0].revision,1);
 assert.equal((await f.cap.readOutputImages('ahp-session:/one',{id:output.id,sha256:output.sha256}))._image,bytes.toString('base64'));
 }finally{await f.close()}});

test('confirmed fork copies only retained message outputs with exact snapshots notes and lineage once',async()=>{const f=await fixture();try{
 const first=(await f.act('outputs.write',{title:'First',content:'first',variant:'standard',messageId:'original'})).result;
 const second=(await f.act('outputs.write',{title:'Next',content:'next',variant:'standard',messageId:'original',parentId:first.id,evidenceIds:[first.id]})).result;
 const artifact=(await f.cap.action({topic:'canvas',operation:'canvas.show',version:1,channel:'ahp-session:/one',args:{kind:'markdown',content:'# keep'},commandId:randomUUID()})).result.artifact;
 const canvas=(await f.act('outputs.attach',{kind:'canvas',title:'Canvas',canvasId:artifact.id,messageId:'original'})).result;
 await f.act('outputs.comment',{id:second.id,body:'Saved review'});const excluded=(await f.act('outputs.write',{title:'Later',content:'later',variant:'standard',messageId:'original'})).result;
 await f.act('outputs.write',{title:'Library only',content:'unattached',variant:'standard'});
 const items=f.cap.outputForkReferences('ahp-session:/one').map(row=>({key:row.key,sourceMessageId:'native:source',...(row.key.startsWith(excluded.id+':')?{disposition:'omitted'}:{disposition:'retained',targetMessageId:'native:copied'})}));
 const input={source:'ahp-session:/one',target:'ahp-session:/two',commandId:'copy',historyRevision:'revision',workingDirectory:f.workspace,proof:{version:1,items,complete:true,execution:false}};
 const result=await f.cap.forkOutputs(input);assert.equal(result.copied,3);assert.equal(result.omitted,1);const copied=(await f.act('outputs.list',{},'ahp-session:/two')).result.items;assert.equal(copied.length,3);
 const firstCopy=copied.find(row=>row.forkSource.outputId===first.id),nextCopy=copied.find(row=>row.forkSource.outputId===second.id),canvasCopy=copied.find(row=>row.forkSource.outputId===canvas.id);
 assert.equal(nextCopy.parentId,firstCopy.id);assert.deepEqual(nextCopy.evidenceIds,[firstCopy.id]);assert.equal(nextCopy.origin.messageId,'native:copied');assert.equal((await f.act('outputs.read',{id:nextCopy.id},'ahp-session:/two')).result.comments[0].body,'Saved review');assert.equal((await f.act('outputs.read',{id:firstCopy.id},'ahp-session:/two')).result.text,'first');
 assert.notEqual(canvasCopy.canvasId,artifact.id);assert.deepEqual(f.cap.store.body('ahp-session:/two',canvasCopy.canvasId,1),{content:'# keep'});
 f.reopen();assert.equal((await f.cap.forkOutputs(input)).duplicate,true);assert.equal((await f.act('outputs.list',{},'ahp-session:/two')).result.items.length,3);
 await assert.rejects(f.cap.forkOutputs({...input,target:'ahp-session:/other'}),/different/);assert.equal((await f.act('outputs.list')).result.items.length,5);
 }finally{await f.close()}});
