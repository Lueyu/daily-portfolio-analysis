'use client';

/**
 * useFetchData: minimal data-fetching hook for the combobox. Calls fetchFn with
 * the current search text when enabled, and tracks data/loading/error/success state.
 * Part of the vendored business-ui component library.
 */
import { logger } from '@lark-apaas/client-toolkit/logger';
import { useCallback, useEffect, useState } from 'react';

/** Options for useFetchData. */
export type UseFetchDataOptions<T> = {
  fetchFn: (search: string) => Promise<{ items: T[] }>;
  enabled: boolean;
  search: string;
  onSearch?: (search: string) => void;
};

/** Return value of useFetchData. */
export type UseFetchDataResult<T> = {
  data: T[] | undefined;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  fetchStatus: 'fetching' | 'idle';
  refetch: () => Promise<void>;
};

/** Fetches option data for the given search text and exposes request state. */
export function useFetchData<T>({
  fetchFn,
  enabled,
  search,
  onSearch,
}: UseFetchDataOptions<T>): UseFetchDataResult<T> {
  const [data, setData] = useState<T[] | undefined>();
  const [isFetching, setIsFetching] = useState(false);
  const [isError, setIsError] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const fetchData = useCallback(async () => {
    if (!enabled || search.trim() === '') {
      setData([]);
      setIsSuccess(true);
      return;
    }

    try {
      setIsFetching(true);
      setIsError(false);

      const result = await fetchFn(search);

      setData(result?.items || []);
      setIsSuccess(true);
      setIsError(false);
    } catch (error) {
      logger.error('Failed to fetch data:', error);
      setIsError(true);
      setIsSuccess(false);
      setData([]);
    } finally {
      setIsFetching(false);
    }
  }, [enabled, search, fetchFn]);

  useEffect(() => {
    if (enabled && search.trim() !== '') {
      fetchData();
    } else {
      setData(undefined);
      setIsSuccess(true);
    }
  }, [search, enabled, fetchData]);

  // Fire the onSearch callback separately from the fetch effect.
  useEffect(() => {
    onSearch?.(search);
  }, [search, onSearch]);

  return {
    data,
    isFetching,
    isError,
    isSuccess,
    fetchStatus: isFetching ? 'fetching' : 'idle',
    refetch: fetchData,
  };
}
