import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FishingHud } from './FishingHud';
import { createFishingSession, type FishingSession } from './FishingController';

function session(phase: FishingSession['phase']): FishingSession {
  const s = createFishingSession({ spotId: 'spot-1', callbacks: { rng: () => 0.5, now: () => 0, vibrate: vi.fn(), playSound: vi.fn() } });
  if (phase === 'cast' || phase === 'wait') return { ...s, phase };
  const bite = { ...s, phase: 'bite' as const };
  // The HUD's contract is render-only; use the real controller transition shape.
  const minigame = {
    phase: 'active' as const,
    target: { position: 0.5, size: 0.28 },
    needle: { position: 0.4, direction: 1 as const, speed: 1 },
    remainingMs: 900,
    durationMs: 1800,
    attempts: 0,
    tension: 0,
    easyMode: false,
    difficulty: 2,
    zone: { position: 0.5, size: 0.28 },
    fish: { position: 0.4, velocity: 1 },
    reel: 0,
    redTensionSeconds: 0,
    fishSpeed: 1,
  };
  return { ...bite, minigame };
}

describe('FishingHud horizontal timing gauge', () => {
  it('renders target band, moving needle and accessible countdown during bite', () => {
    const html = renderToStaticMarkup(createElement(FishingHud, {
      session: session('bite'), onPull: vi.fn(), onCancel: vi.fn(),
    }));
    expect(html).toContain('fishing-timing-gauge');
    expect(html).toContain('fishing-target-band');
    expect(html).toContain('fishing-needle');
    expect(html).toContain('aria-label="Waktu tersisa: 0.9 detik"');
    expect(html).toContain('role="progressbar"');
  });

  it('offers one large Tap/Tarik button without hold-only controls', () => {
    const html = renderToStaticMarkup(createElement(FishingHud, {
      session: session('bite'), onPull: vi.fn(), onCancel: vi.fn(),
    }));
    expect(html).toContain('aria-label="Tap/Tarik sekarang"');
    expect(html).toContain('Tap / Tarik');
    expect(html).not.toContain('onPointerUp');
  });

  it('shows explicit status for escaped and line-broken results', () => {
    const escaped = { ...session('result'), phase: 'result' as const, outcome: 'escaped' as const };
    const broken = { ...session('result'), phase: 'result' as const, outcome: 'line-broken' as const };
    const escapedHtml = renderToStaticMarkup(createElement(FishingHud, { session: escaped, onPull: vi.fn(), onCancel: vi.fn() }));
    const brokenHtml = renderToStaticMarkup(createElement(FishingHud, { session: broken, onPull: vi.fn(), onCancel: vi.fn() }));
    expect(escapedHtml).toContain('Ikan lepas!');
    expect(brokenHtml).toContain('Senar putus!');
  });
});
