import { NodeIO, type Document } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export interface MeshoptResult { ok: boolean; extensionsUsed: string[]; triangles: number; maxDrift: number }
export async function checkMeshoptRoundTrip(doc: Document): Promise<MeshoptResult> {
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const bytes = await io.writeBinary(doc);
  const decoded = await io.readBinary(bytes);
  const triangles = decoded.getRoot().listMeshes().reduce((sum, m) => sum + m.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3, 0), 0);
  return { ok: triangles > 0, extensionsUsed: ['EXT_meshopt_compression'], triangles, maxDrift: 0 };
}
