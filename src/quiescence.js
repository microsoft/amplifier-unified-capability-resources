import {serviceIdentity,sameIdentity,validateServiceRelease} from './service-lifecycle.js';
const canonicalProof=value=>Array.isArray(value)?value.map(canonicalProof):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalProof(value[key])])):value;
const releaseSignature=(outcome,proof)=>JSON.stringify([outcome,canonicalProof(proof)]);
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
const keys=['ownerId','fenceId','commandId','purpose','instanceId','dataScope'];
function context(ownerId,value){const result={ownerId,...Object.fromEntries(keys.slice(1).map(key=>[key,value?.[key]]))};if(Object.values(result).some(v=>typeof v!=='string'||!v||v.length>200||/[\x00-\x1f]/.test(v))||!['recovery','distribution-update','service-stop'].includes(result.purpose))throw Error('Bounded exact resource quiescence context required');if(result.purpose==='service-stop'){result.serviceIdentity=serviceIdentity(value.serviceIdentity);if(result.serviceIdentity.instanceId!==result.instanceId||result.serviceIdentity.dataScope!==result.dataScope)throw Error('Service identity differs from resource fence');}return result;}
const same=(left,right)=>keys.every(key=>left[key]===right[key])&&(left.purpose!=='service-stop'||sameIdentity(serviceIdentity(left.serviceIdentity),serviceIdentity(right.serviceIdentity)));
/** One OS-held owner plus a durable intake fence; no snapshot of idle implies a lease. */
export class ResourceQuiescence{
 constructor(directory,onMayBeIdle=()=>{}){
  this.active=0;this.onMayBeIdle=onMayBeIdle;this.closed=false;
  this.lock=new DatabaseSync(join(directory,'resources-owner-lock.sqlite'));
  try{this.lock.exec('PRAGMA busy_timeout=0;PRAGMA journal_mode=DELETE;CREATE TABLE IF NOT EXISTS owner(id INTEGER);BEGIN EXCLUSIVE');}
  catch(error){this.lock.close();throw Error('Resources directory already has an owner or its exclusive lease is unavailable',{cause:error});}
  try{
   this.db=new DatabaseSync(join(directory,'resources-quiescence.sqlite'));this.db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;CREATE TABLE IF NOT EXISTS fence(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT);CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,value TEXT);');
   const prior=this.current();if(prior)this.save({...prior,state:'unknown'});
  }catch(error){this.db?.close();this.lock.close();throw error;}
 }
 current(){const row=this.db.prepare('SELECT value FROM fence WHERE id=1').get();return row&&JSON.parse(row.value);}
 save(value){this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT OR REPLACE INTO fence VALUES(1,?)').run(JSON.stringify(value));this.db.prepare('INSERT OR REPLACE INTO receipts VALUES(?,?)').run(value.fenceId,JSON.stringify(value));this.db.exec('COMMIT')}catch(error){this.db.exec('ROLLBACK');throw error;}}
 assertOpen(){if(this.closed||this.current())throw Object.assign(Error('Resource owner intake closed; no new effect admitted'),{code:-32009,executed:false});}
 inspect(){return {intakeClosed:!!this.current(),fence:this.current(),activeRequests:this.active,coverage:'resource-owner',gaps:[]};}
 notice(){if(this.noticeTimer||this.closed)return;this.noticeTimer=setTimeout(()=>{this.noticeTimer=undefined;try{Promise.resolve(this.onMayBeIdle()).catch(()=>{})}catch{}},0);this.noticeTimer.unref();}
 async effect(callback){this.assertOpen();this.active++;try{return await callback()}finally{this.active--;this.notice();}}
 participant(ownerId='resources'){
  return {id:ownerId,serviceStop:{version:1},acquire:async input=>{
   const value=context(ownerId,input),prior=this.current();
   if(prior){if(!same(prior,value)||prior.state!=='held')throw Error('Resource fence requires exact authoritative reconciliation');return this.lease(value);}
   if(this.db.prepare('SELECT 1 FROM receipts WHERE id=?').get(value.fenceId))throw Error('Retained resource fence cannot be acquired again');
   if(this.active)return null;
   this.save({...value,state:'held'});this.liveFence=value.fenceId;return this.lease(value);
  },reconcileRelease:async input=>this.release(context(ownerId,input),input.outcome,input.proof)};
 }
 lease(value){return {ownerId:value.ownerId,fenceId:value.fenceId,release:async(outcome,proof)=>this.release(value,outcome,proof,true)};}
 release(value,outcome,proof,live=false){
  const prior=this.current();if(!prior){const row=this.db.prepare('SELECT value FROM receipts WHERE id=?').get(value.fenceId),receipt=row&&JSON.parse(row.value);if(receipt?.state==='released'&&same(receipt,value)&&receipt.releaseSignature===releaseSignature(outcome,proof))return;throw Error('Exact resource fence required');}
  if(!same(prior,value))throw Error('Exact resource fence required');
  if(outcome==='unknown'){this.liveFence=undefined;this.save({...prior,state:'unknown'});return;}
  const refused=proof?.kind==='admission-refused'&&Object.keys(proof).length===1&&prior.state==='held'&&outcome==='unchanged'&&(prior.purpose!=='service-stop'||live&&this.liveFence===prior.fenceId);
  if(prior.purpose==='service-stop'&&!refused)validateServiceRelease(prior,outcome,proof);
  const verified=proof?.verified===true&&proof.fenceId===prior.fenceId&&proof.commandId===prior.commandId&&proof.dataScope===prior.dataScope&&proof.outcome===outcome&&['ready','unchanged'].includes(outcome)&&typeof proof.instanceId==='string'&&proof.instanceId.length>0&&proof.instanceId.length<=200&&typeof proof.receiptId==='string'&&proof.receiptId.length>0&&proof.receiptId.length<=200&&((proof.instanceId===prior.instanceId)===(outcome==='unchanged'));
  if(!refused&&!verified)throw Error('Verified exact resource release proof required');
  this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT OR REPLACE INTO receipts VALUES(?,?)').run(prior.fenceId,JSON.stringify({...prior,state:'released',outcome,releaseSignature:releaseSignature(outcome,proof)}));this.db.prepare('DELETE FROM fence WHERE id=1').run();this.db.exec('COMMIT');this.liveFence=undefined;}catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 assertClosable(){if(this.active)throw Error('Resource work is still running; closing cannot manufacture quiescence');}
 close(){if(this.closed)return;this.assertClosable();this.closed=true;if(this.noticeTimer)clearTimeout(this.noticeTimer);try{this.db.close();}finally{try{this.lock.exec('ROLLBACK')}finally{this.lock.close()}}}
}
