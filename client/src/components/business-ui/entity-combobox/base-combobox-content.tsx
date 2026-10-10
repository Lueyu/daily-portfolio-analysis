'use client';

/**
 * Popover container for the combobox dropdown: a fixed-width PopoverContent
 * wrapping a cmdk Command (filtering is handled by the parent, not cmdk).
 * Part of the vendored business-ui component library.
 */
import { type PopoverSlotProps } from '@client/src/components/business-ui/entity-combobox/shared-types';
import { cn } from '@/lib/utils';
import { Command } from '@client/src/components/ui/command';
import { PopoverContent } from '@client/src/components/ui/popover';

/** Renders the dropdown popover content shell around the combobox body. */
export const BaseComboboxContent = ({
  children,
  className,
  side,
  align,
  sideOffset,
  popoverProps,
}: {
  children: React.ReactNode;
  className?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  popoverProps?: PopoverSlotProps['popover'];
}) => {
  return (
    <PopoverContent
      className={cn('w-[270px] p-0', className)}
      side={side}
      align={align}
      sideOffset={sideOffset}
      forceMount
      {...popoverProps}
    >
      <Command shouldFilter={false}>{children}</Command>
    </PopoverContent>
  );
};
