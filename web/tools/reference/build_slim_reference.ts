/**
 * Reference-only asset build for the Blender slim hero (Notion 11.6/11.7).
 *
 * The source `slim_urban_hero.glb` is a static Blender prototype: 56 meshes, 12 materials,
 * ~27k triangles, no skin and no animation. It is NOT a runtime asset — the runtime hero is the
 * procedural, rigged char_hero_m / char_hero_f. This script produces a decimated reference artefact
 * that meets the Notion 11.4 budget shape (<= 5000 triangles, <= 5 materials) so the art direction
 * can be reviewed inside the repo. It never writes to public/assets and never touches the runtime.
 *
 * Usage: npx vite-node tools/reference/build_slim_reference.ts
 * Output: tools/reference/slim_hero_reference.glb, asset-previews/slim_hero_reference.png
 */
import { NodeIO, type Document } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, join, meshopt, prune, simplify, weld } from '@gltf-transform/functions';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join as pathJoin, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { boundsOf, evaluateScene, type Triangle } from '../assets/lib/evaluate';
import { encodePng } from '../assets/lib/png';
import { composeSheet, renderTile, type View } from '../assets/lib/render';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, '../..');
const SOURCE = process.env.SLIM ?? '/root/.hermes/profiles/ui_ux_designer/cache/scratch/owc/urban/slim_urban_hero.glb';
const OUT_GLB = pathJoin(WEB_ROOT, 'tools/reference/slim_hero_reference.glb');
const OUT_PNG = pathJoin(WEB_ROOT, 'asset-previews/slim_hero_reference.png');

const TARGET_TRIANGLES = 5000;
const MAX_MATERIALS = 5;
const TILE = 256;
const VIEWS: View[] = [
  { yawDeg: 180, elevationDeg: 12, label: 'front' },
  { yawDeg: 225, elevationDeg: 25, label: 'three-quarter' },
  { yawDeg: 90, elevationDeg: 8, label: 'side' },
  { yawDeg: 0, elevationDeg: 25, label: 'back' },
  { yawDeg: 180, elevationDeg: 55, label: 'game-camera' },
];

const triangleCount = (doc: Document): number =>
  doc
    .getRoot()
    .listMeshes()
    .reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);

/** Bakes each primitive's material base colour into COLOR_0 and points every primitive at one material. */
function bakeColorToVertex(doc: Document): void {
  const root = doc.getRoot();
  const palette = doc
    .createMaterial('mat_slim_atlas')
    .setBaseColorFactor([1, 1, 1, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.75);
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial();
      const base = material?.getBaseColorFactor() ?? [1, 1, 1, 1];
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const count = position.getCount();
      const colors = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        colors[i * 4] = base[0] ?? 1;
        colors[i * 4 + 1] = base[1] ?? 1;
        colors[i * 4 + 2] = base[2] ?? 1;
        colors[i * 4 + 3] = 1;
      }
      const accessor = doc.createAccessor('COLOR_0').setType('VEC4').setArray(colors).setBuffer(root.listBuffers()[0]!);
      primitive.setAttribute('COLOR_0', accessor);
      primitive.setMaterial(palette);
    }
  }
  for (const material of root.listMaterials()) if (material !== palette) material.dispose();
  root.listTextures().forEach((texture) => texture.dispose());
}

async function main(): Promise<void> {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

  const doc = await io.read(SOURCE);
  const sourceTriangles = triangleCount(doc);
  const sourceBounds = boundsOf(evaluateScene(doc));

  await doc.transform(dedup(), prune(), weld());
  bakeColorToVertex(doc);
  await doc.transform(join({ keepNamed: false, keepMeshes: false }));
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: TARGET_TRIANGLES / sourceTriangles, error: 0.02 }));

  const simplifiedTriangles = triangleCount(doc);
  const simplifiedBounds = boundsOf(evaluateScene(doc));
  const materials = doc.getRoot().listMaterials().length;
  if (materials > MAX_MATERIALS) throw new Error(`materials ${materials} > ${MAX_MATERIALS}`);
  if (simplifiedTriangles > TARGET_TRIANGLES) throw new Error(`triangles ${simplifiedTriangles} > ${TARGET_TRIANGLES}`);

  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const glb = await io.writeBinary(doc);
  await mkdir(dirname(OUT_GLB), { recursive: true });
  await writeFile(OUT_GLB, glb);

  // Reference preview sheet using the same renderer as the asset pipeline.
  const triangles: Triangle[] = evaluateScene(doc);
  const tiles = VIEWS.map((view) => renderTile(triangles, view, TILE));
  const sheet = composeSheet(tiles, TILE, 5);
  await mkdir(dirname(OUT_PNG), { recursive: true });
  await writeFile(OUT_PNG, encodePng(sheet.width, sheet.height, sheet.rgb));

  const size = (b: { min: number[]; max: number[] }) =>
    b.max.map((v, i) => Number((v - (b.min[i] ?? 0)).toFixed(3))) as [number, number, number];
  console.log(JSON.stringify({
    source: { triangles: sourceTriangles, size: size(sourceBounds) },
    reference: { triangles: simplifiedTriangles, materials, size: size(simplifiedBounds), bytes: glb.byteLength },
    out: { glb: OUT_GLB, png: OUT_PNG },
  }, null, 2));
}

await main();
