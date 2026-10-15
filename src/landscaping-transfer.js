// Explicit CPU-only wire format. No scene, material, texture or callback crosses
// the Worker boundary. Typed arrays are transferred, not cloned.
export function serializeLandscaping(compiled) {
  return {
    metrics: compiled.metrics,
    meshes: compiled.group.children.map(mesh => ({
      positions: mesh.geometry.attributes.position.array,
      normals: mesh.geometry.attributes.normal.array,
      indices: mesh.geometry.index?.array || null,
      geometryData: mesh.geometry.userData,
      userData: mesh.userData,
      matrices: mesh.isInstancedMesh ? mesh.instanceMatrix.array : null,
      count: mesh.isInstancedMesh ? mesh.count : 0,
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
      renderOrder: mesh.renderOrder
    }))
  };
}

export function geometryTransfers(result) {
  return [...new Set(result.meshes.flatMap(mesh =>
    [mesh.positions, mesh.normals, mesh.indices, mesh.matrices].filter(Boolean).map(array => array.buffer)
  ))];
}

export function hydrateLandscaping(THREE, result, materials) {
  const group = new THREE.Group();
  group.name = 'landscaping-v10';
  let main = null;
  for (const data of result.meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    if (data.indices) geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.userData = data.geometryData;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const role = data.userData.semanticRole;
    const material = role === 'ground-transition' ? materials.groundMaterial
      : data.matrices ? materials.rockMaterial : materials.stoneMaterial;
    const mesh = data.matrices
      ? new THREE.InstancedMesh(geometry, material, data.count)
      : new THREE.Mesh(geometry, material);
    if (data.matrices) {
      mesh.instanceMatrix.array.set(data.matrices);
      mesh.instanceMatrix.needsUpdate = true;
    }
    mesh.userData = data.userData;
    mesh.castShadow = data.castShadow;
    mesh.receiveShadow = data.receiveShadow;
    mesh.renderOrder = data.renderOrder;
    group.add(mesh);
    if (role?.startsWith('v10-')) main = geometry;
  }
  return {
    group, geometries: {main}, metrics: result.metrics,
    dispose() { group.children.forEach(mesh => mesh.geometry.dispose()); }
  };
}
