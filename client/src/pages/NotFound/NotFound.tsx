/**
 * @file pages/NotFound/NotFound.tsx
 * @description 404 page: brand mascot, message and a way home.
 */
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
      <img src="/logo.svg" alt="吵股" className="h-16 w-16" />
      <h1 className="mt-6 font-serif text-4xl font-semibold text-foreground">404</h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
        牛牛和熊熊找遍了每个角落，也没找到这个页面——它们为此又吵了一架。
      </p>
      <Link to="/" className="mt-8">
        <Button>回首页</Button>
      </Link>
    </div>
  );
}

export default NotFound;
