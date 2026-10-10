/**
 * Size-based style variants (via class-variance-authority) for every combobox
 * internal element: trigger, search input, tags, avatars, icons, add button, list
 * items and skeletons.
 * Part of the vendored business-ui component library.
 */
import { cva } from 'class-variance-authority';

/**
 * Combobox size tiers.
 * - medium: default, fits most cases
 * - small: smaller size
 * - xs: smallest size
 */
export type ComboboxSize = 'medium' | 'small' | 'xs';

/**
 * Search-mode container style.
 * medium: 36px tall, 6px vertical / 6px horizontal padding
 * small: 32px tall, 4px vertical / 4px horizontal padding
 * xs: 28px tall, 4px vertical / 4px horizontal padding
 */
export const searchTriggerVariants = cva(
  [
    'border-input bg-background',
    'flex w-full cursor-pointer items-center gap-1 rounded-md border',
    'hover:border-ring',
    'focus-visible:ring-3 focus-visible:ring-ring/20',
    'data-[state=open]:ring-3 data-[state=open]:ring-ring/20',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'focus-visible:border-ring focus-visible:outline-none data-[state=open]:border-ring',
  ],
  {
    variants: {
      size: {
        medium: 'min-h-9 px-3 py-1.5 text-sm', // 36px, padding 12px
        small: 'min-h-8 px-3 py-1 text-sm', // 32px, padding 12px
        xs: 'min-h-7 px-2 py-1 text-xs', // 28px, padding 8px
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
);

/**
 * Search-mode input text style.
 * medium/small: text-sm
 * xs: text-xs
 */
export const searchInputVariants = cva('', {
  variants: {
    size: {
      medium: 'text-sm',
      small: 'text-sm',
      xs: 'text-xs',
    },
  },
  defaultVariants: {
    size: 'medium',
  },
});

/**
 * Search-mode tag style.
 * medium/small: 24px tall, 20px avatar, text-sm at 22px line-height
 * xs: 20px tall, 16px avatar, text-xs at 16px line-height
 */
export const searchTagVariants = cva('gap-1 pr-1 font-normal', {
  variants: {
    size: {
      medium: 'h-6 text-sm leading-[22px]', // 24px
      small: 'h-6 text-sm leading-[22px]', // 24px
      xs: 'h-5 text-xs leading-4', // 20px
    },
  },
  defaultVariants: {
    size: 'medium',
  },
});

/**
 * Avatar size inside tags.
 * medium/small: 20px
 * xs: 16px
 */
export const tagAvatarVariants = cva('', {
  variants: {
    size: {
      medium: 'size-5', // 20px
      small: 'size-5', // 20px
      xs: 'size-4', // 16px
    },
  },
  defaultVariants: {
    size: 'medium',
  },
});

/**
 * Icon size inside tags (e.g. the department icon).
 * medium/small: 16px
 * xs: 12px
 */
export const tagIconVariants = cva('', {
  variants: {
    size: {
      medium: 'size-5', // 16px
      small: 'size-5', // 16px
      xs: 'size-4', // 12px
    },
  },
  defaultVariants: {
    size: 'medium',
  },
});

/** Close-button icon size inside tags. */
export const tagCloseIconVariants = cva('text-foreground', {
  variants: {
    size: {
      medium: 'size-2.5', // 10px
      small: 'size-2.5', // 10px
      xs: 'size-2', // 8px
    },
  },
  defaultVariants: {
    size: 'medium',
  },
});

/**
 * Button-mode add-button style.
 * medium/small: 24px
 * xs: 16px
 */
export const addButtonVariants = cva(
  [
    'shrink-0 rounded-full p-0',
    'bg-neutral-700/10 hover:bg-neutral-700/20! dark:bg-neutral-500/10 dark:hover:bg-neutral-500/20!',
    'data-[state=open]:bg-neutral-700/20 dark:data-[state=open]:bg-neutral-500/20',
  ],
  {
    variants: {
      size: {
        medium: 'size-6', // 24px
        small: 'size-6', // 24px
        xs: 'size-4', // 16px
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
);

/** Plus-icon size inside the button-mode add button. */
export const addButtonIconVariants = cva('', {
  variants: {
    size: {
      medium: 'size-4', // 16px
      small: 'size-4', // 16px
      xs: 'size-2', // 8px
    },
  },
  defaultVariants: {
    size: 'medium',
  },
});

/**
 * List-item container style.
 * medium/small: 50px tall
 * xs: 46px tall
 */
export const listItemVariants = cva('flex items-center gap-2', {
  variants: {
    size: {
      medium: 'h-[50px] py-2', // 50px
      small: 'h-[50px] py-2', // 50px
      xs: 'h-[46px] py-1.5', // 46px
    },
  },
  defaultVariants: {
    size: 'medium',
  },
});

/**
 * Avatar size inside list items.
 * medium/small: 32px
 * xs: 28px
 */
export const listItemAvatarVariants = cva('', {
  variants: {
    size: {
      medium: 'size-8', // 32px
      small: 'size-8', // 32px
      xs: 'size-7', // 28px
    },
  },
  defaultVariants: {
    size: 'medium',
  },
});

/**
 * List-item name text style.
 * medium/small: text-sm, 22px line-height
 * xs: text-xs, 16px line-height
 */
export const listItemNameVariants = cva('truncate', {
  variants: {
    size: {
      medium: 'text-sm leading-[22px]',
      small: 'text-sm leading-[22px]',
      xs: 'text-xs leading-4',
    },
  },
  defaultVariants: {
    size: 'medium',
  },
});

/**
 * List-item secondary text style (e.g. userId).
 * All sizes: text-xs, 16px line-height
 */
export const listItemSubTextVariants = cva(
  'truncate leading-4 text-muted-foreground',
  {
    variants: {
      size: {
        medium: 'text-xs',
        small: 'text-xs',
        xs: 'text-[10px]',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
);

/** ItemPill tag component style (used for tag rendering). */
export const itemPillVariants = cva(
  [
    'w-fit gap-1 rounded-full border-0 bg-[#E8E8E9] font-normal dark:bg-[#3D3E3E]',
    'pt-px pb-px pl-0.5',
  ],
  {
    variants: {
      size: {
        medium: 'h-[22px] pr-2 text-sm leading-5 [&>svg]:size-5', // 24px
        small: 'h-[22px] pr-2 text-sm leading-5 [&>svg]:size-5', // 24px
        xs: 'h-5 pr-1.5 text-xs leading-4 [&>svg]:size-4', // 20px
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
);

/** Text style inside an ItemPill. */
export const itemPillTextVariants = cva(
  'max-w-[120px] truncate text-foreground',
  {
    variants: {
      size: {
        medium: 'text-sm leading-5',
        small: 'text-sm leading-5',
        xs: 'text-xs leading-4',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
);

/**
 * Skeleton list-item container style (kept consistent with listItemVariants).
 * medium/small: 50px tall
 * xs: 46px tall
 */
export const skeletonItemVariants = cva(
  'flex items-center gap-2 rounded-sm px-2',
  {
    variants: {
      size: {
        medium: 'h-[50px] py-3.5', // 50px
        small: 'h-[50px] py-3.5', // 50px
        xs: 'h-[46px] py-1.5', // 46px
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
);

/**
 * Skeleton list-item avatar size (kept consistent with listItemAvatarVariants).
 * medium/small: 32px
 * xs: 28px
 */
export const skeletonAvatarVariants = cva('rounded-full', {
  variants: {
    size: {
      medium: 'size-8', // 32px
      small: 'size-8', // 32px
      xs: 'size-7', // 28px
    },
  },
  defaultVariants: {
    size: 'medium',
  },
});
