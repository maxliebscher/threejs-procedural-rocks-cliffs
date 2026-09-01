// Landscaping-Compiler V10: V9-Feldkern mit kontinuierlicher Kalksteingrammatik.
//
// Uebernimmt den semantischen Planer v2 unveraendert (Stationen, Outline,
// Terrain-Cut, Member-Layout) und ersetzt die V2..V8-Loft-Geometrie durch
// Marching-Tetrahedra ueber gesteinsspezifischen Feldern:
//  - Granit: grosse Loben + Kluftlinien, gerundet.
//  - Sandstein: gebankte Horizonte mit Unterhoehlungen (weltraumfeste Baenke).
//  - Kalkstein: breite Kluftfelder + geglaettete Loesungsformen, ohne Zell-ID-Spruenge.
// Felsgruppen sind eine Smooth-Union ueber alle Form-/Fuellfelsen (1 Mesh,
// 1 Draw), Geroell bleibt eine identisch topologisierte Instanzwolke.
// Geschlossenheit/Windung sind Konstruktionseigenschaften des Feldkerns.

import {
  createNoise, polygonSdf, projectToStations, marchingTetrahedra,
  taubinSmooth, collapseSlivers, decimateMesh, auditMesh, smin, smax, clamp, mix
} from './landscaping-field.js';

const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / Math.max(1e-6, b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Geological grammar: persistent world-space structures, never per-ring noise.

export function createRockGrammar(rockType, seed, noise = createNoise(seed * 977 + 13)) {
  const shoulders = [];
  for (let i = 0; i < 3; i += 1) {
    shoulders.push({
      x: (noise.random() - 0.5) * 8,
      z: (noise.random() - 0.5) * 8,
      amp: (i === 2 ? -1 : 1) * mix(0.16, 0.34, noise.random()),
      radius2: 1 / (mix(1.6, 4.2, noise.random()) ** 2)
    });
  }
  const tiltA = (noise.random() - 0.5) * 0.09;
  const tiltB = (noise.random() - 0.5) * 0.09;

  function crownBase(x, z, h) {
    let y = tiltA * x + tiltB * z + noise.fbm2(x * 0.34, z * 0.34, 3) * 0.30 * h;
    for (const s of shoulders) {
      const d2 = (x - s.x) ** 2 + (z - s.z) ** 2;
      y += s.amp * h * Math.exp(-d2 * s.radius2);
    }
    return y;
  }

  if (rockType === 'sandstone') {
    const bankH = 0.44;
    return {
      type: rockType, smoothIters: 1, crownK: 0.10,
      crown(x, z, h) {
        const raw = crownBase(x, z, h);
        const stepped = Math.round(raw / (bankH * 0.75)) * (bankH * 0.75);
        return clamp(mix(raw, stepped, 0.62), -0.42 * h, 0.42 * h);
      },
      wall(x, y, z, h) {
        const s = clamp(h * 0.30, 0.20, 0.62);
        const phase = (y + noise.fbm2(x * 0.33, z * 0.33, 2) * 0.55) / bankH;
        const bank = Math.floor(phase), fr = phase - bank;
        const amp = mix(0.35, 1, noise.hash3i(bank, 17, 3)) * 0.62 * s;
        const ledge = amp * (smoothstep(0.05, 0.30, fr) - smoothstep(0.62, 0.97, fr));
        const undercut = -0.34 * s * smoothstep(0.16, 0.0, fr) * noise.hash3i(bank, 5, 11);
        const grain = noise.fbm3(x * 1.15, y * 0.6, z * 1.15, 3) * 0.14 * s;
        return ledge + undercut + grain;
      }
    };
  }
  if (rockType === 'limestone') {
    const jointSpacingX = mix(1.25, 1.75, noise.random());
    const jointSpacingZ = mix(1.45, 2.00, noise.random());
    const jointPhaseX = noise.random();
    const jointPhaseZ = noise.random();
    const jointAngle = mix(0.18, 0.72, noise.random());
    const jointCos = Math.cos(jointAngle), jointSin = Math.sin(jointAngle);
    function limestoneJointGrid(x, y, z) {
      const u = jointCos * x + jointSin * z;
      const v = -jointSin * x + jointCos * z;
      const warpU = noise.fbm2(x * 0.15, z * 0.15, 2) * 0.23 + y * 0.022;
      const warpV = noise.fbm2(x * 0.15 + 17.1, z * 0.15 - 9.7, 2) * 0.23 - y * 0.016;
      const sx = Math.abs(Math.sin(((u + warpU) / jointSpacingX + jointPhaseX) * Math.PI));
      const sz = Math.abs(Math.sin(((v + warpV) / jointSpacingZ + jointPhaseZ) * Math.PI));
      const jointX = 1 - smoothstep(0.040, 0.27, sx);
      const jointZ = 1 - smoothstep(0.040, 0.27, sz);
      return Math.max(jointX, jointZ);
    }
    return {
      type: rockType, smoothIters: 1, crownK: 0.11,
      crown(x, z, h) {
        const raw = crownBase(x, z, h);
        const stepH = 0.36;
        const level = raw / stepH;
        const whole = Math.floor(level), fraction = level - whole;
        const terraced = (whole + smoothstep(0.20, 0.80, fraction)) * stepH;
        const broadKarst = noise.fbm2(x * 0.20, z * 0.20, 3) * 0.070 * h;
        const joint = limestoneJointGrid(x, 0, z);
        return clamp(mix(raw, terraced, 0.34) * 0.70 + broadKarst - joint * 0.045 * h, -0.30 * h, 0.30 * h);
      },
      wall(x, y, z, h) {
        const s = clamp(h * 0.30, 0.22, 0.62);
        // Dieselben zwei Kluftfamilien strukturieren Krone und Wand. Ihre
        // Sinus-Distanz ist kontinuierlich; die FBM-Verzerrung verhindert ein
        // kuenstliches Schachbrett, ohne isolierte Spitzen zu erzeugen.
        const verticalJoint = limestoneJointGrid(x, y, z);
        const phase = y / 0.82 + noise.fbm2(x * 0.16, z * 0.16, 2) * 0.26;
        const fraction = phase - Math.floor(phase);
        const bedDistance = Math.min(fraction, 1 - fraction);
        const beddingJoint = 1 - smoothstep(0.025, 0.12, bedDistance);
        const solution = noise.fbm3(x * 0.43, y * 0.31, z * 0.43, 3);
        const pocket = smoothstep(0.22, 0.52, solution);
        const roundedCell = noise.worley3(x * 0.25, y * 0.18, z * 0.25);
        const blockRound = (0.42 - Math.min(roundedCell.f1, 0.9)) * 0.12 * s;
        const broad = noise.fbm3(x * 0.25, y * 0.18, z * 0.25, 3) * 0.36 * s;
        const micro = noise.fbm3(x * 1.25, y * 0.85, z * 1.25, 2) * 0.045 * s;
        return broad + blockRound - verticalJoint * 0.30 * s - beddingJoint * 0.11 * s - pocket * 0.13 * s + micro;
      }
    };
  }
  // Granit (Default)
  return {
    type: 'granite', smoothIters: 2, crownK: 0.14,
    crown(x, z, h) {
      return clamp(crownBase(x, z, h), -0.4 * h, 0.4 * h);
    },
    wall(x, y, z, h) {
      const s = clamp(h * 0.32, 0.22, 0.68);
      const lobes = noise.fbm3(x * 0.44, y * 0.40, z * 0.44, 3) * 0.72 * s;
      const medium = noise.fbm3(x * 1.15, y * 1.05, z * 1.15, 2) * 0.18 * s;
      const wx = x + noise.fbm2(x * 0.2, z * 0.2, 2) * 1.4;
      const j = noise.worley2(wx * 0.5, z * 0.5);
      // Breite, moderat tiefe Kluftrinnen: schmale tiefe Rinnen erzeugten an
      // Silhouetten duenne Fin-Spitzen.
      const joints = -smoothstep(0.22, 0.04, j.f2 - j.f1) * 0.22 * s;
      return lobes + medium + joints;
    }
  };
}

// ---------------------------------------------------------------------------
// Gitterbau + Mesh-Erzeugung.

function meshFromField(THREE, { min, max, cellM, field, smoothIters, role, targetTriangles = 0, maxLattice = 1500000 }) {
  let cell = cellM;
  const span = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const latticeFor = c => (Math.ceil(span[0] / c) + 3) * (Math.ceil(span[1] / c) + 3) * (Math.ceil(span[2] / c) + 3);
  while (latticeFor(cell) > maxLattice) cell *= 1.18;
  const nx = Math.ceil(span[0] / cell) + 3;
  const ny = Math.ceil(span[1] / cell) + 3;
  const nz = Math.ceil(span[2] / cell) + 3;
  const originX = min[0] - cell, originY = min[1] - cell, originZ = min[2] - cell;
  const values = new Float32Array(nx * ny * nz);
  let i = 0;
  const columns = new Array(nx * nz);
  for (let gz = 0; gz < nz; gz += 1) for (let gx = 0; gx < nx; gx += 1) {
    columns[gx + nx * gz] = field.column ? field.column(originX + gx * cell, originZ + gz * cell) : null;
  }
  for (let gz = 0; gz < nz; gz += 1) for (let gy = 0; gy < ny; gy += 1) for (let gx = 0; gx < nx; gx += 1) {
    values[i++] = field.sample(
      originX + gx * cell, originY + gy * cell, originZ + gz * cell,
      columns[gx + nx * gz]
    );
  }
  const grid = { nx, ny, nz, originX, originY, originZ, cell, values };
  const raw = marchingTetrahedra(grid);
  let positions = taubinSmooth(raw.positions, raw.indices, smoothIters);
  let indices = collapseSlivers(positions, raw.indices);
  if (targetTriangles > 0 && indices.length / 3 > targetTriangles * 1.08) {
    const decimated = decimateMesh(positions, indices, targetTriangles);
    positions = decimated.positions;
    indices = decimated.indices;
  }
  // Unbenutzte Vertices kompaktieren (Kollaps/Dezimierung hinterlaesst Waisen).
  {
    const used = new Int32Array(positions.length / 3).fill(-1);
    const compact = [];
    let next = 0;
    for (let i = 0; i < indices.length; i += 1) {
      const v = indices[i];
      if (used[v] === -1) {
        used[v] = next++;
        compact.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      }
      indices[i] = used[v];
    }
    positions = compact;
  }
  const audit = auditMesh(positions, indices);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.semanticRole = role;
  geometry.userData.audit = audit;
  geometry.userData.cellM = cell;
  return geometry;
}

// ---------------------------------------------------------------------------
// Klippenflaeche (Brush-Polygon).

function buildAreaCliffField(plan, grammar, heightAt) {
  const area = plan.cliffArea;
  const outline = area.outline.map(p => ({ x: p.topX, z: p.topZ }));
  const h = area.heightM;
  const crownY = area.crownY;
  const lean = 0.16 * h;
  return {
    outlinePts: outline,
    column(x, z) {
      const d2 = polygonSdf(outline, x, z);
      if (d2 > 2.4) return { d2, skip: true };
      const terrain = Number(heightAt(x, z)) || 0;
      return {
        d2,
        crown: crownY + grammar.crown(x, z, h),
        terrain,
        floorY: terrain - 0.45
      };
    },
    sample(x, y, z, col) {
      if (col.skip) return col.d2;
      if (y < col.floorY - 0.01) return (col.floorY - y);
      const rel = clamp((y - (col.crown - h)) / h, 0, 1.2);
      let disp = grammar.wall(x, y, z, h);
      // Basisschulter: unten leicht ausgestellt, oben zurueckgelehnt.
      disp += 0.30 * smoothstep(0.45, 0.0, rel) * clamp(h * 0.3, 0.2, 0.6);
      disp -= lean * rel * rel;
      const wall = col.d2 - disp;
      const top = (y - col.crown) * 0.9;
      return Math.max(smax(wall, top, grammar.crownK), col.floorY - y);
    }
  };
}

// ---------------------------------------------------------------------------
// Spline-Klippe (Kante oder Ruecken).

function buildSplineCliffField(plan, grammar, heightAt) {
  const line = plan.cliffLine;
  const settings = plan.settings;
  const ridge = settings.cliffBody === 'ridge';
  const cliffSign = settings.side === 'right' ? -1 : 1;
  const width = settings.widthM;
  const frontW = width * 0.16, backW = width * 0.50, halfW = width * 0.42;
  const total = line.at(-1).distance || 1;
  return {
    line,
    column(x, z) {
      const proj = projectToStations(line, x, z);
      if (!proj) return { skip: true };
      const reach = ridge ? halfW + 2.2 : Math.max(frontW, backW) + 2.2;
      if (proj.dist > reach) return { skip: true, far: proj.dist - reach };
      const topY = proj.station.lerp('topY');
      const footY = proj.station.lerp('footY');
      const endFactor = proj.station.lerp('endFactor');
      const h = Math.max(0.3, proj.station.lerp('heightM'));
      const terrain = Number(heightAt(x, z)) || 0;
      const endD = plan.closed ? total : Math.min(proj.along, total - proj.along);
      let crown;
      if (ridge) {
        const lift = clamp((topY - terrain), 0, settings.cliffHeightM * 1.5);
        crown = terrain + lift + grammar.crown(x, z, Math.max(0.8, lift)) * 1.15;
      } else {
        crown = topY + grammar.crown(x, z, h) * 0.22 * endFactor;
      }
      // Kante: unter die Terrain-Cut-Sohle reichen (Cut-Tiefe = Hoehe + 0.8),
      // Keep the trench floor from flashing through as a jagged gap below the foot.
      const floorY = ridge ? terrain - 0.5 : Math.min(footY, terrain) - (settings.cliffHeightM + 0.95);
      return { proj, crown, footY, terrain, h, endFactor, endD, floorY };
    },
    sample(x, y, z, col) {
      if (col.skip) return 0.6 + (col.far || 0);
      if (y < col.floorY - 0.01) return col.floorY - y;
      const { proj, h } = col;
      const disp = grammar.wall(x, y, z, h);
      let lateral, crownEff = col.crown;
      if (ridge) {
        lateral = proj.dist - halfW - disp - 0.26 * smoothstep(0.5, 0.0, (y - col.terrain) / Math.max(0.4, h)) * clamp(h * 0.3, 0.15, 0.5);
      } else {
        const sf = proj.lateral * -cliffSign;
        // Rueckweichung begrenzen: die Front darf nicht hinter die vordere
        // Terrain-Cut-Kante zuruecktreten, sonst schneidet das grobe
        // Gelaenderaster die Wand in sichtbaren Zacken (Fransensaum).
        const front = sf - frontW - Math.max(disp * col.endFactor, -0.18)
          - 0.26 * smoothstep(0.5, 0.0, (y - col.footY) / Math.max(0.4, h)) * clamp(h * 0.3, 0.15, 0.5);
        const back = -sf - backW;
        lateral = Math.max(front, back);
        // Hinter der Kantenlinie taucht die Krone unter das angehobene
        // Gelaende: die Gras-Fels-Naht liegt an der Krone, nicht auf ihr.
        crownEff = col.crown - Math.max(0, -sf - 0.12) * 0.85;
      }
      let f = smax(lateral, (y - crownEff) * 0.9, grammar.crownK);
      if (!plan.closed && !ridge) {
        // Stirnkappe mit eigener Felsstruktur statt sauberem Schnitt.
        f = Math.max(f, (0.12 - col.endD) - disp * 0.55);
      }
      return Math.max(f, col.floorY - y);
    }
  };
}

// ---------------------------------------------------------------------------
// Felsgruppe: Smooth-Union aller Form-/Fuellfelsen.

function buildRockUnionField(plan, grammar, noise, heightAt) {
  const members = [...plan.layers.anchors, ...plan.layers.breakers];
  if (!members.length) return null;
  const singleRock = plan.settings.singleRock === true;
  const rocks = members.map((m, index) => {
    const yaw = m.yaw || 0;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    // Kompensiert den Volumenverlust der Schnittflaechen; Formgeber dominieren.
    const boost = m.role === 'anchor' ? 1.3 : 1.12;
    let hw = m.widthM * 0.5 * boost, hh = m.heightM * 0.5 * boost, hd = m.depthM * 0.5 * boost;
    if (grammar.type === 'sandstone') hh *= 0.85; // flache Bankbloecke, aber keine Plattenfusion
    const planes = [];
    const planeCount = singleRock
      ? (grammar.type === 'granite' ? 10 : grammar.type === 'sandstone' ? 8 : 9)
      : (grammar.type === 'granite' ? 7 : grammar.type === 'sandstone' ? 6 : 7);
    for (let p = 0; p < planeCount; p += 1) {
      let nx = noise.random() - 0.5, ny = noise.random() - 0.5, nz = noise.random() - 0.5;
      if (grammar.type === 'sandstone') ny *= 2.6;           // Baenke: horizontale Schnitte
      if (grammar.type === 'limestone' && p < 3) {           // drei achsnahe, weich gefaste Kluftflaechen
        const axis = p % 3;
        nx = axis === 0 ? Math.sign(nx) : nx * 0.25;
        ny = axis === 1 ? Math.sign(ny) : ny * 0.25;
        nz = axis === 2 ? Math.sign(nz) : nz * 0.25;
      }
      const len = Math.hypot(nx, ny, nz) || 1;
      const normalX = nx / len, normalY = ny / len, normalZ = nz / len;
      const r = Math.max(hw, hh, hd);
      // Bei einem einzelnen Solitaer muss jede Ebene relativ zu seiner
      // ellipsoidischen Stuetzweite liegen. Ein Offset relativ zur groessten
      // Achse verfehlte schmale/tiefe Richtungen und hinterliess die Kartoffel.
      const support = 1 / Math.max(1e-5, Math.hypot(normalX / hw, normalY / hh, normalZ / hd));
      const cutMin = grammar.type === 'granite' ? 0.48 : grammar.type === 'limestone' ? 0.52 : 0.46;
      const cutMax = grammar.type === 'sandstone' ? 0.78 : 0.74;
      planes.push({
        nx: normalX, ny: normalY, nz: normalZ,
        off: singleRock
          ? support * mix(cutMin, cutMax, noise.random())
          : r * mix(grammar.type === 'granite' ? 0.46 : grammar.type === 'limestone' ? 0.50 : 0.42, 0.73, noise.random())
      });
    }
    return {
      index,
      cx: m.x, cy: m.baseY + m.heightM * 0.5, cz: m.z,
      cos, sin, hw, hh, hd,
      r2d: Math.max(hw, hd) * 1.05,
      minAxis: Math.min(hw, hh, hd),
      planes
    };
  });
  // Grosszuegige Verschmelzung: naheliegende Koerper verwachsen zu einer
  // lesbaren Komposition statt sich als Einzelkugeln zu beruehren. Sandstein
  // verschmilzt schwaecher, sonst fusionieren die flachen Baenke zur Platte.
  const k = (singleRock
    ? (grammar.type === 'sandstone' ? 0.10 : grammar.type === 'limestone' ? 0.12 : 0.14)
    : (grammar.type === 'sandstone' ? 0.18 : 0.30)) * clamp(plan.settings.scale, 0.6, 1.6);
  const reach = Math.max(...rocks.map(r => r.r2d)) + k + 0.5;
  function rockSdf(rock, x, y, z) {
    const px = x - rock.cx, py = y - rock.cy, pz = z - rock.cz;
    const lx = rock.cos * px + rock.sin * pz;
    const lz = -rock.sin * px + rock.cos * pz;
    let d = (Math.hypot(lx / rock.hw, py / rock.hh, lz / rock.hd) - 1) * rock.minAxis;
    for (const pl of rock.planes) {
      d = smax(d, lx * pl.nx + py * pl.ny + lz * pl.nz - pl.off, grammar.type === 'limestone' ? 0.045 : 0.025);
    }
    return d;
  }
  return {
    rocks,
    column(x, z) {
      const near = [];
      for (const rock of rocks) {
        const d = Math.hypot(x - rock.cx, z - rock.cz);
        if (d < rock.r2d + reach) near.push(rock);
      }
      return { near, floorY: (Number(heightAt(x, z)) || 0) - 0.55 };
    },
    sample(x, y, z, col) {
      if (!col.near.length) return 0.8;
      if (y < col.floorY - 0.01) return col.floorY - y;
      let f = 1e9;
      for (const rock of col.near) f = smin(f, rockSdf(rock, x, y, z), k);
      // Gemeinsame Geologie ueber die ganze Komposition, nur nahe der
      // Oberflaeche wirksam und gedaempft: die Blockigkeit kommt aus den
      // Schnittflaechen, nicht aus grossem Feldversatz (Nadel-/Plattenrisiko).
      if (f < 0.35) f -= grammar.wall(x, y, z, 1.1) * (singleRock ? 0.54 : 0.42) * (1 - clamp(f / 0.35, 0, 1) * 0.5);
      return Math.max(f, col.floorY - y);
    },
    unionAt(x, y, z) {
      let f = 1e9;
      for (const rock of rocks) f = smin(f, rockSdf(rock, x, y, z), k);
      return f;
    }
  };
}

function buildTalusGeometry(THREE, grammar, noise) {
  const geometry = new THREE.IcosahedronGeometry(0.5, 1);
  const pos = geometry.getAttribute('position');
  const displaced = new Map();
  for (let i = 0; i < pos.count; i += 1) {
    const key = `${pos.getX(i).toFixed(4)}:${pos.getY(i).toFixed(4)}:${pos.getZ(i).toFixed(4)}`;
    if (!displaced.has(key)) {
      const n = noise.fbm3(pos.getX(i) * 3.1, pos.getY(i) * 3.1, pos.getZ(i) * 3.1, 2);
      displaced.set(key, 1 + n * 0.34);
    }
    const scale = displaced.get(key);
    const flat = grammar.type === 'sandstone' ? 0.68 : grammar.type === 'limestone' ? 0.8 : 0.88;
    pos.setXYZ(i, pos.getX(i) * scale, pos.getY(i) * scale * flat, pos.getZ(i) * scale);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function buildGroundBand(THREE, plan, heightAt, material) {
  const band = plan.groundBand;
  if (!band) return null;
  const positions = [], indices = [];
  if (band.mode === 'area' && band.outline?.length >= 3) {
    const pts = band.outline;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    const radialSteps = 6;
    positions.push(cx, (Number(heightAt(cx, cz)) || 0) + 0.018, cz);
    for (let ring = 1; ring <= radialSteps; ring += 1) {
      const t = ring / radialSteps;
      pts.forEach(p => {
        const x = mix(cx, p.x, t), z = mix(cz, p.z, t);
        positions.push(x, (Number(heightAt(x, z)) || 0) + 0.018, z);
      });
    }
    for (let i = 0; i < pts.length; i += 1) indices.push(0, 1 + i, 1 + (i + 1) % pts.length);
    for (let ring = 1; ring < radialSteps; ring += 1) {
      const inner = 1 + (ring - 1) * pts.length;
      const outer = inner + pts.length;
      for (let i = 0; i < pts.length; i += 1) {
        const next = (i + 1) % pts.length;
        indices.push(inner + i, outer + i, inner + next, inner + next, outer + i, outer + next);
      }
    }
  } else if (band.samples?.length >= 2) {
    band.samples.forEach(s => {
      positions.push(
        s.x - s.normalX * s.halfWidthM, (Number(heightAt(s.x - s.normalX * s.halfWidthM, s.z - s.normalZ * s.halfWidthM)) || 0) + 0.015, s.z - s.normalZ * s.halfWidthM,
        s.x + s.normalX * s.halfWidthM, (Number(heightAt(s.x + s.normalX * s.halfWidthM, s.z + s.normalZ * s.halfWidthM)) || 0) + 0.015, s.z + s.normalZ * s.halfWidthM
      );
    });
    for (let i = 0; i < band.samples.length - 1; i += 1) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  } else return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.semanticRole = 'ground-transition';
  mesh.renderOrder = -1;
  return mesh;
}

// ---------------------------------------------------------------------------

export function compileLandscapingV10(THREE, plan, options = {}) {
  const started = performance.now();
  const settings = plan.settings;
  const heightAt = options.heightAt || (() => 0);
  const cellM = clamp(Number(options.cellM) || 0.24, 0.10, 0.6);
  const targetTriangles = Math.max(0, Math.round(Number(options.targetTriangles) || 0));
  const grammar = createRockGrammar(options.rockType || 'granite', settings.seed);
  if (options.crownMode === 'plane') {
    const original = grammar.crown.bind(grammar);
    grammar.crown = (x, z, h) => original(x, z, h) * 0.06;
  }
  const noise = createNoise(settings.seed * 31 + 7);
  const group = new THREE.Group();
  group.name = 'landscaping-v10';
  const geometries = [];
  const disposables = [];
  let instances = 0;
  let mainGeometry = null;

  if (plan.cliffArea) {
    const area = plan.cliffArea;
    const xs = area.outline.map(p => p.topX), zs = area.outline.map(p => p.topZ);
    const margin = 1.6;
    const field = buildAreaCliffField(plan, grammar, heightAt);
    mainGeometry = meshFromField(THREE, {
      min: [Math.min(...xs) - margin, area.bottomY - 0.4, Math.min(...zs) - margin],
      max: [Math.max(...xs) + margin, area.crownY + area.heightM * 0.55 + 0.4, Math.max(...zs) + margin],
      cellM, field, smoothIters: grammar.smoothIters, role: 'v10-cliff-area', targetTriangles
    });
  } else if (plan.cliffLine?.length >= 2) {
    const line = plan.cliffLine;
    const xs = line.flatMap(s => [s.footX, s.backFootX ?? s.x]);
    const zs = line.flatMap(s => [s.footZ, s.backFootZ ?? s.z]);
    const ys = line.flatMap(s => [s.footY, s.topY]);
    const margin = settings.widthM * 0.6 + 1.2;
    const field = buildSplineCliffField(plan, grammar, heightAt);
    mainGeometry = meshFromField(THREE, {
      min: [Math.min(...xs) - margin, Math.min(...ys) - 0.9, Math.min(...zs) - margin],
      max: [Math.max(...xs) + margin, Math.max(...ys) + settings.cliffHeightM * 0.5 + 0.5, Math.max(...zs) + margin],
      cellM, field, smoothIters: grammar.smoothIters, role: 'v10-cliff-spline', targetTriangles
    });
  } else {
    const union = buildRockUnionField(plan, grammar, noise, heightAt);
    if (union) {
      const xs = union.rocks.flatMap(r => [r.cx - r.r2d, r.cx + r.r2d]);
      const zs = union.rocks.flatMap(r => [r.cz - r.r2d, r.cz + r.r2d]);
      const ys = union.rocks.flatMap(r => [r.cy - r.hh, r.cy + r.hh]);
      const margin = 0.8;
      mainGeometry = meshFromField(THREE, {
        min: [Math.min(...xs) - margin, Math.min(...ys) - 0.5, Math.min(...zs) - margin],
        max: [Math.max(...xs) + margin, Math.max(...ys) + margin, Math.max(...zs) + margin],
        cellM: cellM * 0.82,
        field: union,
        // Solitaere behalten die extrahierten Bruchkanten. Schon ein Taubin-
        // Durchlauf rundete die achsbezogenen Schnitte wieder zur Kartoffel ab.
        smoothIters: plan.settings.singleRock === true ? 0 : Math.min(1, grammar.smoothIters),
        role: 'v10-rock-union',
        targetTriangles: targetTriangles ? Math.round(targetTriangles * 0.8) : 0
      });
    }
    // Geroellsaum als Instanzen: identische Topologie, kein Kontakt zum Koerper.
    // Der semantische Plan legt den Saum an die Kontur. Grosse SDF-Loben
    // koennen dort trotzdem weiter nach aussen reichen und korrekt platzierte
    // Mittelsteine verschlucken. Statt sie als Durchdringungen zu behalten
    // oder still zu verwerfen, werden sie radial gerade so weit nach aussen
    // geschoben, bis zwischen beiden geschlossenen Koerpern Luft bleibt.
    const unionCenter = union?.rocks?.length ? {
      x: union.rocks.reduce((sum, rock) => sum + rock.cx, 0) / union.rocks.length,
      z: union.rocks.reduce((sum, rock) => sum + rock.cz, 0) / union.rocks.length
    } : { x: 0, z: 0 };
    const talusMembers = plan.layers.talus.map(source => {
      const member = { ...source };
      if (!union) return member;
      let dx = member.x - unionCenter.x;
      let dz = member.z - unionCenter.z;
      const length = Math.hypot(dx, dz) || 1;
      dx /= length;
      dz /= length;
      for (let step = 0; step < 10; step += 1) {
        const sampleY = member.terrainY + member.heightM * 0.2;
        if (union.unionAt(member.x, sampleY, member.z) > member.radiusM * 0.16) break;
        const advance = Math.max(0.08, member.radiusM * 0.32);
        member.x += dx * advance;
        member.z += dz * advance;
        if (options.terrainBounds?.width > 0 && options.terrainBounds?.depth > 0) {
          const maxX = Math.max(0, options.terrainBounds.width * 0.5 - member.radiusM - 0.055);
          const maxZ = Math.max(0, options.terrainBounds.depth * 0.5 - member.radiusM - 0.055);
          member.x = clamp(member.x, -maxX, maxX);
          member.z = clamp(member.z, -maxZ, maxZ);
        }
        member.terrainY = Number(heightAt(member.x, member.z)) || 0;
        member.baseY = member.terrainY - member.embedM;
      }
      return member;
    }).filter(member => !union || union.unionAt(
      member.x,
      member.terrainY + member.heightM * 0.2,
      member.z
    ) > member.radiusM * 0.1);
    if (talusMembers.length) {
      const talusGeometry = buildTalusGeometry(THREE, grammar, noise);
      const talusMesh = new THREE.InstancedMesh(talusGeometry, options.rockMaterial, talusMembers.length);
      const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(), pos = new THREE.Vector3();
      const euler = new THREE.Euler();
      talusMembers.forEach((m, i) => {
        euler.set((noise.random() - 0.5) * 0.5, m.yaw, (noise.random() - 0.5) * 0.5);
        quaternion.setFromEuler(euler);
        scale.set(m.widthM, m.heightM, m.depthM);
        pos.set(m.x, m.baseY + m.heightM * 0.42, m.z);
        matrix.compose(pos, quaternion, scale);
        talusMesh.setMatrixAt(i, matrix);
      });
      talusMesh.instanceMatrix.needsUpdate = true;
      talusMesh.castShadow = talusMesh.receiveShadow = true;
      talusMesh.userData.semanticRole = 'talus';
      talusMesh.userData.members = talusMembers;
      group.add(talusMesh);
      geometries.push(talusGeometry);
      disposables.push(talusGeometry);
      instances = talusMembers.length;
    }
    if (options.groundMaterial) {
      const ground = buildGroundBand(THREE, plan, heightAt, options.groundMaterial);
      if (ground) { group.add(ground); disposables.push(ground.geometry); }
    }
  }

  if (mainGeometry) {
    const mesh = new THREE.Mesh(mainGeometry, options.stoneMaterial);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.semanticRole = mainGeometry.userData.semanticRole;
    group.add(mesh);
    geometries.push(mainGeometry);
    disposables.push(mainGeometry);
  }

  const audit = mainGeometry?.userData.audit || { boundaryEdges: 0, degenerateTriangles: 0, windingConflicts: 0, signedVolume: 0 };
  let triangles = 0;
  group.traverse(object => {
    if (!object.isMesh) return;
    const geometry = object.geometry;
    const per = geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
    triangles += per * (object.isInstancedMesh ? object.count : 1);
  });
  const box = mainGeometry?.boundingBox;
  return {
    group,
    geometries: { main: mainGeometry },
    dispose() { disposables.forEach(g => g.dispose()); },
    metrics: {
      compiler: 'v10',
      drawCalls: group.children.length,
      triangles: Math.round(triangles),
      instances,
      cellM: mainGeometry?.userData.cellM || cellM,
      buildMs: performance.now() - started,
      bounds: box ? {
        x: +(box.max.x - box.min.x).toFixed(2),
        y: +(box.max.y - box.min.y).toFixed(2),
        z: +(box.max.z - box.min.z).toFixed(2)
      } : null,
      ...audit
    }
  };
}
