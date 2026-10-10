'use client';

/**
 * React Query hook and cache keys for fetching user profile card data,
 * used by the UserProfile component.
 * Part of the vendored business-ui component library.
 */
import { useQuery, queryOptions, type QueryClient } from '@tanstack/react-query';

import { fetchUserProfile, type AccountType } from './service';

/** Centralized React Query cache keys and query options for user profile lookups. */
export const userProfileQueries = {
  all: () => ['userProfiles'] as const,
  byId: (userId: string, accountType: AccountType = 'apaas') =>
    queryOptions({
      queryKey: [...userProfileQueries.all(), 'byId', accountType, userId],
      queryFn: ({ signal }) => fetchUserProfile(userId, accountType, signal),
      staleTime: 1 * 60 * 1000,
      gcTime: 5 * 60 * 1000,
      enabled: !!userId,
    }),
};

/** Options accepted by the useUserProfile hook. */
export type UseUserProfileOptions = {
  userId: string;
  accountType?: AccountType;
  enabled?: boolean;
};

/** Hook that fetches the profile card data for a single user. */
export function useUserProfile(options: UseUserProfileOptions) {
  const { userId, accountType = 'apaas', enabled = true } = options;

  return useQuery({
    ...userProfileQueries.byId(userId, accountType),
    enabled: enabled && !!userId,
  });
}

/** Invalidates all cached user profile queries so they are refetched. */
export function clearUserProfileCache(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: userProfileQueries.all() });
}
