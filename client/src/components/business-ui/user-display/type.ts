/**
 * Props type for UserWithAvatar (the avatar+name rendering used inside UserDisplay).
 * Part of the vendored business-ui component library.
 */
import type { AccountType } from '@lark-apaas/client-toolkit/tools/services';
import type { UserInput } from '@client/src/components/business-ui/types/user';

export interface UserWithAvatarProps {
  /**
   * User data; passing only a userId is enough, as the component fetches name and avatar.
   */
  data: UserInput;
  /**
   * @default medium
   */
  size?: 'small' | 'medium' | 'large';
  /**
   * @default tag
   */
  mode?: 'tag' | 'plain';
  className?: string;
  /**
   * @default true
   */
  showLabel?: boolean;
  /**
   * Account type used to look up user info.
   * @default 'apaas'
   */
  accountType?: AccountType;
}
