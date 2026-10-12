import {parentPort,workerData} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {snapshotFile} from './output-files.js';
import {validateMedia,MAX_MEDIA_BYTES} from './media-validation.js';
try{
 const {root,path,expectedSha256}=workerData;
 if(!/^[a-f0-9]{64}$/.test(expectedSha256??''))throw Error('Choose an exact SHA-256.');
 const captured=snapshotFile(root,path,{maxBytes:MAX_MEDIA_BYTES,strictRoot:true});
 if(createHash('sha256').update(captured.data).digest('hex')!==expectedSha256)throw Error('Media contents changed from the expected version.');
 const media=validateMedia(captured.data);
 parentPort.postMessage({...captured,media},[captured.data.buffer]);
}catch(error){parentPort.postMessage({error:error.message});}
