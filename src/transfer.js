import {initializeSchema} from './authoritative-schema.js';
/** Immutable historical evidence. Only the trusted, verifying portability owner calls staging. */
import {createHash} from 'node:crypto';
import {statSync,readFileSync,openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {join} from 'node:path';
const OWNER='unified.resources',MAX=8*1024*1024;
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
const bytes=value=>Buffer.byteLength(json(value));
function checkIdentity(value){if(typeof value!=='string'||!value||value.length>8192)throw Error('Bounded transfer identity required');return value;}
export class ResourceEvidence{
 constructor(store,context,outputs){this.outputs=outputs;this.store=store;this.context=context;this.db=store.db;initializeSchema(this.db,'resources',['transfer'],()=>this.db.exec(`CREATE TABLE IF NOT EXISTS transfer_exports(id TEXT PRIMARY KEY,session TEXT,envelope TEXT);CREATE TABLE IF NOT EXISTS transfer_evidence(id TEXT PRIMARY KEY,source TEXT,native TEXT,hash TEXT,envelope TEXT,session TEXT,release TEXT);CREATE INDEX IF NOT EXISTS transfer_evidence_session ON transfer_evidence(session,id);`));}
 export=async(args)=>{const session=checkIdentity(args.session),id=checkIdentity(args.transferId);await this.context(session);const limit=Math.min(args.limitBytes??MAX,MAX);if(!Number.isSafeInteger(limit)||limit<1024)throw Error('Evidence budget must be at least 1024 bytes');const prior=this.db.prepare('SELECT * FROM transfer_exports WHERE id=?').get(id);if(prior){if(prior.session!==session)throw Error('Transfer identity belongs to another conversation');const value=JSON.parse(prior.envelope);if(value.bytes>limit||args.expectedRevision!==undefined&&args.expectedRevision!==value.revision)throw Error('Stored evidence bound or revision changed');return value;}
 const records=[],omissions=[],body={sourceSession:session,historicalOnly:true,records};let used=bytes(body);
 const add=record=>{const size=bytes(record)+1;if(records.length>=500||used+size>limit)return false;records.push(record);used+=size;return true;};
 const sources=[['artifact-versions','SELECT v.*,a.session,a.workspace,a.source_path FROM versions v JOIN artifacts a ON a.id=v.artifact WHERE a.session=? ORDER BY v.artifact,v.revision'],['app-states','SELECT s.* FROM app_states s JOIN artifacts a ON a.id=s.artifact WHERE a.session=? ORDER BY s.artifact,s.state_revision']];
 for(const [kind,query]of sources){const total=this.db.prepare('SELECT count(*) AS n FROM ('+query+')').get(session).n;let copied=0;
  for(const row of this.db.prepare(query+' LIMIT 501').iterate(session)){const path=join(this.store.blobs,row.hash+'.json'),size=statSync(path).size;if(size>limit-used||records.length>=500)break;const raw=readFileSync(path);if(hash(raw)!==row.hash)throw Error('Resource integrity changed; source files retained');if(!add({kind,metadata:{...row},bodyJson:new TextDecoder('utf-8',{fatal:true}).decode(raw)}))break;copied++;}
  if(copied<total)omissions.push({collection:kind,count:total-copied,reason:'bounded owner evidence; remaining versions stay on source disk'});
 }
 const files=this.db.prepare('SELECT count(*) AS n FROM attachments WHERE session=?').get(session).n;let copied=0,bodyCopied=0;
 for(const row of this.db.prepare('SELECT id,name,mime,size,sha,status,received FROM attachments WHERE session=? ORDER BY id LIMIT 501').iterate(session)){
  if(!add({kind:'attachment-metadata',value:{...row}}))break;copied++;
  const encodedSize=4*Math.ceil(row.size/3);
  if(row.status!=='committed'||records.length>=500||encodedSize+bytes({kind:'attachment-body',metadata:row,bodyBase64:''})+1>limit-used)continue;
  const fd=openSync(join(this.store.directory,'attachments',row.id+'.blob'),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const before=fstatSync(fd);if(!before.isFile()||before.size!==row.size)throw Error('Attachment integrity changed; source bytes retained');
   const raw=Buffer.alloc(row.size);let position=0;while(position<raw.length){const n=readSync(fd,raw,position,Math.min(262144,raw.length-position),position);if(!n)throw Error('Attachment body ended early');position+=n;}
   const after=fstatSync(fd);if(before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||hash(raw)!==row.sha)throw Error('Attachment integrity changed; source bytes retained');
   if(add({kind:'attachment-body',metadata:{...row},bodyBase64:raw.toString('base64')}))bodyCopied++;
  }finally{closeSync(fd);}
 }
 if(bodyCopied<files)omissions.push({collection:'attachment-bodies',count:files-bodyCopied,reason:'Unfinished or budget-exceeding attachment bytes remain on source disk'});
 if(copied<files)omissions.push({collection:'attachment-metadata',count:files-copied,reason:'bounded owner evidence'});
 if(this.outputs){
  const total=this.db.prepare('SELECT count(*) n FROM output_records WHERE session=?').get(session).n;let count=0,bodies=0,snapshots=0;
  for(const row of this.db.prepare('SELECT value FROM output_records WHERE session=? ORDER BY created,id LIMIT 501').iterate(session)){
   const value=JSON.parse(row.value);if(!add({kind:'output-metadata',value}))break;count++;
   const comments=this.db.prepare('SELECT value FROM output_comments WHERE output=? ORDER BY rowid LIMIT 201').all(value.id);let notes=0;
   for(const note of comments){if(!add({kind:'output-comment',value:JSON.parse(note.value)}))break;notes++;}
   if(notes<comments.length)omissions.push({collection:'output-comments',outputId:value.id,count:comments.length-notes,reason:'bounded historical evidence; original notes retained'});
   if(value.sha256){snapshots++;if(4*Math.ceil(value.bytes/3)+bytes({kind:'output-body',metadata:value,bodyBase64:''})+1<=limit-used&&records.length<500){const raw=this.outputs.content(value);if(add({kind:'output-body',metadata:value,bodyBase64:raw.toString('base64')}))bodies++;}}
  }
  if(count<total)omissions.push({collection:'output-metadata',count:total-count,reason:'bounded historical evidence; original outputs retained'});
  if(bodies<snapshots)omissions.push({collection:'output-bodies',count:snapshots-bodies,reason:'bounded historical evidence; original snapshots retained'});
 }
 const events=this.db.prepare('SELECT count(*) AS n FROM events WHERE session=?').get(session).n;if(events)omissions.push({collection:'canvas-events',count:events,reason:'Historical bodies only; client effects are not restored or replayed'});
 const external=this.db.prepare("SELECT count(*) AS n FROM versions v JOIN artifacts a ON a.id=v.artifact WHERE a.session=? AND json_extract(v.definition,'$.external') IS NOT NULL").get(session).n;if(external)omissions.push({collection:'external-resource-bodies',count:external,reason:'Referenced external provider bodies remain with their owner'});
 const bodyJson=json(body),sha256=hash(bodyJson);if(args.expectedRevision!==undefined&&args.expectedRevision!==sha256)throw Error('Evidence revision changed');const envelope={owner:OWNER,version:1,revision:sha256,sha256,bytes:Buffer.byteLength(bodyJson),encoding:'json-utf8',bodyJson,omissions,disposition:omissions.length?'partial':'complete',executionAuthority:false};this.db.prepare('INSERT INTO transfer_exports VALUES(?,?,?)').run(id,session,JSON.stringify(envelope));return envelope;
 };
 verify(value){if(value?.owner!==OWNER||value.version!==1||value.encoding!=='json-utf8'||value.executionAuthority!==false||typeof value.bodyJson!=='string'||value.bytes!==Buffer.byteLength(value.bodyJson)||value.bytes>MAX||value.sha256!==hash(value.bodyJson))throw Error('Historical resource evidence integrity mismatch');const body=JSON.parse(value.bodyJson);if(body?.historicalOnly!==true||!Array.isArray(body.records)||body.records.length>500)throw Error('Invalid resource evidence');
 for(const record of body.records)if(['attachment-body','output-body'].includes(record.kind)){
  const meta=record.metadata,encoded=record.bodyBase64;
  if(typeof encoded!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)||(record.kind==='attachment-body'&&meta?.status!=='committed'))throw Error('Invalid historical attachment body');
  const raw=Buffer.from(encoded,'base64');if(raw.toString('base64')!==encoded||raw.length!==(record.kind==='output-body'?meta.bytes:meta.size)||hash(raw)!==(record.kind==='output-body'?meta.sha256:meta.sha))throw Error('Historical attachment body integrity mismatch');
 }
 return body;}
 stage=async(args)=>{const id=checkIdentity(args.transferId),source=checkIdentity(args.sourceHost),native=checkIdentity(args.nativeSessionId),value=args.evidence;this.verify(value);const prior=this.db.prepare('SELECT * FROM transfer_evidence WHERE id=?').get(id);if(prior&&(prior.source!==source||prior.native!==native||prior.hash!==value.sha256))throw Error('Transfer evidence identity changed');this.db.prepare('INSERT OR IGNORE INTO transfer_evidence VALUES(?,?,?,?,?,NULL,NULL)').run(id,source,native,value.sha256,JSON.stringify(value));return {owner:OWNER,revision:value.revision,sha256:value.sha256,staged:true,executionAuthority:false};};
 activate=async(args)=>{const id=checkIdentity(args.transferId),session=checkIdentity(args.session);if(!/^[a-f0-9]{64}$/.test(args.releaseHash))throw Error('Verified release hash required');const prior=this.db.prepare('SELECT * FROM transfer_evidence WHERE id=?').get(id);if(!prior||prior.hash!==args.evidenceHash)throw Error('Staged evidence hash mismatch');if(prior.session!==null&&(prior.session!==session||prior.release!==args.releaseHash))throw Error('Evidence already activated under different authority');this.db.prepare('UPDATE transfer_evidence SET session=?,release=? WHERE id=?').run(session,args.releaseHash,id);return {owner:OWNER,transferId:id,session,evidenceHash:prior.hash,releaseHash:args.releaseHash,replayed:false,executionAuthority:false};};
 read=async(args)=>{await this.context(args.session);const row=this.db.prepare('SELECT * FROM transfer_evidence WHERE id=? AND session=?').get(args.transferId,args.session);if(!row)throw Error('Imported evidence unavailable in this conversation');const offset=args.offset??0,limit=args.limit??10;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>25)throw Error('Bounded history page required');const value=JSON.parse(row.envelope),body=this.verify(value),items=[];let size=0;for(const [index,item]of body.records.slice(offset,offset+limit).entries()){const {bodyJson,bodyBase64,...metadata}=item;const raw=bodyJson!==undefined?Buffer.from(bodyJson):bodyBase64!==undefined?Buffer.from(bodyBase64,'base64'):undefined;const summary={...metadata,...(raw?{bodyBytes:raw.length,bodySha256:hash(raw),recordIndex:offset+index}:{})};const cost=bytes(summary);if(items.length&&size+cost>512*1024)break;items.push({namespace:row.source+':'+row.id,historicalOnly:true,executionAuthority:false,...summary});size+=cost;}const next=offset+items.length;return {owner:OWNER,sourceHost:row.source,items,nextOffset:next<body.records.length?next:null,omissions:value.omissions,executionAuthority:false};};
 readBody=async(args)=>{await this.context(args.session);const row=this.db.prepare('SELECT envelope FROM transfer_evidence WHERE id=? AND session=?').get(args.transferId,args.session);if(!row)throw Error('Imported evidence unavailable in this conversation');const body=this.verify(JSON.parse(row.envelope)),index=args.recordIndex,offset=args.offset??0,limit=args.maxBytes??262144;if(!Number.isSafeInteger(index)||index<0||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>262144)throw Error('Bounded historical body page required');const record=body.records[index];if(typeof record?.bodyJson!=='string'&&typeof record?.bodyBase64!=='string')throw Error('Selected historical body unavailable');const raw=record.bodyJson!==undefined?Buffer.from(record.bodyJson):Buffer.from(record.bodyBase64,'base64');if(offset>raw.length)throw Error('Body cursor exceeds saved bytes');const chunk=raw.subarray(offset,offset+limit);return {data:chunk.toString('base64'),encoding:'base64',size:raw.length,sha256:hash(raw),nextOffset:offset+chunk.length<raw.length?offset+chunk.length:null,executionAuthority:false};};
}
