import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, toApiError } from "../lib/api";
import { parseJsonObject, stringifyJson } from "../lib/format";
import type { Workflow, WorkflowSummary } from "../lib/types";
import { useToast } from "./Toast";
import { Button, Field, Modal, Textarea } from "./ui";

export interface RunnableWorkflow {
  id: string;
  name: string;
}

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function RunWorkflowDialog({
  workflow,
  open,
  onClose,
  onQueued,
}: {
  workflow: RunnableWorkflow | null;
  open: boolean;
  onClose: () => void;
  onQueued?: (workflow: RunnableWorkflow) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState("{}");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setText("{}");
    setIdempotencyKey(newKey());
    setShowAdvanced(false);
    setError(null);
  }, [open, workflow?.id]);

  const parsed = useMemo(() => parseJsonObject(text), [text]);

  const run = useMutation({
    mutationFn: async (target: RunnableWorkflow) => {
      if (!parsed.ok) throw new Error(`Input is not valid JSON: ${parsed.error}`);
      return api.runWorkflow(target.id, parsed.value, idempotencyKey.trim() || undefined);
    },
    onSuccess: (_created, submitted) => {
      toast.success("Run queued", `${submitted.name} is waiting for an available worker.`);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onQueued?.(submitted);
      onClose();
    },
    onError: (cause) => {
      const apiError = toApiError(cause);
      setError(apiError.message);
      toast.error("Unable to start run", apiError.message);
    },
  });

  return (
    <Modal
      open={open}
      onClose={run.isPending ? () => undefined : onClose}
      closeOnBackdrop={!run.isPending}
      title={workflow ? `Run “${workflow.name}”` : "Run workflow"}
      description="The run is queued locally and executed by the background engine. Secrets are resolved only inside the engine."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={run.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Play size={14} />}
            loading={run.isPending}
            disabled={!parsed.ok || !workflow}
            onClick={() => {
              if (workflow) run.mutate(workflow);
            }}
          >
            Queue run
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Run input"
          hint={
            parsed.ok
              ? "Provide a JSON value. Use {{input.name}} in templates to reference fields."
              : `Invalid JSON: ${parsed.error}`
          }
        >
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={9}
            spellCheck={false}
            className="font-mono text-xs leading-5"
            aria-label="Run input JSON"
          />
        </Field>

        <div className="rounded-lg border border-line/80 bg-surface/60 px-3 py-2.5">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted"
            onClick={() => setShowAdvanced((value) => !value)}
            aria-expanded={showAdvanced}
          >
            Idempotency key
            <span className="text-[10px] normal-case tracking-normal text-faint">
              {showAdvanced ? "Hide" : "Show"}
            </span>
          </button>
          {showAdvanced ? (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <input
                  value={idempotencyKey}
                  onChange={(event) => setIdempotencyKey(event.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 font-mono text-[11px] text-fg focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/15"
                  aria-label="Idempotency key"
                  spellCheck={false}
                />
                <Button size="sm" variant="secondary" icon={<RefreshCw size={12} />} onClick={() => setIdempotencyKey(newKey())}>
                  New
                </Button>
              </div>
              <p className="text-[10.5px] leading-4 text-faint">
                While a run with this key is queued or running, a second submission is rejected. Leave blank to
                allow duplicates.
              </p>
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs leading-5 text-danger">{error}</p>
        ) : null}

        {parsed.ok ? (
          <details className="rounded-lg border border-line/70 bg-surface/40 px-3 py-2 text-xs text-muted">
            <summary className="cursor-pointer text-[11px] text-faint">Preview normalized input</summary>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-5">
              {stringifyJson(parsed.value)}
            </pre>
          </details>
        ) : null}
      </div>
    </Modal>
  );
}

export function runnableFromSummary(workflow: WorkflowSummary): RunnableWorkflow {
  return { id: workflow.id, name: workflow.name };
}

export function runnableFromWorkflow(workflow: Workflow): RunnableWorkflow {
  return { id: workflow.id, name: workflow.name };
}
