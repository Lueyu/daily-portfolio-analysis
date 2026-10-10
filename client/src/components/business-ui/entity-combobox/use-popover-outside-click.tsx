/**
 * usePopoverOutsideClick: closes the popover when the user clicks outside both the
 * popover and the trigger. Currently used in search mode.
 * Part of the vendored business-ui component library.
 */
import { useEffect } from 'react';

/**
 * Closes the popover on an outside mousedown while it is open and enabled.
 */
export function usePopoverOutsideClick(
  open: boolean,
  enabled: boolean,
  popoverRef: React.RefObject<HTMLElement | null>,
  triggerRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open || !enabled) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        popoverRef.current &&
        triggerRef.current &&
        !popoverRef.current.contains(target) &&
        !triggerRef.current.contains(target)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, enabled, popoverRef, triggerRef, onClose]);
}
