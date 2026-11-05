import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }));

const { applySave, captureSave, MAX_RESIDENT_CHATS, parseSave, recordResidentChat, rememberChat, residentHistory, resetGame, useResidentChats } =
  await import('./saveGame');
const { playerState } = await import('../game/runtime');
const { useGameStore } = await import('./gameStore');
const { exploredRatio, markExplored } = await import('../game/exploration');
const { useContentProgress } = await import('./contentProgress');

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

  it('round-trips v2 content progress (coins, bag, ledger, market)', () => {
    resetGame();
    const content = useContentProgress.getState();
    content.directCredit(30, 'test');
    content.addFishToBag({ id: 'fish-1', kind: 'fish', species: 'nila', weight: 0.8, qty: 1 });
    content.setContentVersion('v-test');
    const text = JSON.stringify(captureSave());
    resetGame();
    expect(useContentProgress.getState().coins).toBe(0);
    const parsed = parseSave(text);
    expect(parsed?.version).toBe(2);
    expect(parsed?.coins).toBe(30);
    expect(parsed?.bag.items).toHaveLength(1);
    expect(parsed?.ledger).toHaveLength(1);
    expect(parsed?.contentVersion).toBe('v-test');
    if (parsed) applySave(parsed);
    expect(useContentProgress.getState().coins).toBe(30);
    expect(useContentProgress.getState().bag.items[0]?.species).toBe('nila');
  });

  it('migrates a legacy v1 save to v2 and seeds q_kenalan from met', () => {
    const v1 = { version: 1, x: 5, z: 6, heading: 0, riding: null, vehicles: [], met: ['npc_budi', 'npc_sari'], explored: '', time: 0.2 };
    const parsed = parseSave(JSON.stringify(v1));
    expect(parsed?.version).toBe(2);
    expect(parsed?.met).toEqual(['npc_budi', 'npc_sari']);
    expect(parsed?.quests[0]?.questId).toBe('q_kenalan');
    expect(parsed?.quests[0]?.step).toBe(2);
    expect(parsed?.coins).toBe(0);
  });

  it('sanitises malformed v2 field values instead of trusting storage', () => {
    const v2 = {
      version: 2, x: 0, z: 0, heading: 0, riding: null, vehicles: [], met: [1, 'npc_x'], explored: '', time: 0.3,
      coins: -50, ledger: [{ bad: true }, { amount: 3, balance: 3 }], quests: [{ questId: 5 }],
      inventory: null, jobs: 4, bag: { capacity: 'x', items: [{ id: 'ok', kind: 'fish', qty: -2 }] }, contentVersion: 9, market: null,
    };
    const parsed = parseSave(JSON.stringify(v2));
    expect(parsed?.coins).toBe(0);
    expect(parsed?.met).toEqual(['npc_x']);
    expect(parsed?.ledger).toHaveLength(1);
    expect(parsed?.quests).toEqual([]);
    expect(parsed?.inventory).toEqual({ owned: [], equipped: {} });
    expect(parsed?.bag.capacity).toBe(8);
    expect(parsed?.bag.items[0]?.qty).toBe(1);
    expect(parsed?.contentVersion).toBe('');
    expect(parsed?.market).toEqual({ dayIndex: 0, salesBySpecies: {} });
  });
});
