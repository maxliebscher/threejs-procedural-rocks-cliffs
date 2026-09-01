// Landscaping V9: implizites Feld + Marching-Tetrahedra.
//
// Alle V9-Felskoerper (Klippenflaeche, Spline-Klippe, Felsgruppen-Union) entstehen
// aus einem einzigen skalaren Feld f(x,y,z) (innen < 0). Die Kuhn-6-Tetraeder-
// Zerlegung teilt sich Flaechendiagonalen mit allen Nachbarzellen, die Schnitt-
// punkte werden ueber Kantenschluessel geteilt, die Dreieckswindung folgt dem
// exakten linearen Feldgradienten des Tetraeders. Ergebnis: geschlossene,
// konsistent orientierte 2-Mannigfaltigkeit ohne Tabellen-Sonderfaelle --
// boundaryEdges = 0 ist eine Konstruktionseigenschaft, kein Reparaturziel.
// Renderer-neutral: kein Three.js-Import.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;

export const smin = (a, b, k) => {
  if (k <= 0) return Math.min(a, b);
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return mix(b, a, h) - k * h * (1 - h);
};
export const smax = (a, b, k) => -smin(-a, -b, k);
export { clamp, mix };

// ---------------------------------------------------------------------------
// Deterministisches Rauschen (Integer-Hash, kein Math.sin-Lattice).

export function createNoise(seed) {
  const S = (Math.floor(seed) || 1) >>> 0;
  function hash3i(x, y, z) {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647 + S * 144665) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    h ^= h >>> 16;
    return h / 4294967296;
  }
  const fade = t => t * t * (3 - 2 * t);
  function value3(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
    const c = (dx, dy, dz) => hash3i(ix + dx, iy + dy, iz + dz);
    return mix(
      mix(mix(c(0, 0, 0), c(1, 0, 0), fx), mix(c(0, 1, 0), c(1, 1, 0), fx), fy),
      mix(mix(c(0, 0, 1), c(1, 0, 1), fx), mix(c(0, 1, 1), c(1, 1, 1), fx), fy),
      fz
    );
  }
  const value2 = (x, z) => value3(x, 77.7, z);
  function fbm3(x, y, z, octaves = 4, lacunarity = 2.03, gain = 0.5) {
    let sum = 0, amp = 0.5, fx = x, fy = y, fz = z, norm = 0;
    for (let o = 0; o < octaves; o += 1) {
      sum += (value3(fx, fy, fz) - 0.5) * 2 * amp;
      norm += amp; amp *= gain;
      fx = fx * lacunarity + 13.1; fy = fy * lacunarity + 7.7; fz = fz * lacunarity + 3.9;
    }
    return sum / norm;
  }
  const fbm2 = (x, z, octaves = 4) => fbm3(x, 31.7, z, octaves);
  // Worley: F1/F2 und Zellwert fuer Bloecke/Kluftlinien.
  function worley2(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    let f1 = 1e9, f2 = 1e9, id = 0;
    for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const cx = ix + dx, cz = iz + dz;
      const px = cx + hash3i(cx, 11, cz), pz = cz + hash3i(cx, 47, cz);
      const d = Math.hypot(px - x, pz - z);
      if (d < f1) { f2 = f1; f1 = d; id = hash3i(cx, 91, cz); } else if (d < f2) f2 = d;
    }
    return { f1, f2, id };
  }
  function worley3(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let f1 = 1e9, f2 = 1e9, id = 0;
    for (let dz = -1; dz <= 1; dz += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      const px = cx + hash3i(cx, cy, cz), py = cy + hash3i(cx + 7, cy, cz), pz = cz + hash3i(cx, cy, cz + 7);
      const ddx = px - x, ddy = py - y, ddz = pz - z;
      const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      if (d < f1) { f2 = f1; f1 = d; id = hash3i(cx + 3, cy + 5, cz + 9); } else if (d < f2) f2 = d;
    }
    return { f1, f2, id };
  }
  const random = (() => {
    let state = ((S * 2654435761) >>> 0) || 1;
    return () => {
      state ^= state << 13; state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5; state >>>= 0;
      return state / 4294967296;
    };
  })();
  return { hash3i, value3, value2, fbm3, fbm2, worley2, worley3, random };
}

// ---------------------------------------------------------------------------
// 2D-Hilfsgeometrie.

// Vorzeichenbehaftete Distanz zum Polygon, innen negativ.
export function polygonSdf(points, x, z) {
  const n = points.length;
  let d = Infinity, inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = points[j], b = points[i];
    const ex = b.x - a.x, ez = b.z - a.z;
    const wx = x - a.x, wz = z - a.z;
    const t = clamp((wx * ex + wz * ez) / ((ex * ex + ez * ez) || 1e-12), 0, 1);
    const px = wx - ex * t, pz = wz - ez * t;
    d = Math.min(d, px * px + pz * pz);
    const crosses = (b.z > z) !== (a.z > z)
      && x < (a.x - b.x) * (z - b.z) / ((a.z - b.z) || 1e-12) + b.x;
    if (crosses) inside = !inside;
  }
  return (inside ? -1 : 1) * Math.sqrt(d);
}

// Naechster Punkt auf einer Stationskette. Liefert vorzeichenbehaftete
// Lateraldistanz (positiv Richtung Stationsnormale), Distanz, Bogenparameter
// und interpolierte Station.
export function projectToStations(stations, x, z) {
  let best = null, bestD2 = Infinity;
  for (let i = 0; i < stations.length - 1; i += 1) {
    const a = stations[i], b = stations[i + 1];
    const ex = b.x - a.x, ez = b.z - a.z;
    const len2 = (ex * ex + ez * ez) || 1e-12;
    const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / len2, 0, 1);
    const px = a.x + ex * t, pz = a.z + ez * t;
    const dx = x - px, dz = z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = { i, t, px, pz, dx, dz }; }
  }
  if (!best) return null;
  const a = stations[best.i], b = stations[best.i + 1];
  const lerp = key => mix(a[key] ?? 0, b[key] ?? 0, best.t);
  const nx = mix(a.normalX, b.normalX, best.t), nz = mix(a.normalZ, b.normalZ, best.t);
  const nl = Math.hypot(nx, nz) || 1;
  return {
    index: best.i, frac: best.t,
    dist: Math.sqrt(bestD2),
    lateral: (best.dx * nx + best.dz * nz) / nl,
    along: lerp('distance'),
    station: { lerp, normalX: nx / nl, normalZ: nz / nl }
  };
}

// ---------------------------------------------------------------------------
// Marching-Tetrahedra ueber einem uniformen Gitter.

const CUBE_CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
];
const TETS = [
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]
];
// Barycentrische Gradientenbasis pro Tetraeder (Einheitszelle): invertierte
// Kantenmatrix, damit der lineare Feldgradient exakt bestimmt werden kann.
const TET_BASIS = TETS.map(tet => {
  const p = tet.map(c => CUBE_CORNERS[c]);
  const m = [
    [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]],
    [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]],
    [p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]]
  ];
  const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const inv = [
    [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det],
    [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) / det, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / det],
    [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / det, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det]
  ];
  return inv;
});

// Innenmengen -> Schnittkantenpaare in zyklischer Reihenfolge (Quads geteilt).
const TET_CASES = [];
{
  const E = (a, b) => [a, b];
  TET_CASES[0] = TET_CASES[15] = [];
  TET_CASES[1] = [[E(0, 1), E(0, 2), E(0, 3)]];
  TET_CASES[14] = TET_CASES[1];
  TET_CASES[2] = [[E(0, 1), E(1, 2), E(1, 3)]];
  TET_CASES[13] = TET_CASES[2];
  TET_CASES[4] = [[E(0, 2), E(1, 2), E(2, 3)]];
  TET_CASES[11] = TET_CASES[4];
  TET_CASES[8] = [[E(0, 3), E(1, 3), E(2, 3)]];
  TET_CASES[7] = TET_CASES[8];
  TET_CASES[3] = [[E(0, 2), E(1, 2), E(1, 3)], [E(0, 2), E(1, 3), E(0, 3)]];
  TET_CASES[12] = TET_CASES[3];
  TET_CASES[5] = [[E(0, 1), E(1, 2), E(2, 3)], [E(0, 1), E(2, 3), E(0, 3)]];
  TET_CASES[10] = TET_CASES[5];
  TET_CASES[6] = [[E(0, 1), E(1, 3), E(2, 3)], [E(0, 1), E(2, 3), E(0, 2)]];
  TET_CASES[9] = TET_CASES[6];
}

/**
 * @param {object} grid { nx, ny, nz, originX, originY, originZ, cell, values:Float32Array }
 * Aeussere Gitterschale wird als "aussen" erzwungen -> Flaeche schliesst immer.
 */
export function marchingTetrahedra(grid) {
  const { nx, ny, nz, cell } = grid;
  const values = grid.values;
  const idx = (x, y, z) => x + nx * (y + ny * z);
  // Schutzschale + Null-Nudge.
  for (let z = 0; z < nz; z += 1) for (let y = 0; y < ny; y += 1) for (let x = 0; x < nx; x += 1) {
    const i = idx(x, y, z);
    if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) {
      if (values[i] < cell * 0.5) values[i] = cell * 0.5;
    } else if (Math.abs(values[i]) < 1e-5) values[i] = 1e-5;
  }
  const positions = [];
  const indices = [];
  const edgeVertex = new Map();
  const lattice = nx * ny * nz;
  const cornerIdx = new Int32Array(8);
  const cornerVal = new Float64Array(8);
  function vertexOnEdge(la, lb) {
    const key = la < lb ? la * lattice + lb : lb * lattice + la;
    let v = edgeVertex.get(key);
    if (v !== undefined) return v;
    const fa = values[la], fb = values[lb];
    const t = clamp(fa / (fa - fb), 0.015, 0.985);
    const ax = la % nx, ay = ((la / nx) | 0) % ny, az = (la / (nx * ny)) | 0;
    const bx = lb % nx, by = ((lb / nx) | 0) % ny, bz = (lb / (nx * ny)) | 0;
    v = positions.length / 3;
    positions.push(
      grid.originX + (ax + (bx - ax) * t) * cell,
      grid.originY + (ay + (by - ay) * t) * cell,
      grid.originZ + (az + (bz - az) * t) * cell
    );
    edgeVertex.set(key, v);
    return v;
  }
  for (let z = 0; z < nz - 1; z += 1) for (let y = 0; y < ny - 1; y += 1) for (let x = 0; x < nx - 1; x += 1) {
    let anyNeg = false, anyPos = false;
    for (let c = 0; c < 8; c += 1) {
      const o = CUBE_CORNERS[c];
      const i = idx(x + o[0], y + o[1], z + o[2]);
      cornerIdx[c] = i;
      cornerVal[c] = values[i];
      if (cornerVal[c] < 0) anyNeg = true; else anyPos = true;
    }
    if (!anyNeg || !anyPos) continue;
    for (let t = 0; t < 6; t += 1) {
      const tet = TETS[t];
      const f0 = cornerVal[tet[0]], f1 = cornerVal[tet[1]], f2 = cornerVal[tet[2]], f3 = cornerVal[tet[3]];
      let code = 0;
      if (f0 < 0) code |= 1;
      if (f1 < 0) code |= 2;
      if (f2 < 0) code |= 4;
      if (f3 < 0) code |= 8;
      const tris = TET_CASES[code];
      if (!tris.length) continue;
      // Exakter linearer Gradient dieses Tetraeders (fuer die Windung).
      const inv = TET_BASIS[t];
      const d1 = f1 - f0, d2 = f2 - f0, d3 = f3 - f0;
      const gx = inv[0][0] * d1 + inv[0][1] * d2 + inv[0][2] * d3;
      const gy = inv[1][0] * d1 + inv[1][1] * d2 + inv[1][2] * d3;
      const gz = inv[2][0] * d1 + inv[2][1] * d2 + inv[2][2] * d3;
      for (const tri of tris) {
        const va = vertexOnEdge(cornerIdx[tet[tri[0][0]]], cornerIdx[tet[tri[0][1]]]);
        const vb = vertexOnEdge(cornerIdx[tet[tri[1][0]]], cornerIdx[tet[tri[1][1]]]);
        const vc = vertexOnEdge(cornerIdx[tet[tri[2][0]]], cornerIdx[tet[tri[2][1]]]);
        if (va === vb || vb === vc || va === vc) continue;
        const ax = positions[va * 3], ay = positions[va * 3 + 1], az = positions[va * 3 + 2];
        const ux = positions[vb * 3] - ax, uy = positions[vb * 3 + 1] - ay, uz = positions[vb * 3 + 2] - az;
        const wx = positions[vc * 3] - ax, wy = positions[vc * 3 + 1] - ay, wz = positions[vc * 3 + 2] - az;
        const nxT = uy * wz - uz * wy, nyT = uz * wx - ux * wz, nzT = ux * wy - uy * wx;
        // Normale zeigt in Richtung wachsenden Feldes (aussen).
        if (nxT * gx + nyT * gy + nzT * gz >= 0) indices.push(va, vb, vc);
        else indices.push(va, vc, vb);
      }
    }
  }
  return { positions, indices };
}

// ---------------------------------------------------------------------------
// Taubin-Glaettung: entfernt Tetraeder-Splitter, erhaelt Volumen weitgehend.

export function taubinSmooth(positions, indices, iterations = 1, lambda = 0.42, mu = -0.44) {
  if (iterations <= 0) return positions;
  const count = positions.length / 3;
  const neighbors = Array.from({ length: count }, () => []);
  const seen = new Set();
  for (let i = 0; i < indices.length; i += 3) {
    for (const [a, b] of [[indices[i], indices[i + 1]], [indices[i + 1], indices[i + 2]], [indices[i + 2], indices[i]]]) {
      const key = a < b ? a * count + b : b * count + a;
      if (seen.has(key)) continue;
      seen.add(key);
      neighbors[a].push(b);
      neighbors[b].push(a);
    }
  }
  let src = positions;
  const pass = (input, factor) => {
    const out = new Float64Array(input.length);
    for (let v = 0; v < count; v += 1) {
      const list = neighbors[v];
      let mx = 0, my = 0, mz = 0;
      for (const n of list) { mx += input[n * 3]; my += input[n * 3 + 1]; mz += input[n * 3 + 2]; }
      const inv = list.length ? 1 / list.length : 0;
      out[v * 3] = input[v * 3] + factor * (mx * inv - input[v * 3]) * (list.length ? 1 : 0);
      out[v * 3 + 1] = input[v * 3 + 1] + factor * (my * inv - input[v * 3 + 1]) * (list.length ? 1 : 0);
      out[v * 3 + 2] = input[v * 3 + 2] + factor * (mz * inv - input[v * 3 + 2]) * (list.length ? 1 : 0);
    }
    return out;
  };
  for (let iter = 0; iter < iterations; iter += 1) {
    src = pass(src, lambda);
    src = pass(src, mu);
  }
  return Array.from(src);
}

// ---------------------------------------------------------------------------
// Sliver-Beseitigung: kollabiert (nahezu) flaechenlose Dreiecke ueber ihre
// kuerzeste Kante. Die beiden Anlieger der Kante verschwinden, alle uebrigen
// Dreiecke werden umgehaengt -- der Standard-Kantenkollaps, der die
// Mannigfaltigkeit erhaelt. Das Audit verifiziert das Ergebnis.

export function collapseSlivers(positions, indices, crossEps = 1e-12) {
  let tris = indices;
  for (let pass = 0; pass < 4; pass += 1) {
    const remap = new Int32Array(positions.length / 3);
    for (let i = 0; i < remap.length; i += 1) remap[i] = i;
    const resolve = v => { while (remap[v] !== v) v = remap[v]; return v; };
    let found = 0;
    for (let i = 0; i < tris.length; i += 3) {
      const a = resolve(tris[i]), b = resolve(tris[i + 1]), c = resolve(tris[i + 2]);
      if (a === b || b === c || a === c) continue;
      const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
      const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
      const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * nx + ny * ny + nz * nz >= crossEps) continue;
      const dab = ux * ux + uy * uy + uz * uz;
      const dbc = (cx - bx) ** 2 + (cy - by) ** 2 + (cz - bz) ** 2;
      const dca = vx * vx + vy * vy + vz * vz;
      if (dab <= dbc && dab <= dca) remap[b] = a;
      else if (dbc <= dca) remap[c] = b;
      else remap[a] = c;
      found += 1;
    }
    if (!found) break;
    const next = [];
    for (let i = 0; i < tris.length; i += 3) {
      const a = resolve(tris[i]), b = resolve(tris[i + 1]), c = resolve(tris[i + 2]);
      if (a === b || b === c || a === c) continue;
      next.push(a, b, c);
    }
    tris = next;
  }
  return tris;
}

// ---------------------------------------------------------------------------
// QEM-Dezimierung: Kantenkollaps mit Fehlerquadriken, Link-Condition und
// Flip-Guard. Marching-Tetrahedra erzeugt ~2-3x mehr Dreiecke als noetig;
// die Dezimierung bringt das Mesh kontrolliert auf das Sichtbudget, ohne die
// Mannigfaltigkeit zu verlieren (das Audit verifiziert jedes Ergebnis).

export function decimateMesh(positions, indices, targetTriangles) {
  const vertexCount = positions.length / 3;
  const pos = Float64Array.from(positions);
  const faces = [];
  for (let i = 0; i < indices.length; i += 3) faces.push([indices[i], indices[i + 1], indices[i + 2]]);
  const faceAlive = new Uint8Array(faces.length).fill(1);
  const vertFaces = Array.from({ length: vertexCount }, () => new Set());
  faces.forEach((f, i) => { vertFaces[f[0]].add(i); vertFaces[f[1]].add(i); vertFaces[f[2]].add(i); });
  const quadrics = new Float64Array(vertexCount * 10);
  const addQuadric = (v, nx, ny, nz, d, w) => {
    const q = v * 10;
    quadrics[q] += nx * nx * w; quadrics[q + 1] += nx * ny * w; quadrics[q + 2] += nx * nz * w; quadrics[q + 3] += nx * d * w;
    quadrics[q + 4] += ny * ny * w; quadrics[q + 5] += ny * nz * w; quadrics[q + 6] += ny * d * w;
    quadrics[q + 7] += nz * nz * w; quadrics[q + 8] += nz * d * w; quadrics[q + 9] += d * d * w;
  };
  const faceNormal = f => {
    const [a, b, c] = f;
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
    const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };
  for (let i = 0; i < faces.length; i += 1) {
    const n = faceNormal(faces[i]);
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-14) continue;
    const nx = n[0] / len, ny = n[1] / len, nz = n[2] / len;
    const a = faces[i][0];
    const d = -(nx * pos[a * 3] + ny * pos[a * 3 + 1] + nz * pos[a * 3 + 2]);
    const w = len * 0.5;
    for (const v of faces[i]) addQuadric(v, nx, ny, nz, d, w);
  }
  const qError = (a, b, x, y, z) => {
    let e = 0;
    for (const v of [a, b]) {
      const q = v * 10;
      e += x * x * quadrics[q] + 2 * x * y * quadrics[q + 1] + 2 * x * z * quadrics[q + 2] + 2 * x * quadrics[q + 3]
        + y * y * quadrics[q + 4] + 2 * y * z * quadrics[q + 5] + 2 * y * quadrics[q + 6]
        + z * z * quadrics[q + 7] + 2 * z * quadrics[q + 8] + quadrics[q + 9];
    }
    return e;
  };
  const version = new Uint32Array(vertexCount);
  const heap = [];
  const heapPush = entry => {
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].cost <= heap[i].cost) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
    }
  };
  const heapPop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].cost < heap[m].cost) m = l;
        if (r < heap.length && heap[r].cost < heap[m].cost) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  const pushEdge = (a, b) => {
    if (a === b) return;
    const candidates = [
      [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]],
      [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]],
      [(pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2]
    ];
    let best = null, bestCost = Infinity;
    for (const c of candidates) {
      const e = qError(a, b, c[0], c[1], c[2]);
      if (e < bestCost) { bestCost = e; best = c; }
    }
    heapPush({ cost: bestCost, a, b, va: version[a], vb: version[b], x: best[0], y: best[1], z: best[2] });
  };
  const seenEdges = new Set();
  for (const f of faces) for (const [a, b] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]]) {
    const key = a < b ? a * vertexCount + b : b * vertexCount + a;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    pushEdge(Math.min(a, b), Math.max(a, b));
  }
  let alive = faces.length;
  const neighborVerts = v => {
    const out = new Set();
    for (const fi of vertFaces[v]) { if (!faceAlive[fi]) continue; for (const w of faces[fi]) if (w !== v) out.add(w); }
    return out;
  };
  while (alive > targetTriangles && heap.length) {
    const entry = heapPop();
    const { a, b } = entry;
    if (version[a] !== entry.va || version[b] !== entry.vb) continue;
    // Link-Condition: gemeinsame Nachbarn muessen exakt die Gegenpunkte der
    // gemeinsamen Dreiecke sein, sonst entstuende ein Nicht-Mannigfaltigkeits-Pinch.
    const sharedFaces = [];
    for (const fi of vertFaces[a]) if (faceAlive[fi] && vertFaces[b].has(fi)) sharedFaces.push(fi);
    if (sharedFaces.length !== 2) continue;
    const na = neighborVerts(a), nb = neighborVerts(b);
    let common = 0;
    for (const v of na) if (nb.has(v)) common += 1;
    if (common !== 2) continue;
    // Flip-Guard: keine Normale darf umklappen, kein Dreieck kollabieren.
    const ox = pos[a * 3], oy = pos[a * 3 + 1], oz = pos[a * 3 + 2];
    const obx = pos[b * 3], oby = pos[b * 3 + 1], obz = pos[b * 3 + 2];
    let ok = true;
    const moved = [[a, ox, oy, oz], [b, obx, oby, obz]];
    for (const [v] of moved) {
      for (const fi of vertFaces[v]) {
        if (!faceAlive[fi] || sharedFaces.includes(fi)) continue;
        const before = faceNormal(faces[fi]);
        pos[v * 3] = entry.x; pos[v * 3 + 1] = entry.y; pos[v * 3 + 2] = entry.z;
        const after = faceNormal(faces[fi]);
        pos[v * 3] = v === a ? ox : obx; pos[v * 3 + 1] = v === a ? oy : oby; pos[v * 3 + 2] = v === a ? oz : obz;
        const lenAfter = Math.hypot(after[0], after[1], after[2]);
        const dot = before[0] * after[0] + before[1] * after[1] + before[2] * after[2];
        if (lenAfter < 1e-14 || dot <= 0) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (!ok) continue;
    // Kollaps: b -> a an neue Position.
    pos[a * 3] = entry.x; pos[a * 3 + 1] = entry.y; pos[a * 3 + 2] = entry.z;
    for (let qi = 0; qi < 10; qi += 1) quadrics[a * 10 + qi] += quadrics[b * 10 + qi];
    for (const fi of sharedFaces) {
      faceAlive[fi] = 0; alive -= 1;
      for (const v of faces[fi]) vertFaces[v].delete(fi);
    }
    for (const fi of [...vertFaces[b]]) {
      if (!faceAlive[fi]) { vertFaces[b].delete(fi); continue; }
      const f = faces[fi];
      for (let k = 0; k < 3; k += 1) if (f[k] === b) f[k] = a;
      vertFaces[b].delete(fi);
      vertFaces[a].add(fi);
    }
    version[a] += 1; version[b] += 1;
    for (const v of neighborVerts(a)) pushEdge(Math.min(a, v), Math.max(a, v));
  }
  const outIndices = [];
  for (let i = 0; i < faces.length; i += 1) if (faceAlive[i]) outIndices.push(faces[i][0], faces[i][1], faces[i][2]);
  return { positions: Array.from(pos), indices: outIndices };
}

// ---------------------------------------------------------------------------
// Topologie-Audit: ungerichtete Kanten (=2), gerichtete Kanten (=1, konsistente
// Windung), Degenerate, signiertes Volumen.

export function auditMesh(positions, indices) {
  const undirected = new Map();
  const directed = new Set();
  let degenerateTriangles = 0, signedVolume = 0, windingConflicts = 0;
  const count = positions.length / 3;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const uKey = u < v ? u * count + v : v * count + u;
      undirected.set(uKey, (undirected.get(uKey) || 0) + 1);
      const dKey = u * count + v;
      if (directed.has(dKey)) windingConflicts += 1;
      directed.add(dKey);
    }
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-14) degenerateTriangles += 1;
    signedVolume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  let boundaryEdges = 0;
  for (const n of undirected.values()) if (n !== 2) boundaryEdges += 1;
  return {
    boundaryEdges,
    degenerateTriangles,
    windingConflicts,
    signedVolume: signedVolume / 6,
    triangles: indices.length / 3,
    vertices: count
  };
}
