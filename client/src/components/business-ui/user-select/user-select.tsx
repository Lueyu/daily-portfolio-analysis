'use client';

/**
 * UserSelect: a searchable single/multi user picker built on BaseCombobox. Supports
 * controlled/uncontrolled values in either ID-string or User-object form, and handles
 * on-the-fly account activation ("opening") for unregistered external contacts —
 * converting them and reflecting the converted user back into the list.
 * Part of the vendored business-ui component library.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  searchUsers,
  convertExternalContact,
  type AccountType,
} from '@client/src/components/business-ui/api/users/service';
import { BaseCombobox } from '@client/src/components/business-ui/entity-combobox/base-combobox';
import { useEntityComboboxContext } from '@client/src/components/business-ui/entity-combobox/context';
import type {
  UserSelectItemValue,
  UserSelectProps,
} from '@client/src/components/business-ui/user-select/types';
import { useUserValue } from '@client/src/components/business-ui/user-select/use-user-value';
import { UserItem } from '@client/src/components/business-ui/user-select/user-item';
import { UserSelectTag } from '@client/src/components/business-ui/user-select/user-select-tag';
import {
  searchUserInfoToUser,
  isUnregisteredExternalContact,
} from '@client/src/components/business-ui/user-select/utils';

/** Builds the fetchFn that searches users and maps results to normalized items. */
function createUsersFetcher(options: { accountType?: AccountType; pageSize?: number } = {}) {
  const { accountType = 'apaas', pageSize = 100 } = options;

  return async (search: string) => {
    const response = await searchUsers({ query: search, pageSize });
    const userList = response?.data?.userList || [];

    return {
      items: userList.map((user) => searchUserInfoToUser(user, accountType)),
    };
  };
}

// Internal wrapper that reads size from the combobox context.
const UserItemWrapper = ({
  userValue,
  isSelected,
  className,
  disabled,
  isConverting,
}: {
  userValue: UserSelectItemValue;
  isSelected: boolean;
  className?: string;
  disabled?: boolean;
  isConverting?: boolean;
}) => {
  const { size, searchValue } = useEntityComboboxContext();
  return (
    <UserItem
      userValue={userValue}
      isSelected={isSelected}
      className={className}
      size={size}
      searchKeyword={searchValue}
      disabled={disabled}
      isConverting={isConverting}
    />
  );
};

const UserSelectTagWrapper = ({
  userValue,
  onClose,
  className,
  disabled,
  isLoading,
  accountType,
}: {
  userValue: UserSelectItemValue;
  onClose: (value: UserSelectItemValue, e: React.MouseEvent) => void;
  className?: string;
  disabled?: boolean;
  isLoading?: boolean;
  accountType?: 'apaas' | 'lark';
}) => {
  const { size } = useEntityComboboxContext();
  return (
    <UserSelectTag
      userValue={userValue}
      onClose={onClose}
      className={className}
      size={size}
      disabled={disabled}
      isLoading={isLoading}
      accountType={accountType}
    />
  );
};

/** Renders the UserSelect component: a searchable single/multi user picker. */
export const UserSelect: React.FC<UserSelectProps> = (props) => {
  const {
    size = 'medium',
    triggerType = 'button',
    renderTrigger,
    multiple = false,
    value,
    valueType = 'string',
    accountType = 'apaas',
    defaultValue,
    onChange,
    defaultOpen,
    disabled,
    autoFocus,
    required,
    name,
    className,
    classNames,
    placeholder = '请选择',
    emptyText = '没有匹配结果，换个关键词试试吧',
    tagClosable,
    maxTagCount,
    onSelect,
    onDeselect,
    onClear,
    onFocus,
    onBlur,
    slotProps,
    getOptionDisabled,
  } = props;

  // Use useUserValue to handle the different value types (including defaultValue).
  const { internalValue, isLoading, toExternalValue } = useUserValue(
    value ?? null,
    multiple,
    accountType,
    valueType,
  );

  // Always track the latest internalValue so async account-open callbacks don't
  // capture a stale value in their closure.
  const internalValueRef = useRef(internalValue);
  internalValueRef.current = internalValue;

  // Process defaultValue the same way so ID-string defaults also resolve correctly.
  const { internalValue: internalDefaultValue } = useUserValue(
    defaultValue ?? null,
    multiple,
    accountType,
    valueType,
  );

  const baseFetchFn = useMemo(() => createUsersFetcher({ accountType }), [accountType]);

  // IDs of users currently being opened (account activation in flight).
  const [convertingSet, setConvertingSet] = useState<Set<string>>(() => new Set());

  // Already-opened users: old ID -> converted UserSelectItemValue, written back into the candidate list.
  const [convertedMap, setConvertedMap] = useState<Map<string, UserSelectItemValue>>(
    () => new Map(),
  );

  // Wrap fetchFn to substitute converted users into search results.
  // convertedMap change -> fetchFn reference change -> useFetchData refetches automatically.
  const fetchFn = useCallback(
    async (search: string) => {
      const result = await baseFetchFn(search);
      if (convertedMap.size === 0) return result;
      return {
        ...result,
        items: result.items.map((item) => convertedMap.get(item.id) ?? item),
      };
    },
    [baseFetchFn, convertedMap],
  );

  // Marks whether a user is about to be opened (used to block closing in handleOpenChange).
  // Timing: handleChange (sets the flag) -> handleOpenChange (checks it) -> handleSelect (starts opening).
  const pendingConvertRef = useRef(false);

  // Controlled open state: keep the popover open while an account is being activated.
  const [open, setOpen] = useState(defaultOpen ?? false);
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    // Do not allow closing the dropdown while an account is being opened or about to open.
    if (!nextOpen && pendingConvertRef.current) return;
    setOpen(nextOpen);
  }, []);

  // Users being opened cannot be clicked again.
  const mergedGetOptionDisabled = useCallback(
    (option: UserSelectItemValue) => {
      if (convertingSet.has(option.id)) return true;
      if (isUnregisteredExternalContact(option)) return false;
      return getOptionDisabled?.(option) ?? false;
    },
    [getOptionDisabled, convertingSet],
  );

  /**
   * onChange gate: filters out unregistered external contacts so they never enter the
   * selected list. Also sets pendingConvertRef to stop handleOpenChange from closing.
   */
  const handleChange = useCallback(
    (newValue: UserSelectItemValue | UserSelectItemValue[] | null) => {
      if (!onChange) return;

      if (multiple && Array.isArray(newValue)) {
        const hasUnregistered = newValue.some((u) => isUnregisteredExternalContact(u));
        if (hasUnregistered) {
          pendingConvertRef.current = true;
        }
        const filtered = newValue.filter((u) => !isUnregisteredExternalContact(u));
        const externalValue = toExternalValue(filtered, multiple);
        (onChange as (value: unknown) => void)(externalValue);
      } else if (!multiple) {
        const user = newValue as UserSelectItemValue | null;
        if (user && isUnregisteredExternalContact(user)) {
          // Never let an unregistered user enter the selected value; mark it as about-to-open.
          pendingConvertRef.current = true;
          return;
        }
        const externalValue = toExternalValue(newValue, multiple);
        (onChange as (value: unknown) => void)(externalValue);
      }
    },
    [onChange, multiple, toExternalValue],
  );

  /**
   * onSelect interceptor: detects unregistered external contacts and kicks off the
   * account-activation flow. On success it calls onChange with the converted user.
   */
  const handleSelect = useCallback(
    (user: UserSelectItemValue) => {
      if (!isUnregisteredExternalContact(user)) {
        onSelect?.(user);
        return;
      }

      const larkUserID = user.raw?.larkUserId;
      if (!larkUserID) return;
      if (convertingSet.has(user.id)) return;

      setConvertingSet((prev) => new Set(prev).add(user.id));
      // pendingConvertRef was already set in handleChange; now it enters the active opening state.

      void (async () => {
        try {
          const result = await convertExternalContact(larkUserID);
          const { userInfo } = result.data;
          const forceUserID = String(userInfo.userID);
          const convertedUser: UserSelectItemValue = {
            ...user,
            id: forceUserID,
            raw: user.raw ? { ...user.raw, user_id: forceUserID } : undefined,
          };

          // Write back into the candidate list: trigger a fetchFn reference change ->
          // useFetchData refetches -> list updates.
          setConvertedMap((prev) => new Map(prev).set(user.id, convertedUser));

          onSelect?.(convertedUser);
          if (onChange) {
            if (multiple) {
              const current = Array.isArray(internalValueRef.current)
                ? internalValueRef.current
                : [];
              const externalValue = toExternalValue([...current, convertedUser], multiple);
              (onChange as (value: unknown) => void)(externalValue);
            } else {
              const externalValue = toExternalValue(convertedUser, multiple);
              (onChange as (value: unknown) => void)(externalValue);
            }
          }
          // Close the dropdown after opening succeeds (single-select).
          if (!multiple) {
            pendingConvertRef.current = false;
            setOpen(false);
          }
        } catch {
          toast.error('外部用户添加失败');
        } finally {
          setConvertingSet((prev) => {
            const next = new Set(prev);
            next.delete(user.id);
            // Clear the flag once all openings have finished.
            if (next.size === 0) {
              pendingConvertRef.current = false;
            }
            return next;
          });
        }
      })();
    },
    [onSelect, onChange, multiple, toExternalValue, convertingSet],
  );

  const renderTagWithLoading = useCallback(
    (
      userValue: UserSelectItemValue,
      onClose: (value: UserSelectItemValue, e: React.MouseEvent) => void,
      tagDisabled?: boolean,
    ) => (
      <UserSelectTagWrapper
        key={userValue.id}
        userValue={userValue}
        onClose={onClose}
        disabled={tagDisabled}
        isLoading={isLoading}
        accountType={accountType}
      />
    ),
    [isLoading, accountType],
  );

  return (
    <BaseCombobox
      autoFocus={autoFocus}
      className={className}
      classNames={classNames}
      debounce={300}
      open={open}
      onOpenChange={handleOpenChange}
      defaultValue={internalDefaultValue}
      disabled={disabled}
      emptyText={emptyText}
      fetchFn={fetchFn}
      getItemLabel={(userValue) => userValue.name}
      getItemValue={(userValue) => userValue}
      getOptionDisabled={mergedGetOptionDisabled}
      maxTagCount={maxTagCount}
      multiple={multiple}
      name={name}
      onBlur={onBlur}
      onChange={handleChange}
      onClear={onClear}
      onDeselect={onDeselect}
      onFocus={onFocus}
      onSelect={handleSelect}
      placeholder={placeholder}
      renderItem={(userValue, isSelected, itemClassName, itemDisabled) => (
        <UserItemWrapper
          key={userValue.id}
          userValue={userValue}
          isSelected={isSelected}
          className={itemClassName}
          disabled={itemDisabled}
          isConverting={convertingSet.has(userValue.id)}
        />
      )}
      renderTag={renderTagWithLoading}
      renderTrigger={renderTrigger}
      required={required}
      searchPlaceholder=""
      showSearch
      size={size}
      slotProps={slotProps}
      tagClosable={tagClosable}
      triggerType={triggerType}
      value={internalValue}
    />
  );
};

export { type UserSelectItemValue as UserValue };

export { ItemPill } from '@client/src/components/business-ui/entity-combobox/item-pill';
