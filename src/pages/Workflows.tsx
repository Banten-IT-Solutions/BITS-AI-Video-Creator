import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Copy,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Workflow as WorkflowIcon,
  Zap,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { PageContainer } from "../components/Layout";
import { RunWorkflowDialog, runnableFromSummary, type RunnableWorkflow } from "../components/RunWorkflowDialog";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dropdown,
  DropdownItem,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from "../components/ui";
import { api, toApiError } from "../lib/api";
import { formatDateTime, relativeTime } from "../lib/format";
import { navigate } from "../lib/router";
import type { WorkflowDraft, WorkflowInput, WorkflowSummary } from "../lib/types";
import { blankDefinition } from "../lib/workflow";

function tagsFrom(value: string): string[] {
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

function AiDraftModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<WorkflowDraft | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: () => api.generateWorkflowDraft(description.trim()),
    onSuccess: (value) => {
      setDraft(value);
      setName(value.name);
      setError(null);
    },
    onError: (cause) => {
      setDraft(null);
      setError(toApiError(cause).message);
    },
  });

  const create = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("Generate a draft first");
      return api.createWorkflow({
        name: name.trim() || draft.name,
        description: draft.description,
        tags: draft.tags,
        enabled: false,
        definition: draft.definition,
        schedule: null,
      });
    },
    onSuccess: (workflow) => {
      toast.success("Draft created", "Review and test it before enabling the workflow.");
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
      navigate(`/workflows/${workflow.id}`);
    },
    onError: (cause) => toast.error("Unable to create workflow", toApiError(cause).message),
  });

  return (
    <Modal
      open={open}
      onClose={generate.isPending || create.isPending ? () => undefined : onClose}
      closeOnBackdrop={!generate.isPending && !create.isPending}
      title="Generate a workflow draft"
      description="Describe the automation. BITS AI Video Creator asks the configured OpenAI-compatible endpoint, validates the result, and shows it here before saving."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={generate.isPending || create.isPending}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            icon={<Sparkles size={14} />}
            loading={generate.isPending}
            disabled={!description.trim()}
            onClick={() => generate.mutate()}
          >
            Generate draft
          </Button>
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            loading={create.isPending}
            disabled={!draft?.validation.valid || !name.trim()}
            onClick={() => create.mutate()}
          >
            Create workflow
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="What should the workflow do?" hint="Up to 4,000 characters. Do not include secret values.">
          <Textarea
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setDraft(null);
              setError(null);
            }}
            rows={5}
            maxLength={4000}
            placeholder="Every weekday, call https://api.example.com/health with a secret token and log a warning when the status is not 200."
            disabled={generate.isPending}
          />
        </Field>
        {error ? (
          <p className="rounded-lg border border-danger/25 bg-danger/5 p-3 text-xs leading-5 text-danger">{error}</p>
        ) : null}
        {draft ? (
          <div className="space-y-3 rounded-xl border border-line/80 bg-surface/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-fg">{draft.definition.nodes.length} nodes · {draft.definition.edges.length} edges</p>
                <p className="mt-0.5 text-[10px] text-faint">
                  Generated from {description.length.toLocaleString()} characters of instructions.
                </p>
              </div>
              <Badge tone={draft.validation.valid ? "success" : "danger"} dot>
                {draft.validation.valid ? "valid draft" : "needs fixes"}
              </Badge>
            </div>
            <Field label="Workflow name">
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} />
            </Field>
            <div>
              <p className="text-[9.5px] uppercase tracking-[0.1em] text-faint">Nodes</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {draft.definition.nodes.map((node) => (
                  <li key={node.id} className="rounded-md border border-line/70 bg-panel px-2 py-1 font-mono text-[9.5px] text-muted">
                    {node.type}
                  </li>
                ))}
              </ul>
            </div>
            {draft.validation.issues.length > 0 ? (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line/70 bg-bg/40 p-2.5">
                {draft.validation.issues.map((issue, index) => (
                  <li key={`${issue.path}-${index}`} className="text-[10px] leading-4 text-muted">
                    <span className={issue.severity === "error" ? "text-danger" : "text-warn"}>{issue.severity}</span>{" "}
                    <span className="font-mono text-faint">{issue.path}</span> · {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-[9.5px] leading-4 text-faint">
              Nothing has been saved. Creating the workflow stores this exact definition, paused, after your
              confirmation.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-line/70 bg-surface/40 p-3 text-[10.5px] leading-4 text-muted">
            Configure the endpoint, model, and an <span className="font-mono text-fg">ai.api_key</span> secret in
            Settings → Integrations first.
          </div>
        )}
      </div>
    </Modal>
  );
}

function CreateWorkflowModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (workflowId: string) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const input: WorkflowInput = {
        name: name.trim(),
        description: description.trim(),
        tags: tagsFrom(tags),
        enabled: true,
        definition: blankDefinition(),
        schedule: null,
      };
      return api.createWorkflow(input);
    },
    onSuccess: (workflow) => {
      toast.success("Workflow created", "Add actions and connect them in the editor.");
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onCreated(workflow.id);
    },
    onError: (cause) => setError(toApiError(cause).message),
  });

  const reset = () => {
    setName("");
    setDescription("");
    setTags("");
    setError(null);
  };

  return (
    <Modal
      open={open}
      onClose={create.isPending ? () => undefined : onClose}
      closeOnBackdrop={!create.isPending}
      title="New workflow"
      description="Start with a manual trigger. You can add a schedule trigger and actions in the editor."
      size="md"
      footer={
        <>
          <Button
            variant="ghost"
            disabled={create.isPending}
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            loading={create.isPending}
            disabled={!name.trim()}
            onClick={() => create.mutate()}
          >
            Create & open editor
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Daily account health check"
            maxLength={100}
            autoFocus
          />
        </Field>
        <Field label="Description" optional>
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What this workflow does and when to use it."
          />
        </Field>
        <Field label="Tags" optional hint="Comma separated, up to 20 tags.">
          <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="monitoring, accounts" />
        </Field>
        {error ? (
          <p className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs leading-5 text-danger">{error}</p>
        ) : null}
      </div>
    </Modal>
  );
}

export function WorkflowsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [stateFilter, setStateFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [runTarget, setRunTarget] = useState<RunnableWorkflow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowSummary | null>(null);

  const workflows = useQuery({ queryKey: ["workflows"], queryFn: api.listWorkflows });

  const toggle = useMutation({
    mutationFn: ({ workflow, enabled }: { workflow: WorkflowSummary; enabled: boolean }) =>
      api.setWorkflowEnabled(workflow.id, enabled),
    onSuccess: (_result, variables) => {
      toast.success(variables.enabled ? "Workflow enabled" : "Workflow paused", variables.workflow.name);
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (cause) => toast.error("Unable to update workflow", toApiError(cause).message),
  });

  const duplicate = useMutation({
    mutationFn: (workflow: WorkflowSummary) => api.duplicateWorkflow(workflow.id),
    onSuccess: (copy) => {
      toast.success("Workflow duplicated", copy.name);
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      navigate(`/workflows/${copy.id}`);
    },
    onError: (cause) => toast.error("Unable to duplicate workflow", toApiError(cause).message),
  });

  const remove = useMutation({
    mutationFn: (workflow: WorkflowSummary) => api.deleteWorkflow(workflow.id, workflow.name),
    onSuccess: (_result, workflow) => {
      toast.success("Workflow deleted", workflow.name);
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
    onError: (cause) => toast.error("Unable to delete workflow", toApiError(cause).message),
  });

  const list = (workflows.data ?? []).filter((workflow) => {
    if (stateFilter === "enabled" && !workflow.enabled) return false;
    if (stateFilter === "paused" && workflow.enabled) return false;
    if (stateFilter === "scheduled" && !workflow.schedule) return false;
    const text = deferredQuery.trim().toLowerCase();
    if (!text) return true;
    return (
      workflow.name.toLowerCase().includes(text) ||
      workflow.description.toLowerCase().includes(text) ||
      workflow.tags.some((tag) => tag.toLowerCase().includes(text))
    );
  });

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Automation"
        title="Workflows"
        description="Visual definitions executed by the local engine. Every node, edge, schedule, and version is persisted in SQLite."
        actions={
          <>
            <Button variant="secondary" icon={<Sparkles size={14} />} onClick={() => setAiOpen(true)}>
              AI draft
            </Button>
            <Button variant="secondary" icon={<CalendarClock size={14} />} onClick={() => navigate("/settings")}>
              Schedules
            </Button>
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>
              New workflow
            </Button>
          </>
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workflows, descriptions, tags…"
            className="h-9 pl-8"
            aria-label="Search workflows"
          />
        </div>
        <Select
          value={stateFilter}
          onChange={(event) => setStateFilter(event.target.value)}
          className="h-9 w-[160px]"
          aria-label="Filter workflows"
        >
          <option value="">All workflows</option>
          <option value="enabled">Enabled</option>
          <option value="paused">Paused</option>
          <option value="scheduled">Scheduled</option>
        </Select>
        <span className="numeric text-[10px] text-faint">
          {list.length} of {workflows.data?.length ?? 0}
        </span>
      </div>

      <Card className="mt-4 overflow-hidden">
        {workflows.isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-[60px] animate-pulse rounded-lg bg-raised/40" />
            ))}
          </div>
        ) : workflows.isError ? (
          <div className="p-5 text-xs text-danger">{workflows.error.message}</div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<WorkflowIcon size={20} />}
            title={workflows.data?.length ? "No matching workflows" : "No workflows yet"}
            description={
              workflows.data?.length
                ? "Adjust the search or filter to see other definitions."
                : "Create a workflow, connect a trigger to actions, validate it, and run it from here or on a schedule."
            }
            action={
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
                New workflow
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line/75 bg-surface/45 text-[10px] uppercase tracking-[0.08em] text-faint">
                  <th className="px-5 py-2.5 font-medium">Workflow</th>
                  <th className="px-3 py-2.5 font-medium">Trigger</th>
                  <th className="px-3 py-2.5 font-medium">Nodes</th>
                  <th className="px-3 py-2.5 font-medium">Last run</th>
                  <th className="px-3 py-2.5 font-medium">Enabled</th>
                  <th className="w-28 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {list.map((workflow) => (
                  <tr key={workflow.id} className="group border-b border-line/45 last:border-0 hover:bg-raised/25">
                    <td className="max-w-[380px] px-5 py-3">
                      <button
                        type="button"
                        onClick={() => navigate(`/workflows/${workflow.id}`)}
                        className="block max-w-full truncate text-left text-[13px] font-medium text-fg hover:text-accent"
                      >
                        {workflow.name}
                      </button>
                      <p className="mt-0.5 line-clamp-1 text-[10.5px] leading-4 text-faint">
                        {workflow.description || "No description."}
                      </p>
                      {workflow.tags.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {workflow.tags.slice(0, 4).map((tag) => (
                            <span
                              key={tag}
                              className="rounded border border-line/70 bg-surface px-1.5 py-0.5 text-[9px] text-faint"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      {workflow.schedule ? (
                        <div>
                          <Badge tone="info" dot>
                            Scheduled
                          </Badge>
                          <p className="mt-1 font-mono text-[9.5px] text-faint">{workflow.schedule.cron}</p>
                          <p className="text-[9.5px] text-faint">{workflow.schedule.timezone}</p>
                        </div>
                      ) : (
                        <Badge tone="neutral">Manual</Badge>
                      )}
                    </td>
                    <td className="numeric px-3 py-3 text-xs text-muted">{workflow.nodeCount}</td>
                    <td className="px-3 py-3">
                      <span className="block text-[11px] text-muted">
                        {workflow.lastRunAt ? relativeTime(workflow.lastRunAt) : "Never"}
                      </span>
                      <span className="block text-[9.5px] text-faint">
                        {workflow.lastRunAt ? formatDateTime(workflow.lastRunAt) : "No run history"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={workflow.enabled}
                          aria-label={`${workflow.enabled ? "Pause" : "Enable"} ${workflow.name}`}
                          disabled={toggle.isPending && toggle.variables?.workflow.id === workflow.id}
                          onClick={() => toggle.mutate({ workflow, enabled: !workflow.enabled })}
                          className={`relative h-5 w-9 rounded-full border transition-colors ${
                            workflow.enabled ? "border-accent/50 bg-accent/85" : "border-line bg-raised"
                          } disabled:opacity-50`}
                        >
                          <span
                            className={`absolute top-0.5 h-3.5 w-3.5 rounded-full shadow-sm transition-transform ${
                              workflow.enabled ? "translate-x-[18px] bg-[#04140c]" : "translate-x-0.5 bg-muted"
                            }`}
                          />
                        </button>
                        <span className="text-[10px] text-faint">{workflow.enabled ? "On" : "Paused"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Play size={12} />}
                          onClick={() => setRunTarget(runnableFromSummary(workflow))}
                        >
                          Run
                        </Button>
                        <Dropdown
                          trigger={({ toggle: openMenu }) => (
                            <IconButton label={`More actions for ${workflow.name}`} size="sm" onClick={openMenu}>
                              <MoreHorizontal size={15} />
                            </IconButton>
                          )}
                          width="w-48"
                        >
                          <DropdownItem icon={<Pencil size={13} />} onClick={() => navigate(`/workflows/${workflow.id}`)}>
                            Open editor
                          </DropdownItem>
                          <DropdownItem icon={<Copy size={13} />} onClick={() => duplicate.mutate(workflow)}>
                            Duplicate
                          </DropdownItem>
                          <DropdownItem
                            icon={workflow.enabled ? <Pause size={13} /> : <Zap size={13} />}
                            onClick={() => toggle.mutate({ workflow, enabled: !workflow.enabled })}
                          >
                            {workflow.enabled ? "Pause workflow" : "Enable workflow"}
                          </DropdownItem>
                          <DropdownItem danger icon={<Trash2 size={13} />} onClick={() => setDeleteTarget(workflow)}>
                            Delete workflow
                          </DropdownItem>
                        </Dropdown>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Card>
          <div className="p-4">
            <p className="text-[10px] uppercase tracking-[0.1em] text-faint">Enabled</p>
            <p className="numeric mt-1.5 text-xl font-semibold text-fg">
              {(workflows.data ?? []).filter((workflow) => workflow.enabled).length}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-[10px] uppercase tracking-[0.1em] text-faint">Scheduled</p>
            <p className="numeric mt-1.5 text-xl font-semibold text-fg">
              {(workflows.data ?? []).filter((workflow) => Boolean(workflow.schedule)).length}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-[10px] uppercase tracking-[0.1em] text-faint">Total nodes</p>
            <p className="numeric mt-1.5 text-xl font-semibold text-fg">
              {(workflows.data ?? []).reduce((sum, workflow) => sum + workflow.nodeCount, 0)}
            </p>
            <Button size="sm" variant="ghost" className="mt-1 px-0" onClick={() => navigate("/runs")}>
              View run history
            </Button>
          </div>
        </Card>
      </div>

      <AiDraftModal open={aiOpen} onClose={() => setAiOpen(false)} />
      <CreateWorkflowModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          navigate(`/workflows/${id}`);
        }}
      />
      <RunWorkflowDialog workflow={runTarget} open={runTarget != null} onClose={() => setRunTarget(null)} />
      <ConfirmDialog
        open={deleteTarget != null}
        title="Delete workflow"
        description={
          <>
            This permanently deletes <strong className="text-fg">{deleteTarget?.name}</strong>, its definition,
            schedule, and schedule metadata. Existing run history remains available for audit. This cannot be
            undone.
          </>
        }
        confirmationLabel={deleteTarget?.name ?? ""}
        confirmLabel="Delete workflow"
        busy={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget);
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </PageContainer>
  );
}
