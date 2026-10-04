import { useMemo } from 'react';
import { useGameStore } from '../state/gameStore';
import { resolveTier } from '../state/qualityTiers';
import { planPost } from './postPlan';
import { lightingAt } from '../game/lighting';
import { dayClock } from '../game/runtime';

/**
 * Post-processing policy boundary. The project intentionally has no composer dependency;
 * this keeps the resolved, budgeted plan in one runtime location without a broken import.
 */
export function VisualEffects() {
  const quality = useGameStore((state) => state.quality);
  useMemo(() => {
    const caps = {
      webgl2: true, msaaSupport: true, maxSamples: 4,
      halfFloatRenderTarget: quality !== 'low',
      textureCompression: { astc: false, etc2: false, s3tc: false },
    };
    return planPost(resolveTier(quality, caps), lightingAt(dayClock.t).state);
  }, [quality]);
  return null;
}
