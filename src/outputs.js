/** Immutable outputs belong to Resources. No remote publishing or execution occurs here. */
import Ajv from 'ajv';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,openSync,closeSync,writeFileSync,fsyncSync,renameSync,readFileSync,existsSync,statSync,constants,fstatSync,readSync} from 'node:fs';
import {join} from 'node:path';
import {initializeSchema} from './authoritative-schema.js';
import {outputSchemas} from './output-schemas.js';
import {snapshotFile,pngInfo,MAX_OUTPUT_BYTES} from './output-files.js';
import {gitSnapshot,gitAnchors} from './output-git.js';
import {imageReceipt} from './output-image.js';
const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
const sha=value=>createHash('sha256').update(value).digest('hex');
const refuse=(message,code=-32602)=>{throw Object.assign(Error(message),{code});};
const validators=Object.fromEntries(Object.entries(outputSchemas).map(([name,value])=>[name,new Ajv({strict:false}).compile(value.inputSchema)]));
export const outputReads=['outputs.list','outputs.read','outputs.image','outputs.images'];
export class Outputs{
 constructor(store,context,{withSessionWorkspace,verifyOutputMessage,onChanged=()=>{}}={}){
  this.store=store;this.db=store.db;this.context=context;this.withWorkspace=withSessionWorkspace;this.verifyMessage=verifyOutputMessage;this.changed=onChanged;this.queue=Promise.resolve();this.pending=0;
  this.directory=join(store.directory,'outputs');mkdirSync(this.directory,{recursive:true,mode:0o700});
  initializeSchema(this.db,'resources',['outputs'],()=>this.db.exec(`CREATE TABLE IF NOT EXISTS output_records(id TEXT PRIMARY KEY,session TEXT,created REAL,value TEXT);CREATE INDEX IF NOT EXISTS output_session ON output_records(session,created DESC,id);CREATE TABLE IF NOT EXISTS output_receipts(id TEXT PRIMARY KEY,fingerprint TEXT,value TEXT);CREATE TABLE IF NOT EXISTS output_comments(id TEXT PRIMARY KEY,output TEXT,value TEXT);CREATE INDEX IF NOT EXISTS output_comments_identity ON output_comments(output);`));
 }
 record(session,id){const row=this.db.prepare('SELECT value FROM output_records WHERE session=? AND id=?').get(session,id);if(!row)refuse('Saved output is unavailable in this conversation.',-32008);return JSON.parse(row.value);}
 content(record){if(!record.sha256)return null;if(!/^[a-f0-9]{64}$/.test(record.sha256))refuse('Invalid saved output digest.',-32603);const fd=this.openBody(record);try{const data=readFileSync(fd);if(data.length!==record.bytes||sha(data)!==record.sha256)refuse('Saved output integrity changed; original records retained.',-32603);return data;}finally{closeSync(fd);}}
 openBody(record){const fd=openSync(join(this.directory,record.sha256+'.blob'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const info=fstatSync(fd);if(!info.isFile()||info.size!==record.bytes||info.size>MAX_OUTPUT_BYTES)refuse('Saved output integrity changed; original records retained.',-32603);return fd;}catch(error){closeSync(fd);throw error;}}
 uri(record){const uri=new URL('amplifier-output://saved/'+record.id);uri.searchParams.set('session',record.sessionId);uri.searchParams.set('sha256',record.sha256);return uri.href;}
 descriptor(record){
  // Main saved exact bodies before it added versionEvidence. Project their
  // proven snapshot identity without rewriting original migration metadata.
  const snapshot=record.versionEvidence===undefined&&/^[a-f0-9]{64}$/.test(record.sha256??'')&&Number.isSafeInteger(record.bytes)&&record.bytes>=0;
  return {...record,...(snapshot?{versionEvidence:'snapshot'}:{}),...(record.sha256&&record.sessionId?{resourceUri:this.uri(record)}:{})};
 }
 list(session,args={}){const offset=args.offset??0,limit=args.limit??20,rows=this.db.prepare(`SELECT value FROM output_records WHERE session=? ${args.includeUnlinked?'':"AND json_extract(value,'$.linked')=1"} ORDER BY created DESC,id LIMIT ? OFFSET ?`).all(session,limit+1,offset);return {items:rows.slice(0,limit).map(row=>this.descriptor(JSON.parse(row.value))),nextOffset:rows.length>limit?offset+limit:null};}
 read(session,args){const record=this.record(session,args.id),data=this.content(record),start=args.commentOffset??0,count=args.commentLimit??5,comments=this.db.prepare('SELECT value FROM output_comments WHERE output=? ORDER BY rowid LIMIT ? OFFSET ?').all(record.id,count+1,start),result={...this.descriptor(record),comments:comments.slice(0,count).map(row=>JSON.parse(row.value)),nextCommentOffset:comments.length>count?start+count:null};
  if(data){try{const text=new TextDecoder('utf-8',{fatal:true}).decode(data),offset=args.offset??0,limit=args.limit??4000;result.text=text.slice(offset,offset+limit);result.offset=offset;result.nextOffset=offset+limit<text.length?offset+limit:null;}catch{result.binary=true;}}return result;
 }
 image(session,args){const record=this.record(session,args.id);if(!['file','dataset'].includes(record.kind)||record.sha256!==args.sha256)refuse('Choose the exact saved output and content hash.',-32011);const data=this.content(record);if(!data)refuse('This output has no saved image.');const info=pngInfo(data);return {id:record.id,title:record.title,sha256:record.sha256,...info,mimeType:'image/png',bytes:data.length,resourceUri:this.uri(record),evidence:'immutable-output-snapshot',untrustedData:true,imageDelivery:'Read the scoped image resource to view its pixels; metadata alone is not visual evidence.'};}
 /** Trusted Native request adapter only; pixels never enter ordinary tool JSON. */
 async pixels(session,args,pair=false){
  const operation=pair?'outputs.images':'outputs.image';
  const result=(await this.action({topic:'outputs',version:1,channel:session,operation,args:{...args,sessionId:session}})).result;
  const image=row=>({...row,_image:this.content(this.record(session,row.id)).toString('base64')});
  return pair?{...result,images:result.images.map(image)}:image(result);
 }
 async action(request,caller){const {operation,args={}}=request;if(request.version!==1||request.topic!=='outputs'||!validators[operation])refuse('Output capability/version unavailable.',-32601);if(!validators[operation](args)||args.sessionId!==request.channel)refuse('Invalid or cross-conversation output request.');
  await this.context(request.channel);
  if(outputReads.includes(operation)){let result;if(operation==='outputs.list')result=this.list(request.channel,args);else if(operation==='outputs.read')result=this.read(request.channel,args);else if(operation==='outputs.image')result=this.image(request.channel,args);else{if(args.images[0].id===args.images[1].id||args.images[0].sha256===args.images[1].sha256)refuse('Choose two distinct saved images.');const images=args.images.map(value=>this.image(request.channel,value));if(images.reduce((n,v)=>n+v.bytes,0)>MAX_OUTPUT_BYTES)refuse('Choose images up to 8 MiB combined.');result={images,bytes:images.reduce((n,v)=>n+v.bytes,0),limits:{images:2,maxBytes:MAX_OUTPUT_BYTES,maxSide:4096},imageDelivery:'Read both scoped image resources for visual comparison.'};}return {accepted:true,result};}
  if(this.pending>=64)refuse('Output saves are busy. Try again when they finish.',-32000);this.pending++;
  const pending=this.queue.then(()=>this.mutate(request,caller));this.queue=pending.catch(()=>{});try{return await pending;}finally{this.pending--;}
 }
 previous(id,fingerprint){const row=this.db.prepare('SELECT * FROM output_receipts WHERE id=?').get(id);if(!row)return;if(row.fingerprint!==fingerprint)refuse('This saved request belongs to different output content or origin.',-32011);return {...JSON.parse(row.value),duplicate:true};}
 /** Called within Canvas's transaction for a verified completed image result. */
 captureImage(ctx,definition,body,id,revision,caller={},createdAt=Date.now()/1000){
  if(!definition.imageResult)return;
  const prefix='data:image/png;base64,';if(typeof body.content!=='string'||!body.content.startsWith(prefix))refuse('Generated image must contain saved PNG bytes.');
  // Canvas already owns validation and rendering of its saved image. Capture
  // those exact bytes even when the bounded model-image decoder cannot read
  // that PNG variant; saving must not break an existing Canvas publication.
  const data=Buffer.from(body.content.slice(prefix.length),'base64'),digest=sha(data);
  if(data.length>MAX_OUTPUT_BYTES||digest!==definition.imageResult.sha256)refuse('Generated image bytes differ from the completed result.');
  const command='canvas-image:'+sha(canonical([ctx.session,definition.imageResult.toolCallId,definition.imageResult.requestId])),fingerprint=sha(canonical([digest,definition.path]));
  const prior=this.previous(command,fingerprint);if(prior)return prior;
  if(this.db.prepare('SELECT count(*) n FROM output_records').get().n>=10000)refuse('Saved outputs have reached their local limit.');
  this.put(data,digest);
  const value={id:randomUUID(),sessionId:ctx.session,kind:'file',title:definition.title,path:definition.path,filename:definition.path.split('/').at(-1),sha256:digest,bytes:data.length,canvasId:id,canvasVersion:revision,imageResult:definition.imageResult,origin:{source:['ui','agent','system'].includes(caller.origin)?caller.origin:'unknown',messageId:ctx.activeTurnId?ctx.activeTurnId+':input':null,turnId:ctx.activeTurnId??null},parentId:null,evidenceIds:[],versionEvidence:'snapshot',version:1,revision:1,linked:true,createdAt};
  this.db.prepare('INSERT INTO output_records VALUES(?,?,?,?)').run(value.id,ctx.session,value.createdAt,canonical(value));
  this.db.prepare('INSERT INTO output_receipts VALUES(?,?,?)').run(command,fingerprint,canonical(value));return value;
 }
 async mutate(request,caller={}){
  const {operation,args,commandId,channel:session}=request;if(typeof commandId!=='string'||!commandId||commandId.length>256)refuse('An exact output save command identity is required.');
  const source=['ui','agent','system'].includes(caller.origin)?caller.origin:'unknown',fingerprint=sha(canonical([operation,args,source])),previous=this.previous(commandId,fingerprint);if(previous)return {accepted:true,result:previous};
  const ctx=await this.context(session);if(ctx.relocationFence||ctx.transferFence)refuse('Conversation movement is still being resolved.',-32011);
  if(!this.withWorkspace)refuse('The host workspace guard is unavailable; nothing was saved.',-32601);
  return this.withWorkspace(session,{expectedExecutionRevision:ctx.executionRevision,expectedDirectory:ctx.executionDirectory??ctx.workingDirectory},async workspace=>{
   const prior=this.previous(commandId,fingerprint);if(prior)return {accepted:true,result:prior};
   if(args.messageId&&(!this.verifyMessage||!await this.verifyMessage(session,args.messageId,args.messageTurnId)))refuse('Choose an original message visible in this conversation.');
   const parent=args.parentId?this.record(session,args.parentId):null;for(const id of args.evidenceIds??[])this.record(session,id);
   let data=null,value={kind:operation==='outputs.write'?'writing':operation==='outputs.review'?'git_review':operation==='outputs.attachImage'?'file':args.kind,title:args.title||'Saved Git review',origin:{source,messageId:args.messageId??null,...(args.messageTurnId?{turnId:args.messageTurnId}:{})},parentId:args.parentId??null,evidenceIds:args.evidenceIds??[]};
   if(operation==='outputs.write'){if(!args.content.trim())refuse('Writing content is empty.');data=Buffer.from(args.content);Object.assign(value,{variant:args.variant,...(args.subject!==undefined?{subject:args.subject}:{}),filename:'writing.md',versionEvidence:'snapshot'});}
   else if(operation==='outputs.review'){const captured=await gitSnapshot(workspace.executionDirectory,args.mode,args.base,args.path);data=captured.data;Object.assign(value,{review:captured.review,filename:'review.diff',versionEvidence:'snapshot'});}
   else if(operation==='outputs.attachImage'){
    const captured=imageReceipt(workspace.executionDirectory,args.receiptPath),receipt=captured.receipt;data=captured.data;
    if(receipt.operation==='edit'&&(!parent||parent.kind!=='file'||parent.sha256!==receipt.inputs[0].sha256))refuse('Attach the exact original image and supply its parentId for this edit.');
    if(receipt.operation==='generate'&&parent)refuse('A generated image has no edit parent.');
    Object.assign(value,{path:captured.path,filename:captured.filename,versionEvidence:'snapshot',imageGeneration:receipt});
   }
   else if(operation==='outputs.attach'){
    const field=['file','dataset'].includes(args.kind)?'path':args.kind==='canvas'?'canvasId':'url';if(!args[field]||['path','canvasId','url'].some(key=>key!==field&&args[key]!==undefined))refuse('Provide exactly the location matching this output type.');
    if(field==='path'){const captured=snapshotFile(workspace.executionDirectory,args.path);data=captured.data;Object.assign(value,{path:captured.path,filename:captured.filename,versionEvidence:'snapshot'});}
    else if(field==='canvasId'){const row=this.store.row(session,args.canvasId),artifact=this.store.descriptor(row);if(artifact.external||artifact.kind==='mcp-app'||artifact.kind==='settings')refuse('This live resource must remain with its owning capability.');data=Buffer.from(canonical(this.store.body(session,row.id,row.revision)));Object.assign(value,{canvasId:row.id,canvasKind:artifact.kind,canvasVersion:row.revision,filename:'canvas.json',versionEvidence:'snapshot'});}
    else{let url;try{url=new URL(args.url);}catch{refuse('Choose a valid HTTP(S) reference.');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||/[\x00-\x1f\x7f]/.test(args.url))refuse('Choose an HTTP(S) link without credentials or control characters.');Object.assign(value,{url:args.url,externalVersion:args.version??null,versionEvidence:args.version?'user_supplied_reference':'unversioned_reference'});}
   }
   if(data){if(data.length>MAX_OUTPUT_BYTES)refuse('Saved output exceeds 8 MiB.');const digest=sha(data);if(args.expectedSha256&&args.expectedSha256!==digest)refuse('File contents changed from the expected version.',-32011);Object.assign(value,{sha256:digest,bytes:data.length});this.put(data,digest);}
   let result;
   const commit=()=>{
    if(['outputs.unlink','outputs.relink'].includes(operation)){result=this.record(session,args.id);if(result.revision!==args.expectedRevision)refuse('Output link changed. Refresh before saving.',-32011);result={...result,linked:operation==='outputs.relink',revision:result.revision+1};this.db.prepare('UPDATE output_records SET value=? WHERE id=?').run(canonical(result),result.id);}
    else if(operation==='outputs.comment'){const record=this.record(session,args.id),location=Object.fromEntries(['path','side','line'].filter(key=>args[key]!==undefined).map(key=>[key,args[key]]));if(Object.keys(location).length&&(Object.keys(location).length!==3||record.kind!=='git_review'||!gitAnchors(this.content(record).toString('utf8')).has(JSON.stringify([args.path,args.side,args.line]))))refuse('Choose a line in this exact saved diff.');if(!args.body.trim())refuse('Review note is empty.');if(this.db.prepare('SELECT count(*) n FROM output_comments WHERE output=?').get(record.id).n>=200)refuse('This output has reached its review note limit.');result={id:randomUUID(),outputId:record.id,body:args.body,...location,source,sha256:record.sha256??null,createdAt:Date.now()/1000,externalPosted:false};this.db.prepare('INSERT INTO output_comments VALUES(?,?,?)').run(result.id,record.id,canonical(result));}
    else{if(this.db.prepare('SELECT count(*) n FROM output_records').get().n>=10000)refuse('Saved outputs have reached their local limit.');result={...value,id:randomUUID(),sessionId:session,createdAt:Date.now()/1000,revision:1,version:(parent?.version??0)+1,linked:true};this.db.prepare('INSERT INTO output_records VALUES(?,?,?,?)').run(result.id,session,result.createdAt,canonical(result));}
    this.store.touch(session);result=this.descriptor(result);this.db.prepare('INSERT INTO output_receipts VALUES(?,?,?)').run(commandId,fingerprint,canonical(result));
   };
   if(operation==='outputs.attachImage'){
    // Canvas and output relationships commit together; a lost reply is resolved
    // by the exact output receipt, without duplicating publications or spending.
    const existing=this.db.prepare("SELECT value FROM output_records WHERE session=? AND json_extract(value,'$.imageGeneration.receiptSha256')=? AND json_extract(value,'$.origin.messageId') IS ? AND json_extract(value,'$.linked')=1 LIMIT 1").get(session,value.imageGeneration.receiptSha256,args.messageId??null);
    if(existing){result=this.descriptor(JSON.parse(existing.value));this.db.prepare('INSERT INTO output_receipts VALUES(?,?,?)').run(commandId,fingerprint,canonical(result));}
    else this.store.save({...workspace,session,workingDirectory:workspace.executionDirectory,activeTurnId:args.messageId??null},{kind:'image',title:value.title},{content:'data:image/png;base64,'+data.toString('base64')},{newId:randomUUID(),onCommit:(id,revision)=>{Object.assign(value,{canvasId:id,canvasVersion:revision});commit();}});
    this.changed('canvas',session);
   }else{
    this.db.exec('BEGIN IMMEDIATE');try{commit();this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
   }
   this.changed('outputs',session);return {accepted:true,result};
  });
 }
 put(data,digest=sha(data)){const path=join(this.directory,digest+'.blob');if(existsSync(path)){if(!this.content({sha256:digest,bytes:data.length}).equals(data))refuse('Saved output body conflicts; original retained.',-32603);return;}const tmp=path+'.'+randomUUID()+'.tmp',fd=openSync(tmp,'wx',0o600);try{writeFileSync(fd,data);fsyncSync(fd);}finally{closeSync(fd);}renameSync(tmp,path);const dir=openSync(this.directory,'r');try{fsyncSync(dir);}finally{closeSync(dir);}}
 async resource(params,read){const uri=new URL(params.uri);if(uri.protocol!=='amplifier-output:'||uri.hostname!=='saved'||uri.hash||uri.username||uri.password||uri.port||[...uri.searchParams.keys()].some(k=>!['session','sha256','offset','limit'].includes(k)))refuse('Invalid saved output resource.');const session=uri.searchParams.get('session');await this.context(session);const record=this.record(session,uri.pathname.slice(1));if(record.sha256!==uri.searchParams.get('sha256'))refuse('Saved output digest differs.',-32011);if(!record.sha256)refuse('This output is only an external reference.');const fd=this.openBody(record);try{if(!read)return {uri:params.uri,type:'file',size:record.bytes,contentType:'application/octet-stream',etag:JSON.stringify('sha256:'+record.sha256)};const offset=Number(uri.searchParams.get('offset')??0),limit=Number(uri.searchParams.get('limit')??262144);if(params.encoding!=='base64'||!Number.isSafeInteger(offset)||offset<0||offset>record.bytes||!Number.isSafeInteger(limit)||limit<1||limit>262144)refuse('Read bounded base64 byte pages.');const buffer=Buffer.alloc(Math.min(limit,record.bytes-offset));let count=0;while(count<buffer.length){const n=readSync(fd,buffer,count,buffer.length-count,offset+count);if(!n)refuse('Saved output ended early.',-32603);count+=n;}return {encoding:'base64',contentType:'application/octet-stream',data:buffer.toString('base64')};}finally{closeSync(fd);}}
}
