import {constants,openSync,closeSync,fstatSync,readSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,relative,isAbsolute,join,basename} from 'node:path';
import {inflateSync} from 'node:zlib';
export const MAX_OUTPUT_BYTES=8*1024*1024;
/** Open each path component without following links; retain directory descriptors. */
export function snapshotFile(root,value){
 const workspace=realpathSync(root),path=resolve(workspace,value),rel=relative(workspace,path);
 if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel)||value.includes('\0'))throw Error('Choose a regular file inside this conversation workspace.');
 const fds=[];let fd;
 try{
  const pieces=rel.split('/');let current=workspace;
  fds.push(openSync(workspace,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW));
  for(const piece of pieces.slice(0,-1)){
   current=join(current,piece);const parent=fds.at(-1),next=process.platform==='linux'?`/proc/self/fd/${parent}/${piece}`:current;
   const directory=openSync(next,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);fds.push(directory);
   if(process.platform!=='linux'&&(realpathSync(current)!==current||lstatSync(current).isSymbolicLink()))throw Error('Output folder changed.');
  }
  fd=openSync(process.platform==='linux'?`/proc/self/fd/${fds.at(-1)}/${pieces.at(-1)}`:path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const before=fstatSync(fd);if(!before.isFile()||before.size>MAX_OUTPUT_BYTES)throw Error('Choose a regular output no larger than 8 MiB.');
  const data=Buffer.alloc(before.size);let offset=0;
  while(offset<data.length){const n=readSync(fd,data,offset,Math.min(262144,data.length-offset),offset);if(!n)throw Error('Output changed while reading.');offset+=n;}
  const after=fstatSync(fd);if(['size','mtimeMs','ctimeMs','ino','dev'].some(k=>before[k]!==after[k])||process.platform!=='linux'&&realpathSync(path)!==path)throw Error('Output changed while reading.');
  return {data,path,filename:basename(path)};
 }finally{if(fd!==undefined)closeSync(fd);for(const dir of fds.reverse())closeSync(dir);}
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(bytes){let n=0xffffffff;for(const byte of bytes)n=crcTable[(n^byte)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
/** Validate bounded 8-bit RGB/RGBA PNGs before offering them as image evidence. */
export function pngInfo(data){
 if(data.length>MAX_OUTPUT_BYTES||!data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw Error('Choose an exact saved RGB/RGBA PNG.');
 let offset=8,width,height,color,ended=false,idat=false,idatEnded=false;const compressed=[];
 while(offset+12<=data.length){const size=data.readUInt32BE(offset),end=offset+12+size;if(end>data.length)throw Error('Incomplete PNG.');const type=data.toString('ascii',offset+4,offset+8),bytes=data.subarray(offset+8,end-4);
  if(crc(data.subarray(offset+4,end-4))!==data.readUInt32BE(end-4))throw Error('PNG integrity check failed.');
  if(offset===8&&type!=='IHDR'||type==='IHDR'&&offset!==8)throw Error('Invalid PNG header.');
  if(type==='IHDR'){if(size!==13)throw Error('Invalid PNG header.');width=bytes.readUInt32BE(0);height=bytes.readUInt32BE(4);color=bytes[9];if(!width||!height||width>4096||height>4096||bytes[8]!==8||![2,6].includes(color)||bytes[10]||bytes[11]||bytes[12])throw Error('Choose an 8-bit noninterlaced RGB/RGBA PNG up to 4096 pixels per side.');}
  else if(type==='IDAT'){if(idatEnded)throw Error('Invalid PNG data order.');idat=true;compressed.push(bytes);}
  else {if(idat)idatEnded=true;if(type==='IEND'){if(size||end!==data.length||!idat)throw Error('Invalid PNG ending.');ended=true;break;}if(type==='acTL'||type==='fcTL'||type==='fdAT'||type[0]===type[0].toUpperCase()&&type!=='PLTE')throw Error('Unsupported PNG chunk.');}
  offset=end;
 }
 if(!ended)throw Error('Incomplete PNG.');const stride=width*(color===6?4:3)+1,expected=stride*height,raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected+1});if(raw.length!==expected)throw Error('Invalid PNG pixels.');for(let row=0;row<height;row++)if(raw[row*stride]>4)throw Error('Invalid PNG row filter.');return {width,height};
}
