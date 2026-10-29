/**
 * @file hooks/use-theme.ts
 * @brief Light/dark theme hook.
 *
 * The active theme is persisted to `localStorage` and applied by toggling
 * the `dark` class on `<html>` (Tailwind's class-based dark mode). On first
 * load without a stored preference, the OS `prefers-color-scheme` media query
 * is honored.
 */
import { useEffect, useState } from 'react';

/** Theme values supported by the UI. */
type Theme = 'light' | 'dark';

/** localStorage key for the persisted theme. */
const THEME_KEY = 'pt-theme';

/**
 * Resolve the initial theme: stored value wins, otherwise default to the
 * first-class dark theme. SSR-safe (returns 'dark' on the server).
 */
function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return 'dark';
}

/**
 * Manage the application theme.
 * @returns `theme` (current value), `setTheme` (direct setter) and
 *          `toggleTheme` (flip between light and dark). The effect mirrors the
 *          theme onto `<html>.classList.dark` and persists it.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return { theme, setTheme, toggleTheme };
}
