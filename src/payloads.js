/** Private composition ports. The embedding verifier owns signature, pairing and full plan audit. */
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,openSync,closeSync,fstatSync,readSync,writeSync,fsyncSync,constants} from 'node:fs';
import {open,rename} from 'node:fs/promises';
import {join} from 'node:path';
const CHUNK=262144,MAX_BODY=64*1024*1024,MAX_SELECTION=1024*1024*1024;
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const json=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=8192&&!value.includes('\0');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export class HistoricalPayloads{
 constructor(store,context,verifyPlan){this.store=store;this.db=store.db;this.context=context;this.verifyPlan=verifyPlan;this.directory=join(store.directory,'historical-payloads');mkdirSync(this.directory,{recursive:true,mode:0o700});this.db.exec('CREATE TABLE IF NOT EXISTS transfer_payloads(id TEXT PRIMARY KEY,binding TEXT NOT NULL,records TEXT NOT NULL);CREATE TABLE IF NOT EXISTS transfer_payload_pending(id TEXT PRIMARY KEY,binding TEXT NOT NULL)');}
 stage=async args=>{
  if(typeof this.verifyPlan!=='function')throw Error('Authenticated transfer plan verifier is unavailable');
  const staged=this.db.prepare('SELECT * FROM transfer_evidence WHERE id=?').get(args.transferId);
  if(!staged||staged.source!==args.sourceHost||staged.hash!==args.evidenceHash||JSON.parse(staged.envelope).revision!==args.ownerRevision)throw Error('Detached payloads require exact staged source/evidence/owner revision');
  const keys=['transferId','sourceHost','destinationHost','ownerRevision','evidenceHash','planHash'];
  if(keys.some(key=>!identity(args[key]))||!digest(args.planHash))throw Error('Exact detached transfer binding required');
  const pendingBinding=json(Object.fromEntries(keys.map(key=>[key,args[key]]))),pending=this.db.prepare('SELECT binding FROM transfer_payload_pending WHERE id=?').get(args.transferId),sealed=this.db.prepare('SELECT 1 FROM transfer_payloads WHERE id=?').get(args.transferId);
  if(pending&&pending.binding!==pendingBinding)throw Error('Unknown payload import is bound to another plan');
  if(!sealed)this.db.prepare('INSERT OR IGNORE INTO transfer_payload_pending VALUES(?,?)').run(args.transferId,pendingBinding);
  // A configured trusted verifier returns the authenticated manifest, never a caller Boolean.
  const verified=await this.verifyPlan(Object.fromEntries([...keys,'capsule','plan'].map(key=>[key,args[key]])));
  if(!verified||verified.owner!=='unified.resources'||keys.some(key=>verified[key]!==args[key])||!Array.isArray(verified.bodies)||verified.bodies.length>500)throw Error('Authenticated plan binding mismatch');
  const seen=new Set();let total=0;
  for(const body of verified.bodies){if(!identity(body.id)||body.id.length>200||seen.has(body.id)||!digest(body.sha256)||!Number.isSafeInteger(body.size)||body.size<0||body.size>MAX_BODY)throw Error('Invalid authenticated payload descriptor');seen.add(body.id);total+=body.size;}
  if(total>MAX_SELECTION)throw Error('Historical payload selection exceeds 1 GiB');
  const binding=Object.fromEntries(['owner',...keys].map(key=>[key,verified[key]])),prior=this.db.prepare('SELECT * FROM transfer_payloads WHERE id=?').get(args.transferId);
  const manifest=json({binding,bodies:verified.bodies.map(({id,size,sha256})=>({id,size,sha256}))});
  if(prior){if(prior.binding!==manifest)throw Error('Sealed payload plan changed');return {transferId:args.transferId,planHash:args.planHash,staged:true,executionAuthority:false};}
  if(staged.session!==null)throw Error('Detached payloads must be sealed before historical activation');
  if(!Array.isArray(args.bodies)||args.bodies.length!==verified.bodies.length)throw Error('Exact selected payload sources required');
  const sources=new Map();for(const body of args.bodies){if(sources.has(body.id)||!seen.has(body.id)||typeof body.path!=='string')throw Error('Payload source identity differs from authenticated plan');sources.set(body.id,body.path);}
  const records=[];
  for(const expected of verified.bodies){
   const source=await open(sources.get(expected.id),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),temp=join(this.directory,randomUUID()+'.tmp'),chunks=[],whole=createHash('sha256');let position=0,target;
   try{const before=await source.stat();if(!before.isFile()||before.size!==expected.size)throw Error('Historical payload source size changed');
    target=await open(temp,'wx',0o600);
    const buffer=Buffer.alloc(CHUNK);while(position<expected.size){let filled=0,wanted=Math.min(CHUNK,expected.size-position);while(filled<wanted){const {bytesRead:n}=await source.read(buffer,filled,wanted-filled,position+filled);if(!n)throw Error('Historical payload ended early');filled+=n;}
     const raw=buffer.subarray(0,filled);whole.update(raw);chunks.push({sha256:hash(raw),bytes:filled});let written=0;while(written<filled){const {bytesWritten:n}=await target.write(raw,written,filled-written,position+written);if(!n)throw Error('Historical copy made no progress');written+=n;}position+=filled;
    }
    const after=await source.stat();if(before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||whole.digest('hex')!==expected.sha256)throw Error('Historical payload source integrity mismatch');await target.sync();
   }finally{try{await target?.close();}finally{await source.close();}}
   await rename(temp,join(this.directory,expected.sha256+'.blob'));records.push({id:expected.id,size:expected.size,sha256:expected.sha256,chunks});
  }
  const parent=openSync(this.directory,'r');try{fsyncSync(parent);}finally{closeSync(parent);}
  this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT INTO transfer_payloads VALUES(?,?,?)').run(args.transferId,manifest,json(records));this.db.prepare('DELETE FROM transfer_payload_pending WHERE id=?').run(args.transferId);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  return {transferId:args.transferId,planHash:args.planHash,staged:true,executionAuthority:false};
 };
 requireActivation(args){if(this.db.prepare('SELECT 1 FROM transfer_payload_pending WHERE id=?').get(args.transferId))throw Error('Detached payload import remains pending or unknown');const row=this.db.prepare('SELECT binding FROM transfer_payloads WHERE id=?').get(args.transferId);if(row&&JSON.parse(row.binding).binding.planHash!==args.payloadPlanHash)throw Error('Signed release must bind the sealed payload plan');}
 async selected(args){await this.context(args.session);const row=this.db.prepare('SELECT p.* FROM transfer_payloads p JOIN transfer_evidence e ON e.id=p.id WHERE p.id=? AND e.session=? AND e.hash=?').get(args.transferId,args.session,args.evidenceHash);if(!row)throw Error('Activated historical payloads unavailable');const manifest=JSON.parse(row.binding);if(manifest.binding.planHash!==args.planHash)throw Error('Historical payload plan identity changed');return {binding:manifest.binding,records:JSON.parse(row.records)};}
 read=async args=>{const {binding,records}=await this.selected(args),offset=args.offset??0,limit=args.limit??25;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>25)throw Error('Historical payload metadata pages require 1–25 records');const items=records.slice(offset,offset+limit).map(({chunks,...body})=>({...body,historicalOnly:true,executionAuthority:false}));return {binding,items,nextOffset:offset+items.length<records.length?offset+items.length:null,executionAuthority:false};};
 readBody=async args=>{const {records}=await this.selected(args),record=records.find(row=>row.id===args.resourceId),offset=args.offset??0,limit=args.maxBytes??CHUNK;if(!record||!Number.isSafeInteger(offset)||offset<0||offset>record.size||!Number.isSafeInteger(limit)||limit<1||limit>CHUNK)throw Error('Exact historical resource and bounded byte page required');
  const fd=openSync(join(this.directory,record.sha256+'.blob'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const before=fstatSync(fd);if(!before.isFile()||before.size!==record.size)throw Error('Historical payload storage changed');
   const end=Math.min(record.size,offset+limit),parts=[];for(let index=Math.floor(offset/CHUNK);index<Math.ceil(end/CHUNK);index++){const expected=record.chunks[index],raw=Buffer.alloc(expected.bytes);if(readSync(fd,raw,0,raw.length,index*CHUNK)!==raw.length||hash(raw)!==expected.sha256)throw Error('Historical payload chunk integrity changed');parts.push(raw.subarray(Math.max(0,offset-index*CHUNK),Math.min(raw.length,end-index*CHUNK)));}
   const raw=Buffer.concat(parts);return {data:raw.toString('base64'),encoding:'base64',size:record.size,sha256:record.sha256,nextOffset:end<record.size?end:null,executionAuthority:false};
  }finally{closeSync(fd);}
 };
}
