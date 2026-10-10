/**
 * Props and context-value types for the EntityCombobox state container and
 * BaseCombobox, plus the i18n text shape. Re-exports the shared value/trigger types.
 * Part of the vendored business-ui component library.
 */
import type { ReactNode } from 'react';

import type {
  ClassNamesConfig,
  ComboboxSize,
  ItemValue,
  PopoverSlotProps,
  TriggerRenderProps,
  TriggerType,
} from '@client/src/components/business-ui/entity-combobox/shared-types';

// Re-export the shared types.
export type {
  ItemValue,
  TriggerType,
  TriggerRenderProps,
  ClassNamesConfig,
  PopoverSlotProps,
  ComboboxSize,
};

/** Props for the EntityCombobox state container. */
export type EntityComboboxProps<
  T = unknown,
  TRaw = unknown,
  TValue extends ItemValue<TRaw> = ItemValue<TRaw>,
> = {
  // Size
  size?: ComboboxSize;

  // Data fetching
  fetchFn: (search: string) => Promise<{ items: T[] }>;

  // Controlled / uncontrolled value
  multiple?: boolean;
  value?: TValue | TValue[] | null;
  defaultValue?: TValue | TValue[] | null;
  onChange?: (value: TValue | TValue[] | null) => void;

  // Popover open state
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;

  // Configuration
  pageSize?: number;
  debounce?: number;
  disabled?: boolean;

  // Callbacks
  onSelect?: (value: TValue) => void;
  onDeselect?: (value: TValue) => void;
  onSearch?: (value: string) => void;
  onClear?: () => void;

  children: ReactNode;

  // Item -> value conversion
  getItemValue: (item: T) => TValue;
};

/** Value exposed through the EntityCombobox context provider. */
export type EntityComboboxContextValue<
  T = unknown,
  TRaw = unknown,
  TValue extends ItemValue<TRaw> = ItemValue<TRaw>,
> = {
  // State
  open: boolean;
  setOpen: (open: boolean) => void;
  searchValue: string;
  setSearchValue: (value: string) => void;
  selectedValue: TValue | TValue[] | null;
  debouncedSearch: string;

  // Actions
  handleSelect: (value: TValue) => void;
  handleDeselect: (value: TValue) => void;
  handleClear: () => void;

  // Data
  data: T[];
  isFetching: boolean;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;

  // Configuration
  multiple: boolean;
  disabled: boolean;
  size: ComboboxSize;
  isSuccess?: boolean;
  fetchStatus?: string;
  isPlaceholderData?: boolean;

  // Item -> value conversion
  getItemValue: (item: T) => TValue;
};

/** Props for the BaseCombobox public component. */
export type BaseComboboxProps<
  T = unknown,
  TRaw = unknown,
  TValue extends ItemValue<TRaw> = ItemValue<TRaw>,
> = {
  // Size
  size?: ComboboxSize;

  // Data fetching
  fetchFn: (search: string) => Promise<{ items: T[] }>;

  // Trigger
  triggerType?: TriggerType;
  renderTrigger?: (props: TriggerRenderProps<TRaw>) => ReactNode;

  // Controlled / uncontrolled value
  multiple?: boolean;
  value?: TValue | TValue[] | null;
  defaultValue?: TValue | TValue[] | null;
  onChange?: (value: TValue | TValue[] | null) => void;

  // Popover open state
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;

  // Configuration
  debounce?: number;
  disabled?: boolean;
  showSearch?: boolean;
  autoFocus?: boolean;
  required?: boolean;
  name?: string;

  // Renderers
  renderItem: (
    item: T,
    isSelected: boolean,
    className?: string,
    disabled?: boolean,
  ) => ReactNode;
  renderTag?: (
    value: TValue,
    onClose: (value: TValue, e: React.MouseEvent) => void,
    disabled?: boolean,
  ) => ReactNode;
  /**
   * Returns whether an option should be disabled.
   * @param value The option value.
   * @returns If true, the option is disabled.
   */
  getOptionDisabled?: (value: TValue) => boolean;
  getItemLabel?: (item: T) => string;

  // Placeholders
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loadingText?: string;

  // Styling
  className?: string;
  classNames?: ClassNamesConfig;

  // Tags (multi-select)
  tagClosable?: boolean;
  maxTagCount?: number | 'responsive';
  maxTagTextLength?: number;

  // Popover placement
  placement?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;

  // Callbacks
  onSelect?: (value: TValue) => void;
  onDeselect?: (value: TValue) => void;
  onSearch?: (value: string) => void;
  onClear?: () => void;
  onFocus?: (event: React.FocusEvent<HTMLElement>) => void;
  onBlur?: (event: React.FocusEvent<HTMLElement>) => void;

  // Item -> value conversion
  getItemValue?: (item: T) => TValue;

  slotProps?: PopoverSlotProps;
  children?: ReactNode;
};

/** Props for the PopoverWrapper. */
export type PopoverWrapperProps<
  T = unknown,
  TRaw = unknown,
  TValue extends ItemValue<TRaw> = ItemValue<TRaw>,
> = {
  size?: ComboboxSize;
  triggerType?: TriggerType;
  renderTrigger?: (props: TriggerRenderProps<TRaw>) => ReactNode;
  placeholder?: string;
  maxTagCount?: number | 'responsive';
  maxTagTextLength?: number;
  tagClosable?: boolean;
  className?: string;
  classNames?: ClassNamesConfig;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  showSearch?: boolean;
  searchPlaceholder?: string;
  renderItem: (
    item: T,
    isSelected: boolean,
    className?: string,
    disabled?: boolean,
  ) => ReactNode;
  renderTag?: (
    value: TValue,
    onClose: (value: TValue, e: React.MouseEvent) => void,
    disabled?: boolean,
  ) => ReactNode;
  getItemValue: (item: T) => TValue;
  getOptionDisabled?: (value: TValue) => boolean;
  emptyText?: string;
  loadingText?: string;
  onFocus?: (event: React.FocusEvent<HTMLElement>) => void;
  onBlur?: (event: React.FocusEvent<HTMLElement>) => void;
  slotProps?: PopoverSlotProps;
  children?: ReactNode;
};

/** Internationalized text shape (Chinese primary, English/Japanese optional). */
export type I18nText = {
  zh_cn: string;
  en_us?: string;
  ja_jp?: string;
};
