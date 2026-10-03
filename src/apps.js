import Ajv2020 from 'ajv/dist/2020.js';
import {randomUUID,createHash} from 'node:crypto';
import {writeFileSync,readFileSync,openSync,fsyncSync,closeSync,renameSync,existsSync} from 'node:fs';
import {join} from 'node:path';

const fault=(message,code=-32602)=>{throw Object.assign(new Error(message),{code});};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clock=()=>Date.now()/1000;
const forbidden=new Set(['__proto__','prototype','constructor','$resource']);
const forbiddenSchema=new Set(['$ref','$dynamicRef','pattern','patternProperties']);
const supportedRequests=new Set(['theme.preview','theme.apply','theme.revert']);
const ajv=new Ajv2020({strict:false,allErrors:false,validateFormats:false,addUsedSchema:false});
const validators=new Map();
function checker(spec){
 const key=JSON.stringify(spec);let cached=validators.get(key);if(cached){validators.delete(key);validators.set(key,cached);return cached.validate;}
 cached={spec,validate:ajv.compile(spec)};validators.set(key,cached);
 if(validators.size>64){const first=validators.keys().next().value;ajv.removeSchema(validators.get(first).spec);validators.delete(first);}return cached.validate;
}

function data(value,limit=100000){
 const visit=(item,depth)=>{if(depth>24)fault('Surface data is nested too deeply');if(typeof item==='number'&&!Number.isFinite(item))fault('Surface values must be finite');if(object(item)){for(const [key,v]of Object.entries(item)){if(forbidden.has(key))fault('Surface data contains a reserved key');visit(v,depth+1);}}else if(Array.isArray(item))for(const v of item)visit(v,depth+1);else if(!['string','number','boolean'].includes(typeof item)&&item!==null)fault('Surface values must be JSON');};
 visit(value,0);const encoded=JSON.stringify(value);if(Buffer.byteLength(encoded)>limit)fault('Surface data exceeds its size limit');return JSON.parse(encoded);
}
function schema(spec){
 if(!object(spec))fault('A JSON schema object is required');
 const walk=value=>{if(object(value)){for(const [key,v]of Object.entries(value)){if(forbiddenSchema.has(key))fault('Surface schemas cannot use references or regular expressions');walk(v);}}else if(Array.isArray(value))value.forEach(walk);};
 walk(spec);try{if(!ajv.validateSchema(spec))fault('Invalid surface JSON schema');checker(spec);}catch{fault('Invalid surface JSON schema');}
}
function validate(value,spec){const check=checker(spec);if(!check(value))fault('Surface data does not match its schema: '+ajv.errorsText(check.errors).slice(0,300));}
function manifest(input){
 const value=data(input,32000);if(!object(value)||value.version!==1||Object.keys(value).some(k=>!['version','stateSchema','events','requests','theme'].includes(k)))fault('Use surface manifest version 1');
 if(!object(value.stateSchema)||value.stateSchema.type!=='object')fault('A surface stateSchema with type object is required');schema(value.stateSchema);
 if(!['inherit','accent-only','fixed'].includes(value.theme??'inherit'))fault('Invalid surface theme behavior');
 for(const group of ['events','requests']){
  value[group]??={};if(!object(value[group])||Object.keys(value[group]).length>32)fault('Declare at most 32 surface '+group);
  for(const [name,entry]of Object.entries(value[group])){
   if(!name||name.length>80||!object(entry))fault('Invalid surface operation');const allowed=group==='events'?['schema','updates','label']:['schema','action','label'];
   if(Object.keys(entry).some(k=>!allowed.includes(k)))fault('Unsupported surface operation field');schema(entry.schema);
   if(entry.label!==undefined&&(typeof entry.label!=='string'||entry.label.length>120))fault('Operation labels must be short text');
   if(group==='requests'&&!supportedRequests.has(entry.action))fault('Unsupported client action');
   if(group==='events'&&(!object(entry.updates??{})||Object.values(entry.updates??{}).some(v=>typeof v!=='string')))fault('Event updates map state fields to payload fields');
  }
 }return value;
}
function text(value,name,max=500000){if(typeof value!=='string'||value.length>max)fault('Invalid '+name);return value;}
function revisions(app,args){if(args.expectedRevision!==app.revision||args.expectedStateRevision!==app.stateRevision)fault('Surface changed; inspect current revisions before retrying',-32011);}

/** Offline conversion validates original schema/state; historical effects stay in the import journal. */
export function validateLegacyAppSnapshot(content,spec,state,revision,stateRevision){
 if(!Number.isSafeInteger(revision)||revision<1||!Number.isSafeInteger(stateRevision)||stateRevision<0)fault('Invalid legacy app revisions');
 const checked=manifest(spec),value=data(state);validate(value,checked.stateSchema);
 return {content:text(content,'content'),app:{manifest:checked,state:value,revision,stateRevision,events:[],requests:[]}};
}

/** Definitions and shared app state are durable. No client drafts or rendered views are stored. */
export class CanvasApps{
 operations=['create','inspect','revise','restore','state','event','request','resolve'].map(name=>'canvas.apps.'+name);
 constructor(store){
  this.store=store;this.db=store.db;
  this.db.exec(`CREATE TABLE IF NOT EXISTS apps(artifact TEXT PRIMARY KEY,state_revision INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS app_states(artifact TEXT NOT NULL,state_revision INTEGER NOT NULL,definition_revision INTEGER NOT NULL,hash TEXT NOT NULL,summary TEXT NOT NULL,PRIMARY KEY(artifact,state_revision));
   CREATE TABLE IF NOT EXISTS app_definitions(artifact TEXT NOT NULL,revision INTEGER NOT NULL,state_revision INTEGER NOT NULL,PRIMARY KEY(artifact,revision));`);
 }
 has(id){return !!this.db.prepare('SELECT 1 FROM apps WHERE artifact=?').get(id);}
 snapshotRow(id,version,stateRevision){
  const current=this.db.prepare('SELECT state_revision FROM apps WHERE artifact=?').get(id);if(!current)fault('CanvasApp unavailable',-32008);
  let chosen;if(stateRevision!==undefined&&stateRevision!==null){chosen=Number(stateRevision);if(!Number.isSafeInteger(chosen)||chosen<0)fault('Invalid app state revision');}
  else chosen=this.db.prepare('SELECT state_revision FROM app_definitions WHERE artifact=? AND revision=?').get(id,version)?.state_revision;
  const row=this.db.prepare('SELECT * FROM app_states WHERE artifact=? AND state_revision=?').get(id,chosen??-1);if(!row||row.definition_revision!==version)fault('CanvasApp revision unavailable',-32008);return row;
 }
 load(row){const bytes=readFileSync(join(this.store.blobs,row.hash+'.json'));if(createHash('sha256').update(bytes).digest('hex')!==row.hash)fault('CanvasApp integrity check failed; original data retained',-32603);return JSON.parse(bytes);}
 current(session,id){const row=this.store.row(session,id),state=this.db.prepare('SELECT state_revision FROM apps WHERE artifact=?').get(id);if(!state)fault('CanvasApp unavailable',-32008);return this.load(this.snapshotRow(id,row.revision,state.state_revision));}
 body(session,id,version,stateRevision){this.store.row(session,id);return this.load(this.snapshotRow(id,version,stateRevision));}
 decorate(descriptor){
  if(!this.has(descriptor.id))return descriptor;
  const selected=descriptor.revision===descriptor.latestVersion?this.db.prepare('SELECT state_revision FROM apps WHERE artifact=?').get(descriptor.id).state_revision:undefined;
  const saved=this.snapshotRow(descriptor.id,descriptor.revision,selected),app=JSON.parse(saved.summary),uri=new URL(descriptor.bodyUri);uri.searchParams.set('stateRevision',saved.state_revision);
  const {editableUri,...rest}=descriptor;return {...rest,bodyUri:uri.href,etag:JSON.stringify(descriptor.id+':'+descriptor.revision+':'+saved.state_revision),app:{...app,versions:descriptor.versions}};
 }
 persist(id,body,{definition=false}={}){
  const encoded=JSON.stringify(body);if(Buffer.byteLength(encoded)>6*1024*1024)fault('CanvasApp retained body exceeds 6 MiB');const hash=createHash('sha256').update(encoded).digest('hex'),path=join(this.store.blobs,hash+'.json');
  if(!existsSync(path)){const temp=path+'.'+randomUUID()+'.tmp',fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,encoded);fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,path);const parent=openSync(this.store.blobs,'r');try{fsyncSync(parent);}finally{closeSync(parent);}}
  const {app}=body,summary={revision:app.revision,stateRevision:app.stateRevision,requests:app.requests.map(({input,token,...request})=>request)};
  this.db.prepare('INSERT INTO app_states VALUES(?,?,?,?,?)').run(id,app.stateRevision,app.revision,hash,JSON.stringify(summary));
  this.db.prepare('INSERT INTO apps VALUES(?,?) ON CONFLICT(artifact) DO UPDATE SET state_revision=excluded.state_revision').run(id,app.stateRevision);
  if(definition)this.db.prepare('INSERT INTO app_definitions VALUES(?,?,?)').run(id,app.revision,app.stateRevision);
 }
 result(context,id,extra={}){const row=this.store.row(context.session,id),artifact=this.store.descriptor(row);return {artifact,app:this.current(context.session,id).app,...extra};}
 action(context,operation,args,caller){
  const name=operation.slice('canvas.apps.'.length);
  if(name==='create'){
   const spec=manifest(args.manifest),state=data(args.initialState);validate(state,spec.stateSchema);
   const body={content:text(args.content,'content'),app:{manifest:spec,state,revision:1,stateRevision:0,events:[],requests:[]}};
   const artifact=this.store.save(context,{kind:'canvas-app',title:text(args.title,'title',200)},body,{onCommit:id=>this.persist(id,body,{definition:true})});return this.result(context,artifact.id);
  }
  const row=this.store.row(context.session,args.id),body=this.current(context.session,args.id),app=body.app;
  if(name==='inspect'){const result=this.result(context,args.id);if(args.includeSource)result.content=body.content;if(args.requestId){const request=app.requests.find(r=>r.id===args.requestId);if(!request)fault('Client request unavailable',-32008);result.requestInput=request.input;}return result;}
  // Completion reconciles a previously admitted local effect. Its token remains authoritative
  // even when later state edits supersede the displayed revisions; it never executes an effect.
  if(name==='resolve'&&args.phase==='complete')return this.complete(context,row,body,args,caller);
  revisions(app,args);
  if(name==='revise'||name==='restore'){
   let content,spec,title;
   if(name==='restore'){const old=this.body(context.session,row.id,args.version);content=old.content;spec=old.app.manifest;title=this.store.descriptor(row,args.version).title;}
   else{content=text(args.content,'content');spec=manifest(args.manifest??app.manifest);title=args.title===undefined?this.store.descriptor(row).title:text(args.title,'title',200);}
   const value=data(args.migratedState??app.state);validate(value,spec.stateSchema);
   Object.assign(body,{content});Object.assign(app,{manifest:spec,state:value,revision:app.revision+1,stateRevision:app.stateRevision+1});
   for(const request of app.requests)if(request.status==='pending')request.status='superseded';
   this.store.save(context,{kind:'canvas-app',title},body,{id:row.id,expectedRevision:row.revision,force:true,onCommit:id=>this.persist(id,body,{definition:true})});return this.result(context,row.id);
  }
  let effect;
  if(name==='state'||name==='event'){
   let patch;if(name==='state'){patch=data(args.patch);if(!object(patch))fault('Surface patch must be an object');}
   else{const entry=app.manifest.events[args.name];if(!entry)fault('Surface event not declared');const payload=data(args.payload,16000);validate(payload,entry.schema);if(Object.values(entry.updates??{}).some(key=>!Object.hasOwn(payload,key)))fault('Event payload is missing an updated field');patch=Object.fromEntries(Object.entries(entry.updates??{}).map(([key,field])=>[key,payload[field]]));app.events=[...app.events,{name:args.name,payload,origin:caller.clientId??'agent',at:clock()}].slice(-50);}
   const state=data({...app.state,...patch});validate(state,app.manifest.stateSchema);app.state=state;
  }else if(name==='request'){
   const entry=app.manifest.requests[args.name];if(!entry)fault('Client request not declared');if(app.requests.filter(r=>r.status==='pending'||r.status==='unknown').length>=5)fault('Resolve pending client requests first',-32011);
   const input=data(args.input,300000);validate(input,entry.schema);
   if(!object(input))fault('Client action input must be an object');
   const request={id:randomUUID(),name:args.name,action:entry.action,input,status:'pending',summary:typeof input.name==='string'?input.name.slice(0,120):'Previous theme',origin:caller.clientId??'agent',at:clock()};app.requests.push(request);
   const live=app.requests.filter(r=>['pending','unknown'].includes(r.status)),finished=app.requests.filter(r=>!['pending','unknown'].includes(r.status));app.requests=[...live,...finished.slice(-(20-live.length))].sort((a,b)=>a.at-b.at);
  }else if(name==='resolve'){
   const request=app.requests.find(r=>r.id===args.requestId);if(!request||request.status!=='pending')fault('Client request already resolved, admitted or superseded',-32011);
   if(typeof args.approve!=='boolean')fault('Explicit approval or rejection is required');
   if(args.approve){if(args.phase!=='claim'||typeof caller.clientId!=='string'||!caller.clientId)fault('The attached client must claim its own local effect',-32009);if(args.clientId&&args.clientId!==caller.clientId)fault('Cannot claim another client\'s effect',-32009);request.status='unknown';request.clientId=caller.clientId;request.token=randomUUID();effect={token:request.token,action:request.action,args:request.input};}
   else{request.status='rejected';request.resolvedBy=caller.clientId??'agent';}
  }else fault('Unsupported CanvasApp operation',-32601);
  app.stateRevision++;this.commit(context,row,body);return this.result(context,row.id,effect?{effect}:{});
 }
 commit(context,row,body){
  this.db.exec('BEGIN IMMEDIATE');try{const current=this.db.prepare('SELECT state_revision FROM apps WHERE artifact=?').get(row.id);if(current.state_revision!==body.app.stateRevision-1||this.store.row(context.session,row.id).revision!==row.revision)fault('Surface changed during mutation',-32011);this.persist(row.id,body);this.store.touch(context.session);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 complete(context,row,body,args,caller){
  const request=body.app.requests.find(r=>r.id===args.requestId);if(!request||request.token!==args.token||request.clientId!==caller.clientId||!caller.clientId)fault('Client effect receipt does not match its owner and token',-32009);
  if(!['applied','failed'].includes(args.outcome))fault('A definite local effect outcome is required');
  if(request.status!=='unknown'){if(request.status===args.outcome)return this.result(context,row.id);fault('Client effect was already completed with another outcome',-32011);}
  request.status=args.outcome;request.resolvedBy=caller.clientId;request.resolvedAt=clock();body.app.stateRevision++;this.commit(context,row,body);return this.result(context,row.id);
 }
}
