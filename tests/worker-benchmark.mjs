// CPU/event-loop measurement only; not a browser input-latency or FPS benchmark.
import { Worker } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import * as THREE from 'three';
import { planLandscaping } from '../src/landscaping-planner.js';
import { compileLandscapingV10 } from '../src/landscaping-compiler.js';
import { createTerrainHeight } from '../src/landscaping-terrain.js';
import { RefinementWorker } from '../src/refinement-worker.js';
const heightAt=createTerrainHeight('waves');
const centerline=[[-4,-2],[4,-2],[4,2],[-4,2]].map(([x,z])=>({x,z}));
const plan=planLandscaping({centerline,heightAt,closed:true,settings:{preset:'cliff',quality:'high',seed:7,cliffHeightM:3.5}});
const options={rockType:'limestone',cellM:.15,targetTriangles:8000};
const client=new RefinementWorker(()=>{
  const node=new Worker(new URL('./helpers/web-worker.mjs',import.meta.url));
  const adapter={postMessage:data=>node.postMessage(data),terminate:()=>node.terminate()};
  node.on('message',data=>adapter.onmessage?.({data}));
  node.on('error',error=>adapter.onerror?.({message:error.message}));
  return adapter;
});
async function measure(run){
  let previous=performance.now(),maxGap=0;
  const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-previous);previous=now;},5);
  await delay(20);
  const start=performance.now();
  const compileMs=await run();
  const elapsedMs=performance.now()-start;
  await delay(20);clearInterval(timer);
  return {elapsedMs:+elapsedMs.toFixed(1),compileMs:+compileMs.toFixed(1),maxTimerGapMs:+maxGap.toFixed(1)};
}
// Warm the synchronous JIT once; new workers include startup/JIT on every run.
compileLandscapingV10(THREE,plan,{...options,heightAt}).dispose();
const results={node:process.version,platform:process.platform,synchronous:[],worker:[]};
try {
  for(let i=0;i<5;i++) {
    results.synchronous.push(await measure(()=>{const c=compileLandscapingV10(THREE,plan,{...options,heightAt});const ms=c.metrics.buildMs;c.dispose();return ms;}));
    results.worker.push(await measure(async()=>{const c=await client.build({plan,terrain:'waves',options});return c.metrics.buildMs;}));
  }
} finally {client.cancel();}
console.log(JSON.stringify(results,null,2));
