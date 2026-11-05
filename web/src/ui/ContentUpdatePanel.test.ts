import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContentUpdatePanel } from './ContentUpdatePanel';

const noop = async () => undefined;

describe('ContentUpdatePanel', () => {
  it('shows the active version and a check button', () => {
    const html = renderToStaticMarkup(createElement(ContentUpdatePanel, {
      activeVersion: '1.0.0',
      onCheck: noop,
      onRollback: noop,
      allowCellular: false,
      onToggleCellular: noop,
      status: { state: 'idle' },
    }));
    expect(html).toContain('Pembaruan Konten');
    expect(html).toContain('1.0.0');
    expect(html).toContain('Cek pembaruan');
  });

  it('shows the staged download size and a rollback control when an update is staged', () => {
    const html = renderToStaticMarkup(createElement(ContentUpdatePanel, {
      activeVersion: '1.0.0',
      onCheck: noop,
      onRollback: noop,
      allowCellular: true,
      onToggleCellular: noop,
      status: { state: 'staged', downloadSize: 2048, message: 'Paket siap dipakai pada peluncuran berikutnya.' },
    }));
    expect(html).toContain('2.0 KB');
    expect(html).toContain('Kembali ke bawaan');
  });

  it('announces errors politely without hiding the check control', () => {
    const html = renderToStaticMarkup(createElement(ContentUpdatePanel, {
      activeVersion: '1.0.0',
      onCheck: noop,
      onRollback: noop,
      allowCellular: false,
      onToggleCellular: noop,
      status: { state: 'error', message: 'Jaringan tidak tersedia' },
    }));
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Jaringan tidak tersedia');
    expect(html).toContain('Cek pembaruan');
  });
});
