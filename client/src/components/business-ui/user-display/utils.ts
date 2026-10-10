/**
 * Conversion helpers for user-display: re-exports the shared user normalizers and
 * adds user-display-specific converters (raw API user info to User, and unknown-user
 * placeholders).
 * Part of the vendored business-ui component library.
 */
import { normalizeUser, isValidUserId } from '@client/src/components/business-ui/utils/user';
import type { User } from '@client/src/components/business-ui/types/user';
import type { UserInfo } from '@lark-apaas/client-toolkit/tools/services';
import type { AccountType } from '@client/src/components/business-ui/api/users/service';

// Re-export the shared normalizers.
export { normalizeUser, isValidUserId };

/** user-display-specific converter: turns raw API user info into a User. */
export function userInfoToUser(
  userInfo: (UserInfo & { avatar?: any }) | any,
  accountType: AccountType,
): User {
  let avatarUrl: string | undefined;

  if (typeof userInfo.avatar === 'string') {
    avatarUrl = userInfo.avatar;
  } else if (userInfo.avatar?.image?.large) {
    avatarUrl = userInfo.avatar.image.large;
  }

  return {
    user_id: accountType === 'lark' ? userInfo.larkUserID : userInfo.userID,
    larkUserId: userInfo.larkUserID,
    name: userInfo.name,
    avatar: avatarUrl,
    user_type: userInfo.userType,
    department: userInfo.department as any,
  };
}

/** Creates an "unknown user" placeholder for an ID that cannot be resolved. */
export function createUnknownUser(user_id: string): User {
  return {
    user_id,
    name: '未知用户',
  };
}
