'use client';

/**
 * React Query hook and cache keys for department search used by DepartmentSelect.
 * Part of the vendored business-ui component library.
 */
import { useQuery, queryOptions, type QueryClient } from '@tanstack/react-query';

import { searchDepartments } from './service';

/** Centralized React Query cache keys and query options for department lookups. */
export const departmentQueries = {
  all: () => ['departments'] as const,
  search: (query: string, pageSize: number = 100) =>
    queryOptions({
      queryKey: [...departmentQueries.all(), 'search', query, pageSize],
      queryFn: () => searchDepartments({ query, pageSize }),
      staleTime: 1 * 60 * 1000,
      gcTime: 5 * 60 * 1000,
      enabled: query.length > 0,
    }),
};

/** Options accepted by the useSearchDepartments hook. */
export type UseSearchDepartmentsOptions = {
  query: string;
  pageSize?: number;
  enabled?: boolean;
};

/** Hook that searches departments matching the given query string. */
export function useSearchDepartments(options: UseSearchDepartmentsOptions) {
  const { query, pageSize = 100, enabled = true } = options;

  return useQuery({
    ...departmentQueries.search(query, pageSize),
    enabled: enabled && query.length > 0,
  });
}

/** Invalidates all cached department queries so they are refetched. */
export function clearDepartmentCache(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: departmentQueries.all() });
}
