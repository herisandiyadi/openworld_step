/**
 * Deteksi kemampuan renderer WebGL: WebGL2, MSAA, half-float, dan texture compression.
 * Fungsi ini bekerja dengan stub object, tidak butuh GPU nyata — cocok untuk testing.
 */

export interface TextureCompressionCaps {
  astc: boolean;
  /** Browser hanya mengekspos ETC2 lewat WEBGL_compressed_texture_etc (umumnya GPU mobile). */
  etc2: boolean;
  s3tc: boolean;
}

export interface RendererCapabilities {
  webgl2: boolean;
  msaaSupport: boolean;
  maxSamples: number;
  halfFloatRenderTarget: boolean;
  textureCompression: TextureCompressionCaps;
}

/**
 * Deteksi kemampuan dari WebGL context.
 * Menerima WebGLRenderingContext atau WebGL2RenderingContext (atau stub untuk test).
 */
export function detectCapabilities(gl: WebGLRenderingContext): RendererCapabilities {
  const isWebGL2 = gl.constructor.name === 'WebGL2RenderingContext';

  let maxSamples = 0;
  let msaaSupport = false;
  if (isWebGL2) {
    try {
      // MAX_SAMPLES = 0x8D57
      const samples = gl.getParameter(0x8d57);
      maxSamples = typeof samples === 'number' ? samples : 0;
      msaaSupport = maxSamples > 0;
    } catch {
      // Ignored
    }
  }

  let halfFloatRenderTarget = false;
  try {
    // WebGL2 umumnya lewat EXT_color_buffer_float; WebGL1 lewat EXT_color_buffer_half_float.
    halfFloatRenderTarget =
      !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
  } catch {
    // Ignored
  }

  // Texture compression
  let astc = false;
  // Sejak spec WebGL 2.0, ETC2/EAC bukan core lagi; hanya lewat extension (pola three.js).
  let etc2 = false;
  let s3tc = false;

  try {
    const astcExt = gl.getExtension('WEBGL_compressed_texture_astc');
    astc = !!astcExt;
  } catch {
    // Ignored
  }

  try {
    etc2 = !!gl.getExtension('WEBGL_compressed_texture_etc');
  } catch {
    // Ignored
  }

  try {
    const s3tcExt = gl.getExtension('WEBGL_compressed_texture_s3tc');
    s3tc = !!s3tcExt;
  } catch {
    // Ignored
  }

  return {
    webgl2: isWebGL2,
    msaaSupport,
    maxSamples,
    halfFloatRenderTarget,
    textureCompression: { astc, etc2, s3tc },
  };
}
