import type {
  NodeType,
  ScheduleInput,
  Workflow,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowInput,
  WorkflowNode,
} from "./types";

export type NodeCategory = "trigger" | "action" | "logic" | "control";

export interface NodeCatalogItem {
  type: NodeType;
  label: string;
  short: string;
  description: string;
  category: NodeCategory;
}

export const NODE_CATALOG: NodeCatalogItem[] = [
  {
    type: "trigger.manual",
    label: "Manual trigger",
    short: "Manual",
    description: "Start only when a person runs this workflow.",
    category: "trigger",
  },
  {
    type: "trigger.schedule",
    label: "Schedule trigger",
    short: "Schedule",
    description: "Start on a cron schedule in a chosen timezone.",
    category: "trigger",
  },
  {
    type: "action.http",
    label: "HTTP request",
    short: "HTTP",
    description: "Call an API with templated headers, body, and timeout.",
    category: "action",
  },
  {
    type: "action.account_check",
    label: "Account check",
    short: "Account",
    description: "Read a provider account's local status.",
    category: "action",
  },
  {
    type: "action.delay",
    label: "Delay",
    short: "Delay",
    description: "Pause for a bounded number of seconds.",
    category: "action",
  },
  {
    type: "action.log",
    label: "Write log",
    short: "Log",
    description: "Add a redacted entry to the run log.",
    category: "action",
  },
  {
    type: "transform.template",
    label: "Template",
    short: "Template",
    description: "Compose text or JSON from inputs, steps, and secrets.",
    category: "logic",
  },
  {
    type: "logic.condition",
    label: "Condition",
    short: "Condition",
    description: "Branch true or false using a typed comparison.",
    category: "logic",
  },
  {
    type: "error.retry",
    label: "Retry policy",
    short: "Retry",
    description: "Set bounded retries for subsequent HTTP/account steps.",
    category: "control",
  },
];

export const NODE_MAP = new Map(NODE_CATALOG.map((item) => [item.type, item]));

export function nodeLabel(type: string): string {
  return NODE_MAP.get(type as NodeType)?.label ?? type;
}

export function nodeShort(type: string): string {
  return NODE_MAP.get(type as NodeType)?.short ?? type;
}

export function nodeCategory(type: string): NodeCategory {
  return NODE_MAP.get(type as NodeType)?.category ?? "action";
}

export function defaultConfig(type: NodeType): Record<string, unknown> {
  switch (type) {
    case "trigger.manual":
      return {};
    case "trigger.schedule":
      return {
        cron: "0 9 * * * *",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        enabled: true,
      };
    case "action.http":
      return { method: "GET", url: "https://", headers: {}, timeoutMs: 30000, allowLocal: false };
    case "action.account_check":
      return { accountId: "", failIfInactive: false };
    case "action.delay":
      return { seconds: 5 };
    case "action.log":
      return { message: "Workflow reached {{input.name}}", level: "info" };
    case "transform.template":
      return { template: "{{input}}", format: "text" };
    case "logic.condition":
      return { left: "{{input.value}}", operator: "equals", right: "ready" };
    case "error.retry":
      return { attempts: 2, delayMs: 1000 };
  }
}

export function defaultNodeName(type: NodeType): string {
  return NODE_MAP.get(type)?.label ?? "Node";
}

export function nodeSummary(node: WorkflowNode): string {
  const config = node.config ?? {};
  switch (node.type) {
    case "trigger.schedule": {
      const cron = typeof config.cron === "string" ? config.cron : "Not configured";
      const timezone = typeof config.timezone === "string" ? config.timezone : "UTC";
      return `${cron} · ${timezone}`;
    }
    case "action.http": {
      const method = typeof config.method === "string" ? config.method : "GET";
      const url = typeof config.url === "string" ? config.url : "No URL";
      return `${method} ${url}`;
    }
    case "action.account_check":
      return config.accountId ? "Check selected account" : "Choose an account";
    case "action.delay":
      return `Wait ${String(config.seconds ?? 5)} seconds`;
    case "action.log":
      return typeof config.message === "string" ? config.message : "Log message";
    case "transform.template":
      return config.format === "json" ? "Build JSON output" : "Build text output";
    case "logic.condition":
      return `${String(config.left ?? "")} ${String(config.operator ?? "equals")} ${String(config.right ?? "")}`;
    case "error.retry":
      return `${String(config.attempts ?? 0)} retries · ${String(config.delayMs ?? 0)} ms`;
    default:
      return "Manual start";
  }
}

export function createNode(type: NodeType, existingIds: Set<string>, position: { x: number; y: number }): WorkflowNode {
  const prefix = type.split(".").pop() ?? "node";
  let index = 1;
  let id = `${prefix}-${index}`;
  while (existingIds.has(id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return {
    id,
    type,
    name: defaultNodeName(type),
    config: defaultConfig(type),
    position,
  };
}

export function blankDefinition(): WorkflowDefinition {
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
    ],
    edges: [],
  };
}

export function blankWorkflowInput(): WorkflowInput {
  return {
    name: "",
    description: "",
    tags: [],
    enabled: true,
    definition: blankDefinition(),
    schedule: null,
  };
}

export function workflowToInput(workflow: Workflow): WorkflowInput {
  return {
    name: workflow.name,
    description: workflow.description,
    tags: [...workflow.tags],
    enabled: workflow.enabled,
    definition: structuredClone(workflow.definition),
    schedule: workflow.schedule
      ? { cron: workflow.schedule.cron, timezone: workflow.schedule.timezone, enabled: workflow.schedule.enabled }
      : null,
  };
}

/**
 * Imported definitions can omit branch labels or carry stale ones. React Flow
 * only resolves a condition's source handles when the handle id is `true` or
 * `false`, so normalize the branch against the source node before rendering.
 */
export function normalizeEdgeBranch(edge: WorkflowEdge, source: WorkflowNode | undefined): "true" | "false" | null {
  if (source?.type !== "logic.condition") return null;
  return edge.branch === "true" || edge.branch === "false" ? edge.branch : "true";
}

export function scheduleFromDefinition(definition: WorkflowDefinition): ScheduleInput | null {
  const trigger = definition.nodes.find((node) => node.type === "trigger.schedule");
  if (!trigger) return null;
  const config = trigger.config ?? {};
  return {
    cron: typeof config.cron === "string" ? config.cron : "",
    timezone: typeof config.timezone === "string" ? config.timezone : "UTC",
    enabled: config.enabled !== false,
  };
}

export function autoLayout(definition: WorkflowDefinition): Record<string, { x: number; y: number }> {
  const trigger = definition.nodes.find((node) => node.type.startsWith("trigger."));
  const depth = new Map<string, number>();
  if (trigger) {
    const queue: Array<{ id: string; level: number }> = [{ id: trigger.id, level: 0 }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      const known = depth.get(current.id);
      if (known != null && known <= current.level) continue;
      depth.set(current.id, current.level);
      for (const edge of definition.edges.filter((candidate) => candidate.from === current.id)) {
        queue.push({ id: edge.to, level: current.level + 1 });
      }
    }
  }
  let fallbackLevel = 0;
  for (const node of definition.nodes) {
    if (!depth.has(node.id)) {
      fallbackLevel += 1;
      depth.set(node.id, 4 + fallbackLevel);
    }
  }
  const perLevel = new Map<number, number>();
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of definition.nodes) {
    if (node.position) {
      positions[node.id] = node.position;
      continue;
    }
    const level = depth.get(node.id) ?? 0;
    const row = perLevel.get(level) ?? 0;
    perLevel.set(level, row + 1);
    positions[node.id] = { x: 60 + level * 300, y: 90 + row * 150 };
  }
  return positions;
}

export const CRON_PRESETS = [
  { label: "Every 5 minutes", value: "0 */5 * * * *" },
  { label: "Every hour", value: "0 0 * * * *" },
  { label: "Daily at 09:00", value: "0 9 * * * *" },
  { label: "Weekdays at 09:00", value: "0 9 * * Mon-Fri" },
  { label: "Mondays at 09:00", value: "0 9 * * Mon" },
  { label: "First day of month", value: "0 9 1 * * *" },
];

export function timezoneOptions(current: string): string[] {
  let values: string[] = [];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (supported) values = supported("timeZone");
  } catch {
    values = [];
  }
  if (values.length === 0) {
    values = [
      "UTC",
      "Europe/London",
      "Europe/Berlin",
      "Europe/Warsaw",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "Asia/Singapore",
      "Asia/Tokyo",
      "Australia/Sydney",
    ];
  }
  if (current && !values.includes(current)) values = [current, ...values];
  return values;
}

export function definitionStats(definition: WorkflowDefinition) {
  return {
    nodes: definition.nodes.length,
    edges: definition.edges.length,
    conditions: definition.nodes.filter((node) => node.type === "logic.condition").length,
  };
}
