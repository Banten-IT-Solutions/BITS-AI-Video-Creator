import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SectionLabel,
  Select,
  StatusBadge,
  Textarea,
  Toggle,
} from "../components/ui";
import { api, toApiError } from "../lib/api";
import { formatBytes, formatDateTime, relativeTime } from "../lib/format";
import { isAndroid } from "../lib/platform";
import { navigate } from "../lib/router";
import type {
  Account,
  AccountInput,
  AccountStatus,
  Bounds,
  ProviderInfo,
  ProviderViewInfo,
} from "../lib/types";

const STATUS_OPTIONS: AccountStatus[] = ["active", "needs_login", "disabled", "error"];

function providerLabel(providers: ProviderInfo[], id: string): string {
  return providers.find((provider) => provider.id === id)?.name ?? id;
}

function tagList(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => {
      if (!tag) return false;
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

function AccountFormModal({
  account,
  providers,
  open,
  onClose,
  onSaved,
}: {
  account: Account | null;
  providers: ProviderInfo[];
  open: boolean;
  onClose: () => void;
  onSaved: (account: Account) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState("google-flow");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [externalId, setExternalId] = useState("");
  const [status, setStatus] = useState<AccountStatus>("active");
  const [favorite, setFavorite] = useState(false);
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProvider(account?.provider ?? providers[0]?.id ?? "google-flow");
    setName(account?.name ?? "");
    setEmail(account?.email ?? "");
    setExternalId(account?.externalId ?? "");
    setStatus(account?.status ?? "active");
    setFavorite(account?.favorite ?? false);
    setTags((account?.tags ?? []).join(", "));
    setNotes(account?.notes ?? "");
    setError(null);
  }, [open, account, providers]);

  const save = useMutation({
    mutationFn: async () => {
      if (name.trim().length === 0) throw new Error("Enter an account name");
      const input: AccountInput = {
        provider,
        name: name.trim(),
        email: email.trim() || null,
        externalId: externalId.trim() || null,
        status,
        favorite,
        tags: tagList(tags),
        notes: notes.trim() || null,
      };
      return account ? api.updateAccount(account.id, input) : api.createAccount(input);
    },
    onSuccess: (saved) => {
      toast.success(account ? "Account updated" : "Account added", saved.name);
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["account", saved.id] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onSaved(saved);
      onClose();
    },
    onError: (cause) => {
      const apiError = toApiError(cause);
      setError(apiError.message);
    },
  });

  return (
    <Modal
      open={open}
      onClose={save.isPending ? () => undefined : onClose}
      closeOnBackdrop={!save.isPending}
      size="lg"
      title={account ? "Edit account" : "Add provider account"}
      description="BITS AI Video Creator stores account metadata locally. Sign-in happens inside an isolated provider webview."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
            {account ? "Save changes" : "Add account"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider" hint={account ? "Provider cannot change after creation; the isolated profile is tied to it." : "Each provider uses its own isolated sign-in profile."}>
          <Select value={provider} onChange={(event) => setProvider(event.target.value)} disabled={Boolean(account)}>
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(event) => setStatus(event.target.value as AccountStatus)}>
            {STATUS_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Account name" className="sm:col-span-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Work Google Flow"
            maxLength={80}
            autoFocus
          />
        </Field>
        <Field label="Email" optional>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            maxLength={254}
          />
        </Field>
        <Field label="Provider account id" optional hint="Stored as metadata only; never used as a password.">
          <Input
            value={externalId}
            onChange={(event) => setExternalId(event.target.value)}
            placeholder="Optional external id"
            maxLength={200}
          />
        </Field>
        <Field label="Tags" optional hint="Comma separated, up to 20 tags." className="sm:col-span-2">
          <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="production, marketing" />
        </Field>
        <Field label="Notes" optional className="sm:col-span-2" hint={`${notes.length}/2000 characters`}>
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={2000} />
        </Field>
      </div>
      <div className="mt-4 rounded-lg border border-line/80 bg-surface/60 p-3">
        <Toggle
          checked={favorite}
          onChange={setFavorite}
          label="Pin to the top of the account list"
          description="Favorites sort before other accounts."
        />
      </div>
      {error ? (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs leading-5 text-danger">
          {error}
        </div>
      ) : null}
    </Modal>
  );
}

function SessionPanel({
  account,
  provider,
  onClose,
}: {
  account: Account;
  provider: ProviderInfo | undefined;
  onClose: () => void;
}) {
  const toast = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ProviderViewInfo | null>(null);

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
    let frame = requestAnimationFrame(() => {
      const bounds = measure();
      if (!bounds) {
        setBusy(false);
        setError("The session area is too small. Enlarge the window and try again.");
        return;
      }
      api
        .openProviderView(account.id, bounds)
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
    };
  }, [account.id, measure]);

  // Close the provider webview only when the panel unmounts. Closing it on
  // every account-id change races the next open and can close the new view.
  useEffect(() => {
    return () => {
      void api.closeProviderView().catch(() => undefined);
    };
  }, []);

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
      toast.info("Provider view reloaded");
    } catch (cause) {
      toast.error("Unable to reload provider view", toApiError(cause).message);
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
            Isolated session · {provider?.name ?? account.provider}
          </span>
          {info ? <Badge tone="success">attached</Badge> : busy ? <Badge tone="info">opening</Badge> : null}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={() => void reload()}>
            Reload
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>
            End session
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 p-3">
        <div
          ref={containerRef}
          className="surface-grid relative flex h-full min-h-[320px] w-full items-center justify-center overflow-hidden rounded-xl border border-line bg-surface"
        >
          {error ? (
            <div className="max-w-sm px-6 text-center">
              <AlertTriangle size={20} className="mx-auto text-danger" />
              <p className="mt-3 text-sm font-medium text-fg">Session unavailable</p>
              <p className="mt-1 text-xs leading-5 text-muted">{error}</p>
              <Button className="mt-4" variant="secondary" onClick={onClose}>
                Close panel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 text-xs text-muted">
              <Loader2 size={15} className="animate-spin text-accent" />
              {busy ? "Opening isolated provider session…" : "Provider session is active."}
            </div>
          )}
        </div>
      </div>
      <p className="border-t border-line/60 px-4 py-2.5 text-[10.5px] leading-4 text-faint">
        Sign in inside this view. Cookies remain in a profile directory outside the database; BITS AI Video Creator never
        reads your password. Navigation is restricted to HTTPS and pop-up windows are denied.
      </p>
    </div>
  );
}

export function AccountsPage() {
  const android = isAndroid();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [providerFilter, setProviderFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [sessionFor, setSessionFor] = useState<string | null>(null);

  const providers = useQuery({ queryKey: ["providers"], queryFn: api.getProviders, staleTime: Infinity });
  const accounts = useQuery({
    queryKey: ["accounts", deferredQuery, providerFilter, statusFilter, favoritesOnly],
    queryFn: () =>
      api.listAccounts({
        query: deferredQuery.trim() || undefined,
        provider: providerFilter || undefined,
        status: statusFilter || undefined,
        favorite: favoritesOnly ? true : undefined,
      }),
  });
  const accountDetail = useQuery({
    queryKey: ["account", selectedId],
    queryFn: () => api.getAccount(selectedId as string),
    enabled: Boolean(selectedId),
  });
  const profile = useQuery({
    queryKey: ["profile", selectedId],
    queryFn: () => api.checkAccountProfile(selectedId as string),
    enabled: Boolean(selectedId) && !sessionFor,
    staleTime: 15_000,
  });

  const selected = accountDetail.data ?? accounts.data?.find((item) => item.id === selectedId) ?? null;
  const providerMap = useMemo(() => new Map((providers.data ?? []).map((item) => [item.id, item])), [providers.data]);

  useEffect(() => {
    const list = accounts.data;
    if (!list) return;
    if (list.length === 0) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (!selectedId || !list.some((item) => item.id === selectedId)) {
      setSelectedId(list[0].id);
    }
  }, [accounts.data, selectedId]);

  const invalidateAccount = (id: string) => {
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["account", id] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["profile", id] });
  };

  const favorite = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => api.setAccountFavorite(id, value),
    onSuccess: (updated) => invalidateAccount(updated.id),
    onError: (cause) => toast.error("Unable to update favorite", toApiError(cause).message),
  });

  const status = useMutation({
    mutationFn: ({ id, value }: { id: string; value: AccountStatus }) => api.setAccountStatus(id, value),
    onSuccess: (updated) => {
      toast.success("Status updated", `${updated.name} is now ${updated.status.replace(/_/g, " ")}.`);
      invalidateAccount(updated.id);
    },
    onError: (cause) => toast.error("Unable to update status", toApiError(cause).message),
  });

  const remove = useMutation({
    mutationFn: async (account: Account) => api.deleteAccount(account.id, account.name),
    onSuccess: (result, account) => {
      toast.success("Account deleted", result.cleanedUp ? `${account.name} and its profile were removed.` : `${account.name} was removed; profile cleanup is pending.`);
      setDeleteTarget(null);
      setSelectedId(null);
      setSessionFor(null);
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (cause) => toast.error("Unable to delete account", toApiError(cause).message),
  });

  const closeSession = useCallback(() => {
    setSessionFor(null);
    void api.closeProviderView().catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: ["profile", selectedId] });
  }, [queryClient, selectedId]);

  const selectAccount = (id: string) => {
    if (id === selectedId) return;
    if (sessionFor) closeSession();
    setSelectedId(id);
  };

  const openEdit = (account: Account) => {
    if (sessionFor) closeSession();
    setEditing(account);
    setFormOpen(true);
  };

  const openCreate = () => {
    if (sessionFor) closeSession();
    setEditing(null);
    setFormOpen(true);
  };

  const requestDelete = (account: Account) => {
    if (sessionFor) closeSession();
    setDeleteTarget(account);
  };

  const activeFilters = Boolean(query || providerFilter || statusFilter || favoritesOnly);
  const list = accounts.data ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-4 pb-4 pt-4 md:px-7 md:pb-5 md:pt-6">
        <PageHeader
          eyebrow="Workspace"
          title="Provider accounts"
          description="Organize provider identities, track local sign-in state, and open isolated sessions. Credentials and cookies never enter the application database."
          actions={
            <>
              <Button onClick={() => navigate("/workflows")} icon={<ArrowUpRight size={14} />}>
                Workflows
              </Button>
              <Button variant="primary" icon={<Plus size={15} />} onClick={openCreate}>
                Add account
              </Button>
            </>
          }
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-28 md:flex-row md:gap-4 md:overflow-hidden md:px-7 md:pb-6">
        <Card className="flex max-h-[48vh] w-full min-w-0 shrink-0 flex-col overflow-hidden md:max-h-none md:w-[360px] md:min-w-[310px]">
          <div className="space-y-2.5 border-b border-line/75 p-3">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, email, tags…"
                className="h-8 pl-8 text-xs"
                aria-label="Search accounts"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={providerFilter}
                onChange={(event) => setProviderFilter(event.target.value)}
                className="h-8 text-xs"
                aria-label="Filter by provider"
              >
                <option value="">All providers</option>
                {(providers.data ?? []).map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </Select>
              <Select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-8 text-xs"
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setFavoritesOnly((value) => !value)}
                aria-pressed={favoritesOnly}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10.5px] transition-colors ${
                  favoritesOnly ? "bg-accent/10 text-accent" : "text-faint hover:text-muted"
                }`}
              >
                <Star size={11} className={favoritesOnly ? "fill-current" : ""} />
                Favorites only
              </button>
              <span className="numeric text-[10px] text-faint">{list.length} shown</span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {accounts.isLoading ? (
              <div className="space-y-2 p-1">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-[74px] animate-pulse rounded-lg border border-line/60 bg-raised/40" />
                ))}
              </div>
            ) : accounts.isError ? (
              <div className="p-3 text-xs leading-5 text-danger">{accounts.error.message}</div>
            ) : list.length === 0 ? (
              <EmptyState
                icon={<UserRound size={18} />}
                title={activeFilters ? "No matching accounts" : "No accounts yet"}
                description={
                  activeFilters
                    ? "Adjust the search or filters. Accounts remain stored even when they do not match."
                    : "Add a provider identity, then open an isolated session to sign in."
                }
                action={
                  activeFilters ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuery("");
                        setProviderFilter("");
                        setStatusFilter("");
                        setFavoritesOnly(false);
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : (
                    <Button variant="primary" icon={<Plus size={14} />} onClick={openCreate}>
                      Add account
                    </Button>
                  )
                }
                className="py-10"
              />
            ) : (
              <ul className="space-y-1">
                {list.map((account) => {
                  const active = account.id === selectedId;
                  return (
                    <li key={account.id} className="relative">
                      <button
                        type="button"
                        onClick={() => selectAccount(account.id)}
                        aria-current={active ? "true" : undefined}
                        className={`w-full rounded-lg border px-3 py-2.5 pr-9 text-left transition-colors ${
                          active
                            ? "border-accent/25 bg-accent/[0.055]"
                            : "border-transparent hover:border-line/70 hover:bg-raised/40"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-raised text-[10px] font-semibold uppercase text-muted">
                            {account.name.slice(0, 1)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg">{account.name}</span>
                          <StatusBadge status={account.status} />
                        </div>
                        <p className="mt-1 truncate pl-8 text-[10.5px] text-faint">
                          {providerLabel(providers.data ?? [], account.provider)}
                          {account.email ? ` · ${account.email}` : ""}
                        </p>
                        {account.tags.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1 pl-8">
                            {account.tags.slice(0, 3).map((tag) => (
                              <span key={tag} className="rounded border border-line/70 bg-surface px-1.5 py-0.5 text-[9px] text-faint">
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </button>
                      <IconButton
                        label={account.favorite ? `Unpin ${account.name}` : `Pin ${account.name}`}
                        size="sm"
                        className={`absolute right-2 top-2 ${account.favorite ? "text-accent" : ""}`}
                        onClick={() => favorite.mutate({ id: account.id, value: !account.favorite })}
                      >
                        <Star size={13} className={account.favorite ? "fill-current" : ""} />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card className="flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={<UserRound size={20} />}
                title="Select an account"
                description="Account metadata, provider session state, and sign-in controls appear here."
              />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/75 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-fg">{selected.name}</h2>
                    <StatusBadge status={selected.status} />
                    {selected.favorite ? (
                      <Star size={13} className="fill-current text-accent" aria-label="Favorite" />
                    ) : null}
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <span>{providerLabel(providers.data ?? [], selected.provider)}</span>
                    {selected.email ? <span className="text-faint">· {selected.email}</span> : null}
                    <span className="text-faint">· created {relativeTime(selected.createdAt)}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={selected.status}
                    onChange={(event) => status.mutate({ id: selected.id, value: event.target.value as AccountStatus })}
                    className="h-8 w-[126px] text-xs"
                    aria-label="Account status"
                    disabled={status.isPending}
                  >
                    {STATUS_OPTIONS.map((item) => (
                      <option key={item} value={item}>
                        {item.replace(/_/g, " ")}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" icon={<Pencil size={13} />} onClick={() => openEdit(selected)}>
                    Edit
                  </Button>
                  <IconButton label={`Delete ${selected.name}`} tone="danger" onClick={() => requestDelete(selected)}>
                    <Trash2 size={15} />
                  </IconButton>
                  {android ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<ExternalLink size={13} />}
                      onClick={() => {
                        const provider = providerMap.get(selected.provider);
                        if (provider) void openUrl(provider.url);
                      }}
                    >
                      Provider sign-in
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={sessionFor ? "secondary" : "primary"}
                      icon={<ExternalLink size={13} />}
                      onClick={() => {
                        if (sessionFor) closeSession();
                        else setSessionFor(selected.id);
                      }}
                    >
                      {sessionFor ? "Close session" : "Open session"}
                    </Button>
                  )}
                </div>
              </div>

              {sessionFor && android ? (
                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                  <div className="rounded-xl border border-warn/25 bg-warn/[0.04] p-4">
                    <p className="text-sm font-medium text-warn">Embedded sign-in is not available on Android yet</p>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      Android does not currently support BITS AI Video Creator&apos; isolated per-account provider profiles.
                      Open the provider in your system browser, sign in there, and keep this account record for
                      workflow targeting and reminders.
                    </p>
                    <Button
                      className="mt-4"
                      size="sm"
                      variant="secondary"
                      icon={<ExternalLink size={13} />}
                      onClick={() => {
                        const provider = providerMap.get(selected.provider);
                        if (provider) void openUrl(provider.url);
                      }}
                    >
                      Open provider sign-in
                    </Button>
                  </div>
                </div>
              ) : sessionFor ? (
                <SessionPanel
                  key={selected.id}
                  account={selected}
                  provider={providerMap.get(selected.provider)}
                  onClose={closeSession}
                />
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                  <div className="grid gap-4 xl:grid-cols-2">
                    <section className="rounded-xl border border-line/80 bg-surface/45">
                      <div className="border-b border-line/60 px-4 py-2.5">
                        <SectionLabel>Metadata</SectionLabel>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-xs">
                        <div>
                          <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">Provider id</dt>
                          <dd className="mt-1 truncate font-mono text-[11px] text-muted">{selected.provider}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">External id</dt>
                          <dd className="mt-1 truncate font-mono text-[11px] text-muted">{selected.externalId ?? "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">Created</dt>
                          <dd className="mt-1 text-[11px] text-muted">{formatDateTime(selected.createdAt)}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">Updated</dt>
                          <dd className="mt-1 text-[11px] text-muted">{formatDateTime(selected.updatedAt)}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">Last opened</dt>
                          <dd className="mt-1 text-[11px] text-muted">{selected.lastOpenedAt ? relativeTime(selected.lastOpenedAt) : "Never"}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-[0.08em] text-faint">Last checked</dt>
                          <dd className="mt-1 text-[11px] text-muted">{selected.lastCheckedAt ? relativeTime(selected.lastCheckedAt) : "Never"}</dd>
                        </div>
                      </dl>
                    </section>

                    <section className="rounded-xl border border-line/80 bg-surface/45">
                      <div className="flex items-center justify-between border-b border-line/60 px-4 py-2.5">
                        <SectionLabel>Provider profile</SectionLabel>
                        <button
                          type="button"
                          onClick={() => void profile.refetch()}
                          className="inline-flex items-center gap-1 text-[10px] text-faint hover:text-fg"
                          disabled={profile.isFetching}
                        >
                          <RefreshCw size={11} className={profile.isFetching ? "animate-spin" : ""} />
                          Check
                        </button>
                      </div>
                      {profile.isLoading ? (
                        <div className="flex items-center gap-2 p-4 text-xs text-muted">
                          <Loader2 size={13} className="animate-spin" /> Inspecting isolated profile…
                        </div>
                      ) : profile.isError ? (
                        <p className="p-4 text-xs leading-5 text-danger">{profile.error.message}</p>
                      ) : profile.data ? (
                        <div className="space-y-2.5 p-4 text-xs">
                          <div className="flex items-center gap-2">
                            <Badge tone={profile.data.state === "ready" ? "success" : "warning"} dot>
                              {profile.data.state}
                            </Badge>
                            <span className="numeric text-[10.5px] text-faint">
                              {profile.data.fileCount} files · {formatBytes(profile.data.bytes)}
                            </span>
                          </div>
                          <p className="leading-5 text-muted">{profile.data.message}</p>
                          <p className="break-all font-mono text-[10px] leading-4 text-faint">{profile.data.profilePath}</p>
                          <p className="text-[10px] text-faint">
                            Last modified: {profile.data.lastModified ? formatDateTime(profile.data.lastModified) : "—"}
                          </p>
                        </div>
                      ) : null}
                    </section>
                  </div>

                  <section className="mt-4 rounded-xl border border-line/80 bg-surface/45">
                    <div className="border-b border-line/60 px-4 py-2.5">
                      <SectionLabel>Sign-in guidance</SectionLabel>
                    </div>
                    <div className="flex gap-3 p-4">
                      <ShieldCheck size={17} className="mt-0.5 shrink-0 text-accent" />
                      <div>
                        <p className="text-xs leading-5 text-muted">
                          {providerMap.get(selected.provider)?.signInHint ??
                            "Open the isolated provider session to sign in. BITS AI Video Creator never asks for provider passwords."}
                        </p>
                        <p className="mt-2 text-[10.5px] leading-4 text-faint">
                          The provider profile lives at{" "}
                          <span className="font-mono">{profile.data?.profilePath ?? "webview-profiles/<account-id>"}</span>.
                          Deleting the account removes this profile.
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="mt-4 rounded-xl border border-line/80 bg-surface/45">
                    <div className="border-b border-line/60 px-4 py-2.5">
                      <SectionLabel>Notes & tags</SectionLabel>
                    </div>
                    <div className="space-y-3 p-4">
                      {selected.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {selected.tags.map((tag) => (
                            <Badge key={tag} tone="neutral">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-faint">No tags.</p>
                      )}
                      <p className="whitespace-pre-wrap break-words text-xs leading-6 text-muted">
                        {selected.notes.trim() || "No notes."}
                      </p>
                    </div>
                  </section>

                  {selected.status !== "active" ? (
                    <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-warn/25 bg-warn/5 p-3.5">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
                      <div className="text-xs leading-5 text-muted">
                        This account is marked <strong className="text-warn">{selected.status.replace(/_/g, " ")}</strong>.
                        Account checks configured with “fail when inactive” will stop workflows until the status is
                        set back to active.
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-accent/20 bg-accent/[0.035] p-3.5">
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-accent" />
                      <p className="text-xs leading-5 text-muted">
                        Status is managed locally. If a provider session expires, set the status to
                        “needs sign-in” and open the session to authenticate again.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <AccountFormModal
        account={editing}
        providers={providers.data ?? []}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={(saved) => {
          setSelectedId(saved.id);
          invalidateAccount(saved.id);
        }}
      />

      <ConfirmDialog
        open={deleteTarget != null}
        title="Delete account"
        description={
          <>
            This removes <strong className="text-fg">{deleteTarget?.name}</strong> from the local database and deletes
            its isolated provider profile, including session cookies. Workflow steps that reference this account will
            fail validation until updated. This cannot be undone.
          </>
        }
        confirmationLabel={deleteTarget?.name ?? ""}
        confirmLabel="Delete account"
        busy={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget);
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
