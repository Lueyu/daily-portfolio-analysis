'use client';

/**
 * Error state row shown in the combobox dropdown when a search fails, with a
 * retry/refresh action.
 * Part of the vendored business-ui component library.
 */
import { cn } from '@/lib/utils';
import { Button } from '@client/src/components/ui/button';

/** Props for BaseComboboxError. */
export type BaseComboboxErrorProps = {
  /** Callback invoked when the user clicks the retry button. */
  onRetry?: () => void;
  className?: string;
};

/** Renders the load-failed error state with a retry button. */
export const BaseComboboxError = ({
  onRetry,
  className,
}: BaseComboboxErrorProps) => {
  return (
    <div
      className={cn(
        'flex gap-2 px-2 pt-4 text-sm leading-normal text-muted-foreground',
        className,
      )}
    >
      <div className="max-w-full truncate text-muted-foreground">
        加载失败，请检查网络后重试
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRetry}
        className="h-auto px-0 text-primary"
      >
        刷新
      </Button>
    </div>
  );
};
