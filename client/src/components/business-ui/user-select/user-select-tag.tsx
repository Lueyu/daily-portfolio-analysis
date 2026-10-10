'use client';

/**
 * UserSelectTag: renders a selected user as a closable tag. Shows a skeleton while
 * user info is still loading in ID mode, otherwise renders a UserPill with a close
 * button.
 * Part of the vendored business-ui component library.
 */
import { X } from 'lucide-react';

import {
  tagCloseIconVariants,
  type ComboboxSize,
} from '@client/src/components/business-ui/entity-combobox/size-variants';
import type {
  AccountType,
  UserSelectItemValue,
} from '@client/src/components/business-ui/user-select/types';
import { UserPill } from '@client/src/components/business-ui/user-select/user-pill';
import { Skeleton } from '@client/src/components/ui/skeleton';

/** Renders a selected user tag with an optional close button. */
export const UserSelectTag = ({
  userValue,
  onClose,
  maxTextLength,
  className,
  size = 'medium',
  disabled,
  isLoading,
  accountType = 'apaas',
}: {
  userValue: UserSelectItemValue;
  onClose: (value: UserSelectItemValue, e: React.MouseEvent) => void;
  maxTextLength?: number;
  className?: string;
  size?: ComboboxSize;
  disabled?: boolean;
  /**
   * Whether user info is still loading (in-flight ID-mode lookup).
   */
  isLoading?: boolean;
  /**
   * Account type, used by the UserProfile popover.
   */
  accountType?: AccountType;
}) => {
  const user = userValue.raw;

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose(userValue, e);
  };

  const closeButton = !disabled ? (
    <button
      type="button"
      className="rounded-sm text-foreground opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none"
      onClick={handleClose}
    >
      <X className={tagCloseIconVariants({ size })} />
      <span className="sr-only">移除 {userValue.name}</span>
    </button>
  ) : null;

  // While loading with no user data yet, show a skeleton (do not trigger UserProfile).
  if (isLoading && !user) {
    return (
      <div className="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5">
        <Skeleton className="h-4 w-4 rounded-full" />
        <Skeleton className="h-3 w-12" />
      </div>
    );
  }

  return (
    <UserPill
      userId={userValue.id}
      accountType={accountType}
      label={userValue.name}
      avatarUrl={userValue.avatar || user?.avatar}
      className={className}
      maxTextLength={maxTextLength}
      suffix={closeButton}
      size={size}
      disabled={disabled}
    />
  );
};
