/**
 * @file client/src/i18n/index.ts
 * @description i18n bootstrap: react-i18next with zh-CN + en bundles.
 *
 * Language is persisted in localStorage ('sq-lang') and defaults to the
 * browser's preferred locale. The switcher lives in the sidebar (Layout).
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './zh-CN.json';
import en from './en.json';

export const SUPPORTED_LANGS = ['zh-CN', 'en'] as const;
export type AppLang = (typeof SUPPORTED_LANGS)[number];

const LANG_KEY = 'sq-lang';

/** Detect the initial language: stored -> browser -> zh-CN. */
function detectLang(): AppLang {
  if (typeof window === 'undefined') return 'zh-CN';
  const stored = localStorage.getItem(LANG_KEY);
  if (stored === 'en' || stored === 'zh-CN') return stored;
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith('zh')) return 'zh-CN';
  if (nav.startsWith('en')) return 'en';
  return 'zh-CN';
}

/** Switch the language (also persists). */
export function setLanguage(lang: AppLang): void {
  i18n.changeLanguage(lang);
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang;
}

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en },
  },
  lng: detectLang(),
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
