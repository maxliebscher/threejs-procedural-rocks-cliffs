// No WebGL/browser emulation: verify emitted URLs via HTTP and execute the actual
// bundled worker in a worker_threads adapter. Browser rendering is a separate check.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { planLandscaping } from '../src/landscaping-planner.js';

const prefix='/threejs-procedural-rocks-cliffs/';
const root=new URL('../dist/',import.meta.url);
const server=createServer(async (req,res)=>{
  if (!req.url.startsWith(prefix)) {res.writeHead(404).end();return;}
  const path=req.url.slice(prefix.length)||'index.html';
  try {
    const file=await readFile(new URL(path,root));
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.json')?'application/json':'text/html');
    res.end(file);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=new URL(`http://127.0.0.1:${server.address().port}${prefix}`);
let worker;
try {
  const html=await (await fetch(base)).text();
  const script=html.match(/<script[^>]*src="([^"]+)"/)[1];
  const entryURL=new URL(script,base);
  assert.ok(entryURL.pathname.startsWith(prefix));
  const entry=await (await fetch(entryURL)).text();
  const workerFile=entry.match(/landscaping-worker-[\w-]+\.js/)[0];
  const workerURL=new URL(workerFile,entryURL);
  const response=await fetch(workerURL);
  assert.equal(response.status,200);
  assert.match(response.headers.get('Content-Type'),/javascript/);
  const manifest=await fetch(new URL('assets/rock-materials/material-manifest.json',base));
  assert.equal(manifest.status,200);
  const centerline=[[-2,-1],[2,-1],[2,1],[-2,1]].map(([x,z])=>({x,z}));
  const plan=planLandscaping({centerline,closed:true,settings:{preset:'cliff',quality:'high',seed:7}});
  worker=new Worker(new URL('./helpers/web-worker.mjs',import.meta.url),{
    workerData:{entry:new URL(`assets/${workerFile}`,root).href}
  });
  const result=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Bundled worker timed out')),15000);
    worker.once('message', data=>{clearTimeout(timeout);data.error?reject(new Error(data.error)):resolve(data.result);});
    worker.once('error',error=>{clearTimeout(timeout);reject(error);});
    worker.postMessage({plan,terrain:'flat',options:{cellM:.15,targetTriangles:8000}});
  });
  assert.equal(result.metrics.boundaryEdges,0);
  assert.equal(result.metrics.degenerateTriangles,0);
  assert.equal(result.metrics.windingConflicts,0);
  assert.ok(result.metrics.signedVolume>0);
  assert.ok(result.meshes[0].positions instanceof Float32Array);
  console.log(`PASS production worker, JS MIME, material manifest and relative URLs at ${prefix}`);
} finally {
  await worker?.terminate();
  await new Promise(resolve=>server.close(resolve));
}
