/** Startup admission only. Retained records/bodies are never reconstructed here. */
import {lstatSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const resourcesVersion=0x52530100, quiescenceVersion=0x52540100;
const columns={
 artifacts:'id:TEXT session:TEXT workspace:TEXT source_path:TEXT created:REAL modified:REAL revision:INTEGER',
 versions:'artifact:TEXT revision:INTEGER hash:TEXT definition:TEXT created:REAL message_id:TEXT',
 topics:'session:TEXT revision:INTEGER',events:'id:INTEGER artifact:TEXT session:TEXT payload:TEXT',
 apps:'artifact:TEXT state_revision:INTEGER',
 app_states:'artifact:TEXT state_revision:INTEGER definition_revision:INTEGER hash:TEXT summary:TEXT',
 app_definitions:'artifact:TEXT revision:INTEGER state_revision:INTEGER',
 attachments:'id:TEXT session:TEXT request:TEXT fingerprint:TEXT name:TEXT mime:TEXT size:INTEGER sha:TEXT received:INTEGER status:TEXT created:REAL committed_request:TEXT',
 attachment_metadata_revisions:'session:TEXT revision:INTEGER',
 transfer_exports:'id:TEXT session:TEXT envelope:TEXT',
 transfer_evidence:'id:TEXT source:TEXT native:TEXT hash:TEXT envelope:TEXT session:TEXT release:TEXT',
 transfer_payloads:'id:TEXT binding:TEXT records:TEXT',transfer_payload_pending:'id:TEXT binding:TEXT',
 legacy_document_imports:'source:TEXT id:TEXT fingerprint:TEXT session:TEXT metadata:TEXT',
 fence:'id:INTEGER value:TEXT',receipts:'id:TEXT value:TEXT',
};
const namespaces={
 base:{bit:1,tables:['artifacts','versions','topics','events']},
 apps:{bit:2,tables:['apps','app_states','app_definitions']},
 attachments:{bit:4,tables:['attachments']},
 transfer:{bit:8,tables:['transfer_exports','transfer_evidence']},
 payloads:{bit:16,tables:['transfer_payloads','transfer_payload_pending']},
 imports:{bit:32,tables:['legacy_document_imports']},
 attachmentRevisions:{bit:64,tables:['attachment_metadata_revisions']},
};
// Completed public factory epochs: 63389cc, 2732a8c, 64a0dfe, 4c4148e,
// 3498bd1. ResourceStore and reviewed offline imports also create partial stores.
// No arbitrary subset of tables is a legacy migration profile.
const legacyProfiles=new Set([1,3,7,15,31,95,33,35,39,47,63,127]);
const refuse=()=>{throw Object.assign(new Error('Resources authoritative schema unavailable; retained files require explicit recovery'),{code:-32009,executed:false});};
function metadata(db,kind,{fresh=false}={}){
 const version=db.prepare('PRAGMA user_version').get().user_version;
 const rows=db.prepare("SELECT name,type FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' LIMIT 17").all();
 if(!rows.length){if(fresh&&version===0)return 0;refuse();}
 if(rows.length>16)refuse();
 const names=new Set(rows.map(row=>row.name));
 for(const row of rows){
  if(row.type!=='table'||!Object.hasOwn(columns,row.name))refuse();
  const actual=db.prepare('SELECT name,type,hidden FROM pragma_table_xinfo(?) LIMIT 17').all(row.name);
  if(actual.some(column=>column.hidden!==0)||actual.map(column=>`${column.name}:${column.type.toUpperCase()}`).join(' ')!==columns[row.name])refuse();
 }
 if(kind==='quiescence'){
  if(names.size!==2||!names.has('fence')||!names.has('receipts')||![0,quiescenceVersion+1].includes(version))refuse();
  return 1;
 }
 let bits=0,expected=0;
 for(const {bit,tables} of Object.values(namespaces)){
  const count=tables.filter(table=>names.has(table)).length;
  if(count&&count!==tables.length)refuse();
  if(count){bits|=bit;expected+=count;}
 }
 if(expected!==names.size||!(bits&1)||(bits&16)&&!(bits&8)||(bits&64)&&!(bits&4))refuse();
 if(version===0){if(!legacyProfiles.has(bits))refuse();}
 else if(version!==resourcesVersion+bits)refuse();
 return bits;
}
function entry(path){try{return lstatSync(path);}catch(error){if(error.code==='ENOENT')return;throw error;}}
function preflight(path,kind){
 const main=entry(path),sidecars=['-wal','-shm','-journal'].map(suffix=>entry(path+suffix));
 if(!main){if(sidecars.some(Boolean))refuse();return;}
 if(!main.isFile()||main.isSymbolicLink()||sidecars.some(stat=>stat&&(!stat.isFile()||stat.isSymbolicLink())))refuse();
 let db;
 try{db=new DatabaseSync(path,{readOnly:true});metadata(db,kind);}
 catch{refuse();}
 finally{db?.close();}
}
/** Call only after the original owner OS lease, before either writable journal. */
export function preflightOwner(directory){
 preflight(join(directory,'resources.sqlite'),'resources');
 preflight(join(directory,'resources-quiescence.sqlite'),'quiescence');
}
/** Savepoints compose with the offline importer's existing transaction. */
export function initializeSchema(db,kind,parts,create){
 db.exec('SAVEPOINT resources_schema');
 try{
  const prior=metadata(db,kind,{fresh:true});
  const bits=kind==='quiescence'?1:parts.reduce((mask,name)=>mask|namespaces[name].bit,prior);
  create();
  db.exec(`PRAGMA user_version=${(kind==='quiescence'?quiescenceVersion:resourcesVersion)+bits}`);
  if(metadata(db,kind)!==bits)refuse();
  db.exec('RELEASE resources_schema');
 }catch(error){db.exec('ROLLBACK TO resources_schema; RELEASE resources_schema');throw error;}
}
