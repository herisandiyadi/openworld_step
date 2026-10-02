import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }));

const { applySave, captureSave, parseSave, resetGame } = await import('./saveGame');
const { playerState } = await import('../game/runtime');
const { useGameStore } = await import('./gameStore');
const { exploredRatio, markExplored } = await import('../game/exploration');

describe('save game', () => {
  it('round-trips position, quest progress and explored map', () => {
    resetGame();
    playerState.x = 42.5;
    playerState.z = -17.25;
    markExplored(42.5, -17.25);
    useGameStore.getState().addMet('npc_budi');
    const ratio = exploredRatio();
    const text = JSON.stringify(captureSave());

    resetGame();
    expect(playerState.x).toBe(0);
    const parsed = parseSave(text);
    expect(parsed).not.toBeNull();
    if (parsed) applySave(parsed);
    expect(playerState.x).toBe(42.5);
    expect(playerState.z).toBe(-17.25);
    expect(useGameStore.getState().met).toEqual(['npc_budi']);
    expect(exploredRatio()).toBe(ratio);
  });

  it('rejects broken or foreign data', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave('{oops')).toBeNull();
    expect(parseSave(JSON.stringify({ version: 99, x: 0, z: 0 }))).toBeNull();
  });
});