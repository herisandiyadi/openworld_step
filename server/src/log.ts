/**
 * Log terstruktur satu baris JSON per kejadian (mudah dibaca `docker logs`).
 * ATURAN (MULTIPLAYER.md 6): isi chat dan username TIDAK PERNAH ditulis ke log. Yang boleh: jenis
 * kejadian, kode room, id pemain, alasan penolakan, dan angka.
 */
export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, string | number | boolean | null | undefined>;

let silent = process.env.LOG_SILENT === '1';

export function setLogSilent(value: boolean): void {
  silent = value;
}

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (silent) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  if (level === 'info') process.stdout.write(line + '\n');
  else process.stderr.write(line + '\n');
}
