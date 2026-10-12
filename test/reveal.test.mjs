import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {EventEmitter} from 'node:events';
import {createFileRevealer} from '../src/reveal.js';import {createResourcesCapability} from '../src/index.js';
test('reveal binds the exact artifact, host and instance; completed and unknown commands never replay after restart',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'artifact-reveal-'))),work=join(root,'work');await mkdir(work);const file=join(work,'saved.txt');await writeFile(file,'original');
 let calls=0,unknown=false;const options={directory:join(root,'resources'),inspectSession:async session=>({session,workingDirectory:work}),fileRevealer:{status:()=>({host:{id:'host',label:'App host'},instanceId:'instance',available:true}),prepare:async(d,a)=>{assert.equal(d.path,file);if(a.hostId!=='host'||a.instanceId!=='instance')throw Error('host changed');return async()=>{calls++;if(unknown)throw Error('unknown effect');return {status:'requested',host:{id:'host',label:'App host'}}}}}};
 let cap=createResourcesCapability(options);const act=(operation,args,commandId='first',channel='ahp-session:/one')=>cap.action({topic:'canvas',version:1,channel,operation,args,commandId});
 try{
  const {result:{artifact:a}}=await act('canvas.openFile',{path:file});assert.equal(a.fileReveal.instanceId,'instance');const args={id:a.id,version:1,hostId:'host',instanceId:'instance'};
  await assert.rejects(act('canvas.reveal',{...args,hostId:'other'}),/host changed/);await assert.rejects(act('canvas.reveal',args,'other','ahp-session:/two'),/not found/);assert.equal(calls,0);
  await act('canvas.reveal',args);assert.equal(calls,1);assert.equal((await act('canvas.reveal',args)).result.status,'requested');assert.equal(calls,1);
  unknown=true;await assert.rejects(act('canvas.reveal',args,'lost'),/unknown/);assert.equal(calls,2);cap.close();cap=createResourcesCapability(options);
  await act('canvas.reveal',args);await assert.rejects(act('canvas.reveal',args,'lost'),/outcome is unknown/);assert.equal(calls,2);await assert.rejects(act('canvas.reveal',{...args,instanceId:'new'},'first'),/another target/);
  assert.equal(await readFile(file,'utf8'),'original');assert.equal((await cap.read({uri:'amplifier-capability://canvas',scope:'ahp-session:/one'})).revision,1);
 }finally{cap.close();await rm(root,{recursive:true,force:true})}
});
test('platform arguments never execute a shell; changed source and unavailable desktop refuse',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'reveal-platform-'))),file=join(root,"document's [test] Ω.txt");await writeFile(file,'original');const host={id:'h',label:'App host'},args={hostId:'h',instanceId:'i'},descriptor={path:file,workspacePath:root};
 try{
  for(const platform of ['darwin','win32','linux']){
   let call;const revealer=createFileRevealer({platform,host,instanceId:'i',env:{DISPLAY:':0'},findExecutable:name=>'/tools/'+name,spawn:(command,arguments_,options)=>{call={command,arguments_,options};const child=new EventEmitter();queueMicrotask(()=>child.emit('exit',0));return child;}});
   assert.equal((await (await revealer.prepare(descriptor,args))()).status,'requested');assert.equal(call.options.shell,false);assert.equal(call.options.stdio,'ignore');assert.ok(call.arguments_.some(value=>value.includes(platform==='linux'?'document%27s':"document's")));
  }
  const headless=createFileRevealer({platform:'linux',env:{},host,instanceId:'i'});assert.equal(headless.status().available,false);await assert.rejects(headless.prepare(descriptor,args),/No desktop/);
  const supported=createFileRevealer({platform:'linux',env:{DISPLAY:':0'},findExecutable:()=>'/tools/gdbus',host,instanceId:'i'});
  await assert.rejects(supported.prepare(descriptor,{...args,instanceId:'old'}),/changed/);
  await rm(file);await symlink(join(root,'outside'),file);await assert.rejects(supported.prepare(descriptor,args),/unavailable/);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('file manager timeout stays unknown and has no automatic retry',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'reveal-timeout-'))),file=join(root,'doc');await writeFile(file,'x');let killed=0,calls=0;
 try{const revealer=createFileRevealer({platform:'linux',env:{DISPLAY:':0'},findExecutable:()=>'/tools/gdbus',host:{id:'h',label:'Host'},instanceId:'i',timeoutMs:5,spawn:()=>{calls++;const child=new EventEmitter();child.kill=()=>{killed++;return true};return child}});await assert.rejects((await revealer.prepare({path:file,workspacePath:root},{hostId:'h',instanceId:'i'}))(),/outcome is unknown/);assert.equal(calls,1);assert.equal(killed,1);}finally{await rm(root,{recursive:true,force:true})}
});
