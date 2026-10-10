/**
 * Thin service wrapper around the platform DepartmentService for searching
 * departments, used by the DepartmentSelect component.
 * Part of the vendored business-ui component library.
 */
import {
  DepartmentService,
  type SearchDepartmentsParams,
  type SearchDepartmentsResponse,
} from '@lark-apaas/client-toolkit/tools/services';

const departmentService = new DepartmentService();

/** Searches departments matching the given query string. */
export async function searchDepartments(
  params: SearchDepartmentsParams,
): Promise<SearchDepartmentsResponse> {
  return departmentService.searchDepartments(params);
}

export type { SearchDepartmentsParams, SearchDepartmentsResponse };
