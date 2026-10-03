import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync,openSync,fsyncSync,closeSync,renameSync,readFileSync,existsSync} from 'node:fs';
import {readFile,realpath,stat} from 'node:fs/promises';
import {join,relative,isAbsolute,extname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ResourceEvidence} from './transfer.js';
import {CanvasApps} from './apps.js';
import {actionSchemas} from './actions.js';
import {Attachments,attachmentSchemas,CHUNK_BYTES,MAX_ATTACHMENT} from './attachments.js';
const kinds=new Set(['text','markdown','code','html','mermaid','dot','json','jsonl','image','a2ui','browser','babylon']);
const now=()=>Date.now()/1000;
const fail=(message,code=-32602)=>{throw Object.assign(Error(message),{code});};
const integer=(n,maximum=200)=>Number.isSafeInteger(n)&&n>=1&&n<=maximum;
const bounded=(v,name,max=8192)=>{if(typeof v!=='string'||!v||v.length>max||v.includes('\0'))fail('Invalid '+name);return v;};
// Nested JSON resource envelopes can double escaping. Stay below a 16 MiB frame.
const MAX_SOURCE=4*1024*1024,MAX_BODY=6*1024*1024;
function canonical(value){return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);}
function atomic(path,data){const temp=path+'.'+randomUUID()+'.tmp';const fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,data);fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,path);const directory=openSync(join(path,'..'),'r');try{fsyncSync(directory);}finally{closeSync(directory);}}
function bodyURI(id,version,session){const uri=new URL(`amplifier-canvas://artifact/${id}/versions/${version}`);uri.searchParams.set('session',session);return uri.href;}

/** Durable shared artifacts only; selection, drafts and rendering evidence stay local. */
export class ResourceStore{
 constructor(directory){mkdirSync(directory,{recursive:true,mode:0o700});this.directory=directory;this.blobs=join(directory,'bodies');mkdirSync(this.blobs,{recursive:true,mode:0o700});this.db=new DatabaseSync(join(directory,'resources.sqlite'));this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,session TEXT NOT NULL,workspace TEXT NOT NULL,source_path TEXT,created REAL NOT NULL,modified REAL NOT NULL,revision INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS artifact_session ON artifacts(session,modified DESC,id);
 CREATE INDEX IF NOT EXISTS artifact_source ON artifacts(session,source_path);
 CREATE TABLE IF NOT EXISTS versions(artifact TEXT NOT NULL,revision INTEGER NOT NULL,hash TEXT NOT NULL,definition TEXT NOT NULL,created REAL NOT NULL,message_id TEXT,PRIMARY KEY(artifact,revision));
 CREATE TABLE IF NOT EXISTS topics(session TEXT PRIMARY KEY,revision INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,artifact TEXT NOT NULL,session TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS artifact_events ON events(artifact,id DESC);`);}
 revision(session){return Number(this.db.prepare('SELECT revision FROM topics WHERE session=?').get(session)?.revision??0);}
 touch(session){this.db.prepare('INSERT INTO topics VALUES(?,1) ON CONFLICT(session) DO UPDATE SET revision=revision+1').run(session);}
 row(session,id){const row=this.db.prepare('SELECT * FROM artifacts WHERE id=? AND session=?').get(id,session);if(!row)fail('Artifact not found in this conversation',-32008);return row;}
 descriptor(row,version=row.revision){const saved=this.db.prepare('SELECT * FROM versions WHERE artifact=? AND revision=?').get(row.id,version);if(!saved)fail('Saved artifact version not found',-32008);const definition=JSON.parse(saved.definition);const versions=this.db.prepare('SELECT revision,created,message_id,definition FROM versions WHERE artifact=? ORDER BY revision DESC LIMIT 20').all(row.id).reverse().map(v=>({version:v.revision,title:JSON.parse(v.definition).title,createdAt:v.created,messageId:v.message_id}));return {...definition,id:row.id,sessionId:row.session,workspaceId:row.workspace,createdAt:row.created,modifiedAt:row.modified,revision:version,latestVersion:row.revision,...(version!==row.revision?{selectedVersion:version,readOnlyVersion:true}:{}),messageId:saved.message_id,bodyUri:bodyURI(row.id,version,row.session),editableUri:bodyURI(row.id,'latest',row.session),etag:JSON.stringify(row.id+':'+version),versions,versionsHasMore:row.revision>versions.length,publications:versions.filter(v=>v.messageId).map(v=>({messageId:v.messageId,version:v.version}))};}
 list(session,{limit=50,cursor}={}){if(!integer(limit))fail('Resource page limit must be 1..200');let after;
  if(cursor){try{after=JSON.parse(Buffer.from(cursor,'base64url').toString());}catch{fail('Invalid artifact cursor');}if(after.session!==session||!Number.isFinite(after.modified)||typeof after.id!=='string')fail('Artifact cursor belongs to another scope');}
  const rows=after?this.db.prepare('SELECT * FROM artifacts WHERE session=? AND (modified<? OR (modified=? AND id>?)) ORDER BY modified DESC,id LIMIT ?').all(session,after.modified,after.modified,after.id,limit+1):this.db.prepare('SELECT * FROM artifacts WHERE session=? ORDER BY modified DESC,id LIMIT ?').all(session,limit+1);
  const last=rows[Math.min(limit,rows.length)-1];return {items:rows.slice(0,limit).map(row=>this.descriptor(row)),...(rows.length>limit?{nextCursor:Buffer.from(JSON.stringify({session,modified:last.modified,id:last.id})).toString('base64url')}:{})};}
 body(session,id,version){const row=this.row(session,id);version=version??row.revision;if(!integer(version,Number.MAX_SAFE_INTEGER))fail('Invalid artifact revision');const saved=this.db.prepare('SELECT hash FROM versions WHERE artifact=? AND revision=?').get(id,version);if(!saved)fail('Saved artifact version not found',-32008);const bytes=readFileSync(join(this.blobs,saved.hash+'.json'));if(createHash('sha256').update(bytes).digest('hex')!==saved.hash)fail('Saved artifact body failed integrity validation; original files retained',-32603);return JSON.parse(bytes);}
 save(context,definition,body,{id,newId,expectedRevision,force=false,onCommit}={}){
  const encoded=canonical(body);if(Buffer.byteLength(encoded)>MAX_BODY)fail('Artifact exceeds the 6 MiB resource envelope limit');const hash=createHash('sha256').update(encoded).digest('hex'),path=join(this.blobs,hash+'.json');if(!existsSync(path))atomic(path,encoded);
  this.db.exec('BEGIN IMMEDIATE');let row;
  try{if(id)row=this.row(context.session,id);else if(definition.path)row=this.db.prepare('SELECT * FROM artifacts WHERE session=? AND source_path=? ORDER BY created LIMIT 1').get(context.session,definition.path);
   if(expectedRevision!==undefined&&row?.revision!==expectedRevision)fail('This artifact changed; reload before saving',-32011);
   if(id&&expectedRevision===undefined)fail('expectedRevision is required when revising an artifact');
   if(newId&&this.db.prepare('SELECT 1 FROM artifacts WHERE id=?').get(newId))fail('Artifact identity already belongs to another resource',-32011);
   const identity=row?.id??newId??randomUUID(),time=now();const previous=row&&this.db.prepare('SELECT hash,definition FROM versions WHERE artifact=? AND revision=?').get(identity,row.revision);
   if(previous&&!force&&previous.hash===hash&&previous.definition===canonical(definition)){this.db.exec('COMMIT');return this.descriptor(row);}
   const revision=(row?.revision??0)+1;
   this.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET modified=excluded.modified,revision=excluded.revision,source_path=excluded.source_path').run(identity,context.session,context.workingDirectory,definition.path??null,row?.created??time,time,revision);
   this.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?)').run(identity,revision,hash,canonical(definition),time,context.activeTurnId??null);onCommit?.(identity,revision);this.touch(context.session);this.db.exec('COMMIT');return this.descriptor(this.row(context.session,identity));
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 event(session,id,event){this.row(session,id);const encoded=canonical(event);if(Buffer.byteLength(encoded)>16384)fail('Canvas event exceeds 16 KiB');this.db.prepare('INSERT INTO events(artifact,session,payload) VALUES(?,?,?)').run(id,session,encoded);this.touch(session);return {recorded:true};}
 close(){if(!this.closed){this.closed=true;this.db.close();}}
}
async function definition(context,args){
 let kind=args.kind||'auto',content=args.content,surface=args.surface,path,workspacePath;
 if(args.path){path=await realpath(isAbsolute(args.path)?args.path:join(context.workingDirectory,args.path));const workspace=await realpath(context.workingDirectory),rel=relative(workspace,path);if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))fail('File lies outside the execution workspace',-32009);const info=await stat(path);if(!info.isFile()||info.size>MAX_SOURCE)fail('Select a regular file no larger than 4 MiB');workspacePath=workspace;const bytes=await readFile(path);if(bytes.length>MAX_SOURCE)fail('File grew beyond the 4 MiB limit');const ext=extname(path).toLowerCase();if(kind==='auto')kind=({'.md':'markdown','.markdown':'markdown','.html':'html','.htm':'html','.mmd':'mermaid','.dot':'dot','.json':'json','.jsonl':'jsonl','.png':'image','.jpg':'image','.jpeg':'image','.webp':'image','.gif':'image','.svg':'image'})[ext]||'code';content=kind==='image'?`data:${({'.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif'})[ext]||'application/octet-stream'};base64,${bytes.toString('base64')}`:bytes.toString('utf8');}
 if(!kinds.has(kind))fail('Unsupported Canvas kind');let url;if(kind==='browser'){url=new URL(args.url).href;if(!['http:','https:'].includes(new URL(url).protocol))fail('Browser previews require HTTP or HTTPS');}
 if(content!==undefined&&typeof content!=='string')fail('Canvas content must be text');if(surface!==undefined&&(!surface||typeof surface!=='object'||Array.isArray(surface)))fail('Canvas surface must be an object');
 const value={kind,title:bounded(args.title||(path?path.split('/').at(-1):kind==='browser'?new URL(url).hostname:'Untitled artifact'),'title',200),...(path?{path,workspacePath}:{}),...(url?{url}:{})};
 return {definition:value,body:{...(content!==undefined?{content}:{}),...(surface!==undefined?{surface}:{})}};
}

export function createResourcesCapability({directory,inspectSession,onChanged=()=>{}}){
 const store=new ResourceStore(directory),apps=new CanvasApps(store);const operations=['canvas.show','canvas.openFile','canvas.versions.inspect','canvas.versions.revise','canvas.versions.restore','canvas.reference','canvas.event',...apps.operations];
 const originalDescriptor=store.descriptor.bind(store);store.descriptor=(row,version)=>{const value=apps.decorate(originalDescriptor(row,version));if(!value.external)return value;const {external,editableUri,...rest}=value;return {...rest,...external};};
 const manifest={version:1,topics:{canvas:{uri:'amplifier-capability://canvas',version:1,watch:true}},actions:Object.fromEntries(operations.map(operation=>[operation,{topic:'canvas',operation,method:'x-amplifier/capabilityAction'}]))};
 const context=async session=>{if(typeof session!=='string'||!session.startsWith('ahp-session:/'))fail('Canvas requires an explicit conversation');const value=await inspectSession(session);if(value.session!==session)fail('Conversation scope changed',-32009);return value;};
 const transfer=new ResourceEvidence(store,context);
 const attachments=new Attachments(store,context);manifest.topics.attachments={uri:'amplifier-capability://attachments',version:1,watch:false};for(const operation of Object.keys(attachmentSchemas))manifest.actions[operation]={topic:'attachments',operation,method:'x-amplifier/capabilityAction'};
 const snapshot=async(scope,query={})=>{await context(scope);const page=store.list(scope,query);return {topic:'canvas',scope,revision:store.revision(scope),data:{canvasArtifacts:page.items,canvasPage:{nextCursor:page.nextCursor}}};};
 const read=async({uri,scope,topic})=>{const parsed=new URL(uri);if(topic==='attachments'||parsed.hostname==='attachments'){await context(scope);return {topic:'attachments',scope,revision:1,data:{attachmentLimits:{chunkBytes:CHUNK_BYTES,maxFileBytes:MAX_ATTACHMENT,maxFiles:8}}};}if(parsed.searchParams.has('id')){await context(scope);const row=store.row(scope,parsed.searchParams.get('id'));const version=parsed.searchParams.has('version')?Number(parsed.searchParams.get('version')):undefined;return {topic:'canvas',scope,revision:store.revision(scope),data:{canvasArtifacts:[store.descriptor(row,version)]}};}return snapshot(scope,{limit:parsed.searchParams.has('limit')?Number(parsed.searchParams.get('limit')):50,cursor:parsed.searchParams.get('cursor')||undefined});};
 const action=async(request,caller={})=>{if(request.topic==='attachments')return attachments.action(request);if(request.topic!=='canvas'||!operations.includes(request.operation)||request.version!==1)fail('Canvas capability/version unavailable',-32601);const ctx=await context(request.channel),args=request.args||{},before=store.revision(ctx.session);if(args.sessionId&&args.sessionId!==ctx.session)fail('Canvas action cannot change conversation scope',-32009);let result;
  if(apps.operations.includes(request.operation))result=apps.action(ctx,request.operation,args,caller);
  else if(request.operation==='canvas.show'||request.operation==='canvas.openFile'){const value=await definition(ctx,request.operation==='canvas.openFile'?{...args,kind:args.kind||'auto'}:args);result={artifact:store.save(ctx,value.definition,value.body)};}
  else if(request.operation==='canvas.versions.inspect'){const row=store.row(ctx.session,args.id);result={artifact:store.descriptor(row,args.version),...(args.includeSource?{body:store.body(ctx.session,args.id,args.version)}:{})};}
  else if(request.operation==='canvas.reference'){const row=store.row(ctx.session,args.id);result={reference:bodyURI(row.id,args.version??row.revision,ctx.session)};}
  else if(request.operation==='canvas.event'){result=store.event(ctx.session,args.id,{surfaceId:args.surfaceId,componentId:args.componentId,name:args.name,value:args.value,createdAt:now()});}
  else {const row=store.row(ctx.session,args.id);if(apps.has(row.id)||originalDescriptor(row).external)fail('Use the owning capability to preserve its resource contract',-32009);if(!integer(args.expectedRevision,Number.MAX_SAFE_INTEGER))fail('expectedRevision is required');const version=request.operation==='canvas.versions.restore'?args.version:row.revision;if(!integer(version,Number.MAX_SAFE_INTEGER))fail('version is required');const saved=store.descriptor(row,version),body=store.body(ctx.session,args.id,version);const def=Object.fromEntries(['kind','title','path','workspacePath','url'].filter(k=>saved[k]!==undefined).map(k=>[k,saved[k]]));if(request.operation==='canvas.versions.revise'){if(args.content!==undefined){if(typeof args.content!=='string')fail('Content must be text');body.content=args.content;}if(args.surface!==undefined)body.surface=args.surface;if(args.title!==undefined)def.title=bounded(args.title,'title',200);}result={artifact:store.save(ctx,def,body,{id:row.id,expectedRevision:args.expectedRevision,force:true})};}
  const changed=store.revision(ctx.session)!==before;if(changed)onChanged('canvas',ctx.session);return {accepted:true,result,invalidate:changed?['canvas']:[]};};
 const resolveTarget=async params=>{const uri=new URL(params.uri),match=uri.pathname.match(/^\/([^/]+)\/versions\/(\d+|latest)$/);if(uri.hostname!=='artifact'||!match)fail('Unknown Canvas resource',-32008);const ctx=await context(uri.searchParams.get('session')),row=store.row(ctx.session,match[1]),version=match[2]==='latest'?row.revision:Number(match[2]);return {ctx,row,version,mutable:match[2]==='latest'};};
 const resourceProvider={scheme:'amplifier-canvas',
  async read(params){const {ctx,row,version}=await resolveTarget(params);const value=apps.has(row.id)?apps.body(ctx.session,row.id,version,new URL(params.uri).searchParams.get('stateRevision')):store.body(ctx.session,row.id,version);const bytes=Buffer.from(JSON.stringify(value));return {data:bytes.toString(params.encoding==='base64'?'base64':'utf8'),encoding:params.encoding==='base64'?'base64':'utf-8',contentType:'application/json'};},
  async resolve(params){const {row,version}=await resolveTarget(params);let identity=row.id+':'+version;
   if(apps.has(row.id)){const saved=apps.snapshotRow(row.id,version,new URL(params.uri).searchParams.get('stateRevision'));identity+=':'+saved.state_revision;}
   else store.descriptor(row,version);
   return {uri:params.uri,type:'file',contentType:'application/json',etag:JSON.stringify(identity),...(!apps.has(row.id)?{mtime:new Date(row.modified*1000).toISOString()}:{}),ctime:new Date(row.created*1000).toISOString()};},
  async write(params){const {ctx,row,version,mutable}=await resolveTarget(params);if(apps.has(row.id)||originalDescriptor(row).external)fail('Use the owning capability to preserve its resource contract',-32009);if(!mutable)fail('Saved versions are immutable; write the advertised latest URI',-32009);if(params.createOnly)fail('Artifact already exists',-32010);if(params.ifMatch!==JSON.stringify(row.id+':'+version))fail('Artifact revision changed or ifMatch is missing',-32011);
   if(typeof params.data!=='string'||!['utf-8','base64'].includes(params.encoding))fail('Invalid encoded resource body');if(params.encoding==='base64'&&!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(params.data))fail('Invalid base64 body');
   const prior=Buffer.from(JSON.stringify(store.body(ctx.session,row.id,version))),incoming=Buffer.from(params.data,params.encoding==='base64'?'base64':'utf8'),position=params.position??0,mode=params.mode??'truncate';if(!Number.isSafeInteger(position)||position<0||position>prior.length||!['truncate','append','insert'].includes(mode))fail('Invalid write mode or byte offset');
   const offset=mode==='append'?prior.length-position:position,bytes=mode==='truncate'?Buffer.concat([prior.subarray(0,offset),incoming]):Buffer.concat([prior.subarray(0,offset),incoming,prior.subarray(offset)]);if(bytes.length>MAX_BODY)fail('Artifact body exceeds 6 MiB');let body;try{body=JSON.parse(bytes.toString('utf8'));}catch{fail('An artifact body must remain valid JSON');}if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['content','surface'].includes(k))||(body.content!==undefined&&typeof body.content!=='string'))fail('Invalid editable artifact body');
   const descriptor=store.descriptor(row),definition=Object.fromEntries(['kind','title','path','workspacePath','url'].filter(k=>descriptor[k]!==undefined).map(k=>[k,descriptor[k]]));store.save(ctx,definition,body,{id:row.id,expectedRevision:version,force:true});onChanged('canvas',ctx.session);return {};
  }};
 const registerExternal=async(authority,descriptor)=>{
  const ctx=await context(authority.session);if(ctx.workingDirectory!==authority.workingDirectory)fail('External artifact workspace authority changed',-32009);
  if(descriptor.sessionId!==ctx.session||descriptor.kind!=='mcp-app'||typeof descriptor.id!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(descriptor.id))fail('Invalid external artifact identity');
  if(typeof descriptor.bodyUri!=='string'||new URL(descriptor.bodyUri).protocol!=='amplifier-mcp:')fail('External MCP artifact requires its owned body URI');
  const external=Object.fromEntries(['bodyUri','resourceUri','mcp','resources','providerRevision'].filter(k=>descriptor[k]!==undefined).map(k=>[k,descriptor[k]]));
  if(Buffer.byteLength(JSON.stringify(external))>8192)fail('Artifact metadata exceeds 8 KiB; put detailed bindings in selected resources');
  const existing=store.db.prepare('SELECT * FROM artifacts WHERE id=?').get(descriptor.id);
  if(existing&&existing.session!==ctx.session)fail('External artifact belongs to another conversation',-32009);
  if(existing&&originalDescriptor(existing).kind!=='mcp-app')fail('Artifact identity belongs to another provider',-32009);
  const artifact=store.save(ctx,{kind:'mcp-app',title:bounded(descriptor.title,'title',200),external},{},existing?{id:descriptor.id,expectedRevision:existing.revision}:{newId:descriptor.id});onChanged('canvas',ctx.session);return artifact;
 };
 const attachmentProvider={scheme:'amplifier-attachment',read:params=>attachments.read(params),resolve:params=>attachments.resolve(params),write:params=>attachments.write(params)};
 return {exportTransferEvidence:transfer.export,stageTransferEvidence:transfer.stage,activateTransferEvidence:transfer.activate,readTransferEvidence:transfer.read,readTransferBody:transfer.readBody,manifest,read,action,actionSchemas:{...actionSchemas,...attachmentSchemas},resourceProvider,resourceProviders:[resourceProvider,attachmentProvider],resolvePromptAttachment:(ctx,attachment,options)=>attachments.prompt(ctx,attachment,options),registerExternal,store,close:()=>{attachments.close();store.close();}};
}
