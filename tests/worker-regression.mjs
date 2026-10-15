import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import * as THREE from 'three';
import { planLandscaping } from '../src/landscaping-planner.js';
import { compileLandscapingV10 } from '../src/landscaping-compiler.js';
import { createTerrainHeight } from '../src/landscaping-terrain.js';
import { hydrateLandscaping } from '../src/landscaping-transfer.js';
import { RefinementWorker } from '../src/refinement-worker.js';

const centerline = [[-2,-1], [2,-1], [2,1], [-2,1]].map(([x,z]) => ({x,z}));
const tiers = [[.30,3200], [.20,4500], [.17,6500], [.15,8000]];
function request(preset, terrain, seed, tier) {
  const heightAt = createTerrainHeight(terrain);
  const plan = planLandscaping({centerline, heightAt, closed:true, settings:{mode:'brush',preset,quality:'high',seed}});
  return {plan, terrain, options:{rockType:'granite', crownMode:'natural',cellM:tiers[tier][0], targetTriangles:tiers[tier][1], includeGround:true}};
}
function worker() {
  const node = new Worker(new URL('./helpers/web-worker.mjs', import.meta.url));
  const adapter = { postMessage: data => node.postMessage(data), terminate: () => node.terminate() };
  node.on('message', data => adapter.onmessage?.({data}));
  node.on('error', error => adapter.onerror?.({message:error.message,preventDefault(){}}));
  return adapter;
}

test('real worker matches synchronous buffers, instances, bounds and topology across all tiers', {timeout:30000}, async () => {
  const client = new RefinementWorker(worker);
  try {
    for (const preset of ['rockfield','cliff']) for (const rockType of ['granite','sandstone','limestone']) for (let tier=0;tier<4;tier++) {
      const input = request(preset, ['flat','waves','slope','cross'][tier], 7+tier, tier);
      input.options.rockType = rockType;
      const data = await client.build(input);
      // This also proves the payload contains no functions or Three scene objects.
      assert.deepEqual(structuredClone(data), data);
      const groundMaterial = new THREE.MeshBasicMaterial();
      const materials = {stoneMaterial:groundMaterial, rockMaterial:groundMaterial, groundMaterial};
      const actual = hydrateLandscaping(THREE, data, materials);
      const expected = compileLandscapingV10(THREE,input.plan,{...input.options,...materials,heightAt:createTerrainHeight(input.terrain)});
      const {buildMs:a,...am} = actual.metrics, {buildMs:b,...bm} = expected.metrics;
      assert.deepEqual(am,bm);
      assert.equal(am.boundaryEdges,0);
      assert.equal(am.degenerateTriangles,0);
      assert.equal(am.windingConflicts,0);
      assert.ok(am.signedVolume>0);
      assert.equal(actual.group.children.length,expected.group.children.length);
      actual.group.children.forEach((mesh,i) => {
        const reference = expected.group.children[i];
        for (const name of ['position','normal']) assert.deepEqual(mesh.geometry.attributes[name].array,reference.geometry.attributes[name].array);
        assert.deepEqual(mesh.geometry.index?.array,reference.geometry.index?.array);
        if (mesh.isInstancedMesh) assert.deepEqual(mesh.instanceMatrix.array,reference.instanceMatrix.array);
        assert.deepEqual(mesh.userData,reference.userData);
        assert.equal(mesh.material,groundMaterial);
      });
      actual.dispose(); expected.dispose(); groundMaterial.dispose();
    }
  } finally { client.cancel(); }
});

test('successive changes cancel active work and only latest quality/seed completes', {timeout:30000}, async () => {
  const client = new RefinementWorker(worker);
  try {
    const first = client.build(request('cliff','waves',1,3));
    const second = client.build(request('rockfield','slope',2,2));
    const latestInput = request('cliff','cross',3,1);
    const latest = client.build(latestInput);
    assert.equal(await first,null);
    assert.equal(await second,null);
    const result = await latest;
    assert.ok(result);
    const repeat = await client.build(latestInput);
    const material = new THREE.MeshBasicMaterial();
    const a = hydrateLandscaping(THREE,result,{stoneMaterial:material});
    const b = hydrateLandscaping(THREE,repeat,{stoneMaterial:material});
    assert.deepEqual(a.geometries.main.attributes.position.array,b.geometries.main.attributes.position.array);
    a.dispose();b.dispose();material.dispose();
  } finally {client.cancel();}
});

test('late messages and errors from terminated workers cannot settle a newer request', {timeout:30000}, async () => {
  // A transport double is necessary to deliver messages after termination.
  const workers=[];
  const client=new RefinementWorker(()=>{const w={postMessage(){},terminate(){w.terminated=true;}};workers.push(w);return w;});
  const first=client.build({});
  const oldMessage=workers[0].onmessage,oldError=workers[0].onerror;
  const second=client.build({});
  assert.equal(workers[0].terminated,true);
  assert.equal(await first,null);
  oldMessage({data:{result:'stale'}});
  oldError({message:'stale failure',preventDefault(){}});
  workers[1].onmessage({data:{result:'current'}});
  assert.equal(await second,'current');
  const failed=client.build({});
  workers[2].onerror({message:'worker unavailable',preventDefault(){}});
  await assert.rejects(failed,/worker unavailable/);
  const cancelled=client.build({});client.cancel();
  assert.equal(await cancelled,null);
});

test('worker compilation errors reject and the next request can recover', {timeout:30000}, async () => {
  const client = new RefinementWorker(worker);
  try {
    await assert.rejects(client.build({plan:null,options:{}}), /settings/);
    assert.ok(await client.build(request('cliff','flat',7,0)));
  } finally {client.cancel();}
});

test('worker startup and structured-clone failures reject without hanging', async () => {
  const unavailable = new RefinementWorker(()=>{throw new Error('Worker blocked');});
  await assert.rejects(unavailable.build({}), /Worker blocked/);
  let terminated=false;
  const cloneFailure = new RefinementWorker(()=>({terminate(){terminated=true;},postMessage(){throw new Error('Cannot clone');}}));
  await assert.rejects(cloneFailure.build({}), /Cannot clone/);
  assert.equal(terminated,true);
});
