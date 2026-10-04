/** Private trusted fork binding. Existing attachment/session prompt guards stay intact. */
import {createHash,randomUUID} from 'node:crypto';
import {open,rename,chmod,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {initializeSchema} from './authoritative-schema.js';
export const FORK_ATTACHMENT_LIMITS=Object.freeze({maxItems:64,maxTotalBytes:256*1024*1024,maxFileBytes:32*1024*1024,chunkBytes:256*1024});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const forkDigest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const fail=message=>{throw Object.assign(Error(message),{code:-32602,executed:false});};
const token=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!value.includes('\0');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const session=value=>token(value)&&value.startsWith('ahp-session:/');
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
function requestValue(value){
 const r=structuredClone(value),b=r?.binding;
 if(!keys(r,['binding','projectionDigest','items'])||!keys(b,['version','commandId','engineId','source','target','throughMessageId','workReplayed'])||b.version!==1||!token(b.commandId)||!token(b.engineId)||b.workReplayed!==false||!digest(r.projectionDigest)||b.throughMessageId!==undefined&&!token(b.throughMessageId))fail('Invalid exact fork attachment binding');
 for(const scope of [b.source,b.target])if(!keys(scope,['session','nativeSessionId','historyRevision'])||!session(scope.session)||!token(scope.nativeSessionId)||!digest(scope.historyRevision))fail('Invalid fork conversation/revision');
 if(b.source.session===b.target.session||b.source.nativeSessionId===b.target.nativeSessionId)fail('Fork source and target must differ');
 if(!Array.isArray(r.items)||r.items.length>FORK_ATTACHMENT_LIMITS.maxItems)fail('Fork attachment plan exceeds 64 selected items');
 let bytes=0;const seen=new Set();
 for(const item of r.items){
  if(!keys(item,['turnId','sourceRows','targetRows','attachment'])||!token(item.turnId))fail('Invalid fork prefix item');
  for(const rows of [item.sourceRows,item.targetRows])if(!Array.isArray(rows)||!rows.length||rows.some(row=>!keys(row,['position','messageId','rowDigest','sourceDigest'])||!Number.isSafeInteger(row.position)||row.position<0||!token(row.messageId)||!/^[a-f0-9]{24}$/.test(row.rowDigest)||row.sourceDigest!==undefined&&!digest(row.sourceDigest)))fail('Invalid fork canonical anchors');
  const a=item.attachment;
  if(!keys(a,['uri','name','contentType','size','sha256'])||!token(a.uri)||!token(a.name)||!token(a.contentType)||!Number.isSafeInteger(a.size)||a.size<0||a.size>FORK_ATTACHMENT_LIMITS.maxFileBytes||!digest(a.sha256)||seen.has(a.uri))fail('Invalid or duplicate fork attachment');
  seen.add(a.uri);bytes+=a.size;
 }
 if(bytes>FORK_ATTACHMENT_LIMITS.maxTotalBytes||Buffer.byteLength(JSON.stringify(r))>2*1024*1024)fail('Fork attachment plan exceeds total bound');
 return r;
}
const existing=async path=>{try{return await lstat(path)}catch(e){if(e.code==='ENOENT')return;throw e}};
async function syncDirectory(path){const f=await open(path,constants.O_RDONLY);try{await f.sync()}finally{await f.close()}}
export class ForkAttachments{
 constructor(store,attachments,context,verify){this.store=store;this.attachments=attachments;this.db=store.db;this.context=context;this.verify=verify;this.locks=new Map();this.callers=0;
  initializeSchema(this.db,'resources',['forkAttachments'],()=>this.db.exec(`CREATE TABLE IF NOT EXISTS fork_attachment_bindings(command TEXT PRIMARY KEY,digest TEXT NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,request TEXT NOT NULL,plan TEXT NOT NULL,status TEXT NOT NULL,error TEXT,created REAL NOT NULL);CREATE INDEX IF NOT EXISTS fork_attachment_pending_source ON fork_attachment_bindings(source,status);CREATE INDEX IF NOT EXISTS fork_attachment_pending_target ON fork_attachment_bindings(target,status);`));
 }
 protected(session){return !!this.db.prepare("SELECT 1 FROM fork_attachment_bindings WHERE (source=? OR target=?) AND status!='completed' LIMIT 1").get(session,session)}
 receipt(r,d,status,plan=[]){return {owner:'unified.resources',version:1,commandId:r.binding.commandId,requestDigest:d,sourceSession:r.binding.source.session,targetSession:r.binding.target.session,status,items:status==='completed'?plan.map(p=>({sourceUri:p.sourceUri,targetUri:this.attachments.metadata(this.attachments.row(r.binding.target.session,p.targetId)).resourceUri,sha256:p.sha256,size:p.size,name:p.name,contentType:p.contentType})):[],replayed:false}}
 retain(input){
  const r=requestValue(input),d=forkDigest(r),id=r.binding.commandId;
  if(this.callers>=64)fail('Fork binding capacity reached');this.callers++;
  const execute=()=>{const previous=this.locks.get(id);if(previous)return previous.then(execute);const operation=this.run(r,d);this.locks.set(id,operation);operation.then(()=>this.locks.delete(id),()=>this.locks.delete(id));return operation};
  return execute().finally(()=>this.callers--);
 }
 async run(r,d){
  const b=r.binding,old=this.db.prepare('SELECT * FROM fork_attachment_bindings WHERE command=?').get(b.commandId);
  if(old&&old.digest!==d)fail('Original fork command reused with different binding');
  const proof=typeof this.verify==='function'?await this.verify(structuredClone(r)):null;
  if(proof?.verified!==true||proof.commandId!==b.commandId||proof.requestDigest!==d||proof.projectionDigest!==r.projectionDigest||proof.targetSession!==b.target.session)return this.receipt(r,d,'refused');
  if(old?.status==='completed'){const saved=JSON.parse(old.plan);if(saved.digest!==forkDigest({commandId:b.commandId,requestDigest:d,items:saved.items}))fail('Retained fork plan integrity changed');return this.receipt(r,d,'completed',saved.items)}
  await this.context(b.source.session);await this.context(b.target.session);
  const sources=[];
  for(const item of r.items){const a=item.attachment,u=new URL(a.uri);if(u.protocol!=='amplifier-attachment:'||u.pathname!=='/body'||u.searchParams.size!==1||u.searchParams.get('session')!==b.source.session)fail('Source attachment URI scope differs');const row=this.attachments.row(b.source.session,u.hostname);
   if(row.status!=='committed'||row.received!==row.size||row.size!==a.size||row.sha!==a.sha256||row.name!==a.name||row.mime!==a.contentType)fail('Fork source attachment is unfinished or changed');sources.push(row);
  }
  const saved=old?JSON.parse(old.plan):null;
  if(saved&&saved.digest!==forkDigest({commandId:b.commandId,requestDigest:d,items:saved.items}))fail('Retained fork plan integrity changed');
  const plan=old?saved.items:sources.map((row,i)=>({sourceId:row.id,sourceUri:r.items[i].attachment.uri,targetId:randomUUID(),name:row.name,contentType:row.mime,size:row.size,sha256:row.sha256??row.sha}));
  if(plan.length!==sources.length||plan.some((p,i)=>p.sourceId!==sources[i].id||p.sourceUri!==r.items[i].attachment.uri||p.name!==sources[i].name||p.contentType!==sources[i].mime||p.size!==sources[i].size||p.sha256!==sources[i].sha||!/^[-a-f0-9]{36}$/.test(p.targetId)||p.targetId===p.sourceId)||new Set(plan.map(p=>p.targetId)).size!==plan.length)fail('Retained fork plan binding differs');
  if(!old)this.db.prepare('INSERT INTO fork_attachment_bindings VALUES(?,?,?,?,?,?,?,NULL,?)').run(b.commandId,d,b.source.session,b.target.session,JSON.stringify(r),JSON.stringify({items:plan,digest:forkDigest({commandId:b.commandId,requestDigest:d,items:plan})}),'pending',Date.now()/1000);
  try{
   // Full exact plan and original target IDs are durable before the first byte copy.
   for(let i=0;i<plan.length;i++)await this.copy(sources[i],plan[i]);
   this.attachments.check();this.db.exec('BEGIN IMMEDIATE');
   try{for(const p of plan){const request='fork:'+b.commandId+':'+p.targetId,fp=forkDigest([p.name,p.contentType,p.size,p.sha256]);this.db.prepare('INSERT INTO attachments(id,session,request,fingerprint,name,mime,size,sha,received,status,created,committed_request) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(p.targetId,b.target.session,request,fp,p.name,p.contentType,p.size,p.sha256,p.size,'committed',Date.now()/1000,b.commandId);}if(plan.length)this.attachments.touch(b.target.session);this.db.prepare("UPDATE fork_attachment_bindings SET status='completed',error=NULL WHERE command=?").run(b.commandId);this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}
  }catch(e){this.db.prepare("UPDATE fork_attachment_bindings SET status='unknown',error=? WHERE command=?").run(String(e.message).slice(0,2048),b.commandId);return this.receipt(r,d,'unknown')}
  return this.receipt(r,d,'completed',plan);
 }
 async copy(row,p){
  this.attachments.check();const source=await open(this.attachments.path(row.id),constants.O_RDONLY|constants.O_NOFOLLOW),final=this.attachments.path(p.targetId),stage=final+'.fork-staged';let dest;
  try{
   const before=await source.stat();if(!before.isFile()||before.size!==p.size)fail('Committed fork source size changed');const complete=await existing(final),partial=await existing(stage);
   const saved=complete||partial;if(saved&&(!saved.isFile()||saved.isSymbolicLink()||saved.size>p.size||complete&&saved.size!==p.size))fail('Retained fork target bytes changed');
   dest=await open(complete?final:stage,complete||partial?.size===p.size?constants.O_RDONLY|constants.O_NOFOLLOW:constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
   const opened=await dest.stat();if(!opened.isFile()||opened.size!==(saved?.size??0))fail('Retained fork target changed while opening');
   const digest=createHash('sha256'),buffer=Buffer.alloc(FORK_ATTACHMENT_LIMITS.chunkBytes),comparison=Buffer.alloc(FORK_ATTACHMENT_LIMITS.chunkBytes);let position=0,retained=saved?.size??0;
   while(position<p.size){this.attachments.check();const count=Math.min(buffer.length,p.size-position),{bytesRead}=await source.read(buffer,0,count,position);if(bytesRead!==count)fail('Committed fork source body changed');digest.update(buffer.subarray(0,count));
    const kept=Math.min(count,Math.max(0,retained-position));if(kept){const read=await dest.read(comparison,0,kept,position);if(read.bytesRead!==kept||!buffer.subarray(0,kept).equals(comparison.subarray(0,kept)))fail('Retained fork target prefix changed')}
    let written=kept;while(written<count){const result=await dest.write(buffer,written,count-written,position+written);if(!result.bytesWritten)fail('Fork copy could not progress');written+=result.bytesWritten}position+=count;
   }
   const after=await source.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||digest.digest('hex')!==p.sha256)fail('Committed fork source integrity changed');
   if(!complete){await dest.sync();await dest.close();dest=null;await chmod(stage,0o400);await rename(stage,final);await syncDirectory(this.attachments.directory)}
  }finally{await dest?.close();await source.close()}
 }
}
