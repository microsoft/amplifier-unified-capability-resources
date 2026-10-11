import {spawn as start} from 'node:child_process';
import {existsSync,accessSync,constants,statSync} from 'node:fs';
import {realpath,stat} from 'node:fs/promises';
import {hostname} from 'node:os';
import {join,delimiter,isAbsolute,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

function executable(name,env){for(const directory of (env.PATH||'').split(delimiter).filter(Boolean)){const path=join(directory,name);try{accessSync(path,constants.X_OK);if(statSync(path).isFile())return path;}catch{}}}
export function createFileRevealer({platform=process.platform,env=process.env,spawn=start,findExecutable=name=>executable(name,env),host={id:createHash('sha256').update(hostname()).digest('hex'),label:hostname()},instanceId=randomUUID(),timeoutMs=8000}={}){
 const command=platform==='darwin'&&existsSync('/usr/bin/open')?'/usr/bin/open':platform==='win32'?findExecutable('explorer.exe'):platform==='linux'&&(env.DISPLAY||env.WAYLAND_DISPLAY)?findExecutable('gdbus'):undefined;
 const status=()=>({host,instanceId,available:!!command,label:platform==='darwin'?'Reveal in Finder':platform==='win32'?'Reveal in Explorer':'Reveal in file manager',detail:'Opens on the named app host, which may be a different computer from this browser. Download the artifact to use it on this device.'});
 const prepare=async(descriptor,args)=>{
  if(args.hostId!==host.id||args.instanceId!==instanceId)throw Error('The owning app host changed. Refresh this artifact before revealing it.');
  if(!command)throw Error('No desktop file manager is available on '+host.label+'. Copy the path or download the artifact.');
  const path=descriptor.path,workspace=descriptor.workspacePath||descriptor.workspaceId;
  if(!path||!isAbsolute(path)||!workspace||!isAbsolute(workspace))throw Error('This artifact has no saved host file path.');
  let actual,root;try{[actual,root]=await Promise.all([realpath(path),realpath(workspace)]);if(!(await stat(actual)).isFile())throw Error();}catch{throw Error('The original file is unavailable. You can still download the saved artifact.');}
  const rel=relative(root,actual);if(actual!==path||rel==='..'||rel.startsWith('..'+(platform==='win32'?'\\':'/'))||isAbsolute(rel))throw Error('The original file location changed. Refresh the artifact before revealing it.');
  const arguments_=platform==='darwin'?['-R',path]:platform==='win32'?['/select,'+path]:['call','--session','--dest','org.freedesktop.FileManager1','--object-path','/org/freedesktop/FileManager1','--method','org.freedesktop.FileManager1.ShowItems',"['"+pathToFileURL(path).href.replace(/'/g,'%27')+"']",''];
  return ()=>new Promise((resolve,reject)=>{
   let child,done=false,timer;const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve({status:'requested',host,message:'Reveal requested on '+host.label+'.'});};
   try{child=spawn(command,arguments_,{stdio:'ignore',shell:false});}catch{finish(Object.assign(Error('The host file manager could not be started.'),{executed:false}));return;}
   child.once('error',()=>finish(Object.assign(Error('The host file manager could not be started.'),{executed:false})));
   child.once('exit',code=>finish(code===0?null:Object.assign(Error('The host file manager did not confirm the request. Check that host before trying again.'),{executed:true})));
   timer=setTimeout(()=>{try{child.kill()}catch{}finish(Object.assign(Error('The reveal outcome is unknown. Check the owning host before trying again.'),{executed:true}));},timeoutMs);
  });
 };
 return {status,prepare};
}

/** One saved intent per command; a lost reply or restart never repeats the OS effect. */
export async function revealArtifact(store,revealer,session,descriptor,args,commandId){
 if(typeof commandId!=='string'||!commandId||commandId.length>200)throw Error('An exact reveal command identity is required.');
 const signature=JSON.stringify([descriptor.id,args.version,args.hostId,args.instanceId]);
 const read=()=>store.db.prepare("SELECT id,payload FROM events WHERE session=? AND json_extract(payload,'$.kind')='file-reveal' AND json_extract(payload,'$.commandId')=? ORDER BY id LIMIT 1").get(session,commandId);
 const previous=read();const resume=row=>{const saved=JSON.parse(row.payload);if(saved.signature!==signature)throw Error('The reveal command already belongs to another target.');if(saved.status==='completed')return saved.result;throw Error(saved.status==='rejected'?saved.message:'The reveal outcome is unknown. Check the owning host before trying again.');};
 if(previous)return resume(previous);
 const run=await revealer.prepare(descriptor,args);const raced=read();if(raced)return resume(raced);
 const receipt={kind:'file-reveal',commandId,signature,status:'pending'};
 const row=store.db.prepare('INSERT INTO events(artifact,session,payload) VALUES(?,?,?)').run(descriptor.id,session,JSON.stringify(receipt));
 const save=value=>store.db.prepare('UPDATE events SET payload=? WHERE id=?').run(JSON.stringify({...receipt,...value}),row.lastInsertRowid);
 try{const result=await run();save({status:'completed',result});return result;}catch(error){save({status:error.executed===false?'rejected':'unknown',message:error.message});throw error;}
}
