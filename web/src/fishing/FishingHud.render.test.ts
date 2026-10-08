import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FishingHud } from './FishingHud';
import { createFishingSession, type FishingSession } from './FishingController';

function session(phase: FishingSession['phase']): FishingSession {
  const s = createFishingSession({ spotId: 'spot-1', callbacks: { rng: () => 0.5, now: () => 0, vibrate: vi.fn(), playSound: vi.fn() } });
  return { ...s, phase };
}

describe('FishingHud accessibility', () => {
  it('exposes an accessible pull button with the fishing-btn-pull class during bite', () => {
    const html = renderToStaticMarkup(createElement(FishingHud, {
      session: session('bite'),
      onPull: vi.fn(),
      onCancel: vi.fn(),
    }));
    expect(html).toContain('aria-label="Tarik senar"');
    expect(html).toContain('fishing-btn-pull');
    // 72px minimum touch target is enforced by CSS (min-width/height); class must be present.
    expect(html).toContain('fishing-btn-pulse');
  });

  it('always offers an accessible cancel control outside the result phase', () => {
    const html = renderToStaticMarkup(createElement(FishingHud, {
      session: session('wait'),
      onPull: vi.fn(),
      onCancel: vi.fn(),
    }));
    expect(html).toContain('aria-label="Batal memancing"');
  });

  it('shows a result acknowledgement button with an accessible label', () => {
    const s = { ...session('result'), outcome: 'caught' as const, loot: { kind: 'fish' as const, id: 'nila', species: 'nila', weight: 0.8 } };
    const html = renderToStaticMarkup(createElement(FishingHud, {
      session: s,
      onPull: vi.fn(),
      onCancel: vi.fn(),
      onRelease: vi.fn(),
    }));
    expect(html).toContain('aria-label="Tutup hasil pancingan"');
  });
});
