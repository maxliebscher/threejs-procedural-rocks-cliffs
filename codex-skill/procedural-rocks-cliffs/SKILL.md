---
name: procedural-rocks-cliffs
description: Build or revise procedural rock fields, cliffs, and terrain-bound stone masses in Three.js when fused geological forms, watertight topology, scalable quality, and interactive rebuild latency must agree. Do not use for masonry or isolated decorative rock assets.
---

# Procedural Rocks and Cliffs

Choose the surface representation before tuning details:

```text
fused or intersecting natural masses -> shared implicit field / SDF union
dimensionally exact authored section -> explicit sweep or loft with audited joins
independent non-intersecting debris -> instancing
```

Do not repair a structurally unsuitable representation with `DoubleSide`, stronger normal maps, post-processing, or extra debris. If the result must read as one natural mass, compile one connected surface.

## Recommended field pipeline

```text
semantic area or spline plan
  -> deterministic geological causes
  -> SDF primitives and smooth union
  -> protected finite extraction grid
  -> shared-edge Marching Tetrahedra
  -> sliver collapse
  -> volume-preserving smoothing
  -> guarded mesh reduction
  -> topology audit
  -> metric triplanar material
```

Keep semantic planning independent from field extraction. Terrain samples, outline, stations, and member placement belong to the plan. Triangulation, smoothing, reduction, and topology belong to the compiler.

## Geological grammar

Give each geology persistent causes across crown, wall, silhouette, and material response:

- Granite: broad lobes, restrained massive joints, rounded weathering.
- Sandstone: persistent banks, ledges, undercuts, and horizontally coherent strata.
- Limestone: two gently warped fracture families, restrained bedding, blocky benches, and dissolution pockets.

Never displace geometry with a categorical Voronoi/Worley cell ID. Use continuous distances such as F1, F2-F1, or authored fracture distance fields. Make silhouette-defining joints wide enough to survive the coarsest supported extraction cell.

## Interactive quality

Display Preview first for expensive requests, then refine the same semantic plan. Preserve seed, body count, geology parameters, and placement across tiers; only extraction cell size and guarded reduction should change. Replace the visible mesh atomically and discard stale refinements with a generation token.

## Acceptance

Require every closed main mass to report:

```text
boundaryEdges = 0
degenerateTriangles = 0
windingConflicts = 0
signedVolume is consistently oriented and non-trivial
```

Inspect Design, Close, Profile, Top, Distance, and grazing-light views for at least three seeds. Compare Preview and the higher tier from identical cameras. Record draw calls, triangles, instanced debris, extraction-cell size, build time, bounds, and topology together.

For implementation details and the rationale behind the accepted pipeline, read [references/field-pipeline.md](references/field-pipeline.md).
