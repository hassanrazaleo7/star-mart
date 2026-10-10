import { useEffect, useRef, useCallback } from 'react';
// Small-store sync: poll one O(1) version query and fetch data only after a change.
// Returns sync(): refresh now and remember the version so the next poll is a no-op.
async function version() {
  const r = await fetch('/api/live/version', { cache: 'no-store', credentials: 'same-origin' });
  if (!r.ok) throw Error('Sync unavailable');
  return (await r.json()).version;
}
export function useLiveRefresh(refresh, interval = 3000) {
  const latest = useRef(refresh);
  latest.current = refresh;
  const seen = useRef(null),
    busy = useRef(false);
  const sync = useCallback(async () => {
    const v = await version();
    await latest.current();
    seen.current = v;
  }, []);
  useEffect(() => {
    let active = true;
    async function check() {
      if (!active || busy.current || document.visibilityState === 'hidden') return;
      busy.current = true;
      try {
        const v = await version();
        if (seen.current !== null && v !== seen.current) await latest.current();
        seen.current = v;
      } catch {
        /* transient; retried on the next tick */
      } finally {
        busy.current = false;
      }
    }
    const timer = setInterval(check, interval),
      visible = () => {
        if (document.visibilityState === 'visible') check();
      };
    document.addEventListener('visibilitychange', visible);
    check();
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [interval]);
  return sync;
}
