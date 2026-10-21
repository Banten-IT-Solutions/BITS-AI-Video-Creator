import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertTriangle,
  ArrowLeft,
  Braces,
  CalendarClock,
  CheckCircle2,
  GitBranch,
  Globe2,
  LayoutGrid,
  MousePointerClick,
  Play,
  Plus,
  RotateCcw,
  Save,
  ScrollText,
  SlidersHorizontal,
  ShieldAlert,
  Timer,
  Trash2,
  UserCheck,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { RunWorkflowDialog, runnableFromWorkflow, type RunnableWorkflow } from "../components/RunWorkflowDialog";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Field,
  Input,
  SectionLabel,
  Select,
  Spinner,
  Textarea,
  Toggle,
  cn,
} from "../components/ui";
import { api, toApiError } from "../lib/api";
import { parseJsonObject, relativeTime } from "../lib/format";
import { navigate, setBeforeNavigate } from "../lib/router";
import type {
  Account,
  NodeType,
  ValidationIssue,
  ValidationReport,
  Workflow,
  WorkflowDefinition,
  WorkflowEdge as WorkflowEdgeModel,
  WorkflowInput,
  WorkflowNode,
} from "../lib/types";
import {
  CRON_PRESETS,
  NODE_CATALOG,
  autoLayout,
  createNode as makeNode,
  defaultNodeName,
  nodeCategory,
  nodeLabel,
  nodeShort,
  nodeSummary,
  normalizeEdgeBranch,
  scheduleFromDefinition,
  timezoneOptions,
  type NodeCategory,
} from "../lib/workflow";

interface EditorNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  hasError: boolean;
  hasWarning: boolean;
}

type EditorNode = Node<EditorNodeData, "bitsStudio">;

interface EditorEdgeData extends Record<string, unknown> {
  branch?: "true" | "false" | null;
}

type EditorEdge = Edge<EditorEdgeData>;

const CATEGORY_STYLES: Record<NodeCategory, { border: string; icon: string; text: string; dot: string }> = {
  trigger: {
    border: "border-accent/35",
    icon: "bg-accent/10 text-accent",
    text: "text-accent",
    dot: "bg-accent",
  },
  action: {
    border: "border-info/30",
    icon: "bg-info/10 text-info",
    text: "text-info",
    dot: "bg-info",
  },
  logic: {
    border: "border-warn/30",
    icon: "bg-warn/10 text-warn",
    text: "text-warn",
    dot: "bg-warn",
  },
  control: {
    border: "border-line",
    icon: "bg-raised text-muted",
    text: "text-muted",
    dot: "bg-muted",
  },
};

function nodeIcon(type: string, size = 14): ReactNode {
  switch (type) {
    case "trigger.manual":
      return <MousePointerClick size={size} />;
    case "trigger.schedule":
      return <CalendarClock size={size} />;
    case "action.http":
      return <Globe2 size={size} />;
    case "action.account_check":
      return <UserCheck size={size} />;
    case "action.delay":
      return <Timer size={size} />;
    case "action.log":
      return <ScrollText size={size} />;
    case "transform.template":
      return <Braces size={size} />;
    case "logic.condition":
      return <GitBranch size={size} />;
    case "error.retry":
      return <RotateCcw size={size} />;
    default:
      return <GitBranch size={size} />;
  }
}

function WorkflowNodeCard({ data, selected }: NodeProps<EditorNode>) {
  const node = data.node;
  const category = nodeCategory(node.type);
  const styles = CATEGORY_STYLES[category];
  const isCondition = node.type === "logic.condition";
  const isTrigger = node.type.startsWith("trigger.");

  return (
    <div
      className={`relative w-[228px] rounded-xl border bg-panel/95 shadow-[0_10px_30px_rgb(0_0_0/0.25)] backdrop-blur-sm transition-[border-color,box-shadow] ${
        selected ? "border-accent/70 shadow-glow" : data.hasError ? "border-danger/60" : styles.border
      }`}
    >
      {!isTrigger ? <Handle type="target" position={Position.Left} /> : null}

      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${styles.icon}`}>
          {nodeIcon(node.type, 14)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[11.5px] font-semibold text-fg">{node.name}</p>
            {data.hasError ? <AlertTriangle size={11} className="shrink-0 text-danger" /> : null}
          </div>
          <p className={`mt-0.5 text-[9px] font-medium uppercase tracking-[0.08em] ${styles.text}`}>
            {nodeShort(node.type)}
          </p>
        </div>
      </div>
      <p className="line-clamp-2 border-t border-line/50 px-3 py-2 text-[10px] leading-4 text-muted">
        {nodeSummary(node)}
      </p>
      {data.hasWarning && !data.hasError ? (
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-warn/40 bg-warn/15 text-warn">
          <AlertTriangle size={9} />
        </span>
      ) : null}

      {isCondition ? (
        <>
          <span className="pointer-events-none absolute right-2.5 top-[27%] text-[8px] font-semibold text-accent">
            T
          </span>
          <span className="pointer-events-none absolute bottom-[27%] right-2.5 text-[8px] font-semibold text-danger">
            F
          </span>
          <Handle id="true" type="source" position={Position.Right} style={{ top: "36%" }} />
          <Handle id="false" type="source" position={Position.Right} style={{ top: "64%" }} />
        </>
      ) : (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}

const nodeTypes = { bitsStudio: WorkflowNodeCard };

function definitionToNodes(definition: WorkflowDefinition): EditorNode[] {
  const positions = autoLayout(definition);
  return definition.nodes.map((node) => {
    const position = positions[node.id] ?? { x: 0, y: 0 };
    return {
      id: node.id,
      type: "bitsStudio",
      position,
      data: {
        node: { ...node, position },
        hasError: false,
        hasWarning: false,
      },
    };
  });
}

function definitionToEdges(definition: WorkflowDefinition): EditorEdge[] {
  const sources = new Map(definition.nodes.map((node) => [node.id, node]));
  return definition.edges.map((edge) => {
    const branch = normalizeEdgeBranch(edge, sources.get(edge.from));
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      sourceHandle: branch ?? undefined,
      type: "smoothstep",
      label: branch ? branch.toUpperCase() : undefined,
      labelStyle: {
        fill: branch === "false" ? "#fa807b" : "#56e5a3",
        fontSize: 9,
        fontWeight: 600,
      },
      labelBgStyle: { fill: "#10161b" },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 3,
      data: { branch },
      markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: "#64746d" },
    };
  });
}

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

function nodeIdFromPath(path: string, nodes: EditorNode[]): string | null {
  const indexed = /^nodes\[(\d+)\]/.exec(path);
  if (indexed) return nodes[Number(indexed[1])]?.id ?? null;
  const named = /^nodes\.([^.]+)/.exec(path);
  if (named) return nodes.find((node) => node.id === named[1])?.id ?? null;
  return null;
}

function NodeSettings({
  node,
  accounts,
  onChange,
  onDelete,
}: {
  node: WorkflowNode;
  accounts: Account[];
  onChange: (node: WorkflowNode) => void;
  onDelete: () => void;
}) {
  const config = node.config;
  const [headersText, setHeadersText] = useState(() => {
    const headers = config.headers;
    return headers && typeof headers === "object" ? JSON.stringify(headers, null, 2) : "{}";
  });
  const [headersError, setHeadersError] = useState<string | null>(null);
  const initialBody = config.body;
  const [bodyMode, setBodyMode] = useState<"none" | "text" | "json">(
    initialBody === undefined ? "none" : typeof initialBody === "string" ? "text" : "json",
  );
  const [bodyText, setBodyText] = useState(() => {
    if (initialBody === undefined) return "";
    return typeof initialBody === "string" ? initialBody : JSON.stringify(initialBody, null, 2);
  });
  const [bodyError, setBodyError] = useState<string | null>(null);

  const setConfig = (key: string, value: unknown) => {
    onChange({ ...node, config: { ...config, [key]: value } });
  };
  const removeConfig = (key: string) => {
    const next = { ...config };
    delete next[key];
    onChange({ ...node, config: next });
  };

  const updateHeaders = (text: string) => {
    setHeadersText(text);
    const parsed = parseJsonObject(text);
    if (!parsed.ok) {
      setHeadersError(parsed.error);
      return;
    }
    if (parsed.value == null || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      setHeadersError("Headers must be a JSON object.");
      return;
    }
    setHeadersError(null);
    setConfig("headers", parsed.value);
  };

  const updateBody = (mode: "none" | "text" | "json", text: string) => {
    setBodyMode(mode);
    setBodyText(text);
    if (mode === "none") {
      setBodyError(null);
      removeConfig("body");
      return;
    }
    if (mode === "text") {
      setBodyError(null);
      setConfig("body", text);
      return;
    }
    const parsed = parseJsonObject(text);
    if (!parsed.ok) {
      setBodyError(parsed.error);
      return;
    }
    setBodyError(null);
    setConfig("body", parsed.value);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${CATEGORY_STYLES[nodeCategory(node.type)].icon}`}>
          {nodeIcon(node.type, 14)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-fg">{nodeLabel(node.type)}</p>
          <p className="font-mono text-[9.5px] text-faint">{node.id}</p>
        </div>
        <Badge tone="neutral">{nodeCategory(node.type)}</Badge>
      </div>

      <Field label="Node name">
        <Input value={node.name} onChange={(event) => onChange({ ...node, name: event.target.value })} maxLength={100} />
      </Field>

      {node.type === "trigger.manual" ? (
        <p className="rounded-lg border border-line/70 bg-surface/60 p-3 text-[11px] leading-5 text-muted">
          This workflow starts only when you run it manually. Replace this node with a schedule trigger to run
          automatically.
        </p>
      ) : null}

      {node.type === "trigger.schedule" ? (
        <>
          <Field label="Cron expression" hint="Six fields: second minute hour day-of-month month day-of-week.">
            <Input
              value={typeof config.cron === "string" ? config.cron : ""}
              onChange={(event) => setConfig("cron", event.target.value)}
              className="font-mono text-xs"
              placeholder="0 9 * * * *"
            />
          </Field>
          <Field label="Preset">
            <Select
              value=""
              onChange={(event) => {
                if (event.target.value) {
                  const preset = CRON_PRESETS.find((item) => item.value === event.target.value);
                  if (preset) setConfig("cron", preset.value);
                }
              }}
            >
              <option value="">Choose a preset…</option>
              {CRON_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Timezone">
            <Select
              value={typeof config.timezone === "string" ? config.timezone : "UTC"}
              onChange={(event) => setConfig("timezone", event.target.value)}
            >
              {timezoneOptions(typeof config.timezone === "string" ? config.timezone : "UTC").map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </Field>
          <Toggle
            checked={config.enabled !== false}
            onChange={(value) => setConfig("enabled", value)}
            label="Schedule enabled"
            description="Paused schedules keep their definition but are excluded from dispatch."
          />
        </>
      ) : null}

      {node.type === "action.http" ? (
        <>
          <div className="grid grid-cols-[100px_1fr] gap-2">
            <Field label="Method">
              <Select value={typeof config.method === "string" ? config.method : "GET"} onChange={(event) => setConfig("method", event.target.value)}>
                {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="URL" hint="Supports {{input.*}}, {{steps.*}}, and {{secrets.*}} templates.">
              <Input
                value={typeof config.url === "string" ? config.url : ""}
                onChange={(event) => setConfig("url", event.target.value)}
                placeholder="https://api.example.com/check"
                className="font-mono text-[11px]"
              />
            </Field>
          </div>
          <Field label="Headers" hint="JSON object. Values may contain templates.">
            <Textarea
              value={headersText}
              onChange={(event) => updateHeaders(event.target.value)}
              rows={4}
              spellCheck={false}
              className="font-mono text-[11px]"
            />
          </Field>
          {headersError ? <p className="text-[11px] text-danger">Headers: {headersError}</p> : null}
          <Field label="Body type">
            <Select value={bodyMode} onChange={(event) => updateBody(event.target.value as "none" | "text" | "json", bodyText)}>
              <option value="none">No body</option>
              <option value="text">Text template</option>
              <option value="json">JSON value</option>
            </Select>
          </Field>
          {bodyMode !== "none" ? (
            <Field label={bodyMode === "json" ? "JSON body" : "Body template"} hint={bodyMode === "json" ? "Object or array; string values support templates." : "Sent as-is after template rendering."}>
              <Textarea
                value={bodyText}
                onChange={(event) => updateBody(bodyMode, event.target.value)}
                rows={5}
                spellCheck={false}
                className="font-mono text-[11px]"
              />
            </Field>
          ) : null}
          {bodyError ? <p className="text-[11px] text-danger">Body: {bodyError}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Timeout (ms)">
              <Input
                type="number"
                min={100}
                max={120000}
                value={Number(config.timeoutMs ?? 30000)}
                onChange={(event) => setConfig("timeoutMs", Number(event.target.value))}
                className="numeric"
              />
            </Field>
            <div className="flex items-end pb-1">
              <Toggle
                checked={config.allowLocal === true}
                onChange={(value) => setConfig("allowLocal", value)}
                label="Allow local"
                description="Also requires the global setting."
              />
            </div>
          </div>
        </>
      ) : null}

      {node.type === "action.account_check" ? (
        <>
          <Field label="Account" hint="Only an id is stored. The engine reads current local status at execution time.">
            <Select
              value={typeof config.accountId === "string" ? config.accountId : ""}
              onChange={(event) => setConfig("accountId", event.target.value)}
            >
              <option value="">Choose an account…</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.status.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
          <Toggle
            checked={config.failIfInactive === true}
            onChange={(value) => setConfig("failIfInactive", value)}
            label="Fail when account is inactive"
            description="Stops the run if the account is missing or not marked active."
          />
        </>
      ) : null}

      {node.type === "action.delay" ? (
        <Field label="Duration (seconds)" hint="Between 1 second and 24 hours.">
          <Input
            type="number"
            min={1}
            max={86400}
            value={Number(config.seconds ?? 5)}
            onChange={(event) => setConfig("seconds", Number(event.target.value))}
            className="numeric"
          />
        </Field>
      ) : null}

      {node.type === "action.log" ? (
        <>
          <Field label="Message" hint="Rendered and redacted before it enters the run log.">
            <Textarea
              value={typeof config.message === "string" ? config.message : ""}
              onChange={(event) => setConfig("message", event.target.value)}
              rows={3}
              className="font-mono text-[11px]"
            />
          </Field>
          <Field label="Level">
            <Select value={typeof config.level === "string" ? config.level : "info"} onChange={(event) => setConfig("level", event.target.value)}>
              {["trace", "debug", "info", "warn", "error"].map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </Select>
          </Field>
        </>
      ) : null}

      {node.type === "transform.template" ? (
        <>
          <Field label="Template" hint="Use {{input.name}}, {{steps.node-id}}, or {{secrets.name}}.">
            <Textarea
              value={typeof config.template === "string" ? config.template : ""}
              onChange={(event) => setConfig("template", event.target.value)}
              rows={5}
              className="font-mono text-[11px]"
            />
          </Field>
          <Field label="Output format" hint="JSON parses the rendered template as JSON.">
            <Select value={typeof config.format === "string" ? config.format : "text"} onChange={(event) => setConfig("format", event.target.value)}>
              <option value="text">Text</option>
              <option value="json">JSON</option>
            </Select>
          </Field>
        </>
      ) : null}

      {node.type === "logic.condition" ? (
        <>
          <Field label="Left value" hint="Supports templates and step references.">
            <Input
              value={typeof config.left === "string" ? config.left : ""}
              onChange={(event) => setConfig("left", event.target.value)}
              className="font-mono text-[11px]"
            />
          </Field>
          <Field label="Operator">
            <Select value={typeof config.operator === "string" ? config.operator : "equals"} onChange={(event) => setConfig("operator", event.target.value)}>
              <option value="equals">Equals</option>
              <option value="not_equals">Does not equal</option>
              <option value="contains">Contains</option>
              <option value="not_contains">Does not contain</option>
              <option value="gt">Greater than</option>
              <option value="gte">Greater than or equal</option>
              <option value="lt">Less than</option>
              <option value="lte">Less than or equal</option>
              <option value="exists">Exists</option>
              <option value="empty">Is empty</option>
            </Select>
          </Field>
          {!["exists", "empty"].includes(typeof config.operator === "string" ? config.operator : "equals") ? (
            <Field label="Right value">
              <Input
                value={typeof config.right === "string" ? config.right : ""}
                onChange={(event) => setConfig("right", event.target.value)}
                className="font-mono text-[11px]"
              />
            </Field>
          ) : null}
          <p className="rounded-lg border border-line/70 bg-surface/60 p-3 text-[10.5px] leading-4 text-muted">
            Connect the <span className="text-accent">T</span> handle for the true branch and the{" "}
            <span className="text-danger">F</span> handle for false. Both branches are optional.
          </p>
        </>
      ) : null}

      {node.type === "error.retry" ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Retries" hint="0–5">
            <Input
              type="number"
              min={0}
              max={5}
              value={Number(config.attempts ?? 2)}
              onChange={(event) => setConfig("attempts", Number(event.target.value))}
              className="numeric"
            />
          </Field>
          <Field label="Delay (ms)" hint="0–60,000">
            <Input
              type="number"
              min={0}
              max={60000}
              value={Number(config.delayMs ?? 1000)}
              onChange={(event) => setConfig("delayMs", Number(event.target.value))}
              className="numeric"
            />
          </Field>
          <p className="col-span-2 text-[10.5px] leading-4 text-faint">
            Applies to HTTP and account-check steps that follow this node. The global retry count is used when no
            policy node is present.
          </p>
        </div>
      ) : null}

      <div className="border-t border-line/60 pt-3">
        <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={onDelete} className="w-full">
          Delete node
        </Button>
      </div>
    </div>
  );
}

function EditorInner({ workflow }: { workflow: Workflow }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<EditorEdge>([]);
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [tagsText, setTagsText] = useState(workflow.tags.join(", "));
  const [enabled, setEnabled] = useState(workflow.enabled);
  const [dirty, setDirty] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [validating, setValidating] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [runTarget, setRunTarget] = useState<RunnableWorkflow | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"none" | "nodes" | "inspect">("none");
  const canvasRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef<string | null>(null);

  const accounts = useQuery({ queryKey: ["accounts", "editor"], queryFn: () => api.listAccounts(), staleTime: 30_000 });

  useEffect(() => {
    if (initializedRef.current === workflow.id) return;
    initializedRef.current = workflow.id;
    setNodes(definitionToNodes(workflow.definition));
    setEdges(definitionToEdges(workflow.definition));
    setName(workflow.name);
    setDescription(workflow.description);
    setTagsText(workflow.tags.join(", "));
    setEnabled(workflow.enabled);
    setDirty(false);
    setReport(null);
    setSelectedNodeId(null);
    setInitialized(true);
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.25, duration: 280 });
    });
    return () => cancelAnimationFrame(frame);
  }, [workflow, setNodes, setEdges, fitView]);

  useEffect(() => {
    if (!initialized) return;
    if (!dirty) {
      setBeforeNavigate(null);
      return;
    }
    const guard = () => window.confirm("This workflow has unsaved changes. Discard them and leave the editor?");
    setBeforeNavigate(guard);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      setBeforeNavigate(null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, initialized]);

  useEffect(() => {
    setNodes((current) => {
      if (!report) return current;
      const errors = new Set<string>();
      const warnings = new Set<string>();
      for (const issue of report.issues) {
        const id = nodeIdFromPath(issue.path, current);
        if (!id) continue;
        if (issue.severity === "error") errors.add(id);
        else warnings.add(id);
      }
      return current.map((node) => {
        const hasError = errors.has(node.id);
        const hasWarning = warnings.has(node.id);
        if (node.data.hasError === hasError && node.data.hasWarning === hasWarning) return node;
        return { ...node, data: { ...node.data, hasError, hasWarning } };
      });
    });
  }, [report, setNodes]);

  const selectedEditorNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedNode = selectedEditorNode?.data.node ?? null;

  const updateNode = useCallback(
    (next: WorkflowNode) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === next.id ? { ...node, data: { ...node.data, node: next } } : node,
        ),
      );
      setDirty(true);
    },
    [setNodes],
  );

  const buildDefinition = useCallback((): WorkflowDefinition => {
    return {
      schemaVersion: 1,
      nodes: nodes.map((node) => ({
        ...node.data.node,
        position: {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        },
      })),
      edges: edges.map<WorkflowEdgeModel>((edge) => ({
        id: edge.id,
        from: edge.source,
        to: edge.target,
        branch: edge.data?.branch ?? null,
      })),
    };
  }, [nodes, edges]);

  const addNode = useCallback(
    (type: NodeType, position?: { x: number; y: number }) => {
      if (type.startsWith("trigger.") && nodes.some((node) => node.data.node.type.startsWith("trigger."))) {
        toast.error("Only one trigger", "Delete the existing trigger before adding another one.");
        return;
      }
      let point = position;
      if (!point) {
        const rect = canvasRef.current?.getBoundingClientRect();
        point = screenToFlowPosition({
          x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
          y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
        });
        point = { x: point.x - 114, y: point.y - 40 };
      }
      if (!point) return;
      const created = makeNode(type, new Set(nodes.map((node) => node.id)), point);
      setNodes((current) => [
        ...current,
        {
          id: created.id,
          type: "bitsStudio",
          position: point as { x: number; y: number },
          data: { node: { ...created, position: point }, hasError: false, hasWarning: false },
        },
      ]);
      setSelectedNodeId(created.id);
      setDirty(true);
    },
    [nodes, screenToFlowPosition, setNodes, toast],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) {
        toast.error("Invalid connection", "A node cannot connect to itself.");
        return;
      }
      const source = nodes.find((node) => node.id === connection.source);
      if (!source) return;
      const condition = source.data.node.type === "logic.condition";
      const branch: "true" | "false" | null = condition
        ? connection.sourceHandle === "false"
          ? "false"
          : "true"
        : null;
      if (!condition && edges.some((edge) => edge.source === connection.source)) {
        toast.error("Branch not allowed", "Only condition nodes can have multiple outgoing connections. Add a condition node to branch.");
        return;
      }
      if (condition && edges.some((edge) => edge.source === connection.source && edge.data?.branch === branch)) {
        toast.error("Branch already connected", `The ${branch} branch already has an outgoing connection.`);
        return;
      }
      const id = `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id,
            type: "smoothstep",
            label: branch ? branch.toUpperCase() : undefined,
            labelStyle: {
              fill: branch === "false" ? "#fa807b" : "#56e5a3",
              fontSize: 9,
              fontWeight: 600,
            },
            labelBgStyle: { fill: "#10161b" },
            labelBgPadding: [4, 2],
            labelBgBorderRadius: 3,
            data: { branch },
            markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: "#64746d" },
          },
          current,
        ),
      );
      setDirty(true);
    },
    [nodes, edges, setEdges, toast],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((current) => current.filter((node) => node.id !== id));
      setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
      setSelectedNodeId((current) => (current === id ? null : current));
      setDirty(true);
    },
    [setNodes, setEdges],
  );

  const revalidate = async (notify: boolean): Promise<ValidationReport | null> => {
    setValidating(true);
    try {
      const result = await api.validateWorkflowDefinition(buildDefinition());
      setReport(result);
      if (notify) {
        const errors = result.issues.filter((issue) => issue.severity === "error").length;
        const warnings = result.issues.length - errors;
        if (result.valid) {
          toast.success("Workflow is valid", warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"} to review.` : "Definition and schedule look good.");
        } else {
          toast.error("Validation failed", `${errors} error${errors === 1 ? "" : "s"} must be fixed before saving.`);
        }
      }
      return result;
    } catch (cause) {
      toast.error("Unable to validate workflow", toApiError(cause).message);
      return null;
    } finally {
      setValidating(false);
    }
  };

  const save = useMutation({
    mutationFn: (input: WorkflowInput) => api.updateWorkflow(workflow.id, input),
    onSuccess: (updated) => {
      setDirty(false);
      toast.success("Workflow saved", `Version ${updated.version} is now persisted.`);
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      void queryClient.invalidateQueries({ queryKey: ["workflow", workflow.id] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: (cause) => toast.error("Unable to save workflow", toApiError(cause).message),
  });

  const saveWorkflow = async () => {
    if (!name.trim()) {
      toast.error("Name required", "Give the workflow a name before saving.");
      return;
    }
    const definition = buildDefinition();
    const result = await revalidate(false);
    if (!result?.valid) {
      toast.error("Cannot save an invalid workflow", "Fix the errors listed in the validation panel.");
      return;
    }
    const input: WorkflowInput = {
      name: name.trim(),
      description: description.trim(),
      tags: tagsFrom(tagsText),
      enabled,
      definition,
      schedule: scheduleFromDefinition(definition),
    };
    save.mutate(input);
  };

  const relayout = () => {
    const definition = buildDefinition();
    const positions = autoLayout({ ...definition, nodes: definition.nodes.map((node) => ({ ...node, position: null })) });
    setNodes((current) => current.map((node) => ({ ...node, position: positions[node.id] ?? node.position })));
    setDirty(true);
    requestAnimationFrame(() => {
      void fitView({ padding: 0.22, duration: 280 });
    });
  };

  const onDragStart = (event: DragEvent<HTMLButtonElement>, type: NodeType) => {
    event.dataTransfer.setData("application/x-bits-ai-video-creator-node", type);
    event.dataTransfer.effectAllowed = "move";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("application/x-bits-ai-video-creator-node") as NodeType;
    if (!type) return;
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addNode(type, { x: point.x - 114, y: point.y - 36 });
  };

  const groups = useMemo(() => {
    const categories: Array<{ category: NodeCategory; label: string }> = [
      { category: "trigger", label: "Triggers" },
      { category: "action", label: "Actions" },
      { category: "logic", label: "Logic" },
      { category: "control", label: "Control" },
    ];
    return categories.map(({ category, label }) => ({
      category,
      label,
      items: NODE_CATALOG.filter((item) => item.category === category),
    }));
  }, []);

  const issues = report?.issues ?? [];
  const errorCount = issues.filter((issue) => issue.severity === "error").length;

  return (
    <div className="workflow-editor-shell flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line/75 bg-surface/40 px-3 py-2.5 md:px-4">
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={() => navigate("/workflows")}>
          Workflows
        </Button>
        <div className="h-4 w-px bg-line" />
        <div className="min-w-[180px] flex-1">
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
            }}
            maxLength={100}
            aria-label="Workflow name"
            className="w-full max-w-md rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[15px] font-semibold tracking-[-0.01em] text-fg transition-colors hover:border-line focus:border-accent/60 focus:bg-surface focus:outline-none"
          />
          <div className="mt-0.5 flex items-center gap-2 px-1.5 text-[10px] text-faint">
            <span className="font-mono">{workflow.id.slice(0, 8)}</span>
            <span>·</span>
            <span>v{workflow.version}</span>
            <span>·</span>
            <span>updated {relativeTime(workflow.updatedAt)}</span>
            {dirty ? <Badge tone="warning">Unsaved</Badge> : <Badge tone="success">Saved</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {report ? (
            <Badge tone={report.valid ? "success" : "danger"} className="hidden sm:inline-flex">
              {report.valid ? "Valid" : `${errorCount} errors`}
            </Badge>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => void revalidate(true)} loading={validating} icon={<CheckCircle2 size={13} />}>
            Validate
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Play size={13} />}
            disabled={dirty || save.isPending || validating}
            title={dirty ? "Save the workflow before running it." : "Queue a manual run"}
            onClick={() => setRunTarget(runnableFromWorkflow(workflow))}
          >
            Run
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Save size={13} />}
            loading={save.isPending}
            onClick={() => void saveWorkflow()}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="md:hidden"
            icon={<Plus size={13} />}
            onClick={() => setMobilePanel("nodes")}
          >
            Nodes
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="md:hidden"
            icon={<SlidersHorizontal size={13} />}
            onClick={() => setMobilePanel("inspect")}
          >
            Inspect
          </Button>
        </div>
      </div>

      {mobilePanel !== "none" ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/55 md:hidden"
          aria-label="Close editor panel"
          onClick={() => setMobilePanel("none")}
        />
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "shrink-0 overflow-y-auto bg-surface/30 p-3",
            mobilePanel === "nodes"
              ? "fixed inset-x-0 bottom-[calc(58px+env(safe-area-inset-bottom))] z-50 max-h-[72vh] w-full rounded-t-2xl border-t border-line/75 shadow-2xl"
              : "hidden md:block md:w-[204px] md:border-r md:border-line/75",
            "md:static md:inset-auto md:z-auto md:max-h-none md:w-[204px] md:rounded-none md:border-t-0 md:shadow-none md:border-r md:border-line/75",
          )}
        >
          <div className="flex items-center gap-2 px-1">
            <Plus size={12} className="text-faint" />
            <SectionLabel>Add node</SectionLabel>
            <button
              type="button"
              onClick={() => setMobilePanel("none")}
              className="ml-auto rounded-md p-1 text-faint hover:text-fg md:hidden"
              aria-label="Close node palette"
            >
              <X size={15} />
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[10px] leading-4 text-faint">Click to place in the center, or drag onto the canvas.</p>
          <div className="mt-3 space-y-4">
            {groups.map((group) => (
              <div key={group.category}>
                <p className="mb-1.5 px-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-faint">{group.label}</p>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <button
                      key={item.type}
                      type="button"
                      draggable
                      onDragStart={(event) => onDragStart(event, item.type)}
                      onClick={() => {
                        addNode(item.type);
                        setMobilePanel("none");
                      }}
                      className="group flex w-full items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-line/70 hover:bg-raised/50"
                      title={item.description}
                    >
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded ${CATEGORY_STYLES[item.category].icon}`}>
                        {nodeIcon(item.type, 11)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] font-medium text-fg">{item.label}</span>
                        <span className="mt-0.5 block line-clamp-2 text-[9px] leading-4 text-faint">{item.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div ref={canvasRef} className="relative min-w-0 flex-1" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={(changes) => {
              onEdgesChange(changes);
              if (changes.some((change) => change.type === "remove")) setDirty(true);
            }}
            onConnect={onConnect}
            onNodeDragStop={() => setDirty(true)}
            onNodesDelete={(deleted) => {
              const ids = new Set(deleted.map((node) => node.id));
              setEdges((current) => current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)));
              setSelectedNodeId(null);
              setDirty(true);
            }}
            onSelectionChange={({ nodes: selected }) => {
              setSelectedNodeId(selected[0]?.id ?? null);
              if (selected[0] && window.matchMedia("(max-width: 767px)").matches) {
                setMobilePanel("inspect");
              }
            }}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.25}
            maxZoom={1.8}
            snapToGrid
            snapGrid={[15, 15]}
            deleteKeyCode={["Backspace", "Delete"]}
            proOptions={{ hideAttribution: false }}
            defaultEdgeOptions={{
              type: "smoothstep",
              markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: "#64746d" },
            }}
            className="bg-surface"
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor="#23343c" maskColor="rgb(8 11 14 / 0.72)" />
          </ReactFlow>

          <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2">
            <Badge tone="neutral">{nodes.length} nodes</Badge>
            <Badge tone="neutral">{edges.length} edges</Badge>
            {dirty ? <Badge tone="warning" dot>Unsaved changes</Badge> : null}
          </div>
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
            <Button size="sm" variant="secondary" icon={<LayoutGrid size={13} />} onClick={relayout}>
              Auto layout
            </Button>
            <Button size="sm" variant="secondary" icon={<CheckCircle2 size={13} />} onClick={() => void revalidate(true)} loading={validating}>
              Check
            </Button>
          </div>
          {nodes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="max-w-xs rounded-xl border border-dashed border-line bg-panel/80 px-5 py-4 text-center">
                <p className="text-xs font-medium text-fg">Empty canvas</p>
                <p className="mt-1 text-[10.5px] leading-4 text-muted">
                  Add a trigger from the palette, then connect actions. Every workflow needs exactly one trigger.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <aside
          className={cn(
            "shrink-0 overflow-y-auto bg-surface/30",
            mobilePanel === "inspect"
              ? "fixed inset-x-0 bottom-[calc(58px+env(safe-area-inset-bottom))] z-50 max-h-[76vh] w-full rounded-t-2xl border-t border-line/75 shadow-2xl"
              : "hidden md:block md:w-[326px] md:border-l md:border-line/75",
            "md:static md:inset-auto md:z-auto md:max-h-none md:w-[326px] md:rounded-none md:border-t-0 md:shadow-none md:border-l md:border-line/75",
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line/70 px-4 py-3">
            <div>
              <SectionLabel>{selectedNode ? "Inspector" : "Workflow settings"}</SectionLabel>
              <p className="mt-1 text-[10px] leading-4 text-faint">
                {selectedNode ? `Editing ${nodeLabel(selectedNode.type)}` : "Select a node on the canvas or edit workflow metadata."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMobilePanel("none")}
              className="rounded-md p-1 text-faint hover:text-fg md:hidden"
              aria-label="Close inspector"
            >
              <X size={15} />
            </button>
          </div>

          <div className="space-y-5 p-4">
            {selectedNode ? (
              <NodeSettings
                key={selectedNode.id}
                node={selectedNode}
                accounts={accounts.data ?? []}
                onChange={updateNode}
                onDelete={() => deleteNode(selectedNode.id)}
              />
            ) : null}

            <div className={selectedNode ? "space-y-4 border-t border-line/60 pt-4" : "space-y-4"}>
              <SectionLabel>Workflow</SectionLabel>
              <Field label="Description" optional>
                <Textarea
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setDirty(true);
                  }}
                  rows={3}
                  maxLength={2000}
                />
              </Field>
              <Field label="Tags" optional hint="Comma separated, up to 20.">
                <Input
                  value={tagsText}
                  onChange={(event) => {
                    setTagsText(event.target.value);
                    setDirty(true);
                  }}
                  placeholder="monitoring, accounts"
                />
              </Field>
              <Toggle
                checked={enabled}
                onChange={(value) => {
                  setEnabled(value);
                  setDirty(true);
                }}
                label="Workflow enabled"
                description="Disabled workflows can still be edited and run manually."
              />
            </div>

            <div className="space-y-2 border-t border-line/60 pt-4">
              <div className="flex items-center justify-between">
                <SectionLabel>Validation</SectionLabel>
                {report ? (
                  <Badge tone={report.valid ? "success" : "danger"}>
                    {report.valid ? "valid" : `${errorCount} errors`}
                  </Badge>
                ) : (
                  <span className="text-[9px] text-faint">not run</span>
                )}
              </div>
              {!report ? (
                <p className="text-[10.5px] leading-4 text-faint">
                  Run validation to check node configuration, graph structure, and schedules before saving.
                </p>
              ) : issues.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/[0.04] p-2.5 text-[10.5px] text-accent">
                  <CheckCircle2 size={13} /> No issues found.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {issues.map((issue: ValidationIssue, index) => (
                    <li key={`${issue.path}-${index}`}>
                      <button
                        type="button"
                        onClick={() => {
                          const id = nodeIdFromPath(issue.path, nodes);
                          if (id) setSelectedNodeId(id);
                        }}
                        className="w-full rounded-lg border border-line/70 bg-panel/60 p-2 text-left transition-colors hover:border-faint/50"
                      >
                        <div className="flex items-start gap-1.5">
                          {issue.severity === "error" ? (
                            <AlertTriangle size={11} className="mt-0.5 shrink-0 text-danger" />
                          ) : (
                            <ShieldAlert size={11} className="mt-0.5 shrink-0 text-warn" />
                          )}
                          <div className="min-w-0">
                            <p className="break-words text-[10.5px] leading-4 text-muted">{issue.message}</p>
                            <p className="mt-0.5 break-all font-mono text-[9px] text-faint">{issue.path}</p>
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-line/60 pt-4 text-[10px] leading-4 text-faint">
              <p>Manual start default: {defaultNodeName("trigger.manual")}.</p>
              <p className="mt-1">
                Positions are saved with the workflow. Imported definitions without positions are auto-laid out.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <RunWorkflowDialog workflow={runTarget} open={runTarget != null} onClose={() => setRunTarget(null)} />
    </div>
  );
}

export function WorkflowEditorPage({ workflowId }: { workflowId: string }) {
  const workflow = useQuery({ queryKey: ["workflow", workflowId], queryFn: () => api.getWorkflow(workflowId) });

  if (workflow.isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2.5 text-xs text-muted">
        <Spinner size={15} /> Loading workflow…
      </div>
    );
  }

  if (workflow.isError || !workflow.data) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-xl border border-danger/30 bg-panel p-5">
          <div className="flex items-center gap-2.5 text-danger">
            <AlertTriangle size={17} />
            <h1 className="text-sm font-semibold">Workflow unavailable</h1>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">
            {workflow.isError ? workflow.error.message : "The workflow no longer exists in the local database."}
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={() => navigate("/workflows")}>
              Back to workflows
            </Button>
            <Button variant="ghost" onClick={() => void workflow.refetch()}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <EditorInner key={workflow.data.id} workflow={workflow.data} />
    </ReactFlowProvider>
  );
}
