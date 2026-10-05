import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,chmod,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createResourcesCapability} from '../src/index.js';
import {ForkAttachments,FORK_ATTACHMENT_LIMITS} from '../src/fork-attachments.js';
import {initializeSchema} from '../src/authoritative-schema.js';
const A='ahp-session:/source',B='ahp-session:/fork',C='ahp-session:/second-fork',hash=b=>createHash('sha256').update(b).digest('hex');
const locate=(sessionId,position=0)=>({sessionId,messageId:'native:'+position,position,historyEpoch:null});
const request=(commandId='fork-a-b',position=0,blockIndex=1,target='native-b')=>({version:2,commandId,target:{row:locate(target,position),blockIndex}});
function proof(r,card,{source=A,target=B,sourceNative='native-a',targetNative='native-b',disposition='retained'}={}){
 return {version:2,commandId:r.commandId,authority:{commandId:r.commandId,status:'completed',source:{sessionId:sourceNative,historyRevision:'original-source-revision'},target:{sessionId:targetNative,creationHistoryRevision:'original-target-revision'},creationConfirmed:true,preservedSource:true,workReplayed:false},sourceOccurrence:{row:locate(sourceNative,r.target.row.position),blockIndex:r.target.blockIndex},targetOccurrence:structuredClone(r.target),card:structuredClone(card),disposition,sourceHostSession:source,targetHostSession:target,engineId:'native'};
}
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'resources-original-v2-'));let verifier=()=>null,cap;
 const open=()=>createResourcesCapability({directory,inspectSession:async session=>({session,workingDirectory:directory}),verifyOriginalAttachment:r=>verifier(r)});
 cap=open();t.after(()=>cap.close());
 const f={directory,get cap(){return cap},set verify(fn){verifier=fn},restart(){cap.close();cap=open()},close(){cap.close()},open,
 async upload(text='immutable source',id='upload'){
  const bytes=Buffer.from(text),args={requestId:id,name:'owner-filename.txt',contentType:'text/plain',size:bytes.length,sha256:hash(bytes)};
  const action=(operation,args)=>cap.action({version:1,topic:'attachments',channel:A,operation,args});
  const a=(await action('attachments.create',args)).result.attachment;
  for(let offset=0;offset<bytes.length;offset+=FORK_ATTACHMENT_LIMITS.chunkBytes)await cap.resourceProviders[1].write({uri:a.uploadUri+'&offset='+offset,encoding:'base64',data:bytes.subarray(offset,offset+FORK_ATTACHMENT_LIMITS.chunkBytes).toString('base64'),mode:'append'});
  const done=(await action('attachments.commit',{id:a.id,requestId:'commit:'+id})).result.attachment;
  return {descriptor:done,card:{type:'attachment',reference:{owner:'resources',id:done.resourceUri},name:'User-visible label (not owner filename)',mimeType:done.contentType,size:done.size,sha256:done.sha256},bytes};
 }};return f;
}
const grants=f=>f.cap.store.db.prepare('SELECT * FROM fork_attachment_grants_v2').all();
const body=f=>f.cap.store.db.prepare('SELECT count(*) AS n FROM attachments WHERE session=?').get(B).n;
const has=f=>!!f.cap.store.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='fork_attachment_grants_v2'").get();

test('read-only missing lookup never enrolls; exact source and target guards remain',async t=>{
 const f=await fixture(t),a=await f.upload(),before=f.cap.store.db.prepare('SELECT total_changes() AS n').get().n;
 assert.equal(await f.cap.resolveOriginalAttachment(B,a.card.reference),null);assert.equal(has(f),false);
 assert.equal(f.cap.store.db.prepare('SELECT total_changes() AS n').get().n,before);
 await assert.rejects(f.cap.resolvePromptAttachment({session:B},{uri:a.card.reference.id}),/conversation/);
 assert.equal(f.cap.manifest.actions['attachments.retainFork'],undefined);
});
test('one original URI shares qualified bytes across every verified occurrence and survives restart',async t=>{
 const f=await fixture(t),a=await f.upload();let checks=0;f.verify=r=>{checks++;return proof(r,a.card)};
 const first=await f.cap.retainForkAttachments(request()),original=structuredClone(a.card);
 assert.equal(first.status,'completed');assert.equal(first.originalReference.id,a.card.reference.id);assert.notEqual(first.accessUri,a.card.reference.id);
 for(let i=1;i<=65;i++)assert.deepEqual(await f.cap.retainForkAttachments(request('fork-a-b',i,i%5)),first);
 assert.equal(checks,66);assert.equal(grants(f).length,1);assert.equal(body(f),1);assert.deepEqual(a.card,original);
 const target=f.cap.store.db.prepare('SELECT name FROM attachments WHERE session=?').get(B);assert.equal(target.name,'owner-filename.txt');
 assert.equal((await f.cap.resolvePromptAttachment({session:B},{uri:first.accessUri}))[0].resource.text,'immutable source');
 const before=f.cap.store.db.prepare('SELECT total_changes() AS n').get().n;
 assert.deepEqual(await f.cap.resolveOriginalAttachment(B,{id:a.card.reference.id,owner:'resources'}),first);
 assert.equal(f.cap.store.db.prepare('SELECT total_changes() AS n').get().n,before);
 f.restart();assert.deepEqual(await f.cap.retainForkAttachments(request()),first);assert.equal(body(f),1);
});
test('more than 64 distinct cards qualify incrementally under the same original fork',async t=>{
 const f=await fixture(t);const cards=[];
 for(let i=0;i<65;i++)cards.push((await f.upload('x'+i,'upload'+i)).card);
 f.verify=r=>proof(r,cards[r.target.row.position]);
 for(let i=0;i<65;i++)assert.equal((await f.cap.retainForkAttachments(request('fork-a-b',i))).status,'completed');
 assert.equal(grants(f).length,65);assert.equal(body(f),65);
});
test('chained A -> B -> C resolves immediate B bytes, keeps A URI and permits later append identity',async t=>{
 const f=await fixture(t),a=await f.upload();f.verify=r=>proof(r,a.card);
 const first=await f.cap.retainForkAttachments(request());
 await chmod(join(f.directory,'attachments',a.descriptor.id+'.blob'),0o600);await writeFile(join(f.directory,'attachments',a.descriptor.id+'.blob'),'A altered after completed B');
 f.verify=r=>proof(r,a.card,{source:B,target:C,sourceNative:'native-b',targetNative:'native-c',disposition:'history-only'});
 const second=await f.cap.retainForkAttachments(request('fork-b-c',12,4,'native-c'));
 assert.equal(second.status,'completed');assert.equal(second.originalReference.id,a.card.reference.id);
 assert.notEqual(second.accessUri,first.accessUri);assert.equal((await f.cap.resolvePromptAttachment({session:C},{uri:second.accessUri}))[0].resource.text,'immutable source');
 // The trusted exact row verifier accepts later append; Resources binds original creation authority, not a new full-history revision.
 assert.deepEqual(await f.cap.retainForkAttachments(request('fork-b-c',12,4,'native-c')),second);
});
test('verifier must authenticate exact original command/row/block and completed copy on every call',async t=>{
 const f=await fixture(t),a=await f.upload(),r=request();
 for(const change of [p=>null,p=>({...p,version:1}),p=>({...p,commandId:'other'}),p=>({...p,targetOccurrence:{...p.targetOccurrence,blockIndex:2}}),p=>({...p,targetOccurrence:{...p.targetOccurrence,row:{...p.targetOccurrence.row,historyEpoch:'changed'}}}),p=>({...p,authority:{...p.authority,status:'unknown'}}),p=>({...p,authority:{...p.authority,creationConfirmed:false}}),p=>({...p,sourceOccurrence:{...p.sourceOccurrence,row:locate('foreign')}}),p=>({...p,targetHostSession:A})]){
  f.verify=req=>change(proof(req,a.card));await assert.rejects(f.cap.retainForkAttachments(r));assert.equal(has(f),false);
 }
 f.verify=req=>proof(req,a.card);const done=await f.cap.retainForkAttachments(r);
 f.verify=req=>({...proof(req,a.card),card:{...a.card,sha256:'0'.repeat(64)}});await assert.rejects(f.cap.retainForkAttachments(request('fork-a-b',8)),/metadata/);
 f.verify=()=>null;await assert.rejects(f.cap.retainForkAttachments(r),/verified/);assert.deepEqual(await f.cap.resolveOriginalAttachment(B,a.card.reference),done);
});
test('invalid request, unsupported owner and card metadata refuse without bytes or namespace',async t=>{
 const f=await fixture(t),a=await f.upload();let calls=0;f.verify=r=>{calls++;return proof(r,a.card)};
 for(const r of [{...request(),version:1},{...request(),verified:true},request('x'.repeat(513)),{...request(),target:{row:locate('native-b'),blockIndex:-1}}])await assert.rejects(f.cap.retainForkAttachments(r));
 assert.equal(calls,0);
 for(const card of [{...a.card,reference:{...a.card.reference,owner:'native-attachments'}},{...a.card,size:MAX_SAFE},{...a.card,mimeType:'image/png'}]){f.verify=r=>proof(r,card);await assert.rejects(f.cap.retainForkAttachments(request()))}
 assert.equal(has(f),false);assert.equal(body(f),0);
});
const MAX_SAFE=Number.MAX_SAFE_INTEGER;
test('a different fork/engine/scope binding cannot replace an existing target grant',async t=>{
 const f=await fixture(t),a=await f.upload();f.verify=r=>proof(r,a.card);const done=await f.cap.retainForkAttachments(request());
 await assert.rejects(f.cap.retainForkAttachments(request('different-command')),/cannot change/);
 f.verify=r=>({...proof(r,a.card),engineId:'different'});await assert.rejects(f.cap.retainForkAttachments(request()),/cannot change/);
 assert.deepEqual(await f.cap.resolveOriginalAttachment(B,a.card.reference),done);assert.equal(body(f),1);
});
test('unknown partial copy stays unresolved on ordinary reads; exact restart resumes verified prefix only',async t=>{
 for(const damaged of [false,true]){
  const f=await fixture(t),a=await f.upload('bounded bytes '.repeat(30000));f.verify=r=>proof(r,a.card);
  const original=ForkAttachments.prototype.copy;let staged;
  try{ForkAttachments.prototype.copy=async function(source,p){staged=join(this.attachments.directory,p.targetId+'.blob.fork-staged');await writeFile(staged,a.bytes.subarray(0,262144));throw Error('inert interruption')};
   assert.equal((await f.cap.retainForkAttachments(request())).status,'unknown');
  }finally{ForkAttachments.prototype.copy=original}
  assert.equal(body(f),0);const saved=grants(f)[0],before=f.cap.store.db.prepare('SELECT total_changes() AS n').get().n;
  assert.equal((await f.cap.resolveOriginalAttachment(B,a.card.reference)).status,'unknown');assert.equal(f.cap.store.db.prepare('SELECT total_changes() AS n').get().n,before);
  assert.deepEqual(f.cap.store.quiescence.retentionReferences([A,B]).protected.map(p=>p.session),[A,B]);f.restart();
  if(damaged)await writeFile(staged,Buffer.alloc(262144,9));const result=await f.cap.retainForkAttachments(request());
  assert.equal(result.status,damaged?'unknown':'completed');assert.equal(grants(f)[0].key,saved.key);assert.equal(body(f),damaged?0:1);
  assert.equal(hash(await readFile(join(f.directory,'attachments',a.descriptor.id+'.blob'))),a.descriptor.sha256);
 }
});
test('actual exit after copied body leaves pending original plan; restart commits same target ID without refork',async t=>{
 const f=await fixture(t),a=await f.upload(),r=request(),p=proof(r,a.card);f.close();
 const entry=new URL('../src/index.js',import.meta.url).href,grant=new URL('../src/fork-attachments.js',import.meta.url).href;
 const script=`import {createResourcesCapability} from ${JSON.stringify(entry)};import {ForkAttachments} from ${JSON.stringify(grant)};const p=JSON.parse(process.argv[2]),r=JSON.parse(process.argv[3]);const original=ForkAttachments.prototype.copy;ForkAttachments.prototype.copy=async function(...args){await original.apply(this,args);process.exit(17)};const cap=createResourcesCapability({directory:process.argv[1],inspectSession:async session=>({session}),verifyOriginalAttachment:()=>p});await cap.retainForkAttachments(r);`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script,f.directory,JSON.stringify(p),JSON.stringify(r)],{encoding:'utf8',timeout:5000});assert.equal(child.status,17,child.stderr);
 f.verify=()=>p;f.restart();const pending=grants(f)[0];assert.equal(pending.status,'pending');assert.equal(body(f),0);const id=JSON.parse(pending.plan).item.targetId;
 assert.equal((await f.cap.resolveOriginalAttachment(B,a.card.reference)).status,'pending');const result=await f.cap.retainForkAttachments(r);assert.equal(result.status,'completed');assert.equal(new URL(result.accessUri).hostname,id);
});
test('v2 schema missing-table guard refuses, and old writer refuses v2 before writes',async t=>{
 const f=await fixture(t),a=await f.upload();f.verify=r=>proof(r,a.card);await f.cap.retainForkAttachments(request());f.close();
 // Exact held v1 schema fixture; no Git/network/package dependency in this check.
 const old=await import('./fixtures/fork-schema-v1.mjs');const bytes=await readFile(join(f.directory,'resources.sqlite'));assert.throws(()=>old.preflightOwner(f.directory),/authoritative schema/);assert.deepEqual(await readFile(join(f.directory,'resources.sqlite')),bytes);
 f.restart();f.cap.store.db.exec('DROP TABLE fork_attachment_grants_v2');f.close();assert.throws(()=>f.open(),/authoritative schema/);
});
test('v1 receipts are retained unchanged and protected, never reinterpreted as v2 grants',async t=>{
 const f=await fixture(t),a=await f.upload();
 initializeSchema(f.cap.store.db,'resources',['forkAttachments'],()=>f.cap.store.db.exec('CREATE TABLE fork_attachment_bindings(command TEXT PRIMARY KEY,digest TEXT NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,request TEXT NOT NULL,plan TEXT NOT NULL,status TEXT NOT NULL,error TEXT,created REAL NOT NULL)'));
 f.cap.store.db.prepare('INSERT INTO fork_attachment_bindings VALUES(?,?,?,?,?,?,?,?,?)').run('legacy','legacy-digest',A,B,'unchanged request','unchanged v1 plan','unknown','retained',1);
 const old=f.cap.store.db.prepare('SELECT * FROM fork_attachment_bindings').get();f.verify=r=>proof(r,a.card);await assert.rejects(f.cap.retainForkAttachments(request('legacy')),/v1 authority/);assert.equal(await f.cap.resolveOriginalAttachment(B,a.card.reference),null);assert.equal(has(f),false);
 f.verify=r=>proof(r,a.card);assert.equal((await f.cap.retainForkAttachments(request())).status,'completed');f.restart();
 assert.deepEqual(f.cap.store.db.prepare('SELECT * FROM fork_attachment_bindings').get(),old);
 assert.deepEqual(f.cap.store.quiescence.retentionReferences([A,B]).protected.map(p=>p.session),[A,B]);
});
test('active verifier/copy joins owner intake; concurrent duplicate calls share one committed body',async t=>{
 const f=await fixture(t),a=await f.upload();let release,entered;const waiting=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 f.verify=async r=>{entered();await waiting;return proof(r,a.card)};
 const first=f.cap.retainForkAttachments(request());await started;
 assert.equal(f.cap.inspectQuiescence().activeRequests,1);assert.throws(()=>f.cap.close(),/still running/);
 const ctx={commandId:'stop',fenceId:'busy',purpose:'recovery',instanceId:'owned',dataScope:'owned'};
 assert.equal(await f.cap.quiescenceParticipant().acquire(ctx),null);
 const second=f.cap.retainForkAttachments(request('fork-a-b',20));release();assert.deepEqual(await first,await second);assert.equal(body(f),1);
 const lease=await f.cap.quiescenceParticipant().acquire({...ctx,fenceId:'fresh'});assert.ok(lease);
 await assert.rejects(f.cap.retainForkAttachments(request()),/intake closed/);assert.equal((await f.cap.resolveOriginalAttachment(B,a.card.reference)).status,'completed');
});
test('SQLite publication failure rolls back target metadata and leaves only the original unknown plan',async t=>{
 const f=await fixture(t),a=await f.upload();f.verify=r=>proof(r,a.card);
 f.cap.store.db.exec("CREATE TRIGGER fail_fixture_commit BEFORE INSERT ON attachment_metadata_revisions WHEN NEW.session='ahp-session:/fork' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
 const result=await f.cap.retainForkAttachments(request());assert.equal(result.status,'unknown');assert.equal(body(f),0);
 const saved=grants(f)[0],id=JSON.parse(saved.plan).item.targetId;assert.equal(hash(await readFile(join(f.directory,'attachments',id+'.blob'))),a.descriptor.sha256);
 f.cap.store.db.exec('DROP TRIGGER fail_fixture_commit');f.restart();
 const recovered=await f.cap.retainForkAttachments(request());assert.equal(recovered.status,'completed');assert.equal(new URL(recovered.accessUri).hostname,id);assert.equal(body(f),1);
});
test('empty and readonly full-length stages recover without replacing an original',async t=>{
 for(const content of ['', 'fully copied']){
  const f=await fixture(t),a=await f.upload(content);f.verify=r=>proof(r,a.card);const original=ForkAttachments.prototype.copy;
  try{ForkAttachments.prototype.copy=async function(source,p){const stage=join(this.attachments.directory,p.targetId+'.blob.fork-staged');await writeFile(stage,content);await chmod(stage,0o400);throw Error('fixture exit after chmod')};assert.equal((await f.cap.retainForkAttachments(request())).status,'unknown')}
  finally{ForkAttachments.prototype.copy=original}
  f.restart();assert.equal((await f.cap.retainForkAttachments(request())).status,'completed');assert.equal(hash(await readFile(join(f.directory,'attachments',a.descriptor.id+'.blob'))),a.descriptor.sha256);
 }
});
test('completed retry revalidates the occurrence while resolving and reusing bytes remains passive',async t=>{
 const f=await fixture(t),a=await f.upload();f.verify=r=>proof(r,a.card);const receipt=await f.cap.retainForkAttachments(request());
 const before=f.cap.store.db.prepare('SELECT total_changes() AS n').get().n,files=await readdir(join(f.directory,'attachments'));
 const original=ForkAttachments.prototype.copy;try{ForkAttachments.prototype.copy=()=>{throw Error('completed copy replayed')};assert.deepEqual(await f.cap.retainForkAttachments(request()),receipt)}finally{ForkAttachments.prototype.copy=original}
 assert.equal(f.cap.store.db.prepare('SELECT total_changes() AS n').get().n,before);assert.deepEqual(await readdir(join(f.directory,'attachments')),files);
});
