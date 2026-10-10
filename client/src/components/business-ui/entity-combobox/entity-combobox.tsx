'use client';

/**
 * EntityCombobox: the state container for the generic combobox. Owns the
 * controlled/uncontrolled selection, open state, debounced search text, and data
 * fetching, and exposes all of it through the context provider to descendant
 * trigger/popover subcomponents.
 * Part of the vendored business-ui component library.
 */
import { useCallback, useState } from 'react';
import { useControllableState } from 'radix-ui/internal';

import { EntityComboboxProvider } from '@client/src/components/business-ui/entity-combobox/context';
import { useDebounce } from '@client/src/components/business-ui/entity-combobox/hooks';
import type {
  EntityComboboxProps,
  ItemValue,
} from '@client/src/components/business-ui/entity-combobox/types';
import { useFetchData } from '@client/src/components/business-ui/entity-combobox/use-fetch-data';

/** Provides combobox selection/open/search state and data-fetching to descendants. */
export function EntityCombobox<
  T = unknown,
  TRaw = unknown,
  TValue extends ItemValue<TRaw> = ItemValue<TRaw>,
>(props: EntityComboboxProps<T, TRaw, TValue>) {
  const {
    fetchFn,
    size = 'medium',
    multiple = false,
    value: valueProp,
    defaultValue,
    onChange,
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    debounce = 300,
    disabled = false,
    onSelect,
    onDeselect,
    onSearch,
    onClear,
    children,
    getItemValue,
  } = props;

  // Controlled/uncontrolled selection state.
  const [selectedValue, setSelectedValue] = useControllableState({
    prop: valueProp,
    defaultProp: defaultValue ?? (!multiple ? null : []),
    onChange,
  });

  const [searchValue, setSearchValue] = useState('');
  const debouncedSearch = useDebounce(searchValue, debounce);

  // Wrap onOpenChange to clear the search text when the dropdown closes.
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setSearchValue('');
      }
      onOpenChange?.(newOpen);
    },
    [onOpenChange],
  );

  const [open, setOpen] = useControllableState({
    prop: openProp,
    defaultProp: defaultOpen,
    onChange: handleOpenChange,
  });

  // Fetch data through the dedicated hook.
  const { data, isFetching, isError, isSuccess, fetchStatus, refetch } =
    useFetchData<T>({
      fetchFn,
      enabled: open,
      search: debouncedSearch,
      onSearch,
    });

  // Selection logic.
  const handleSelect = useCallback(
    (itemValue: TValue) => {
      if (!multiple) {
        setSelectedValue(itemValue);
        setOpen(false);
        onSelect?.(itemValue);
      } else {
        const current = Array.isArray(selectedValue) ? selectedValue : [];
        const isSelected = current.some((v) => v.id === itemValue.id);

        if (isSelected) {
          const newValue = current.filter((v) => v.id !== itemValue.id);
          setSelectedValue(newValue);
          onDeselect?.(itemValue);
        } else {
          const newValue = [...current, itemValue];
          setSelectedValue(newValue);
          onSelect?.(itemValue);
        }
      }
    },
    [multiple, selectedValue, setSelectedValue, setOpen, onSelect, onDeselect],
  );

  const handleDeselect = useCallback(
    (itemValue: TValue) => {
      if (multiple && Array.isArray(selectedValue)) {
        const newValue = selectedValue.filter((v) => v.id !== itemValue.id);
        setSelectedValue(newValue);
        onDeselect?.(itemValue);
      }
    },
    [multiple, selectedValue, setSelectedValue, onDeselect],
  );

  const handleClear = useCallback(() => {
    setSelectedValue(!multiple ? null : []);
    onClear?.();
  }, [multiple, setSelectedValue, onClear]);

  // Value exposed through the context provider.
  const contextValue = {
    open,
    setOpen,
    searchValue,
    setSearchValue,
    selectedValue: selectedValue ?? (!multiple ? null : []),
    debouncedSearch,
    handleSelect,
    handleDeselect,
    handleClear,
    data,
    isFetching,
    isError,
    refetch,
    isSuccess,
    fetchStatus,
    isPlaceholderData: false,
    multiple,
    disabled,
    size,
    getItemValue: getItemValue as (item: unknown) => ItemValue,
  };

  return (
    <EntityComboboxProvider value={contextValue}>
      {children}
    </EntityComboboxProvider>
  );
}
