# Landscaping V3 generated material sources

Generated on 2026-08-28 with the built-in current GPT Image pipeline for this project.
The source PNGs remain beside the optimized runtime maps so the material can be rebuilt.

## Visual comparison target

`reference-rock-types-gptimage2.png`

Prompt: photorealistic geological reference contact sheet with three separate garden-scale
outcrops under neutral overcast light: weathered massive granite with rounded lobes and deep
joints; horizontally bedded warm sandstone with ledges and restrained undercut; fractured
pale limestone with blocky benches and karst notches. Fully volumetric, naturally buried,
matching talus, irregular crowns, no flat extrusion or cylinder silhouette.

## Seamless albedo sources

- `granite-albedo-source.png`: neutral orthographic weathered granite surface scan, coarse
  feldspar/quartz/mica grain, subtle joints, edge-to-edge tileable.
- `sandstone-albedo-source.png`: neutral orthographic warm buff/red sandstone scan with
  horizontal lamination and iron-oxide bands, edge-to-edge tileable.
- `limestone-albedo-source.png`: neutral orthographic pale gray-beige limestone scan with
  fine carbonate texture, fossils, calcite veins and small dissolution pits, edge-to-edge tileable.

All prompts excluded perspective, horizon, object silhouette, borders, cast shadows and
directional highlights. `tools/build-landscaping-v3-materials.py` derives OpenGL normal,
roughness and the existing SSOT packed RG/roughness/height map. SPOM/FPOM is intentionally
not implemented in this demo; the packed assets are ready for later global runtime use.
