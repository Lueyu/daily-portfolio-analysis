/**
 * @file pages/Auth/LoginPage.tsx
 * @description Login page for the first-party account system.
 *
 * Centered brand card (logo + 吵股 Squabble + tagline), username/password
 * form, a hint for the Docker demo account, and the privacy one-liner that
 * anchors the product's positioning: no phone number, no email
 * verification. Registration link switches to /register.
 */
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiLogin } from '@/api';
import { tokenStore } from '@/api/http';

/** Extract a readable error message from an axios-ish error. */
function errorMessage(error: unknown): string {
  const e = error as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? '登录失败，请稍后再试';
}

/** Whether the demo account is available (self-hosted demo deployments). */
const IS_DEMO_HINT = import.meta.env.MODE === 'production';

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname?: string } } };
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const from = location.state?.from?.pathname ?? '/';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      toast.warning('请输入用户名和密码');
      return;
    }
    try {
      setSubmitting(true);
      const result = await apiLogin({ username: username.trim(), password });
      tokenStore.save(result.accessToken, result.refreshToken);
      toast.success(`欢迎回来，${result.user.displayName ?? result.user.username}`);
      navigate(from, { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = () => {
    setUsername('demo');
    setPassword('demo1234');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-border bg-card p-8 shadow-lg">
          <div className="flex flex-col items-center text-center">
            <img src="/logo.svg" alt="吵股 Squabble" className="h-16 w-16" />
            <h1 className="mt-4 font-serif text-2xl font-semibold tracking-wide text-foreground">
              吵股
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">让 AI 替你吵，你来定。</p>
          </div>

          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                autoComplete="username"
                placeholder="demo"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? '登录中…' : '登录'}
            </Button>
          </form>

          {IS_DEMO_HINT && (
            <button
              type="button"
              onClick={fillDemo}
              className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Docker 演示账号：demo / demo1234（点击填充）
            </button>
          )}

          <div className="mt-6 text-center text-sm text-muted-foreground">
            还没有账号？
            <Link to="/register" className="ml-1 font-medium text-foreground underline-offset-4 hover:underline">
              注册一个
            </Link>
          </div>
        </div>

        <p className="mt-4 px-2 text-center text-xs leading-relaxed text-muted-foreground">
          我们只存你的用户名和密码哈希——不收手机号、不收邮箱验证、零埋点。
          <a
            href="https://github.com/Lueyu/squabble/blob/main/docs/privacy.md"
            target="_blank"
            rel="noreferrer"
            className="ml-1 underline underline-offset-2"
          >
            隐私说明
          </a>
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
