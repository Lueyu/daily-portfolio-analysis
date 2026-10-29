/**
 * @file pages/NotFound/NotFound.tsx
 * @description 404 page: brand mascots + a way home.
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
      <img src="/logo.svg" alt="Squabble" className="h-16 w-16" />
      <h1 className="mt-6 font-serif text-4xl font-semibold text-foreground">
        {t('common.notFound')}
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {t('common.notFoundText')}
      </p>
      <Link to="/" className="mt-8">
        <Button>{t('common.goHome')}</Button>
      </Link>
    </div>
  );
}

export default NotFound;
