'use client';

/**
 * Centered spinner shown in the combobox dropdown while results are loading.
 * Part of the vendored business-ui component library.
 */
import { cn } from '@/lib/utils';
import { Spinner } from '@client/src/components/ui/spinner';

/** Renders the loading spinner. */
export const BaseComboboxLoading = ({
  className,
}: {
  text?: string;
  className?: string;
}) => {
  return (
    <div
      className={cn('flex items-center justify-center gap-2 py-6', className)}
    >
      <Spinner className="size-4.5 text-primary" />
    </div>
  );
};
