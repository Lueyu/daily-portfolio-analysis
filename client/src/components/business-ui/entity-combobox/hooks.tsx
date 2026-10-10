'use client';

/**
 * Shared hooks for the combobox: re-exports the context hook and provides a
 * generic debounce hook used to throttle search input.
 * Part of the vendored business-ui component library.
 */
import { useEffect, useState } from 'react';

export { useEntityComboboxContext } from '@client/src/components/business-ui/entity-combobox/context';

/** Returns a debounced copy of `value` that only updates after `delay` ms of quiet. */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
