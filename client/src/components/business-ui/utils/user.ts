/**
 * Pure user helpers: resolving internationalized display text, normalizing tolerant
 * UserInput shapes into the standard User type, validating user IDs, and deriving
 * a display name.
 * Part of the vendored business-ui component library.
 */
import type { I18nText, User, UserInput } from '../types/user';

/**
 * Resolves the display value of an internationalized text.
 * @param text Internationalized text or a plain string.
 * @param locale Preferred locale, defaults to zh_cn.
 */
export function getI18nText(
  text: I18nText | string | undefined,
  locale: 'zh_cn' | 'en_us' | 'ja_jp' = 'zh_cn',
): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  // Fall back across locales when the preferred one is missing.
  return text[locale] || text.zh_cn || text.en_us || text.ja_jp || '';
}

/** Normalizes any accepted user input shape into the standard User type (snake_case). */
export function normalizeUser(input: UserInput): User {
  const data = input as any;

  // Extract user_id (accept both camelCase and snake_case).
  const user_id = data.user_id || data.userId || '';

  // Extract the remaining fields.
  const larkUserId = data.larkUserId;  // larkUserId stays camelCase
  const name = data.name;
  const avatar = data.avatar;
  const email = data.email;

  // Extract user_type (accept both camelCase and snake_case).
  const user_type = data.user_type || data.userType;

  const department = data.department;

  return {
    user_id,
    larkUserId,
    name,
    avatar,
    email,
    user_type,
    department,
  };
}

/** Returns whether the given user_id is valid (non-empty and not a stray empty string). */
export function isValidUserId(user_id: string | undefined): boolean {
  if (!user_id) return false;
  const trimmed = user_id.trim();
  if (!trimmed) return false;
  if (trimmed === '""') return false; // Filter out empty strings that may come from AI generation.
  return true;
}

/** Returns the user's display name, handling I18nText automatically. */
export function getUserDisplayName(
  user: User | undefined,
  locale: 'zh_cn' | 'en_us' | 'ja_jp' = 'zh_cn',
): string {
  if (!user) return '';
  return getI18nText(user.name, locale) || '无效人员';
}
