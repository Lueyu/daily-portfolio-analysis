/**
 * Public entry point for the form system: re-exports the Form container,
 * FieldLayout, the global layout hook, and the form factory hook.
 * Part of the vendored business-ui component library.
 */
export { useFormGlobalProps } from '@client/src/components/business-ui/form/context';
export { FieldLayout } from '@client/src/components/business-ui/form/field-layout';
export { Form } from '@client/src/components/business-ui/form/form';
export { createAppFormHook } from '@client/src/components/business-ui/form/hooks/form';
