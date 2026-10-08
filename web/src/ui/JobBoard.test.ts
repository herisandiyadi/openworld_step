import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { JobBoard } from './JobBoard';

describe('JobBoard', () => {
  it('renders an accessible dialog with job list, remaining counts, complete buttons, bonus status, and close control', () => {
    const html = renderToStaticMarkup(
      createElement(JobBoard, {
        jobs: [
          { id: 'job_bengkel', title: 'Antar Suku Cadang', rewardCoins: 25, remaining: 10, doneToday: 0, questId: 'q_bengkel_kilat' },
          { id: 'job_ojek', title: 'Ojek Antar Warga', rewardCoins: 20, remaining: 12, doneToday: 0, questId: 'q_ojek_cepat' },
        ],
        bonusClaimedToday: false,
        onComplete: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Papan Pekerjaan');
    expect(html).toContain('Antar Suku Cadang');
    expect(html).toContain('25');
    expect(html).toContain('10 tersisa');
    expect(html).toContain('Selesaikan');
    expect(html).toContain('Ojek Antar Warga');
    expect(html).toContain('Bonus login belum diklaim');
  });

  it('shows bonus claimed status and disables buttons when remaining is 0', () => {
    const html = renderToStaticMarkup(
      createElement(JobBoard, {
        jobs: [{ id: 'job_bengkel', title: 'Antar Suku Cadang', rewardCoins: 25, remaining: 0, doneToday: 10, questId: 'q_bengkel_kilat' }],
        bonusClaimedToday: true,
        onComplete: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    expect(html).toContain('Bonus login sudah diklaim');
    expect(html).toContain('disabled=""');
    expect(html).toContain('0 tersisa');
  });

  it('hides complete button when questId is null (unmapped job)', () => {
    const html = renderToStaticMarkup(
      createElement(JobBoard, {
        jobs: [{ id: 'job_unknown', title: 'Pekerjaan Belum Terpetakan', rewardCoins: 30, remaining: 5, doneToday: 0, questId: null }],
        bonusClaimedToday: false,
        onComplete: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    expect(html).toContain('Pekerjaan Belum Terpetakan');
    expect(html).not.toContain('Selesaikan');
  });
});
