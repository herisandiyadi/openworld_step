import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { PCFShadowMap, type WebGLRenderer } from 'three';
import { applyColorPipeline } from './colorPipeline';
import { detectCapabilities } from './capabilities';
import { resolveTier, type QualityTier } from '../state/qualityTiers';
import { useGameStore } from '../state/gameStore';
export function RenderFoundation({ tier }: { tier: QualityTier }) {
  const gl = useThree(({ gl }) => gl);
  const setQuality = useGameStore((state) => state.setQuality);
  useEffect(() => {
    const caps = detectCapabilities(gl.getContext() as WebGLRenderingContext);
    const resolved = resolveTier(tier, caps);
    applyColorPipeline(gl as WebGLRenderer, tier);
    gl.shadowMap.type = PCFShadowMap;
    gl.shadowMap.enabled = resolved.shadows;
    gl.shadowMap.autoUpdate = true;
    if (tier === 'high' && !caps.halfFloatRenderTarget) setQuality('medium');
  }, [gl, setQuality, tier]);
  return null;
}
