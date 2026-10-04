# Asset pipeline

## Contract

- One Blender unit equals one metre; apply transforms before export and place the runtime pivot at the asset base/origin.
- Runtime delivery is GLB/glTF with `EXT_meshopt_compression`; validate normals, tangents, PBR metallic-roughness materials, node pivots, animation clip names and loop boundaries.
- Static buildings, roads and props may use `TEXCOORD_1` lightmap UVs and baked indirect/AO lighting. Vehicles, NPCs and other dynamic objects must not bake moving shadows.
- ORM packing is R=occlusion, G=roughness, B=metallic. KTX2/Basis is preferred; manifests must provide a PNG/JPEG fallback for browsers without compressed-texture support.
- Texture classes are capped by `tools/assets/pipeline/config.ts`; distant objects use the declared 0/30/100 metre LOD policy.

## Validation

Run `npx vitest run --config tools/assets/vitest.config.ts` for deterministic pipeline tests and `npx tsc --noEmit -p tools` for tool typing. The existing `npm run assets` generator remains the source of runtime manifests and refuses failed generated assets; this milestone's validators do not invent baked or fallback image data.

## Blender export checklist

Run `blender --background --python blender/scene_template.py`, create/edit the asset, apply object transforms, set the origin/pivot, generate a non-overlapping second UV set for static assets, triangulate only where the target requires it, and export GLB using `blender/export_config.json`. Inspect animation clip names and test the exported GLB with the validator before copying it to `public/assets`.
