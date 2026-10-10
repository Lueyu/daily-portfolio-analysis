'use client';

/**
 * React Query hook and cache keys for batch user lookups used by UserSelect
 * and the UserDisplay components.
 * Part of the vendored business-ui component library.
 */
import { useQuery, queryOptions, type QueryClient } from '@tanstack/react-query';

import { listUsersByIds, type AccountType } from './service';

/** Centralized React Query cache keys and query options for user lookups. */
export const userQueries = {
  all: () => ['users'] as const,
  byIds: (userIds: string[], accountType: AccountType = 'apaas') =>
    queryOptions({
      queryKey: [...userQueries.all(), 'byIds', accountType, userIds.join(',')],
      queryFn: () => listUsersByIds(userIds),
      staleTime: 1 * 60 * 1000,
      gcTime: 5 * 60 * 1000,
      enabled: userIds.length > 0,
    }),
};

/** Hook that batch-loads user info for the given user IDs. */
export function useUsersByIds(
  userIds: string[],
  accountType: AccountType = 'apaas',
) {
  return useQuery(userQueries.byIds(userIds, accountType));
}

/** Invalidates all cached user queries so they are refetched. */
export function clearUserCache(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: userQueries.all() });
}
