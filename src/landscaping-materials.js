// Landscaping-Materialien V5: metrische triplanare Projektion mit korrekter
// Normalmap-Rekonstruktion (Whiteout-Blend in Weltkoordinaten, achsenspezifische
// Vorzeichenbehandlung) und gerichteter Sandstein-Schichtkoordinate.
// Projektgenerierte Maps aus assets/landscaping-v3; keine Fremd-Scans.

function prepare(THREE, texture, color, anisotropy) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

const TRI_COMMON = `
varying vec3 vTriWorldPos;
varying vec3 vTriWorldNormal;
uniform float uTriScale;
uniform float uTriNormalStrength;
uniform float uStrataAmp;
uniform float uStrataFreq;
vec3 triWeights(){
  vec3 w = pow(abs(normalize(vTriWorldNormal)), vec3(4.0));
  return w / max(w.x + w.y + w.z, 0.0001);
}
vec2 triUvX(){ return vTriWorldPos.zy * uTriScale; }
vec2 triUvY(){ return vTriWorldPos.xz * uTriScale; }
vec2 triUvZ(){ return vTriWorldPos.xy * uTriScale; }
`;

export function addTriplanarProjection(material, { metresPerTile, normalStrength = 1.6, strata = 0 }) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uTriScale = { value: 1 / metresPerTile };
    shader.uniforms.uTriNormalStrength = { value: normalStrength };
    shader.uniforms.uStrataAmp = { value: strata ? 0.16 : 0 };
    shader.uniforms.uStrataFreq = { value: 1 / 0.44 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriWorldPos;\nvarying vec3 vTriWorldNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTriWorldPos=(modelMatrix*vec4(transformed,1.0)).xyz;\nvTriWorldNormal=normalize(mat3(modelMatrix)*objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TRI_COMMON}`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
vec3 twMap = triWeights();
vec4 triColor = texture2D(map, triUvX()) * twMap.x
  + texture2D(map, triUvY()) * twMap.y
  + texture2D(map, triUvZ()) * twMap.z;
if (uStrataAmp > 0.0) {
  // Gerichtete Schichtkoordinate: weltvertikal, auf Seiten horizontal
  // konsistent, auf der Krone (Y-Gewicht) ausgeblendet.
  float layer = vTriWorldPos.y * uStrataFreq
    + sin(vTriWorldPos.x * 0.61) * 0.22 + sin(vTriWorldPos.z * 0.47) * 0.18;
  float band = sin(layer * 6.28318) * 0.5 + sin(layer * 12.566 + 1.7) * 0.24;
  float sideness = 1.0 - twMap.y;
  triColor.rgb *= 1.0 + band * uStrataAmp * sideness;
}
diffuseColor *= triColor;
#endif`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
vec3 twRough = triWeights();
float triRough = texture2D(roughnessMap, triUvX()).g * twRough.x
  + texture2D(roughnessMap, triUvY()).g * twRough.y
  + texture2D(roughnessMap, triUvZ()).g * twRough.z;
roughnessFactor *= triRough;
#endif`)
      .replace('#include <normal_fragment_maps>', `#ifdef USE_NORMALMAP
{
  vec3 twN = triWeights();
  vec3 wN = normalize(vTriWorldNormal);
  vec3 tnx = texture2D(normalMap, triUvX()).xyz * 2.0 - 1.0;
  vec3 tny = texture2D(normalMap, triUvY()).xyz * 2.0 - 1.0;
  vec3 tnz = texture2D(normalMap, triUvZ()).xyz * 2.0 - 1.0;
  tnx.xy *= uTriNormalStrength;
  tny.xy *= uTriNormalStrength;
  tnz.xy *= uTriNormalStrength;
  // Whiteout-Blend: Tangentialdetail + Weltnormalanteil pro Achse, Vorzeichen
  // ueber die vorzeichenbehaftete Normalkomponente (abs auf der Detailachse).
  tnx = vec3(tnx.xy + wN.zy, abs(tnx.z) * wN.x);
  tny = vec3(tny.xy + wN.xz, abs(tny.z) * wN.y);
  tnz = vec3(tnz.xy + wN.xy, abs(tnz.z) * wN.z);
  vec3 blended = normalize(
    tnx.zyx * twN.x
    + tny.xzy * twN.y
    + tnz.xyz * twN.z
  );
  normal = normalize((viewMatrix * vec4(blended, 0.0)).xyz);
}
#endif`);
  };
  material.customProgramCacheKey = () => `landscaping-triplanar-v5:${metresPerTile}:${normalStrength}:${strata}`;
  material.userData.projection = 'metric-triplanar-v5';
  return material;
}

export function createTriplanarWeightsMaterial(THREE) {
  return new THREE.ShaderMaterial({
    name: 'landscaping-v9-weights-debug',
    vertexShader: `
      varying vec3 vWorldNormal;
      void main(){
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vWorldNormal;
      void main(){
        vec3 w = pow(abs(normalize(vWorldNormal)), vec3(4.0));
        w /= max(w.x + w.y + w.z, 0.0001);
        gl_FragColor = vec4(w, 1.0);
      }`
  });
}

export async function createLandscapingTriplanarMaterialsV5(THREE, renderer) {
  const manifest = await fetch('./assets/rock-materials/material-manifest.json').then(r => {
    if (!r.ok) throw new Error(`Material manifest ${r.status}`);
    return r.json();
  });
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const materials = new Map();
  const textures = [];
  for (const recipe of manifest.assets) {
    const [map, roughnessMap, normalMap] = await Promise.all([
      loader.loadAsync(recipe.imgUrl),
      loader.loadAsync(recipe.roughnessUrl),
      loader.loadAsync(recipe.normalUrl)
    ]);
    textures.push(map, roughnessMap, normalMap);
    prepare(THREE, map, true, anisotropy);
    prepare(THREE, roughnessMap, false, anisotropy);
    prepare(THREE, normalMap, false, anisotropy);
    const type = recipe.id.replace('landscape_rock_', '');
    const make = role => {
      const material = new THREE.MeshStandardMaterial({
        name: `${recipe.id}:triplanar-v5:${role}`,
        color: '#ffffff', map, roughnessMap, normalMap,
        roughness: recipe.roughness, metalness: 0,
        side: THREE.FrontSide
      });
      addTriplanarProjection(material, {
        metresPerTile: recipe.tileScaleM,
        // Die Maps tragen bereits ausgepraegte Mikroreliefs. Der Manifestwert
        // ist deshalb direkt der geologische Arbeitswert; ein versteckter
        // Multiplikator machte vor allem Sandstein im Streiflicht zu plastisch.
        normalStrength: Math.min(1.6, recipe.normalStrength),
        strata: type === 'sandstone' ? 1 : 0
      });
      material.userData.source = 'project-generated-gptimage-material';
      material.userData.metresPerTile = recipe.tileScaleM;
      material.userData.normalStrength = Math.min(1.6, recipe.normalStrength);
      return material;
    };
    materials.set(`${type}:cliff`, make('cliff'));
    materials.set(`${type}:rocks`, make('rocks'));
  }
  return {
    get(type, role = 'cliff') { return materials.get(`${type}:${role}`) || materials.get(`granite:${role}`); },
    all() { return [...materials.values()]; },
    dispose() { materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); }
  };
}
