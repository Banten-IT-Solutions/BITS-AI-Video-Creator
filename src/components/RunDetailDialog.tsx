import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CircleSlash,
  Clock3,
  Copy,
  Loader2,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatDateTime, formatDuration, formatTime, relativeTime, statusTone, stringifyJson } from "../lib/format";
import type { RunStep } from "../lib/types";
import { useToast } from "./Toast";
import { Badge, Button, IconButton, Modal, ProgressBar, StatusBadge } from "./ui";

function StepIcon({ status }: { status: string }) {
  if (status === "succeeded") return <Check size={13} className="text-accent" />;
  if (status === "failed") return <X size={13} className="text-danger" />;
  if (status === "cancelled") return <CircleSlash size={13} className="text-warn" />;
  if (status === "running") return <Loader2 size={13} className="animate-spin text-info" />;
  return <Clock3 size={13} className="text-muted" />;
}

function StepRow({ step }: { step: RunStep }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = step.output != null || step.error != null;
  return (
    <li className="relative pl-7">
      <span className="absolute left-0 top-1 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-surface">
        <StepIcon status={step.status} />
      </span>
      <button
        type="button"
        onClick={() => hasDetail && setExpanded((value) => !value)}
        className="flex w-full items-start justify-between gap-3 rounded-md py-1 text-left transition-colors hover:bg-raised/40"
        aria-expanded={expanded}
      >
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium text-fg">{step.nodeName}</span>
          <span className="mt-0.5 block font-mono text-[10px] text-faint">
            {step.nodeType}
            {step.attempt > 1 ? ` · attempt ${step.attempt}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[10px] text-faint">
          {step.durationMs != null ? <span className="numeric">{formatDuration(step.durationMs)}</span> : null}
          <span className={statusTone(step.status) === "danger" ? "text-danger" : statusTone(step.status) === "success" ? "text-accent" : "text-muted"}>
            {step.status}
          </span>
        </span>
      </button>
      {expanded ? (
        <div className="mb-3 mt-1 space-y-2">
          {step.error ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-danger/25 bg-danger/5 p-2.5 font-mono text-[10.5px] leading-5 text-danger">
              {step.error}
            </pre>
          ) : null}
          {step.output != null ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface p-2.5 font-mono text-[10.5px] leading-5 text-muted">
              {stringifyJson(step.output)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function RunDetailDialog({
  runId,
  open,
  onClose,
}: {
  runId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!open) setCopied(false);
  }, [open, runId]);
  const detail = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.getRun(runId as string),
    enabled: open && Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === "queued" || status === "running" ? 1_500 : false;
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["runs"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["run", runId] });
  };

  const cancel = useMutation({
    mutationFn: () => api.cancelRun(runId as string),
    onSuccess: (requested) => {
      toast.info(requested ? "Cancellation requested" : "Run already finished");
      invalidate();
    },
    onError: (error) => toast.error("Unable to cancel run", error.message),
  });

  const retry = useMutation({
    mutationFn: () => api.retryRun(runId as string),
    onSuccess: (run) => {
      toast.success("Retry queued", `New run ${run.id.slice(0, 8)} is waiting for a worker.`);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error("Unable to retry run", error.message),
  });

  const run = detail.data?.run;
  const steps = detail.data?.steps ?? [];
  const active = run?.status === "queued" || run?.status === "running";

  const copyJson = async () => {
    if (!run?.output) return;
    try {
      await navigator.clipboard.writeText(stringifyJson(run.output));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={run ? `${run.workflowName} · run` : "Run details"}
      description={run ? <span className="font-mono text-[11px] text-faint">{run.id}</span> : undefined}
      footer={
        run ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {active ? (
              <Button
                variant="danger"
                icon={<Square size={13} />}
                loading={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                Cancel run
              </Button>
            ) : (
              <Button
                variant="secondary"
                icon={<RotateCcw size={13} />}
                loading={retry.isPending}
                onClick={() => retry.mutate()}
              >
                Run again
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {detail.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-xs text-muted">
          <Loader2 size={14} className="animate-spin" /> Loading run…
        </div>
      ) : detail.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
          {detail.error.message}
        </div>
      ) : run ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={run.status} />
            <Badge tone="neutral">{run.trigger}</Badge>
            {run.cancelRequested && active ? <Badge tone="warning">Cancel requested</Badge> : null}
            {run.durationMs != null ? <Badge tone="neutral">{formatDuration(run.durationMs)}</Badge> : null}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-line/80 bg-surface/60 p-4 sm:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.1em] text-faint">Queued</p>
              <p className="mt-1 text-xs text-fg">{formatTime(run.queuedAt)}</p>
              <p className="text-[10px] text-faint">{relativeTime(run.queuedAt)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.1em] text-faint">Started</p>
              <p className="mt-1 text-xs text-fg">{formatTime(run.startedAt)}</p>
              <p className="text-[10px] text-faint">{run.startedAt ? formatDateTime(run.startedAt) : "Not started"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.1em] text-faint">Finished</p>
              <p className="mt-1 text-xs text-fg">{formatTime(run.finishedAt)}</p>
              <p className="text-[10px] text-faint">{run.finishedAt ? formatDateTime(run.finishedAt) : "In progress"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.1em] text-faint">Progress</p>
              <p className="mt-1 numeric text-xs text-fg">
                {run.completedSteps} / {run.totalSteps} steps
              </p>
              <ProgressBar value={run.completedSteps} maximum={Math.max(run.totalSteps, 1)} className="mt-2" />
            </div>
          </div>

          {run.error ? (
            <div className="flex gap-2.5 rounded-xl border border-danger/30 bg-danger/5 p-3.5">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-danger" />
              <div>
                <p className="text-xs font-medium text-danger">Run error</p>
                <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-danger/90">
                  {run.error}
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Step timeline</h3>
                <span className="numeric text-[10px] text-faint">{steps.length} records</span>
              </div>
              {steps.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-faint">
                  No steps recorded yet.
                </p>
              ) : (
                <ol className="relative ml-2 space-y-1 border-l border-line/80 pl-4">
                  {steps.map((step) => (
                    <StepRow key={step.id} step={step} />
                  ))}
                </ol>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Input</h3>
                </div>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface p-3 font-mono text-[10.5px] leading-5 text-muted">
                  {stringifyJson(run.input)}
                </pre>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Output</h3>
                  {run.output ? (
                    <IconButton label="Copy output" size="sm" onClick={() => void copyJson()}>
                      {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
                    </IconButton>
                  ) : null}
                </div>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface p-3 font-mono text-[10.5px] leading-5 text-muted">
                  {run.output ? stringifyJson(run.output) : "No output recorded."}
                </pre>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
