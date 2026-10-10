import { useEffect, useRef } from 'react';
// Small-store sync: poll one lightweight version query and fetch data only after a change.
// Stops in hidden tabs; failed checks retry without logging the user out.
export function useLiveRefresh(refresh, interval = 3000) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    let current = null,
      active = true,
      busy = false;
    async function check() {
      if (!active || busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        let r = await fetch('/api/live/version', { cache: 'no-store' });
        if (!r.ok) throw Error('Sync unavailable');
        let { version } = await r.json();
        if (current !== null && version !== current) await latest.current();
        current = version;
      } catch {
      } finally {
        busy = false;
      }
    }
    let timer = setInterval(check, interval),
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
}
