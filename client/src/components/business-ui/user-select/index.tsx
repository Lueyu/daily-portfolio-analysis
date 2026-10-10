/**
 * Public entry point for UserSelect: re-exports the component, its prop/value types,
 * value helper utilities, the user API service/queries, and the UserPill tag.
 * Part of the vendored business-ui component library.
 */
export { UserSelect } from '@client/src/components/business-ui/user-select/user-select';
export type {
  User,
  UserSelectProps,
  UserSelectValue,
  UserSelectItemValue as UserValue,
  ValueType,
} from '@client/src/components/business-ui/user-select/types';
export {
  extractIdsFromValue,
  isUnregisteredExternalContact,
} from '@client/src/components/business-ui/user-select/utils';
export {
  searchUsers,
  convertExternalContact,
  type AccountType,
  type SearchUsersParams,
} from '@client/src/components/business-ui/api/users/service';
export {
  useUsersByIds,
  clearUserCache,
  userQueries,
} from '@client/src/components/business-ui/api/users/queries';
export { ItemPill } from '@client/src/components/business-ui/entity-combobox/item-pill';
export {
  UserPill,
  type UserPillProps,
} from '@client/src/components/business-ui/user-select/user-pill';
