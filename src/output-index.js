/** Offline bounded indexing of original saved generated-image versions. */
import {ResourceStore} from './index.js';
import {Outputs} from './outputs.js';
import {openSync,closeSync,readFileSync,fstatSync,constants} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export function indexSavedImageOutputs({directory,session,after=0,limit=20}){
 if(typeof session!=='string'||!session||session.length>512||!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>50)throw Error('Choose a bounded saved-image session and page.');
 const store=new ResourceStore(directory);
 try{
  store.quiescence.assertOpen();const outputs=new Outputs(store,async()=>({session}));
  const rows=store.db.prepare("SELECT v.rowid position,v.artifact,v.revision,v.hash,v.created,v.message_id,length(CAST(v.definition AS BLOB)) bytes,CASE WHEN length(CAST(v.definition AS BLOB))<=65536 THEN v.definition END definition FROM versions v JOIN artifacts a ON a.id=v.artifact WHERE a.session=? AND v.rowid>? AND json_extract(v.definition,'$.imageResult') IS NOT NULL ORDER BY v.rowid LIMIT ?").all(session,after,limit+1),items=[];
  for(const row of rows.slice(0,limit)){
   try{
    if(!row.definition||!/^[a-f0-9]{64}$/.test(row.hash)||!Number.isFinite(row.created))throw Error('Saved image metadata is invalid or exceeds its bound.');
    const definition=JSON.parse(row.definition),result=definition.imageResult;
    if(definition.kind!=='image'||typeof definition.path!=='string'||!definition.path||result?.version!==1||!['generate','edit'].includes(result.operation)||!['requestId','toolCallId'].every(k=>typeof result[k]==='string'&&result[k].length>0&&result[k].length<=512)||!/^[a-f0-9]{64}$/.test(result.sha256))throw Error('Saved version has no exact completed image result.');
    const fd=openSync(join(store.blobs,row.hash+'.json'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let raw;
    try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>12*1024*1024)throw Error('Saved image body exceeds its bound.');raw=readFileSync(fd);}finally{closeSync(fd);}
    if(createHash('sha256').update(raw).digest('hex')!==row.hash)throw Error('Saved image body changed; original retained.');
    const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    store.db.exec('BEGIN IMMEDIATE');let output;
    try{output=outputs.captureImage({session,activeTurnId:row.message_id},definition,body,row.artifact,row.revision,{},row.created);store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}
    items.push({artifactId:row.artifact,version:row.revision,outputId:output.id,sha256:output.sha256,status:output.duplicate?'already-indexed':'indexed'});
   }catch(error){items.push({artifactId:row.artifact,version:row.revision,status:'retained',reason:error.message});}
  }
  return {session,items,nextAfter:rows.length>limit?rows[limit-1].position:null,originalsUnchanged:true,executionStarted:false};
 }finally{store.close();}
}
