/**
 * Shared type definitions for the generic combobox and the entity selectors built
 * on it (UserSelect, DepartmentSelect, ChatSelect): the normalized option value,
 * trigger types, className configuration, popover slot props, and the base props
 * common to all entity select components.
 * Part of the vendored business-ui component library.
 */
import type { FocusEvent, ReactNode } from 'react';

import { PopoverContent } from '@client/src/components/ui/popover';

// Re-export the size type shared across combobox internals.
export type { ComboboxSize } from '@client/src/components/business-ui/entity-combobox/size-variants';

/**
 * Normalized option value used across the combobox.
 * @template TRaw - Preserves the complete original data object.
 */
export type ItemValue<TRaw = unknown> = {
  id: string;
  name: string;
  avatar?: string;
  raw?: TRaw;
};

/** Trigger presentation style. */
export type TriggerType = 'button' | 'search' | 'custom';

/** Props passed to a custom trigger renderer. */
export type TriggerRenderProps<TRaw = unknown> = {
  selectedValue: ItemValue<TRaw> | ItemValue<TRaw>[] | null;
  multiple: boolean;
  open: boolean;
  disabled: boolean;
};

/**
 * ClassName configuration: centrally sets custom class names for internal elements.
 */
export type ClassNamesConfig = {
  /** Class name for the root container. */
  root?: string;
  /** Class name for the trigger. */
  trigger?: string;
  /** Class name for the popover content. */
  popover?: string;
  /** Class name for the search input. */
  search?: string;
  /** Class name for the list container. */
  list?: string;
  /** Class name for list items. */
  listItem?: string;
  /** Class name for tags (multi-select mode). */
  tag?: string;
  /** Class name for the empty state. */
  empty?: string;
  /** Class name for the error state. */
  error?: string;
  /** Class name for the loading state. */
  loading?: string;
  /** Class name for the clear button. */
  clear?: string;
  /** Class name for the suffix element. */
  suffix?: string;
};

/** Popover content slot configuration. */
export type PopoverSlotProps = {
  popover?: React.ComponentProps<typeof PopoverContent>;
};

/**
 * Props shared by all entity select components (UserSelect, DepartmentSelect, etc.).
 */
export type BaseEntitySelectProps<TValue = ItemValue<unknown>> = {
  /**
   * Component size.
   * @default "medium"
   */
  size?: 'medium' | 'small' | 'xs';

  /**
   * Trigger type.
   * - "button": button-style trigger
   * - "search": search-box-style trigger
   * - "custom": custom trigger, used together with renderTrigger
   */
  triggerType?: TriggerType;

  /**
   * Custom trigger renderer.
   * @param props - Trigger props: selected value, multiple state, open state, disabled state.
   * @returns A React node for the custom trigger.
   */
  renderTrigger?: (props: TriggerRenderProps<unknown>) => ReactNode;

  /**
   * Whether multi-select mode is enabled.
   * @default false
   */
  multiple?: boolean;

  /**
   * Current value (controlled mode).
   * - Single-select: TValue | null
   * - Multi-select: TValue[] | null
   */
  value?: TValue | TValue[] | null;

  /**
   * Default value (uncontrolled mode).
   * - Single-select: TValue | null
   * - Multi-select: TValue[] | null
   */
  defaultValue?: TValue | TValue[] | null;

  /**
   * Callback fired when the selected value changes.
   * @param value - The new selected value.
   */
  onChange?: (value: TValue | TValue[] | null) => void;

  /**
   * Whether the popover starts open (uncontrolled mode).
   * @default false
   */
  defaultOpen?: boolean;

  /**
   * Whether the component is disabled.
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether to autofocus.
   * @default false
   */
  autoFocus?: boolean;

  /**
   * Whether the field is required (used for form validation).
   * @default false
   */
  required?: boolean;

  /**
   * Form field name.
   */
  name?: string;

  /**
   * Custom class name for the root element.
   */
  className?: string;

  /**
   * Per-element custom class name configuration.
   * @example
   * classNames={{
   *   root: 'my-root',
   *   trigger: 'my-trigger',
   *   popover: 'my-popover',
   *   tag: 'my-tag',
   * }}
   */
  classNames?: ClassNamesConfig;

  /**
   * Placeholder text shown when nothing is selected.
   */
  placeholder?: string;

  /**
   * Text shown when the option list is empty.
   */
  emptyText?: string;

  /**
   * Whether tags are closable in multi-select mode (show a remove button).
   * @default true
   */
  tagClosable?: boolean;

  /**
   * Maximum number of tags shown in multi-select mode.
   * - number: show at most this many tags, overflow shown as "+N"
   * - "responsive": compute the count from the container width automatically
   */
  maxTagCount?: number | 'responsive';

  /**
   * Returns whether an option should be disabled.
   * @param value The option value.
   * @returns If true, the option is disabled and cannot change selection; selected tags hide the remove button.
   */
  getOptionDisabled?: (value: TValue) => boolean;

  /**
   * Callback fired when an option is selected.
   * @param value - The selected option value.
   */
  onSelect?: (value: TValue) => void;

  /**
   * Callback fired when an option is deselected (multi-select mode).
   * @param value - The deselected option value.
   */
  onDeselect?: (value: TValue) => void;

  /**
   * Callback fired when all selected values are cleared.
   */
  onClear?: () => void;

  /**
   * Callback fired when the component receives focus.
   * @param event - The focus event object.
   */
  onFocus?: (event: FocusEvent<HTMLElement>) => void;

  /**
   * Callback fired when the component loses focus.
   * @param event - The focus event object.
   */
  onBlur?: (event: FocusEvent<HTMLElement>) => void;

  /**
   * Slot props to customize internal component props.
   */
  slotProps?: PopoverSlotProps;
};

/** Combobox configuration-related props. */
export type ComboboxConfigProps = {
  pageSize?: number;
  debounce?: number;
  disabled?: boolean;
  loading?: boolean;
  autoFocus?: boolean;
  showSearch?: boolean;
  required?: boolean;
  name?: string;
};

/** Combobox styling-related props. */
export type ComboboxStyleProps = {
  className?: string;
  popoverClassName?: string;
  classNames?: ClassNamesConfig;
};

/** Combobox placeholder-related props. */
export type ComboboxPlaceholderProps = {
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loadingText?: string;
};

/** Combobox tag-related props. */
export type ComboboxTagProps = {
  tagClosable?: boolean;
  maxTagCount?: number | 'responsive';
  maxTagTextLength?: number;
};

/** Combobox popover placement-related props. */
export type ComboboxPopoverProps = {
  placement?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
};

/** Combobox callback-related props. */
export type ComboboxCallbackProps<TRaw = unknown> = {
  onSelect?: (value: ItemValue<TRaw>) => void;
  onDeselect?: (value: ItemValue<TRaw>) => void;
  onSearch?: (value: string) => void;
  onClear?: () => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
};
