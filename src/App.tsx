import { useQuery } from "@tanstack/react-query";
import { Component, Suspense, lazy, useEffect, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { AppShell } from "./components/Layout";
import { LicenseGate } from "./components/LicenseGate";
import { Button } from "./components/ui";
import { api } from "./lib/api";
import { useRoute } from "./lib/router";
import { AccountsPage } from "./pages/Accounts";
import { DashboardPage } from "./pages/Dashboard";
import { LogsPage } from "./pages/Logs";
import { PluginsPage } from "./pages/Plugins";
import { PromptsPage } from "./pages/Prompts";
import { RunsPage } from "./pages/Runs";
import { SettingsPage } from "./pages/Settings";
import { StoryboardsPage } from "./pages/Storyboards";
import { ToolsPage } from "./pages/Tools";
import { VoiceoverPage } from "./pages/Voiceover";
import { WorkflowsPage } from "./pages/Workflows";

const WorkflowEditorPage = lazy(() =>
  import("./pages/WorkflowEditor").then((module) => ({ default: module.WorkflowEditorPage })),
);

function useTheme(theme: string | undefined) {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "light" : "dark") : (theme ?? "dark");
      document.documentElement.dataset.theme = resolved;
      document.documentElement.classList.toggle("dark", resolved === "dark");
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI crashed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-2xl border border-danger/30 bg-panel p-6 shadow-panel">
            <div className="flex items-center gap-3 text-danger">
              <AlertTriangle size={20} />
              <h1 className="text-base font-semibold">The interface stopped unexpectedly</h1>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted">
              Your local data was not modified by this error. Reload the interface to continue. If the problem
              repeats, check the application logs from a fresh session.
            </p>
            <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface p-3 font-mono text-[11px] text-muted">
              {this.state.error.message}
            </pre>
            <div className="mt-5 flex gap-2">
              <Button variant="primary" onClick={() => window.location.reload()}>
                Reload interface
              </Button>
              <Button variant="ghost" onClick={() => this.setState({ error: null })}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function CurrentPage() {
  const route = useRoute();
  switch (route.page) {
    case "storyboards":
      return <StoryboardsPage />;
    case "voiceover":
      return <VoiceoverPage />;
    case "accounts":
      return <AccountsPage />;
    case "workflows":
      return <WorkflowsPage />;
    case "workflow":
      return <WorkflowEditorPage workflowId={route.id} />;
    case "runs":
      return <RunsPage />;
    case "logs":
      return <LogsPage />;
    case "prompts":
      return <PromptsPage />;
    case "tools":
      return <ToolsPage />;
    case "plugins":
      return <PluginsPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return <DashboardPage />;
  }
}

export function App() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const license = useQuery({
    queryKey: ["license"],
    queryFn: api.getLicenseState,
    staleTime: 15_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
  useTheme(settings.data?.theme);
  const route = useRoute();

  if (license.isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-xs text-muted">
        <Loader2 size={16} className="mr-2 animate-spin text-accent" /> Verifying license…
      </div>
    );
  }

  if (license.isError) {
    return (
      <div className="flex h-full items-center justify-center bg-bg p-6">
        <div className="max-w-md rounded-2xl border border-danger/30 bg-panel p-6">
          <div className="flex items-center gap-2 text-danger">
            <ShieldAlert size={18} />
            <h1 className="text-sm font-semibold">License state unavailable</h1>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">
            BITS AI Video Creator could not read its local license state. The workspace is blocked rather than guessing.
          </p>
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-line bg-surface p-3 font-mono text-[10px] text-muted">
            {license.error.message}
          </pre>
          <Button className="mt-4" variant="secondary" onClick={() => void license.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <LicenseGate state={license.data}>
      <ErrorBoundary>
        <AppShell route={route}>
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center p-10 text-xs text-muted">
                <Loader2 size={15} className="mr-2 animate-spin text-accent" /> Loading editor…
              </div>
            }
          >
            <CurrentPage />
          </Suspense>
        </AppShell>
      </ErrorBoundary>
    </LicenseGate>
  );
}
