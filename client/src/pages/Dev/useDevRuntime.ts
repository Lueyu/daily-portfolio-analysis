/** Read cursor pages serially, keeping a bounded local history for the selected task. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDevRuntime } from '@/api';
import type { DevAgentRuntimeSnapshot } from '@shared/api.interface';
import { DETAIL_POLL_MS, getErrorMessage } from './dev-ui';
import { mergeRuntimeEvents } from './dev-runtime';

export function useDevRuntime(taskId: string, enabled: boolean, running: boolean) {
  const [snapshot, setSnapshot] = useState<DevAgentRuntimeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshVersion, setRefreshVersion] = useState<number>(0);
  const cursor = useRef<number>(0);
  const pending = useRef<Promise<void> | null>(null);
  const refresh = useCallback((): void => {
    setLoading(true);
    setRefreshVersion((version: number) => version + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (): void => {
      setLoading(true);
      const previous: Promise<void> | null = pending.current;
      const request: Promise<void> = (async (): Promise<void> => {
        if (previous) await previous;
        if (cancelled) return;
        try {
          const next: DevAgentRuntimeSnapshot = await getDevRuntime(taskId, cursor.current);
          if (cancelled) return;
          cursor.current = next.cursor;
          setSnapshot((current: DevAgentRuntimeSnapshot | null) => ({
            ...next, events: mergeRuntimeEvents(current?.events ?? [], next.events),
          }));
          setError(null);
          if (next.events.length >= 100 || running || next.pending) {
            timer = setTimeout(load, next.events.length >= 100 ? 0 : DETAIL_POLL_MS);
          }
        } catch (cause: unknown) {
          if (!cancelled) setError(getErrorMessage(cause));
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      pending.current = request;
      void request.then((): void => {
        if (pending.current === request) pending.current = null;
      });
    };
    load();
    return (): void => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [taskId, enabled, running, refreshVersion]);

  return { snapshot, error, loading, refresh };
}
