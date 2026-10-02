import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn(() => Promise.resolve()), remove: vi.fn() } }));

const { DEFAULT_AUDIO, normalizeAudio } = await import('./audioSettings');

describe('audio settings', () => {
  it('clamps volumes and falls back to defaults', () => {
    expect(normalizeAudio({ music: 2, sfx: -1, muted: true })).toEqual({ music: 1, sfx: 0, muted: true });
    expect(normalizeAudio(null)).toEqual(DEFAULT_AUDIO);
    expect(normalizeAudio({ music: Number.NaN })).toEqual(DEFAULT_AUDIO);
  });
});