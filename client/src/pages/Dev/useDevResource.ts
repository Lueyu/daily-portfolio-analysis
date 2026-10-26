/** Serial polling with stale-response protection and explicit retry after errors. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from './dev-ui';

export function useDevResource<T>(
  request: () => Promise<T>,
  interval = 0,
  enabled = true,
  shouldPoll?: (data: T) => boolean,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [revision, setRevision] = useState(0);
  const pending = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    // Lock actions immediately after an accepted write, before the next effect.
    if (enabled) setLoading(true);
    setRevision((value) => value + 1);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    setLoading(true);
    const load = () => {
      // A manual refresh may arrive during a poll. Wait for it to settle;
      // cancelled effects neither publish their response nor start queued work.
      const previous = pending.current;
      const next = (async () => {
        if (previous) await previous;
        if (cancelled) return;
        try {
          const result = await request();
          if (cancelled) return;
          setData(result);
          setError(null);
          if (interval > 0 && (!shouldPoll || shouldPoll(result))) {
            timer = window.setTimeout(load, interval);
          }
        } catch (cause) {
          if (!cancelled) setError(getErrorMessage(cause));
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      pending.current = next;
      void next.then(() => { if (pending.current === next) pending.current = null; });
    };
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [request, interval, enabled, shouldPoll, revision]);

  return { data, error, loading, refresh };
}
