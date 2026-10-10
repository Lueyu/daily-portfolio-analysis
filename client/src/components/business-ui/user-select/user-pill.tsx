'use client';

/**
 * UserPill: a selected-user chip (avatar + name) used as the UserSelect tag. The
 * avatar can open a popover showing the full UserProfile card on click.
 * Part of the vendored business-ui component library.
 */
import React from 'react';

import {
  ItemPill,
  renderPillAvatar,
} from '@client/src/components/business-ui/entity-combobox/item-pill';
import type { ComboboxSize } from '@client/src/components/business-ui/entity-combobox/size-variants';
import { UserProfile } from '@client/src/components/business-ui/user-profile/user-profile';
import type { AccountType } from '@client/src/components/business-ui/user-select/types';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@client/src/components/ui/popover';

/** Props for UserPill. */
export type UserPillProps = {
  /**
   * User ID, used by the UserProfile popover.
   */
  userId: string;

  /**
   * Account type.
   * @default "apaas"
   */
  accountType?: AccountType;

  /**
   * Displayed user name.
   */
  label: string;

  /**
   * Avatar URL.
   */
  avatarUrl?: string;

  /**
   * Size.
   * @default "medium"
   */
  size?: ComboboxSize;

  /**
   * Whether disabled.
   */
  disabled?: boolean;

  /**
   * Maximum text length before truncation.
   */
  maxTextLength?: number;

  /**
   * Suffix node (e.g. a close button).
   */
  suffix?: React.ReactNode;

  /**
   * Custom class names.
   */
  className?: string;

  /**
   * Whether clicking the avatar opens the UserProfile popover.
   * @default true
   */
  enableProfile?: boolean;

  /** Whether to render a fallback initial when no avatar is available. */
  avatarFallback?: boolean;
};

/** Renders a selected-user chip, optionally with a UserProfile popover on the avatar. */
export const UserPill: React.FC<UserPillProps> = ({
  userId,
  accountType = 'apaas',
  label,
  avatarUrl,
  size = 'medium',
  disabled,
  maxTextLength,
  suffix,
  className,
  enableProfile = true,
  avatarFallback,
}) => {
  const baseAvatarElement = renderPillAvatar({
    avatarUrl,
    label,
    size,
    avatarFallback,
  });

  const avatarWithPopover = React.useMemo(() => {
    if (!enableProfile) {
      return baseAvatarElement;
    }

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
    };

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn('cursor-pointer rounded-full')}
            onClick={handleClick}
          >
            {baseAvatarElement}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={8}
          className="w-80 p-0"
        >
          <UserProfile userId={userId} accountType={accountType} />
        </PopoverContent>
      </Popover>
    );
  }, [enableProfile, baseAvatarElement, userId, accountType]);

  return (
    <ItemPill
      label={label}
      avatar={avatarWithPopover}
      className={className}
      maxTextLength={maxTextLength}
      suffix={suffix}
      size={size}
      disabled={disabled}
      avatarFallback={avatarFallback}
    />
  );
};
