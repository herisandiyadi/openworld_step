import { describe, expect, it } from 'vitest';
import { auditInstancing } from './instancing';

describe('auditInstancing', () => {
  it('groups matching geometry/material deterministically and estimates savings', () => {
    const result = auditInstancing([
      { id: 'lamp', geometryKey: 'lamp', materialKey: 'warm' },
      { id: 'lamp-2', geometryKey: 'lamp', materialKey: 'warm' },
      { id: 'bench', geometryKey: 'bench', materialKey: 'wood' },
    ]);
    expect(result.totalPlacements).toBe(3);
    expect(result.drawCallsBefore).toBe(3);
    expect(result.drawCallsAfter).toBe(2);
    expect(result.estimatedSavings).toBe(1);
    expect(result.eligiblePlacements).toBe(2);
  });

  it('does not claim a singleton as an instancing opportunity', () => {
    const result = auditInstancing([{ id: 'tree', geometryKey: 'tree' }]);
    expect(result.groups[0]?.eligible).toBe(false);
    expect(result.estimatedSavings).toBe(0);
  });
});
