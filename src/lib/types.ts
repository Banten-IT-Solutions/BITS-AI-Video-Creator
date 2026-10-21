export interface ProviderInfo {
  id: string;
  name: string;
  url: string;
  signInHint: string;
}

export type AccountStatus = "active" | "needs_login" | "disabled" | "error";

export interface Account {
  id: string;
  provider: string;
  name: string;
  email: string | null;
  externalId: string | null;
  status: AccountStatus;
  favorite: boolean;
  tags: string[];
  notes: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  lastCheckedAt: string | null;
}

export interface AccountInput {
  provider: string;
  name: string;
  email?: string | null;
  externalId?: string | null;
  status?: AccountStatus | null;
  favorite?: boolean | null;
  tags?: string[] | null;
  notes?: string | null;
  sortOrder?: number | null;
}

export interface AccountFilter {
  query?: string;
  provider?: string;
  status?: string;
  tag?: string;
  favorite?: boolean;
}

export type NodeType =
  | "trigger.manual"
  | "trigger.schedule"
  | "action.http"
  | "action.delay"
  | "action.log"
  | "action.account_check"
  | "logic.condition"
  | "transform.template"
  | "error.retry";

export interface NodePosition {
  x: number;
  y: number;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: Record<string, unknown>;
  position?: NodePosition | null;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  branch?: "true" | "false" | null;
}

export interface WorkflowDefinition {
  schemaVersion: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface ScheduleInput {
  cron: string;
  timezone: string;
  enabled: boolean;
}

export interface WorkflowInput {
  name: string;
  description: string;
  tags: string[];
  enabled: boolean;
  definition: WorkflowDefinition;
  schedule?: ScheduleInput | null;
}

export interface Schedule {
  id: string;
  workflowId: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  missedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  enabled: boolean;
  nodeCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  schedule: Schedule | null;
}

export interface Workflow extends Omit<WorkflowSummary, "nodeCount"> {
  definition: WorkflowDefinition;
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "missed";

export interface Run {
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  trigger: string;
  input: unknown;
  output: unknown | null;
  error: string | null;
  idempotencyKey: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  totalSteps: number;
  completedSteps: number;
  cancelRequested: boolean;
}

export interface RunStep {
  id: number;
  runId: string;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  output: unknown | null;
  error: string | null;
  attempt: number;
}

export interface RunDetail {
  run: Run;
  steps: RunStep[];
}

export interface RunFilter {
  status?: string;
  workflowId?: string;
  limit?: number;
  offset?: number;
}

export interface LogEntry {
  id: number;
  ts: string;
  level: "trace" | "debug" | "info" | "warn" | "error" | string;
  scope: string;
  runId: string | null;
  message: string;
  details: unknown | null;
}

export interface LogFilter {
  level?: string;
  scope?: string;
  runId?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface Settings {
  theme: "dark" | "light" | "system" | string;
  concurrency: number;
  runTimeoutSeconds: number;
  maxRetries: number;
  retryDelayMs: number;
  schedulerEnabled: boolean;
  logRetentionDays: number;
  maxLogRows: number;
  allowLocalNetwork: boolean;
  httpProxyUrl: string | null;
  httpProxyUsername: string | null;
  aiEndpoint: string;
  aiModel: string;
  ttsEndpoint: string;
  ttsModel: string;
  ttsVoice: string;
  ttsFormat: string;
  ttsSpeed: number;
  localApiEnabled: boolean;
  localApiPort: number;
  updateEndpoint: string | null;
}

export interface CountBucket {
  label: string;
  count: number;
}

export interface DayCount {
  day: string;
  succeeded: number;
  failed: number;
}

export interface DashboardStats {
  totalAccounts: number;
  accountsByProvider: CountBucket[];
  accountsByStatus: CountBucket[];
  totalStoryboards: number;
  totalVoiceoverAssets: number;
  totalWorkflows: number;
  enabledWorkflows: number;
  queuedRuns: number;
  runningRuns: number;
  succeededRuns: number;
  failedRuns: number;
  runsLast7Days: DayCount[];
  recentRuns: Run[];
  recentErrors: LogEntry[];
  schedulerEnabled: boolean;
  nextScheduledRun: string | null;
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: "error" | "warning" | string;
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface SecretRef {
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type DuplicateStrategy = "skip" | "replace" | "duplicate";

export interface ImportPreviewItem {
  key: string;
  label: string;
  duplicate: boolean;
  action: string;
}

export interface ImportPreview {
  kind: string;
  schemaVersion: number;
  total: number;
  valid: number;
  duplicates: number;
  errors: ValidationIssue[];
  items: ImportPreviewItem[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  replaced: number;
  errors: ValidationIssue[];
}

export interface StorageInfo {
  dataDir: string;
  databasePath: string;
  databaseBytes: number;
  schemaVersion: number;
  backupDir: string;
  secretStore: string;
  appVersion: string;
  platform: string;
}

export interface BackupInfo {
  path: string;
  bytes: number;
  createdAt: string;
  integrity: string;
}

export interface ProfileCheck {
  state: string;
  profilePath: string;
  fileCount: number;
  bytes: number;
  lastModified: string | null;
  message: string;
}

export interface SecretStoreStatus {
  available: boolean;
  backend: string;
  message: string;
}

export interface DeleteResult {
  deleted: boolean;
  cleanedUp: boolean;
}

export interface ProviderViewInfo {
  accountId: string;
  provider: string;
  label: string;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Prompt {
  id: string;
  title: string;
  prompt: string;
  category: string;
  pinned: boolean;
  cardColor: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromptInput {
  title: string;
  prompt: string;
  category?: string;
  pinned?: boolean;
  cardColor?: string;
}

export interface PromptFilter {
  query?: string;
  category?: string;
}

export interface PluginPreset {
  id: string;
  name: string;
  description: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown | null;
  timeoutMs: number | null;
}

export interface PluginManifest {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage: string | null;
  presets: PluginPreset[];
}

export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
  presetCount: number;
  installedAt: string;
  updatedAt: string;
}

export interface LicenseStatus {
  mode: "open" | "enforced" | string;
  licensed: boolean;
  plan: string | null;
  planName: string | null;
  subject: string | null;
  licenseId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  deviceId: string;
  message: string;
}

export interface LicensePlan {
  id: "monthly" | "yearly" | "lifetime" | string;
  name: string;
  priceIdr: number;
  billingPeriod: "monthly" | "yearly" | "lifetime" | string;
  durationDays: number | null;
  description: string;
  features: string[];
}

export interface Voiceover {
  text: string;
  voice: string;
  rate: number;
  pitch: number;
  volume: number;
}

export interface Shot {
  id: string;
  description: string;
  prompt: string;
  camera: string;
  durationSeconds: number;
  dialogue: string;
  transition: string;
}

export interface Scene {
  id: string;
  title: string;
  description: string;
  location: string;
  timeOfDay: string;
  shots: Shot[];
  voiceover: Voiceover;
}

export interface StoryboardSummary {
  id: string;
  title: string;
  logline: string;
  style: string;
  aspectRatio: string;
  sceneCount: number;
  shotCount: number;
  totalDurationSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface Storyboard {
  id: string;
  schemaVersion: number;
  title: string;
  logline: string;
  style: string;
  aspectRatio: string;
  scenes: Scene[];
  createdAt: string;
  updatedAt: string;
}

export interface StoryboardInput {
  title: string;
  logline?: string;
  style?: string;
  aspectRatio?: string;
  scenes?: Scene[];
}

export interface VoiceoverAsset {
  id: string;
  storyboardId: string;
  sceneId: string;
  path: string;
  format: string;
  bytes: number;
  voice: string;
  createdAt: string;
}

export interface WorkflowDraft {
  name: string;
  description: string;
  tags: string[];
  definition: WorkflowDefinition;
  validation: ValidationReport;
}

export interface ProviderTool {
  id: string;
  name: string;
  description: string;
  accountProvider: string;
  url: string;
  hint: string;
}

export interface LocalApiStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  baseUrl: string | null;
  tokenConfigured: boolean;
  error: string | null;
}

export interface UpdateInfo {
  currentVersion: string;
  version: string;
  date: string | null;
  body: string | null;
  target: string;
}
