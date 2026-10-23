import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eraser,
  RefreshCw,
  ScrollText,
  Search,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { PageContainer } from "../components/Layout";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  PageHeader,
  Select,
} from "../components/ui";
import { api, toApiError } from "../lib/api";
import { formatDateTime, formatTime, relativeTime, stringifyJson } from "../lib/format";
import type { LogEntry } from "../lib/types";

const PAGE_SIZE = 100;
const LEVELS = ["trace", "debug", "info", "warn", "error"];

function levelTone(level: string): "neutral" | "info" | "warning" | "danger" {
  if (level === "error") return "danger";
  if (level === "warn") return "warning";
  if (level === "info") return "info";
  return "neutral";
}

function LogRow({ entry, expanded, onToggle }: { entry: LogEntry; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-line/45 last:border-0">
      <div className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-raised/25">
        <div className="w-[84px] shrink-0">
          <span className="block font-mono text-[10.5px] text-muted" title={formatDateTime(entry.ts)}>
            {formatTime(entry.ts)}
          </span>
          <span className="block text-[9.5px] text-faint">{relativeTime(entry.ts)}</span>
        </div>
        <div className="w-[58px] shrink-0">
          <Badge tone={levelTone(entry.level)}>{entry.level}</Badge>
        </div>
        <div className="w-[92px] shrink-0">
          <span className="block truncate font-mono text-[10px] text-faint">{entry.scope}</span>
        </div>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onToggle} className="block w-full text-left">
            <span className={`block break-words text-[11.5px] leading-5 ${expanded ? "" : "line-clamp-2"} text-muted`}>
              {entry.message}
            </span>
            {entry.runId ? (
              <span className="mt-0.5 block font-mono text-[9px] text-faint">run {entry.runId.slice(0, 12)}</span>
            ) : null}
          </button>
        </div>
        <IconButton label={expanded ? "Collapse log entry" : "Expand log entry"} size="sm" onClick={onToggle}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </IconButton>
      </div>
      {expanded ? (
        <div className="space-y-2 bg-surface/40 px-4 pb-3 pl-6">
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-faint">
            <Badge tone="neutral">{entry.level}</Badge>
            <span className="font-mono">{entry.scope}</span>
            <span>{formatDateTime(entry.ts)}</span>
            {entry.runId ? (
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(entry.runId ?? "").catch(() => undefined)}
                className="font-mono text-faint underline decoration-line underline-offset-2 hover:text-fg"
              >
                {entry.runId}
              </button>
            ) : null}
          </div>
          {entry.details != null ? (
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line/70 bg-surface p-3 font-mono text-[10px] leading-4 text-muted">
              {stringifyJson(entry.details)}
            </pre>
          ) : (
            <p className="text-[10px] text-faint">No structured details for this entry.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function LogsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [level, setLevel] = useState("");
  const [scope, setScope] = useState("");
  const [query, setQuery] = useState("");
  const [runId, setRunId] = useState("");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  const deferredScope = useDeferredValue(scope);
  const deferredQuery = useDeferredValue(query);
  const deferredRunId = useDeferredValue(runId);

  const logs = useQuery({
    queryKey: ["logs", level, deferredScope, deferredQuery, deferredRunId, page],
    queryFn: () =>
      api.listLogs({
        level: level || undefined,
        scope: deferredScope.trim() || undefined,
        query: deferredQuery.trim() || undefined,
        runId: deferredRunId.trim() || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    refetchInterval: 15_000,
  });

  const clear = useMutation({
    mutationFn: () => api.clearLogs(true),
    onSuccess: (removed) => {
      toast.success("Logs cleared", `${removed} entr${removed === 1 ? "y" : "ies"} removed.`);
      setClearOpen(false);
      setPage(0);
      void queryClient.invalidateQueries({ queryKey: ["logs"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (cause) => toast.error("Unable to clear logs", toApiError(cause).message),
  });

  const entries = logs.data ?? [];
  const hasFilters = Boolean(level || scope || query || runId);
  const counts = LEVELS.map((item) => ({ level: item, count: entries.filter((entry) => entry.level === item).length }));

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Diagnostics"
        title="Logs"
        description="Application, scheduler, engine, and account events. Sensitive values are redacted before insertion; log retention and row caps are configured in settings."
        actions={
          <>
            <Button icon={<RefreshCw size={14} />} loading={logs.isFetching} onClick={() => void logs.refetch()}>
              Refresh
            </Button>
            <Button variant="danger" icon={<Eraser size={14} />} onClick={() => setClearOpen(true)}>
              Clear logs
            </Button>
          </>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setLevel("");
            setPage(0);
          }}
          className={`rounded-full border px-2.5 py-1 text-[10.5px] font-medium transition-colors ${
            level === "" ? "border-accent/30 bg-accent/10 text-accent" : "border-line bg-surface text-muted hover:text-fg"
          }`}
        >
          All levels
          <span className="numeric ml-1.5 text-[9px] opacity-70">{entries.length}</span>
        </button>
        {counts.map((item) => (
          <button
            key={item.level}
            type="button"
            onClick={() => {
              setLevel(item.level);
              setPage(0);
            }}
            className={`rounded-full border px-2.5 py-1 text-[10.5px] font-medium capitalize transition-colors ${
              level === item.level
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-line bg-surface text-muted hover:text-fg"
            }`}
          >
            {item.level}
            <span className="numeric ml-1.5 text-[9px] opacity-70">{item.count}</span>
          </button>
        ))}
        <span className="ml-auto text-[9.5px] text-faint">Counts reflect the current page only.</span>
      </div>

      <Card className="mt-3 overflow-hidden">
        <CardHeader
          title="Event stream"
          description="Newest first. Filtering is applied by the local database before pagination."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={level}
                onChange={(event) => {
                  setLevel(event.target.value);
                  setPage(0);
                }}
                className="h-8 w-[118px] text-xs"
                aria-label="Filter by log level"
              >
                <option value="">All levels</option>
                {LEVELS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </div>
          }
        />

        <div className="grid gap-2 border-b border-line/70 bg-surface/30 p-3 sm:grid-cols-3">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder="Search message or details…"
              className="h-8 pl-8 text-xs"
              aria-label="Search log messages"
            />
          </div>
          <Input
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
              setPage(0);
            }}
            placeholder="Exact scope, e.g. scheduler"
            className="h-8 font-mono text-[11px]"
            aria-label="Filter by scope"
          />
          <Input
            value={runId}
            onChange={(event) => {
              setRunId(event.target.value);
              setPage(0);
            }}
            placeholder="Run id (exact)"
            className="h-8 font-mono text-[11px]"
            aria-label="Filter by run id"
          />
        </div>

        {logs.isLoading ? (
          <div className="space-y-1 p-3">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="h-9 animate-pulse rounded bg-raised/40" />
            ))}
          </div>
        ) : logs.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-xs text-danger">{logs.error.message}</p>
            <Button size="sm" variant="secondary" onClick={() => void logs.refetch()}>
              Retry
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<ScrollText size={18} />}
            title={hasFilters ? "No log entries match" : "No log entries"}
            description={
              hasFilters
                ? "Try a broader search, clear the scope or run id, or select another level."
                : "Log entries appear after application activity. Run a workflow to populate engine and step logs."
            }
            action={
              hasFilters ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setLevel("");
                    setScope("");
                    setQuery("");
                    setRunId("");
                    setPage(0);
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div>
            {entries.map((entry) => (
              <LogRow
                key={entry.id}
                entry={entry}
                expanded={expandedId === entry.id}
                onToggle={() => setExpandedId((current) => (current === entry.id ? null : entry.id))}
              />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/70 px-4 py-3">
          <span className="text-[10px] text-faint">
            Page {page + 1}
            {entries.length > 0 ? ` · ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + entries.length}` : ""}
            {logs.isFetching ? " · refreshing" : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<ChevronLeft size={13} />}
              disabled={page === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={entries.length < PAGE_SIZE}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
              <ChevronRight size={13} />
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={clearOpen}
        title="Clear all logs"
        description="This permanently deletes every log entry, including run-scoped diagnostics. Run history, step output, workflows, and accounts are not affected. This cannot be undone."
        confirmLabel="Clear logs"
        busy={clear.isPending}
        onConfirm={() => clear.mutate()}
        onClose={() => setClearOpen(false)}
      />
    </PageContainer>
  );
}
