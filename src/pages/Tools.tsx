import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  Check,
  Clapperboard,
  Copy,
  ExternalLink,
  Loader2,
  Mic2,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageContainer } from "../components/Layout";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Select,
  Textarea,
} from "../components/ui";
import { useI18n } from "../i18n";
import { api, toApiError } from "../lib/api";
import { isAndroid } from "../lib/platform";
import { navigate } from "../lib/router";
import type { Account, Bounds, ProviderInfo, ProviderTool, ProviderViewInfo } from "../lib/types";

function ToolSession({ account, tool }: { account: Account; tool: ProviderTool }) {
  const { t } = useI18n();
  const toast = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ProviderViewInfo | null>(null);
  const [attempt, setAttempt] = useState(0);

  const measure = useCallback((): Bounds | null => {
    const element = containerRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const x = Math.round(rect.left);
    const y = Math.round(rect.top);
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width < 50 || height < 50 || x < 0 || y < 0) return null;
    return { x, y, width, height };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      const bounds = measure();
      if (!bounds) {
        setBusy(false);
        setError(t("tools.tooSmallError", "The tool area is too small. Enlarge the window and try again."));
        return;
      }
      api
        .openProviderTool(account.id, tool.id, bounds)
        .then((view) => {
          if (!cancelled) {
            setInfo(view);
            setError(null);
          }
        })
        .catch((cause) => {
          if (!cancelled) setError(toApiError(cause).message);
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      void api.closeProviderView().catch(() => undefined);
    };
  }, [account.id, tool.id, measure, attempt, t]);

  useEffect(() => {
    if (!info) return;
    let frame = 0;
    const sync = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const bounds = measure();
        if (bounds) void api.resizeProviderView(bounds).catch(() => undefined);
      });
    };
    const observer = new ResizeObserver(sync);
    if (containerRef.current) observer.observe(containerRef.current);
    window.addEventListener("resize", sync);
    document.addEventListener("scroll", sync, true);
    sync();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      document.removeEventListener("scroll", sync, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [info, measure]);

  const reload = async () => {
    setBusy(true);
    try {
      await api.reloadProviderView();
      toast.info(t("tools.reloadedToast", "Provider tool reloaded"));
    } catch (cause) {
      toast.error(t("tools.reloadError", "Unable to reload"), toApiError(cause).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted">
          <ShieldCheck size={14} className="text-accent" />
          <span className="truncate">
            {tool.name} · {account.name}
          </span>
          {info ? (
            <Badge tone="success">{t("tools.attachedBadge", "attached")}</Badge>
          ) : busy ? (
            <Badge tone="info">{t("tools.openingBadge", "opening")}</Badge>
          ) : null}
        </div>
        <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={() => void reload()}>
          {t("tools.reload", "Reload")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 p-3">
        <div
          ref={containerRef}
          className="surface-grid relative flex h-full min-h-[420px] w-full items-center justify-center overflow-hidden rounded-xl border border-line bg-surface"
        >
          {error ? (
            <div className="max-w-sm px-6 text-center">
              <AlertTriangle size={20} className="mx-auto text-danger" />
              <p className="mt-3 text-sm font-medium text-fg">{t("tools.unavailableTitle", "Tool unavailable")}</p>
              <p className="mt-1 text-xs leading-5 text-muted">{error}</p>
              <Button
                className="mt-4"
                size="sm"
                variant="secondary"
                icon={<RefreshCw size={12} />}
                onClick={() => {
                  setError(null);
                  setBusy(true);
                  setAttempt((value) => value + 1);
                }}
              >
                {t("common.retry", "Retry")}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 text-xs text-muted">
              <Loader2 size={15} className="animate-spin text-accent" />
              {busy ? t("tools.opening", "Opening provider web tool…") : t("tools.active", "Provider tool is active.")}
            </div>
          )}
        </div>
      </div>
      <p className="border-t border-line/60 px-4 py-2.5 text-[10.5px] leading-4 text-faint">
        {tool.hint}{" "}
        {t(
          "tools.footerNote",
          "The embedded page has no BITS AI Video Creator IPC access; downloads use the native HTTPS save dialog.",
        )}
      </p>
    </div>
  );
}

export function ToolsPage() {
  const { t } = useI18n();
  const android = isAndroid();
  const tools = useQuery({ queryKey: ["provider-tools"], queryFn: api.getProviderTools, staleTime: Infinity });
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.getProviders, staleTime: Infinity });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api.listAccounts() });
  const prompts = useQuery({ queryKey: ["prompts"], queryFn: () => api.listPrompts() });
  const toast = useToast();
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [copied, setCopied] = useState(false);

  const selectedPrompt = prompts.data?.find((item) => item.id === selectedPromptId) ?? null;
  const copyPrompt = async () => {
    if (!selectedPrompt) return;
    try {
      await navigator.clipboard.writeText(selectedPrompt.prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      toast.success(
        t("tools.promptCopied", "Prompt copied"),
        t("tools.promptCopiedDesc", "Paste it into the provider tool."),
      );
    } catch {
      toast.error(
        t("tools.clipboardError", "Clipboard unavailable"),
        t("tools.clipboardErrorDesc", "Open the prompt library and copy the text manually."),
      );
    }
  };

  const tool = tools.data?.find((item) => item.id === selectedToolId) ?? tools.data?.[0] ?? null;
  const compatible = (accounts.data ?? []).filter((account) => account.provider === tool?.accountProvider);
  const account = compatible.find((item) => item.id === selectedAccount) ?? compatible[0] ?? null;

  useEffect(() => {
    if (!selectedToolId && tools.data?.[0]) setSelectedToolId(tools.data[0].id);
  }, [selectedToolId, tools.data]);

  useEffect(() => {
    if (!tool) return;
    const first = (accounts.data ?? []).find((item) => item.provider === tool.accountProvider);
    setSelectedAccount(first?.id ?? null);
  }, [tool?.id, tool?.accountProvider, accounts.data, tool]);

  const providerName = (id: string) =>
    (providers.data ?? []).find((provider: ProviderInfo) => provider.id === id)?.name ?? id;

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("tools.eyebrow", "Provider web tools")}
        title={t("page.tools", "Tools")}
        description={
          android
            ? t(
                "tools.descriptionAndroid",
                "Provider-hosted storyboard and speech pages. Embedded signed-in webviews are not available on Android yet; open the provider page in your browser.",
              )
            : t(
                "tools.descriptionDesktop",
                "Provider-hosted storyboard and speech pages opened inside an isolated, signed-in webview. These are web pages, not vendor APIs.",
              )
        }
        actions={
          <>
            <Button icon={<Clapperboard size={14} />} onClick={() => navigate("/storyboards")}>
              {t("tools.nativeStoryboards", "Native storyboards")}
            </Button>
            <Button icon={<Mic2 size={14} />} onClick={() => navigate("/voiceover")}>
              {t("tools.voiceoverStudio", "Voiceover studio")}
            </Button>
          </>
        }
      />

      <div className="mt-5 grid gap-4 xl:grid-cols-[330px_1fr]">
        <div className="space-y-3">
          <Card>
            <CardHeader
              title={t("tools.availableTitle", "Available tools")}
              description={t("tools.availableDesc", "Provider UI changes can affect availability.")}
            />
            {tools.isLoading ? (
              <div className="flex items-center gap-2 p-4 text-xs text-muted">
                <Loader2 size={13} className="animate-spin" /> {t("tools.loadingTools", "Loading tools…")}
              </div>
            ) : tools.isError ? (
              <p className="p-4 text-xs text-danger">{tools.error.message}</p>
            ) : (
              <div className="space-y-1 p-2">
                {tools.data?.map((item) => {
                  const active = item.id === tool?.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedToolId(item.id)}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        active
                          ? "border-accent/35 bg-accent/[0.045]"
                          : "border-transparent hover:border-line/70 hover:bg-raised/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-xs font-medium text-fg">
                          <Wrench size={13} className={active ? "text-accent" : "text-faint"} />
                          {item.name}
                        </span>
                        <Badge tone="neutral">{providerName(item.accountProvider)}</Badge>
                      </div>
                      <p className="mt-1.5 text-[10.5px] leading-4 text-muted">{item.description}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {tool ? (
            <Card>
              <CardHeader
                title={t("tools.sessionTitle", "Session")}
                description={t("tools.sessionRequires", "Requires a {provider} account.", {
                  provider: providerName(tool.accountProvider),
                })}
                actions={
                  <Button size="sm" variant="ghost" onClick={() => navigate("/accounts")}>
                    {t("tools.manage", "Manage")}
                  </Button>
                }
              />
              <div className="space-y-3 p-4">
                {accounts.isLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <Loader2 size={13} className="animate-spin" /> {t("tools.loadingAccounts", "Loading accounts…")}
                  </div>
                ) : compatible.length === 0 ? (
                  <div className="rounded-lg border border-warn/25 bg-warn/[0.04] p-3 text-[10.5px] leading-4 text-muted">
                    <p className="font-medium text-warn">{t("tools.noCompatible", "No compatible account")}</p>
                    <p className="mt-1">
                      {t("tools.noCompatibleDesc", "Add a {provider} account, sign in once, then return here.", {
                        provider: providerName(tool.accountProvider),
                      })}
                    </p>
                    <Button className="mt-3" size="sm" variant="secondary" onClick={() => navigate("/accounts")}>
                      {t("tools.addAccount", "Add account")}
                    </Button>
                  </div>
                ) : (
                  <>
                    <Select
                      value={account?.id ?? ""}
                      onChange={(event) => setSelectedAccount(event.target.value)}
                      aria-label={t("tools.accountAria", "Tool account")}
                    >
                      {compatible.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                          {item.status === "needs_login" ? t("tools.signInNeeded", " — sign-in needed") : ""}
                        </option>
                      ))}
                    </Select>
                    <p className="text-[10px] leading-4 text-faint">
                      {android
                        ? t(
                            "tools.androidNote",
                            "Android opens the provider in your system browser. The account record remains local to BITS AI Video Creator.",
                          )
                        : t(
                            "tools.desktopNote",
                            "The tool reuses this account's isolated profile. Signing in remains inside the webview.",
                          )}
                    </p>
                    <button
                      type="button"
                      onClick={() => void openUrl(tool.url)}
                      className="inline-flex items-center gap-1.5 text-[10.5px] text-muted hover:text-accent"
                    >
                      <ExternalLink size={11} /> {t("tools.openInBrowser", "Open provider URL in browser")}
                    </button>
                  </>
                )}
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title={t("tools.promptCardTitle", "Prompt library")}
              description={t("tools.promptCardDesc", "Copy a saved prompt, then paste it into the provider page.")}
              actions={
                <Button size="sm" variant="ghost" onClick={() => navigate("/prompts")}>
                  {t("tools.manage", "Manage")}
                </Button>
              }
            />
            <div className="space-y-3 p-4">
              {prompts.data?.length ? (
                <>
                  <Select
                    value={selectedPromptId}
                    onChange={(event) => setSelectedPromptId(event.target.value)}
                    aria-label={t("tools.promptAria", "Saved prompt")}
                  >
                    <option value="">{t("tools.choosePrompt", "Choose a prompt…")}</option>
                    {prompts.data.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.category ? `${item.category} · ` : ""}
                        {item.title}
                      </option>
                    ))}
                  </Select>
                  {selectedPrompt ? (
                    <Textarea
                      value={selectedPrompt.prompt}
                      readOnly
                      rows={4}
                      className="font-mono text-[10px] leading-4"
                      aria-label={t("tools.previewAria", "Prompt preview")}
                    />
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={copied ? <Check size={12} /> : <Copy size={12} />}
                    disabled={!selectedPrompt}
                    onClick={() => void copyPrompt()}
                  >
                    {copied ? t("common.copied", "Copied") : t("tools.copyPrompt", "Copy prompt")}
                  </Button>
                </>
              ) : (
                <p className="text-[10.5px] leading-4 text-muted">
                  {t("tools.noPrompts", "No prompts saved yet. Create reusable text in the prompt library.")}
                </p>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex gap-2.5 p-4">
              <MonitorSmartphone size={16} className="mt-0.5 shrink-0 text-faint" />
              <p className="text-[10px] leading-4 text-faint">
                {t(
                  "tools.securityNote",
                  "Tool sessions are isolated per account under the app data directory, cached up to eight views, and restricted to HTTPS. Pop-ups are denied.",
                )}
              </p>
            </div>
          </Card>
        </div>

        <Card className="flex min-h-[420px] flex-col overflow-hidden md:min-h-[600px]">
          {tool && account && !android ? (
            <ToolSession key={`${tool.id}-${account.id}`} account={account} tool={tool} />
          ) : tool && account && android ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="max-w-md rounded-xl border border-warn/25 bg-warn/[0.04] p-5 text-center">
                <MonitorSmartphone size={22} className="mx-auto text-warn" />
                <p className="mt-3 text-sm font-medium text-fg">
                  {t(
                    "tools.androidEmbeddedTitle",
                    "Embedded tool sessions are not available on Android",
                  )}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {t(
                    "tools.androidEmbeddedBody",
                    "BITS AI Video Creator needs isolated per-account webview profiles for this tool. On Android, open the provider page in your system browser and use the saved prompt from the library.",
                  )}
                </p>
                <Button className="mt-4" variant="secondary" icon={<ExternalLink size={13} />} onClick={() => void openUrl(tool.url)}>
                  {t("tools.openTool", "Open {tool}", { tool: tool.name })}
                </Button>
              </div>
            </div>
          ) : (
            <EmptyState
              className="flex-1"
              icon={<Wrench size={20} />}
              title={
                compatible.length === 0
                  ? t("tools.emptyNoAccountTitle", "Add a compatible account first")
                  : t("tools.emptyChooseTitle", "Choose a tool")
              }
              description={
                compatible.length === 0
                  ? t(
                      "tools.emptyNoAccountDesc",
                      "Provider tools run in the signed-in profile of an existing account. Add one from the Accounts page.",
                    )
                  : t(
                      "tools.emptyChooseDesc",
                      "Select a tool and a signed-in account to open the embedded session.",
                    )
              }
              action={
                compatible.length === 0 ? (
                  <Button variant="primary" onClick={() => navigate("/accounts")}>
                    {t("tools.goToAccounts", "Go to accounts")}
                  </Button>
                ) : undefined
              }
            />
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
