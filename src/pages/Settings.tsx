import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  CloudDownload,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  HardDrive,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Sun,
  Trash2,
  Unlink,
  Upload,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { PageContainer } from "../components/Layout";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  IconButton,
  Input,
  PageHeader,
  SectionLabel,
  Select,
  Tabs,
  Toggle,
} from "../components/ui";
import { api, toApiError } from "../lib/api";
import { formatBytes, formatDateTime, relativeTime, truncate, type Tone } from "../lib/format";
import { isAndroid } from "../lib/platform";
import { setBeforeNavigate } from "../lib/router";
import { translate, useI18n } from "../i18n";
import { LanguageToggle } from "../components/LanguageToggle";
import { resetOnboarding } from "../components/Onboarding";
import type {
  DuplicateStrategy,
  ImportPreview,
  LicenseState,
  LocalApiStatus,
  Settings,
  UpdateInfo,
} from "../lib/types";

type Tab = "general" | "engine" | "integrations" | "secrets" | "data" | "about";

const LICENSE_STATUS_META: Record<LicenseState["status"], { tone: Tone }> = {
  licensed: { tone: "success" },
  unlinked: { tone: "neutral" },
  expired: { tone: "warning" },
  error: { tone: "danger" },
};

const LICENSE_STATUS_FALLBACK: Record<LicenseState["status"], string> = {
  licensed: "Active",
  unlinked: "Not linked",
  expired: "Expired",
  error: "Error",
};

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "general", label: "General" },
  { id: "engine", label: "Engine" },
  { id: "integrations", label: "Integrations" },
  { id: "secrets", label: "Secrets" },
  { id: "data", label: "Data & backup" },
  { id: "about", label: "About" },
];

const TAB_KEYS: Record<Tab, string> = {
  general: "settings.tab.general",
  engine: "settings.tab.engine",
  integrations: "settings.tab.integrations",
  secrets: "settings.tab.secrets",
  data: "settings.tab.data",
  about: "settings.tab.about",
};

function initialTab(): Tab {
  const hash = window.location.hash;
  const queryIndex = hash.indexOf("?");
  if (queryIndex >= 0) {
    const params = new URLSearchParams(hash.slice(queryIndex + 1));
    const value = params.get("tab");
    if (value && TABS.some((tab) => tab.id === value)) return value as Tab;
  }
  return "general";
}

function ThemeOption({
  value,
  current,
  title,
  description,
  icon,
  onSelect,
}: {
  value: "dark" | "light" | "system";
  current: string;
  title: string;
  description: string;
  icon: ReactNode;
  onSelect: (value: "dark" | "light" | "system") => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
        active ? "border-accent/40 bg-accent/[0.05]" : "border-line/80 bg-surface/50 hover:border-faint/50"
      }`}
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? "bg-accent/10 text-accent" : "bg-raised text-muted"}`}>
        {icon}
      </span>
      <span>
        <span className="flex items-center gap-1.5 text-xs font-medium text-fg">
          {title}
          {active ? <CheckCircle2 size={11} className="text-accent" /> : null}
        </span>
        <span className="mt-1 block text-[10.5px] leading-4 text-muted">{description}</span>
      </span>
    </button>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const onHashChange = () => setTab(initialTab());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const selectTab = (next: Tab) => {
    setTab(next);
    const target = next === "general" ? "#/settings" : `#/settings?tab=${next}`;
    if (window.location.hash !== target) {
      window.history.replaceState(null, "", target);
    }
  };

  const settings = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const storage = useQuery({ queryKey: ["storage"], queryFn: api.getStorageInfo });
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: api.getDashboard });

  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data);
  }, [settings.data, draft]);

  useEffect(() => {
    if (!dirty) {
      setBeforeNavigate(null);
      return;
    }
    setBeforeNavigate(() =>
      window.confirm(
        translate(
          "settings.unsavedConfirm",
          "Settings have unsaved changes. Discard them and leave this page?",
        ),
      )
    );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      setBeforeNavigate(null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, language]);

  const patch = (partial: Partial<Settings>) => {
    if (!draft) return;
    setDraft({ ...draft, ...partial });
    setDirty(true);
  };

  const saveSettings = useMutation({
    mutationFn: (value: Settings) => api.updateSettings(value),
    onSuccess: (updated) => {
      setDraft(updated);
      setDirty(false);
      toast.success(
        t("settings.savedTitle", "Settings saved"),
        t("settings.savedBody", "Engine and scheduler settings were updated."),
      );
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["local-api"] });
      void queryClient.invalidateQueries({ queryKey: ["license"] });
    },
    onError: (cause) => toast.error(t("settings.saveFailedTitle", "Unable to save settings"), toApiError(cause).message),
  });

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("nav.group.system", "System")}
        title={t("page.settings", "Settings")}
        description={t(
          "settings.description",
          "Local engine behavior, OS keyring metadata, data portability, and storage details. Settings are stored in SQLite; secret values only live in the operating system credential vault.",
        )}
        actions={
          tab === "general" || tab === "engine" || tab === "integrations" ? (
            <>
              {dirty ? <Badge tone="warning" dot>{t("settings.unsavedChanges", "Unsaved changes")}</Badge> : null}
              <Button
                variant="primary"
                icon={<Save size={14} />}
                loading={saveSettings.isPending}
                disabled={!draft || !dirty}
                onClick={() => {
                  if (draft) saveSettings.mutate(draft);
                }}
              >
                {t("settings.saveSettings", "Save settings")}
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="mt-5">
        <Tabs
          tabs={TABS.map((item) => ({ id: item.id, label: t(TAB_KEYS[item.id], item.label) }))}
          value={tab}
          onChange={selectTab}
        />
      </div>

      {!draft && settings.isLoading ? (
        <div className="mt-6 flex items-center gap-2 text-xs text-muted">
          <SpinnerInline /> {t("settings.loadingSettings", "Loading settings…")}
        </div>
      ) : settings.isError ? (
        <Card className="mt-6 border-danger/30 p-4 text-xs text-danger">{settings.error.message}</Card>
      ) : null}

      {draft && tab === "general" ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
          <Card className="xl:col-span-2">
            <CardHeader
              title={t("language.title", "Language")}
              description={t(
                "language.description",
                "The interface language applies immediately and is stored on this device.",
              )}
              actions={<LanguageToggle />}
            />
            <p className="p-4 text-[10.5px] leading-4 text-faint">
              {t(
                "language.hint",
                "English is the default. Switch to Bahasa Indonesia to translate the whole interface; some provider and backend messages stay in English.",
              )}
            </p>
          </Card>
          <Card>
            <CardHeader
              title={t("settings.appearance.title", "Appearance")}
              description={t("settings.appearance.description", "Theme is applied to the whole interface and persisted locally.")}
            />
            <div className="grid gap-2 p-4 sm:grid-cols-3">
              <ThemeOption
                value="dark"
                current={draft.theme}
                title={t("settings.theme.dark", "Dark")}
                description={t("settings.theme.darkDesc", "Low-light control room.")}
                icon={<Moon size={15} />}
                onSelect={(value) => patch({ theme: value })}
              />
              <ThemeOption
                value="light"
                current={draft.theme}
                title={t("settings.theme.light", "Light")}
                description={t("settings.theme.lightDesc", "Bright workspace.")}
                icon={<Sun size={15} />}
                onSelect={(value) => patch({ theme: value })}
              />
              <ThemeOption
                value="system"
                current={draft.theme}
                title={t("settings.theme.system", "System")}
                description={t("settings.theme.systemDesc", "Follow the OS preference.")}
                icon={<Monitor size={15} />}
                onSelect={(value) => patch({ theme: value })}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title={t("settings.retention.title", "Log retention")}
              description={t("settings.retention.description", "Old entries are pruned at startup and when logs are written.")}
            />
            <div className="space-y-4 p-4">
              <Field label={t("settings.retention.days", "Retention (days)")} hint={t("settings.retention.daysHint", "1–365 days.")}>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={draft.logRetentionDays}
                  onChange={(event) => patch({ logRetentionDays: Number(event.target.value) })}
                  className="numeric"
                />
              </Field>
              <Field label={t("settings.retention.maxRows", "Maximum log rows")} hint={t("settings.retention.maxRowsHint", "1,000–100,000 rows.")}>
                <Input
                  type="number"
                  min={1000}
                  max={100000}
                  step={1000}
                  value={draft.maxLogRows}
                  onChange={(event) => patch({ maxLogRows: Number(event.target.value) })}
                  className="numeric"
                />
              </Field>
              <p className="rounded-lg border border-line/70 bg-surface/60 p-3 text-[10.5px] leading-4 text-faint">
                {t(
                  "settings.retention.note",
                  "Retention affects logs only. Run history and step output are retained until the database is removed or replaced by a restore.",
                )}
              </p>
            </div>
          </Card>
        </div>
      ) : null}

      {draft && tab === "engine" ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <Card>
            <CardHeader
              title={t("settings.engine.title", "Execution engine")}
              description={t(
                "settings.engine.description",
                "Workers poll the durable run queue. Timeout, retry, and network changes apply to new runs immediately; the worker count changes on the next launch.",
              )}
            />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field
                label={t("settings.engine.workers", "Concurrent workers")}
                hint={t("settings.engine.workersHint", "1–8. Worker count is applied on the next app launch.")}
              >
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={draft.concurrency}
                  onChange={(event) => patch({ concurrency: Number(event.target.value) })}
                  className="numeric"
                />
              </Field>
              <Field
                label={t("settings.engine.timeout", "Run timeout (seconds)")}
                hint={t("settings.engine.timeoutHint", "5–3,600 seconds per run.")}
              >
                <Input
                  type="number"
                  min={5}
                  max={3600}
                  value={draft.runTimeoutSeconds}
                  onChange={(event) => patch({ runTimeoutSeconds: Number(event.target.value) })}
                  className="numeric"
                />
              </Field>
              <Field
                label={t("settings.engine.retries", "Default retries")}
                hint={t("settings.engine.retriesHint", "0–5. Applies to HTTP and account-check steps.")}
              >
                <Input
                  type="number"
                  min={0}
                  max={5}
                  value={draft.maxRetries}
                  onChange={(event) => patch({ maxRetries: Number(event.target.value) })}
                  className="numeric"
                />
              </Field>
              <Field
                label={t("settings.engine.retryDelay", "Retry delay (ms)")}
                hint={t("settings.engine.retryDelayHint", "100–60,000 ms between attempts.")}
              >
                <Input
                  type="number"
                  min={100}
                  max={60000}
                  value={draft.retryDelayMs}
                  onChange={(event) => patch({ retryDelayMs: Number(event.target.value) })}
                  className="numeric"
                />
              </Field>
              <div className="sm:col-span-2">
                <Toggle
                  checked={draft.schedulerEnabled}
                  onChange={(value) => patch({ schedulerEnabled: value })}
                  label={t("settings.engine.scheduler", "Scheduler enabled")}
                  description={t(
                    "settings.engine.schedulerDesc",
                    "Pausing stops new scheduled runs. Missed slots are recorded but never replayed automatically.",
                  )}
                />
              </div>
              <div className="sm:col-span-2 rounded-lg border border-warn/25 bg-warn/[0.035] p-3">
                <Toggle
                  checked={draft.allowLocalNetwork}
                  onChange={(value) => patch({ allowLocalNetwork: value })}
                  label={t("settings.engine.allowLocalNetwork", "Allow local network HTTP requests")}
                  description={t(
                    "settings.engine.allowLocalNetworkDesc",
                    "Required by HTTP nodes that opt into localhost or private addresses. Enabling this weakens SSRF protection; leave it off unless a workflow needs a local service.",
                  )}
                />
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader
                title={t("settings.runtime.title", "Runtime state")}
                description={t("settings.runtime.description", "Read from the running desktop engine.")}
              />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-xs">
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">{t("settings.runtime.scheduler", "Scheduler")}</dt>
                  <dd className="mt-1">
                    <Badge tone={dashboard.data?.schedulerEnabled ? "success" : "warning"} dot>
                      {dashboard.data?.schedulerEnabled ? t("status.active", "Active") : t("status.paused", "Paused")}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">{t("settings.runtime.queue", "Queue")}</dt>
                  <dd className="numeric mt-1 text-sm text-fg">
                    {(dashboard.data?.queuedRuns ?? 0) + (dashboard.data?.runningRuns ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">{t("settings.runtime.running", "Running")}</dt>
                  <dd className="numeric mt-1 text-sm text-fg">{dashboard.data?.runningRuns ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">{t("settings.runtime.nextSchedule", "Next schedule")}</dt>
                  <dd className="mt-1 text-[11px] text-fg">
                    {dashboard.data?.nextScheduledRun ? relativeTime(dashboard.data.nextScheduledRun) : t("common.none", "None")}
                  </dd>
                </div>
              </dl>
              <p className="border-t border-line/60 px-4 py-3 text-[10px] leading-4 text-faint">
                {t(
                  "settings.runtime.note",
                  "Scheduler ticks every 15 seconds. Slots older than five minutes are recorded as missed. Interrupted runs are marked failed on startup.",
                )}
              </p>
            </Card>
            <Card>
              <CardHeader
                title={t("settings.safety.title", "Safety limits")}
                description={t("settings.safety.description", "Applied by the local core.")}
              />
              <ul className="space-y-2 p-4 text-[10.5px] leading-4 text-muted">
                <li>{t("settings.safety.item1", "HTTP responses are capped at 1 MB and requests time out per node.")}</li>
                <li>{t("settings.safety.item2", "Run input is capped at 256 KB; imports at 20 MB.")}</li>
                <li>{t("settings.safety.item3", "Private and loopback hosts are rejected unless explicitly allowed.")}</li>
                <li>{t("settings.safety.item4", "Secret values are redacted from logs and step output.")}</li>
              </ul>
            </Card>
          </div>
        </div>
      ) : null}

      {draft && tab === "integrations" ? <IntegrationsTab draft={draft} patch={patch} /> : null}
      {tab === "secrets" ? <SecretsTab /> : null}
      {tab === "data" ? <DataTab /> : null}

      {tab === "about" && storage.data ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <Card>
            <CardHeader
              title={t("settings.about.app.title", "Application")}
              description={t(
                "settings.about.app.description",
                "Local-first AI video studio for storyboards, voiceover, and supporting automation.",
              )}
            />
            <dl className="grid grid-cols-2 gap-x-5 gap-y-4 p-4 text-xs">
              <div>
                <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">{t("settings.about.version", "Version")}</dt>
                <dd className="mt-1 font-mono text-[11px] text-fg">{storage.data.appVersion}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">{t("settings.about.platform", "Platform")}</dt>
                <dd className="mt-1 capitalize text-[11px] text-fg">{storage.data.platform}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">{t("settings.about.schema", "Schema")}</dt>
                <dd className="numeric mt-1 text-[11px] text-fg">v{storage.data.schemaVersion}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">{t("settings.about.secretBackend", "Secret backend")}</dt>
                <dd className="mt-1 text-[11px] text-fg">{storage.data.secretStore}</dd>
              </div>
            </dl>
            <p className="border-t border-line/60 px-4 py-3 text-[10.5px] leading-4 text-faint">
              {t(
                "settings.about.note",
                "Local-first desktop application. No telemetry, cloud account, or remote control plane is required.",
              )}
            </p>
          </Card>
          <Card>
            <CardHeader
              title={t("settings.about.credits.title", "Credits & licenses")}
              description={t("settings.about.credits.description", "Attribution for source and dependencies.")}
            />
            <div className="space-y-2 p-4 text-[10.5px] leading-4 text-muted">
              {/* ponytail: proper attribution text stays English */}
              <p>Built with Tauri 2, React 18, React Flow, Tailwind CSS, and Rust.</p>
              <p>
                {t(
                  "settings.about.credits.automation",
                  "Automation remains available as a supporting module for provider checks, repeatable production tasks, and local HTTP work.",
                )}
              </p>
              <p>Provider account-management behavior was informed by public Flow Account Manager release notes; no source code was available. See NOTICE.</p>
            </div>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader
              title={t("onboarding.resetTitle", "Onboarding")}
              description={t(
                "onboarding.resetDescription",
                "Show the welcome tour and setup checklist again.",
              )}
            />
            <div className="p-4">
              <Button
                size="sm"
                variant="secondary"
                icon={<Rocket size={13} />}
                onClick={() => resetOnboarding()}
              >
                {t("onboarding.resetButton", "Show onboarding")}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
      {tab === "about" && !storage.data ? (
        <div className="mt-6 flex items-center gap-2 text-xs text-muted">
          <Loader2 size={14} className="animate-spin" /> {t("settings.about.loadingStorage", "Loading storage details…")}
        </div>
      ) : null}

      {tab === "general" || tab === "engine" || tab === "integrations" ? (
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            icon={<Save size={14} />}
            loading={saveSettings.isPending}
            disabled={!draft || !dirty}
            onClick={() => {
              if (draft) saveSettings.mutate(draft);
            }}
          >
            {t("settings.saveSettings", "Save settings")}
          </Button>
        </div>
      ) : null}
    </PageContainer>
  );
}


function IntegrationsTab({
  draft,
  patch,
}: {
  draft: Settings;
  patch: (partial: Partial<Settings>) => void;
}) {
  const { t } = useI18n();
  const android = isAndroid();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [proxyPassword, setProxyPassword] = useState("");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<UpdateInfo | null | undefined>(undefined);
  const [installOpen, setInstallOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);

  const secrets = useQuery({ queryKey: ["secrets"], queryFn: api.listSecrets });
  const localApi = useQuery({ queryKey: ["local-api"], queryFn: api.getLocalApiStatus });
  const license = useQuery({ queryKey: ["license"], queryFn: api.getLicenseState, staleTime: 15_000 });

  const saveProxy = useMutation({
    mutationFn: () => api.setProxyPassword(proxyPassword.trim() || null),
    onSuccess: () => {
      toast.success(
        t("settings.ai.proxySavedTitle", "Proxy credentials updated"),
        t("settings.ai.proxySavedBody", "The engine and AI drafts use the new proxy on the next request."),
      );
      setProxyPassword("");
    },
    onError: (cause) => toast.error(t("settings.ai.proxySaveFailed", "Unable to save proxy credentials"), toApiError(cause).message),
  });

  const reveal = useMutation({
    mutationFn: api.revealLocalApiToken,
    onSuccess: (token) => {
      setRevealedToken(token);
      toast.info(
        t("settings.localApi.revealedTitle", "Local API token revealed"),
        t("settings.localApi.revealedBody", "Store it in your local client. Rotate it if it leaks."),
      );
    },
    onError: (cause) => toast.error(t("settings.localApi.revealFailed", "Unable to reveal token"), toApiError(cause).message),
  });

  const rotate = useMutation({
    mutationFn: api.rotateLocalApiToken,
    onSuccess: (token) => {
      setRevealedToken(token);
      toast.success(
        t("settings.localApi.rotatedTitle", "Local API token rotated"),
        t("settings.localApi.rotatedBody", "Existing clients must use the new token immediately."),
      );
      void queryClient.invalidateQueries({ queryKey: ["local-api"] });
    },
    onError: (cause) => toast.error(t("settings.localApi.rotateFailed", "Unable to rotate token"), toApiError(cause).message),
  });

  const check = useMutation({
    mutationFn: api.checkForUpdates,
    onSuccess: (result) => {
      setUpdateResult(result);
      if (result) {
        toast.success(
          t("settings.updates.availableToastTitle", "Update available"),
          t("settings.updates.availableToastBody", "Version {version} is ready to install.", { version: result.version }),
        );
      } else {
        toast.info(
          t("settings.updates.upToDateToastTitle", "Up to date"),
          t("settings.updates.upToDateToastBody", "No newer release was found at the configured endpoint."),
        );
      }
    },
    onError: (cause) => {
      setUpdateResult(undefined);
      toast.error(t("settings.updates.checkFailed", "Update check failed"), toApiError(cause).message);
    },
  });

  const install = useMutation({
    mutationFn: api.installUpdate,
    onSuccess: () => {
      toast.success(t("settings.updates.installedTitle", "Update installed"), t("settings.updates.installedBody", "BITS AI Video Creator is restarting."));
      setInstallOpen(false);
    },
    onError: (cause) => {
      setInstallOpen(false);
      toast.error(t("settings.updates.installFailed", "Update installation failed"), toApiError(cause).message);
    },
  });

  const unlink = useMutation({
    mutationFn: api.unlinkLicense,
    onSuccess: () => {
      toast.success(t("settings.license.unlinkedTitle", "License unlinked"), t("settings.license.unlinkedBody", "Connect your license again to continue."));
      setUnlinkOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["license"] });
    },
    onError: (cause) => toast.error(t("settings.license.unlinkFailed", "Unable to unlink license"), toApiError(cause).message),
  });

  const refreshLicense = useMutation({
    mutationFn: api.refreshLicense,
    onSuccess: (next) => {
      queryClient.setQueryData(["license"], next);
      void queryClient.invalidateQueries({ queryKey: ["license"] });
    },
    onError: (cause) => toast.error(t("settings.license.refreshFailed", "Unable to refresh license"), toApiError(cause).message),
  });

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("settings.labelCopied", "{label} copied", { label }));
    } catch {
      toast.error(t("settings.clipboardUnavailable", "Clipboard unavailable"));
    }
  };

  const aiKeyConfigured = (secrets.data ?? []).some((secret) => secret.name === "ai.api_key");
  const ttsKeyConfigured = (secrets.data ?? []).some(
    (secret) => secret.name === "tts.api_key" || secret.name === "ai.api_key",
  );
  const localStatus: LocalApiStatus | undefined = localApi.data;
  const licenseState: LicenseState | undefined = license.data;
  const licenseMeta = licenseState ? LICENSE_STATUS_META[licenseState.status] : null;

  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader
          title={t("settings.ai.title", "AI workflow drafts")}
          description={t(
            "settings.ai.description",
            "Any OpenAI-compatible chat endpoint. Generated drafts are validated and never saved automatically.",
          )}
          actions={
            <Badge tone={aiKeyConfigured ? "success" : "warning"} dot>
              {aiKeyConfigured ? t("settings.ai.keyStored", "API key stored") : t("settings.ai.noKey", "No API key")}
            </Badge>
          }
        />
        <div className="space-y-4 p-4">
          <Field
            label={t("settings.ai.endpoint", "Endpoint")}
            hint={t("settings.ai.endpointHint", "Example: https://api.openai.com/v1. HTTP requires local-network opt-in.")}
          >
            <Input
              value={draft.aiEndpoint}
              onChange={(event) => patch({ aiEndpoint: event.target.value })}
              placeholder="https://api.openai.com/v1"
              className="font-mono text-[11px]"
              spellCheck={false}
              disabled={android}
            />
          </Field>
          <Field label={t("settings.ai.model", "Model")} hint={t("settings.ai.modelHint", "Provider model identifier, up to 100 characters.")}>
            <Input
              value={draft.aiModel}
              onChange={(event) => patch({ aiModel: event.target.value })}
              placeholder="gpt-4o-mini"
              className="font-mono text-[11px]"
              maxLength={100}
            />
          </Field>
          <div className="rounded-lg border border-line/70 bg-surface/50 p-3 text-[10.5px] leading-4 text-muted">
            {t("settings.ai.secretHintPrefix", "Add a secret named")}{" "}
            <span className="font-mono text-fg">ai.api_key</span>{" "}
            {t(
              "settings.ai.secretHintSuffix",
              "in the Secrets tab. The key is sent only to the configured endpoint and is never returned to the interface.",
            )}
          </div>
          <Field
            label={t("settings.ai.proxyUrl", "HTTP proxy URL")}
            optional
            hint={t("settings.ai.proxyUrlHint", "Used by workflow HTTP nodes and AI drafts, not provider webviews.")}
          >
            <Input
              value={draft.httpProxyUrl ?? ""}
              onChange={(event) => patch({ httpProxyUrl: event.target.value.trim() || null })}
              placeholder="http://proxy.example.com:8080"
              className="font-mono text-[11px]"
              spellCheck={false}
              disabled={android}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("settings.ai.proxyUsername", "Proxy username")} optional>
              <Input
                value={draft.httpProxyUsername ?? ""}
                onChange={(event) => patch({ httpProxyUsername: event.target.value.trim() || null })}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label={t("settings.ai.proxyPassword", "Proxy password")} optional hint={t("settings.ai.proxyPasswordHint", "Write-only; saved to the OS keyring.")}>
              <Input
                type="password"
                value={proxyPassword}
                onChange={(event) => setProxyPassword(event.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
              />
            </Field>
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon={<KeyRound size={12} />}
            loading={saveProxy.isPending}
            onClick={() => saveProxy.mutate()}
          >
            {proxyPassword
              ? t("settings.ai.saveProxyPassword", "Save proxy password")
              : t("settings.ai.removeProxyPassword", "Remove saved proxy password")}
          </Button>
          <p className="text-[9.5px] leading-4 text-faint">
            {t(
              "settings.ai.proxyNote",
              "Proxy credentials are not shown again. Leave the URL empty to connect directly. The engine rejects destination hostnames that resolve to private addresses when a proxy is configured.",
            )}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t("settings.tts.title", "Voiceover provider")}
          description={t(
            "settings.tts.description",
            "Optional OpenAI-compatible speech endpoint for downloadable voice tracks. Browser preview works without a key.",
          )}
          actions={
            <Badge tone={ttsKeyConfigured ? "success" : "warning"} dot>
              {ttsKeyConfigured ? t("settings.tts.keyReady", "TTS key ready") : t("settings.tts.noKey", "No TTS key")}
            </Badge>
          }
        />
        <div className="space-y-4 p-4">
          <Field
            label={t("settings.tts.endpoint", "Endpoint")}
            hint={t("settings.tts.endpointHint", "Example: https://api.openai.com/v1. The app calls /audio/speech.")}
          >
            <Input
              value={draft.ttsEndpoint}
              onChange={(event) => patch({ ttsEndpoint: event.target.value })}
              placeholder="https://api.openai.com/v1"
              className="font-mono text-[11px]"
              spellCheck={false}
              disabled={android}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("settings.tts.model", "Model")}>
              <Input
                value={draft.ttsModel}
                onChange={(event) => patch({ ttsModel: event.target.value })}
                placeholder="gpt-4o-mini-tts"
                className="font-mono text-[11px]"
                maxLength={100}
              />
            </Field>
            <Field label={t("settings.tts.voice", "Voice")}>
              <Input
                value={draft.ttsVoice}
                onChange={(event) => patch({ ttsVoice: event.target.value })}
                placeholder="alloy"
                className="font-mono text-[11px]"
                maxLength={160}
              />
            </Field>
            <Field label={t("settings.tts.format", "Output format")}>
              <Select
                value={draft.ttsFormat}
                onChange={(event) => patch({ ttsFormat: event.target.value })}
              >
                {["mp3", "wav", "opus", "aac", "flac"].map((format) => (
                  <option key={format} value={format}>
                    {format.toUpperCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("settings.tts.speed", "Speed")} hint={t("settings.tts.speedHint", "0.25–4.0")}>
              <Input
                type="number"
                min={0.25}
                max={4}
                step={0.05}
                value={draft.ttsSpeed}
                onChange={(event) =>
                  patch({
                    ttsSpeed: Math.max(0.25, Math.min(4, Number(event.target.value) || 1)),
                  })
                }
                className="numeric"
              />
            </Field>
          </div>
          <div className="rounded-lg border border-line/70 bg-surface/50 p-3 text-[10.5px] leading-4 text-muted">
            {t("settings.tts.secretHint1", "Add a secret named")}{" "}
            <span className="font-mono text-fg">tts.api_key</span>{" "}
            {t("settings.tts.secretHint2", "in the Secrets tab. If that secret is absent, the app falls back to")}{" "}
            <span className="font-mono text-fg">ai.api_key</span>
            {t(
              "settings.tts.secretHint3",
              ". The provider receives only the scene text and voice settings; nothing is generated without a key.",
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t("settings.localApi.title", "Local HTTP API")}
          description={t(
            "settings.localApi.description",
            "Loopback-only control surface for trusted local clients. Requires a bearer token.",
          )}
          actions={
            <Badge tone={localStatus?.running ? "success" : localStatus?.enabled ? "warning" : "neutral"} dot>
              {localStatus?.running
                ? t("status.running", "running")
                : localStatus?.enabled
                  ? t("status.configured", "configured")
                  : t("status.off", "off")}
            </Badge>
          }
        />
        <div className="space-y-4 p-4">
          <Toggle
            checked={draft.localApiEnabled}
            onChange={(value) => patch({ localApiEnabled: value })}
            label={t("settings.localApi.enable", "Enable local API")}
            description={t("settings.localApi.enableDesc", "Binds to 127.0.0.1 only. Changes apply when settings are saved.")}
          />
          <Field label={t("settings.localApi.port", "Port")} hint={t("settings.localApi.portHint", "1,024–65,535. Default 47,821.")}>
            <Input
              type="number"
              min={1024}
              max={65535}
              value={draft.localApiPort}
              onChange={(event) => patch({ localApiPort: Number(event.target.value) })}
              className="numeric"
            />
          </Field>
          <div className="rounded-lg border border-line/70 bg-surface/50 p-3 text-[10.5px] leading-4 text-muted">
            <div className="flex items-center justify-between gap-2">
              <span className="text-faint">{t("settings.localApi.baseUrl", "Base URL")}</span>
              <button
                type="button"
                className="font-mono text-[10px] text-fg hover:text-accent"
                onClick={() => void copy(localStatus?.baseUrl ?? `http://127.0.0.1:${draft.localApiPort}`, t("settings.localApi.baseUrl", "Base URL"))}
              >
                {localStatus?.baseUrl ?? `http://127.0.0.1:${draft.localApiPort}`}
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-4">
              {t("settings.localApi.routes", "Routes:")}{" "}
              <span className="font-mono">GET /v1/health</span>,{" "}
              <span className="font-mono">GET /v1/dashboard</span>,{" "}
              <span className="font-mono">GET /v1/runs</span>,{" "}
              <span className="font-mono">POST /v1/workflows/&#123;id&#125;/runs</span>.
            </p>
          </div>
          {localStatus?.error ? (
            <p className="rounded-lg border border-danger/25 bg-danger/5 p-2.5 text-[10.5px] leading-4 text-danger">
              {localStatus.error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<Eye size={12} />}
              loading={reveal.isPending}
              onClick={() => reveal.mutate()}
            >
              {t("settings.localApi.reveal", "Reveal token")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={12} />}
              loading={rotate.isPending}
              onClick={() => rotate.mutate()}
            >
              {t("settings.localApi.rotate", "Rotate token")}
            </Button>
          </div>
          {revealedToken ? (
            <div className="rounded-lg border border-warn/25 bg-warn/[0.04] p-3">
              <p className="text-[9.5px] uppercase tracking-[0.1em] text-warn">Bearer token</p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all font-mono text-[10px] leading-4 text-fg">{revealedToken}</code>
                <Button size="sm" variant="ghost" icon={<Copy size={12} />} onClick={() => void copy(revealedToken, t("settings.localApi.token", "Token"))}>
                  {t("common.copy", "Copy")}
                </Button>
              </div>
              <p className="mt-1.5 text-[9.5px] leading-4 text-faint">
                {t("settings.localApi.bearerHintPrefix", "Send")}{" "}
                <span className="font-mono">Authorization: Bearer …</span>.{" "}
                {t("settings.localApi.bearerHintSuffix", "CORS is deliberately disabled.")}
              </p>
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t("settings.updates.title", "Application updates")}
          description={
            android
              ? t(
                  "settings.updates.androidDesc",
                  "Android updates are delivered as newer signed APK releases on GitHub. In-app updates are desktop-only.",
                )
              : t(
                  "settings.updates.desktopDesc",
                  "Signed Tauri updates from an HTTPS manifest endpoint. The update public key is built into this binary.",
                )
          }
        />
        <div className="space-y-4 p-4">
          <Field
            label={t("settings.updates.manifestUrl", "Update manifest URL")}
            optional
            hint={t(
              "settings.updates.manifestUrlHint",
              "Standalone Tauri update JSON. Empty disables update checks. The owner must publish this endpoint.",
            )}
          >
            <Input
              value={draft.updateEndpoint ?? ""}
              onChange={(event) => patch({ updateEndpoint: event.target.value.trim() || null })}
              placeholder="https://updates.example.com/latest.json"
              className="font-mono text-[11px]"
              spellCheck={false}
              disabled={android}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<CloudDownload size={12} />}
              loading={check.isPending}
              disabled={android}
              onClick={() => check.mutate()}
            >
              {t("settings.updates.checkNow", "Check now")}
            </Button>
            <span className="text-[9.5px] text-faint">
              {android
                ? t("settings.updates.androidHint", "Install a newer signed APK from GitHub Releases.")
                : t("settings.updates.desktopHint", "Uses the saved settings values.")}
            </span>
          </div>
          {updateResult ? (
            <div className="rounded-lg border border-accent/25 bg-accent/[0.045] p-3">
              <p className="text-xs font-medium text-fg">
                {t("settings.updates.available", "Version {version} is available", { version: updateResult.version })}
              </p>
              <p className="mt-1 text-[10px] text-faint">
                {t("settings.updates.current", "Current")} {updateResult.currentVersion}
                {updateResult.date ? ` · ${updateResult.date}` : ""}
              </p>
              {updateResult.body ? (
                <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-[10.5px] leading-4 text-muted">
                  {updateResult.body}
                </p>
              ) : null}
              <Button className="mt-3" size="sm" variant="primary" onClick={() => setInstallOpen(true)}>
                {t("settings.updates.downloadInstall", "Download and install")}
              </Button>
            </div>
          ) : updateResult === null ? (
            <p className="rounded-lg border border-line/70 bg-surface/50 p-3 text-[10.5px] text-muted">
              {t("settings.updates.upToDate", "This installation is up to date.")}
            </p>
          ) : null}
          <p className="text-[9.5px] leading-4 text-faint">
            {t(
              "settings.updates.note",
              "Update artifacts are verified with the embedded public key. Unsigned or mismatched artifacts are rejected. The release owner must sign every build with the matching private key.",
            )}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t("settings.license.title", "License")}
          description={t(
            "settings.license.description",
            "The license is linked to BITS License Manager and bound to this device.",
          )}
          actions={
            licenseMeta ? (
              <Badge tone={licenseMeta.tone} dot>
                {t(
                  `license.status.${licenseState?.status ?? ""}`,
                  LICENSE_STATUS_FALLBACK[licenseState?.status ?? "licensed"],
                )}
              </Badge>
            ) : null
          }
        />
        <div className="space-y-3 p-4">
          {license.isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 size={13} className="animate-spin" /> {t("settings.license.loading", "Loading license…")}
            </div>
          ) : licenseState ? (
            <>
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-[9.5px] uppercase tracking-[0.08em] text-faint">{t("settings.license.plan", "Plan")}</dt>
                  <dd className="mt-1 text-[11px] text-fg">{licenseState.plan ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-[9.5px] uppercase tracking-[0.08em] text-faint">{t("settings.license.licenseId", "License ID")}</dt>
                  <dd className="mt-1 truncate font-mono text-[11px] text-fg" title={licenseState.licenseId ?? undefined}>
                    {licenseState.licenseId ? truncate(licenseState.licenseId, 14) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[9.5px] uppercase tracking-[0.08em] text-faint">{t("settings.license.device", "Device")}</dt>
                  <dd className="mt-1 truncate font-mono text-[11px] text-muted" title={licenseState.deviceId ?? undefined}>
                    {licenseState.deviceId ? truncate(licenseState.deviceId, 12) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[9.5px] uppercase tracking-[0.08em] text-faint">{t("settings.license.lastSynced", "Last synced")}</dt>
                  <dd className="mt-1 text-[11px] text-fg">{relativeTime(licenseState.lastSyncedAt)}</dd>
                </div>
              </dl>
              {licenseState.entitlements.length > 0 ? (
                <div>
                  <SectionLabel>{t("settings.license.entitlements", "Entitlements")}</SectionLabel>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {licenseState.entitlements.map((entitlement) => (
                      <Badge key={entitlement} tone="neutral">
                        {entitlement}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              {licenseState.error ? (
                <p className="rounded-lg border border-danger/25 bg-danger/5 p-2.5 text-[10.5px] leading-4 text-danger">
                  {licenseState.error}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2 border-t border-line/60 pt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RefreshCw size={12} />}
                  loading={refreshLicense.isPending}
                  onClick={() => refreshLicense.mutate()}
                >
                  {t("common.refresh", "Refresh")}
                </Button>
                <Button size="sm" variant="danger" icon={<Unlink size={12} />} onClick={() => setUnlinkOpen(true)}>
                  {t("settings.license.unlink", "Unlink")}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </Card>

      <ConfirmDialog
        open={installOpen}
        title={t("settings.updates.installConfirmTitle", "Install update")}
        description={
          <>
            {t("settings.updates.installConfirmPrefix", "BITS AI Video Creator will download version")}{" "}
            <strong className="text-fg">{updateResult?.version}</strong>{" "}
            {t(
              "settings.updates.installConfirmSuffix",
              ", verify its signature, install it, and restart. Save any open workflow changes first.",
            )}
          </>
        }
        confirmationLabel={updateResult?.version ?? ""}
        confirmLabel={t("settings.updates.installConfirmButton", "Install and restart")}
        busy={install.isPending}
        tone="primary"
        onConfirm={() => install.mutate()}
        onClose={() => setInstallOpen(false)}
      />

      <ConfirmDialog
        open={unlinkOpen}
        title={t("settings.license.unlinkConfirmTitle", "Unlink license")}
        description={t(
          "settings.license.unlinkConfirmDescription",
          "The device token will be revoked and the license cache cleared. The workspace stays locked until you connect a license again.",
        )}
        confirmLabel={t("settings.license.unlink", "Unlink")}
        busy={unlink.isPending}
        onConfirm={() => unlink.mutate()}
        onClose={() => setUnlinkOpen(false)}
      />
    </div>
  );
}

function SpinnerInline() {
  return <Loader2 size={13} className="animate-spin" />;
}

function SecretsTab() {
  const toast = useToast();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const status = useQuery({ queryKey: ["secret-status"], queryFn: api.getSecretStoreStatus });
  const secrets = useQuery({ queryKey: ["secrets"], queryFn: api.listSecrets });

  const create = useMutation({
    mutationFn: () => api.setSecret(name.trim(), value),
    onSuccess: (reference) => {
      toast.success(
        t("settings.secrets.storedTitle", "Secret stored"),
        t("settings.secrets.storedBody", "{name} is held by the operating system credential store.", { name: reference.name }),
      );
      setName("");
      setValue("");
      setVisible(false);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["secrets"] });
    },
    onError: (cause) => setError(toApiError(cause).message),
  });

  const remove = useMutation({
    mutationFn: (secretName: string) => api.deleteSecret(secretName, secretName),
    onSuccess: (_result, secretName) => {
      toast.success(t("settings.secrets.deletedTitle", "Secret deleted"), secretName);
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["secrets"] });
    },
    onError: (cause) => toast.error(t("settings.secrets.deleteFailed", "Unable to delete secret"), toApiError(cause).message),
  });

  const available = status.data?.available ?? false;

  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.1fr]">
      <Card>
        <CardHeader
          title={t("settings.secrets.addTitle", "Add secret")}
          description={t("settings.secrets.addDescription", "Values are written once and never returned to the interface.")}
          actions={
            status.data ? (
              <Badge tone={available ? "success" : "danger"} dot>
                {available ? t("settings.secrets.vaultAvailable", "Vault available") : t("settings.secrets.vaultUnavailable", "Vault unavailable")}
              </Badge>
            ) : null
          }
        />
        <div className="space-y-4 p-4">
          {status.isError || (status.data && !available) ? (
            <div className="flex gap-2.5 rounded-lg border border-warn/25 bg-warn/[0.04] p-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
              <div className="text-[10.5px] leading-4 text-muted">
                <p className="font-medium text-warn">{t("settings.secrets.vaultUnavailableWarning", "OS credential store is unavailable.")}</p>
                <p className="mt-1">{status.data?.message ?? status.error?.message}</p>
                <p className="mt-1">
                  {t(
                    "settings.secrets.vaultUnavailableBody",
                    "Secret-backed workflows cannot run until a supported keyring is available. No plaintext fallback is used.",
                  )}
                </p>
              </div>
            </div>
          ) : null}
          <Field
            label={t("settings.secrets.nameLabel", "Name")}
            hint={t("settings.secrets.nameHint", "1–64 characters: letters, numbers, ., _, -. Referenced as {reference}.", { reference: "{{secrets.name}}" })}
          >
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              placeholder="provider.token"
              className="font-mono text-xs"
              maxLength={64}
              disabled={!available}
            />
          </Field>
          <Field label={t("settings.secrets.valueLabel", "Value")} hint={t("settings.secrets.valueHint", "Up to 16 KB. Values are trimmed and stored in the OS vault.")}>
            <div className="relative">
              <Input
                type={visible ? "text" : "password"}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(null);
                }}
                placeholder={t("settings.secrets.valuePlaceholder", "Paste the secret value")}
                className="pr-10 font-mono text-xs"
                autoComplete="new-password"
                disabled={!available}
              />
              <IconButton
                label={visible ? t("settings.secrets.hideValue", "Hide secret value") : t("settings.secrets.showValue", "Show secret value")}
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2"
                onClick={() => setVisible((current) => !current)}
              >
                {visible ? <EyeOff size={14} /> : <Eye size={14} />}
              </IconButton>
            </div>
          </Field>
          {error ? <p className="rounded-lg border border-danger/25 bg-danger/5 p-2.5 text-[11px] text-danger">{error}</p> : null}
          <Button
            variant="primary"
            icon={<KeyRound size={14} />}
            loading={create.isPending}
            disabled={!available || !name.trim() || !value.trim()}
            onClick={() => create.mutate()}
          >
            {t("settings.secrets.store", "Store secret")}
          </Button>
          <p className="text-[10px] leading-4 text-faint">
            {t(
              "settings.secrets.note",
              "BITS AI Video Creator exposes no command to read secret values. The engine resolves them only while executing a step, and logs are redacted.",
            )}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t("settings.secrets.listTitle", "Stored secret references")}
          description={t("settings.secrets.listDescription", "Only names and timestamps are stored in SQLite.")}
          actions={
            <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={() => void secrets.refetch()}>
              {t("common.refresh", "Refresh")}
            </Button>
          }
        />
        {secrets.isLoading ? (
          <div className="flex items-center gap-2 p-4 text-xs text-muted">
            <Loader2 size={13} className="animate-spin" /> {t("settings.secrets.loading", "Loading references…")}
          </div>
        ) : secrets.isError ? (
          <p className="p-4 text-xs text-danger">{secrets.error.message}</p>
        ) : secrets.data?.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <ShieldCheck size={20} className="mx-auto text-faint" />
            <p className="mt-2 text-xs font-medium text-fg">{t("settings.secrets.emptyTitle", "No secrets stored")}</p>
            <p className="mt-1 text-[10.5px] leading-4 text-faint">
              {t("settings.secrets.emptyBody", "Add one on the left. Secret names are exported; values are never exported.")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line/50">
            {secrets.data?.map((secret) => (
              <li key={secret.name} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[11.5px] text-fg">{secret.name}</p>
                  <p className="mt-0.5 text-[9.5px] text-faint">
                    {t("settings.secrets.updated", "updated")} {relativeTime(secret.updatedAt)} ·{" "}
                    {t("settings.secrets.created", "created")} {formatDateTime(secret.createdAt)}
                  </p>
                </div>
                <IconButton
                  label={t("settings.secrets.deleteAria", "Delete secret {name}", { name: secret.name })}
                  tone="danger"
                  size="sm"
                  onClick={() => setDeleteTarget(secret.name)}
                >
                  <Trash2 size={13} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={deleteTarget != null}
        title={t("settings.secrets.deleteTitle", "Delete secret")}
        description={
          <>
            {t("settings.secrets.deleteConfirmPrefix", "This removes")}{" "}
            <strong className="text-fg">{deleteTarget}</strong>{" "}
            {t(
              "settings.secrets.deleteConfirmSuffix",
              "from the operating system credential store. Workflows referencing it will fail until the secret is re-added. This cannot be undone.",
            )}
          </>
        }
        confirmationLabel={deleteTarget ?? ""}
        confirmLabel={t("settings.secrets.deleteTitle", "Delete secret")}
        busy={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget);
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function DataTab() {
  const toast = useToast();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [importPath, setImportPath] = useState("");
  const [strategy, setStrategy] = useState<DuplicateStrategy>("skip");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [restorePath, setRestorePath] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("settings.labelCopied", "{label} copied", { label }));
    } catch {
      toast.error(t("settings.clipboardUnavailable", "Clipboard unavailable"));
    }
  };

  const storage = useQuery({ queryKey: ["storage"], queryFn: api.getStorageInfo });
  const backups = useQuery({ queryKey: ["backups"], queryFn: api.listBackups });

  const createBackup = useMutation({
    mutationFn: api.createBackup,
    onSuccess: (info) => {
      toast.success(
        t("settings.data.backupCreatedTitle", "Backup created"),
        t("settings.data.backupCreatedBody", "{path} · integrity {integrity}", { path: info.path, integrity: info.integrity }),
      );
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
      void queryClient.invalidateQueries({ queryKey: ["storage"] });
    },
    onError: (cause) => toast.error(t("settings.data.backupFailed", "Unable to create backup"), toApiError(cause).message),
  });

  const verify = useMutation({
    mutationFn: (path: string) => api.verifyBackup(path),
    onSuccess: (integrity, path) => toast.success(t("settings.data.backupVerifiedTitle", "Backup verified"), `${path.split(/[\\/]/).pop()} · ${integrity}`),
    onError: (cause) => toast.error(t("settings.data.verifyFailed", "Backup verification failed"), toApiError(cause).message),
  });

  const stageRestore = useMutation({
    mutationFn: (path: string) => api.stageRestore(path),
    onSuccess: () => {
      toast.success(
        t("settings.data.restoreStagedTitle", "Restore staged"),
        t("settings.data.restoreStagedBody", "Quit and reopen BITS AI Video Creator to apply the restored database."),
      );
      setRestorePath(null);
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (cause) => toast.error(t("settings.data.stageRestoreFailed", "Unable to stage restore"), toApiError(cause).message),
  });

  const chooseImport = async () => {
    try {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "BITS AI Video Creator data", extensions: ["json", "bits-ai-video-creator"] }],
      });
      if (typeof path === "string") {
        setImportPath(path);
        setPreview(null);
        setImportError(null);
      }
    } catch (cause) {
      toast.error(t("settings.data.filePickerFailed", "Unable to open file picker"), toApiError(cause).message);
    }
  };

  const runPreview = useMutation({
    mutationFn: () => api.importPreview(importPath, strategy),
    onSuccess: (result) => {
      setPreview(result);
      setImportError(null);
    },
    onError: (cause) => {
      setPreview(null);
      setImportError(toApiError(cause).message);
    },
  });

  const applyImport = useMutation({
    mutationFn: () => api.importApply(importPath, strategy),
    onSuccess: (result) => {
      toast.success(
        t("settings.data.importCompletedTitle", "Import completed"),
        t(
          "settings.data.importCompletedBody",
          "{imported} imported · {replaced} replaced · {skipped} skipped · {notices} notices",
          {
            imported: result.imported,
            replaced: result.replaced,
            skipped: result.skipped,
            notices: result.errors.length,
          },
        ),
      );
      setPreview(null);
      setConfirmApply(false);
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["secrets"] });
    },
    onError: (cause) => {
      setConfirmApply(false);
      toast.error(t("settings.data.importFailed", "Import failed"), toApiError(cause).message);
    },
  });

  const exportData = useMutation({
    mutationFn: async () => {
      const path = await save({
        defaultPath: `bits-ai-video-creator-export-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "BITS AI Video Creator data", extensions: ["json", "bits-ai-video-creator"] }],
      });
      if (!path) return null;
      return api.exportData(path).then((bytes) => ({ path, bytes }));
    },
    onSuccess: (result) => {
      if (result) toast.success(t("settings.data.exportWrittenTitle", "Export written"), `${result.path} · ${formatBytes(result.bytes)}`);
    },
    onError: (cause) => toast.error(t("settings.data.exportFailed", "Unable to export data"), toApiError(cause).message),
  });

  const chooseRestoreFile = async () => {
    try {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "BITS AI Video Creator database", extensions: ["db", "sqlite", "backup"] }],
      });
      if (typeof path === "string") {
        setRestorePath(path);
      }
    } catch (cause) {
      toast.error(t("settings.data.filePickerFailed", "Unable to open file picker"), toApiError(cause).message);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title={t("settings.data.exportTitle", "Export")}
            description={t(
              "settings.data.exportDescription",
              "Accounts, workflows, schedules, and secret names. Secret values are never exported.",
            )}
          />
          <div className="p-4">
            <Button variant="primary" icon={<Download size={14} />} loading={exportData.isPending} onClick={() => exportData.mutate()}>
              {t("settings.data.exportButton", "Export data…")}
            </Button>
            <p className="mt-3 text-[10.5px] leading-4 text-faint">
              {t(
                "settings.data.exportNote",
                "Output is a versioned JSON document. Accounts and workflows are validated during import, never silently coerced.",
              )}
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title={t("settings.data.importTitle", "Import")}
            description={t(
              "settings.data.importDescription",
              "BITS AI Video Creator exports and legacy BITS AI Video Creator 1.x account files are supported.",
            )}
            actions={
              <Button size="sm" variant="secondary" icon={<Upload size={12} />} onClick={() => void chooseImport()}>
                {t("settings.data.chooseFile", "Choose file")}
              </Button>
            }
          />
          <div className="space-y-3 p-4">
            <Input
              value={importPath}
              readOnly
              placeholder={t("settings.data.noFileSelected", "No file selected")}
              className="font-mono text-[10.5px] text-muted"
              aria-label={t("settings.data.importPathAria", "Import file path")}
            />
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t("settings.data.duplicateStrategy", "Duplicate strategy")} className="min-w-[180px] flex-1">
                <Select
                  value={strategy}
                  onChange={(event) => {
                    setStrategy(event.target.value as DuplicateStrategy);
                    setPreview(null);
                  }}
                >
                  <option value="skip">{t("settings.data.strategySkip", "Skip duplicates")}</option>
                  <option value="replace">{t("settings.data.strategyReplace", "Replace duplicates")}</option>
                  <option value="duplicate">{t("settings.data.strategyKeepBoth", "Keep both (rename)")}</option>
                </Select>
              </Field>
              <Button
                variant="secondary"
                loading={runPreview.isPending}
                disabled={!importPath}
                onClick={() => runPreview.mutate()}
              >
                {t("settings.data.preview", "Preview")}
              </Button>
              <Button
                variant="primary"
                loading={applyImport.isPending}
                disabled={!preview || preview.valid === 0}
                onClick={() => {
                  if (strategy === "replace") setConfirmApply(true);
                  else applyImport.mutate();
                }}
              >
                {t("settings.data.applyImport", "Apply import")}
              </Button>
            </div>
            {importError ? (
              <p className="rounded-lg border border-danger/25 bg-danger/5 p-2.5 text-[11px] leading-4 text-danger">
                {importError}
              </p>
            ) : null}
            {preview ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="info">{preview.kind}</Badge>
                  <Badge tone="neutral">{t("settings.data.recordCount", "{count} records", { count: preview.total })}</Badge>
                  <Badge tone={preview.valid > 0 ? "success" : "danger"}>{t("settings.data.validCount", "{count} valid", { count: preview.valid })}</Badge>
                  <Badge tone={preview.duplicates > 0 ? "warning" : "neutral"}>{t("settings.data.duplicateCount", "{count} duplicates", { count: preview.duplicates })}</Badge>
                </div>
                {preview.errors.length > 0 ? (
                  <ul className="max-h-24 space-y-1 overflow-y-auto rounded-lg border border-line/70 bg-surface/50 p-2">
                    {preview.errors.map((issue, index) => (
                      <li key={`${issue.path}-${index}`} className="text-[10px] leading-4 text-muted">
                        <span className={issue.severity === "error" ? "text-danger" : "text-warn"}>
                          {issue.severity}
                        </span>{" "}
                        <span className="font-mono text-faint">{issue.path}</span> · {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {preview.items.length > 0 ? (
                  <ul className="max-h-44 divide-y divide-line/40 overflow-y-auto rounded-lg border border-line/70">
                    {preview.items.map((item) => (
                      <li key={item.key} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                        <span className="min-w-0 truncate text-[10.5px] text-muted">{item.label}</span>
                        <span className="shrink-0 text-[9.5px] text-faint">{item.action}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={t("settings.data.backupsTitle", "Backups")}
          description={t(
            "settings.data.backupsDescription",
            "Consistent SQLite snapshots stored in the local backup directory. Integrity is checked when a backup is created.",
          )}
          actions={
            <>
              <Button size="sm" variant="secondary" icon={<ArchiveRestore size={12} />} onClick={() => void chooseRestoreFile()}>
                {t("settings.data.restoreFile", "Restore file…")}
              </Button>
              <Button size="sm" variant="primary" icon={<Database size={12} />} loading={createBackup.isPending} onClick={() => createBackup.mutate()}>
                {t("settings.data.createBackup", "Create backup")}
              </Button>
            </>
          }
        />
        {backups.isLoading ? (
          <div className="flex items-center gap-2 p-4 text-xs text-muted">
            <Loader2 size={13} className="animate-spin" /> {t("settings.data.loadingBackups", "Loading backups…")}
          </div>
        ) : backups.isError ? (
          <p className="p-4 text-xs text-danger">{backups.error.message}</p>
        ) : backups.data?.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <HardDrive size={20} className="mx-auto text-faint" />
            <p className="mt-2 text-xs font-medium text-fg">{t("settings.data.noBackupsTitle", "No backups yet")}</p>
            <p className="mt-1 text-[10.5px] leading-4 text-faint">
              {t("settings.data.noBackupsBody", "Create a snapshot before restoring or making large structural changes.")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line/70 text-[10px] uppercase tracking-[0.08em] text-faint">
                  <th className="px-4 py-2 font-medium">{t("settings.data.colFile", "File")}</th>
                  <th className="px-3 py-2 font-medium">{t("settings.data.colCreated", "Created")}</th>
                  <th className="px-3 py-2 font-medium">{t("settings.data.colSize", "Size")}</th>
                  <th className="px-3 py-2 font-medium">{t("settings.data.colIntegrity", "Integrity")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {backups.data?.map((backup) => (
                  <tr key={backup.path} className="border-b border-line/45 last:border-0">
                    <td className="max-w-[320px] px-4 py-2.5">
                      <p className="truncate font-mono text-[10.5px] text-fg">{backup.path.split(/[\\/]/).pop()}</p>
                      <p className="truncate text-[9px] text-faint">{backup.path}</p>
                    </td>
                    <td className="px-3 py-2.5 text-[10.5px] text-muted">{formatDateTime(backup.createdAt)}</td>
                    <td className="numeric px-3 py-2.5 text-[10.5px] text-muted">{formatBytes(backup.bytes)}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={backup.integrity === "ok" ? "success" : "neutral"}>{backup.integrity}</Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" loading={verify.isPending && verify.variables === backup.path} onClick={() => verify.mutate(backup.path)}>
                          {t("settings.data.verify", "Verify")}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setRestorePath(backup.path)}>
                          {t("settings.data.restoreButton", "Restore")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-line/60 px-4 py-3 text-[10px] leading-4 text-faint">
          {t(
            "settings.data.restoreNote",
            "Restore is staged and applied on the next launch. The current database is copied to a “bits-ai-video-creator-before-restore” file before replacement.",
          )}
        </p>
      </Card>

      <Card>
        <CardHeader
          title={t("settings.data.storageTitle", "Local storage")}
          description={t("settings.data.storageDescription", "Paths and database size reported by the running shell.")}
          actions={
            storage.data ? (
              <Button size="sm" variant="ghost" icon={<FolderOpen size={12} />} onClick={() => void openPath(storage.data.dataDir).catch((cause) => toast.error(t("settings.data.openFolderFailed", "Unable to open folder"), String(cause)))}>
                {t("settings.data.openFolder", "Open folder")}
              </Button>
            ) : null
          }
        />
        {storage.data ? (
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <div>
              <SectionLabel>{t("settings.data.dataDir", "Data directory")}</SectionLabel>
              <button type="button" onClick={() => void copy(storage.data.dataDir, t("settings.data.dataPath", "Data path"))} className="mt-1 block break-all text-left font-mono text-[10px] leading-4 text-muted hover:text-fg">
                {storage.data.dataDir}
              </button>
            </div>
            <div>
              <SectionLabel>{t("settings.data.database", "Database")}</SectionLabel>
              <button type="button" onClick={() => void copy(storage.data.databasePath, t("settings.data.databasePath", "Database path"))} className="mt-1 block break-all text-left font-mono text-[10px] leading-4 text-muted hover:text-fg">
                {storage.data.databasePath}
              </button>
            </div>
            <div>
              <SectionLabel>{t("settings.data.backupDir", "Backup directory")}</SectionLabel>
              <button type="button" onClick={() => void copy(storage.data.backupDir, t("settings.data.backupPath", "Backup path"))} className="mt-1 block break-all text-left font-mono text-[10px] leading-4 text-muted hover:text-fg">
                {storage.data.backupDir}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <SectionLabel>{t("settings.data.size", "Size")}</SectionLabel>
                <p className="numeric mt-1 text-[11px] text-fg">{formatBytes(storage.data.databaseBytes)}</p>
              </div>
              <div>
                <SectionLabel>{t("settings.about.schema", "Schema")}</SectionLabel>
                <p className="numeric mt-1 text-[11px] text-fg">v{storage.data.schemaVersion}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-4 text-xs text-muted">
            <Loader2 size={13} className="animate-spin" /> {t("settings.data.loadingStorage", "Loading storage information…")}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirmApply}
        title={t("settings.data.replaceConfirmTitle", "Replace duplicate records?")}
        description={
          <>
            {t(
              "settings.data.replaceConfirmPrefix",
              "The “replace” strategy overwrites fields on existing accounts and replaces existing workflow definitions with the imported versions. The preview found",
            )}{" "}
            <strong className="text-fg">{preview?.duplicates ?? 0}</strong>{" "}
            {preview?.duplicates === 1
              ? t(
                  "settings.data.replaceConfirmSuffixOne",
                  "duplicate. Account and workflow ids are kept, so local run history is preserved. Secret values are never overwritten or imported.",
                )
              : t(
                  "settings.data.replaceConfirmSuffixMany",
                  "duplicates. Account and workflow ids are kept, so local run history is preserved. Secret values are never overwritten or imported.",
                )}
          </>
        }
        confirmationLabel="replace"
        confirmLabel={t("settings.data.replaceConfirmButton", "Replace and import")}
        busy={applyImport.isPending}
        tone="danger"
        onConfirm={() => applyImport.mutate()}
        onClose={() => setConfirmApply(false)}
      />

      <ConfirmDialog
        open={restorePath != null}
        title={t("settings.data.stageRestoreTitle", "Stage database restore")}
        description={
          <>
            {t("settings.data.stageRestorePrefix", "BITS AI Video Creator will verify")}{" "}
            <strong className="text-fg">{restorePath?.split(/[\\/]/).pop()}</strong>{" "}
            {t(
              "settings.data.stageRestoreSuffix",
              "and stage it for the next launch. On restart, the current database is backed up and replaced. Accounts, workflows, run history, logs, and settings will come from the selected file. Secret values are not included. Close other sessions before restarting.",
            )}
          </>
        }
        confirmationLabel="restore"
        confirmLabel={t("settings.data.stageRestoreButton", "Stage restore")}
        busy={stageRestore.isPending}
        tone="danger"
        onConfirm={() => {
          if (restorePath) stageRestore.mutate(restorePath);
        }}
        onClose={() => setRestorePath(null)}
      />
    </div>
  );
}
