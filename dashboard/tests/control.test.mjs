import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {rpc,validateVertices,freshCameras} from '../server/control.mjs';
test('quad validation accepts rotation and fractional nudges but rejects crossed or off-display corners',()=>{
 const v=[{x:1800,y:950},{x:100,y:950},{x:1800,y:100},{x:100,y:100}];assert.equal(validateVertices(v,1920,1080),v);
 for(const bad of [[v[0],v[1],v[3],v[2]],v.map((p,i)=>i===0?{x:NaN,y:p.y}:p),v.map(p=>({x:p.x+300,y:p.y})),[v[0],v[0],v[2],v[3]]])assert.throws(()=>validateVertices(bad,1920,1080));
});
test('camera gate resolves serials and refuses stale, missing or failed feeds',()=>{
 const cameras=['261222075881','310222077068'].map((serial_number,i)=>({serial_number,camera_id:10+i,state:'live',age_ms:10}));
 assert.equal(freshCameras({cameras})[1].camera_id,11);
 assert.throws(()=>freshCameras({cameras:cameras.slice(0,1)}));
 assert.throws(()=>freshCameras({cameras:cameras.map(c=>({...c,age_ms:501}))}));
 assert.throws(()=>freshCameras({cameras:cameras.map(c=>({...c,state:'error'}))}));
});
test('RPC renews token after restart and propagates upstream rejection without retrying mutations',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'mapmap-rpc-')),tokenFile=path.join(dir,'token');let expected='first',calls=0;
 const server=http.createServer(async(req,res)=>{calls++;if(req.headers.authorization!=='Bearer '+expected){res.writeHead(403);return res.end()}
 let raw='';for await(const c of req)raw+=c;const data=JSON.parse(raw);
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:data.id,result:data.params.name==='fail'?{isError:true,content:[{text:'Disconnected projector'}]}:{isError:false,structuredContent:{generation:expected}}}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const previous=[process.env.MAPMAP_RPC,process.env.MAPMAP_TOKEN_FILE];
 process.env.MAPMAP_RPC=`http://127.0.0.1:${server.address().port}/mcp`;process.env.MAPMAP_TOKEN_FILE=tokenFile;
 try{await writeFile(tokenFile,expected);assert.deepEqual(await rpc('get_state'),{generation:'first'});expected='second';await writeFile(tokenFile,expected);assert.deepEqual(await rpc('get_state'),{generation:'second'});
 await assert.rejects(rpc('fail'),/Disconnected projector/);assert.equal(calls,3);await writeFile(tokenFile,'old');await assert.rejects(rpc('get_state'),/authorization changed/);assert.equal(calls,4);
 }finally{server.close();await rm(dir,{recursive:true,force:true});for(const [i,k] of ['MAPMAP_RPC','MAPMAP_TOKEN_FILE'].entries()){if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i]}}
});
