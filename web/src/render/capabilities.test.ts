import { describe, expect, it } from 'vitest';
import { detectCapabilities } from './capabilities';

describe('detectCapabilities', () => {
  it('mendeteksi WebGL2 dari constructor name', () => {
    const gl2Stub = { constructor: { name: 'WebGL2RenderingContext' } };
    const caps = detectCapabilities(gl2Stub as WebGLRenderingContext);
    expect(caps.webgl2).toBe(true);
  });

  it('mendeteksi WebGL1 dari constructor name', () => {
    const gl1Stub = { constructor: { name: 'WebGLRenderingContext' } };
    const caps = detectCapabilities(gl1Stub as WebGLRenderingContext);
    expect(caps.webgl2).toBe(false);
  });

  it('mendeteksi MSAA support dari getParameter MAX_SAMPLES', () => {
    const gl2WithMSAA = {
      constructor: { name: 'WebGL2RenderingContext' },
      getParameter: (pname: number) => (pname === 0x8D57 ? 4 : null), // MAX_SAMPLES
    };
    const caps = detectCapabilities(gl2WithMSAA as unknown as WebGLRenderingContext);
    expect(caps.msaaSupport).toBe(true);
    expect(caps.maxSamples).toBe(4);
  });

  it('fallback MSAA ke false bila WebGL1 atau MAX_SAMPLES 0', () => {
    const gl1Stub = {
      constructor: { name: 'WebGLRenderingContext' },
      getParameter: () => null,
    };
    const caps = detectCapabilities(gl1Stub as unknown as WebGLRenderingContext);
    expect(caps.msaaSupport).toBe(false);
    expect(caps.maxSamples).toBe(0);
  });

  it('mendeteksi half-float render target dari extension', () => {
    const gl2WithHalfFloat = {
      constructor: { name: 'WebGL2RenderingContext' },
      getParameter: () => 0,
      getExtension: (name: string) => (name === 'EXT_color_buffer_float' ? {} : null),
    };
    const caps = detectCapabilities(gl2WithHalfFloat as unknown as WebGLRenderingContext);
    expect(caps.halfFloatRenderTarget).toBe(true);
  });

  it('mendeteksi render target half-float dari extension WebGL1', () => {
    const glWithHalfFloat = {
      constructor: { name: 'WebGLRenderingContext' },
      getParameter: () => 0,
      getExtension: (name: string) => (name === 'EXT_color_buffer_half_float' ? {} : null),
    };
    const caps = detectCapabilities(glWithHalfFloat as unknown as WebGLRenderingContext);
    expect(caps.halfFloatRenderTarget).toBe(true);
  });

  it('mendeteksi texture compression ASTC', () => {
    const glWithASTC = {
      constructor: { name: 'WebGL2RenderingContext' },
      getParameter: () => 0,
      getExtension: (name: string) => (name === 'WEBGL_compressed_texture_astc' ? {} : null),
    };
    const caps = detectCapabilities(glWithASTC as unknown as WebGLRenderingContext);
    expect(caps.textureCompression.astc).toBe(true);
  });

  it('ETC2 hanya terdeteksi lewat extension WEBGL_compressed_texture_etc, bukan diasumsikan dari WebGL2', () => {
    const gl2Tanpa = {
      constructor: { name: 'WebGL2RenderingContext' },
      getParameter: () => 0,
      getExtension: () => null,
    };
    const gl1Dengan = {
      constructor: { name: 'WebGLRenderingContext' },
      getParameter: () => 0,
      getExtension: (name: string) => (name === 'WEBGL_compressed_texture_etc' ? {} : null),
    };
    expect(detectCapabilities(gl2Tanpa as unknown as WebGLRenderingContext).textureCompression.etc2).toBe(false);
    expect(detectCapabilities(gl1Dengan as unknown as WebGLRenderingContext).textureCompression.etc2).toBe(true);
  });

  it('mendeteksi texture compression S3TC/DXT', () => {
    const glWithS3TC = {
      constructor: { name: 'WebGLRenderingContext' },
      getParameter: () => 0,
      getExtension: (name: string) => (name === 'WEBGL_compressed_texture_s3tc' ? {} : null),
    };
    const caps = detectCapabilities(glWithS3TC as unknown as WebGLRenderingContext);
    expect(caps.textureCompression.s3tc).toBe(true);
  });

  it('memberikan objek capability lengkap dengan default false', () => {
    const minimalGL = {
      constructor: { name: 'WebGLRenderingContext' },
      getParameter: () => 0,
      getExtension: () => null,
    };
    const caps = detectCapabilities(minimalGL as unknown as WebGLRenderingContext);
    expect(caps).toEqual({
      webgl2: false,
      msaaSupport: false,
      maxSamples: 0,
      halfFloatRenderTarget: false,
      textureCompression: { astc: false, etc2: false, s3tc: false },
    });
  });
});
