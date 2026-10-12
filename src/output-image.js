/** Producer receipts are provenance only; exact local PNG bytes are verified. */
import Ajv from 'ajv';
import {createHash} from 'node:crypto';
import {snapshotFile,pngInfo} from './output-files.js';
const text={type:'string',minLength:1,maxLength:500},sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const validate=new Ajv({strict:false}).compile(object({
 schema:{const:'amplifier.image.receipt.v1'},status:{const:'completed'},requestId:text,requestHash:sha,backend:text,model:text,operation:{enum:['generate','edit']},
 inputs:{type:'array',maxItems:4,items:object({path:text,sha256:sha,role:{enum:['target','reference']}})},
 artifact:object({path:text,sha256:sha,bytes:{type:'integer',minimum:1,maximum:8388608},mimeType:{const:'image/png'},width:{type:'integer',minimum:1,maximum:4096},height:{type:'integer',minimum:1,maximum:4096},mode:{enum:['RGB','RGBA']}}),
 options:{type:'object',maxProperties:10},text:{type:'string',maxLength:32000},receiptPath:text,providerRequestId:{type:['string','null'],maxLength:500},usage:{type:['object','null'],maxProperties:20}
},['schema','status','requestId','requestHash','backend','model','operation','inputs','artifact']));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function imageReceipt(workspace,path){
 const raw=snapshotFile(workspace,path).data;if(raw.length>64000)throw Error('Image receipt exceeds 64 KB.');
 const receipt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 if(!validate(receipt))throw Error('Choose a valid completed image receipt with exact artifact metadata.');
 if((receipt.operation==='edit')!==!!receipt.inputs.length||receipt.inputs.length&&(receipt.inputs[0].role!=='target'||receipt.inputs.slice(1).some(row=>row.role!=='reference')))throw Error('Image edit receipt requires its original target input hash.');
 const captured=snapshotFile(workspace,receipt.artifact.path),info=pngInfo(captured.data),artifact=receipt.artifact;
 if(hash(captured.data)!==artifact.sha256||captured.data.length!==artifact.bytes||info.width!==artifact.width||info.height!==artifact.height||captured.data[25]!==({RGB:2,RGBA:6})[artifact.mode])throw Error('Image bytes no longer match the completed receipt.');
 const metadata=Object.fromEntries(['requestId','requestHash','backend','model','operation','inputs','options','providerRequestId','usage','text'].filter(key=>Object.hasOwn(receipt,key)).map(key=>[key,receipt[key]]));
 return {...captured,receipt:{...metadata,receiptSha256:hash(raw),provenance:'producer-reported; local artifact bytes verified'}};
}
