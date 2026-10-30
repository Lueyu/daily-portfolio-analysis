/**
 * @file pages/Auth/LoginPage.tsx
 * @description Login page for the first-party account system.
 * Bilingual (zh-CN / en) via react-i18next.
 */
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiLogin } from '@/api';
import { tokenStore } from '@/api/http';
import { AuthShell } from './AuthShell';

function errorMessage(error: unknown): string {
  const e = error as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? '';
}

const IS_DEMO_HINT = import.meta.env.MODE === 'production';

function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname?: string } } };
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const from = location.state?.from?.pathname ?? '/';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      toast.warning(t('auth.enterCredentials'));
      return;
    }
    try {
      setSubmitting(true);
      const result = await apiLogin({ username: username.trim(), password });
      tokenStore.save(result.accessToken, result.refreshToken);
      toast.success(`${t('auth.welcomeBack')}, ${result.user.displayName ?? result.user.username}`);
      navigate(from, { replace: true });
    } catch (error) {
      toast.error(errorMessage(error) || t('auth.loginFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title={t('auth.loginTitle')} subtitle={t('auth.welcomeBack')}>
      <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="username">{t('auth.username')}</Label>
          <Input id="username" autoComplete="username" placeholder="demo" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t('auth.password')}</Label>
          <Input id="password" type="password" autoComplete="current-password" placeholder="••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? t('auth.loggingIn') : t('auth.login')}
        </Button>
      </form>

      {IS_DEMO_HINT && (
        <button type="button" onClick={() => { setUsername('demo'); setPassword('demo1234'); }} className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground">
          {t('auth.demoHint')}
        </button>
      )}

      <div className="mt-6 text-center text-sm text-muted-foreground">
        {t('auth.noAccount')}
        <Link to="/register" className="ml-1 font-medium text-foreground underline-offset-4 hover:underline">
          {t('auth.register')}
        </Link>
      </div>
    </AuthShell>
  );
}

export default LoginPage;
