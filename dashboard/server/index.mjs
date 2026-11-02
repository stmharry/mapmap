import http from 'node:http';
import {readFile,writeFile,mkdir,stat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {ROOT,DATA,rpc,atomic,readJSON,validateVertices,freshCameras} from './control.mjs';
const port=Number(process.env.PORT||3210), cameraBase=process.env.CAMERA_URL||'http://127.0.0.1:6060';
await mkdir(path.join(DATA,'media'),{recursive:true});await mkdir(path.join(DATA,'profiles'),{recursive:true});
const settingsFile=path.join(DATA,'settings.json');
let settings=await readJSON(settingsFile,{selectedDisplay:'HDMI-1-0',activeImage:null,blackout:false,images:[]});
let calibrating=false,calibration=await readJSON(path.join(DATA,'calibration.json'),{status:'Not calibrated',message:'Run calibration to measure the tabletop.'});
let queue=Promise.resolve();
const serial=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p};
const persist=()=>atomic(settingsFile,settings);
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
async function body(req,limit=1024*1024){let n=0,b=[];for await(const chunk of req){n+=chunk.length;if(n>limit)throw Error('Upload exceeds allowed size');b.push(chunk)}return Buffer.concat(b)}
async function cameraStatus(){const r=await fetch(cameraBase+'/status',{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('Camera service unavailable');return r.json()}
async function selectedDisplay(){const d=await rpc('list_displays');const display=d.displays.find(x=>x.name===settings.selectedDisplay);if(!display)throw Error('Selected projector is disconnected.');return display}
async function layer(){const l=await rpc('list_layers');return l.layers.find(l=>l.name==='Tabletop')||l.layers[0]}
async function worker(command,args={}){return new Promise((resolve,reject)=>{const child=spawn(path.join(ROOT,'.venv/bin/python'),[path.join(ROOT,'server/calibrate.py'),command],{env:{...process.env,MAPMAP_DATA:DATA},stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',c=>{if(c!==0)return reject(Error(err.trim()||out.trim()||'Calibration worker failed'));try{resolve(JSON.parse(out))}catch{reject(Error('Invalid calibration response'))}});child.stdin.end(JSON.stringify(args))})}
async function project(id){
 const display=await selectedDisplay();
 if(!/^[a-zA-Z0-9_.-]+$/.test(id))throw Error('Invalid image');
 const file=path.join(DATA,'media',id);await stat(file);
 let l=await layer();const sources=(await rpc('list_sources')).sources;
 let source=sources.find(s=>s.uri===file);
 if(!source)source=await rpc('create_media_source',{uri:file,is_image:true});
 if(!l){l=await rpc('create_layer',{source_id:source.id,shape:'quad'});await rpc('set_property',{kind:'layer',id:l.id,property:'name',value:'Tabletop'});await rpc('set_vertices',{id:l.id,vertices:[{x:0,y:0},{x:display.width,y:0},{x:0,y:display.height},{x:display.width,y:display.height}]})}
 else await rpc('set_layer_source',{id:l.id,source_id:source.id});
 await rpc('set_layer_visible',{id:l.id,value:!settings.blackout});
 settings.activeImage=id;await persist();return l;
}
async function serveFile(res,file,type){const b=await readFile(file);res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(b)}
async function mutation(name,b){
 if(calibrating)throw Error('Calibration is in progress. Wait before changing the projection.');
 if(name==='display'){if(typeof b.name!=='string')throw Error('Select a display');await rpc('set_output_display',{name:b.name});settings.selectedDisplay=b.name;await persist()}
 else if(name==='fullscreen'){if(typeof b.enabled!=='boolean')throw Error('enabled must be boolean');await selectedDisplay();await rpc('set_output_display',{name:settings.selectedDisplay});await rpc('set_output_fullscreen',{enabled:b.enabled})}
 else if(name==='project'){await project(b.id)}
 else if(name==='grid'){const d=await selectedDisplay();await worker('patterns',d);if(settings.activeImage!=='grid.png')settings.previousImage=settings.activeImage;if(settings.activeImage==='grid.png'&&settings.previousImage)await project(settings.previousImage);else await project('grid.png');await persist()}
 else if(name==='rotate'){const l=await layer();if(!l)throw Error('Choose an image first');await rpc('rotate_source_180',{id:l.id});}
 else if(name==='blackout'){if(typeof b.enabled!=='boolean')throw Error('enabled must be boolean');for(const l of (await rpc('list_layers')).layers)await rpc('set_layer_visible',{id:l.id,value:!b.enabled});settings.blackout=b.enabled;await persist()}
 else if(name==='vertices'){const d=await selectedDisplay(),l=await layer();if(!l)throw Error('Choose an image first');validateVertices(b.vertices,d.width,d.height);await rpc('set_vertices',{id:l.id,vertices:b.vertices});await invalidate('Mapping changed since camera verification.')}
 else if(name==='save'){const l=await layer();if(!l)throw Error('Nothing to save');const stamp=new Date().toISOString().replaceAll(':','-');await rpc('save_project',{path:path.join(DATA,'profiles',stamp+'.mmp')});await rpc('save_project',{path:path.join(DATA,'profiles/tabletop.mmp')});await atomic(path.join(DATA,'profiles/tabletop.json'),{settings,calibration});}
 else if(name==='restore'){const profile=await readJSON(path.join(DATA,'profiles/tabletop.json'),null);if(!profile)throw Error('No profile saved');await rpc('load_project',{path:path.join(DATA,'profiles/tabletop.mmp')});settings=profile.settings;calibration={...profile.calibration,status:'Recheck required',message:'Saved mapping restored. Verify against the current table.'};await persist();await atomic(path.join(DATA,'calibration.json'),calibration)}
 else if(name==='calibrate'){
  const d=await selectedDisplay();freshCameras(await cameraStatus());
  await rpc('set_output_display',{name:settings.selectedDisplay});await rpc('set_output_fullscreen',{enabled:true});
  if(!await layer()){await worker('patterns',d);await project('grid.png')}
  calibrating=true;calibration={status:'Measuring',message:'Projecting markers and checking both camera views.'};
  worker('calibrate',{...d,selectedDisplay:settings.selectedDisplay}).then(async result=>{calibration=result;await atomic(path.join(DATA,'calibration.json'),result);if(result.status.startsWith('Verified')){await rpc('save_project',{path:path.join(DATA,'profiles/tabletop.mmp')});await atomic(path.join(DATA,'profiles/tabletop.json'),{settings,calibration})}}).catch(async e=>{calibration={status:'Calibration incomplete',message:e.message};await atomic(path.join(DATA,'calibration.json'),calibration)}).finally(()=>{calibrating=false});
 }
 else throw Error('Unknown operation');
 return {message:name==='calibrate'?'Calibration started.':'Updated'};
}
async function invalidate(message){calibration={...calibration,status:'Recheck required',message};await atomic(path.join(DATA,'calibration.json'),calibration)}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  const host=(req.headers.host||'').split(':')[0];
  const allowed=new Set(['localhost','127.0.0.1','5090-01','5090-01-1','5090-01.tail83edfc.ts.net','5090-01-1.tail83edfc.ts.net','100.65.99.110']);
  if(!allowed.has(host))return json(res,403,{error:'Unrecognized host'});
  if(req.method==='POST'){
   const origin=req.headers.origin;if(origin&&!allowed.has(new URL(origin).hostname))return json(res,403,{error:'Unrecognized origin'});
   if(url.pathname==='/api/upload'){
    const data=await body(req,25*1024*1024),type=req.headers['content-type'];
    const png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));const jpg=data[0]===255&&data[1]===216&&data[2]===255;
    if(!(png&&type==='image/png'||jpg&&type==='image/jpeg'))throw Error('Upload a PNG or JPEG image');
    const id=randomUUID()+(png?'.png':'.jpg'),file=path.join(DATA,'media',id);await writeFile(file,data);
    try{await worker('validate_image',{file})}catch(e){await unlink(file);throw e}
    await serial(async()=>{settings.images.push({id,name:path.basename(url.searchParams.get('name')||id).slice(0,160)});await persist()});return json(res,200,{id});
   }
   if(req.headers['content-type']!=='application/json')return json(res,415,{error:'JSON content type required'});
   const b=JSON.parse((await body(req)).toString());return json(res,200,await serial(()=>mutation(url.pathname.replace('/api/',''),b)));
  }
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  if(url.pathname==='/api/state'){
   let cameras=[],camError='';try{cameras=(await cameraStatus()).cameras.filter(c=>['top','observer'].includes(c.name))}catch(e){camError=e.message}
   let info={connected:false,connectionError:'MapMap is not running',displays:[],layer:null,fullscreen:false};
   try{const [d,l]=await Promise.all([rpc('list_displays'),layer()]);info={connected:true,displays:d.displays,layer:l||null,fullscreen:d.fullscreen,actualDisplay:d.displays[d.selected]?.name,connectionError:''}}catch(e){info.connectionError=e.message}
   let saved=false;try{await stat(path.join(DATA,'profiles/tabletop.mmp'));saved=true}catch{}
   let visibleCalibration=calibration;
   if(calibration.status?.startsWith('Verified')){
    const display=info.displays.find(d=>d.name===calibration.display);
    const vertices=info.layer?.vertices;
    const sameVertices=vertices?.length===calibration.vertices?.length&&vertices.every((p,i)=>Math.abs(p.x-calibration.vertices[i].x)<.001&&Math.abs(p.y-calibration.vertices[i].y)<.001);
    if(!display||display.width!==calibration.resolution?.[0]||display.height!==calibration.resolution?.[1]||info.actualDisplay!==calibration.display||!sameVertices)
     visibleCalibration={...calibration,status:'Recheck required',message:'Current display or mapping differs from the verified profile.'};
   }
   return json(res,200,{...settings,...info,cameras,cameraError:camError,calibrating,calibration:visibleCalibration,saved})
  }
  const camera=url.pathname.match(/^\/api\/camera\/(\d+)\/(stream|snapshot)$/);
  if(camera){
   const controller=new AbortController();res.on('close',()=>controller.abort());
   const endpoint=camera[2]==='stream'?`/stream/${camera[1]}.mjpg?view=rgb`:`/snapshot/${camera[1]}.png`;
   const upstream=await fetch(cameraBase+endpoint,{signal:controller.signal});res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type'),'Cache-Control':'no-store'});Readable.fromWeb(upstream.body).on('error',()=>res.end()).pipe(res);return;
  }
  if(url.pathname.startsWith('/media/')){const id=url.pathname.slice(7);if(!/^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg)$/.test(id))throw Error('Invalid image');return await serveFile(res,path.join(DATA,'media',id),id.endsWith('.png')?'image/png':'image/jpeg')}
  const rel=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);const base=path.join(ROOT,'dist/client'),file=path.resolve(base,'.'+rel);
  if(!file.startsWith(base+path.sep))return json(res,403,{error:'Invalid path'});
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.json':'application/json','.rsc':'text/x-component'};
  await serveFile(res,file,types[path.extname(file)]||'application/octet-stream');
 }catch(e){if(!res.headersSent)json(res,e.code==='ENOENT'?404:400,{error:e.message});else res.end()}
});
server.listen(port,'127.0.0.1',()=>console.log(`Tabletop control: http://127.0.0.1:${server.address().port}`));
