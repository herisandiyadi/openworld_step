import { describe, expect, it } from 'vitest';
import { validateOrmManifest, type OrmManifest } from './manifest';

const valid: OrmManifest = {
  asset: 'bld_shop_01',
  source: { occlusion: 'bld_shop_01_ao.png', roughness: 'bld_shop_01_rough.png', metallic: 'bld_shop_01_metal.png' },
  packed: 'bld_shop_01_orm.ktx2',
  channels: { R: 'occlusion', G: 'roughness', B: 'metallic' },
};

describe('validateOrmManifest', () => {
  it('accepts the glTF ORM layout (R=occlusion, G=roughness, B=metallic)', () => {
    expect(validateOrmManifest(valid)).toEqual([]);
  });

  it('rejects swapped channels', () => {
    const swapped = { ...valid, channels: { R: 'roughness', G: 'occlusion', B: 'metallic' } } as unknown as OrmManifest;
    expect(validateOrmManifest(swapped)).toEqual(['occlusion must be in R', 'roughness must be in G']);
  });
});
