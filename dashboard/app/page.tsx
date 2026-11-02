'use client';
import {useState,useEffect,useCallback,useRef} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {createLiveVertices} from '@/lib/live-vertices';
import {Button} from '@/components/ui/button';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
type Point={x:number;y:number};
export default function Page(){
 const [state,setState]=useState<any>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [corner,setCorner]=useState('0'),[step,setStep]=useState('1'),[vertices,setVertices]=useState<Point[]>([]),[drag,setDrag]=useState<number|null>(null);
 const dragRef=useRef<{corner:number;pointerId:number}|null>(null),verticesRef=useRef<Point[]>([]),geometryEpoch=useRef(0);
 const writer=useRef<ReturnType<typeof createLiveVertices>|null>(null);
 const [livePending,setLivePending]=useState(false);
 const refresh=useCallback(async()=>{
  const epoch=geometryEpoch.current;
  const canSync=dragRef.current===null&&!writer.current?.busy;
  try{
   const r=await fetch('/api/state');if(!r.ok)throw Error('Control service unavailable');
   const s:any=await r.json();setState(s);
   // Polls started before/during a drag must not snap the local handle backward.
   if(canSync&&dragRef.current===null&&!writer.current?.busy&&epoch===geometryEpoch.current){
    verticesRef.current=s.layer?.vertices||[];setVertices(verticesRef.current);
   }
  }catch(e:any){setError(e.message)}
 },[]);
 useEffect(()=>{
  const updates=createLiveVertices(async vertices=>{
   const r=await fetch('/api/vertices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vertices}),signal:AbortSignal.timeout(10000)});
   const j:any=await r.json();if(!r.ok)throw Error(j.error||'Mapping update failed');
   setError('');setNotice('Mapping updated');
  },setLivePending,error=>{setError(error instanceof Error?error.message:'Mapping update failed');setNotice('')},()=>{
   if(dragRef.current===null)void refresh()
  });
  writer.current=updates;
  return()=>{updates.dispose();writer.current=null};
 },[refresh]);
 useEffect(()=>{refresh();const t=setInterval(refresh,1500);return()=>clearInterval(t)},[refresh]);
 async function action(name:string,data:any={}){setBusy(true);setError('');try{const r=await fetch('/api/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const j:any=await r.json();if(!r.ok)throw Error(j.error||'Operation failed');setNotice(j.message||'Updated');await refresh();return j}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 useEffect(()=>{
  const context=(document as any).modelContext;if(!context?.registerTool)return;
  const lifecycle=new AbortController();
  for(const tool of [
   {name:'get_projection_state',description:'Read the current projection, calibration and camera status.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true},execute:async()=>{const r=await fetch('/api/state');if(!r.ok)throw Error('Control service unavailable');return r.json()}},
   {name:'set_projection_blackout',description:'Blank or restore the projector output.',inputSchema:{type:'object',properties:{enabled:{type:'boolean'}},required:['enabled'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async(input:any)=>{if(typeof input?.enabled!=='boolean')throw Error('enabled must be boolean');const r=await fetch('/api/blackout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const j:any=await r.json();if(!r.ok)throw Error(j.error);await refresh();return j}}
  ]){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{})}catch{}}
  return()=>lifecycle.abort();
 },[refresh]);
 const display=state?.displays?.find((d:any)=>d.name===state?.selectedDisplay);const w=display?.width||1920,h=display?.height||1080;
 const disabled=busy||livePending||drag!==null||!!state?.calibrating||!state?.connected;const names=['Far left','Far right','Robot-side left','Robot-side right'];
 async function nudge(dx:number,dy:number){const ids=corner==='far'?[0,1]:corner==='near'?[2,3]:[Number(corner)];await action('vertices',{vertices:vertices.map((p,i)=>ids.includes(i)?{x:p.x+dx*Number(step),y:p.y+dy*Number(step)}:p)})}
 function moveCorner(e:ReactPointerEvent<SVGSVGElement>){
  const current=dragRef.current;if(!current||current.pointerId!==e.pointerId)return;
  const matrix=e.currentTarget.getScreenCTM();if(!matrix)return;
  const p=e.currentTarget.createSVGPoint();p.x=e.clientX;p.y=e.clientY;
  const q=p.matrixTransform(matrix.inverse());
  const next=verticesRef.current.map((a,i)=>i===current.corner?{x:Math.max(0,Math.min(w,q.x)),y:Math.max(0,Math.min(h,q.y))}:a);
  verticesRef.current=next;geometryEpoch.current++;setVertices(next);
  writer.current?.push(next);
 }
 function finishDrag(e:ReactPointerEvent<SVGSVGElement>){
  if(dragRef.current?.pointerId!==e.pointerId)return;
  dragRef.current=null;geometryEpoch.current++;setDrag(null);
  writer.current?.flush();
  if(!writer.current?.busy)void refresh();
 }
 return <main className="shell"><header><div><p className="eyebrow">MapMap / tabletop</p><h1>Projection control</h1><p className="muted">5090-01 · Private workspace</p></div><div className="actions"><Button variant="outline" disabled={disabled} onClick={()=>action('grid')}>Calibration grid</Button><Button variant={state?.blackout?'default':'destructive'} disabled={disabled} onClick={()=>action('blackout',{enabled:!state?.blackout})}>{state?.blackout?'Restore projection':'Blackout'}</Button></div></header>
 {error&&<div className="warning" role="alert">{error}</div>}{!state?.connected&&<div className="warning">{state?.connectionError||'Connecting to MapMap…'}</div>}
 <div className="layout"><section><div className="panel"><div className="panelhead"><h2>Live tabletop</h2><span className="muted">Top + observer</span></div><div className="cams">{['top','observer'].map(name=>{const c=state?.cameras?.find((x:any)=>x.name===name);return <article className="camera" key={name}>{c?.state==='live'?<img src={'/api/camera/'+c.camera_id+'/stream'} alt={name+' live tabletop view'}/>:<div style={{aspectRatio:'16/9',display:'grid',placeItems:'center'}}>{c?.message||'Camera unavailable'}</div>}<div className="camcaption"><span>{name==='top'?'Top · robot side':'Observer · far side'}</span><span className={c?.state==='live'?'dot':'error'}>{c?.state==='live'?`Live · ${Math.round(c.age_ms||0)} ms`:c?.state||'Offline'}</span></div></article>})}</div></div>
 <div className="panel"><div className="panelhead"><h2>Output mapping</h2><span className="muted">{w} × {h} · drag a corner</span></div><svg className="editor" viewBox={`-65 -65 ${w+130} ${h+130}`} onPointerMove={moveCorner} onPointerUp={e=>{moveCorner(e);finishDrag(e)}} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}><rect x="0" y="0" width={w} height={h} fill="#0c1622" stroke="#304252"/>{state?.activeImage&&<image href={'/media/'+state.activeImage} width={w} height={h} opacity=".22"/>}{vertices.length===4&&<><polygon points={[0,1,3,2].map(i=>`${vertices[i].x},${vertices[i].y}`).join(' ')} fill="#65d9ed10" stroke="#65d9ed" strokeWidth="4"/>{vertices.map((p,i)=><g key={i} onPointerDown={e=>{if(disabled||dragRef.current||!e.isPrimary||e.button!==0)return;e.preventDefault();e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);dragRef.current={corner:i,pointerId:e.pointerId};geometryEpoch.current++;setCorner(String(i));setDrag(i);setError('')}} style={{cursor:'grab'}}><circle cx={p.x} cy={p.y} r="27" fill={corner===String(i)?'#f6cd66':'#65d9ed'} stroke="#07121d" strokeWidth="6"/><text x={p.x} y={p.y+8} textAnchor="middle" style={{fill:'#07121d',fontWeight:700}}>{i+1}</text></g>)}</>}</svg><p className="muted" style={{marginTop:10}}>Corners label table coordinates; their screen positions may reverse with projector orientation.</p></div>
 <div className="panel"><div className="panelhead"><h2>Image gallery</h2><Button variant="outline" disabled={disabled||!state?.layer} onClick={()=>action('rotate')}>Rotate 180°</Button></div><label className="controlLabel">Add PNG or JPEG</label><input type="file" accept="image/png,image/jpeg" disabled={busy} onChange={async e=>{const f=e.target.files?.[0];if(!f)return;setBusy(true);try{const r=await fetch('/api/upload?name='+encodeURIComponent(f.name),{method:'POST',headers:{'Content-Type':f.type},body:f});const j:any=await r.json();if(!r.ok)throw Error(j.error);await refresh();setNotice('Image added')}catch(e:any){setError(e.message)}finally{setBusy(false);e.target.value=''}}}/><div className="gallery" style={{marginTop:16}}>{state?.images?.map((im:any)=><button className={'tile '+(state.activeImage===im.id?'active':'')} key={im.id} disabled={disabled} onClick={()=>action('project',{id:im.id})}><img src={'/media/'+im.id} alt=""/><span>{im.name}</span></button>)}</div>{!state?.images?.length&&<p className="muted">Add a tabletop image to begin. The calibration grid is always available.</p>}</div></section>
 <aside><div className="panel"><h2>Projector</h2><label className="controlLabel">Output display</label><Select value={state?.selectedDisplay||''} onValueChange={v=>action('display',{name:v})} disabled={disabled}><SelectTrigger className="w-full"><SelectValue placeholder="Select display"/></SelectTrigger><SelectContent>{state?.displays?.map((d:any)=><SelectItem key={d.name} value={d.name}>{d.name} · {d.width} × {d.height}</SelectItem>)}</SelectContent></Select><Button className="w-full mt-3" disabled={disabled||!display} onClick={()=>action('fullscreen',{enabled:!state?.fullscreen})}>{state?.fullscreen?'Hide output window':'Show fullscreen output'}</Button></div>
 <div className="panel"><h2>Fine alignment</h2><label className="controlLabel">Corner or edge</label><Select value={corner} onValueChange={v=>setCorner(v||'0')}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent>{names.map((n,i)=><SelectItem value={String(i)} key={i}>{i+1} · {n}</SelectItem>)}<SelectItem value="far">Far edge · both corners</SelectItem><SelectItem value="near">Robot-side edge · both corners</SelectItem></SelectContent></Select><label className="controlLabel">Step in output pixels</label><Select value={step} onValueChange={v=>setStep(v||'1')}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent>{['0.25','1','5','10'].map(n=><SelectItem value={n} key={n}>{n} px</SelectItem>)}</SelectContent></Select><div className="nudge"><span/><Button disabled={disabled||vertices.length!==4} aria-label="Move up" onClick={()=>nudge(0,-1)}>↑</Button><span/><Button disabled={disabled||vertices.length!==4} aria-label="Move left" onClick={()=>nudge(-1,0)}>←</Button><Button disabled={disabled||vertices.length!==4} aria-label="Move down" onClick={()=>nudge(0,1)}>↓</Button><Button disabled={disabled||vertices.length!==4} aria-label="Move right" onClick={()=>nudge(1,0)}>→</Button></div><p className="muted">Arrows move in projector coordinates. Select an edge to move its corners together.</p></div>
 <div className="panel"><h2>Camera calibration</h2><p className="muted" style={{margin:'10px 0'}}>Measures the table against projected markers using both views.</p><Button className="w-full" disabled={disabled||!!state?.calibrating||!display} onClick={()=>action('calibrate')}>{state?.calibrating?'Measuring…':'Calibrate tabletop'}</Button><div className="stat small"><strong>{state?.calibration?.status||'Not calibrated'}</strong><p className="muted">{state?.calibration?.message||'No verified profile saved yet.'}</p></div><div className="controlgrid"><Button variant="outline" disabled={disabled||!state?.layer} onClick={()=>action('save')}>Save profile</Button><Button variant="outline" disabled={disabled||!state?.saved} onClick={()=>action('restore')}>Restore saved</Button></div>{notice&&<p className="notice" role="status">{notice}</p>}</div></aside></div></main>
}
