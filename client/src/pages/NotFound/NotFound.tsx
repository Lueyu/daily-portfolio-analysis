/**
 * @file pages/NotFound/NotFound.tsx
 * @description 404 fallback route.
 * Rendered by `app.tsx`'s `path="*"` catch-all when no route matches; wraps the
 * aPaaS toolkit's branded `NotFoundRender` component.
 */
import { NotFoundRender } from "@lark-apaas/client-toolkit/components/NotFoundRender";

/**
 * 404 page component.
 * @returns The branded not-found screen from the aPaaS toolkit.
 */
const NotFound = () => {
  return (
    <>
      <NotFoundRender />
    </>
  );
};

export default NotFound;
