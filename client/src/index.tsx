/**
 * @file index.tsx
 * @description Application entry point.
 * Creates the React root and wires together the global providers that every
 * page depends on: the router (`BrowserRouter`), the Lark aPaaS `AppContainer`
 * theme shell, a top-level `ErrorBoundary`, and the global toast renderer
 * (`Toaster`) portaled onto `<body>` so toasts escape any clipped containers.
 *
 * Architecture: this file only composes providers; actual routes are declared
 * in `app.tsx`. The bundle stylesheet `index.css` (Tailwind + theme +
 * typography) is imported here so it is part of the entry chunk.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';

import { AppContainer } from '@lark-apaas/client-toolkit/components/AppContainer';
import { ErrorRender } from '@lark-apaas/client-toolkit/components/ErrorRender';

import RoutesComponent from './app.tsx';
import './index.css';
import { createPortal } from 'react-dom';
import { Toaster } from '@client/src/components/ui/sonner';

/**
 * Base path for the SPA, used as the router basename.
 * Injected at build time via `CLIENT_BASE_PATH` (Vite env); falls back to `/`
 * for local development / standalone deployments.
 */
const CLIENT_BASE_PATH = process.env.CLIENT_BASE_PATH || '/';

/**
 * Root provider stack rendered into `#root`.
 * Order matters: BrowserRouter -> AppContainer (theme) -> ErrorBoundary ->
 * routes + portaled Toaster. The ErrorBoundary shows the aPaaS `ErrorRender`
 * fallback and offers a reset callback so users can recover without reload.
 *
 * @returns The fully-provider-wrapped application element.
 */
const MainApp = () => {
  return (
    <BrowserRouter basename={CLIENT_BASE_PATH}>
      <AppContainer defaultTheme="light">
        <ErrorBoundary
          fallbackRender={({ error, resetErrorBoundary }) => (
            <ErrorRender
              error={error as Error}
              resetErrorBoundary={resetErrorBoundary}
            />
          )}
        >
          <RoutesComponent />
          {createPortal(<Toaster />, document.body)}
        </ErrorBoundary>
      </AppContainer>
    </BrowserRouter>
  );
};

createRoot(document.getElementById('root')!).render(<MainApp />);
