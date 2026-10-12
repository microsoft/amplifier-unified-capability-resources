import {captureMedia} from './media-capture.js';
import {MAX_MEDIA_BYTES} from './media-validation.js';
const fail=message=>{throw Object.assign(Error(message),{code:-32011});};
const identity=row=>JSON.stringify([row.id,row.version,row.sha256]);
/** Media bytes are durable Outputs; player reports are bounded ephemeral client evidence. */
export class OutputMedia{
 constructor(outputs,{verifyMediaMessage,verifyMediaAuthority,mediaClientBound}={}){this.outputs=outputs;this.verify=verifyMediaMessage;this.authority=verifyMediaAuthority;this.bound=mediaClientBound;this.observations=new Map();}
 async check(session,messageId,turnId,caller,client=false){
  if(!this.authority||!this.verify)fail('Saved media is unavailable on this host.');
  const authority=await this.authority(session,caller);
  if(client&&(!caller?.clientId||!this.bound?.(session,caller.clientId)))fail('Choose this conversation in the connected browser.');
  const proof=await this.verify(session,messageId,turnId);
  if(JSON.stringify(authority)!==JSON.stringify(await this.authority(session,caller)))fail('Media conversation ownership changed.');
  if(client&&!this.bound?.(session,caller.clientId))fail('Choose this conversation in the connected browser.');
  return {...proof,mediaAuthority:authority};
 }
 async capture(session,args,workspace,caller){
  const proof=await this.check(session,args.messageId,args.messageTurnId,caller);
  const captured=await captureMedia(workspace.executionDirectory,args.path,args.expectedSha256);
  const refreshed=await this.check(session,args.messageId,args.messageTurnId,caller);
  if(JSON.stringify(proof)!==JSON.stringify(refreshed))fail('Saved assistant identity changed while reading media.');
  return {...captured,proof};
 }
 async guard(session,args,caller,{client=true}={}){
  const record=this.outputs.record(session,args.id);
  if(record.kind!=='media'||!record.linked||record.version!==args.version||record.sha256!==args.sha256||!Number.isSafeInteger(record.bytes)||record.bytes<=0||record.bytes>MAX_MEDIA_BYTES)fail('Choose the exact linked assistant media version and hash.');
  const proof=await this.check(session,args.messageId,record.origin.turnId,caller,client);
  if(record.origin.messageId!==args.messageId&&record.origin.messageId!==proof.messageId&&(!proof.legacyMessageId||record.origin.legacyMessageId!==proof.legacyMessageId))fail('Choose the exact linked assistant media message.');
  if(JSON.stringify(this.outputs.record(session,args.id))!==JSON.stringify(record))fail('Media relationship changed.');
  return record;
 }
 summary(session){
  const rows=this.outputs.db.prepare("SELECT DISTINCT json_extract(value,'$.origin.messageId') id,json_extract(value,'$.origin.legacyMessageId') legacy FROM output_records WHERE session=? AND json_extract(value,'$.kind')='media' AND json_extract(value,'$.linked')=1 LIMIT 501").all(session);
  return {version:1,maxBytes:MAX_MEDIA_BYTES,messageIds:rows.slice(0,500).map(row=>row.id),hasLegacy:rows.some(row=>row.legacy),overflow:rows.length>500};
 }
 async list(session,args,caller){
  const proof=await this.check(session,args.messageId,args.messageTurnId,caller,true);
  const rows=this.outputs.db.prepare("SELECT value FROM output_records WHERE session=? AND json_extract(value,'$.kind')='media' AND json_extract(value,'$.linked')=1 AND (json_extract(value,'$.origin.messageId') IN (?,?) OR json_extract(value,'$.origin.legacyMessageId')=?) ORDER BY created,id LIMIT 21").all(session,args.messageId,proof.messageId,proof.legacyMessageId??null);
  return {items:rows.slice(0,20).map(row=>{const descriptor=this.outputs.descriptor(JSON.parse(row.value)),uri=new URL(descriptor.resourceUri);uri.searchParams.set('message',args.messageId);return {...descriptor,mediaMessageId:args.messageId,resourceUri:uri.href};}),overflow:rows.length>20,mediaRevision:this.outputs.store.revision(session)};
 }
 async report(session,args,caller){
  if(caller?.origin!=='ui')fail('Media observations must originate in the authenticated browser UI.');
  const record=await this.guard(session,args,caller),key=JSON.stringify([caller.clientId,identity(record)]),old=this.observations.get(key);
  if(old&&(args.generation<old.generation||args.generation===old.generation&&args.sequence<=old.sequence))fail('This media observation generation or sequence is stale.');
  const value=Object.fromEntries(['generation','sequence','renderState','playback','presentedFrames','mediaTime','detail'].filter(k=>args[k]!==undefined).map(k=>[k,args[k]]));
  Object.assign(value,{clientId:caller.clientId,serverTimestamp:Date.now()/1000,evidence:'authenticated-ui-report',modelAttestation:false});
  this.observations.delete(key);this.observations.set(key,value);while(this.observations.size>200)this.observations.delete(this.observations.keys().next().value);
  return value;
 }
 observation(record,caller){
  if(!record.linked)return {status:'unlinked'};
  if(!caller?.clientId)return {status:'unbound'};
  if(!this.bound?.(record.sessionId,caller.clientId))return {status:'disconnected'};
  const observed=this.observations.get(JSON.stringify([caller.clientId,identity(record)]));
  if(!observed)return {status:'not_observed'};
  if(Date.now()/1000-observed.serverTimestamp>30)return {status:'expired',serverTimestamp:observed.serverTimestamp};
  return {status:'observed',...observed};
 }
}
