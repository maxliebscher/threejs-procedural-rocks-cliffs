# Procedural Rock & Cliff Lab

An interactive Three.js demonstrator for drawing terrain-bound rock fields and watertight cliff masses. An editable footprint becomes a deterministic geological scalar field, one connected surface, a topology audit, and a metric triplanar PBR material.

This is a focused technical demo rather than a complete terrain editor. It makes the difficult part inspectable: believable fused stone masses that remain closed, deterministic, terrain-aware, and responsive enough for interactive authoring.

## Live demo

The project is static after its Vite build and is designed to run on **GitHub Pages**. Vercel or a custom server is optional, not required.

Live links:

1. Open **Settings → Pages** on GitHub.
2. Select **GitHub Actions** as the source.
3. Push to `main` or run the included workflow manually.

`.github/workflows/deploy-pages.yml` tests, builds, and publishes `dist/`. The Vite base path is relative, so assets work below a project URL such as `https://user.github.io/procedural-rocks-cliffs/`.

Opening the source `index.html` directly from `raw.githubusercontent.com` or `file://` is not supported: the source uses npm modules and must be bundled first.

## Run locally

Requirements: Node.js 20 or newer and a browser with WebGL 2.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:8791/`.

```bash
npm test       # renderer-independent topology smoke tests
npm run build  # production build in dist/
npm run preview
```

## What to try

- Switch between **Rock field** and **Cliff**.
- Draw a new area, click a generated mesh to edit it, and drag the boundary handles.
- Click outside the mesh to leave edit mode.
- Compare Granite, Sandstone, and Limestone. They use different form grammars, not merely different textures.
- Move the studio key light with the slider; the compact menu dial shows its direction without covering the scene.
- Inspect the final material, wireframe, triplanar weights, ground contact, and topology seams.
- Watch boundary edges, degenerate triangles, winding conflicts, signed volume, triangles, cell size, draw calls, bounds, and build time update live.

## Pipeline

```text
editable footprint + terrain samples
  -> semantic placement plan
  -> deterministic geology-specific scalar causes
  -> terrain-aware SDF primitives and smooth union
  -> protected finite extraction lattice
  -> shared-edge Marching Tetrahedra
  -> gradient-oriented faces
  -> sliver collapse + volume-preserving smoothing
  -> guarded QEM reduction
  -> topology audit
  -> metric triplanar PBR
```

### Why an implicit field

Independent rock meshes intersect internally and explicit profile lofts tend to create seams, self-intersections, or cut-block silhouettes when many natural masses must fuse. This demo represents the main geological body as one continuous scalar field and extracts a single surface from the union.

Talus remains instanced only where separate debris is structurally appropriate.

### Geological form grammars

The presets share an extraction pipeline but not a generic displacement recipe:

- **Granite** uses broad lobes, restrained joints, and rounded weathering.
- **Sandstone** uses persistent bedding, banks, and controlled undercuts.
- **Limestone** uses block structure, dissolution pockets, and continuous fracture distances rather than discontinuous Voronoi cell IDs.

Macro silhouette, crown, walls, erosion, roughness, and normal response are derived from related causes at different scales so the material does not look detached from the geometry.

### Watertight extraction

- One consistent cube-to-tetrahedra decomposition.
- Intersection vertices cached by lattice edge.
- Outer lattice shell forced outside the field so the surface closes.
- Face orientation derived from the local field gradient.
- Sliver removal and volume-preserving smoothing before guarded simplification.

Every main mass is audited for:

```text
boundaryEdges = 0
degenerateTriangles = 0
windingConflicts = 0
signedVolume is non-trivial and consistently oriented
```

### Metric triplanar PBR

Materials are projected in world units instead of relying on generated UVs. The shader blends projections by surface normal and samples dedicated albedo, OpenGL normal, and roughness maps for each geology. This keeps texture scale stable while the generated shape, dimensions, and orientation change.

### Terrain contact

The planner samples the terrain for every semantic member and records its burial depth. The compiler rebuilds member bases from the current terrain and produces a sampled transition band. Normal editing hides the diagnostic transition surface; contact and topology inspection can reveal it.

Burial is supported from 14% through 69%, with 48% as the default.

### Progressive quality

Quality tiers separate field resolution from the final triangle budget:

| Tier | Extraction cell | Triangle target | Intended use |
| --- | ---: | ---: | --- |
| Preview | 30 cm | 3,200 | Interactive editing |
| Standard | 20 cm | 4,500 | General review |
| Fine | 17 cm | 6,500 | Close inspection |
| Showcase | 15 cm | 8,000 | Final presentation |

Higher tiers first display Preview, retain the same semantic plan and seed, and then atomically replace it with the refined surface. A generation token discards stale refinements.

The current demo performs refinement on the main thread. A production editor should move expensive extraction to a Worker for true cancellation and uninterrupted input.

## Architecture and reuse

The core is split deliberately:

- `src/landscaping-planner.js` — semantic intent, deterministic placement, terrain samples, member dimensions, and diagnostics.
- `src/landscaping-field.js` — renderer-independent scalar-field extraction and mesh processing.
- `src/landscaping-compiler.js` — geological grammars, SDF assembly, terrain contact, reduction, topology audit, and Three.js buffers.
- `src/landscaping-materials.js` — metric triplanar materials and debug visualization.
- `index.html` — standalone editor, studio scene, interaction, progressive quality, and live metrics.

Three.js is passed into the compiler rather than imported by the field core, which keeps geometry tests independent from WebGL.

## Performance notes

- Deterministic seeds make comparisons and bug reports reproducible.
- Expensive refinement never removes the currently visible mesh before its replacement exists.
- Main masses compile to one draw call; separate talus uses instancing.
- The directional shadow frustum is intentionally tight for useful contact resolution at a 1024² shadow budget.
- The terrain surface uses one calm color field in the studio view to avoid procedural blotching competing with the rocks.
- The key-light direction is visualized inside the menu so the showcase scene remains free of editor overlays.

## Known boundaries

- Main-thread refinement can still pause input on the highest tiers.
- The included terrain transition is a demo solution; a production terrain system should derive its cut from the same final front field or compiled contour.
- This is not a general-purpose voxel editor, erosion simulator, or terrain authoring suite.
- Large worlds need chunking, LOD, cancellation, and a scalable shadow strategy beyond this focused demo.

## Codex skill

`codex-skill/procedural-rocks-cliffs/` contains the portable Codex skill and its technical reference. Copy that folder into a Codex skills directory and invoke `$procedural-rocks-cliffs` when building or reviewing procedural rock fields, cliffs, or terrain-bound stone masses.

## Credits and provenance

- Initial system and representation direction: **OpenAI Codex (Sol)** with **Max Liebscher**.
- V9 implementation and visual refinement: **Claude Fable** with **Max Liebscher**.
- Standalone English release, interaction, packaging, documentation, and final QA: **OpenAI Codex** with **Max Liebscher**.

The rock material maps were generated specifically for this project. See `public/assets/rock-materials/SOURCE.md`.

## Release status and license

Released under the [MIT License](LICENSE). Copyright © 2026 Max Liebscher.

This is the standalone public release of the Procedural Rock & Cliff Lab.
