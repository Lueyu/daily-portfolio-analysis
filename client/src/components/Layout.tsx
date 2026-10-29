/**
 * @file components/Layout.tsx
 * @description App-level shell: sidebar navigation, top bar, user menu, theme
 * toggle and the session guard.
 *
 * Mounted as the layout route in `app.tsx`; every feature page renders inside
 * its `<Outlet/>`. Also owns the market-status indicator shown in the top bar.
 *
 * Auth: the layout requires a stored session (token presence check; actual
 * validity is enforced server-side and by the http 401 interceptor). The
 * user menu reads the profile from GET /api/auth/me.
 */
import { Outlet, NavLink, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMyProfile } from '@/api';
import { hasSession, tokenStore } from '@/api/http';
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
} from 'lucide-react';
import { useTheme } from '../hooks/use-theme';
import { getAggregateMarketStatus, forceRefreshAllQuotes } from '../hooks/use-market-quotes';
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

/** Profile shape used by the sidebar user block. */
interface SidebarProfile {
  id: string;
  username: string;
  displayName: string | null;
}

/**
 * Root layout component. Renders the responsive sidebar (off-canvas on
 * mobile), top bar with page title + market indicator, and the routed
 * `<Outlet/>`. Redirects to /login when no session exists.
 */
function Layout() {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (!hasSession()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

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
            <SidebarUserBlock />
            <button
              onClick={toggleTheme}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
            </button>
            <LogoutButton />
          </div>
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

/**
 * Sidebar user block: avatar with initial, display name and username.
 * Fetches GET /api/auth/me (react-query); shows skeletons until resolved.
 */
function SidebarUserBlock() {
  const { data: profile, isLoading } = useQuery<SidebarProfile>({
    queryKey: ['auth', 'me'],
    queryFn: fetchMyProfile,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const name = profile?.displayName || profile?.username || '';
  const initial = name ? name.charAt(0).toUpperCase() : '?';

  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent text-sm font-semibold text-sidebar-accent-foreground">
        {isLoading ? <Skeleton className="h-8 w-8 rounded-full" /> : initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-sidebar-foreground">
          {isLoading ? <Skeleton className="h-4 w-16" /> : name || '未知用户'}
        </div>
        <div className="truncate text-xs text-sidebar-foreground/50">
          {isLoading ? <Skeleton className="mt-1 h-3 w-12" /> : `@${profile?.username ?? ''}`}
        </div>
      </div>
    </div>
  );
}

/** Sign out: drop the local session and return to the login page. */
function LogoutButton() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleLogout = () => {
    tokenStore.clear();
    queryClient.clear();
    navigate('/login', { replace: true });
  };

  return (
    <button
      onClick={handleLogout}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
    >
      <LogOut size={18} />
      <span>退出登录</span>
    </button>
  );
}

export default Layout;
