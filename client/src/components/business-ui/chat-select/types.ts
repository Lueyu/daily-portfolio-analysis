/**
 * Shared type definitions for ChatSelect: raw chat info, the normalized chat
 * item, value-mode discriminators, and the discriminated union of component props.
 * Part of the vendored business-ui component library.
 */
import type {
  BaseEntitySelectProps,
  ItemValue,
} from '@client/src/components/business-ui/entity-combobox/shared-types';
import type { I18nText } from '@client/src/components/business-ui/entity-combobox/types';

export type { I18nText };

/** Raw chat info as returned by the search API (corresponds to SearchChatEntity). */
export type ChatInfo = {
  /** Chat ID. */
  chatID: string;
  /** Chat name (internationalized text). */
  name: I18nText;
  /** Avatar: an image URL or a hex RGB color. */
  avatar: string;
  /** Whether this is an external chat. */
  isExternal?: boolean;
  /** Number of members in the chat (excluding bots). */
  userCount?: number;
};

/** Normalized chat item used internally by BaseCombobox. */
export type Chat = ItemValue<ChatInfo>;

/**
 * External value mode.
 * - 'string': value is a chatID string
 * - 'object': value is a Chat object
 * @default 'string'
 */
export type ValueType = 'string' | 'object';

/** Infers the external value type from valueType and multiple flags. */
export type InferValue<
  V extends ValueType,
  M extends boolean,
> = V extends 'string'
  ? M extends true
    ? string[]
    : string | null
  : M extends true
    ? Chat[]
    : Chat | null;

type ChatSelectBaseProps<
  V extends ValueType = 'string',
  M extends boolean = false,
> = Omit<
  BaseEntitySelectProps<Chat>,
  'value' | 'defaultValue' | 'onChange'
> & {
  /**
   * External value mode.
   * - 'string': value is a chatID string
   * - 'object': value is a Chat object
   * @default 'string'
   */
  valueType?: V;
  /**
   * Whether multi-select is enabled.
   * @default false
   */
  multiple?: M;
  /**
   * Current controlled value.
   */
  value?: InferValue<V, M>;
  /**
   * Uncontrolled default value.
   */
  defaultValue?: InferValue<V, M>;
  /**
   * Callback fired when the value changes.
   */
  onChange?: (value: InferValue<V, M>) => void;
};

/**
 * ChatSelect component props.
 *
 * Type combinations:
 * | valueType | multiple | value type |
 * |-----------|----------|------------|
 * | 'string'  | false    | string \| null |
 * | 'string'  | true     | string[] |
 * | 'object'  | false    | Chat \| null |
 * | 'object'  | true     | Chat[] |
 */
export type ChatSelectProps =
  | ChatSelectBaseProps<'string', false>
  | ChatSelectBaseProps<'string', true>
  | ChatSelectBaseProps<'object', false>
  | ChatSelectBaseProps<'object', true>;

export type ChatSelectValue = Chat | Chat[] | string | string[] | null;
