/**
 * Pure helpers for DepartmentSelect: resolving the display name and converting
 * raw DepartmentInfo into the normalized Department item.
 * Part of the vendored business-ui component library.
 */
import type { DepartmentInfo } from '@lark-apaas/client-toolkit/tools/services';

import type { Department } from './types';

/** Returns the display name for a department (prefers Chinese, falls back to English). */
export function getDepartmentDisplayName(name: DepartmentInfo['name']): string {
  return name?.zh_cn || name?.en_us || '';
}

/** Normalizes raw DepartmentInfo into a Department item used by BaseCombobox. */
export function departmentInfoToDepartment(
  departmentInfo: DepartmentInfo,
): Department {
  return {
    id: departmentInfo.departmentID,
    name: getDepartmentDisplayName(departmentInfo.name),
    raw: departmentInfo,
  };
}
