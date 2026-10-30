/**
 * @file pages/Auth/RegisterPage.tsx
 * @description Registration page. Bilingual via react-i18next.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiRegister } from '@/api';
import { tokenStore } from '@/api/http';
import { AuthShell } from './AuthShell';

function errorMessage(error: unknown): string {
  const e = error as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? '';
}

function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      toast.warning(t('auth.enterCredentials'));
      return;
    }
    if (password !== confirm) {
      toast.warning(t('auth.passwordMismatch'));
      return;
    }
    try {
      setSubmitting(true);
      const result = await apiRegister({ username: username.trim(), password, displayName: displayName.trim() || undefined });
      tokenStore.save(result.accessToken, result.refreshToken);
      toast.success(`${t('auth.welcomeJoin')}, ${result.user.displayName ?? result.user.username}`);
      navigate('/', { replace: true });
    } catch (error) {
      toast.error(errorMessage(error) || t('auth.registerFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title={t('auth.registerTitle')} subtitle={t('auth.registerTagline')}>
      <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="username">{t('auth.username')}</Label>
          <Input id="username" autoComplete="username" placeholder={t('auth.usernamePlaceholder')} value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="displayName">{t('auth.displayName')}</Label>
          <Input id="displayName" placeholder={t('auth.nicknamePlaceholder')} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t('auth.password')}</Label>
          <Input id="password" type="password" autoComplete="new-password" placeholder={t('auth.passwordPlaceholder')} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">{t('auth.confirmPassword')}</Label>
          <Input id="confirm" type="password" autoComplete="new-password" placeholder={t('auth.confirmPlaceholder')} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? t('auth.creating') : t('auth.createAccount')}
        </Button>
      </form>

      <div className="mt-6 text-center text-sm text-muted-foreground">
        {t('auth.hasAccount')}
        <Link to="/login" className="ml-1 font-medium text-foreground underline-offset-4 hover:underline">
          {t('auth.login')}
        </Link>
      </div>
    </AuthShell>
  );
}

export default RegisterPage;
