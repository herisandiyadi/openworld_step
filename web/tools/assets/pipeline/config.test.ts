import { describe, expect, it } from 'vitest';
import { PIPELINE_CONFIG, lodLevelForDistance, textureMaxSize } from './config';

describe('pipeline config', () => {
  it('uses 1 unit = 1 metre and GLB with Meshopt as the runtime format', () => {
    expect(PIPELINE_CONFIG.unitMeters).toBe(1);
    expect(PIPELINE_CONFIG.runtimeFormat).toBe('glb');
    expect(PIPELINE_CONFIG.meshCompression).toBe('EXT_meshopt_compression');
  });

  it('caps texture size per asset class and texture role', () => {
    expect(textureMaxSize('hero', 'albedo')).toBe(2048);
    expect(textureMaxSize('prop_small', 'albedo')).toBe(512);
    expect(textureMaxSize('structure', 'lightmap')).toBe(1024);
  });

  it('prefers KTX2/Basis textures with a PNG/JPEG fallback', () => {
    expect(PIPELINE_CONFIG.textureCompression).toEqual({ preferred: 'KTX2/Basis', fallback: 'PNG/JPEG' });
  });

  it('bakes static assets only, into TEXCOORD_1', () => {
    expect(PIPELINE_CONFIG.bake).toEqual({ staticOnly: true, uvSet: 'TEXCOORD_1' });
  });

  it('picks the texture LOD level from camera distance', () => {
    expect(lodLevelForDistance(0)).toEqual({ level: 0, scale: 1 });
    expect(lodLevelForDistance(45)).toEqual({ level: 1, scale: 0.5 });
    expect(lodLevelForDistance(250)).toEqual({ level: 2, scale: 0.1 });
  });
});
