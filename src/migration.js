import {initializeSchema} from './authoritative-schema.js';
/** Explicit offline selected-session migration; never a host startup reader. */
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {lstatSync,realpathSync,readFileSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {ResourceStore} from './index.js';
import {CanvasApps,validateLegacyAppSnapshot} from './apps.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
const DOCUMENTS=new Set(['text','markdown','code','html','mermaid','dot','json','jsonl','image','a2ui','babylon']);
const MAX_METADATA=512*1024,MAX_BODY=6*1024*1024,MAX_CHECKPOINT=256*1024*1024,MAX_ARTIFACT=32*1024*1024;
function bounded(value,name,max=4096){if(typeof value!=='string'||!value||value.length>max||value.includes('\0'))throw Error('Invalid '+name);return value;}
function regular(path,max){if(lstatSync(path).isSymbolicLink()||realpathSync(path)!==resolve(path)||!lstatSync(path).isFile()||lstatSync(path).size>max)throw Error('Source must be an unlinked bounded regular file');return path;}
function body(source,database,reference,keys=['content','surface']){
 const id=reference?.$resource;if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw Error('Saved body reference is unavailable');
 const row=source.prepare('SELECT value FROM state_resources WHERE id=? AND length(CAST(value AS BLOB))<=?').get(id,MAX_BODY);
 if(!row)throw Error('Saved body index is missing or oversized');
 let bytes=Buffer.from(row.value),value=JSON.parse(row.value);
 if(value&&typeof value==='object'&&Object.keys(value).length===1&&value.$blob){if(value.$blob!==id)throw Error('Saved body index changed');const path=regular(join(dirname(database),'artifacts',id+'.json'),MAX_BODY);bytes=readFileSync(path);value=JSON.parse(bytes);}
 if(bytes.length>MAX_BODY||sha(bytes)!==id)throw Error('Saved body bytes failed integrity verification');
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))||(value.content!==undefined&&typeof value.content!=='string'))throw Error('Saved body needs its original capability owner');
 return {id,bytes,value};
}
function writeBody(directory,{id,bytes}){
 const path=join(directory,id+'.json');
 if(existsSync(path)){if(sha(readFileSync(path))!==id)throw Error('Destination immutable body conflicts');return;}
 const temp=path+'.'+randomUUID()+'.tmp',fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,path);
 const parent=openSync(directory,'r');try{fsyncSync(parent);}finally{closeSync(parent);}
}

/** The operator supplies the reviewed old→new session mapping and destination workspace. */
export function importLegacyDocuments(options){return importLegacy({...options,appsOnly:false,reviewed:undefined});}

/** Review hashes come from the retained metadata inspection; only exact selected records activate. */
export function importLegacyApps(options){
 if(!options?.reviewed||typeof options.reviewed!=='object'||Array.isArray(options.reviewed)||Object.keys(options.reviewed).length<1||Object.keys(options.reviewed).length>50||Object.values(options.reviewed).some(hash=>typeof hash!=='string'||! /^[a-f0-9]{64}$/.test(hash)))throw Error('Review 1–50 exact artifact metadata hashes before importing apps');
 return importLegacy({...options,appsOnly:true});
}
function importLegacy({database,destination,sourceSession,session,workingDirectory,limit=20,after,appsOnly=false,reviewed}){
 database=regular(resolve(database),Number.MAX_SAFE_INTEGER);destination=resolve(destination);
 bounded(sourceSession,'source session',200);bounded(session,'destination session',300);bounded(workingDirectory,'workspace');
 if(!/^ahp-session:\/[^/?#]+$/.test(session)||!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('Exact destination session and page of 1–50 required');
 if(resolve(database)===join(destination,'resources.sqlite'))throw Error('Source and destination must differ');
 const source=new DatabaseSync(database,{readOnly:true});let store;
 try{
  source.exec('BEGIN');
  const checkpoint=source.prepare('SELECT length(CAST(value AS BLOB)) AS bytes FROM state WHERE id=1').get();
  if(!checkpoint||checkpoint.bytes>MAX_CHECKPOINT)throw Error('Legacy checkpoint exceeds the explicit 256 MiB offline migration bound; source retained');
  checkpoint.revision=source.prepare("SELECT json_extract(value,'$.revision') AS revision FROM state WHERE id=1").get().revision;
  const hasRecords=!!source.prepare("SELECT 1 FROM sqlite_master WHERE name='state_records'").get();
  const revision=hasRecords?source.prepare("SELECT value FROM state_records WHERE kind='revision' AND id=''").get()?.value??checkpoint.revision:checkpoint.revision;
  const scope=sha(json({database,sourceSession,session,workingDirectory,revision,appsOnly,reviewed}));let offset=-1;
  if(after){const cursor=JSON.parse(Buffer.from(after,'base64url'));if(cursor.scope!==scope||!Number.isSafeInteger(cursor.after)||cursor.after<0)throw Error('Legacy page changed; restart inspection without overwriting imported records');offset=cursor.after;}
  const overlay=hasRecords?source.prepare("SELECT length(CAST(value AS BLOB)) AS bytes FROM state_records WHERE kind='global' AND id='canvasArtifacts'").get():undefined;
  if(overlay?.bytes>MAX_CHECKPOINT)throw Error('Legacy artifact metadata exceeds the offline bound; source retained');
  const expression=overlay?"(SELECT CASE WHEN json_extract(value,'$.present') THEN json_extract(value,'$.value') ELSE '[]' END FROM state_records WHERE kind='global' AND id='canvasArtifacts')":"(SELECT COALESCE(json_extract(value,'$.canvasArtifacts'),'[]') FROM state WHERE id=1)";
  if(source.prepare(`SELECT json_type(${expression}) AS kind`).get().kind!=='array')throw Error('Legacy artifact list is malformed; source retained');
  const rows=source.prepare(`SELECT CAST(key AS INTEGER) AS position,json_extract(value,'$.id') AS id,length(CAST(value AS BLOB)) AS bytes,CASE WHEN length(CAST(value AS BLOB))<=? THEN value ELSE NULL END AS metadata FROM json_each(${expression}) WHERE json_extract(value,'$.sessionId')=? AND CAST(key AS INTEGER)>? ORDER BY CAST(key AS INTEGER) LIMIT ?`).all(MAX_METADATA,sourceSession,offset,limit+1);
  store=new ResourceStore(destination);store.quiescence.assertOpen();initializeSchema(store.db,'resources',['imports'],()=>store.db.exec('CREATE TABLE IF NOT EXISTS legacy_document_imports(source TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,session TEXT NOT NULL,metadata TEXT NOT NULL,PRIMARY KEY(source,id))'));
  const sourceId=sha(database+'\0'+sourceSession),items=[];
  for(const row of rows.slice(0,limit)){
   const outcome={id:row.id,sourcePosition:row.position,sourceRetained:true,...(row.metadata?{metadataSha256:sha(row.metadata)}:{})};
   try{
    if(!row.metadata)throw Error('Artifact metadata exceeds 512 KiB');
    const legacy=JSON.parse(row.metadata);bounded(legacy.id,'artifact identity',100);
    if(appsOnly){
     if(legacy.kind!=='canvas-app'||!legacy.app||legacy.mcpState)throw Error('Record is not an owned legacy CanvasApp');
     if(reviewed[legacy.id]!==sha(row.metadata))throw Error('Exact artifact metadata review required');
     if(!Array.isArray(legacy.app.requests)||legacy.app.requests.some(request=>!['applied','failed','rejected','superseded'].includes(request.status)))throw Error('Unresolved or unknown legacy effects remain with the original owner');
    }else if(!DOCUMENTS.has(legacy.kind)||legacy.app||legacy.mcpState)throw Error('Interactive or external artifact requires its original owner; no effects activated');
    const revision=appsOnly?legacy.app.revision:(legacy.revision??1);
    const versions=appsOnly?legacy.app.versions:legacy.versions?.length?legacy.versions:[{...legacy,version:revision}];
    if(!Array.isArray(versions)||versions.length>500||!versions.length||versions.at(-1).version!==revision)throw Error('Saved version chain is unavailable or exceeds 500 versions');
    let total=0;const records=versions.map((saved,index)=>{
     if(saved.version!==index+1||!appsOnly&&!DOCUMENTS.has(saved.kind??legacy.kind))throw Error('Saved version sequence or kind is invalid');
     const retained=body(source,database,saved.body??saved.contentResource,appsOnly?['content','manifest']:undefined);total+=retained.bytes.length;if(total>MAX_ARTIFACT)throw Error('Selected artifact exceeds 32 MiB; source retained');
     const definition={kind:saved.kind??legacy.kind,title:bounded(saved.title??legacy.title,'title',200)};
     for(const key of ['path','workspacePath','url'])if(saved[key]!==undefined)definition[key]=bounded(saved[key],key);
     let snapshot,stateBody;
     if(appsOnly){stateBody=body(source,database,saved.stateResource,['state','stateRevision']);total+=stateBody.bytes.length;if(total>MAX_ARTIFACT)throw Error('Selected artifact exceeds 32 MiB; source retained');snapshot=validateLegacyAppSnapshot(retained.value.content,retained.value.manifest,stateBody.value.state,saved.version,stateBody.value.stateRevision);}
     return {...retained,definition,snapshot,stateBody,revision:saved.version,created:Number.isFinite(saved.createdAt)?saved.createdAt:0,messageId:typeof saved.messageId==='string'?saved.messageId:(legacy.publications??[]).find(link=>link.version===saved.version)?.messageId??null};
    });
    let current;
    if(appsOnly){
     if(legacy.body?.$resource!==records.at(-1).id)throw Error('Current legacy body differs from retained definition');
     current=validateLegacyAppSnapshot(records.at(-1).value.content,legacy.app.manifest,legacy.app.state,revision,legacy.app.stateRevision);
     if(json(current.app.manifest)!==json(records.at(-1).snapshot.app.manifest))throw Error('Current legacy manifest differs from retained definition');
     for(let index=1;index<records.length;index++)if(records[index].snapshot.app.stateRevision<=records[index-1].snapshot.app.stateRevision)throw Error('Legacy state revisions must increase across definitions');
     if(current.app.stateRevision<records.at(-1).snapshot.app.stateRevision)throw Error('Current legacy state revision precedes definition');
     if(current.app.stateRevision===records.at(-1).snapshot.app.stateRevision&&json(current)!==json(records.at(-1).snapshot))throw Error('Legacy state identity conflicts');
    }
    const fingerprint=sha(json({legacy,session,workingDirectory}));let imported=false;
    store.db.exec('BEGIN IMMEDIATE');
    try{
     const prior=store.db.prepare('SELECT * FROM legacy_document_imports WHERE source=? AND id=?').get(sourceId,legacy.id),existing=store.db.prepare('SELECT * FROM artifacts WHERE id=?').get(legacy.id);
     if(prior){if(prior.fingerprint!==fingerprint||prior.session!==session||!existing||existing.session!==session)throw Error('Imported source or session mapping changed; existing destination retained');}
     else{
      if(existing)throw Error('Destination identity already belongs to a retained artifact');
      for(const record of records){writeBody(store.blobs,record);if(record.stateBody)writeBody(store.blobs,record.stateBody);}
      const created=Number.isFinite(legacy.createdAt)?legacy.createdAt:0;
      store.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?)').run(legacy.id,session,workingDirectory,legacy.path??null,created,records.at(-1).created,records.length);
      const insert=store.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?)');for(const record of records)insert.run(legacy.id,record.revision,record.id,json(record.definition),record.created,record.messageId);
      if(appsOnly){const apps=new CanvasApps(store);for(const record of records)apps.persist(legacy.id,record.snapshot,{definition:true});if(current.app.stateRevision!==records.at(-1).snapshot.app.stateRevision)apps.persist(legacy.id,current);}
      store.db.prepare('INSERT INTO legacy_document_imports VALUES(?,?,?,?,?)').run(sourceId,legacy.id,fingerprint,session,row.metadata);store.touch(session);imported=true;
     }
     store.db.exec('COMMIT');
    }catch(error){store.db.exec('ROLLBACK');throw error;}
    items.push({...outcome,status:imported?'imported':'already-imported',versions:records.length,bytes:total});
   }catch(error){items.push({...outcome,status:'retained',reason:error.message});}
  }
  const last=rows[Math.min(rows.length,limit)-1];
  return {version:1,scope,sourceSession,session,items,nextCursor:rows.length>limit?Buffer.from(json({scope,after:last.position})).toString('base64url'):null,sourceRetained:true,executionStarted:false,privateClientStateImported:false};
 }finally{store?.close();source.close();}
}
