'use client';

/**
 * React context plumbing shared across the BaseCombobox subcomponents: exposes
 * the provider and the hook for reading combobox state (data, selection, size,
 * search value, etc.).
 * Part of the vendored business-ui component library.
 */
import { createContext, useContext } from 'react';

import type { EntityComboboxContextValue } from '@client/src/components/business-ui/entity-combobox/types';

const EntityComboboxContext = createContext<any | undefined>(undefined);

/** Provides combobox state to descendant subcomponents. */
export const EntityComboboxProvider = EntityComboboxContext.Provider;

/** Reads the combobox context; throws when used outside a BaseCombobox. */
export function useEntityComboboxContext(): EntityComboboxContextValue {
  const context = useContext(EntityComboboxContext);
  if (!context) {
    throw new Error(
      'useEntityComboboxContext must be used within EntityCombobox',
    );
  }
  return context;
}
