// Landscaping-Brush/Spline: reiner semantischer Planer.
//
// Ein Preset ist kein zufaelliger Sack Assets. Es besteht aus voneinander abhaengigen
// Schichten: grosse Formgeber, Lueckenfueller, Schutt und ein Bodenuebergang.
// Der Planer kennt keine Three.js-Geometrie. Dadurch lassen sich Kontakte, Abstaende,
// Seeds und Budgets pruefen, bevor ein einziges Dreieck entsteht.

const TAU = Math.PI * 2;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mix = (a, b, t) => a + (b - a) * t;

function seeded(seed) {
  let state = (Math.floor(seed) || 1) >>> 0;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalizePoint(point) {
  return { x: Number(point?.x) || 0, z: Number(point?.z) || 0 };
}

function buildArc(points, closed = false) {
  const clean = (Array.isArray(points) ? points : []).map(normalizePoint);
  if (clean.length < 2) return { points: clean, cumulative: [0], total: 0, closed: false };
  const source = closed && Math.hypot(clean[0].x - clean.at(-1).x, clean[0].z - clean.at(-1).z) > 1e-5
    ? [...clean, { ...clean[0] }]
    : clean;
  const cumulative = [0];
  for (let index = 1; index < source.length; index += 1) {
    cumulative[index] = cumulative[index - 1] + Math.hypot(
      source[index].x - source[index - 1].x,
      source[index].z - source[index - 1].z
    );
  }
  return { points: source, cumulative, total: cumulative.at(-1) || 0, closed };
}

function sampleArc(arc, distance) {
  if (!arc.points.length) return { x: 0, z: 0, tangentX: 1, tangentZ: 0, normalX: 0, normalZ: 1, fraction: 0 };
  const wanted = arc.closed && arc.total > 0
    ? ((distance % arc.total) + arc.total) % arc.total
    : clamp(distance, 0, arc.total);
  let hi = 1;
  while (hi < arc.cumulative.length && arc.cumulative[hi] < wanted) hi += 1;
  hi = Math.min(arc.points.length - 1, hi);
  const lo = Math.max(0, hi - 1);
  const span = Math.max(1e-6, arc.cumulative[hi] - arc.cumulative[lo]);
  const t = clamp((wanted - arc.cumulative[lo]) / span, 0, 1);
  const a = arc.points[lo];
  const b = arc.points[hi];
  let tangentX = b.x - a.x;
  let tangentZ = b.z - a.z;
  const length = Math.hypot(tangentX, tangentZ) || 1;
  tangentX /= length;
  tangentZ /= length;
  return {
    x: mix(a.x, b.x, t),
    z: mix(a.z, b.z, t),
    tangentX,
    tangentZ,
    normalX: -tangentZ,
    normalZ: tangentX,
    fraction: arc.total > 0 ? wanted / arc.total : 0,
    distance: wanted
  };
}

function terrainGradient(heightAt, x, z, step = 0.18) {
  const left = heightAt(x - step, z);
  const right = heightAt(x + step, z);
  const back = heightAt(x, z - step);
  const front = heightAt(x, z + step);
  return {
    x: (right - left) / (step * 2),
    z: (front - back) / (step * 2)
  };
}

export const LANDSCAPING_PRESETS = Object.freeze({
  rockfield: Object.freeze({
    // Die bisher beste Streuung war das Felsband. Sie ist nun das einzige
    // Felsgruppen-Werkzeug; Findlingsfeld und die alte Felsgruppe waren nur
    // andere Groessenmischungen ohne eigene konstruktive Identitaet.
    label: 'Felsgruppe', anchor: 0.88, breaker: 1.05, talus: 0.54,
    ground: 'rock-moss', sideBias: 0, cliff: false
  }),
  cliff: Object.freeze({
    label: 'Klippenkante', anchor: 0.18, breaker: 0.72, talus: 0.88,
    ground: 'rock-moss', sideBias: -0.34, cliff: true
  })
});

export function normalizeLandscapingSettings(settings = {}) {
  // Alte Demo-URLs bleiben lesbar, landen aber auf einem der zwei echten
  // Werkzeuge statt versteckte Dubletten wieder einzufuehren.
  const legacyPreset = settings.preset === 'felsband' || settings.preset === 'findlingsfeld'
    ? 'rockfield'
    : settings.preset;
  const preset = LANDSCAPING_PRESETS[legacyPreset] ? legacyPreset : 'rockfield';
  return {
    preset,
    mode: settings.mode === 'brush' ? 'brush' : 'spline',
    widthM: clamp(Number(settings.widthM) || 4.2, 1.2, 9),
    density: clamp(Number(settings.density) || 0.72, 0.18, 1.4),
    scale: clamp(Number(settings.scale) || 1, 0.5, 1.8),
    embedding: clamp(Number(settings.embedding) || 0.48, 0.14, 0.69),
    variation: clamp(Number(settings.variation) || 0.48, 0, 0.9),
    side: settings.side === 'left' ? 'left' : settings.side === 'right' ? 'right' : 'both',
    terrainBlend: clamp(Number(settings.terrainBlend) || 0.72, 0, 1),
    cliffHeightM: clamp(Number(settings.cliffHeightM) || 1.65, 0.55, 4.5),
    cliffBody: settings.cliffBody === 'ridge' ? 'ridge' : 'edge',
    quality: settings.quality === 'high' ? 'high' : settings.quality === 'low' ? 'low' : 'standard',
    seed: Math.max(1, Math.round(Number(settings.seed) || 7))
  };
}

function sideSign(settings) {
  if (settings.side === 'left') return 1;
  if (settings.side === 'right') return -1;
  return 0;
}

export function pointInCliffTerrainCut(x, z, cut) {
  if (!cut?.path?.length) return false;
  let bestDistance = Infinity;
  let bestSigned = 0;
  let bestDistanceM = 0;
  let inside = false;
  for (let index = 0; index < cut.path.length - 1; index += 1) {
    const a = cut.path[index]; const b = cut.path[index + 1];
    const dx = b.x - a.x; const dz = b.z - a.z;
    const length2 = dx * dx + dz * dz;
    if (length2 < 1e-8) continue;
    const rawT = ((x - a.x) * dx + (z - a.z) * dz) / length2;
    const t = clamp(rawT, 0, 1);
    const px = a.x + dx * t; const pz = a.z + dz * t;
    const ox = x - px; const oz = z - pz;
    const distance = Math.hypot(ox, oz);
    if (distance >= bestDistance) continue;
    const inverse = 1 / Math.sqrt(length2);
    bestDistance = distance;
    bestSigned = (ox * -dz * inverse + oz * dx * inverse) * cut.sign;
    bestDistanceM = (a.distance || 0) + clamp(rawT, 0, 1) * ((b.distance || 0) - (a.distance || 0));
    inside = rawT >= 0 && rawT <= 1;
  }
  return inside
    && bestDistanceM > cut.endInsetM
    && bestDistanceM < cut.lengthM - cut.endInsetM
    && bestSigned > cut.lowM
    && bestSigned < cut.highM;
}

function memberAt(role, station, lateral, dimensions, variant, settings, heightAt, random, extras = {}) {
  const x = station.x + station.normalX * lateral;
  const z = station.z + station.normalZ * lateral;
  const terrainY = Number(heightAt(x, z)) || 0;
  const gradient = terrainGradient(heightAt, x, z);
  const embedRatio = role === 'talus' ? settings.embedding * 0.78 : settings.embedding;
  const embedM = dimensions.heightM * embedRatio;
  return {
    role,
    x,
    z,
    terrainY,
    baseY: terrainY - embedM,
    embedM,
    widthM: dimensions.widthM,
    depthM: dimensions.depthM,
    heightM: dimensions.heightM,
    radiusM: Math.max(dimensions.widthM, dimensions.depthM) * 0.5,
    yaw: Math.atan2(station.tangentX, station.tangentZ) + (random() - 0.5) * settings.variation * 0.9,
    slopeX: gradient.x,
    slopeZ: gradient.z,
    variant,
    stationM: station.distance,
    lateralM: lateral,
    contact: extras.contact || 'embedded',
    ...extras
  };
}

function nearestDistance(members, x, z) {
  let nearest = Infinity;
  for (const member of members) nearest = Math.min(nearest, Math.hypot(member.x - x, member.z - z) - member.radiusM);
  return nearest;
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) * 0.5;
}

function signedPolygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area * 0.5;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a++) {
    const pa = polygon[a];
    const pb = polygon[b];
    const crosses = (pa.z > point.z) !== (pb.z > point.z)
      && point.x < (pb.x - pa.x) * (point.z - pa.z) / ((pb.z - pa.z) || 1e-9) + pa.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function randomPointInPolygon(polygon, random) {
  const xs = polygon.map(point => point.x);
  const zs = polygon.map(point => point.z);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minZ = Math.min(...zs); const maxZ = Math.max(...zs);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const point = { x: mix(minX, maxX, random()), z: mix(minZ, maxZ, random()) };
    if (pointInPolygon(point, polygon)) return point;
  }
  return polygon[0] ? { ...polygon[0] } : { x: 0, z: 0 };
}

function stationAtPoint(point, random) {
  const angle = random() * TAU;
  return {
    x: point.x,
    z: point.z,
    tangentX: Math.sin(angle),
    tangentZ: Math.cos(angle),
    normalX: 0,
    normalZ: 0,
    distance: 0,
    fraction: 0
  };
}

function detectHairpins(arc, widthM) {
  if (arc.points.length < 8 || arc.total < widthM * 2) return 0;
  let collisions = 0;
  const stride = Math.max(1, Math.floor(arc.points.length / 90));
  for (let a = 0; a < arc.points.length; a += stride) {
    for (let b = a + stride * 3; b < arc.points.length; b += stride) {
      const arcDistance = Math.abs(arc.cumulative[b] - arc.cumulative[a]);
      if (arcDistance < widthM * 1.45 || (arc.closed && arc.total - arcDistance < widthM * 1.45)) continue;
      if (Math.hypot(arc.points[a].x - arc.points[b].x, arc.points[a].z - arc.points[b].z) < widthM * 0.42) collisions += 1;
    }
  }
  return collisions;
}

function variableBand(arc, settings, profile, random, heightAt) {
  if (settings.mode === 'brush' && arc.closed && arc.points.length >= 4) {
    return {
      mode: 'area',
      material: profile.ground,
      outline: arc.points.slice(0, -1).map(point => ({
        x: point.x,
        z: point.z,
        y: Number(heightAt(point.x, point.z)) || 0
      }))
    };
  }
  const samples = [];
  const step = settings.quality === 'high' ? 0.28 : settings.quality === 'low' ? 0.52 : 0.38;
  const count = Math.max(2, Math.ceil(arc.total / step));
  for (let index = 0; index <= count; index += 1) {
    const source = sampleArc(arc, arc.total * index / count);
    const edgeNoise = (random() - 0.5) * settings.variation * settings.widthM * 0.22;
    const width = profile.cliff
      ? Math.max(0.55, settings.widthM * (0.52 + random() * 0.08) + edgeNoise * 0.28)
      : Math.max(0.6, settings.widthM * (0.88 + random() * 0.20) + edgeNoise);
    const highSign = settings.side === 'right' ? -1 : 1;
    const shift = profile.cliff ? highSign * settings.widthM * 0.28 : 0;
    const station = profile.cliff ? {
      ...source,
      x: source.x + source.normalX * shift,
      z: source.z + source.normalZ * shift
    } : source;
    const y = Number(heightAt(station.x, station.z)) || 0;
    samples.push({ ...station, y, halfWidthM: width * 0.5 });
  }
  return { mode: 'band', material: profile.ground, samples };
}

function buildCliffArea(arc, settings, heightAt) {
  if (!arc.closed || arc.total < 0.8) return null;
  const step = settings.quality === 'high' ? 0.24 : settings.quality === 'low' ? 0.48 : 0.34;
  const count = Math.max(8, Math.ceil(arc.total / step));
  const source = Array.from({ length: count }, (_, index) => sampleArc(arc, arc.total * index / count));
  const winding = signedPolygonArea(source) >= 0 ? 1 : -1;
  const outwardSign = -winding;
  const shoulderM = clamp(0.08 + settings.cliffHeightM * 0.035, 0.10, 0.24);
  const terrain = source.map(station => {
    const outwardX = station.normalX * outwardSign;
    const outwardZ = station.normalZ * outwardSign;
    const footX = station.x + outwardX * shoulderM;
    const footZ = station.z + outwardZ * shoulderM;
    return {
      ...station,
      outwardX,
      outwardZ,
      footX,
      footZ,
      terrainY: Number(heightAt(footX, footZ)) || 0
    };
  });
  const crownY = Math.max(...terrain.map(station => station.terrainY)) + settings.cliffHeightM;
  const bottomY = Math.min(...terrain.map(station => station.terrainY))
    - Math.max(0.34, settings.cliffHeightM * 0.18);
  const outline = terrain.map((station, index) => {
    // Die Polygonflaeche ist ein begehbar lesbares Felsplateau, kein Zelt aus
    // hochgezogenen Randpunkten. Die eigentliche Mikrostruktur kommt aus den
    // Facetten und dem Material; der Hoehenwert bleibt dadurch vorhersagbar.
    const topAmplitude = Math.min(0.018, settings.cliffHeightM * 0.0065);
    const topVariation = ((
      Math.sin(index * 1.91 + settings.seed * 0.73)
      + Math.sin(index * 0.47 + settings.seed * 1.19) * 0.55
    ) + 1.55) * topAmplitude;
    return {
      ...station,
      topX: station.x,
      topZ: station.z,
      topY: crownY + topVariation,
      footY: station.terrainY - 0.09,
      bottomX: station.footX,
      bottomZ: station.footZ,
      bottomY,
      heightM: crownY - station.terrainY
    };
  });
  return {
    mode: 'area',
    outline,
    crownY,
    bottomY,
    heightM: settings.cliffHeightM,
    winding
  };
}

export function planLandscaping({ centerline = [], heightAt = () => 0, closed = false, settings: input = {} } = {}) {
  const settings = normalizeLandscapingSettings(input);
  const profile = LANDSCAPING_PRESETS[settings.preset];
  const arc = buildArc(centerline, closed);
  const random = seeded(settings.seed * 1597334677);
  const anchors = [];
  const breakers = [];
  const talus = [];
  const sign = sideSign(settings);
  const modeWidth = settings.mode === 'brush' ? settings.widthM * 1.18 : settings.widthM;
  const brushPolygon = settings.mode === 'brush' && closed && arc.points.length >= 4
    ? arc.points.slice(0, -1)
    : null;

  // Die Klippe ist ein eigener zusammenhaengender Felskoerper. Zufallssteine
  // gehoeren zur Felsgruppe und duerfen ihre Silhouette oder Anschluesse nicht
  // conceal the shape. A future talus fringe should remain an explicit option.
  if (arc.total >= 0.8 && !profile.cliff) {
    const anchorSpacing = clamp(1.55 * settings.scale / Math.max(0.35, profile.anchor * settings.density), 0.72, 5.4);
    const anchorCount = profile.anchor > 0 && !brushPolygon ? Math.max(0, Math.floor(arc.total / anchorSpacing) + 1) : 0;
    for (let index = 0; index < anchorCount; index += 1) {
      const distance = anchorCount === 1 ? arc.total * 0.5 : arc.total * index / Math.max(1, anchorCount - 1);
      const station = sampleArc(arc, distance + (index > 0 && index < anchorCount - 1 ? (random() - 0.5) * anchorSpacing * 0.32 : 0));
      const bias = sign || profile.sideBias;
      const size = settings.scale * mix(1.05, 2.05, random()) * mix(0.78, 1.18, settings.density);
      const dimensions = {
        widthM: size * mix(1.05, 1.58, random()),
        depthM: size * mix(0.82, 1.28, random()),
        heightM: size * mix(0.54, 0.96, random())
      };
      let lateral = bias * modeWidth * 0.26 + (random() - 0.5) * modeWidth * 0.30;
      if (profile.cliff) lateral = bias * Math.max(Math.abs(lateral), modeWidth * 0.12 + Math.max(dimensions.widthM, dimensions.depthM) * 0.40);
      anchors.push(memberAt('anchor', station, lateral, dimensions, Math.floor(random() * 3), settings, heightAt, random, { layer: 'form' }));
    }

    const breakerSpacing = clamp(1.18 * settings.scale / Math.max(0.35, profile.breaker * settings.density), 0.48, 3.4);
    const breakerCount = profile.breaker > 0 && !brushPolygon ? Math.max(0, Math.floor(arc.total / breakerSpacing)) : 0;
    for (let index = 0; index < breakerCount; index += 1) {
      const station = sampleArc(arc, arc.total * (index + 0.5) / Math.max(1, breakerCount));
      const bias = sign || profile.sideBias;
      const size = settings.scale * mix(0.42, 0.88, random());
      const dimensions = {
        widthM: size * mix(1.0, 1.55, random()),
        depthM: size * mix(0.85, 1.3, random()),
        heightM: size * mix(0.58, 0.95, random())
      };
      let lateral = bias * modeWidth * 0.34 + (random() - 0.5) * modeWidth * 0.55;
      if (profile.cliff) lateral = bias * Math.max(Math.abs(lateral), modeWidth * 0.11 + Math.max(dimensions.widthM, dimensions.depthM) * 0.38);
      const candidate = memberAt('breaker', station, lateral, dimensions, 1 + Math.floor(random() * 2), settings, heightAt, random, { layer: 'fill' });
      // Lueckenfueller duerfen Formgeber leicht beruehren, aber nicht in deren Mitte sitzen.
      const clearance = nearestDistance(anchors, candidate.x, candidate.z);
      if (clearance > -candidate.radiusM * 0.38) breakers.push(candidate);
    }

    const area = Math.max(1, brushPolygon ? polygonArea(brushPolygon) : arc.total * modeWidth);
    const qualityFactor = settings.quality === 'high' ? 1.2 : settings.quality === 'low' ? 0.52 : 0.82;

    if (brushPolygon && !profile.cliff) {
      const wantedAnchors = Math.min(28, Math.max(1, Math.round(area * profile.anchor * settings.density * qualityFactor * 0.22 / (settings.scale * settings.scale))));
      for (let attempt = 0; attempt < wantedAnchors * 18 && anchors.length < wantedAnchors; attempt += 1) {
        const point = randomPointInPolygon(brushPolygon, random);
        const size = settings.scale * mix(1.0, 2.15, Math.pow(random(), 0.72));
        if (nearestDistance(anchors, point.x, point.z) < size * 0.12) continue;
        const station = stationAtPoint(point, random);
        anchors.push(memberAt('anchor', station, 0, {
          widthM: size * mix(1.05, 1.62, random()),
          depthM: size * mix(0.82, 1.32, random()),
          heightM: size * mix(0.52, 0.92, random())
        }, Math.floor(random() * 3), settings, heightAt, random, { layer: 'form' }));
      }
      // Mehr lesbare Mittelgroessen: Die Fueller bilden die Bruecke zwischen
      // main masses and loose talus. Too few produced three oversized
      // Koerper plus Kies, aber kaum die typische mittlere Staffelung.
      const wantedBreakers = Math.min(84, Math.round(area * profile.breaker * settings.density * qualityFactor * 0.64));
      for (let attempt = 0; attempt < wantedBreakers * 12 && breakers.length < wantedBreakers; attempt += 1) {
        const point = randomPointInPolygon(brushPolygon, random);
        const size = settings.scale * mix(0.42, 0.94, Math.pow(random(), 0.88));
        if (nearestDistance(anchors, point.x, point.z) < -size * 0.34 || nearestDistance(breakers, point.x, point.z) < size * 0.08) continue;
        breakers.push(memberAt('breaker', stationAtPoint(point, random), 0, {
          widthM: size * mix(0.95, 1.52, random()),
          depthM: size * mix(0.8, 1.28, random()),
          heightM: size * mix(0.52, 0.9, random())
        }, 1 + Math.floor(random() * 2), settings, heightAt, random, { layer: 'fill' }));
      }
    }
    const talusCount = Math.min(220, Math.round(area * profile.talus * settings.density * qualityFactor * (profile.cliff ? 1 : 2.0)));
    const brushOutsideSign = brushPolygon && signedPolygonArea(brushPolygon) >= 0 ? -1 : 1;
    for (let index = 0; index < talusCount; index += 1) {
      const station = sampleArc(arc, random() * arc.total);
      // Two explicit talus classes instead of a distribution biased toward micro-gravel.
      // Zufallsverteilung. Rund 40 % sind sichtbare Mittelsteine; selbst die
      // kleinste Klasse beginnt jetzt bei 15 statt 11 cm.
      const mediumTalus = random() < 0.50;
      const size = settings.scale * (mediumTalus
        ? mix(0.42, 0.78, Math.pow(random(), 0.86))
        : mix(0.20, 0.42, Math.pow(random(), 1.12)));
      const directed = profile.cliff ? -(sign || 1) * modeWidth * 0.22 : (sign || profile.sideBias) * modeWidth * 0.20;
      // Bei einer gemalten Flaeche sitzt der Schuttsaum knapp AUSSERHALB der
      // Kontur. Die alte symmetrische Breitenstreuung setzte den Grossteil in
      // die SDF-Masse; der Compiler entfernte ihn korrekt als Durchdringung,
      // sichtbar blieben aber nur ein oder zwei Steinchen.
      const lateral = brushPolygon && !profile.cliff
        ? brushOutsideSign * (mediumTalus ? 0.12 + size * 0.72 : 0.06 + size * 0.48)
        : directed + (random() - 0.5) * modeWidth * 0.92;
      const candidate = memberAt('talus', station, lateral, {
        widthM: size * mix(0.85, 1.5, random()),
        depthM: size * mix(0.75, 1.32, random()),
        heightM: size * mix(0.50, 0.88, random())
      }, 2, settings, heightAt, random, { layer: 'talus' });
      if (nearestDistance(anchors, candidate.x, candidate.z) > -candidate.radiusM * 0.65) talus.push(candidate);
    }

  }

  const cliffLine = [];
  const cliffArea = profile.cliff && brushPolygon
    ? buildCliffArea(arc, settings, heightAt)
    : null;
  let cliffTerrainCut = null;
  if (profile.cliff && !brushPolygon && arc.total >= 0.8) {
    const cliffSign = settings.side === 'right' ? -1 : 1;
    const ridge = settings.cliffBody === 'ridge';
    const count = Math.max(3, Math.ceil(arc.total / (settings.quality === 'high' ? 0.24 : 0.34)));
    for (let index = 0; index <= count; index += 1) {
      const source = sampleArc(arc, arc.total * index / count);
      const station = source;
      const endDistance = Math.min(source.distance, Math.max(0, arc.total - source.distance));
      const endFactor = closed || ridge ? 1 : smoothstep(0, Math.max(0.65, settings.widthM * 0.52), endDistance);
      const edgeOffset = settings.widthM * (ridge ? -0.08 : 0.08) * cliffSign;
      const footOffset = -settings.widthM * (ridge ? 0.42 : 0.13) * cliffSign;
      const backEdgeOffset = settings.widthM * (ridge ? 0.08 : 0.50) * cliffSign;
      const backFootOffset = settings.widthM * (ridge ? 0.42 : 0.50) * cliffSign;
      const edgeX = station.x + station.normalX * edgeOffset;
      const edgeZ = station.z + station.normalZ * edgeOffset;
      const footX = station.x + station.normalX * footOffset;
      const footZ = station.z + station.normalZ * footOffset;
      const backEdgeX = station.x + station.normalX * backEdgeOffset;
      const backEdgeZ = station.z + station.normalZ * backEdgeOffset;
      const backFootX = station.x + station.normalX * backFootOffset;
      const backFootZ = station.z + station.normalZ * backFootOffset;
      const naturalFootY = Number(heightAt(footX, footZ)) || 0;
      const naturalBackFootY = Number(heightAt(backFootX, backFootZ)) || 0;
      const terrainCrownY = Number(heightAt(station.x, station.z)) || 0;
      const topY = ridge
        ? Math.max(terrainCrownY, naturalFootY, naturalBackFootY) + settings.cliffHeightM
        : (Number(heightAt(edgeX, edgeZ)) || 0) + 0.025;
      const backTopY = ridge ? topY : (Number(heightAt(backEdgeX, backEdgeZ)) || topY) + 0.025;
      const visibleDrop = mix(0.12, settings.cliffHeightM * 0.72, endFactor);
      const frontFootY = ridge
        ? naturalFootY - 0.055
        : Math.min(naturalFootY - 0.08, topY - visibleDrop);
      const backFootY = ridge ? naturalBackFootY - 0.055 : backTopY - mix(0.12, 0.18, endFactor);
      cliffLine.push({
        ...station,
        edgeX,
        edgeZ,
        footX,
        footZ,
        backEdgeX,
        backEdgeZ,
        backFootX,
        backFootZ,
        topY,
        backTopY,
        footY: frontFootY,
        backFootY,
        heightM: Math.max(0.12, topY - frontFootY),
        backHeightM: Math.max(0.12, backTopY - backFootY),
        endFactor
      });
    }
    // Both bases follow terrain without producing sawtooth-like station steps.
    // Exakt gemeinsame Randkoordinaten bleiben dem Compiler vorbehalten.
    const rawFoot = cliffLine.map(station => station.footY);
    const rawBackFoot = cliffLine.map(station => station.backFootY);
    for (let index = 1; index < cliffLine.length - 1; index += 1) {
      cliffLine[index].footY = rawFoot[index - 1] * 0.25 + rawFoot[index] * 0.5 + rawFoot[index + 1] * 0.25;
      cliffLine[index].backFootY = rawBackFoot[index - 1] * 0.25 + rawBackFoot[index] * 0.5 + rawBackFoot[index + 1] * 0.25;
      cliffLine[index].heightM = Math.max(0.12, cliffLine[index].topY - cliffLine[index].footY);
      cliffLine[index].backHeightM = Math.max(0.12, cliffLine[index].backTopY - cliffLine[index].backFootY);
    }
    if (!ridge) cliffTerrainCut = {
      path: Array.from({ length: count + 1 }, (_, index) => {
        const station = sampleArc(arc, arc.total * index / count);
        return { x: station.x, z: station.z, distance: station.distance };
      }),
      sign: settings.side === 'right' ? -1 : 1,
      lowM: -settings.widthM * 0.13 + 0.32,
      highM: settings.widthM * 0.50 - 0.32,
      endInsetM: 0.20,
      lengthM: arc.total,
      depthM: settings.cliffHeightM + 0.8
    };
  }

  const hairpinCollisions = detectHairpins(arc, modeWidth);
  const warnings = [];
  if (arc.total < 0.8) warnings.push('Pfad ist kuerzer als 0,8 m');
  if (hairpinCollisions > 0) warnings.push(`${hairpinCollisions} nichtlokale Selbstnaehen`);
  const count = anchors.length + breakers.length + talus.length;
  const budget = settings.quality === 'high' ? 520 : settings.quality === 'low' ? 180 : 340;
  if (count > budget) warnings.push(`Instanzbudget ${count}/${budget}`);

  return {
    settings,
    profile,
    closed,
    lengthM: arc.total,
    arc,
    layers: { anchors, breakers, talus },
    cliffLine,
    cliffArea,
    terrainCut: cliffTerrainCut,
    groundBand: profile.cliff ? null : variableBand(arc, settings, profile, random, heightAt),
    diagnostics: {
      valid: arc.total >= 0.8 && hairpinCollisions === 0 && count <= budget,
      warnings,
      hairpinCollisions,
      budget,
      instances: count,
      counts: {
        anchors: anchors.length,
        fillers: breakers.length,
        schutt: talus.length,
        cliffStations: cliffLine.length
      }
    }
  };
}

// Fuer den Klippen-Preset wird das Gelaende auf der gewaehlten Seite weich angehoben.
// Die Funktion ist absichtlich renderer-neutral und kann sowohl das Demo-Hoehenraster als
// auch spaeter einen echten Terrain-Commit treiben.
export function createSplineTerrainModifier(centerline, {
  closed = false,
  side = 'left',
  widthM = 4.2,
  heightM = 1.45,
  blend = 0.72
} = {}) {
  const arc = buildArc(centerline, closed);
  const sign = side === 'right' ? -1 : 1;
  const samples = [];
  const count = Math.max(2, Math.ceil(arc.total / 0.22));
  for (let index = 0; index <= count; index += 1) samples.push(sampleArc(arc, arc.total * index / count));
  return (x, z) => {
    let nearest = null;
    let distance = Infinity;
    for (const sample of samples) {
      const dx = x - sample.x;
      const dz = z - sample.z;
      const d = Math.hypot(dx, dz);
      if (d < distance) {
        distance = d;
        nearest = { sample, signed: (dx * sample.normalX + dz * sample.normalZ) * sign };
      }
    }
    if (!nearest || distance > widthM * 1.4) return 0;
    // Die Landschaft schliesst oben an; die sichtbare Hoehendifferenz gehoert
    // dem Fels-Loft. Eine breite Rampe wuerde den Klippenkoerper verdecken.
    const transition = mix(0.08, 0.18, clamp(blend, 0, 1)) * widthM;
    const sideLift = smoothstep(-transition * 0.55, transition * 0.55, nearest.signed);
    const reach = 1 - smoothstep(widthM * 0.72, widthM * 1.4, distance);
    let endFade = 1;
    if (!closed && nearest.sample) {
      const edge = Math.min(nearest.sample.distance, Math.max(0, arc.total - nearest.sample.distance));
      endFade = smoothstep(0, Math.max(0.65, widthM * 0.52), edge);
    }
    return heightM * sideLift * reach * endFade;
  };
}

export const __landscapingInternals = Object.freeze({ buildArc, sampleArc, detectHairpins, seeded });
