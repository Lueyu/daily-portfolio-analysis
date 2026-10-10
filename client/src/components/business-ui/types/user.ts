/**
 * Canonical user types (single source of truth) for the business-ui library: the
 * standard User shape, user type enum, and a tolerant UserInput that accepts both
 * snake_case and camelCase field names.
 * Part of the vendored business-ui component library.
 */
import type { I18nText } from '@/components/business-ui/entity-combobox/types';
import type { Department } from '@/components/business-ui/department-select/types';

/** Re-export related types for convenient unified imports. */
export type { I18nText, Department };

/** User type enum. */
export type UserType = '_employee' | '_externalUser' | '_anonymousUser';

/**
 * Standard user type (single source of truth).
 * Uses snake_case naming (aligned with the backend), except for larkUserId.
 */
export interface User {
  /** User ID (unregistered external contacts may not have one). */
  user_id?: string;

  /** Feishu user ID (kept camelCase). */
  larkUserId?: string;

  /**
   * Display name; either a plain string or internationalized text.
   */
  name?: I18nText | string;

  /** Avatar URL. */
  avatar?: string;

  /** Email address. */
  email?: string;

  /**
   * User type.
   * - '_employee': internal employee
   * - '_externalUser': external user
   * - '_anonymousUser': anonymous user
   */
  user_type?: UserType;

  /** Department info (reuses the DepartmentSelect type). */
  department?: Department;

  /** Tenant name (shown for external users). */
  tenantName?: string;

  /** User status. */
  status?: number;
}

/**
 * Acceptable input shape for user data (used in component props).
 * Tolerates camelCase and snake_case naming; normalized into the standard User type internally.
 */
export type UserInput =
  | User
  | {
      user_id?: string;
      userId?: string;         // camelCase alias
      larkUserId?: string;
      name?: I18nText | string;
      avatar?: string;
      email?: string;
      user_type?: UserType;
      userType?: UserType;     // camelCase alias
      department?: Department | any;
      status?: number;
    };
