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
import { formatNumber } from "../lib/format";
import { navigate } from "../lib/router";
import type { RunStatus } from "../lib/types";

const PAGE_SIZE = 50;
const STATUSES: RunStatus[] = ["queued", "running", "succeeded", "failed", "cancelled", "missed"];

export function RunsPage() {
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
      toast.info(requested ? "Cancellation requested" : "Run already finished", `Run ${id.slice(0, 8)}`);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["run", id] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (cause) => toast.error("Unable to cancel run", toApiError(cause).message),
  });

  const list = runs.data ?? [];
  const hasFilters = Boolean(status || workflowId);
  const stats = dashboard.data;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Execution"
        title="Run history"
        description="Persisted executions from manual, scheduled, and retried runs. Step output is captured per node and remains available after restarts."
        actions={
          <Button icon={<RefreshCw size={14} />} loading={runs.isFetching} onClick={() => void runs.refetch()}>
            Refresh
          </Button>
        }
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Running", value: stats?.runningRuns, icon: <Activity size={14} />, tone: "text-info" },
          { label: "Queued", value: stats?.queuedRuns, icon: <Clock3 size={14} />, tone: "text-warn" },
          { label: "Succeeded", value: stats?.succeededRuns, icon: <CheckCircle2 size={14} />, tone: "text-accent" },
          { label: "Failed", value: stats?.failedRuns, icon: <XCircle size={14} />, tone: "text-danger" },
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
          title="Executions"
          description="Newest first. Click a run to inspect steps, input, output, and cancellation state."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(0);
                }}
                className="h-8 w-[136px] text-xs"
                aria-label="Filter by run status"
              >
                <option value="">All statuses</option>
                {STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {item}
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
                aria-label="Filter by workflow"
              >
                <option value="">All workflows</option>
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
                  Clear
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
                Retry
              </Button>
            </div>
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<ListChecks size={20} />}
            title={hasFilters ? "No runs match these filters" : "No runs recorded"}
            description={
              hasFilters
                ? "Change the status or workflow filter. Older runs remain stored regardless of the current filter."
                : "Run a workflow manually or enable a schedule. Queued and completed runs appear here with their step history."
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
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" onClick={() => navigate("/workflows")}>
                  Open workflows
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
            Page {page + 1}
            {list.length > 0 ? ` · ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + list.length}` : ""}
            {runs.isFetching ? " · refreshing" : ""}
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
              disabled={list.length < PAGE_SIZE}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
              <ChevronRight size={13} />
            </Button>
          </div>
        </div>
      </Card>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[10.5px] text-faint">
        <Badge tone="neutral">Auto-refresh 4s</Badge>
        <span>Runs are executed in a background worker; closing the window does not mark active runs succeeded.</span>
      </div>

      <RunDetailDialog runId={runId} open={runId != null} onClose={() => setRunId(null)} />
    </PageContainer>
  );
}
