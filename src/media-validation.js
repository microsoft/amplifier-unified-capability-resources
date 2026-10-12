/** Inert structural checks matching Main's media contract; decoder success is separate. */
export const MAX_MEDIA_BYTES=32*1024*1024;
const fail=message=>{throw Error(message);};
function dimensions(w,h){if(!w||!h||w>4096||h>4096||w*h>4_000_000)fail('Media dimensions exceed 4096 per side or 4 million pixels.');}
function gif(data){
 if(data.length<13)fail('Truncated GIF header.');
 const width=data.readUInt16LE(6),height=data.readUInt16LE(8),packed=data[10];dimensions(width,height);
 let position=13,frames=0,duration=0,delay=0,loop=null,pending=false;
 const take=n=>{if(position+n>data.length)fail('Truncated GIF block.');const out=data.subarray(position,position+n);position+=n;return out;};
 const blocks=capture=>{let count=0,payload;for(;;){const n=take(1)[0];if(!n)return {count,payload};count++;if(capture&&(count>1||n!==3))fail('Invalid GIF loop metadata.');const bytes=take(n);if(capture)payload=bytes;}};
 const palette=!!(packed&128);if(palette)take(3*(2<<(packed&7)));
 while(position<data.length){const marker=take(1)[0];
  if(marker===0x3b){if(!frames||position!==data.length||pending)fail('GIF requires image frames and an exact final trailer.');return {mimeType:'image/gif',width,height,frameCount:frames,durationMs:duration,loopCount:loop,decodedPixelBytesEstimate:width*height*4*frames};}
  if(marker===0x21){const type=take(1)[0];
   if(type===0xf9){if(pending||take(1)[0]!==4)fail('Invalid GIF graphic control block.');const c=take(4);if(c[0]&0xe0||((c[0]>>2)&7)>3||take(1)[0]!==0)fail('Unsupported GIF graphic control.');delay=c.readUInt16LE(1)*10;pending=true;}
   else if(type===0xff){if(take(1)[0]!==11)fail('Invalid GIF application block.');const application=take(11).toString('ascii'),looping=['NETSCAPE2.0','ANIMEXTS1.0'].includes(application),{count,payload}=blocks(looping);if(looping){if(loop!==null||count!==1||payload[0]!==1)fail('Invalid GIF loop metadata.');loop=payload.readUInt16LE(1);}}
   else if(type===0xfe)blocks(false);else fail('Unsupported GIF extension.');
  }else if(marker===0x2c){const d=take(9),left=d.readUInt16LE(0),top=d.readUInt16LE(2),w=d.readUInt16LE(4),h=d.readUInt16LE(6),flags=d[8];if(!w||!h||left+w>width||top+h>height||flags&0x18)fail('Invalid GIF frame bounds.');const local=!!(flags&128);if(local)take(3*(2<<(flags&7)));const lzw=take(1)[0];if(!(palette||local)||lzw<2||lzw>8)fail('Invalid GIF color table or LZW code size.');if(!blocks(false).count)fail('Empty GIF image data.');frames++;duration+=delay;delay=0;pending=false;if(frames>500||width*height*4*frames>128*1024*1024)fail('GIF exceeds 500 frames or the 128 MiB decoded-pixel estimate.');}
  else fail('Invalid GIF block marker.');
 }fail('GIF trailer is missing.');
}
function atoms(data,start,end){const out=[];let pos=start;while(pos<end){if(end-pos<8||out.length>=4096)fail('Truncated MP4 atom or excessive atom count.');let size=data.readUInt32BE(pos),header=8;const kind=data.toString('ascii',pos+4,pos+8);if(size===1){if(end-pos<16)fail('Truncated MP4 extended atom.');const large=data.readBigUInt64BE(pos+8);if(large>BigInt(end-pos))fail('Invalid MP4 atom size.');size=Number(large);header=16;}if(size<header||size>end-pos)fail('Invalid or unsupported MP4 atom size.');out.push({kind,start:pos+header,end:pos+size});pos+=size;}return out;}
function mp4(data){
 const top=atoms(data,0,data.length),of=(rows,kind)=>rows.filter(r=>r.kind===kind),one=(rows,kind)=>{const found=of(rows,kind);if(found.length!==1)fail('Invalid MP4 '+kind+' shape.');return found[0];},children=row=>atoms(data,row.start,row.end);
 const brand=one(top,'ftyp'),movie=one(top,'moov');if(!of(top,'mdat').length)fail('MP4 requires media data.');
 if(brand.end-brand.start<8||(brand.end-brand.start-8)%4||!['isom','iso2','mp41','mp42','avc1','M4V ','qt  '].includes(data.toString('ascii',brand.start,brand.start+4)))fail('Unsupported MP4 file brand.');
 const tracks=of(children(movie),'trak'),videos=[];if(!tracks.length||tracks.length>16)fail('MP4 requires bounded tracks.');
 for(const track of tracks){const rows=children(track),header=one(rows,'tkhd'),media=children(one(rows,'mdia')),handler=one(media,'hdlr');if(handler.end-handler.start<24)fail('Invalid MP4 handler.');if(data.toString('ascii',handler.start+8,handler.start+12)!=='vide')continue;
  const version=data[header.start],offset=version===0?76:version===1?88:null;if(offset===null||header.end-header.start<offset+8)fail('Invalid MP4 video dimensions.');const rw=data.readUInt32BE(header.start+offset),rh=data.readUInt32BE(header.start+offset+4);if(rw&65535||rh&65535)fail('Unsupported fractional MP4 dimensions.');const width=rw>>>16,height=rh>>>16;dimensions(width,height);
  const table=children(one(children(one(media,'minf')),'stbl')),description=one(table,'stsd');if(description.end-description.start<8||data.readUInt32BE(description.start)!==0)fail('Unsupported MP4 sample description version.');const entries=atoms(data,description.start+8,description.end),count=data.readUInt32BE(description.start+4);if(count!==entries.length||count<1||count>16||entries.some(e=>!['avc1','avc3','hvc1','hev1','vp09','av01','mp4v'].includes(e.kind)||e.end-e.start<78))fail('Unsupported MP4 video sample description.');
  const sizes=entries.map(e=>[data.readUInt16BE(e.start+24),data.readUInt16BE(e.start+26)]);for(const [w,h] of sizes)dimensions(w,h);if(new Set(sizes.map(s=>s.join(','))).size!==1)fail('Unsupported changing MP4 coded dimensions.');videos.push({mimeType:'video/mp4',width,height,codedWidth:sizes[0][0],codedHeight:sizes[0][1]});
 }if(videos.length!==1)fail('MP4 requires exactly one video track.');return videos[0];
}
export function validateMedia(data){if(!Buffer.isBuffer(data)||!data.length||data.length>MAX_MEDIA_BYTES)fail('Choose nonempty media up to 32 MiB.');if(['GIF87a','GIF89a'].includes(data.toString('ascii',0,6)))return gif(data);if(data.length>=8&&data.toString('ascii',4,8)==='ftyp')return mp4(data);fail('Only structurally valid GIF or MP4 media is supported.');}
