// Three is used only for CPU geometry/normals/instance transforms here; no
// renderer or WebGL context is created. Keep the compiler and its PRNG intact.
import { BufferGeometry, Euler, Float32BufferAttribute, Group, IcosahedronGeometry,
  InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
const THREE = { BufferGeometry, Euler, Float32BufferAttribute, Group, IcosahedronGeometry,
  InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 };
import { compileLandscapingV10 } from './landscaping-compiler.js';
import { createTerrainHeight } from './landscaping-terrain.js';
import { serializeLandscaping, geometryTransfers } from './landscaping-transfer.js';

self.onmessage = ({data}) => {
  let compiled;
  try {
    const {plan, terrain, options} = data;
    compiled = compileLandscapingV10(THREE, plan, {
      ...options,
      heightAt: createTerrainHeight(terrain),
      // The compiler only uses truthiness to include the diagnostic band.
      groundMaterial: options.includeGround ? true : undefined
    });
    const result = serializeLandscaping(compiled);
    self.postMessage({result}, geometryTransfers(result));
  } catch (error) {
    self.postMessage({error: error?.message || String(error)});
  } finally {
    compiled?.dispose();
  }
};
