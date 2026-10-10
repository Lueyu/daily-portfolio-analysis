/**
 * Thin service wrapper around the platform UserService for searching users,
 * batch-fetching users, and converting external contacts, used by UserSelect
 * and the user display components.
 * Part of the vendored business-ui component library.
 */
import {
  UserService,
  type AccountType,
  type SearchUsersParams,
  type SearchUsersResponse,
  type BatchGetUsersResponse,
  type ConvertExternalContactResponse,
} from '@lark-apaas/client-toolkit/tools/services';

const userService = new UserService();

/** Searches users matching the query string, including external contacts. */
export async function searchUsers(
  params: SearchUsersParams,
): Promise<SearchUsersResponse> {
  return userService.searchUsers({ ...params, searchExternalContact: true });
}

/** Batch-fetches user info for a list of user IDs (numeric IDs only). */
export async function listUsersByIds(
  userIds: string[],
): Promise<BatchGetUsersResponse> {
  const numericIds = userIds.filter((id) => !isNaN(Number(id)));
  return userService.listUsersByIds(numericIds);
}

/** Calls the onboarding API to convert an external contact's larkUserID into a registered user. */
export async function convertExternalContact(
  larkUserID: string,
): Promise<ConvertExternalContactResponse> {
  return userService.convertExternalContact(larkUserID);
}

export type { AccountType, SearchUsersParams, SearchUsersResponse, BatchGetUsersResponse, ConvertExternalContactResponse };
