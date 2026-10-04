import { describe, expect, it } from 'vitest';
import { DEBUG_QUERY_FLAG, isDebugOverlayVisible } from './debugOverlay';

describe('debug overlay gating', () => {
  it('stays hidden in production unless an explicit debug flag is set', () => {
    expect(isDebugOverlayVisible({ dev: false, search: '' })).toBe(false);
    expect(isDebugOverlayVisible({ dev: false, search: `?${DEBUG_QUERY_FLAG}` })).toBe(true);
    expect(isDebugOverlayVisible({ dev: false, search: '?other=1' })).toBe(false);
  });
  it('is visible in dev builds by default', () => {
    expect(isDebugOverlayVisible({ dev: true, search: '' })).toBe(true);
  });
  it('an explicit off flag wins over the dev default', () => {
    expect(isDebugOverlayVisible({ dev: true, search: `?${DEBUG_QUERY_FLAG}=0` })).toBe(false);
  });
});
