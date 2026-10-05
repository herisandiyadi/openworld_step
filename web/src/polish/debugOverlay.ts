export const DEBUG_QUERY_FLAG = 'debug-overlay';
export interface DebugEnvironment { dev: boolean; search: string }
/** Debug metrics are development-only; production requires the explicit URL flag. */
export function isDebugOverlayVisible(environment: DebugEnvironment): boolean {
  const params = new URLSearchParams(environment.search);
  const explicit = params.get(DEBUG_QUERY_FLAG);
  if (explicit === '0' || explicit === 'false') return false;
  return environment.dev || params.has(DEBUG_QUERY_FLAG);
}
