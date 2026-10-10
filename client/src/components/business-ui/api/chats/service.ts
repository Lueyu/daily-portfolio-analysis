/**
 * Thin service wrapper around the platform ChatService for searching and
 * batch-fetching chats, used by the ChatSelect component.
 * Part of the vendored business-ui component library.
 */
import {
  ChatService,
  type BatchGetChatsResponse,
  type ChatInfo,
  type SearchChatsParams,
  type SearchChatsResponse,
} from '@lark-apaas/client-toolkit/tools/services';

const chatService = new ChatService();

/** Searches chats matching the given query string. */
export async function searchChats(
  params: SearchChatsParams,
): Promise<SearchChatsResponse> {
  return chatService.searchChats(params);
}

/** Batch-fetches chat info for a list of chat IDs. */
export async function listChatsByIds(
  chatIds: string[],
): Promise<BatchGetChatsResponse> {
  return chatService.listChatsByIds(chatIds);
}

export type { BatchGetChatsResponse, ChatInfo, SearchChatsParams, SearchChatsResponse };
