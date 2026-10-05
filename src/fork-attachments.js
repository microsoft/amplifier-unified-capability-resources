/** Trusted Native fork originals; bytes and grants stay in the Resources owner. */
import {createHash} from 'node:crypto';
import {open,rename,chmod,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {initializeSchema} from './authoritative-schema.js';
import {CHUNK_BYTES,MAX_ATTACHMENT} from './attachments.js';

export const FORK_ATTACHMENT_LIMITS=Object.freeze({version:2,maxFileBytes:MAX_ATTACHMENT,chunkBytes:CHUNK_BYTES,maxRequestBytes:8192,maxProofBytes:32768,maxCallers:64});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const forkDigest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const fail=message=>{throw Object.assign(Error(message),{code:-32602,executed:false});};
const unavailable=message=>{throw Object.assign(Error(message),{code:-32009});};
const token=(value,max=512)=>typeof value==='string'&&value.length>0&&value.length<=max&&!value.includes('\0');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const session=value=>token(value)&&value.startsWith('ahp-session:/');
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
const equal=(a,b)=>forkDigest(a)===forkDigest(b);
function occurrence(value){
 const row=value?.row;
 return keys(value,['row','blockIndex'])&&Number.isSafeInteger(value.blockIndex)&&value.blockIndex>=0&&
  keys(row,['sessionId','messageId','position','historyEpoch'])&&token(row.sessionId)&&token(row.messageId)&&
  Number.isSafeInteger(row.position)&&row.position>=0&&(row.historyEpoch===null||token(row.historyEpoch));
}
function requestValue(input){
 if(!keys(input,['version','commandId','target'])||input.version!==2||!token(input.commandId)||!occurrence(input.target)||Buffer.byteLength(JSON.stringify(input))>FORK_ATTACHMENT_LIMITS.maxRequestBytes)fail('Invalid v2 original attachment occurrence');
 return structuredClone(input);
}
function originalReference(value){
 if(!keys(value,['owner','id'])||value.owner!=='resources'||!token(value.id,4096))fail('Expected an original Resources attachment reference');
 let uri;try{uri=new URL(value.id)}catch{fail('Invalid original Resources URI')}
 if(uri.protocol!=='amplifier-attachment:'||uri.pathname!=='/body'||!/^[-a-f0-9]{36}$/.test(uri.hostname)||uri.username||uri.password||uri.port||uri.hash||uri.searchParams.size!==1||!session(uri.searchParams.get('session')))fail('Invalid original Resources URI');
 return uri;
}
function verifiedValue(value,request){
 if(!keys(value,['version','commandId','authority','sourceOccurrence','targetOccurrence','card','disposition','sourceHostSession','targetHostSession','engineId'])||value.version!==2||value.commandId!==request.commandId||!occurrence(value.sourceOccurrence)||!occurrence(value.targetOccurrence)||!equal(value.targetOccurrence,request.target)||!['retained','history-only'].includes(value.disposition)||!session(value.sourceHostSession)||!session(value.targetHostSession)||value.sourceHostSession===value.targetHostSession||!token(value.engineId)||Buffer.byteLength(JSON.stringify(value))>FORK_ATTACHMENT_LIMITS.maxProofBytes)fail('Original attachment occurrence was not verified');
 const a=value.authority,c=value.card;
 if(!keys(a,['commandId','status','source','target','creationConfirmed','preservedSource','workReplayed'])||a.commandId!==request.commandId||a.status!=='completed'||a.creationConfirmed!==true||a.preservedSource!==true||a.workReplayed!==false||!keys(a.source,['sessionId','historyRevision','throughMessageId'])||!keys(a.target,['sessionId','creationHistoryRevision'])||!token(a.source.sessionId)||!token(a.target.sessionId)||a.source.sessionId===a.target.sessionId||!token(a.source.historyRevision)||!token(a.target.creationHistoryRevision)||a.source.throughMessageId!==undefined&&!token(a.source.throughMessageId)||a.source.sessionId!==value.sourceOccurrence.row.sessionId||a.target.sessionId!==value.targetOccurrence.row.sessionId)fail('A completed original Native fork receipt is required');
 if(!keys(c,['type','reference','name','mimeType','size','sha256'])||c.type!=='attachment'||!token(c.name,255)||!token(c.mimeType,255)||c.size!==undefined&&(!Number.isSafeInteger(c.size)||c.size<0||c.size>MAX_ATTACHMENT)||c.sha256!==undefined&&!digest(c.sha256))fail('Invalid verified original card');
 originalReference(c.reference);
 return {...structuredClone(value),card:{...structuredClone(c),reference:{owner:'resources',id:c.reference.id}}};
}
const existing=async path=>{try{return await lstat(path)}catch(e){if(e.code==='ENOENT')return;throw e}};
async function syncDirectory(path){const f=await open(path,constants.O_RDONLY);try{await f.sync()}finally{await f.close()}}
const table='fork_attachment_grants_v2';
const targetId=key=>`${key.slice(0,8)}-${key.slice(8,12)}-${key.slice(12,16)}-${key.slice(16,20)}-${key.slice(20,32)}`;
export class ForkAttachments{
 constructor(store,attachments,context,verify){this.store=store;this.attachments=attachments;this.db=store.db;this.context=context;this.verify=verify;this.locks=new Map();this.callers=0;}
 has(name=table){return !!this.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name)}
 enroll(){initializeSchema(this.db,'resources',['forkOriginalsV2'],()=>this.db.exec(`
  CREATE TABLE IF NOT EXISTS fork_attachment_grants_v2(key TEXT PRIMARY KEY,command TEXT NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,reference TEXT NOT NULL,binding TEXT NOT NULL,plan TEXT NOT NULL,status TEXT NOT NULL,error TEXT,created REAL NOT NULL,UNIQUE(target,reference));
  CREATE INDEX IF NOT EXISTS fork_original_source ON fork_attachment_grants_v2(source,status);
  CREATE INDEX IF NOT EXISTS fork_original_target ON fork_attachment_grants_v2(target,status);`));}
 protected(session){
  return (this.has()&&!!this.db.prepare("SELECT 1 FROM fork_attachment_grants_v2 WHERE (source=? OR target=?) AND status!='completed' LIMIT 1").get(session,session))||
   (this.has('fork_attachment_bindings')&&!!this.db.prepare("SELECT 1 FROM fork_attachment_bindings WHERE (source=? OR target=?) AND status!='completed' LIMIT 1").get(session,session));
 }
 saved(row){
  const binding=JSON.parse(row.binding),saved=JSON.parse(row.plan),p=saved.item;
  if(!binding||row.key!==forkDigest([2,row.command,row.target,row.reference])||binding.commandId!==row.command||binding.sourceHostSession!==row.source||binding.targetHostSession!==row.target||JSON.stringify(binding.originalReference)!==row.reference||saved.digest!==forkDigest({key:row.key,binding,item:p})||!p||p.targetId!==targetId(row.key)||!/^[-a-f0-9]{36}$/.test(p.sourceId)||!token(p.name,255)||!token(p.contentType,255)||!Number.isSafeInteger(p.size)||p.size<0||p.size>MAX_ATTACHMENT||!digest(p.sha256)||!['pending','unknown','completed','refused'].includes(row.status))unavailable('Retained original grant integrity differs');
  return {binding,plan:p};
 }
 receipt(row){
  const {binding,plan}=this.saved(row);
  let accessUri;
  if(row.status==='completed'){
   const target=this.attachments.row(row.target,plan.targetId);this.match(target,plan,unavailable);
   accessUri=this.attachments.metadata(target).resourceUri;
  }
  return {version:2,commandId:row.command,targetHostSession:row.target,originalReference:structuredClone(binding.originalReference),status:row.status,...(accessUri?{accessUri}:{}),replayed:false};
 }
 async resolve(targetHostSession,reference){
  if(!session(targetHostSession))fail('An explicit target conversation is required');originalReference(reference);
  await this.context(targetHostSession);this.attachments.check();
  const row=this.has()?this.db.prepare('SELECT * FROM fork_attachment_grants_v2 WHERE target=? AND reference=?').get(targetHostSession,JSON.stringify({owner:'resources',id:reference.id})):null;
  return row?this.receipt(row):null;
 }
 match(row,plan,refuse=fail){if(!Number.isSafeInteger(plan.size)||plan.size<0||plan.size>MAX_ATTACHMENT||!digest(plan.sha256)||!token(plan.name,255)||!token(plan.contentType,255)||row.status!=='committed'||row.received!==row.size||row.size!==plan.size||row.sha!==plan.sha256||row.name!==plan.name||row.mime!==plan.contentType)refuse('Committed attachment metadata differs')}
 cardMatches(card,plan){if(plan.contentType!==card.mimeType||card.size!==undefined&&plan.size!==card.size||card.sha256!==undefined&&plan.sha256!==card.sha256)fail('Original card does not match committed source metadata')}
 async source(proof){
  const reference=proof.card.reference,uri=originalReference(reference);let row;
  if(uri.searchParams.get('session')===proof.sourceHostSession){
   row=this.attachments.row(proof.sourceHostSession,uri.hostname);
   if(this.attachments.metadata(row).resourceUri!==reference.id)fail('Original attachment URI differs');
  }else{
   // A -> B -> C follows B's committed owner grant, never A's rewritten URI.
   const grant=await this.resolve(proof.sourceHostSession,reference);
   if(grant?.status!=='completed')fail('Immediate source original grant is unavailable');
   row=this.attachments.row(proof.sourceHostSession,new URL(grant.accessUri).hostname);
  }
  const card=proof.card;
  if(row.status!=='committed'||row.received!==row.size||row.mime!==card.mimeType||card.size!==undefined&&row.size!==card.size||card.sha256!==undefined&&row.sha!==card.sha256)fail('Original card does not match committed source metadata');
  return row;
 }
 async retain(input){
  const request=requestValue(input);
  if(this.callers>=FORK_ATTACHMENT_LIMITS.maxCallers)fail('Original grant capacity reached');this.callers++;
  try{
   // Verifier reads the exact receipt and row/block on EVERY call, even for a shared grant.
   const proof=verifiedValue(typeof this.verify==='function'?await this.verify(structuredClone(request)):null,request);
   const reference=JSON.stringify(proof.card.reference),key=forkDigest([2,request.commandId,proof.targetHostSession,reference]);
   const previous=this.locks.get(key)??Promise.resolve();
   const work=previous.catch(()=>{}).then(()=>this.run(proof,key,reference));this.locks.set(key,work);
   try{return await work}finally{if(this.locks.get(key)===work)this.locks.delete(key)}
  }finally{this.callers--}
 }
 async run(proof,key,reference){
  await this.context(proof.sourceHostSession);await this.context(proof.targetHostSession);this.attachments.check();
  const binding={version:2,commandId:proof.commandId,authority:proof.authority,sourceHostSession:proof.sourceHostSession,targetHostSession:proof.targetHostSession,engineId:proof.engineId,originalReference:proof.card.reference};
  if(this.has('fork_attachment_bindings')&&this.db.prepare('SELECT 1 FROM fork_attachment_bindings WHERE command=?').get(proof.commandId))fail('Original fork command has v1 authority; explicit owner migration is required');
  const old=this.has()?this.db.prepare('SELECT * FROM fork_attachment_grants_v2 WHERE target=? AND reference=?').get(proof.targetHostSession,reference):null;
  if(old){if(old.key!==key||!equal(this.saved(old).binding,binding))fail('Original grant binding cannot change');const saved=this.saved(old).plan;this.cardMatches(proof.card,saved);if(old.status==='completed'||old.status==='refused')return this.receipt(old)}
  const source=await this.source(proof);
  const plan=old?this.saved(old).plan:{sourceId:source.id,targetId:targetId(key),name:source.name,contentType:source.mime,size:source.size,sha256:source.sha};
  this.match(source,plan);if(source.id!==plan.sourceId)fail('Immediate source bytes cannot change');
  if(!old){this.enroll();this.db.prepare('INSERT INTO fork_attachment_grants_v2 VALUES(?,?,?,?,?,?,?,?,NULL,?)').run(key,proof.commandId,proof.sourceHostSession,proof.targetHostSession,reference,JSON.stringify(binding),JSON.stringify({item:plan,digest:forkDigest({key,binding,item:plan})}),'pending',Date.now()/1000)}
  try{
   await this.copy(source,plan);
   this.attachments.check();this.db.exec('BEGIN IMMEDIATE');
   try{
    this.db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(plan.targetId,proof.targetHostSession,'fork-v2:'+key,createHash('sha256').update(JSON.stringify([plan.name,plan.contentType,plan.size,plan.sha256])).digest('hex'),plan.name,plan.contentType,plan.size,plan.sha256,plan.size,'committed',Date.now()/1000,proof.commandId);
    this.attachments.touch(proof.targetHostSession);
    this.db.prepare("UPDATE fork_attachment_grants_v2 SET status='completed',error=NULL WHERE key=?").run(key);this.db.exec('COMMIT');
   }catch(error){this.db.exec('ROLLBACK');throw error}
  }catch{
   this.db.prepare("UPDATE fork_attachment_grants_v2 SET status='unknown',error='copy-or-commit-incomplete' WHERE key=?").run(key);
  }
  return this.receipt(this.db.prepare('SELECT * FROM fork_attachment_grants_v2 WHERE key=?').get(key));
 }
 async copy(row,p){
  this.attachments.check();const source=await open(this.attachments.path(row.id),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),final=this.attachments.path(p.targetId),stage=final+'.fork-staged';let dest;
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
