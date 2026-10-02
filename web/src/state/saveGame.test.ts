import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }));

const { applySave, captureSave, MAX_RESIDENT_CHATS, parseSave, recordResidentChat, rememberChat, residentHistory, resetGame, useResidentChats } =
  await import('./saveGame');
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

  it('riwayat chat warga ikut save/load', () => {
    resetGame();
    recordResidentChat('res_03', [
      { role: 'user', content: 'Halo' },
      { role: 'assistant', content: 'Halo juga, Mas!' },
    ]);
    const text = JSON.stringify(captureSave());
    resetGame();
    expect(residentHistory('res_03')).toEqual([]);
    expect(useResidentChats.getState().talked).toEqual([]);
    const parsed = parseSave(text);
    if (parsed) applySave(parsed);
    expect(residentHistory('res_03').map((m) => m.content)).toEqual(['Halo', 'Halo juga, Mas!']);
    expect(useResidentChats.getState().talked).toEqual(['res_03']);
  });

  it('riwayat warga dibatasi 10 giliran dan 30 warga (LRU)', () => {
    let chats = rememberChat([], 'res_00', Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }) as const));
    expect(chats[0]?.[1]).toHaveLength(20);
    expect(chats[0]?.[1].at(-1)?.content).toBe('m29');
    for (let i = 1; i <= MAX_RESIDENT_CHATS; i++) chats = rememberChat(chats, `res_${i}`, [{ role: 'user', content: 'x' }]);
    expect(chats).toHaveLength(MAX_RESIDENT_CHATS);
    // res_00 paling lama tidak diajak ngobrol, jadi dibuang.
    expect(chats.some(([id]) => id === 'res_00')).toBe(false);
    // Mengajak ngobrol lagi memindahkan warga ke posisi paling baru.
    chats = rememberChat(chats, 'res_1', [{ role: 'user', content: 'lagi' }]);
    expect(chats.at(-1)?.[0]).toBe('res_1');
    expect(chats).toHaveLength(MAX_RESIDENT_CHATS);
  });

  it('save lama tanpa riwayat warga tetap terbaca, entri rusak dibuang', () => {
    const old = { version: 1, x: 1, z: 2, heading: 0, riding: null, vehicles: [], met: [], explored: '', time: 0.5 };
    expect(parseSave(JSON.stringify(old))?.chats).toEqual([]);
    const broken = { ...old, chats: [['res_01', [{ role: 'system', content: 'jahat' }, { role: 'user', content: 'ok' }]], 'rusak', [5, []]], talked: ['res_01', 7] };
    const parsed = parseSave(JSON.stringify(broken));
    expect(parsed?.chats).toEqual([['res_01', [{ role: 'user', content: 'ok' }]]]);
    expect(parsed?.talked).toEqual(['res_01']);
  });
});
