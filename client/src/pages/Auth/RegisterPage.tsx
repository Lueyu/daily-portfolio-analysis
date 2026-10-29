/**
 * @file pages/Auth/RegisterPage.tsx
 * @description Registration page for the first-party account system.
 *
 * Username / password / confirm-password form with the same brand card as
 * the login page. On success the issued session is stored and the user is
 * taken straight into the app (empty portfolio onboarding is handled by the
 * dashboard empty states).
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiRegister } from '@/api';
import { tokenStore } from '@/api/http';

/** Extract a readable error message from an axios-ish error. */
function errorMessage(error: unknown): string {
  const e = error as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? '注册失败，请稍后再试';
}

function RegisterPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      toast.warning('请输入用户名和密码');
      return;
    }
    if (password !== confirm) {
      toast.warning('两次输入的密码不一致');
      return;
    }
    try {
      setSubmitting(true);
      const result = await apiRegister({
        username: username.trim(),
        password,
        displayName: displayName.trim() || undefined,
      });
      tokenStore.save(result.accessToken, result.refreshToken);
      toast.success(`欢迎加入吵股，${result.user.displayName ?? result.user.username}`);
      navigate('/', { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-border bg-card p-8 shadow-lg">
          <div className="flex flex-col items-center text-center">
            <img src="/logo.svg" alt="吵股 Squabble" className="h-16 w-16" />
            <h1 className="mt-4 font-serif text-2xl font-semibold tracking-wide text-foreground">
              注册吵股账号
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">只要用户名和密码，别的都不要。</p>
          </div>

          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                autoComplete="username"
                placeholder="2-32 位字母、数字或 . _ -"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">昵称（可选）</Label>
              <Input
                id="displayName"
                placeholder="怎么称呼你"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="至少 6 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">确认密码</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                placeholder="再输一次"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? '创建中…' : '创建账号'}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            已经有账号了？
            <Link to="/login" className="ml-1 font-medium text-foreground underline-offset-4 hover:underline">
              去登录
            </Link>
          </div>
        </div>

        <p className="mt-4 px-2 text-center text-xs leading-relaxed text-muted-foreground">
          不收手机号、不收邮箱验证、零埋点——注册只创建一个用户名和 bcrypt 密码哈希。
        </p>
      </div>
    </div>
  );
}

export default RegisterPage;
