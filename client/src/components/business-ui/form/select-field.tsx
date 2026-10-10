/**
 * SelectField: a form-bound select dropdown rendered inside FieldLayout. Accepts
 * either an options array (flat or grouped) or custom children.
 * Part of the vendored business-ui component library.
 */
import type { ReactNode } from 'react';

import { useFormGlobalProps } from '@client/src/components/business-ui/form/context';
import { FieldLayout } from '@client/src/components/business-ui/form/field-layout';
import { useFieldContext } from '@client/src/components/business-ui/form/hooks/form-context';
import {
  useFieldName,
  useFieldValidation,
} from '@client/src/components/business-ui/form/hooks/form-utils';
import type {
  CommonFieldProps,
  FieldLayoutClassNames,
  FieldLayoutStyles,
} from '@client/src/components/business-ui/form/types';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';

/** A single select option. */
type SelectOption = {
  label: string;
  value: string;
  disabled?: boolean;
};

/** A group of select options with a heading. */
type SelectGroupOption = {
  label: string;
  options: SelectOption[];
};

/** Props for SelectField. */
type SelectFieldProps = CommonFieldProps & {
  placeholder?: string;
  children?: ReactNode;
  options?: SelectOption[] | SelectGroupOption[];
  classNames?: Partial<
    FieldLayoutClassNames & {
      Select: string;
    }
  >;
  styles?: Partial<
    FieldLayoutStyles & {
      Select: React.CSSProperties;
    }
  >;
};

/** Renders flat or grouped select options into SelectItem/SelectGroup elements. */
function renderOptions(
  options: SelectOption[] | SelectGroupOption[],
): ReactNode {
  // Detect whether the options are grouped.
  const isGrouped = options.length > 0 && options[0] && 'options' in options[0];

  if (isGrouped) {
    return (options as SelectGroupOption[]).map((group, groupIndex) => (
      <SelectGroup key={group.label}>
        <SelectLabel>{group.label}</SelectLabel>
        {group.options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled ?? false}
          >
            {option.label}
          </SelectItem>
        ))}
        {groupIndex < options.length - 1 && <SelectSeparator />}
      </SelectGroup>
    ));
  } else {
    return (options as SelectOption[]).map((option) => (
      <SelectItem
        key={option.value}
        value={option.value}
        disabled={option.disabled ?? false}
      >
        {option.label}
      </SelectItem>
    ));
  }
}

/** Form-bound select dropdown field with label and validation display. */
export function SelectField(props: SelectFieldProps) {
  const {
    label,
    description,
    placeholder,
    children,
    options,
    required,
    disabled,
    classNames,
    layout = 'vertical',
    styles,
  } = props;
  const field = useFieldContext<string>();
  const { isInvalid, errorMessage } = useFieldValidation();
  const { layout: formLayout } = useFormGlobalProps();
  const name = useFieldName();

  const { Select: selectClassName, ...fieldLayoutClassNames } =
    classNames ?? {};
  const { Select: selectStyle, ...fieldLayoutStyles } = styles ?? {};

  const hasContent = children || options;

  return (
    <FieldLayout
      label={label}
      description={description}
      isInvalid={isInvalid}
      required={required ?? false}
      layout={layout ?? formLayout ?? 'vertical'}
      classNames={fieldLayoutClassNames ?? {}}
      styles={fieldLayoutStyles ?? {}}
      errorMessage={errorMessage}
      name={name}
    >
      <Select
        disabled={disabled ?? false}
        aria-invalid={isInvalid}
        value={field.state.value}
        onValueChange={(value) => {
          field.handleChange(value);
        }}
      >
        <SelectTrigger
          style={selectStyle}
          className={cn(selectClassName, 'w-full')}
          id={name}
          name={name}
          aria-invalid={isInvalid}
        >
          <SelectValue placeholder={placeholder || '请选择'} />
        </SelectTrigger>
        <SelectContent>
          {hasContent ? (
            children || (options && renderOptions(options))
          ) : (
            // eslint-disable-next-line no-restricted-syntax
            <SelectItem disabled value={''}>
              暂无选项
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    </FieldLayout>
  );
}
