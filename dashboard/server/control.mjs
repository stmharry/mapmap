import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
export const ROOT=path.resolve(import.meta.dirname,'..');
export const DATA=path.resolve(process.env.MAPMAP_DATA||path.join(ROOT,'data'));
export const TOKEN=process.env.MAPMAP_TOKEN_FILE||path.join(DATA,'mcp.token');
let requestId=0;
export async function rpc(name,args={}){
 const token=(await readFile(process.env.MAPMAP_TOKEN_FILE||TOKEN,'utf8')).trim();
 const r=await fetch(process.env.MAPMAP_RPC||'http://127.0.0.1:49452/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({jsonrpc:'2.0',id:++requestId,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error(r.status===403?'MapMap authorization changed; retry after restart.':`MapMap HTTP ${r.status}`);
 const j=await r.json();if(j.error||j.result?.isError)throw Error(j.error?.message||j.result.content?.[0]?.text||'MapMap error');
 return j.result.structuredContent||{message:j.result.content?.[0]?.text};
}
export async function atomic(file,value){await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(value,null,2));await rename(file+'.tmp',file)}
export async function readJSON(file,fallback){try{return JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw e}}
export function validateVertices(v,width,height){
 if(!Array.isArray(v)||v.length!==4||v.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>width||p.y>height))throw Error('Four corners inside the output display are required.');
 const order=[0,1,3,2];let sign=0;
 for(let i=0;i<4;i++){const a=v[order[i]],b=v[order[(i+1)%4]],c=v[order[(i+2)%4]];const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);if(Math.abs(cross)<1||sign*cross<0)throw Error('Corners must form a convex, non-crossing quadrilateral.');sign=cross}
 return v;
}
export function freshCameras(status){return ['261222075881','310222077068'].map(serial=>{const c=status.cameras.find(c=>c.serial_number===serial);if(!c||c.state!=='live'||c.age_ms===null||c.age_ms>500)throw Error('Both tabletop cameras must have fresh frames.');return c})}
