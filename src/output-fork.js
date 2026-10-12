/** Trusted Host composition port. Never callable as a client action. */
import {createHash,randomUUID} from 'node:crypto';
const encode=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const hash=value=>createHash('sha256').update(encode(value)).digest('hex');
const fail=message=>{throw Error(message);};
function source(outputs,session){
 const rows=outputs.db.prepare("SELECT value FROM output_records WHERE session=? AND json_extract(value,'$.linked')=1 AND json_extract(value,'$.origin.messageId') IS NOT NULL ORDER BY created,id LIMIT 501").all(session).map(row=>JSON.parse(row.value));
 if(rows.length>500)fail('Selected output copies exceed the complete 500-item bound. Originals retained.');
 return rows.map(value=>{
  const comments=outputs.db.prepare('SELECT value FROM output_comments WHERE output=? ORDER BY rowid LIMIT 201').all(value.id).map(row=>JSON.parse(row.value));
  if(comments.length>200)fail('Output review notes exceed the complete copy bound.');
  return {value,comments,key:value.id+':'+hash([value,comments])};
 });
}
export function outputReferences(outputs,session){return source(outputs,session).map(({value,key})=>({key,origin:value.origin}));}
export function forkOutputs(outputs,{source:session,target,commandId,historyRevision,proof,workingDirectory}){
 if(!proof||proof.version!==1||proof.complete!==true||proof.execution!==false||!Array.isArray(proof.items)||proof.items.length>500||session===target||!session?.startsWith('ahp-session:/')||!target?.startsWith('ahp-session:/')||typeof commandId!=='string'||!commandId||typeof historyRevision!=='string'||!historyRevision)fail('Confirmed native output copy proof required.');
 const fingerprint=hash([session,target,historyRevision,proof]),command='fork-outputs:'+commandId;
 const previous=outputs.previous(command,fingerprint);if(previous)return previous;
 const rows=source(outputs,session),byKey=new Map(rows.map(row=>[row.key,row]));
 if(proof.items.length!==rows.length||new Set(proof.items.map(row=>row.key)).size!==rows.length)fail('Complete original output selection changed; originals retained.');
 const retained=[];
 for(const item of proof.items){const selected=byKey.get(item.key),value=selected?.value;if(!value||!['retained','omitted'].includes(item.disposition)||typeof item.sourceMessageId!=='string'||!item.sourceMessageId.startsWith('native:')||item.sourceMessageId.length>512)fail('Original output reference changed.');
  if(item.disposition==='omitted')continue;
  if(typeof item.targetMessageId!=='string'||!item.targetMessageId.startsWith('native:')||item.targetMessageId.length>512)fail('Copied output message identity unavailable.');
  outputs.content(value);const comments=selected.comments;
  let canvas;
  if(value.canvasId){const row=outputs.store.row(session,value.canvasId),revision=value.canvasVersion??row.revision,descriptor=outputs.store.descriptor(row,revision);if(descriptor.external||descriptor.kind==='mcp-app'||descriptor.kind==='settings')fail('Live output resource requires its owning copy capability.');outputs.store.body(session,row.id,revision);const version=outputs.db.prepare('SELECT * FROM versions WHERE artifact=? AND revision=?').get(row.id,revision);const definition=JSON.parse(version.definition);delete definition.path;delete definition.workspacePath;canvas={id:randomUUID(),version,definition};}
  retained.push({value,item,comments,canvas,id:randomUUID()});
 }
 if(outputs.db.prepare('SELECT count(*) n FROM output_records').get().n+retained.length>10000)fail('Saved outputs have reached their local limit.');
 const mapping=new Map(retained.map(row=>[row.value.id,row.id])),now=Date.now()/1000,result={copied:retained.length,omitted:rows.length-retained.length,workReplayed:false,items:[]};
 outputs.db.exec('BEGIN IMMEDIATE');try{
  for(const row of retained){const {value,item,id,comments,canvas}=row,clone={...value,id,sessionId:target,createdAt:now,revision:1,origin:{...value.origin,messageId:item.targetMessageId},parentId:mapping.get(value.parentId)??null,evidenceIds:(value.evidenceIds??[]).flatMap(id=>mapping.has(id)?[mapping.get(id)]:[]),forkSource:{sessionId:session,outputId:value.id,sha256:value.sha256??null,messageId:item.sourceMessageId,...(value.path?{path:value.path}:{})}};delete clone.origin.turnId;delete clone.path;delete clone.resourceUri;
   if(canvas){clone.canvasId=canvas.id;clone.canvasVersion=1;outputs.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?)').run(canvas.id,target,workingDirectory,null,now,now,1);outputs.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?)').run(canvas.id,1,canvas.version.hash,encode(canvas.definition),now,item.targetMessageId);}
   outputs.db.prepare('INSERT INTO output_records VALUES(?,?,?,?)').run(id,target,now,encode(clone));
   for(const comment of comments){const copied={...comment,id:randomUUID(),outputId:id,forkSourceCommentId:comment.id};outputs.db.prepare('INSERT INTO output_comments VALUES(?,?,?)').run(copied.id,id,encode(copied));}
   result.items.push({sourceId:value.id,id,messageId:item.targetMessageId});
  }
  outputs.store.touch(target);outputs.db.prepare('INSERT INTO output_receipts VALUES(?,?,?)').run(command,fingerprint,encode(result));outputs.db.exec('COMMIT');
 }catch(error){outputs.db.exec('ROLLBACK');throw error;}
 outputs.changed('outputs',target);outputs.changed('canvas',target);return result;
}
