import type { Accessor, Document, Node } from '@gltf-transform/core';
import { type Quat, type Vec3, mat4FromTRS, mat4Multiply, nlerpQuat, transformPoint, type Mat4 } from './math';

export interface Triangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  color: Vec3;
  emissive: Vec3;
}

interface Trs {
  t: Vec3;
  r: Quat;
  s: Vec3;
}

function readAll(accessor: Accessor): number[][] {
  const out: number[][] = [];
  const element: number[] = [];
  for (let i = 0; i < accessor.getCount(); i++) out.push([...accessor.getElement(i, element)]);
  return out;
}

/** Samples every channel of `clipName` at `phase` (0..1) and returns local TRS overrides. */
function sampleClip(doc: Document, clipName: string | undefined, phase: number): Map<Node, Partial<Trs>> {
  const overrides = new Map<Node, Partial<Trs>>();
  if (!clipName) return overrides;
  const animation = doc.getRoot().listAnimations().find((a) => a.getName() === clipName);
  if (!animation) throw new Error(`Clip ${clipName} not found`);

  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode();
    const sampler = channel.getSampler();
    const input = sampler?.getInput();
    const output = sampler?.getOutput();
    const path = channel.getTargetPath();
    if (!node || !input || !output || (path !== 'rotation' && path !== 'translation' && path !== 'scale')) continue;

    const times = readAll(input).map((v) => v[0] ?? 0);
    const values = readAll(output);
    const duration = times[times.length - 1] ?? 0;
    const time = phase * duration;
    let index = 0;
    while (index < times.length - 2 && (times[index + 1] ?? 0) <= time) index++;
    const t0 = times[index] ?? 0;
    const t1 = times[index + 1] ?? t0;
    const alpha = t1 > t0 ? Math.min(1, Math.max(0, (time - t0) / (t1 - t0))) : 0;
    const v0 = values[index] ?? [];
    const v1 = values[index + 1] ?? v0;

    const entry = overrides.get(node) ?? {};
    if (path === 'rotation') entry.r = nlerpQuat(v0 as Quat, v1 as Quat, alpha);
    else {
      const lerped = v0.map((value, i) => value + ((v1[i] ?? value) - value) * alpha) as Vec3;
      if (path === 'translation') entry.t = lerped;
      else entry.s = lerped;
    }
    overrides.set(node, entry);
  }
  return overrides;
}

/**
 * Flattens the default scene into world-space triangles, applying an optional animation pose
 * and linear-blend skinning. Used for preview renders and bounds/pivot checks.
 */
export function evaluateScene(doc: Document, clipName?: string, phase = 0): Triangle[] {
  const overrides = sampleClip(doc, clipName, phase);
  const world = new Map<Node, Mat4>();

  const visit = (node: Node, parent: Mat4 | null) => {
    const o = overrides.get(node);
    const local = mat4FromTRS(o?.t ?? (node.getTranslation() as Vec3), o?.r ?? (node.getRotation() as Quat), o?.s ?? (node.getScale() as Vec3));
    const matrix = parent ? mat4Multiply(parent, local) : local;
    world.set(node, matrix);
    for (const child of node.listChildren()) visit(child, matrix);
  };
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  for (const node of scene?.listChildren() ?? []) visit(node, null);

  const triangles: Triangle[] = [];
  for (const [node, matrix] of world) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const skin = node.getSkin();
    let jointMatrices: Mat4[] | null = null;
    if (skin) {
      const ibm = skin.getInverseBindMatrices();
      const ibms = ibm ? readAll(ibm) : [];
      jointMatrices = skin.listJoints().map((joint, i) => mat4Multiply(world.get(joint) ?? mat4FromTRS([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]), ibms[i] ?? []));
    }

    for (const primitive of mesh.listPrimitives()) {
      const positionAccessor = primitive.getAttribute('POSITION');
      if (!positionAccessor) continue;
      const positions = readAll(positionAccessor);
      const colorAccessor = primitive.getAttribute('COLOR_0');
      const colors = colorAccessor ? readAll(colorAccessor) : null;
      const jointsAccessor = primitive.getAttribute('JOINTS_0');
      const weightsAccessor = primitive.getAttribute('WEIGHTS_0');
      const joints = jointsAccessor ? readAll(jointsAccessor) : null;
      const weights = weightsAccessor ? readAll(weightsAccessor) : null;
      const material = primitive.getMaterial();
      const base = material?.getBaseColorFactor() ?? [1, 1, 1, 1];
      const emissive = (material?.getEmissiveFactor() ?? [0, 0, 0]) as Vec3;

      const transformed = positions.map((p, i): Vec3 => {
        const v = p as Vec3;
        if (!jointMatrices || !joints || !weights) return transformPoint(matrix, v);
        const out: Vec3 = [0, 0, 0];
        for (let k = 0; k < 4; k++) {
          const w = weights[i]?.[k] ?? 0;
          const jm = jointMatrices[joints[i]?.[k] ?? 0];
          if (w === 0 || !jm) continue;
          const q = transformPoint(jm, v);
          out[0] += q[0] * w;
          out[1] += q[1] * w;
          out[2] += q[2] * w;
        }
        return out;
      });

      const indexAccessor = primitive.getIndices();
      const indices = indexAccessor ? readAll(indexAccessor).map((v) => v[0] ?? 0) : positions.map((_, i) => i);
      for (let i = 0; i + 2 < indices.length; i += 3) {
        const ia = indices[i] ?? 0;
        const ib = indices[i + 1] ?? 0;
        const ic = indices[i + 2] ?? 0;
        const vc = colors?.[ia] ?? [1, 1, 1];
        triangles.push({
          a: transformed[ia] as Vec3,
          b: transformed[ib] as Vec3,
          c: transformed[ic] as Vec3,
          color: [(vc[0] ?? 1) * (base[0] ?? 1), (vc[1] ?? 1) * (base[1] ?? 1), (vc[2] ?? 1) * (base[2] ?? 1)],
          emissive,
        });
      }
    }
  }
  return triangles;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export function boundsOf(triangles: Triangle[]): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const tri of triangles) {
    for (const p of [tri.a, tri.b, tri.c]) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] ?? 0, p[k] ?? 0);
        max[k] = Math.max(max[k] ?? 0, p[k] ?? 0);
      }
    }
  }
  return { min, max };
}