/**
 * Form hook contexts created by TanStack React Form: provides the field and form
 * contexts plus their consumer hooks used across the field components.
 * Part of the vendored business-ui component library.
 */
import { createFormHookContexts } from '@tanstack/react-form';

/** Field/form contexts and their consumer hooks. */
export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();
