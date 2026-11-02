import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListChecks,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { PageContainer } from "../components/Layout";
import { RunDetailDialog } from "../components/RunDetailDialog";
import { RunTable } from "../components/RunTable";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Select,
} from "../components/ui";
import { api, toApiError } from "../lib/api";
import { formatNumber, humanStatus } from "../lib/format";
import { navigate } from "../lib/router";
import type { RunStatus } from "../lib/types";
import { useI18n } from "../i18n";

const PAGE_SIZE = 50;
const STATUSES: RunStatus[] = ["queued", "running", "succeeded", "failed", "cancelled", "missed"];

export function RunsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [page, setPage] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);

  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.getDashboard,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && data.queuedRuns + data.runningRuns > 0 ? 4_000 : 30_000;
    },
  });
  const workflows = useQuery({ queryKey: ["workflows"], queryFn: api.listWorkflows });
  const runs = useQuery({
    queryKey: ["runs", status, workflowId, page],
    queryFn: () =>
      api.listRuns({
        status: status || undefined,
        workflowId: workflowId || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    refetchInterval: (query) => {
      const rows = query.state.data;
      return rows?.some((run) => run.status === "queued" || run.status === "running")
        ? 4_000
        : 30_000;
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelRun(id),
    onSuccess: (requested, id) => {
      toast.info(
        requested ? t("runs.cancellationRequested", "Cancellation requested") : t("runs.alreadyFinished", "Run already finished"),
        t("runs.runToken", "Run {id}", { id: id.slice(0, 8) }),
      );
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["run", id] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (cause) => toast.error(t("runs.unableToCancel", "Unable to cancel run"), toApiError(cause).message),
  });

  const list = runs.data ?? [];
  const hasFilters = Boolean(status || workflowId);
  const stats = dashboard.data;

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("runs.eyebrow", "Execution")}
        title={t("runs.title", "Run history")}
        description={t(
          "runs.description",
          "Persisted executions from manual, scheduled, and retried runs. Step output is captured per node and remains available after restarts.",
        )}
        actions={
          <Button icon={<RefreshCw size={14} />} loading={runs.isFetching} onClick={() => void runs.refetch()}>
            {t("common.refresh", "Refresh")}
          </Button>
        }
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: t("status.running", "Running"), value: stats?.runningRuns, icon: <Activity size={14} />, tone: "text-info" },
          { label: t("status.queued", "Queued"), value: stats?.queuedRuns, icon: <Clock3 size={14} />, tone: "text-warn" },
          { label: t("status.succeeded", "Succeeded"), value: stats?.succeededRuns, icon: <CheckCircle2 size={14} />, tone: "text-accent" },
          { label: t("status.failed", "Failed"), value: stats?.failedRuns, icon: <XCircle size={14} />, tone: "text-danger" },
        ].map((item) => (
          <Card key={item.label}>
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.1em] text-faint">{item.label}</p>
                <p className="numeric mt-1.5 text-xl font-semibold text-fg">{formatNumber(item.value ?? 0)}</p>
              </div>
              <span className={item.tone}>{item.icon}</span>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader
          title={t("runs.executions", "Executions")}
          description={t(
            "runs.executionsDesc",
            "Newest first. Click a run to inspect steps, input, output, and cancellation state.",
          )}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(0);
                }}
                className="h-8 w-[136px] text-xs"
                aria-label={t("runs.filterByStatus", "Filter by run status")}
              >
                <option value="">{t("runs.allStatuses", "All statuses")}</option>
                {STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {humanStatus(item)}
                  </option>
                ))}
              </Select>
              <Select
                value={workflowId}
                onChange={(event) => {
                  setWorkflowId(event.target.value);
                  setPage(0);
                }}
                className="h-8 w-[190px] text-xs"
                aria-label={t("runs.filterByWorkflow", "Filter by workflow")}
              >
                <option value="">{t("runs.allWorkflows", "All workflows")}</option>
                {(workflows.data ?? []).map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </option>
                ))}
              </Select>
              {hasFilters ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setStatus("");
                    setWorkflowId("");
                    setPage(0);
                  }}
                >
                  {t("runs.clear", "Clear")}
                </Button>
              ) : null}
            </div>
          }
        />

        {runs.isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="h-12 animate-pulse rounded-lg bg-raised/40" />
            ))}
          </div>
        ) : runs.isError ? (
          <div className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3">
              <p className="text-xs text-danger">{runs.error.message}</p>
              <Button size="sm" variant="secondary" onClick={() => void runs.refetch()}>
                {t("common.retry", "Retry")}
              </Button>
            </div>
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<ListChecks size={20} />}
            title={hasFilters ? t("runs.noRunsFiltered", "No runs match these filters") : t("runs.noRuns", "No runs recorded")}
            description={
              hasFilters
                ? t(
                    "runs.noRunsFilteredDesc",
                    "Change the status or workflow filter. Older runs remain stored regardless of the current filter.",
                  )
                : t(
                    "runs.noRunsDesc",
                    "Run a workflow manually or enable a schedule. Queued and completed runs appear here with their step history.",
                  )
            }
            action={
              hasFilters ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStatus("");
                    setWorkflowId("");
                    setPage(0);
                  }}
                >
                  {t("runs.clearFilters", "Clear filters")}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => navigate("/workflows")}>
                  {t("runs.openWorkflows", "Open workflows")}
                </Button>
              )
            }
          />
        ) : (
          <div className="px-3 pb-3">
            <RunTable
              runs={list}
              onSelect={setRunId}
              onCancel={(id) => cancel.mutate(id)}
              busyRunId={cancel.isPending ? (cancel.variables ?? null) : null}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/70 px-5 py-3">
          <span className="text-[10px] text-faint">
            {t("runs.page", "Page {page}", { page: page + 1 })}
            {list.length > 0 ? ` · ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + list.length}` : ""}
            {runs.isFetching ? ` · ${t("runs.refreshing", "refreshing")}` : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<ChevronLeft size={13} />}
              disabled={page === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              {t("runs.previous", "Previous")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={list.length < PAGE_SIZE}
              onClick={() => setPage((value) => value + 1)}
            >
              {t("runs.next", "Next")}
              <ChevronRight size={13} />
            </Button>
          </div>
        </div>
      </Card>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[10.5px] text-faint">
        <Badge tone="neutral">{t("runs.autoRefresh", "Auto-refresh 4s")}</Badge>
        <span>{t("runs.workerNote", "Runs are executed in a background worker; closing the window does not mark active runs succeeded.")}</span>
      </div>

      <RunDetailDialog runId={runId} open={runId != null} onClose={() => setRunId(null)} />
    </PageContainer>
  );
}
