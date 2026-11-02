export type Point = {x:number;y:number};

/** Serialize writes and coalesce pointer moves so slow links cannot build a backlog. */
export function createLiveVertices(
 send:(vertices:Point[])=>Promise<void>,
 onBusy:(busy:boolean)=>void,
 onError:(error:unknown)=>void,
 onIdle:()=>void,
 interval=33,
){
 let pending:Point[]|null=null;
 let active=false,urgent=false,disposed=false,lastStart=0;
 let timer:ReturnType<typeof setTimeout>|null=null;
 function schedule(){
  if(disposed||active||timer!==null||pending===null)return;
  timer=setTimeout(()=>{timer=null;void pump()},urgent?0:Math.max(0,interval-(Date.now()-lastStart)));
 }
 async function pump(){
  if(disposed||active||pending===null)return;
  const value=pending;pending=null;active=true;urgent=false;lastStart=Date.now();
  try{await send(value)}catch(error){if(!disposed)onError(error)}
  finally{
   active=false;
   if(!disposed){
    if(pending!==null)schedule();
    else {onBusy(false);onIdle()}
   }
  }
 }
 return {
  push(vertices:Point[]){if(disposed)return;pending=vertices.map(p=>({...p}));onBusy(true);schedule()},
  flush(){if(disposed)return;urgent=true;if(timer!==null){clearTimeout(timer);timer=null}schedule()},
  get busy(){return active||pending!==null},
  dispose(){disposed=true;pending=null;if(timer!==null)clearTimeout(timer)},
 };
}
