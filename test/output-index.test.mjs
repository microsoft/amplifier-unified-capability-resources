import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ResourceStore} from '../src/index.js';
import {Outputs} from '../src/outputs.js';
import {indexSavedImageOutputs} from '../src/migration.js';
test('offline image indexing preserves versions, exact bytes and origin without replay',()=>{
 const directory=mkdtempSync(join(tmpdir(),'saved-output-')),session='ahp-session:/original',sha=b=>createHash('sha256').update(b).digest('hex');let store;
 try{
  store=new ResourceStore(directory);const ctx={session,workingDirectory:directory,activeTurnId:'original-input'},rows=[];
  for(let n=1;n<=2;n++){
   const bytes=Buffer.from('original image '+n),definition={kind:'image',path:'image.png',title:'Image '+n,imageResult:{version:1,operation:'generate',requestId:'request-'+n,toolCallId:'tool-'+n,sha256:sha(bytes)}};
   const artifact=store.save(ctx,definition,{content:'data:image/png;base64,'+bytes.toString('base64')});
   rows.push({artifact,bytes,body:store.db.prepare('SELECT hash FROM versions WHERE artifact=? AND revision=?').get(artifact.id,n).hash});
  }
  const originals=rows.map(row=>readFileSync(join(store.blobs,row.body+'.json')));
  assert.throws(()=>indexSavedImageOutputs({directory,session}),/owner|lease/);
  store.close();store=null;
  const first=indexSavedImageOutputs({directory,session,limit:1});assert.equal(first.items[0].status,'indexed');assert.ok(first.nextAfter);
  const second=indexSavedImageOutputs({directory,session,after:first.nextAfter,limit:1});assert.equal(second.items[0].status,'indexed');assert.equal(second.nextAfter,null);
  assert.deepEqual(indexSavedImageOutputs({directory,session}).items.map(row=>row.status),['already-indexed','already-indexed']);
  assert.deepEqual(indexSavedImageOutputs({directory,session:'ahp-session:/other'}).items,[]);
  store=new ResourceStore(directory);const outputs=new Outputs(store,async()=>({session})),saved=outputs.list(session).items;
  assert.equal(saved.length,2);
  for(let i=0;i<2;i++){const item=saved.find(item=>item.canvasVersion===i+1);assert.deepEqual(outputs.content(item),rows[i].bytes);assert.equal(item.origin.messageId,'original-input:input');assert.equal(item.createdAt,rows[i].artifact.modifiedAt);assert.deepEqual(readFileSync(join(store.blobs,rows[i].body+'.json')),originals[i]);}
  store.close();store=null;
  writeFileSync(join(directory,'bodies',rows[0].body+'.json'),'changed');
  assert.equal(indexSavedImageOutputs({directory,session,limit:1}).items[0].status,'retained');
 }finally{store?.close();rmSync(directory,{recursive:true,force:true});}
});
