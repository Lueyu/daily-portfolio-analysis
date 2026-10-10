'use client';

/**
 * ItemPill: a badge-style pill used to display a selected entity (user, chat,
 * department) as a removable tag. Also exports helpers to detect hex colors and to
 * render the pill avatar (image, colored fallback, or initial letter).
 * Part of the vendored business-ui component library.
 */
import React from 'react';

import {
  itemPillTextVariants,
  itemPillVariants,
  tagAvatarVariants,
  type ComboboxSize,
} from '@client/src/components/business-ui/entity-combobox/size-variants';
import { cn } from '@/lib/utils';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@client/src/components/ui/avatar';
import { Badge } from '@client/src/components/ui/badge';

/** Props for ItemPill. */
export type ItemPillProps = {
  /**
   * Text shown inside the pill.
   */
  label: string;

  /**
   * Pill size.
   * @default "medium"
   */
  size?: ComboboxSize;

  /**
   * Avatar image URL.
   */
  avatarUrl?: string;

  /**
   * Custom avatar node (overrides avatarUrl rendering).
   */
  avatar?: React.ReactNode;

  /**
   * Whether to render an initial-letter fallback when no avatar URL is present.
   * @default false
   *
   */
  avatarFallback?: boolean;

  /**
   * Custom className.
   */
  className?: string;
  /**
   * Whether the pill is disabled.
   */
  disabled?: boolean;
  /**
   * Truncate the label after this many characters.
   */
  maxTextLength?: number;

  /**
   * Optional suffix node (e.g. a close button) rendered after the label.
   */
  suffix?: React.ReactNode;
};

/** Returns whether the string is a hex RGB color (#RGB or #RRGGBB). */
export const isHexColor = (str?: string): boolean => {
  if (!str) return false;
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(str);
};

/** Options for renderPillAvatar. */
export type RenderPillAvatarOptions = {
  /**
   * Avatar image URL.
   */
  avatarUrl?: string;
  /**
   * Label used to derive the fallback initial letter.
   */
  label: string;
  /**
   * Avatar size.
   * @default "medium"
   */
  size?: ComboboxSize;
  /**
   * Whether to render an initial-letter fallback when no avatar URL is present.
   * @default true
   */
  avatarFallback?: boolean;
};

/**
 * Renders the avatar for a pill: image, colored circle for a hex color, or an
 * initial-letter fallback. Reusable by other components (e.g. UserPill).
 */
export const renderPillAvatar = ({
  avatarUrl,
  label,
  size = 'medium',
  avatarFallback = true,
}: RenderPillAvatarOptions): React.ReactNode => {
  if (avatarUrl) {
    // A hex color renders as a colored circle with the user's first initial.
    if (isHexColor(avatarUrl)) {
      return (
        <Avatar className={tagAvatarVariants({ size })}>
          <AvatarFallback style={{ backgroundColor: avatarUrl }}>
            {label?.charAt?.(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      );
    }
    return (
      <Avatar className={tagAvatarVariants({ size })}>
        <AvatarImage src={avatarUrl} alt={label} loading="eager" />
      </Avatar>
    );
  }

  if (avatarFallback) {
    return (
      <Avatar className={tagAvatarVariants({ size })}>
        <AvatarFallback>{label?.charAt?.(0).toUpperCase()}</AvatarFallback>
      </Avatar>
    );
  }

  return null;
};

/** Badge-style pill showing an avatar and a (truncated) label, with an optional suffix. */
export const ItemPill: React.FC<ItemPillProps> = ({
  className,
  avatarUrl,
  disabled,
  label,
  maxTextLength,
  suffix,
  avatar,
  avatarFallback = true,
  size = 'medium',
}) => {
  const displayLabel = React.useMemo(() => {
    if (!maxTextLength || label?.length <= maxTextLength) {
      return label;
    }
    return label.slice(0, maxTextLength) + '...';
  }, [maxTextLength, label]);

  const avatarElement = React.useMemo(() => {
    if (avatar) {
      return avatar;
    }

    return renderPillAvatar({ avatarUrl, label, size, avatarFallback });
  }, [avatar, avatarUrl, avatarFallback, label, size]);

  return (
    <Badge
      variant="secondary"
      className={cn(
        itemPillVariants({ size }),
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {/* Avatar */}
      {avatarElement}
      {/* Label text */}
      <span className={itemPillTextVariants({ size })}>{displayLabel}</span>

      {suffix}
    </Badge>
  );
};
