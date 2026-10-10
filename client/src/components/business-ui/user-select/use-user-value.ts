'use client';

/**
 * useUserValue: normalizes UserSelect's external value into the UserSelectItemValue
 * objects expected by BaseCombobox. In ID mode it fetches full user metadata (via
 * react-query cache), creates "unknown user" placeholders for unresolved IDs, and
 * converts internal values back to the external string/User shape on change.
 * Part of the vendored business-ui component library.
 */
import { useCallback, useMemo } from 'react';

import { useUsersByIds } from '@client/src/components/business-ui/api/users/queries';
import type {
  AccountType,
  UserSelectItemValue,
  UserSelectValue,
  ValueType,
} from '@client/src/components/business-ui/user-select/types';
import {
  extractIdsFromValue,
  userInfoToUser,
  createUnknownUser,
} from '@client/src/components/business-ui/user-select/utils';
import { getI18nText } from '@client/src/components/business-ui/utils/user';
import type { User } from '@client/src/components/business-ui/types/user';

/** Converts a User into a normalized UserSelectItemValue. */
function userToItemValue(user: User, accountType: AccountType): UserSelectItemValue {
  return {
    id: accountType === 'lark' ? (user.larkUserId || user.user_id || '') : (user.user_id || user.larkUserId || ''),
    name: getI18nText(user.name) || '未知用户',
    avatar: user.avatar,
    raw: user,
  };
}

/** Return value of useUserValue. */
export type UseUserValueResult = {
  /**
   * Normalized internal value (UserSelectItemValue object format), passed to BaseCombobox.
   */
  internalValue: UserSelectItemValue | UserSelectItemValue[] | null;

  /**
   * Whether user info is still loading.
   */
  isLoading: boolean;

  /**
   * Converts the internal UserSelectItemValue objects back to the external shape:
   * a string/string[] in ID mode, or the raw User object(s) in object mode.
   */
  toExternalValue: (
    internalVal: UserSelectItemValue | UserSelectItemValue[] | null,
    multiple: boolean,
  ) => UserSelectValue;
};

/**
 * Handles value-type conversion for UserSelect.
 *
 * - valueType decides whether value is an ID string or a UserSelectItemValue object.
 * - In ID mode it fetches full user info (cached via react-query).
 * - Invalid IDs get an "unknown user" placeholder.
 *
 * @param value - The externally provided value.
 * @param multiple - Whether multi-select mode is enabled.
 * @param accountType - The account type.
 * @param valueType - 'string' for ID mode, 'object' for object mode.
 */
export function useUserValue(
  value: UserSelectValue,
  multiple: boolean = false,
  accountType: AccountType = 'apaas',
  valueType: ValueType = 'string',
): UseUserValueResult {
  const isIdMode = valueType === 'string';

  // Extract all IDs from the current value.
  const currentIds = useMemo(() => extractIdsFromValue(value), [value]);

  // IDs to fetch in ID mode (deduplicated and sorted so an identical ID set yields the same queryKey).
  const idsToFetch = useMemo(() => {
    if (!isIdMode) return [];
    return [...new Set(currentIds.map(String))].filter(Boolean).sort();
  }, [isIdMode, currentIds]);

  // Fetch user info via the react-query hook.
  const { data: response, isLoading } = useUsersByIds(idsToFetch, accountType);

  // Build an ID -> UserSelectItemValue lookup map.
  const usersMap = useMemo(() => {
    const map = new Map<string, UserSelectItemValue>();
    const userInfoMap = response?.data?.userInfoMap || {};

    for (const id of idsToFetch) {
      const userInfo = userInfoMap[id];
      const user = userInfo
        ? userInfoToUser(userInfo, accountType)
        : createUnknownUser(id);
      map.set(String(id), user);
    }
    return map;
  }, [response, idsToFetch, accountType]);

  const internalValue = useMemo((): UserSelectItemValue | UserSelectItemValue[] | null => {
    if (value === null || value === undefined) {
      return multiple ? [] : null;
    }

    if (Array.isArray(value) && value.length === 0) {
      return [];
    }

    if (!isIdMode) {
      // Object mode: convert User into UserSelectItemValue.
      if (Array.isArray(value)) {
        return (value as User[]).map((user) => userToItemValue(user, accountType));
      }
      return userToItemValue(value as User, accountType);
    }

    const users = currentIds
      .map((id) => usersMap.get(String(id)))
      .filter((u): u is UserSelectItemValue => u !== undefined);

    if (multiple) {
      return users;
    }

    return users[0] ?? null;
  }, [value, isIdMode, currentIds, usersMap, multiple, accountType]);

  const toExternalValue = useCallback(
    (
      internalVal: UserSelectItemValue | UserSelectItemValue[] | null,
      isMultiple: boolean,
    ): UserSelectValue => {
      if (internalVal === null) {
        return null;
      }

      if (isIdMode) {
        // ID mode: return string or string[].
        if (isMultiple) {
          return (internalVal as UserSelectItemValue[]).map((u) => String(u.id));
        }
        return String((internalVal as UserSelectItemValue).id);
      }

      // Object mode: extract the raw data and return the standard User type.
      if (isMultiple) {
        return (internalVal as UserSelectItemValue[]).map((u) => u.raw!);
      }
      return (internalVal as UserSelectItemValue).raw!;
    },
    [isIdMode],
  );

  return {
    internalValue,
    isLoading,
    toExternalValue,
  };
}
