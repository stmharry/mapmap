import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {createLiveVertices} from '../lib/live-vertices.ts';
const value=x=>[{x,y:10}];
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await sleep(2)}assert.fail('Update did not finish')}

test('writes during drag; slow requests coalesce to the latest position and final release flushes it',async()=>{
 const sent=[],resolve=[];let active=0,maxActive=0,idle=0;
 const writer=createLiveVertices(async vertices=>{
  active++;maxActive=Math.max(maxActive,active);sent.push(vertices);
  await new Promise(r=>resolve.push(r));active--;
 },()=>{},error=>{throw error},()=>idle++,5000);
 try{
  writer.push(value(1));await until(()=>sent.length===1); // No release/flush needed for live output.
  writer.push(value(2));writer.push(value(3));writer.push(value(4));writer.flush();
  assert.equal(sent.length,1);resolve.shift()();
  await until(()=>sent.length===2);assert.deepEqual(sent,[value(1),value(4)]);
  resolve.shift()();await until(()=>!writer.busy);assert.equal(maxActive,1);assert.equal(idle,1);
 }finally{writer.dispose()}
});

test('a rejected intermediate shape does not discard a newer valid position',async()=>{
 const sent=[],errors=[];let rejectFirst;
 const writer=createLiveVertices(async vertices=>{sent.push(vertices);if(sent.length===1)await new Promise((_,r)=>rejectFirst=r)},()=>{},e=>errors.push(e.message),()=>{},0);
 try{writer.push(value(1));await until(()=>sent.length===1);writer.push(value(2));writer.flush();rejectFirst(Error('Invalid quad'));
 await until(()=>!writer.busy);assert.deepEqual(sent,[value(1),value(2)]);assert.deepEqual(errors,['Invalid quad']);
 }finally{writer.dispose()}
});

test('unmount discards pending moves instead of sending them after cleanup',async()=>{
 const sent=[];let finish;
 const writer=createLiveVertices(async vertices=>{sent.push(vertices);await new Promise(r=>finish=r)},()=>{},()=>{},()=>{},0);
 writer.push(value(1));await until(()=>sent.length===1);writer.push(value(2));writer.dispose();finish();await sleep(10);
 assert.deepEqual(sent,[value(1)]);
});
