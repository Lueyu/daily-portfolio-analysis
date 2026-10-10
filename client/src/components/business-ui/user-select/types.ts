/**
 * Type definitions for UserSelect: value-mode discriminator, the normalized user
 * item, the inferred value type, and the discriminated union of component props.
 * Part of the vendored business-ui component library.
 */
import type {
  BaseEntitySelectProps,
  ItemValue,
} from '@client/src/components/business-ui/entity-combobox/shared-types';
import type { User, I18nText, UserType, Department } from '@client/src/components/business-ui/types/user';

// Import AccountType uniformly from @lark-apaas/client-toolkit.
export type { AccountType } from '@lark-apaas/client-toolkit/tools/services';
import type { AccountType } from '@lark-apaas/client-toolkit/tools/services';

// Re-export the shared types.
export type { User, I18nText, UserType, Department };

/**
 * External value mode.
 * - 'string': value is a string or string[] (driven by multiple)
 * - 'object': value is a User or User[] (driven by multiple)
 * @default 'string'
 */
export type ValueType = 'string' | 'object';

/** Raw avatar shape from the user search API. */
export type SearchAvatar = {
  avatar: {
    image: {
      large: string;
    };
  };
};

/** Normalized user item used by the combobox (wraps a User). */
export type UserSelectItemValue = ItemValue<User>;

/** Infers the external value type from valueType and multiple flags. */
export type InferValue<
  V extends ValueType,
  M extends boolean,
> = V extends 'string'
  ? M extends true
    ? string[]
    : string | null
  : M extends true
    ? User[]              // Returns the standard User type directly.
    : User | null;        // Returns the standard User type directly.

type UserSelectBaseProps<
  V extends ValueType = 'string',
  M extends boolean = false,
> = Omit<
  BaseEntitySelectProps<UserSelectItemValue>,
  'value' | 'defaultValue' | 'onChange'
> & {
  /**
   * External value mode.
   * - 'string': value is a string or string[] (driven by multiple)
   * - 'object': value is a User or User[] (driven by multiple)
   * @default 'string'
   */
  valueType?: V;
  /**
   * Whether multi-select is enabled.
   * @default false
   */
  multiple?: M;
  /**
   * Account type; determines which field feeds the value's id.
   * @default 'apaas'
   */
  accountType?: AccountType;
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
 * UserSelect component props.
 *
 * Type combinations:
 * | valueType | multiple | value type |
 * |-----------|----------|------------|
 * | 'string'  | false    | string \| null |
 * | 'string'  | true     | string[] |
 * | 'object'  | false    | User \| null |
 * | 'object'  | true     | User[] |
 */
export type UserSelectProps =
  | UserSelectBaseProps<'string', false>
  | UserSelectBaseProps<'string', true>
  | UserSelectBaseProps<'object', false>
  | UserSelectBaseProps<'object', true>;

export type UserSelectValue =
  | User
  | User[]
  | string
  | string[]
  | null;
