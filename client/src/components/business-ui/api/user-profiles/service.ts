/**
 * Thin service wrapper around the platform UserProfileService for fetching
 * user profile card data, used by the UserProfile component.
 * Part of the vendored business-ui component library.
 */
import {
  UserProfileService,
  getAssetsUrl,
  type AccountType,
  type UserProfileData,
} from '@lark-apaas/client-toolkit/tools/services';

const userProfileService = new UserProfileService();

/** Fetches the profile card data for a single user, optionally abortable via signal. */
export async function fetchUserProfile(
  userId: string,
  accountType: AccountType = 'apaas',
  signal?: AbortSignal,
): Promise<UserProfileData> {
  return userProfileService.getUserProfile(userId, accountType, signal);
}

// Re-export for convenience
export { getAssetsUrl };
export type { AccountType, UserProfileData };
