/**
 * Small field-level hooks built on the form contexts: derive validation state
 * (invalid flag + error message) and a stable field name for a given field.
 * Part of the vendored business-ui component library.
 */
import {
  useFieldContext,
  useFormContext,
} from '@client/src/components/business-ui/form/hooks/form-context';

/** Returns whether the current field is invalid and its first error message. */
export const useFieldValidation = <T>() => {
  const field = useFieldContext<T>();
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const errorMessage = isInvalid
    ? (field.state.meta.errors[0].message ?? field.state.meta.errors[0])
    : '';
  return {
    isInvalid,
    errorMessage,
  };
};

/** Returns a stable, unique name for the current field (form id + field name). */
export const useFieldName = () => {
  const form = useFormContext();
  const field = useFieldContext();
  const name = `${form.formId}-${field.name}`;
  return name;
};
