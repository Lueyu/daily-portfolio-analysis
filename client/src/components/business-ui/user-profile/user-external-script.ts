/**
 * useExternalScript: lazily injects an external <script> (appended to <body>) for
 * the lifetime of the component and tracks its load status. Avoids double-injection
 * and supports CSP nonce and optional cleanup.
 * Part of the vendored business-ui component library.
 */
import { useEffect, useState } from 'react';

/** Lifecycle status of an injected external script. */
export type ExternalScriptStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Options for useExternalScript. */
export interface UseExternalScriptOptions {
  /** Remove the script tag on unmount. */
  removeOnUnmount?: boolean;
  /** Extra attributes to set on the script tag. */
  attributes?: Record<string, string>;
  /** CSP nonce to attach to the script. */
  nonce?: string;
  /** Callback fired once the script finishes loading. */
  onloadCallback?: () => void;
}

/**
 * Injects an external script on demand and returns its load status.
 * - Avoids duplicate injection: if a script with the same src already exists, it is marked ready.
 * - CSP aware: pass a nonce.
 * - Optional cleanup: when removeOnUnmount is true, the script is removed on unmount.
 */
export function useExternalScript(
  src: string,
  options: UseExternalScriptOptions = {},
): ExternalScriptStatus {
  const [status, setStatus] = useState<ExternalScriptStatus>('idle');

  useEffect(() => {
    if (!src) return;

    // If a script with the same src already exists, treat it as ready.
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    );
    if (existing) {
      queueMicrotask(() => {
        setStatus('ready');
      });
      return;
    }
    // Avoid synchronous setState inside the effect; schedule via a microtask
    // to prevent cascading-render warnings.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setStatus('loading');
    });
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    if (options.nonce) script.nonce = options.nonce;
    Object.entries(options.attributes ?? {}).forEach(([k, v]) => {
      script.setAttribute(k, v);
    });

    script.onload = () => {
      if (!cancelled) setStatus('ready');
      if (options.onloadCallback) {
        options.onloadCallback();
      }
    };

    script.onerror = () => {
      if (!cancelled) setStatus('error');
    };

    document.body.append(script);
    return () => {
      cancelled = true;
      if (options.removeOnUnmount) {
        script.remove();
      }
    };
  }, [options, src]);

  return status;
}
