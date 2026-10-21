import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Braces,
  Download,
  Loader2,
  PackageOpen,
  PencilRuler,
  Plus,
  Puzzle,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { PageContainer } from "../components/Layout";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Modal,
  PageHeader,
  SectionLabel,
  Toggle,
  cn,
} from "../components/ui";
import { api, toApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { navigate } from "../lib/router";
import type { PluginManifest, PluginPreset, PluginSummary, WorkflowDefinition, WorkflowInput } from "../lib/types";

function presetDefinition(preset: PluginPreset): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "trigger-1",
        type: "trigger.manual",
        name: "Manual start",
        config: {},
        position: { x: 80, y: 160 },
      },
      {
        id: "http-1",
        type: "action.http",
        name: preset.name,
        config: {
          method: preset.method,
          url: preset.url,
          headers: preset.headers,
          ...(preset.body == null ? {} : { body: preset.body }),
          timeoutMs: preset.timeoutMs ?? 30_000,
        },
        position: { x: 380, y: 160 },
      },
    ],
    edges: [{ id: "edge-1", from: "trigger-1", to: "http-1" }],
  };
}

function PresetModal({
  manifest,
  loading,
  error,
  plugin,
  onClose,
}: {
  manifest: PluginManifest | undefined;
  loading: boolean;
  error: string | null;
  plugin: PluginSummary | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (preset: PluginPreset) => {
      if (!manifest) throw new Error("Plugin manifest is not loaded");
      const input: WorkflowInput = {
        name: `${preset.name} (${manifest.name})`.slice(0, 100),
        description: preset.description || manifest.description,
        tags: ["plugin", manifest.id].slice(0, 20),
        enabled: false,
        definition: presetDefinition(preset),
        schedule: null,
      };
      return api.createWorkflow(input);
    },
    onSuccess: (workflow) => {
      toast.success("Workflow created", "Review the request and add secrets before running it.");
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      onClose();
      navigate(`/workflows/${workflow.id}`);
    },
    onError: (cause) => toast.error("Unable to create workflow", toApiError(cause).message),
  });

  if (!plugin) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={plugin.name}
      description={plugin.description || "Declarative HTTP request presets."}
      size="xl"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="info">{plugin.id}</Badge>
          <Badge tone="neutral">v{plugin.version}</Badge>
          {plugin.author ? <Badge tone="neutral">{plugin.author}</Badge> : null}
        </div>
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-xs text-muted">
            <Loader2 size={13} className="animate-spin" /> Loading manifest…
          </div>
        ) : error ? (
          <p className="rounded-lg border border-danger/25 bg-danger/5 p-3 text-xs leading-5 text-danger">{error}</p>
        ) : manifest ? (
          <div className="space-y-3">
            {manifest.presets.map((preset) => (
              <div key={preset.id} className="rounded-xl border border-line/80 bg-surface/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[12.5px] font-medium text-fg">{preset.name}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-faint">{preset.id}</p>
                  </div>
                  <Badge tone={preset.method === "GET" ? "info" : "warning"}>{preset.method}</Badge>
                </div>
                {preset.description ? (
                  <p className="mt-2 text-[10.5px] leading-4 text-muted">{preset.description}</p>
                ) : null}
                <p className="mt-2 break-all rounded-md border border-line/60 bg-bg/40 px-2.5 py-2 font-mono text-[10px] leading-4 text-muted">
                  {preset.url}
                </p>
                <div className="mt-2 grid gap-2 text-[10px] text-faint sm:grid-cols-2">
                  <span>{Object.keys(preset.headers).length} headers</span>
                  <span>{preset.body == null ? "No body" : "JSON body"}</span>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<PencilRuler size={12} />}
                    loading={create.isPending && create.variables?.id === preset.id}
                    onClick={() => create.mutate(preset)}
                  >
                    Create editable workflow
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <p className="border-t border-line/60 pt-3 text-[10px] leading-4 text-faint">
          Presets become ordinary HTTP nodes. They are created paused and never receive secret values automatically.
        </p>
      </div>
    </Modal>
  );
}

export function PluginsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<PluginSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PluginSummary | null>(null);
  const [installing, setInstalling] = useState(false);

  const plugins = useQuery({ queryKey: ["plugins"], queryFn: api.listPlugins });
  const manifest = useQuery({
    queryKey: ["plugin-manifest", selected?.id],
    queryFn: () => api.getPluginManifest(selected?.id as string),
    enabled: Boolean(selected),
  });

  const toggle = useMutation({
    mutationFn: ({ plugin, enabled }: { plugin: PluginSummary; enabled: boolean }) =>
      api.setPluginEnabled(plugin.id, enabled),
    onSuccess: (plugin) => {
      toast.success(plugin.enabled ? "Plugin enabled" : "Plugin disabled", plugin.name);
      void queryClient.invalidateQueries({ queryKey: ["plugins"] });
    },
    onError: (cause) => toast.error("Unable to update plugin", toApiError(cause).message),
  });

  const remove = useMutation({
    mutationFn: (plugin: PluginSummary) => api.deletePlugin(plugin.id, plugin.id),
    onSuccess: (_result, plugin) => {
      toast.success("Plugin removed", plugin.name);
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["plugins"] });
    },
    onError: (cause) => toast.error("Unable to remove plugin", toApiError(cause).message),
  });

  const install = async () => {
    try {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "BITS AI Video Creator plugin", extensions: ["json"] }],
      });
      if (typeof path !== "string") return;
      setInstalling(true);
      const plugin = await api.installPlugin(path);
      toast.success("Plugin installed", `${plugin.name} · ${plugin.presetCount} presets`);
      void queryClient.invalidateQueries({ queryKey: ["plugins"] });
    } catch (cause) {
      toast.error("Unable to install plugin", toApiError(cause).message);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Extensions"
        title="Plugins"
        description="Declarative HTTP request packs. Plugins cannot execute code, read files, or receive secrets; presets compile into audited HTTP nodes."
        actions={
          <Button variant="primary" icon={<Download size={14} />} loading={installing} onClick={() => void install()}>
            Install JSON pack
          </Button>
        }
      />

      <div className="mt-5 rounded-xl border border-info/25 bg-info/[0.04] p-3.5">
        <p className="flex items-center gap-2 text-[11px] font-medium text-info">
          <Braces size={13} /> Declarative-only plugin model
        </p>
        <p className="mt-1 text-[10.5px] leading-4 text-muted">
          A plugin is a <span className="font-mono text-fg">schemaVersion: 1</span> JSON manifest with up to 50
          HTTPS request presets. Arbitrary code, local files, and implicit secrets are intentionally unsupported.
        </p>
      </div>

      {plugins.isLoading ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-40 animate-pulse rounded-xl border border-line/60 bg-raised/30" />
          ))}
        </div>
      ) : plugins.isError ? (
        <Card className="mt-4 border-danger/30 p-4 text-xs text-danger">{plugins.error.message}</Card>
      ) : plugins.data?.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Puzzle size={20} />}
            title="No plugins installed"
            description="Install a local JSON pack to add reusable API presets. The manifest is validated before anything is stored."
            action={
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => void install()}>
                Install JSON pack
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {plugins.data?.map((plugin) => (
            <Card key={plugin.id} className={cn("flex flex-col", !plugin.enabled && "opacity-75")}>
              <div className="flex items-start justify-between gap-3 border-b border-line/60 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <PackageOpen size={15} className={plugin.enabled ? "text-accent" : "text-faint"} />
                    <h2 className="truncate text-[13px] font-semibold text-fg">{plugin.name}</h2>
                  </div>
                  <p className="mt-1 font-mono text-[9.5px] text-faint">
                    {plugin.id} · v{plugin.version}
                  </p>
                </div>
                <Badge tone={plugin.enabled ? "success" : "neutral"}>{plugin.enabled ? "enabled" : "disabled"}</Badge>
              </div>
              <div className="flex-1 space-y-2 p-4">
                <p className="line-clamp-3 text-[10.5px] leading-4 text-muted">
                  {plugin.description || "No description."}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="neutral">{plugin.presetCount} presets</Badge>
                  {plugin.author ? <Badge tone="neutral">{plugin.author}</Badge> : null}
                </div>
                <p className="text-[9.5px] text-faint">Installed {formatDateTime(plugin.installedAt)}</p>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-line/60 px-3 py-2">
                <Toggle
                  checked={plugin.enabled}
                  onChange={(enabled) => toggle.mutate({ plugin, enabled })}
                  label={`Enable ${plugin.name}`}
                />
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setSelected(plugin)}>
                    Presets
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => setDeleteTarget(plugin)}
                    aria-label={`Remove ${plugin.name}`}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-5">
        <CardHeader title="Manifest format" description="Share or review packs as plain JSON." />
        <div className="p-4">
          <SectionLabel>Example</SectionLabel>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-line/70 bg-bg/50 p-3 font-mono text-[10px] leading-5 text-muted">{`{
  "schemaVersion": 1,
  "id": "com.example.webhooks",
  "name": "Example webhooks",
  "version": "1.0.0",
  "description": "Useful webhook presets",
  "author": "Example",
  "presets": [{
    "id": "post-event",
    "name": "Post event",
    "method": "POST",
    "url": "https://api.example.com/events/{{input.id}}",
    "headers": { "content-type": "application/json" },
    "body": { "id": "{{input.id}}" },
    "timeoutMs": 30000
  }]
}`}</pre>
        </div>
      </Card>

      <PresetModal
        manifest={manifest.data}
        loading={manifest.isLoading}
        error={manifest.isError ? manifest.error.message : null}
        plugin={selected}
        onClose={() => {
          setSelected(null);
        }}
      />

      <ConfirmDialog
        open={deleteTarget != null}
        title="Remove plugin"
        description={
          <>
            Remove <strong className="text-fg">{deleteTarget?.name}</strong> and its {deleteTarget?.presetCount ?? 0}{" "}
            presets. Workflows already created from presets are not changed. This cannot be undone.
          </>
        }
        confirmationLabel={deleteTarget?.id ?? ""}
        confirmLabel="Remove plugin"
        busy={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget);
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </PageContainer>
  );
}
