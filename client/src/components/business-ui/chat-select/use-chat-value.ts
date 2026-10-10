'use client';

/**
 * useChatValue: normalizes ChatSelect's external value into the Chat objects
 * expected by BaseCombobox. In ID mode it fetches full chat metadata for the
 * provided chat IDs, creates "unknown chat" placeholders for unresolved IDs, and
 * converts internal values back to the external string/object shape on change.
 * Part of the vendored business-ui component library.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { listChatsByIds } from '@client/src/components/business-ui/api/chats/service';
import type {
  Chat,
  ChatSelectValue,
  ValueType,
} from '@client/src/components/business-ui/chat-select/types';
import {
  chatInfoToChat,
  createUnknownChat,
  extractIdsFromValue,
} from '@client/src/components/business-ui/chat-select/utils';
import { logger } from '@lark-apaas/client-toolkit/logger';

export type UseChatValueResult = {
  /**
   * Normalized internal value (Chat object format), passed to BaseCombobox.
   */
  internalValue: Chat | Chat[] | null;

  /**
   * Whether chat info is still being loaded.
   */
  isLoading: boolean;

  /**
   * Converts the internal Chat objects back to the external shape:
   * a string/string[] in ID mode, or the Chat object(s) in object mode.
   */
  toExternalValue: (
    internalVal: Chat | Chat[] | null,
    multiple: boolean,
  ) => ChatSelectValue;
};

/**
 * Handles value-type conversion for ChatSelect.
 *
 * - valueType decides whether value is a chatID string or a Chat object.
 * - In ID mode it calls the search API to fetch full chat info.
 * - Invalid IDs get an "unknown chat" placeholder.
 *
 * @param value - The externally provided value.
 * @param multiple - Whether multi-select mode is enabled.
 * @param valueType - 'string' for ID mode, 'object' for Chat-object mode.
 */
export function useChatValue(
  value: ChatSelectValue,
  multiple: boolean = false,
  valueType: ValueType = 'string',
): UseChatValueResult {
  const isIdMode = valueType === 'string';

  const [resolvedChats, setResolvedChats] = useState<Map<string, Chat>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(false);

  const currentIds = useMemo(() => extractIdsFromValue(value), [value]);

  const missingIds = useMemo(() => {
    if (!isIdMode) return [];
    return currentIds.filter((id) => !resolvedChats.has(String(id)));
  }, [isIdMode, currentIds, resolvedChats]);

  // Stabilize the missingIds reference so the effect depends on a string key.
  const missingIdsKey = missingIds.join(',');

  useEffect(() => {
    if (!missingIdsKey) {
      return;
    }

    const ids = missingIdsKey.split(',');
    let cancelled = false;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const response = await listChatsByIds(ids);
        if (cancelled) return;

        const chatInfoMap = response?.data?.chatInfoMap || {};
        setResolvedChats((prev) => {
          const next = new Map(prev);
          for (const [chatId, chatInfo] of Object.entries(chatInfoMap)) {
            const chat = chatInfoToChat(chatInfo);
            next.set(String(chatId), chat);
          }
          // Mark IDs that were not found as unknown-chat placeholders.
          for (const id of ids) {
            if (!next.has(String(id))) {
              next.set(String(id), createUnknownChat(id));
            }
          }
          return next;
        });
      } catch (error) {
        logger.error('Failed to resolve chat IDs:', String(error));
        if (!cancelled) {
          setResolvedChats((prev) => {
            const next = new Map(prev);
            for (const id of ids) {
              if (!next.has(String(id))) {
                next.set(String(id), createUnknownChat(id));
              }
            }
            return next;
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [missingIdsKey]);

  const internalValue = useMemo((): Chat | Chat[] | null => {
    if (value === null || value === undefined) {
      return multiple ? [] : null;
    }

    if (Array.isArray(value) && value.length === 0) {
      return [];
    }

    if (!isIdMode) {
      return value as Chat | Chat[];
    }

    const chats = currentIds
      .map((id) => resolvedChats.get(String(id)))
      .filter((c): c is Chat => c !== undefined);

    if (multiple) {
      return chats;
    }

    return chats[0] ?? null;
  }, [value, isIdMode, currentIds, resolvedChats, multiple]);

  const toExternalValue = useCallback(
    (
      internalVal: Chat | Chat[] | null,
      isMultiple: boolean,
    ): ChatSelectValue => {
      if (internalVal === null) {
        return null;
      }

      if (isIdMode) {
        // ID mode: return a string or string[].
        if (isMultiple) {
          return (internalVal as Chat[]).map((c) => String(c.id));
        }
        return String((internalVal as Chat).id);
      }

      // Object mode: return the Chat object(s) as-is.
      return internalVal;
    },
    [isIdMode],
  );

  return {
    internalValue,
    isLoading,
    toExternalValue,
  };
}
