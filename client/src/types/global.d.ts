/**
 * @file types/global.d.ts
 * @brief Ambient module declarations for static assets and CSS imports.
 *
 * Lets TypeScript resolve `import x from './logo.png'` (and friends) that
 * Vite handles at build time, plus extends React's CSSProperties to allow
 * arbitrary CSS custom properties (e.g. `--brand-color`) in style objects.
 */

declare module '*.css';

// Type declarations for importing static assets
declare module '*.png' {
  const value: string;
  export default value;
}

declare module '*.jpg' {
  const value: string;
  export default value;
}

declare module '*.jpeg' {
  const value: string;
  export default value;
}

declare module '*.gif' {
  const value: string;
  export default value;
}

declare module '*.webp' {
  const value: string;
  export default value;
}

declare module '*.ico' {
  const value: string;
  export default value;
}

declare module '*.json' {
  const value: any;
  export default value;
}

declare module '*.md' {
  const value: string;
  export default value;
}

declare module '*.csv' {
  const value: string;
  export default value;
}

/**
 * Allow React inline styles to carry CSS variables (`--*`) in addition to the
 * standard CSSProperties keys, which Tailwind/shadcn utilities rely on.
 */
declare namespace React {
  export interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
