import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuestTracker } from './QuestTracker';
import type { QuestTrackerEntry } from './QuestTracker';

const quests: QuestTrackerEntry[] = [
  { id: 'q_kenalan', title: 'Kenalan dengan warga', stepText: 'Bicara dengan Pak Budi', status: 'active' },
  { id: 'q_antar_paket', title: 'Antar Paket Bu Sari', status: 'active' },
  { id: 'q_done', title: 'Selesai', status: 'completed' },
];

describe('QuestTracker', () => {
  it('renders active quests with their current step text', () => {
    const html = renderToStaticMarkup(createElement(QuestTracker, { quests }));
    expect(html).toContain('aria-label="Daftar quest"');
    expect(html).toContain('Kenalan dengan warga');
    expect(html).toContain('Bicara dengan Pak Budi');
  });

  it('hides completed quests and shows an empty hint when nothing is active', () => {
    const html = renderToStaticMarkup(createElement(QuestTracker, { quests }));
    expect(html).not.toContain('Selesai');
    const empty = renderToStaticMarkup(createElement(QuestTracker, { quests: [] }));
    expect(empty).toContain('Belum ada quest aktif');
  });
});
