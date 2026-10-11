import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {importLegacyDocuments} from '../src/migration.js';import {createResourcesCapability} from '../src/index.js';
const hash=raw=>createHash('sha256').update(raw).digest('hex');
function fixture(t){
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'resource-migration-')));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const database=join(directory,'app.sqlite3'),destination=join(directory,'owned'),workingDirectory=join(directory,'workspace');mkdirSync(workingDirectory);mkdirSync(join(directory,'artifacts'));
 const db=new DatabaseSync(database);db.exec('CREATE TABLE state(id INTEGER PRIMARY KEY,value TEXT); CREATE TABLE state_resources(id TEXT PRIMARY KEY,value TEXT); CREATE TABLE state_records(kind TEXT,id TEXT,value TEXT,PRIMARY KEY(kind,id));');
 const body=(text,{corrupt=false}={})=>{const bytes=JSON.stringify({content:text}),id=hash(bytes);db.prepare('INSERT INTO state_resources VALUES(?,?)').run(id,JSON.stringify({$blob:id}));writeFileSync(join(directory,'artifacts',id+'.json'),corrupt?'damaged':bytes);return {$resource:id,bytes:Buffer.byteLength(bytes)};};
 const first=body('original'),second=body('revised'),row={id:'document-one',sessionId:'legacy-session',title:'Latest',kind:'text',revision:2,createdAt:1,body:second,versions:[{version:1,title:'Original',kind:'text',body:first,createdAt:1,messageId:'human-one'},{version:2,title:'Latest',kind:'text',body:second,createdAt:2,messageId:'human-two'}]};
 const save=rows=>db.prepare('INSERT OR REPLACE INTO state VALUES(1,?)').run(JSON.stringify({revision:7,canvasArtifacts:rows}));save([row]);
 const args={database,destination,sourceSession:'legacy-session',session:'ahp-session:/chosen',workingDirectory};
 return {directory,db,body,row,save,args,close:()=>db.close(),owner:()=>createResourcesCapability({directory:destination,inspectSession:async session=>({session,workingDirectory})})};
}
test('selected legacy versions retain exact bodies and messages, page and reimport without overwriting',async t=>{
 const f=fixture(t);f.save([f.row,{...f.row,id:'other-conversation',sessionId:'other'},{...f.row,id:'document-two'}]);f.close();const before=hash(readFileSync(f.args.database));
 const first=importLegacyDocuments({...f.args,limit:1});assert.equal(first.items.length,1);assert.equal(first.items[0].status,'imported');assert.ok(first.nextCursor);
 const second=importLegacyDocuments({...f.args,limit:1,after:first.nextCursor});assert.equal(second.items[0].id,'document-two');assert.equal(second.nextCursor,null);
 let owner=f.owner();try{const saved=await owner.action({topic:'canvas',operation:'canvas.versions.inspect',version:1,channel:f.args.session,args:{id:'document-one',version:1,includeSource:true}});assert.equal(saved.result.body.content,'original');assert.equal(saved.result.artifact.messageId,'human-one');
  await owner.action({topic:'canvas',operation:'canvas.versions.revise',version:1,channel:f.args.session,args:{id:'document-one',expectedRevision:2,content:'new destination work'}});
  assert.throws(()=>importLegacyDocuments({...f.args,limit:1}),/already has an owner/);owner.close();
  const replay=importLegacyDocuments({...f.args,limit:1});owner=f.owner();assert.equal(replay.items[0].status,'already-imported');assert.equal(owner.store.body(f.args.session,'document-one').content,'new destination work');
 }finally{owner.close();}
 assert.equal(hash(readFileSync(f.args.database)),before);
});
test('committed global overlay wins over checkpoint and unknown interactive effects remain with source',t=>{
 const f=fixture(t);f.db.prepare('INSERT INTO state_records VALUES(?,?,?)').run('global','canvasArtifacts',JSON.stringify({present:true,value:[{...f.row,id:'from-overlay'},{...f.row,id:'old-app',kind:'canvas-app',app:{requests:[{status:'unknown'}]}}]}));f.close();
 const result=importLegacyDocuments(f.args);assert.deepEqual(result.items.map(row=>[row.id,row.status]),[['from-overlay','imported'],['old-app','retained']]);assert.equal(result.executionStarted,false);assert.equal(result.privateClientStateImported,false);
 const store=f.owner();try{assert.equal(store.store.list(f.args.session).items.length,1);}finally{store.close();}
});
test('corrupt saved body and destination identity conflicts preserve both authorities',async t=>{
 const f=fixture(t);const corrupt=f.body('missing source',{corrupt:true});f.save([{...f.row,id:'damaged',revision:1,body:corrupt,versions:[]},f.row]);f.close();
 const owner=f.owner();owner.store.save({session:'ahp-session:/different',workingDirectory:f.args.workingDirectory},{kind:'text',title:'Existing'},{content:'keep'},{newId:'document-one'});owner.close();
 const result=importLegacyDocuments(f.args);assert.ok(result.items.every(row=>row.status==='retained'));assert.match(result.items[0].reason,/integrity|JSON|Unexpected/);assert.match(result.items[1].reason,/Destination identity/);
 const again=f.owner();try{assert.equal(again.store.body('ahp-session:/different','document-one').content,'keep');assert.equal(again.store.list(f.args.session).items.length,0);}finally{again.close();}
});
test('stale source cursor and changed target mapping refuse instead of replacing imported versions',t=>{
 const f=fixture(t);f.save([f.row,{...f.row,id:'second'}]);const first=importLegacyDocuments({...f.args,limit:1});
 f.db.prepare('INSERT INTO state_records VALUES(?,?,?)').run('revision','',JSON.stringify(8));f.close();
 assert.throws(()=>importLegacyDocuments({...f.args,after:first.nextCursor}),/page changed/);
 const changed=importLegacyDocuments({...f.args,session:'ahp-session:/other'});assert.equal(changed.items[0].status,'retained');assert.match(changed.items[0].reason,/mapping changed/);
});

test('reviewed legacy app definitions and current state preserve original bytes and never reactivate effects',async t=>{
 const {importLegacyApps}=await import('../src/migration.js');const f=fixture(t);
 const saved=value=>{const bytes=JSON.stringify(value),id=hash(bytes);f.db.prepare('INSERT INTO state_resources VALUES(?,?)').run(id,JSON.stringify({$blob:id}));writeFileSync(join(f.directory,'artifacts',id+'.json'),bytes);return {$resource:id};};
 const spec={version:1,stateSchema:{type:'object',properties:{count:{type:'integer'}},required:['count'],additionalProperties:false},events:{},requests:{}};
 const first=saved({content:'<b>first</b>',manifest:spec}),second=saved({content:'<b>second</b>',manifest:spec}),state1=saved({state:{count:1},stateRevision:0}),state2=saved({state:{count:3},stateRevision:2});
 const row={id:'legacy-app',kind:'canvas-app',sessionId:'legacy-session',title:'Second',createdAt:1,body:second,publications:[{version:1,messageId:'original-message'}],app:{revision:2,stateRevision:3,manifest:spec,state:{count:9},events:[{name:'old'}],requests:[{id:'old-effect',status:'applied',token:'never-restore'}],versions:[{version:1,title:'First',body:first,stateResource:state1,createdAt:1},{version:2,title:'Second',body:second,stateResource:state2,createdAt:2}]}};
 f.save([row,{...row,id:'unknown-app',app:{...row.app,requests:[{status:'unknown'}]}}]);f.close();const before=hash(readFileSync(f.args.database));
 const preview=importLegacyDocuments(f.args);assert.ok(preview.items.every(item=>item.status==='retained'));
 const reviewed=Object.fromEntries(preview.items.map(item=>[item.id,item.metadataSha256]));
 const result=importLegacyApps({...f.args,reviewed});assert.deepEqual(result.items.map(item=>item.status),['imported','retained']);assert.match(result.items[1].reason,/unknown/);
 let owner=f.owner();try{
  const page=await owner.read({uri:'amplifier-capability://canvas',scope:f.args.session}),descriptor=page.data.canvasArtifacts[0];assert.equal(descriptor.revision,2);assert.equal(descriptor.app.stateRevision,3);
  const current=JSON.parse((await owner.resourceProvider.read({uri:descriptor.bodyUri})).data);assert.deepEqual(current.app.state,{count:9});assert.deepEqual(current.app.requests,[]);assert.deepEqual(current.app.events,[]);
  const historical=(await owner.action({topic:'canvas',version:1,channel:f.args.session,operation:'canvas.versions.inspect',args:{id:row.id,version:1}})).result.artifact;
  assert.equal(historical.messageId,'original-message');assert.deepEqual(JSON.parse((await owner.resourceProvider.read({uri:historical.bodyUri})).data).app.state,{count:1});
  assert.equal(hash(readFileSync(join(f.args.destination,'bodies',first.$resource+'.json'))),first.$resource);
  await owner.action({topic:'canvas',version:1,channel:f.args.session,operation:'canvas.apps.state',args:{id:row.id,expectedRevision:2,expectedStateRevision:3,patch:{count:10}}});owner.close();
  assert.equal(importLegacyApps({...f.args,reviewed}).items[0].status,'already-imported');owner=f.owner();assert.equal((await owner.action({topic:'canvas',version:1,channel:f.args.session,operation:'canvas.apps.inspect',args:{id:row.id}})).result.app.state.count,10);
 }finally{owner.close();}
 assert.equal(hash(readFileSync(f.args.database)),before);assert.equal(importLegacyApps({...f.args,reviewed:{'legacy-app':'f'.repeat(64)}}).items[0].status,'retained');
});


test('legacy live Settings retain identity with empty bytes and reopen without copying preferences',async t=>{
 const f=fixture(t),bytes='{}',id=hash(bytes);f.db.prepare('INSERT INTO state_resources VALUES(?,?)').run(id,bytes);
 const row={id:'legacy-settings',sessionId:'legacy-session',title:'Settings',kind:'settings',revision:1,createdAt:1,body:{$resource:id},versions:[{version:1,kind:'settings',title:'Settings',body:{$resource:id},createdAt:1}]};
 f.save([row,{...row,id:'invalid-settings',versions:[{...row.versions[0],body:f.body('private setting')}]}]);f.close();const before=hash(readFileSync(f.args.database));
 const imported=importLegacyDocuments(f.args);assert.deepEqual(imported.items.map(item=>item.status),['imported','retained']);assert.match(imported.items[1].reason,/no saved content/);
 const owner=f.owner();try{const saved=await owner.action({topic:'canvas',operation:'canvas.show',version:1,channel:f.args.session,args:{kind:'settings'}});assert.equal(saved.result.artifact.id,row.id);assert.equal(saved.result.artifact.editableUri,undefined);assert.deepEqual(owner.store.body(f.args.session,row.id),{});assert.equal(owner.store.list(f.args.session).items.length,1);}finally{owner.close();}
 assert.equal(hash(readFileSync(f.args.database)),before);
});
