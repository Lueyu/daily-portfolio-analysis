/**
 * createAppFormHook: builds a TanStack form hook pre-wired with the common field
 * components (Input, Switch, RadioGroup, Checkbox, Select, Textarea), allowing
 * callers to add custom field/form components.
 * Part of the vendored business-ui component library.
 */
import { createFormHook } from '@tanstack/react-form';

import { CheckboxField } from '@client/src/components/business-ui/form/checkbox-field';
import {
  fieldContext,
  formContext,
} from '@client/src/components/business-ui/form/hooks/form-context';
import { InputField } from '@client/src/components/business-ui/form/input-field';
import { RadioGroupField } from '@client/src/components/business-ui/form/radio-group-field';
import { SelectField } from '@client/src/components/business-ui/form/select-field';
import { SwitchField } from '@client/src/components/business-ui/form/switch-field';
import { TextareaField } from '@client/src/components/business-ui/form/textarea-field';

/** Options for createAppFormHook. */
interface CreateFormHookOptions {
  fieldComponents: Record<string, React.FC>;
  formComponents: Record<string, React.FC>;
}

/** The default field components available to created form hooks. */
const COMMON_FORM_COMPONENTS = {
  Input: InputField,
  Switch: SwitchField,
  RadioGroup: RadioGroupField,
  Checkbox: CheckboxField,
  Select: SelectField,
  Textarea: TextareaField,
};

/** Creates a form hook pre-registered with the common field components. */
export function createAppFormHook(options?: CreateFormHookOptions) {
  const { fieldComponents = {}, formComponents = {} } = options ?? {};

  return createFormHook({
    fieldComponents: {
      ...COMMON_FORM_COMPONENTS,
      ...fieldComponents,
    },
    formComponents: formComponents,
    fieldContext,
    formContext,
  });
}
