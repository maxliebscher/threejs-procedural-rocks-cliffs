# Field-pipeline reference

## Extraction invariants

- Keep scalar-field evaluation renderer-independent. Create Three.js buffers only after extraction.
- Use one consistent cube-to-tetrahedra decomposition.
- Cache intersection vertices by lattice edge so adjacent tetrahedra share vertices.
- Force the outer grid shell outside the field so the extracted surface closes.
- Orient faces from the local field gradient rather than repairing winding afterward.
- Treat talus as separate instancing only when it does not penetrate the main union.

## Common failure modes

- Independent overlapping rocks create internal faces and visible intersections.
- Offset profile rings create self-intersections, repetitive terraces, and unstable end caps on tight curves.
- Spatially coincident crown and wall seams remain topologically open when their vertices are duplicated.
- Categorical cell IDs introduce discontinuities that become spikes, fins, or terraces.
- A high-frequency joint narrower than the extraction cell disappears in Preview or aliases into noise.
- Per-ring random offsets read as procedural wobble instead of persistent geology.
- A material can make the wrong macro form more legible; it cannot repair it.

## Terrain contact

Sample terrain through the semantic plan and preserve a dedicated terrain-cut or transition contract. A front-displacement clamp can hide a demo fringe but also flattens relief. For product integration, derive the terrain-cut band from the compiled contour or a shared front field so terrain and stone cannot diverge.

## Progressive rebuild contract

1. Build Preview synchronously or in the fastest available worker path.
2. Keep the current mesh visible while refinement runs.
3. Reuse the exact semantic plan and seed.
4. Atomically swap only after the replacement is complete.
5. Dispose the previous geometry after the swap.
6. Reject stale results using a monotonically increasing generation token.

A main-thread refinement is acceptable for a small demonstrator, but report it honestly because input remains blocked during compilation. Prefer a Worker for interruptible product integration.
