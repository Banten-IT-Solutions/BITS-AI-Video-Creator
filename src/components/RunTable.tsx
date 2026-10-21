import { Eye, Square } from "lucide-react";
import { Button, ProgressBar, StatusBadge } from "./ui";
import { formatDuration, formatTime, relativeTime } from "../lib/format";
import type { Run } from "../lib/types";

export function RunTable({
  runs,
  onSelect,
  onCancel,
  compact = false,
  busyRunId,
}: {
  runs: Run[];
  onSelect: (id: string) => void;
  onCancel?: (id: string) => void;
  compact?: boolean;
  busyRunId?: string | null;
}) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line/70 text-[10px] uppercase tracking-[0.08em] text-faint">
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Workflow</th>
            {compact ? null : <th className="px-2 py-2 font-medium">Trigger</th>}
            <th className="px-2 py-2 font-medium">Queued</th>
            {compact ? null : <th className="px-2 py-2 font-medium">Duration</th>}
            <th className="px-2 py-2 text-right font-medium">Steps</th>
            <th className="w-24 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const active = run.status === "queued" || run.status === "running";
            return (
              <tr key={run.id} className="group border-b border-line/45 last:border-0 hover:bg-raised/30">
                <td className="px-2 py-2.5">
                  <StatusBadge status={run.status} />
                </td>
                <td className="max-w-[260px] px-2 py-2.5">
                  <button
                    type="button"
                    onClick={() => onSelect(run.id)}
                    className="block max-w-full truncate text-left text-xs font-medium text-fg hover:text-accent"
                    title={run.workflowName}
                  >
                    {run.workflowName}
                  </button>
                  <span className="mt-0.5 block font-mono text-[9.5px] text-faint">{run.id.slice(0, 8)}</span>
                </td>
                {compact ? null : (
                  <td className="px-2 py-2.5 text-[11px] capitalize text-muted">{run.trigger}</td>
                )}
                <td className="px-2 py-2.5">
                  <span className="block text-[11px] text-muted" title={relativeTime(run.queuedAt)}>
                    {formatTime(run.queuedAt)}
                  </span>
                  <span className="block text-[10px] text-faint">{relativeTime(run.queuedAt)}</span>
                </td>
                {compact ? null : (
                  <td className="numeric px-2 py-2.5 text-[11px] text-muted">{formatDuration(run.durationMs)}</td>
                )}
                <td className="px-2 py-2.5">
                  <div className="ml-auto w-20">
                    <div className="mb-1 flex items-center justify-between text-[9.5px] text-faint">
                      <span className="numeric">
                        {run.completedSteps}/{run.totalSteps}
                      </span>
                    </div>
                    <ProgressBar value={run.completedSteps} maximum={Math.max(run.totalSteps, 1)} />
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    {active && onCancel ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[10px]"
                        icon={<Square size={11} />}
                        loading={busyRunId === run.id}
                        onClick={() => onCancel(run.id)}
                      >
                        Cancel
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[10px]"
                      icon={<Eye size={12} />}
                      onClick={() => onSelect(run.id)}
                    >
                      View
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
