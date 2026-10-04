import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,renameSync,symlinkSync,copyFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {createResourcesCapability,ResourceStore} from '../src/index.js';
import {importLegacyDocuments} from '../src/migration.js';
import {CanvasApps} from '../src/apps.js';
import {initializeSchema} from '../src/authoritative-schema.js';

const legacy=JSON.parse(readFileSync(new URL('./fixtures/legacy-schemas.json',import.meta.url)));
const session='ahp-session:/schema-fixture';
const directory=()=>realpathSync(mkdtempSync(join(tmpdir(),'resources-authority-')));
const open=root=>createResourcesCapability({directory:root,inspectSession:async id=>({session:id,workingDirectory:root})});
const change=(root,file,sql)=>{const db=new DatabaseSync(join(root,file));try{db.exec(sql);}finally{db.close();}};
const hash=path=>existsSync(path)?createHash('sha256').update(readFileSync(path)).digest('hex'):null;
// Fixture-only hashes: the production guard never hashes/scans/copies stored data.
const evidence=root=>Object.fromEntries(['resources.sqlite','resources.sqlite-wal','resources-quiescence.sqlite','resources-quiescence.sqlite-wal'].map(name=>[name,hash(join(root,name))]));
const unchanged=(root,before)=>{const after=evidence(root);for(const [name,digest] of Object.entries(before))if(digest!==null)assert.equal(after[name],digest,name);};
const refused=root=>assert.throws(()=>open(root),error=>error.code===-32009&&error.executed===false&&/authoritative schema unavailable/.test(error.message));
const tables=['artifacts','versions','topics','events','apps','app_states','app_definitions','attachments','attachment_metadata_revisions','transfer_exports','transfer_evidence','transfer_payloads','transfer_payload_pending','legacy_document_imports'];
function enrollImports(root){
 const path=join(root,'legacy-fixture.sqlite'),db=new DatabaseSync(path);db.exec('CREATE TABLE state(id INTEGER PRIMARY KEY,value TEXT)');db.prepare('INSERT INTO state VALUES(1,?)').run(JSON.stringify({revision:1,canvasArtifacts:[]}));db.close();
 importLegacyDocuments({database:path,destination:root,sourceSession:'original',session,workingDirectory:root});
}
for(const table of [...tables,'fence','receipts'])test(`missing enrolled ${table} refuses before either durable file changes`,async()=>{
 const root=directory();enrollImports(root);let cap=open(root);
 await cap.action({topic:'canvas',version:1,channel:session,operation:'canvas.show',args:{kind:'text',content:'retained',title:'Fixture'}});
 await cap.quiescenceParticipant().acquire({fenceId:'original',commandId:'original',purpose:'recovery',instanceId:'fixture',dataScope:'fixture'});cap.close();
 change(root,['fence','receipts'].includes(table)?'resources-quiescence.sqlite':'resources.sqlite',`DROP TABLE ${table}`);
 const before=evidence(root);refused(root);unchanged(root,before);
 // A refusal also releases the original process lease; it does not leave an owner behind.
 refused(root);unchanged(root,before);
});

for(const file of ['resources.sqlite','resources-quiescence.sqlite'])for(const suffix of ['-wal','-shm','-journal'])for(const dangling of [false,true])test(`absent ${file} with ${dangling?'dangling':'empty'} ${suffix} is retained`,()=>{
 const root=directory(),sidecar=join(root,file+suffix);
 if(dangling)symlinkSync('missing-fixture-target',sidecar);else writeFileSync(sidecar,'');
 refused(root);assert.equal(existsSync(join(root,file)),false);assert.equal(existsSync(join(root,'resources.sqlite')),false);assert.equal(existsSync(join(root,'resources-quiescence.sqlite')),false);
});

test('existing empty file, missing column, wrong type, view, foreign marker and partial legacy schema refuse',()=>{
 for(const fault of ['empty','column','type','view','marker','legacy-combination']){
  const root=directory();
  if(fault==='empty')writeFileSync(join(root,'resources.sqlite'),'');
  else if(fault==='legacy-combination')change(root,'resources.sqlite',legacy[3].sql+' DROP TABLE apps; DROP TABLE app_states; DROP TABLE app_definitions;');
  else{open(root).close();change(root,'resources.sqlite',{
   column:'ALTER TABLE versions RENAME COLUMN message_id TO missing_message_id',
   type:'DROP TABLE topics; CREATE TABLE topics(session TEXT PRIMARY KEY,revision TEXT NOT NULL)',
   view:'DROP TABLE topics; CREATE VIEW topics AS SELECT 1 AS revision',marker:'PRAGMA user_version=1',
  }[fault]);}
  const before=evidence(root);refused(root);unchanged(root,before);
 }
});

test('the audited unversioned schema cannot conceal missing ownership or unknown-effect tables',()=>{
 for(const table of ['artifacts','apps','attachments','transfer_payload_pending','fence']){
  const root=directory();change(root,'resources.sqlite',legacy.at(-1).sql);
  change(root,'resources-quiescence.sqlite','CREATE TABLE fence(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT);CREATE TABLE receipts(id TEXT PRIMARY KEY,value TEXT);');
  change(root,table==='fence'?'resources-quiescence.sqlite':'resources.sqlite',`DROP TABLE ${table}`);
  const before=evidence(root);refused(root);unchanged(root,before);
 }
});

test('exact historical Store/factory/offline-import profiles upgrade without body hydration',()=>{
 for(const profile of legacy){
  const root=directory();change(root,'resources.sqlite',profile.sql);
  // All completed historical columns/constraints come verbatim from the recorded source.
  let cap=open(root);assert.equal(cap.store.list(session).items.length,0);cap.close();cap=open(root);cap.close();
 }
 const root=directory();let store=new ResourceStore(root);store.save({session,workingDirectory:root},{kind:'text',title:'Original'},{content:'original'});store.close();
 enrollImports(root);store=new ResourceStore(root);assert.equal(store.list(session).items[0].title,'Original');store.close();open(root).close();
});

test('namespace enrollment rolls back with DDL and composes with an outer offline transaction',()=>{
 const root=directory(),store=new ResourceStore(root),version=()=>store.db.prepare('PRAGMA user_version').get().user_version;
 const before=version();
 assert.throws(()=>initializeSchema(store.db,'resources',['apps'],()=>{store.db.exec('CREATE TABLE apps(artifact TEXT PRIMARY KEY,state_revision INTEGER NOT NULL)');throw Error('fixture interruption');}),/fixture interruption/);
 assert.equal(version(),before);assert.equal(store.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='apps'").get(),undefined);
 store.db.exec('BEGIN IMMEDIATE');new CanvasApps(store);assert.notEqual(version(),before);store.db.exec('ROLLBACK');
 assert.equal(version(),before);assert.equal(store.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='apps'").get(),undefined);store.close();open(root).close();
});

test('missing derived SQL indexes rebuild without changing artifact bodies or revision',async()=>{
 const root=directory();let cap=open(root);const result=await cap.action({topic:'canvas',version:1,channel:session,operation:'canvas.show',args:{kind:'text',title:'Original',content:'retained bytes'}});
 const id=result.result.artifact.id,body=cap.store.body(session,id),revision=cap.store.revision(session);cap.close();
 change(root,'resources.sqlite','DROP INDEX artifact_session; DROP INDEX artifact_source; DROP INDEX attachment_transfer_page');
 cap=open(root);assert.deepEqual(cap.store.body(session,id),body);assert.equal(cap.store.revision(session),revision);cap.close();
});

async function crashed(root,fault){
 const module=new URL('../src/index.js',import.meta.url).href;
 const script=`import {createResourcesCapability} from ${JSON.stringify(module)};const directory=process.argv[1];const cap=createResourcesCapability({directory,inspectSession:async session=>({session,workingDirectory:directory})});await cap.quiescenceParticipant().acquire({fenceId:'original',commandId:'original',purpose:'recovery',instanceId:'fixture',dataScope:'fixture'});${fault==='schema'?"cap.store.db.exec('DROP TABLE artifacts');":''}console.log('held');setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--input-type=module','-e',script,root],{stdio:['ignore','pipe','pipe']}),lines=createInterface({input:child.stdout});
 let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('fixture ready timeout')),5000);});
 let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 try{const line=await Promise.race([timeout,once(lines,'line'),once(child,'exit').then(()=>{throw Error('fixture child exited: '+stderr);})]);assert.equal(line[0],'held');
  // The live process owns the same OS lease; schema inspection cannot bypass it.
  assert.throws(()=>open(root),/already has an owner/);
 }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}lines.close();}
}

test('read-only schema refusal preserves crash-left committed main/WAL before any writable close',async()=>{
 const root=directory();await crashed(root,'schema');const before=evidence(root);assert.ok(before['resources.sqlite-wal']);assert.ok(before['resources-quiescence.sqlite-wal']);
 refused(root);unchanged(root,before);
 const db=new DatabaseSync(join(root,'resources-quiescence.sqlite'),{readOnly:true});assert.equal(JSON.parse(db.prepare('SELECT value FROM fence WHERE id=1').get().value).state,'held');db.close();
 unchanged(root,before);
});

test('actual crashed held WAL without its main cannot be recreated as fresh authority',async()=>{
 const root=directory();await crashed(root);const main=join(root,'resources-quiescence.sqlite'),wal=main+'-wal';
 assert.ok(hash(wal));copyFileSync(wal,wal+'.retained');renameSync(main,main+'.retained');const before=evidence(root);
 refused(root);assert.equal(existsSync(main),false);unchanged(root,before);assert.equal(hash(wal),hash(wal+'.retained'));
});
