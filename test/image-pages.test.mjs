import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createResourcesCapability} from '../src/index.js';

test('large images expose exact immutable byte pages without changing legacy reads or conditional editing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'image-pages-')),workspace=join(root,'work'),directory=join(root,'resources');await mkdir(workspace);
 const inspectSession=async session=>({session,workingDirectory:workspace});let cap=createResourcesCapability({directory,inspectSession});
 const act=(operation,args)=>cap.action({version:1,topic:'canvas',channel:'ahp-session:/one',operation,args});
 try{
  const original=Buffer.alloc(8*1024*1024,7);Buffer.from('89504e470d0a1a0a','hex').copy(original);await writeFile(join(workspace,'large.png'),original);
  const a=(await act('canvas.openFile',{path:'large.png'})).result.artifact;
  const descriptor=await cap.resourceProvider.resolve({uri:a.bodyUri});assert.ok(descriptor.size>8*1024*1024);assert.match(descriptor.etag,/^"sha256:[a-f0-9]{64}"$/);
  const legacy=await cap.resourceProvider.read({uri:a.bodyUri,encoding:'utf-8'});assert.deepEqual(Buffer.from(JSON.parse(legacy.data).content.split(',')[1],'base64'),original);
  const read=async uri=>{
   const meta=await cap.resourceProvider.resolve({uri}),parts=[];
   for(let offset=0;offset<meta.size;offset+=262144){const u=new URL(uri);u.searchParams.set('offset',String(offset));u.searchParams.set('limit','262144');const value=await cap.resourceProvider.read({uri:u.href,encoding:'base64'});assert.ok(value.data.length<=349528);parts.push(Buffer.from(value.data,'base64'));}
   const bytes=Buffer.concat(parts);assert.equal(bytes.length,meta.size);assert.equal(meta.etag,JSON.stringify('sha256:'+createHash('sha256').update(bytes).digest('hex')));return bytes;
  };
  const originalBody=cap.store.body;cap.store.body=()=>{throw Error('Unexpected full body hydration');};const bytes=await read(a.bodyUri);cap.store.body=originalBody;
  assert.equal(bytes.toString(),legacy.data);
  for(const args of [{offset:-1,limit:1},{offset:0,limit:262145},{offset:descriptor.size+1,limit:1}]){const u=new URL(a.bodyUri);for(const [key,value] of Object.entries(args))u.searchParams.set(key,String(value));await assert.rejects(cap.resourceProvider.read({uri:u.href,encoding:'base64'}));}
  const other=new URL(a.bodyUri);other.searchParams.set('session','ahp-session:/two');await assert.rejects(cap.resourceProvider.resolve({uri:other.href}),/conversation/);
  const latest=await cap.resourceProvider.resolve({uri:a.editableUri});assert.equal(latest.etag,a.etag);
  await cap.resourceProvider.write({uri:a.editableUri,ifMatch:latest.etag,encoding:'utf-8',data:JSON.stringify({content:'data:image/png;base64,iVBORw0KGgo='})});
  assert.deepEqual(await read(a.bodyUri),bytes);
  await assert.rejects(cap.resourceProvider.write({uri:a.editableUri,ifMatch:latest.etag,encoding:'utf-8',data:'{}'}),/revision changed/);
  cap.close();cap=createResourcesCapability({directory,inspectSession});assert.deepEqual(await read(a.bodyUri),bytes);
  await writeFile(join(workspace,'too-large.png'),Buffer.alloc(8*1024*1024+1));await assert.rejects(act('canvas.openFile',{path:'too-large.png'}),/8 MiB/);
 }finally{cap.close();await rm(root,{recursive:true,force:true});}
});
