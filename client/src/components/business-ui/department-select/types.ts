/**
 * Shared type definitions for DepartmentSelect: raw department info, the
 * normalized department item, and the component props.
 * Part of the vendored business-ui component library.
 */
import type {
  BaseEntitySelectProps,
  ItemValue,
} from '@client/src/components/business-ui/entity-combobox/shared-types';
import type { I18nText } from '@client/src/components/business-ui/entity-combobox/types';

/** Raw department info as returned by the search API. */
export type DepartmentInfo = {
  departmentID: string;
  larkDepartmentID: string;
  name: I18nText;
};

/** Normalized department item used internally by BaseCombobox. */
export type Department = ItemValue<DepartmentInfo>;

/** Props for the DepartmentSelect component. */
export type DepartmentSelectProps = BaseEntitySelectProps<Department>;
