/**
 * @file components/Layout.tsx
 * @description App-level shell: sidebar navigation, top bar, user menu, theme
 * toggle, sign-out flow and the empty-data warning banner.
 *
 * Mounted as the layout route in `app.tsx`; every feature page renders inside
 * its `<Outlet/>`. Also owns the market-status indicator shown in the top bar.
 */
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useCurrentUserProfile } from '@lark-apaas/client-toolkit/hooks/useCurrentUserProfile';
import { authClient } from '@lark-apaas/client-toolkit/auth';
import { logger, fetchDashboard } from '@/api';
import {
  LayoutDashboard,
  Briefcase,
  Eye,
  BarChart3,
  BookOpen,
  Receipt,
  Settings,
  Sun,
  Moon,
  RefreshCw,
  Menu,
  X,
  Circle,
  LogOut,
  User as UserIcon,
  AlertTriangle,
  Sparkles,
  Phone,
} from 'lucide-react';
import { useTheme } from '../hooks/use-theme';
import { getAggregateMarketStatus, forceRefreshAllQuotes } from '../hooks/use-market-quotes';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Sidebar navigation entries. `end: true` marks the index route so it is only
 * active on the exact path rather than on every child route.
 */
const navItems = [
  { path: '/', label: '仪表盘', icon: LayoutDashboard, end: true },
  { path: '/holdings', label: '持仓', icon: Briefcase },
  { path: '/watchlist', label: '关注', icon: Eye },
  { path: '/analysis', label: '每日分析', icon: BarChart3 },
  { path: '/journal', label: '日志', icon: BookOpen },
  { path: '/transactions', label: '交易记录', icon: Receipt },
  { path: '/settings/rules', label: '策略规则', icon: Settings },
];

/**
 * Root layout component. Renders the responsive sidebar (off-canvas on mobile),
 * top bar with page title + market indicator, and the routed `<Outlet/>`.
 *
 * Side effects:
 *  - Closes the mobile drawer on route change.
 *  - Once the user profile loads, probes `/api/portfolio/dashboard/overview`
 *    to detect an empty portfolio; combined with the phone-login check this
 *    surfaces a warning banner guiding users to switch to their Feishu account.
 */
function Layout() {
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [isPhoneEmpty, setIsPhoneEmpty] = useState(false);
  const [userLoaded, setUserLoaded] = useState(false);
  const [dashboardEmpty, setDashboardEmpty] = useState(false);
  const [phoneAvailable, setPhoneAvailable] = useState(false);
  const location = useLocation();
  const user = useCurrentUserProfile();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (user?.user_id) {
      setUserLoaded(true);
    }
  }, [user?.user_id]);

  useEffect(() => {
    if (!user?.user_id) return;
    let cancelled = false;
    const checkEmpty = async () => {
      try {
        const data = await fetchDashboard();
        const isEmpty = !data?.accountValue || Number(data.accountValue) === 0;
        if (!cancelled) setDashboardEmpty(isEmpty);
      } catch {
        if (!cancelled) setDashboardEmpty(false);
      }
    };
    checkEmpty();
    return () => { cancelled = true; };
  }, [user?.user_id]);

  const isPhoneLogin = userLoaded && !user?.lark_user_id && phoneAvailable;
  const showEmptyWarning = isPhoneLogin && dashboardEmpty;

  const handleSwitchToFeishu = () => {
    setSignOutOpen(true);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-56 transform bg-sidebar text-sidebar-foreground transition-transform duration-200 md:static md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
            <div className="flex items-center gap-2">
              <img src="/logo.svg" alt="吵股" className="h-8 w-8" />
              <span className="font-serif text-lg font-semibold tracking-wide">
                吵股
              </span>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="rounded-md p-1 hover:bg-sidebar-accent md:hidden"
            >
              <X size={18} />
            </button>
          </div>

          <nav className="flex-1 space-y-1 px-2 py-3">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                  }`
                }
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="border-t border-sidebar-border p-3 space-y-1">
            <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
              <UserAvatar />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-sidebar-foreground">
                  <UserName />
                </div>
                <div className="flex items-center gap-1 truncate text-xs text-sidebar-foreground/50">
                  <LoginMethodBadge />
                </div>
              </div>
            </div>
            <button
              onClick={toggleTheme}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
            </button>
            <button
              onClick={() => setSignOutOpen(true)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            >
              <LogOut size={18} />
              <span>切换账号</span>
            </button>
          </div>

          <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-border bg-card px-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-md p-1.5 hover:bg-secondary md:hidden"
            >
              <Menu size={20} />
            </button>
            <div className="font-serif text-lg font-semibold">
              {navItems.find((item) => {
                if (item.end) return location.pathname === item.path;
                return location.pathname.startsWith(item.path);
              })?.label || '吵股'}
            </div>
          </div>
          <MarketStatusIndicator />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 safe-bottom">
          {showEmptyWarning && (
            <Alert variant="destructive" className="mb-4 border-amber-500/50 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertTitle className="text-amber-700 dark:text-amber-400">
                当前为手机号登录的独立空间，未找到持仓数据
              </AlertTitle>
              <AlertDescription className="text-amber-700/80 dark:text-amber-400/80">
                你的全部数据在飞书账号下。请点击下方按钮切换到飞书登录，
                登录同一飞书账号即可恢复所有持仓、分析与快照。
                <button
                  onClick={handleSwitchToFeishu}
                  className="ml-2 inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600"
                >
                  <Sparkles size={12} />
                  切换到飞书登录
                </button>
              </AlertDescription>
            </Alert>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * Top-bar market status dot. Polls the aggregate market phase every 30s and
 * shows "交易中" (green) when at least one market is in continuous trading,
 * otherwise "休市". Also exposes a refresh button that forces a quote refetch.
 */
function MarketStatusIndicator() {
  const [anyTrading, setAnyTrading] = useState(false);

  useEffect(() => {
    const check = () => {
      const { anyTrading: at } = getAggregateMarketStatus();
      setAnyTrading(at);
    };
    check();
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
  }, []);

  const statusLabel = anyTrading ? '交易中' : '休市';
  const statusColor = anyTrading ? 'text-success' : 'text-muted-foreground';

  return (
    <div className="flex items-center gap-3 text-sm">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex cursor-help items-center gap-1.5">
            <Circle size={8} className={`fill-current ${statusColor}`} />
            <span className={`${statusColor} text-xs font-medium`}>
              {statusLabel}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          美股 21:30–04:00 · 港股 09:30–16:00 · A股 09:30–15:00（北京时间）；绿涨红跌
        </TooltipContent>
      </Tooltip>
      <button
        className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        title="刷新行情"
        onClick={() => forceRefreshAllQuotes()}
      >
        <RefreshCw size={16} />
      </button>
    </div>
  );
}

/** Sidebar avatar: shows the user's photo, falling back to an initial or generic icon. */
function UserAvatar() {
  const user = useCurrentUserProfile();
  const name = user?.name || '';
  const initial = name ? name.charAt(0).toUpperCase() : '?';

  if (user?.avatar) {
    return (
      <Avatar className="h-8 w-8 border border-sidebar-border">
        <AvatarImage src={user.avatar} alt={name} />
        <AvatarFallback>{initial}</AvatarFallback>
      </Avatar>
    );
  }

  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground">
      <UserIcon size={14} />
    </div>
  );
}

/** Sidebar display name; renders a skeleton until the profile resolves. */
function UserName() {
  const user = useCurrentUserProfile();
  if (!user?.user_id) return <Skeleton className="h-4 w-16" />;
  return <span>{user.name || '未知用户'}</span>;
}

/**
 * Badge indicating how the current user signed in.
 * - Feishu (lark_user_id present) -> green "飞书账号" badge.
 * - Phone login -> amber masked phone number.
 * - Otherwise generic "当前账号".
 */
function LoginMethodBadge() {
  const user = useCurrentUserProfile();
  const [phoneNumber, setPhoneNumber] = useState<string>('');

  useEffect(() => {
    if (!user?.user_id) return;
    const loadPhone = async () => {
      try {
        const result = await authClient.session.getUserInfo();
        const info = result.data?.user_info;
        if (info?.phone_number) {
          setPhoneNumber(info.phone_number);
        }
      } catch {
        // ignore
      }
    };
    loadPhone();
  }, [user?.user_id]);

  if (!user?.user_id) return <Skeleton className="h-4 w-16" />;

  if (user.lark_user_id) {
    return (
      <span className="inline-flex items-center gap-1">
        <Sparkles size={10} className="text-success" />
        <span>飞书账号</span>
      </span>
    );
  }

  if (phoneNumber) {
    const masked = phoneNumber.length >= 11
      ? `${phoneNumber.slice(0, 3)}****${phoneNumber.slice(-4)}`
      : phoneNumber;
    return (
      <span className="inline-flex items-center gap-1 text-amber-500/80">
        <Phone size={10} />
        <span>手机号 {masked}</span>
      </span>
    );
  }

  return <span>当前账号</span>;
}

/**
 * Confirmation dialog for signing out / switching accounts.
 * On confirm it calls the aPaaS `authClient.session.signOut` and redirects to
 * the login page regardless of success/failure (the user must re-authenticate).
 */
function SignOutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    try {
      setSigningOut(true);
      const result = await authClient.session.signOut();
      if (result.error) {
        logger.error('退出登录失败', result.error.message);
      }
      authClient.session.redirectToLogin();
    } catch (error) {
      logger.error('退出登录异常', error);
      authClient.session.redirectToLogin();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>切换账号</DialogTitle>
          <DialogDescription className="pt-2 leading-relaxed">
            退出后需重新用飞书登录。当前账号的持仓、分析、快照等数据会保留，
            重新登录同一账号即可恢复。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={signingOut}>
            取消
          </Button>
          <Button onClick={handleSignOut} disabled={signingOut}>
            {signingOut ? '正在退出...' : '确认退出'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default Layout;
