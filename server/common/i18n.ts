/**
 * @file server/common/i18n.ts
 * @description Server-side bilingual error messages.
 *
 * Reads the request's Accept-Language header to pick zh/en. When the
 * client sends a language preference via the X-Lang header (set by our
 * axios interceptor), that takes precedence. Falls back to zh-CN.
 */
import type { Request } from 'express';

/** Supported server-side languages. */
export type ServerLang = 'zh' | 'en';

/** Detect the preferred language from a request. */
export function detectLang(req: Request): ServerLang {
  const explicit = req.headers['x-lang'];
  if (typeof explicit === 'string') {
    if (explicit.startsWith('en')) return 'en';
    if (explicit.startsWith('zh')) return 'zh';
  }
  const accept = req.headers['accept-language'];
  if (typeof accept === 'string' && accept.toLowerCase().startsWith('en')) {
    return 'en';
  }
  return 'zh';
}

/** Bilingual message picker: returns the message in the request's language. */
export function srvMsg(req: Request, zh: string, en: string): string {
  return detectLang(req) === 'en' ? en : zh;
}
