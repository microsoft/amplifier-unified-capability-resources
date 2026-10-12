import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createResourcesCapability} from '../src/index.js';

test('file digest admission preserves exact saved bytes and refuses changed source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'resource-digest-')),workspace=join(root,'work');
 await mkdir(workspace);
 const cap=createResourcesCapability({directory:join(root,'resources'),inspectSession:async session=>({session,workingDirectory:workspace,activeTurnId:'turn-one'})});
 const act=args=>cap.action({version:1,topic:'canvas',operation:'canvas.openFile',channel:'ahp-session:/one',args});
 try{
  const bytes=Buffer.from('original file'),sha=createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(workspace,'saved.txt'),bytes);
  const first=(await act({path:'saved.txt',expectedSha256:sha})).result.artifact;
  assert.equal(first.messageId,'turn-one');
  await writeFile(join(workspace,'saved.txt'),'changed');
  await assert.rejects(act({path:'saved.txt',expectedSha256:sha}),/bytes changed/);
  await assert.rejects(act({path:'saved.txt',expectedSha256:'bogus'}),/SHA-256/);
  assert.equal(cap.store.body('ahp-session:/one',first.id).content,'original file');
  assert.equal(cap.store.row('ahp-session:/one',first.id).revision,1);
  // A caller that intentionally opens the newer file still uses the same API.
  const newer=(await act({path:'saved.txt'})).result.artifact;
  assert.equal(newer.id,first.id);assert.equal(newer.revision,2);
 }finally{cap.close();await rm(root,{recursive:true,force:true});}
});

test('relocated execution directory is authoritative for source admission',async()=>{
 const root=await mkdtemp(join(tmpdir(),'resource-relocated-')),original=join(root,'original'),execution=join(root,'execution');
 await mkdir(original);await mkdir(execution);
 await writeFile(join(original,'result.txt'),'old source');await writeFile(join(execution,'result.txt'),'new source');
 const cap=createResourcesCapability({directory:join(root,'resources'),inspectSession:async session=>({session,workingDirectory:original,executionDirectory:execution,activeTurnId:'turn-two'})});
 const act=path=>cap.action({version:1,topic:'canvas',operation:'canvas.openFile',channel:'ahp-session:/two',args:{path}});
 try{
  const artifact=(await act('result.txt')).result.artifact;
  assert.equal(cap.store.body('ahp-session:/two',artifact.id).content,'new source');
  await assert.rejects(act(join(original,'result.txt')),/outside the execution workspace/);
 }finally{cap.close();await rm(root,{recursive:true,force:true});}
});
