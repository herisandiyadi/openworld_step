/** Audit instancing murni untuk props berulang; tidak membuat objek Three.js. */
export interface Placement { id: string; materialKey?: string; geometryKey?: string }
export interface InstancingGroup {
  key: string;
  count: number;
  eligible: boolean;
}
export interface InstancingAudit {
  totalPlacements: number;
  groups: InstancingGroup[];
  eligiblePlacements: number;
  drawCallsBefore: number;
  drawCallsAfter: number;
  estimatedSavings: number;
}

/**
 * Placement dengan geometry+material yang sama aman digabung menjadi satu InstancedMesh.
 * Group berisi satu placement tetap eligible=false karena tidak ada penghematan.
 */
export function auditInstancing(placements: readonly Placement[]): InstancingAudit {
  const counts = new Map<string, number>();
  for (const placement of placements) {
    const key = `${placement.geometryKey ?? placement.id}|${placement.materialKey ?? 'default'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const groups = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => ({
    key, count, eligible: count > 1,
  }));
  const eligiblePlacements = groups.filter((group) => group.eligible).reduce((sum, group) => sum + group.count, 0);
  const drawCallsBefore = groups.reduce((sum, group) => sum + group.count, 0);
  const drawCallsAfter = groups.length;
  return { totalPlacements: placements.length, groups, eligiblePlacements, drawCallsBefore, drawCallsAfter, estimatedSavings: drawCallsBefore - drawCallsAfter };
}
