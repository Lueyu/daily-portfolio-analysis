/**
 * Public entry point for DepartmentSelect: re-exports the component, its
 * form-bound field wrapper, and the related types.
 * Part of the vendored business-ui component library.
 */
export { DepartmentSelect } from '@client/src/components/business-ui/department-select/department-select';
export { DepartmentSelectField } from '@client/src/components/business-ui/department-select/department-select-field';
export type {
  DepartmentInfo as Department,
  DepartmentSelectProps,
  Department as DepartmentValue,
} from '@client/src/components/business-ui/department-select/types';
