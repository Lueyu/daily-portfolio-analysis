/**
 * UserSelect helpers: display-name/ID resolution, raw API user info to normalized
 * UserSelectItemValue converters, unregistered-external-contact detection, appId
 * extraction from the URL, and ID extraction from arbitrary value shapes.
 * Part of the vendored business-ui component library.
 */
import type { UserInfo, SearchAvatar } from '@lark-apaas/client-toolkit/tools/services';

import type { AccountType } from '@client/src/components/business-ui/api/users/service';
import type {
  UserSelectItemValue,
  UserSelectValue,
} from '@client/src/components/business-ui/user-select/types';
import { getI18nText } from '@client/src/components/business-ui/utils/user';
import type { User } from '@client/src/components/business-ui/types/user';

/** Picks the best available display name from a multilingual UserInfo name. */
export function getUserDisplayName(name: UserInfo['name']): string {
  return name.zh_cn || name.en_us || '';
}

/** Resolves the canonical user ID for the given account type, falling back to a generated placeholder. */
export function getUserId(
  user: Pick<UserInfo, 'userID' | 'larkUserID'>,
  accountType: AccountType,
): string {
  if (accountType === 'lark') {
    return user.larkUserID || `_unknown_${Math.random().toString(36).slice(2)}`;
  }
  // Unregistered external contacts have no userID; use larkUserID as a temporary identifier.
  return user.userID || user.larkUserID || `_unknown_${Math.random().toString(36).slice(2)}`;
}

/**
 * Returns whether the given item is an unregistered external contact
 * (has larkUserId but no user_id).
 */
export function isUnregisteredExternalContact(user: UserSelectItemValue): boolean {
  const raw = user.raw;
  return !!raw && !raw.user_id && !!raw.larkUserId;
}

/** Creates a placeholder item for an unknown/unresolved user ID. */
export function createUnknownUser(id: string): UserSelectItemValue {
  return {
    id,
    name: '未知用户',
    avatar: undefined,
    raw: undefined,
  };
}

/** Converts a raw by-ID user-info response into a normalized UserSelectItemValue. */
export function userInfoToUser(
  userInfo: UserInfo & SearchAvatar,
  accountType: AccountType,
): UserSelectItemValue {
  // Build the canonical User object as the raw data.
  const rawUser: User = {
    user_id: userInfo.userID || undefined,
    larkUserId: userInfo.larkUserID || undefined,
    name: userInfo.name,
    avatar: userInfo.avatar?.image?.large,
    user_type: userInfo.userType,
    department: userInfo.department as any,
  };

  return {
    id: getUserId(userInfo, accountType),
    name: getI18nText(userInfo.name),
    avatar: userInfo.avatar?.image?.large,
    raw: rawUser,
  };
}

/** Converts a raw search-result user info into a normalized UserSelectItemValue. */
export function searchUserInfoToUser(
  userInfo: UserInfo & { avatar?: string; tenantName?: string },
  accountType: AccountType,
): UserSelectItemValue {
  // Build the canonical User object as the raw data.
  const rawUser: User = {
    user_id: userInfo.userID || undefined,
    larkUserId: userInfo.larkUserID || undefined,
    name: userInfo.name,
    avatar: userInfo.avatar,
    user_type: userInfo.userType,
    department: userInfo.department as any,
    tenantName: userInfo.tenantName,
  };

  return {
    id: getUserId(userInfo, accountType),
    name: getI18nText(userInfo.name),
    avatar: userInfo.avatar,
    raw: rawUser,
  };
}

declare global {
  interface Window {
    MIAODA_APP_ID?: string;
    __platform__?: {
      appId?: string;
    };
    appId?: string;
  }
}

/** Resolves the current appId from window globals or by parsing the URL path. */
export function getAppId(path: string): string | null | undefined {
  if (window?.__platform__?.appId) {
    return window.__platform__.appId;
  }

  if (window.MIAODA_APP_ID) {
    return window.MIAODA_APP_ID;
  }

  let prefix: string;

  /**
   * Extract appId from the path.
   * @example "/app/my-app/settings" → "my-app"
   */
  const appMatch = path.match(/\/app\/([^/]+)/);
  if (appMatch) {
    return appMatch[1];
  }

  // Check which fixed prefix the path starts with.
  if (path.includes('/ai/feida/runtime/')) {
    prefix = '/ai/feida/runtime/';
  } else if (path.includes('/spark/r/')) {
    prefix = '/spark/r/';
  } else {
    prefix = '/ai/miaoda/';
  }

  // Fall back to the full-stack appId mounted on window.
  const windowAppId = window.appId || null;

  if (!path.startsWith(prefix)) {
    return windowAppId;
  }

  // Take the part after the prefix.
  const remainder = path.substring(prefix.length);

  // Find the next slash.
  const nextSlashIndex = remainder.indexOf('/');

  // If there is no slash, return the whole remainder; otherwise return the segment before it.
  if (nextSlashIndex === -1) {
    return remainder || windowAppId;
  }
  return remainder.substring(0, nextSlashIndex) || windowAppId;
}

/**
 * Extracts the list of IDs from a value, supporting User (user_id) and
 * UserSelectItemValue (id) shapes, single or array.
 */
export function extractIdsFromValue(value: UserSelectValue): string[] {
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
    // Inspect the first element to determine the type.
    if (typeof value[0] === 'string') {
      return value as string[];
    }
    // Array of objects: could be User[] or UserSelectItemValue[].
    return value.map((item: any) => {
      // UserSelectItemValue has an id field (internal type).
      if ('id' in item && item.id) {
        return item.id;
      }
      // User has a user_id field (external type).
      if ('user_id' in item && item.user_id) {
        return item.user_id;
      }
      return '';
    }).filter(Boolean);
  }
  // Single object: could be User or UserSelectItemValue.
  const item = value as any;
  if ('id' in item && item.id) {
    return [item.id];
  }
  if ('user_id' in item && item.user_id) {
    return [item.user_id];
  }
  return [];
}
