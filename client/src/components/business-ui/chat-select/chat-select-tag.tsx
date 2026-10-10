'use client';

/**
 * Renders a selected chat as a removable tag/pill (avatar + name + close button),
 * shown in the trigger area for multi-select ChatSelect.
 * Part of the vendored business-ui component library.
 */
import React from 'react';

import { X } from 'lucide-react';

import type { Chat } from '@client/src/components/business-ui/chat-select/types';
import {
  ItemPill,
  renderPillAvatar,
} from '@client/src/components/business-ui/entity-combobox/item-pill';
import {
  tagCloseIconVariants,
  type ComboboxSize,
} from '@client/src/components/business-ui/entity-combobox/size-variants';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * A selected chat rendered as a closable pill. While chat info is still being
 * resolved (ID mode) it renders a skeleton placeholder.
 */
export const ChatSelectTag = ({
  chatValue,
  onClose,
  maxTextLength,
  className,
  size = 'medium',
  disabled,
  isLoading,
}: {
  chatValue: Chat;
  onClose: (value: Chat, e: React.MouseEvent) => void;
  maxTextLength?: number;
  className?: string;
  size?: ComboboxSize;
  disabled?: boolean;
  /** Whether chat info is still loading (ID-mode resolution in progress). */
  isLoading?: boolean;
}) => {
  const chat = chatValue.raw;

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose(chatValue, e);
  };

  const closeButton = !disabled ? (
    <button
      type="button"
      className="rounded-sm text-foreground opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none"
      onClick={handleClose}
    >
      <X className={tagCloseIconVariants({ size })} />
      <span className="sr-only">移除 {chatValue.name}</span>
    </button>
  ) : null;

  // While loading and chat info is not yet available, show a skeleton.
  if (isLoading && !chat) {
    return (
      <div className="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5">
        <Skeleton className="h-4 w-4 rounded-full" />
        <Skeleton className="h-3 w-12" />
      </div>
    );
  }

  const avatarElement = renderPillAvatar({
    avatarUrl: chatValue.avatar || chat?.avatar,
    label: chatValue.name,
    size,
  });

  return (
    <ItemPill
      label={chatValue.name}
      avatar={avatarElement}
      className={className}
      maxTextLength={maxTextLength}
      suffix={closeButton}
      size={size}
      disabled={disabled}
    />
  );
};
