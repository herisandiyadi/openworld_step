import { describe, expect, it } from 'vitest';
import { characterAssets } from '../defs/characters';

const HERO_TRIANGLE_BUDGET = 5000;

describe('custom hero gold chain', () => {
  it('builds a front-mounted metallic gold_chain within the hero triangle budget', () => {
    const definition = characterAssets.find((asset) => asset.id === 'char_hero_m');
    expect(definition).toBeDefined();

    const document = definition?.build();
    expect(document).toBeDefined();
    if (!document) return;

    const chain = document.getRoot().listNodes().find((node) => node.getName() === 'gold_chain');
    expect(chain).toBeDefined();

    const primitive = chain?.getMesh()?.listPrimitives()[0];
    expect(primitive).toBeDefined();
    expect(primitive?.getMaterial()?.getMetallicFactor()).toBe(0.85);
    expect(primitive?.getMaterial()?.getRoughnessFactor()).toBe(0.22);

    const positions = primitive?.getAttribute('POSITION')?.getArray();
    expect(positions).toBeDefined();
    if (positions) {
      for (let i = 2; i < positions.length; i += 3) expect(positions[i]).toBeLessThan(-0.12);
    }

    const triangles = document
      .getRoot()
      .listMeshes()
      .flatMap((mesh) => mesh.listPrimitives())
      .reduce((sum, part) => sum + (part.getIndices()?.getCount() ?? 0) / 3, 0);
    expect(triangles).toBeLessThanOrEqual(HERO_TRIANGLE_BUDGET);
  });
});
