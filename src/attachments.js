/** Immutable attachment bodies. Browser drafts never enter this store. */
import {mkdirSync,openSync,closeSync,writeSync,readSync,fsyncSync,fstatSync,ftruncateSync,chmodSync,constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
export const CHUNK_BYTES=256*1024,MAX_ATTACHMENT=32*1024*1024;
const mimes=['image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain','application/octet-stream'];
const string=maxLength=>({type:'string',minLength:1,maxLength});
const entry=(description,properties,required)=>({description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
export const attachmentSchemas={
 'attachments.create':entry('Begin an explicitly shared attachment. Private drafts remain on the client.',{requestId:string(200),name:string(255),contentType:{enum:mimes},size:{type:'integer',minimum:0,maximum:MAX_ATTACHMENT},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'}},['requestId','name','contentType','size','sha256']),
 'attachments.inspect':entry('Read exact upload metadata without writing or resending a turn.',{id:string(100),requestId:string(200)},[]),
 'attachments.commit':entry('Verify and make the complete uploaded body immutable.',{id:string(100),requestId:string(200)},['id','requestId']),
};
function fail(message){throw Object.assign(Error(message),{code:-32602});}
function text(value,max){if(typeof value!=='string'||!value||value.length>max||value.includes('\0'))fail('Invalid attachment metadata');return value;}
function integer(value,max){return Number.isSafeInteger(value)&&value>=0&&value<=max;}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fingerprint=args=>hash(JSON.stringify([args.name,args.contentType,args.size,args.sha256]));
const toURI=(id,path,session)=>{const uri=new URL(`amplifier-attachment://${id}/${path}`);uri.searchParams.set('session',session);return uri.href;};
export class Attachments{
 constructor(store,context){this.db=store.db;this.context=context;this.directory=join(store.directory,'attachments');mkdirSync(this.directory,{recursive:true,mode:0o700});this.locks=new Map();this.waiting=0;this.closed=false;
  this.db.exec(`CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,session TEXT NOT NULL,request TEXT NOT NULL,fingerprint TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha TEXT NOT NULL,received INTEGER NOT NULL,status TEXT NOT NULL,created REAL NOT NULL,committed_request TEXT,UNIQUE(session,request));CREATE INDEX IF NOT EXISTS attachments_active ON attachments(status,session);CREATE INDEX IF NOT EXISTS attachments_session ON attachments(session,id);CREATE INDEX IF NOT EXISTS attachment_transfer_page ON attachments(session,status,id);CREATE TABLE IF NOT EXISTS attachment_metadata_revisions(session TEXT PRIMARY KEY,revision INTEGER NOT NULL);`);
 }
 revision(session){return hash(JSON.stringify([session,this.db.prepare('SELECT revision FROM attachment_metadata_revisions WHERE session=?').get(session)?.revision??0]));}
 touch(session){this.db.prepare('INSERT INTO attachment_metadata_revisions VALUES(?,1) ON CONFLICT(session) DO UPDATE SET revision=revision+1').run(session);}
 check(){if(this.closed)fail('Attachment owner closed; saved bytes remain recoverable');}
 path(id){return join(this.directory,id+'.blob');}
 row(session,id){this.check();const row=this.db.prepare('SELECT * FROM attachments WHERE session=? AND id=?').get(session,id);if(!row)fail('Attachment unavailable in this conversation');return row;}
 metadata(row){if(!row)return null;return {id:row.id,status:row.status,receivedBytes:row.received,size:row.size,sha256:row.sha,name:row.name,contentType:row.mime,chunkBytes:CHUNK_BYTES,uploadUri:toURI(row.id,'upload',row.session),resourceUri:toURI(row.id,'body',row.session),...(row.committed_request?{committedByRequest:row.committed_request}:{})};}
 async locked(id,fn){this.check();if(this.waiting>=64)fail('Attachment write capacity reached');this.waiting++;const previous=this.locks.get(id)??Promise.resolve(),work=previous.catch(()=>{}).then(()=>{this.check();return fn();});this.locks.set(id,work);try{return await work;}finally{this.waiting--;if(this.locks.get(id)===work)this.locks.delete(id);}}
 create(session,args){text(args.requestId,200);text(args.name,255);if(!mimes.includes(args.contentType)||!integer(args.size,MAX_ATTACHMENT)||!/^([a-f0-9]{64})$/.test(args.sha256))fail('Unsupported attachment type, size or hash');const intent=fingerprint(args),old=this.db.prepare('SELECT * FROM attachments WHERE session=? AND request=?').get(session,args.requestId);if(old){if(old.fingerprint!==intent)fail('Attachment request identity reused with different content');return this.metadata(old);}
  const active=this.db.prepare("SELECT count(*) AS count FROM attachments WHERE status='uploading' AND session=?").get(session).count;if(active>=16)fail('Finish existing uploads before adding more');
  if(this.db.prepare("SELECT count(*) AS count FROM attachments WHERE status='uploading'").get().count>=256)fail('Host upload capacity reached');
  const id=randomUUID(),fd=openSync(this.path(id),'wx',0o600);try{fsyncSync(fd);}finally{closeSync(fd);}
  this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)').run(id,session,args.requestId,intent,args.name,args.contentType,args.size,args.sha256,0,'uploading',Date.now()/1000);this.touch(session);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  return this.metadata(this.row(session,id));
 }
 async action(request){const ctx=await this.context(request.channel),args=request.args??{};this.check();let attachment;
  if(request.version!==1||request.topic!=='attachments'||!attachmentSchemas[request.operation])fail('Unknown attachment action');
  if(Object.keys(args).some(key=>!Object.hasOwn(attachmentSchemas[request.operation].inputSchema.properties,key)))fail('Unexpected attachment argument');
  if(request.operation==='attachments.create')attachment=this.create(ctx.session,args);
  else if(request.operation==='attachments.inspect'){if(!!args.id===!!args.requestId)fail('Choose one exact attachment ID or creation request');attachment=this.metadata(args.id?this.row(ctx.session,text(args.id,100)):this.db.prepare('SELECT * FROM attachments WHERE session=? AND request=?').get(ctx.session,text(args.requestId,200)));}
  else {text(args.id,100);text(args.requestId,200);attachment=await this.locked(args.id,async()=>{const row=this.row(ctx.session,args.id);if(row.status==='committed')return this.metadata(row);if(row.received!==row.size)fail('Upload is incomplete');const file=await open(this.path(row.id),constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=await file.stat();if(!before.isFile()||before.size!==row.size)fail('Attachment size changed');const digest=createHash('sha256'),buffer=Buffer.alloc(CHUNK_BYTES);let position=0;while(position<row.size){this.check();const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,row.size-position),position);if(!bytesRead)fail('Attachment ended before declared size');digest.update(buffer.subarray(0,bytesRead));position+=bytesRead;}const after=await file.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||digest.digest('hex')!==row.sha)fail('Attachment integrity failed; original client bytes remain authoritative');this.check();chmodSync(this.path(row.id),0o400);this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare("UPDATE attachments SET status='committed',committed_request=? WHERE id=?").run(args.requestId,row.id);this.touch(ctx.session);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}return this.metadata(this.row(ctx.session,row.id));}finally{await file.close();}});}
  return {accepted:true,result:{attachment},updates:[],invalidate:[]};
 }
 /** Trusted source callback: body-free indexed metadata, never a new transfer authority. */
 async transferMetadata({session,expectedRevision,cursor,limit=25,maxBytes=CHUNK_BYTES}={}){
  const ctx=await this.context(session);this.check();if(!Number.isSafeInteger(limit)||limit<1||limit>25||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>CHUNK_BYTES)fail('Use 1–25 metadata rows and a 1–256 KiB page');
  const revision=this.revision(ctx.session);let after='';
  if(expectedRevision!==undefined&&expectedRevision!==revision)fail('Attachment source selection changed; inspect a new exact revision');
  if(cursor){let value;try{if(typeof cursor!=='string'||cursor.length>16384)throw Error();value=JSON.parse(Buffer.from(cursor,'base64url'));}catch{fail('Invalid attachment metadata cursor');}
   if(value.session!==ctx.session||value.revision!==revision||typeof value.after!=='string'||!/^[-a-f0-9]{36}$/.test(value.after))fail('Attachment metadata cursor scope or revision changed');after=value.after;
  }
  const unfinished=this.db.prepare("SELECT count(*) AS count FROM attachments WHERE session=? AND status='uploading'").get(ctx.session).count;
  const rows=this.db.prepare("SELECT id,name,mime,size,sha FROM attachments WHERE session=? AND status='committed' AND id>? ORDER BY id LIMIT ?").all(ctx.session,after,limit+1);
  const items=[],omissions=unfinished?[{collection:'attachment-bodies',count:unfinished,reason:'unfinished attachments remain on source'}]:[];let processed=0,last=after;
  const result=(next,extraItems=items,extraOmissions=omissions)=>({owner:'unified.resources',version:1,session:ctx.session,revision,items:extraItems,nextCursor:next?Buffer.from(JSON.stringify({session:ctx.session,revision,after:last})).toString('base64url'):null,coverage:extraOmissions.length?'partial':'complete',omissions:extraOmissions});
  const fits=value=>Buffer.byteLength(JSON.stringify(value))<=maxBytes;
  if(!fits(result(false)))fail('Metadata page budget cannot represent scoped coverage');
  for(const row of rows.slice(0,limit)){
   const item={id:row.id,name:row.name,contentType:row.mime,size:row.size,sha256:row.sha,etag:'"sha256:'+row.sha+'"',resourceUri:toURI(row.id,'body',ctx.session),status:'committed'};
   const prior=last;last=row.id;const next=rows.length>processed+1;
   // A row too large even alone is explicitly omitted. Other byte limits page normally.
   if(!fits(result(next,[item],unfinished?omissions.filter(item=>!item.id):[]))){
    const omission={collection:'attachment-metadata',id:row.id,count:1,reason:'descriptor exceeds metadata page byte budget'};
    if(!fits(result(next,items,[...omissions,omission]))){last=prior;break;}omissions.push(omission);
   }else if(!fits(result(next,[...items,item]))){last=prior;break;}
   else items.push(item);
   processed++;
  }
  if(!processed&&rows.length)fail('Metadata page budget cannot represent its cursor or omission');
  return result(rows.length>processed);
 }
 async target(params,kind){const uri=new URL(params.uri);if(uri.protocol!=='amplifier-attachment:'||uri.pathname!=='/'+kind||!/^[-a-f0-9]{36}$/.test(uri.hostname))fail('Unknown attachment resource');const ctx=await this.context(uri.searchParams.get('session'));return {uri,row:this.row(ctx.session,uri.hostname)};}
 async write(params){const {uri,row}=await this.target(params,'upload');if(params.encoding!=='base64'||params.mode!=='append'||params.position!==undefined||params.createOnly||params.ifMatch!==undefined||typeof params.data!=='string'||params.data.length>4*Math.ceil(CHUNK_BYTES/3)||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(params.data))fail('Use one bounded base64 append chunk and its exact URI offset');if(!uri.searchParams.has('offset'))fail('Upload byte offset required');const offset=Number(uri.searchParams.get('offset')),bytes=Buffer.from(params.data,'base64');if(!integer(offset,row.size)||!bytes.length||bytes.length>CHUNK_BYTES||offset+bytes.length>row.size)fail('Chunk exceeds the declared upload');
  return this.locked(row.id,()=>{const current=this.row(row.session,row.id);if(offset>current.received)fail('Upload has a gap; inspect receivedBytes');const flags=(current.status==='committed'?constants.O_RDONLY:constants.O_RDWR)|constants.O_NOFOLLOW,fd=openSync(this.path(row.id),flags);try{const info=fstatSync(fd);if(!info.isFile()||info.size<current.received)fail('Upload storage changed');if(offset<current.received){if(offset+bytes.length>current.received)fail('Retry crosses the acknowledged upload boundary');const existing=Buffer.alloc(bytes.length);if(readSync(fd,existing,0,existing.length,offset)!==bytes.length||!existing.equals(bytes))fail('Acknowledged chunk differs; upload was not overwritten');return {};}
   if(current.status!=='uploading')fail('Committed attachments are immutable');if(info.size>current.received)ftruncateSync(fd,current.received);let written=0;while(written<bytes.length){const count=writeSync(fd,bytes,written,bytes.length-written,offset+written);if(count<=0)fail('Attachment write made no progress');written+=count;}fsyncSync(fd);this.db.prepare('UPDATE attachments SET received=? WHERE id=? AND received=?').run(offset+written,row.id,current.received);return {};
  }finally{closeSync(fd);}});
 }
 async read(params){const {uri,row}=await this.target(params,'body');if(row.status!=='committed')fail('Attachment is not committed');const offset=Number(uri.searchParams.get('offset')??0),limit=Number(uri.searchParams.get('limit')??CHUNK_BYTES);if(!integer(offset,row.size)||!integer(limit,CHUNK_BYTES)||!limit)fail('Use a bounded attachment byte page');const file=await open(this.path(row.id),constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await file.stat();if(!info.isFile()||info.size!==row.size)fail('Committed attachment size changed');const bytes=Buffer.alloc(Math.min(limit,row.size-offset));const {bytesRead}=await file.read(bytes,0,bytes.length,offset);if(bytesRead!==bytes.length)fail('Attachment body changed during read');const encoding=params.encoding==='utf-8'?'utf-8':'base64';return {data:encoding==='base64'?bytes.toString('base64'):new TextDecoder('utf-8',{fatal:true}).decode(bytes),encoding,contentType:row.mime};}finally{await file.close();}}
 async resolve(params){const {row}=await this.target(params,'body');if(row.status!=='committed')fail('Attachment is not committed');return {uri:params.uri,type:'file',contentType:row.mime,size:row.size,etag:'"sha256:'+row.sha+'"'};}
 async prompt(context,attachment,{mode='inline',resolveRemote}={}){const uri=attachment.uri;if(typeof uri!=='string'||!uri.startsWith('amplifier-attachment:'))return undefined;const {row}=await this.target({uri},'body');if(row.session!==context.session)fail('Prompt attachment does not belong to this conversation');if(row.status!=='committed')fail('Prompt attachment is not committed');
  if(!['inline','local-files','remote-resource'].includes(mode)||mode==='remote-resource'&&typeof resolveRemote!=='function'||mode==='inline'&&row.size>4*1024*1024)fail('This attachment needs an explicitly configured shared-filesystem or remote resource resolver');
  const file=await open(this.path(row.id),constants.O_RDONLY|constants.O_NOFOLLOW),bytes=mode==='inline'?Buffer.alloc(row.size):null,buffer=Buffer.alloc(CHUNK_BYTES),digest=createHash('sha256');try{const before=await file.stat();if(!before.isFile()||before.size!==row.size)fail('Prompt attachment size changed');let position=0;while(position<row.size){const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,row.size-position),position);if(!bytesRead)fail('Prompt attachment ended early');digest.update(buffer.subarray(0,bytesRead));if(bytes)buffer.copy(bytes,position,0,bytesRead);position+=bytesRead;}const after=await file.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||digest.digest('hex')!==row.sha)fail('Prompt attachment integrity changed');}finally{await file.close();}
  if(mode==='remote-resource'){
   // The trusted composition supplies transport and authorization. No HTTP fetch or filesystem assumption.
   const descriptor=Object.freeze({uri,name:row.name,mimeType:row.mime,size:row.size,sha256:row.sha,chunkBytes:CHUNK_BYTES});
   const read=async({offset=0,maxBytes=CHUNK_BYTES}={})=>{if(!integer(offset,row.size)||!integer(maxBytes,CHUNK_BYTES)||!maxBytes)fail('Use bounded remote attachment pages');const selected=new URL(uri);selected.searchParams.set('offset',String(offset));selected.searchParams.set('limit',String(maxBytes));return this.read({uri:selected.href,encoding:'base64'});};
   const result=await resolveRemote(descriptor,read);
   let remote;try{remote=new URL(result?.uri);}catch{fail('Remote resolver did not return a resource URI');}
   if(!['https:','amplifier-attachment:'].includes(remote.protocol)||remote.username||remote.password||result.size!==row.size||result.sha256!==row.sha)fail('Remote resolver must confirm the exact size and digest at a scoped remote resource URI');
   return [{type:'resource_link',uri:remote.href,name:row.name,mimeType:row.mime,size:row.size}];
  }
  if(mode==='local-files')return [{type:'resource_link',uri:pathToFileURL(this.path(row.id)).href,name:row.name,mimeType:row.mime,size:row.size}];
  if(row.mime.startsWith('image/'))return [{type:'image',data:bytes.toString('base64'),mimeType:row.mime}];
  if(row.mime==='text/plain')return [{type:'resource',resource:{uri,mimeType:row.mime,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)}}];
  return [{type:'resource',resource:{uri,mimeType:row.mime,blob:bytes.toString('base64')}}];
 }
 close(){this.closed=true;}
}
