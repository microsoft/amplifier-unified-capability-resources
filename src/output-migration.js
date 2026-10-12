/** Explicit offline import from a reviewed, frozen Main database copy. */
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {ResourceStore} from './index.js';
import {validateMedia,MAX_MEDIA_BYTES} from './media-validation.js';
import {Outputs} from './outputs.js';
import {initializeSchema} from './authoritative-schema.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value);
function originalMessage(db,sourceSession,id){
 if(typeof id!=='string'||!id)return null;
 const table=name=>!!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name);
 let session;
 if(table('state_records')){
  const row=db.prepare("SELECT length(CAST(value AS BLOB)) bytes,CASE WHEN length(CAST(value AS BLOB))<=8388608 THEN value END value FROM state_records WHERE kind='session' AND id=?").get(sourceSession);
  if(row){if(row.bytes>8388608)throw Error('Original message projection exceeds its bound.');session=JSON.parse(row.value);}
 }
 if(session===undefined&&table('state')){
  const size=db.prepare('SELECT length(CAST(value AS BLOB)) bytes FROM state WHERE id=1').get();if(size?.bytes>268435456)throw Error('Original checkpoint exceeds its offline bound.');
  const rows=db.prepare("SELECT value FROM json_each((SELECT json_extract(value,'$.sessions') FROM state WHERE id=1)) WHERE json_extract(value,'$.id')=? LIMIT 2").all(sourceSession);
  if(rows.length>1)throw Error('Original conversation projection is ambiguous.');session=rows.length?JSON.parse(rows[0].value):undefined;
 }
 const matches=(session?.messages??[]).filter(row=>row.id===id||row.nativeMessageId===id);
 if(matches.length>1)throw Error('Original message reference is ambiguous.');
 const selected=matches[0],identity=selected?.nativeMessageId??(selected?.source==='native'?selected.id:null);
 // Native re-verifies this content-addressed Main identity against the exact
 // canonical source at copy admission. This never grants mutation authority.
 return /^[a-f0-9]{32}$/.test(identity??'')?identity:/^[a-f0-9]{32}$/.test(id)?id:null;
}
function regular(path,limit){if(realpathSync(path)!==resolve(path)||lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile()||lstatSync(path).size>limit)throw Error('A bounded frozen regular source is required.');return readFileSync(path);}
function body(db,database,record){
 if(!record.body)return null;const id=record.body.$resource;if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw Error('Saved output body reference is invalid.');
 const maximum=record.kind==='media'?Math.ceil(MAX_MEDIA_BYTES*4/3)+1024:12*1024*1024;
 const indexed=db.prepare('SELECT value FROM state_resources WHERE id=? AND length(CAST(value AS BLOB))<=?').get(id,maximum);if(!indexed)throw Error('Saved output body is unavailable.');
 let bytes=Buffer.from(indexed.value),value=JSON.parse(indexed.value);if(value.$blob){if(value.$blob!==id||Object.keys(value).length!==1)throw Error('Saved body index changed.');bytes=regular(join(dirname(database),'artifacts',id+'.json'),maximum);value=JSON.parse(bytes);}
 if(sha(bytes)!==id)throw Error('Saved output body integrity changed.');let data;
 if(record.bodyFormat==='canvas-image-v1'){if(typeof value.content!=='string'||!value.content.startsWith('data:image/png;base64,'))throw Error('Saved image source is unavailable.');value={encoding:'base64',data:value.content.slice(22)};}
 if(value.encoding==='utf-8'&&typeof value.data==='string')data=Buffer.from(value.data);else if(value.encoding==='base64'&&typeof value.data==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data))data=Buffer.from(value.data,'base64');else throw Error('Saved output encoding is invalid.');
 if(data.length>(record.kind==='media'?MAX_MEDIA_BYTES:8*1024*1024)||data.length!==record.bytes||sha(data)!==record.sha256)throw Error('Saved output bytes differ from their original evidence.');if(record.kind==='media'){const metadata=validateMedia(data);if(JSON.stringify(Object.entries(metadata).sort())!==JSON.stringify(Object.entries(record.media??{}).sort()))throw Error('Saved media metadata differs from its original bytes.');}return data;
}
export function importLegacyOutputs({database,destination,sourceSession,session,expectedDatabaseSha256,limit=20,after}){
 database=resolve(database);destination=resolve(destination);const bytes=regular(database,512*1024*1024);if(!/^[a-f0-9]{64}$/.test(expectedDatabaseSha256)||sha(bytes)!==expectedDatabaseSha256)throw Error('Review the exact frozen source database first.');
 if(['-wal','-journal'].some(suffix=>existsSync(database+suffix)&&lstatSync(database+suffix).size>0))throw Error('Create a frozen SQLite backup before importing outputs.');
 if(typeof sourceSession!=='string'||!sourceSession||sourceSession.length>200||!/^ahp-session:\/[^/?#]+$/.test(session)||!Number.isSafeInteger(limit)||limit<1||limit>50||database===join(destination,'resources.sqlite'))throw Error('Exact source and destination scopes and a bounded page are required.');
 const scope=sha(json([database,expectedDatabaseSha256,sourceSession,session])),sourceId=sha(json([database,sourceSession,'outputs']));let cursor='';if(after){const value=JSON.parse(Buffer.from(after,'base64url'));if(value.scope!==scope||typeof value.after!=='string')throw Error('The source or destination mapping changed.');cursor=value.after;}
 const db=new DatabaseSync(database,{readOnly:true});let store;
 try{
  db.exec('BEGIN');if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='output_records'").get())return {version:1,items:[],nextCursor:null,sourceRetained:true,executionStarted:false};
  const rows=db.prepare('SELECT id,value FROM output_records WHERE session_id=? AND id>? AND length(CAST(value AS BLOB))<=65536 ORDER BY id LIMIT ?').all(sourceSession,cursor,limit+1);
  if(db.prepare('SELECT 1 FROM output_records WHERE session_id=? AND length(CAST(value AS BLOB))>65536 LIMIT 1').get(sourceSession))throw Error('Output metadata exceeds its migration bound; source retained.');
  store=new ResourceStore(destination);store.quiescence.assertOpen();const outputs=new Outputs(store,async selected=>({session:selected}));initializeSchema(store.db,'resources',['imports'],()=>store.db.exec('CREATE TABLE IF NOT EXISTS legacy_document_imports(source TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,session TEXT NOT NULL,metadata TEXT NOT NULL,PRIMARY KEY(source,id))'));
  const hasComments=!!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='output_comments'").get(),items=[];
  for(const row of rows.slice(0,limit)){
   try{
    const original=JSON.parse(row.value);if(original.id!==row.id||original.sessionId!==sourceSession||typeof row.id!=='string'||!row.id||row.id.length>100||typeof original.title!=='string'||original.title.length>200||!['file','dataset','canvas','pull_request','external_document','writing','git_review','media'].includes(original.kind)||!Number.isSafeInteger(original.revision)||original.revision<1||!Number.isSafeInteger(original.version)||original.version<1||typeof original.linked!=='boolean'||!Number.isFinite(original.createdAt)||!original.origin||typeof original.origin!=='object')throw Error('Malformed saved output metadata.');
    if(original.evidenceIds!==undefined&&(!Array.isArray(original.evidenceIds)||original.evidenceIds.length>20))throw Error('Malformed output evidence references.');
    if(original.url){let url;try{url=new URL(original.url);}catch{throw Error('Malformed external output reference.');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password||/[\x00-\x1f\x7f]/.test(original.url))throw Error('Unsafe external output reference; source retained.');}
    for(const id of [...(original.evidenceIds??[]),...(original.parentId?[original.parentId]:[])])if(typeof id!=='string'||!db.prepare('SELECT 1 FROM output_records WHERE session_id=? AND id=?').get(sourceSession,id))throw Error('Output lineage leaves its original conversation.');
    const comments=hasComments?db.prepare('SELECT id,value FROM output_comments WHERE output_id=? ORDER BY rowid LIMIT 201').all(row.id):[];if(comments.length>200||comments.some(c=>Buffer.byteLength(c.value)>16384))throw Error('Output comments exceed their migration bound.');
    const fingerprint=sha(json([original,comments])),prior=store.db.prepare('SELECT * FROM legacy_document_imports WHERE source=? AND id=?').get(sourceId,row.id);
    if(prior){if(prior.session!==session||prior.fingerprint!==fingerprint)throw Error('Source output or destination mapping changed; later work preserved.');items.push({id:row.id,status:'already-imported'});continue;}
    if(store.db.prepare('SELECT 1 FROM output_records WHERE id=?').get(row.id))throw Error('Destination output identity already exists.');
    if(store.db.prepare('SELECT count(*) n FROM output_records').get().n>=10000)throw Error('Destination saved output limit reached; source retained.');
    const data=body(db,database,original);if(data)outputs.put(data,undefined,original.kind);else if(original.sha256)throw Error('Snapshot has no source bytes.');
    const {body:legacyBody,downloadUrl,imageUrl,resourceUri,...retained}=original,value={...retained,sessionId:session,legacySource:{sessionId:sourceSession,outputId:row.id,databaseSha256:expectedDatabaseSha256,body:legacyBody??null,executionAuthority:false}};
    const legacyMessageId=originalMessage(db,sourceSession,original.origin.messageId);if(legacyMessageId)value.origin={...original.origin,legacyMessageId};
    if(sha(regular(database,512*1024*1024))!==expectedDatabaseSha256)throw Error('Frozen source database changed during import.');
    store.db.exec('BEGIN IMMEDIATE');try{
     store.db.prepare('INSERT INTO output_records VALUES(?,?,?,?)').run(row.id,session,original.createdAt,json(value));
     for(const comment of comments){const note=JSON.parse(comment.value);if(note.id!==comment.id||note.outputId!==row.id||typeof note.body!=='string'||note.body.length>8000)throw Error('Malformed review note.');store.db.prepare('INSERT INTO output_comments VALUES(?,?,?)').run(comment.id,row.id,json({...note,externalPosted:false,legacySource:{outputId:row.id,sessionId:sourceSession,executionAuthority:false}}));}
     store.db.prepare('INSERT INTO legacy_document_imports VALUES(?,?,?,?,?)').run(sourceId,row.id,fingerprint,session,json({kind:'output',databaseSha256:expectedDatabaseSha256}));store.touch(session);store.db.exec('COMMIT');
    }catch(error){store.db.exec('ROLLBACK');throw error;}
    items.push({id:row.id,status:'imported',comments:comments.length,bytes:data?.length??0});
   }catch(error){items.push({id:row.id,status:'retained',reason:error.message});}
  }
  return {version:1,scope,sourceSession,session,items,nextCursor:rows.length>limit?Buffer.from(json({scope,after:rows[limit-1].id})).toString('base64url'):null,sourceRetained:true,executionStarted:false,receiptsReplayed:false};
 }finally{store?.close();db.close();}
}
