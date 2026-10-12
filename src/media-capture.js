import {Worker} from 'node:worker_threads';
/** Called inside the Resources mutation queue; reads and structural parsing stay off-thread. */
export function captureMedia(root,path,expectedSha256){return new Promise((resolve,reject)=>{
 const worker=new Worker(new URL('./media-worker.js',import.meta.url),{workerData:{root,path,expectedSha256}});let result,error;
 const timer=setTimeout(()=>{error=Error('Media capture exceeded its time limit.');void worker.terminate();},15000);
 worker.on('message',value=>{if(value.error)error=Error(value.error);else result={...value,data:Buffer.from(value.data)};});
 worker.on('error',value=>{error=value;});
 worker.on('exit',code=>{clearTimeout(timer);if(error||code||!result)reject(error??Error('Media capture did not finish.'));else resolve(result);});
});}
