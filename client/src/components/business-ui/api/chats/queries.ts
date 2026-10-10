'use client';

/**
 * React Query hooks and cache keys for chat (group) lookups used by ChatSelect.
 * Part of the vendored business-ui component library.
 */
import { useQuery, queryOptions, type QueryClient } from '@tanstack/react-query';

import { listChatsByIds, searchChats } from './service';

/** Centralized React Query cache keys and query options for chat lookups. */
export const chatQueries = {
  all: () => ['chats'] as const,
  search: (query: string, pageSize: number = 100) =>
    queryOptions({
      queryKey: [...chatQueries.all(), 'search', query, pageSize],
      queryFn: () => searchChats({ query, pageSize }),
      staleTime: 1 * 60 * 1000,
      gcTime: 5 * 60 * 1000,
      enabled: query.length > 0,
    }),
  byIds: (chatIds: string[]) =>
    queryOptions({
      queryKey: [...chatQueries.all(), 'byIds', chatIds.join(',')],
      queryFn: () => listChatsByIds(chatIds),
      staleTime: 1 * 60 * 1000,
      gcTime: 5 * 60 * 1000,
      enabled: chatIds.length > 0,
    }),
};

/** Hook that batch-loads chat info for the given chat IDs. */
export function useChatsByIds(chatIds: string[]) {
  return useQuery(chatQueries.byIds(chatIds));
}

/** Invalidates all cached chat queries so they are refetched. */
export function clearChatCache(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: chatQueries.all() });
}
