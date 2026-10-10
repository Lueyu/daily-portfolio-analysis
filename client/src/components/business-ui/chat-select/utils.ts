/**
 * Pure helpers for ChatSelect: internationalized text resolution, conversion from
 * raw ChatInfo to the normalized Chat item, unknown-chat placeholders, and value/ID
 * extraction utilities.
 * Part of the vendored business-ui component library.
 */
import type { Chat, ChatInfo, ChatSelectValue, I18nText } from './types';

/** Resolves the display value of an internationalized text (standalone implementation). */
function getI18nText(text: I18nText | string | undefined): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  return text.zh_cn || text.en_us || text.ja_jp || '';
}

/** Returns the display name for a chat. */
export function getChatDisplayName(name: ChatInfo['name']): string {
  return getI18nText(name);
}

/** Normalizes a raw ChatInfo into a Chat item used by BaseCombobox. */
export function chatInfoToChat(chatInfo: ChatInfo): Chat {
  return {
    id: chatInfo.chatID,
    name: getChatDisplayName(chatInfo.name),
    avatar: chatInfo.avatar,
    raw: chatInfo,
  };
}

/** Creates an "unknown chat" placeholder for an ID that cannot be resolved. */
export function createUnknownChat(id: string): Chat {
  return {
    id,
    name: '未知群组',
    avatar: '',
    raw: undefined,
  };
}

/** Returns whether the value is in ID mode (a string or string array). */
export function isIdModeValue(
  value: ChatSelectValue,
): value is string | string[] {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return true;
  }
  if (Array.isArray(value) && value.length > 0) {
    return typeof value[0] === 'string';
  }
  return false;
}

/** Extracts the list of chat IDs from a value (string or Chat object shape). */
export function extractIdsFromValue(value: ChatSelectValue): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [];
    }
    if (typeof value[0] === 'string') {
      return value as string[];
    }
    return (value as Chat[]).map((c) => c.id);
  }
  return [(value as Chat).id];
}
