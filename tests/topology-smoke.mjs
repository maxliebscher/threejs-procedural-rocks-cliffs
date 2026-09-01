import * as THREE from 'three';
import { planLandscaping } from '../src/landscaping-planner.js';
import { compileLandscapingV10 } from '../src/landscaping-compiler.js';

const heightAt = (x, z) => (
  Math.sin(x * 0.52) * 0.12
  + Math.cos(z * 0.63) * 0.08
  + Math.sin((x + z) * 0.27) * 0.05
);

const footprint = [
  [-4, -0.8], [-2.8, -2.3], [-0.5, -2.7], [2.4, -2], [4, 0.2],
  [2.7, 2.2], [0.5, 2.7], [-2.3, 2.1], [-4.2, 0.7]
].map(([x, z]) => ({ x, z }));

const curve = new THREE.CatmullRomCurve3(
  footprint.map(({ x, z }) => new THREE.Vector3(x, 0, z)),
  true,
  'centripetal',
  0.42
);
const centerline = curve.getPoints(96).map(({ x, z }) => ({ x, z }));

let failures = 0;

const burial48 = planLandscaping({ centerline, heightAt, closed: true, settings: { preset: 'rockfield', embedding: 0.48, seed: 7 } });
const burial69 = planLandscaping({ centerline, heightAt, closed: true, settings: { preset: 'rockfield', embedding: 0.69, seed: 7 } });
const shallowEmbed = burial48.layers.anchors[0].embedM;
const deepEmbed = burial69.layers.anchors[0].embedM;
if (!(deepEmbed > shallowEmbed * 1.35)) {
  console.error(`FAIL burial range: 48%=${shallowEmbed.toFixed(3)} m, 69%=${deepEmbed.toFixed(3)} m`);
  failures += 1;
} else {
  console.log(`PASS burial range: 48%=${shallowEmbed.toFixed(3)} m, 69%=${deepEmbed.toFixed(3)} m`);
}

for (const preset of ['rockfield', 'cliff']) {
  for (const rockType of ['granite', 'sandstone', 'limestone']) {
    const plan = planLandscaping({
      centerline,
      heightAt,
      closed: true,
      settings: {
        mode: 'brush',
        preset,
        widthM: 4.2,
        density: 0.72,
        scale: 1,
        embedding: 0.3,
        cliffHeightM: 1.7,
        cliffBody: 'edge',
        side: 'left',
        quality: 'low',
        seed: 7
      }
    });

    const compiled = compileLandscapingV10(THREE, plan, {
      heightAt,
      rockType,
      cellM: preset === 'cliff' ? 0.30 : 0.25,
      targetTriangles: preset === 'cliff' ? 9000 : 5000
    });

    const metrics = compiled.metrics;
    const valid = metrics.boundaryEdges === 0
      && metrics.degenerateTriangles === 0
      && metrics.windingConflicts === 0
      && metrics.signedVolume > 0;

    console.log(
      `${valid ? 'PASS' : 'FAIL'} ${preset}/${rockType}`,
      `${metrics.triangles} triangles`,
      `${metrics.buildMs.toFixed(0)} ms`,
      `boundary=${metrics.boundaryEdges}`,
      `degenerate=${metrics.degenerateTriangles}`,
      `winding=${metrics.windingConflicts}`,
      `volume=${metrics.signedVolume.toFixed(2)} m³`
    );

    if (!valid) failures += 1;
    compiled.dispose();
  }
}

if (failures) {
  console.error(`\n${failures} topology case(s) failed.`);
  process.exit(1);
}

console.log('\nAll topology smoke cases passed.');
