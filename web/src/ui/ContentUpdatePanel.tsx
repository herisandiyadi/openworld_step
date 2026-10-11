/**
 * ContentUpdatePanel: displays active content version, check/download controls, and staged update status.
 * Lives outside the HUD; shown in settings or title screen.
 */

import type { ContentUpdateStatus } from '../app/contentUpdatesRuntime';

interface ContentUpdatePanelProps {
  activeVersion: string;
  status: ContentUpdateStatus;
  allowCellular: boolean;
  onCheck: () => Promise<void>;
  onRollback: () => Promise<void>;
  onToggleCellular: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ContentUpdatePanel({
  activeVersion,
  status,
  allowCellular,
  onCheck,
  onRollback,
  onToggleCellular,
}: ContentUpdatePanelProps) {
  const busy = status.state === 'checking' || status.state === 'downloading';

  return (
    <div style={{ padding: '1rem', background: '#2a2a2a', color: '#eee', borderRadius: '8px' }}>
      <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1.1rem' }}>Pembaruan Konten</h3>
      <p style={{ margin: '0.25rem 0', fontSize: '0.9rem' }}>
        Versi aktif: <strong>{activeVersion}</strong>
      </p>

      {status.state === 'error' && (
        <div aria-live="polite" style={{ color: '#ff6b6b', margin: '0.5rem 0', fontSize: '0.9rem' }}>
          {status.message}
        </div>
      )}

      {status.state === 'staged' && status.downloadSize !== undefined && (
        <div style={{ margin: '0.75rem 0', padding: '0.5rem', background: '#3a3a3a', borderRadius: '4px' }}>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            <strong>{formatBytes(status.downloadSize)}</strong> siap dipakai pada peluncuran berikutnya.
          </p>
          {status.message && <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#aaa' }}>{status.message}</p>}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
        <button
          onClick={onCheck}
          disabled={busy}
          style={{
            padding: '0.5rem 1rem',
            background: busy ? '#555' : '#4a9eff',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: busy ? 'not-allowed' : 'pointer',
            fontSize: '0.9rem',
          }}
        >
          {busy ? 'Memeriksa...' : 'Cek pembaruan'}
        </button>

        {status.state === 'staged' && (
          <button
            onClick={onRollback}
            style={{
              padding: '0.5rem 1rem',
              background: '#d63031',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Kembali ke bawaan
          </button>
        )}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', marginTop: '1rem', fontSize: '0.9rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={allowCellular} onChange={onToggleCellular} style={{ marginRight: '0.5rem' }} />
        Izinkan unduh melalui seluler
      </label>
    </div>
  );
}
