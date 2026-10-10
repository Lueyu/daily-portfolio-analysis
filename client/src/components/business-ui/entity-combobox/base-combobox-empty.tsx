'use client';

/**
 * Empty-state row shown in the combobox dropdown when no results match.
 * Part of the vendored business-ui component library.
 */
import { CommandEmpty } from 'cmdk';

import { useEntityComboboxContext } from '@client/src/components/business-ui/entity-combobox/context';
import { cn } from '@/lib/utils';

/** Renders the "no matching results" empty state. */
export const BaseComboboxEmpty = ({
  text = '没有匹配结果，换个关键词试试吧',
  className,
}: {
  text?: string;
  className?: string;
}) => {
  const { size } = useEntityComboboxContext();

  return (
    <CommandEmpty
      className={cn(
        'px-2 text-sm leading-normal text-muted-foreground',
        size === 'xs' ? 'pt-3' : 'pt-4',
        className,
      )}
    >
      {text}
    </CommandEmpty>
  );
};
