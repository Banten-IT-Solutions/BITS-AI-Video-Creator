import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpenText,
  CircleDot,
  Clapperboard,
  Database,
  LayoutDashboard,
  ListChecks,
  Menu,
  Mic2,
  MoreHorizontal,
  Puzzle,
  RefreshCw,
  ScrollText,
  Settings,
  Users,
  Wrench,
  Workflow as WorkflowIcon,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { formatNumber, relativeTime } from "../lib/format";
import { navigate, type Page, type Route } from "../lib/router";
import type { DashboardStats, Settings as SettingsModel, StorageInfo } from "../lib/types";
import { cn, IconButton, Spinner } from "./ui";

type NavItem = { page: Page; label: string; icon: LucideIcon; path: string };

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Studio",
    items: [
      { page: "dashboard", label: "Overview", icon: LayoutDashboard, path: "/" },
      { page: "storyboards", label: "Storyboards", icon: Clapperboard, path: "/storyboards" },
      { page: "voiceover", label: "Voiceover", icon: Mic2, path: "/voiceover" },
      { page: "prompts", label: "Prompt library", icon: BookOpenText, path: "/prompts" },
    ],
  },
  {
    label: "Providers",
    items: [
      { page: "accounts", label: "Accounts", icon: Users, path: "/accounts" },
      { page: "tools", label: "Provider tools", icon: Wrench, path: "/tools" },
    ],
  },
  {
    label: "Automation",
    items: [
      { page: "workflows", label: "Automations", icon: WorkflowIcon, path: "/workflows" },
      { page: "runs", label: "Runs", icon: ListChecks, path: "/runs" },
      { page: "logs", label: "Logs", icon: ScrollText, path: "/logs" },
    ],
  },
  {
    label: "System",
    items: [{ page: "plugins", label: "Plugins", icon: Puzzle, path: "/plugins" }],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

const MOBILE_NAV = NAV_ITEMS.filter((item) =>
  ["dashboard", "storyboards", "voiceover", "accounts"].includes(item.page),
);

const PAGE_TITLES: Record<string, string> = {
  dashboard: "Production overview",
  storyboards: "Storyboards",
  voiceover: "Voiceover studio",
  accounts: "Accounts",
  workflows: "Automations",
  workflow: "Automation editor",
  prompts: "Prompt library",
  tools: "Provider tools",
  plugins: "Plugins",
  runs: "Runs",
  logs: "Logs",
  settings: "Settings",
};

type DashboardState = UseQueryResult<DashboardStats>;
type SettingsState = UseQueryResult<SettingsModel>;
type StorageState = UseQueryResult<StorageInfo>;

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [navOpen, setNavOpen] = useState(false);
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.getDashboard,
    refetchInterval: 6_000,
  });
  const storage = useQuery({ queryKey: ["storage"], queryFn: api.getStorageInfo, staleTime: 60_000 });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });

  const activePage = route.page;
  const routeKey = route.page === "workflow" ? `workflow:${route.id}` : route.page;
  const queue = dashboard.data ? dashboard.data.queuedRuns + dashboard.data.runningRuns : 0;
  const engineHealthy = !dashboard.isError;

  useEffect(() => {
    setNavOpen(false);
  }, [routeKey]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside className="hidden w-[238px] shrink-0 flex-col border-r border-line/80 bg-surface/55 md:flex">
        <SidebarBrand />
        <SidebarNav activePage={activePage} queue={queue} />
        <SystemCard
          dashboard={dashboard}
          settings={settings}
          storage={storage}
          queue={queue}
          engineHealthy={engineHealthy}
        />
      </aside>

      {navOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
            onClick={() => setNavOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-[86%] max-w-[324px] flex-col border-r border-line/80 bg-surface shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="flex items-start justify-between pr-2">
              <SidebarBrand onNavigate={() => setNavOpen(false)} />
              <IconButton label="Close navigation" size="sm" className="mt-4" onClick={() => setNavOpen(false)}>
                <X size={17} />
              </IconButton>
            </div>
            <SidebarNav activePage={activePage} queue={queue} onNavigate={() => setNavOpen(false)} />
            <SystemCard
              dashboard={dashboard}
              settings={settings}
              storage={storage}
              queue={queue}
              engineHealthy={engineHealthy}
            />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mobile-safe-top flex min-h-[58px] shrink-0 items-center justify-between gap-3 border-b border-line/70 bg-bg/55 px-4 backdrop-blur-sm md:px-6">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel text-muted md:hidden"
              aria-label="Open navigation"
            >
              <Menu size={17} />
            </button>
            <span className="hidden text-faint sm:inline">BITS AI Video Creator</span>
            <span className="hidden text-line sm:inline">/</span>
            <span className="truncate font-medium text-fg">{PAGE_TITLES[route.page] ?? "Workspace"}</span>
            {route.page === "workflow" ? (
              <span className="hidden rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[9px] text-faint sm:inline">
                editor
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            {dashboard.data?.runningRuns ? (
              <span className="flex items-center gap-1.5 rounded-full border border-info/25 bg-info/10 px-2 py-1 text-[10px] font-medium text-info sm:px-2.5">
                <Activity size={11} className="animate-pulse" />
                <span className="hidden sm:inline">{dashboard.data.runningRuns} running</span>
                <span className="sm:hidden">{dashboard.data.runningRuns}</span>
              </span>
            ) : null}
            {dashboard.data?.nextScheduledRun ? (
              <span className="hidden text-[10px] text-faint lg:inline">
                Next schedule {relativeTime(dashboard.data.nextScheduledRun)}
              </span>
            ) : null}
            <IconButton
              label="Refresh data"
              size="sm"
              onClick={() => {
                void queryClient.invalidateQueries();
              }}
            >
              {dashboard.isFetching ? <Spinner size={13} /> : <RefreshCw size={14} />}
            </IconButton>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>

      <nav
        className="mobile-safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line/80 bg-surface/95 backdrop-blur-md md:hidden"
        aria-label="Mobile navigation"
      >
        <div className="grid grid-cols-5">
          {MOBILE_NAV.map((item) => {
            const active =
              activePage === item.page || (item.page === "workflows" && activePage === "workflow");
            return (
              <button
                key={item.page}
                type="button"
                onClick={() => navigate(item.path)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-w-0 min-h-[56px] flex-col items-center justify-center gap-1 px-1 pb-1 pt-2 text-[9px] font-medium",
                  active ? "text-accent" : "text-faint",
                )}
              >
                {active ? (
                  <span className="absolute inset-x-5 top-0 h-[2px] rounded-full bg-accent" />
                ) : null}
                <item.icon size={18} strokeWidth={active ? 2 : 1.7} />
                <span className="block w-full truncate text-center">{item.label}</span>
                {item.page === "runs" && queue > 0 ? (
                  <span className="absolute right-3 top-1.5 min-w-[15px] rounded-full bg-info px-1 text-[8px] leading-[15px] text-bg">
                    {queue > 99 ? "99+" : queue}
                  </span>
                ) : null}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="flex min-w-0 min-h-[56px] flex-col items-center justify-center gap-1 px-1 pb-1 pt-2 text-[9px] font-medium text-faint"
          >
            <MoreHorizontal size={18} strokeWidth={1.7} />
            <span className="block w-full truncate text-center">More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

function SidebarBrand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        navigate("/");
        onNavigate?.();
      }}
      className="flex items-center gap-3 px-5 pb-5 pt-6 text-left"
      aria-label="Go to overview"
    >
      <span className="relative flex h-9 w-9 items-center justify-center rounded-[10px] border border-accent/25 bg-accent/10 text-accent shadow-glow">
        <Clapperboard size={18} strokeWidth={1.8} />
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-surface bg-accent" />
      </span>
      <span>
        <span className="block text-[13px] font-semibold leading-4 tracking-[0.02em] text-fg">BITS AI Video Creator</span>
        <span className="block text-[9px] font-medium uppercase tracking-[0.2em] text-faint">AI video studio</span>
      </span>
    </button>
  );
}

function SidebarNav({
  activePage,
  queue,
  onNavigate,
}: {
  activePage: string;
  queue: number;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-2" aria-label="Primary navigation">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-2.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-faint">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavItem
                key={item.page}
                icon={<item.icon size={16} strokeWidth={1.7} />}
                label={item.label}
                active={
                  activePage === item.page ||
                  (item.page === "workflows" && activePage === "workflow")
                }
                badge={item.page === "runs" && queue > 0 ? formatNumber(queue) : undefined}
                onClick={() => {
                  navigate(item.path);
                  onNavigate?.();
                }}
              />
            ))}
          </div>
        </div>
      ))}
      <div>
        <p className="mb-1.5 px-2.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-faint">Workspace</p>
        <div className="space-y-0.5">
          <NavItem
            icon={<Settings size={16} strokeWidth={1.7} />}
            label="Settings"
            active={activePage === "settings"}
            onClick={() => {
              navigate("/settings");
              onNavigate?.();
            }}
          />
          <NavItem
            icon={<Database size={16} strokeWidth={1.7} />}
            label="Storage"
            active={false}
            onClick={() => {
              navigate("/settings?tab=data");
              onNavigate?.();
            }}
          />
        </div>
      </div>
    </nav>
  );
}

function SystemCard({
  dashboard,
  settings,
  storage,
  queue,
  engineHealthy,
}: {
  dashboard: DashboardState;
  settings: SettingsState;
  storage: StorageState;
  queue: number;
  engineHealthy: boolean;
}) {
  return (
    <div className="mt-auto border-t border-line/70 p-3">
      <div className="rounded-xl border border-line/80 bg-panel/80 p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.1em] text-faint">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                dashboard.isLoading ? "bg-warn animate-pulsebar" : engineHealthy ? "bg-accent" : "bg-danger",
              )}
            />
            {dashboard.isLoading ? "Starting" : engineHealthy ? "Studio ready" : "Studio offline"}
          </span>
          <span className="numeric text-[10px] text-faint">{queue} queued</span>
        </div>
        <dl className="mt-2.5 grid grid-cols-2 gap-2 border-t border-line/60 pt-2.5 text-[10px]">
          <div>
            <dt className="text-faint">Storyboards</dt>
            <dd className="numeric mt-0.5 text-xs text-fg">
              {formatNumber(dashboard.data?.totalStoryboards ?? 0)}
            </dd>
          </div>
          <div>
            <dt className="text-faint">Accounts</dt>
            <dd className="numeric mt-0.5 text-xs text-fg">{formatNumber(dashboard.data?.totalAccounts ?? 0)}</dd>
          </div>
        </dl>
        <div className="mt-2.5 flex items-center justify-between border-t border-line/60 pt-2 text-[10px] text-faint">
          <span className="inline-flex items-center gap-1.5">
            <CircleDot size={10} className={settings.data?.schedulerEnabled === false ? "text-warn" : "text-accent"} />
            Scheduler {settings.data?.schedulerEnabled === false ? "paused" : "on"}
          </span>
          <span>v{storage.data?.appVersion ?? "1.0.0"}</span>
        </div>
      </div>
      <p className="mt-2 px-1 text-[9px] leading-4 text-faint">Local-first · SQLite · OS keyring</p>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors",
        active ? "bg-raised/90 text-fg" : "text-muted hover:bg-raised/50 hover:text-fg",
      )}
    >
      {active ? <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-accent" /> : null}
      <span className={cn("shrink-0 transition-colors", active ? "text-accent" : "text-faint group-hover:text-muted")}>
        {icon}
      </span>
      <span className="truncate">{label}</span>
      {badge ? (
        <span className="numeric ml-auto rounded-full border border-info/25 bg-info/10 px-1.5 py-0.5 text-[9px] font-semibold text-info">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={cn("mx-auto max-w-[1520px] px-4 pb-28 pt-4 sm:px-6 md:px-7 md:pb-14 md:pt-6", className)}>
        {children}
      </div>
    </div>
  );
}
