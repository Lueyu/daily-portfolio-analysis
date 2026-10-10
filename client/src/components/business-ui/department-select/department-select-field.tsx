/**
 * DepartmentSelect wired into the form system: renders DepartmentSelect inside a
 * FieldLayout (label/description/error) and binds it to the surrounding form field
 * context. Value is a Department object (object mode), not an ID string.
 * Part of the vendored business-ui component library.
 */
import {
  DepartmentSelect,
  type DepartmentSelectProps,
} from '@client/src/components/business-ui/department-select';
import type { Department } from '@client/src/components/business-ui/department-select/types';
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

/** Props for DepartmentSelectField: layout props plus DepartmentSelect props (minus controlled value). */
type DepartmentSelectFieldProps = CommonFieldProps &
  Omit<
    DepartmentSelectProps,
    'value' | 'onChange' | 'defaultValue' | 'name' | 'required'
  > & {
    classNames?: Partial<
      FieldLayoutClassNames & {
        DepartmentSelect: string;
      }
    >;
    styles?: Partial<
      FieldLayoutStyles & {
        DepartmentSelect: React.CSSProperties;
      }
    >;
  };

/** Form-bound department select field. */
export function DepartmentSelectField(props: DepartmentSelectFieldProps) {
  const {
    label,
    description,
    required,
    disabled,
    classNames,
    layout = 'vertical',
    styles,
    multiple,
    ...departmentSelectProps
  } = props;

  const field = useFieldContext<Department | Department[] | null>();
  const { isInvalid, errorMessage } = useFieldValidation();
  const { layout: formLayout } = useFormGlobalProps();
  const name = useFieldName();

  const {
    DepartmentSelect: departmentSelectClassName,
    ...fieldLayoutClassNames
  } = classNames ?? {};
  const fieldLayoutStyles = styles ?? {};

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
      <DepartmentSelect
        {...departmentSelectProps}
        multiple={multiple}
        value={field.state.value ?? (multiple ? [] : null)}
        onChange={(value: Department | Department[] | null) => {
          field.handleChange(value);
        }}
        disabled={disabled ?? false}
        name={name}
        required={required}
        className={departmentSelectClassName}
      />
    </FieldLayout>
  );
}
