import type { Document } from '@gltf-transform/core';
import type { Category } from '../defs/types';

export interface AssetValidationOptions { id: string; category: Category; kind: 'static' | 'dynamic'; lightmapped?: boolean; requiredAnimations?: string[] }
export interface ValidationIssue { code: string; message: string }
export interface ValidationReport { ok: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] }

export function validateDocument(doc: Document, options: AssetValidationOptions): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const issue = (code: string, message: string) => errors.push({ code, message });
  const nodes = doc.getRoot().listNodes();
  for (const node of nodes) {
    const scale = node.getScale();
    if (scale.some((value) => Math.abs(value - 1) > 1e-5)) issue('TRANSFORM_NOT_APPLIED', `${options.id}: node ${node.getName()} has unapplied scale`);
    const translation = node.getTranslation();
    const isRoot = doc.getRoot().listScenes().some((scene) => scene.listChildren().includes(node));
    if (isRoot && Math.abs(translation[1]) > 1e-4) issue('PIVOT_NOT_AT_ORIGIN', `${options.id}: root node pivot is translated`);
  }
  let hasUv2 = false;
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    if (!primitive.getAttribute('NORMAL')) issue('MISSING_NORMALS', `${options.id}: primitive has no normals`);
    if (primitive.getAttribute('TEXCOORD_1')) hasUv2 = true;
    const material = primitive.getMaterial();
    if (!material) issue('MISSING_MATERIAL', `${options.id}: primitive has no material`);
    if (material?.getNormalTexture() && !primitive.getAttribute('TANGENT')) issue('MISSING_TANGENTS', `${options.id}: normal map requires tangents`);
  }
  const clips = doc.getRoot().listAnimations().map((a) => a.getName());
  for (const clip of options.requiredAnimations ?? []) if (!clips.includes(clip)) issue('MISSING_ANIMATION', `${options.id}: missing animation clip ${clip}`);
  if (options.kind === 'static' && options.lightmapped && !hasUv2) issue('MISSING_UV2', `${options.id}: lightmapped static asset needs TEXCOORD_1`);
  if (options.kind === 'dynamic' && options.lightmapped) issue('BAKE_POLICY_VIOLATION', `${options.id}: dynamic assets must not bake moving shadows`);
  if (!doc.getRoot().listMeshes().length) warnings.push({ code: 'EMPTY_ASSET', message: `${options.id}: document has no meshes` });
  return { ok: errors.length === 0, errors, warnings };
}
