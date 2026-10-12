/** Read-only bounded Git evidence, matching Main's no-filter/no-hook contract. */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const digest=b=>createHash('sha256').update(b).digest('hex');
async function invoke(cwd,args,{overrides=[],limit=2_000_000,missing=false}={}) {
 return new Promise((resolve,reject)=>{
  const child=spawn('git',['--literal-pathspecs','-c','core.fsmonitor=false','-c','core.pager=cat','-c','core.hooksPath=/dev/null',...overrides,'-C',cwd,...args],{env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1'},stdio:['ignore','pipe','pipe']});
  const out=[],err=[];let size=0,failure;const stop=message=>{failure??=Error(message);child.kill('SIGKILL');};
  const timer=setTimeout(()=>stop('Git review timed out; choose a narrower file.'),10_000);
  for(const [stream,chunks] of [[child.stdout,out],[child.stderr,err]])stream.on('data',data=>{size+=data.length;if(size>limit)stop('Git review exceeded its output limit; choose a narrower file.');else chunks.push(data);});
  child.on('error',e=>{failure=e});child.on('close',code=>{clearTimeout(timer);if(failure)reject(failure);else if(code!==0&&!(missing&&code===1))reject(Error('Git review could not resolve this repository or revision: '+Buffer.concat(err).toString().slice(0,300)));else resolve(Buffer.concat(out));});
 });
}
async function command(cwd,args) {
 const keys=await invoke(cwd,['config','--null','--name-only','--get-regexp','^filter\\..*\\.(clean|smudge|process|required)$'],{limit:65536,missing:true}),overrides=[];
 for(const driver of [...new Set(keys.toString().split('\0').filter(Boolean).map(k=>k.slice(0,k.lastIndexOf('.'))))].sort())for(const [suffix,value] of [['clean',''],['smudge',''],['process',''],['required','false']])overrides.push('-c',driver+'.'+suffix+'='+value);
 return invoke(cwd,args,{overrides});
}
export async function gitSnapshot(cwd,mode,base,path) {
 if(!['unstaged','staged','branch'].includes(mode))throw Error('Choose a supported review mode.');
 if(path&&(path.startsWith('/')||path.split(/[\\/]/).includes('..')||path.includes('\0')))throw Error('Review paths must be relative to the conversation workspace.');
 const head=(await command(cwd,['rev-parse','--verify','HEAD^{commit}'])).toString().trim();let baseline=null;
 if(mode==='branch'){if(!base||base.startsWith('-'))throw Error('Choose an existing base revision.');baseline=(await command(cwd,['rev-parse','--verify','--end-of-options',base+'^{commit}'])).toString().trim();}
 const args=['diff','--no-ext-diff','--no-textconv','--no-color','--no-renames','--src-prefix=a/','--dst-prefix=b/','--unified=3',...(mode==='branch'?[baseline,head]:mode==='staged'?['--cached',head]:[]),'--',...(path?[path]:[])],data=await command(cwd,args);
 if((await command(cwd,['rev-parse','--verify','HEAD^{commit}'])).toString().trim()!==head||mode!=='branch'&&!data.equals(await command(cwd,args)))throw Error('The repository changed during review. Inspect it again.');
 return {data,review:{sha256:digest(data),head,base:baseline,mode,notice:'Immutable read-only diff. Hooks, external diff, textconv and clean/smudge/process filters are disabled. Untracked and binary contents are excluded.'}};
}
function pathFromHeader(header,prefix){
 header=header.split('\t',1)[0];
 if(header.startsWith('"')){
  if(!header.endsWith('"'))return;const bytes=[],escapes={a:7,b:8,t:9,n:10,v:11,f:12,r:13,'"':34,'\\':92};
  for(let i=1;i<header.length-1;){let ch=header[i++];if(ch!=='\\'){const cp=header.codePointAt(i-1);ch=String.fromCodePoint(cp);i+=ch.length-1;bytes.push(...Buffer.from(ch));continue;}const oct=header.slice(i,-1).match(/^[0-7]{1,3}/);if(oct){const v=parseInt(oct[0],8);if(v>255)return;bytes.push(v);i+=oct[0].length;}else{ch=header[i++];if(!(ch in escapes))return;bytes.push(escapes[ch]);}}
  try{header=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(bytes));}catch{return;}
 }
 return header.startsWith(prefix)?header.slice(prefix.length):undefined;
}
export function gitAnchors(text){
 const result=new Set();let left,right,old,current;
 for(const line of text.split('\n')){const match=line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if(line.startsWith('diff --git ')){left=right=old=current=undefined;}
  else if(old===undefined&&current===undefined&&line.startsWith('--- '))left=pathFromHeader(line.slice(4),'a/');
  else if(old===undefined&&current===undefined&&line.startsWith('+++ '))right=pathFromHeader(line.slice(4),'b/');
  else if(match){old=Number(match[1]);current=Number(match[2]);}
  else if(old!==undefined&&current!==undefined){if(line.startsWith('-')){if(left)result.add(JSON.stringify([left,'left',old]));old++;}else if(line.startsWith('+')){if(right)result.add(JSON.stringify([right,'right',current]));current++;}else if(line.startsWith(' ')){if(left)result.add(JSON.stringify([left,'left',old]));if(right)result.add(JSON.stringify([right,'right',current]));old++;current++;}}
 }return result;
}
