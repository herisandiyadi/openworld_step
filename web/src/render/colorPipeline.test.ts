import { describe, expect, it } from 'vitest';
import { ACESFilmicToneMapping, NoColorSpace, SRGBColorSpace } from 'three';
import { colorPipelineFor, markTextureColorSpace } from './colorPipeline';

describe('colorPipelineFor', () => {
  it('menggunakan output sRGB dan ACES untuk semua tier', () => {
    for (const tier of ['low', 'medium', 'high'] as const) {
      const config = colorPipelineFor(tier);
      expect(config.outputColorSpace).toBe(SRGBColorSpace);
      expect(config.toneMapping).toBe(ACESFilmicToneMapping);
      expect(config.exposure).toBeGreaterThan(0);
    }
  });

  it('mengambil exposure dari quality tier', () => {
    expect(colorPipelineFor('low').exposure).toBe(1.05);
    expect(colorPipelineFor('medium').exposure).toBe(1);
    expect(colorPipelineFor('high').exposure).toBe(1);
  });

  it('menandai albedo sebagai sRGB dan data map sebagai linear', () => {
    const albedo = { colorSpace: '' };
    const normal = { colorSpace: '' };
    const roughness = { colorSpace: '' };
    const metalness = { colorSpace: '' };
    const ao = { colorSpace: '' };
    expect(markTextureColorSpace(albedo, 'albedo')).toBe(albedo);
    expect(albedo.colorSpace).toBe(SRGBColorSpace);
    for (const texture of [normal, roughness, metalness, ao]) {
      expect(markTextureColorSpace(texture, 'normal')).toBe(texture);
      expect(texture.colorSpace).toBe(NoColorSpace);
    }
  });
});


describe('applyColorPipeline', () => {
  it('menerapkan output color space, tone mapping, dan exposure ke renderer', async () => {
    const { applyColorPipeline } = await import('./colorPipeline');
    const renderer = { outputColorSpace: '', toneMapping: 0, toneMappingExposure: 0 };
    expect(applyColorPipeline(renderer, 'high')).toBe(renderer);
    expect(renderer.outputColorSpace).toBe(SRGBColorSpace);
    expect(renderer.toneMapping).toBe(ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBe(1);
  });
});
