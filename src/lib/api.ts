import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  AccountFilter,
  AccountInput,
  BackupInfo,
  Bounds,
  DashboardStats,
  DeleteResult,
  DuplicateStrategy,
  ImportPreview,
  ImportResult,
  LicensePlan,
  LicenseStatus,
  LocalApiStatus,
  LogEntry,
  LogFilter,
  PluginManifest,
  PluginSummary,
  ProfileCheck,
  Prompt,
  PromptFilter,
  PromptInput,
  ProviderInfo,
  ProviderTool,
  ProviderViewInfo,
  Run,
  RunDetail,
  RunFilter,
  Schedule,
  SecretRef,
  SecretStoreStatus,
  Settings,
  Storyboard,
  StoryboardInput,
  StoryboardSummary,
  StorageInfo,
  UpdateInfo,
  ValidationReport,
  VoiceoverAsset,
  Workflow,
  WorkflowDraft,
  WorkflowDefinition,
  WorkflowInput,
  WorkflowSummary,
} from "./types";

export class ApiError extends Error {
  code: string;

  constructor(message: string, code = "unknown") {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error && typeof error === "object" && "message" in error) {
    const value = error as { message?: unknown; code?: unknown };
    return new ApiError(
      typeof value.message === "string" ? value.message : "The operation failed",
      typeof value.code === "string" ? value.code : "unknown",
    );
  }
  if (typeof error === "string") return new ApiError(error);
  return new ApiError("The operation failed. Check the logs for details.");
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toApiError(error);
  }
}

export const api = {
  getProviders: () => call<ProviderInfo[]>("get_providers"),
  getProviderTools: () => call<ProviderTool[]>("get_provider_tools"),
  getDashboard: () => call<DashboardStats>("get_dashboard"),
  getStorageInfo: () => call<StorageInfo>("get_storage_info"),
  getSecretStoreStatus: () => call<SecretStoreStatus>("get_secret_store_status"),

  listAccounts: (filter?: AccountFilter) => call<Account[]>("list_accounts", { filter }),
  getAccount: (id: string) => call<Account>("get_account", { id }),
  createAccount: (input: AccountInput) => call<Account>("create_account", { input }),
  updateAccount: (id: string, input: AccountInput) => call<Account>("update_account", { id, input }),
  setAccountFavorite: (id: string, favorite: boolean) =>
    call<Account>("set_account_favorite", { id, favorite }),
  setAccountStatus: (id: string, status: string) =>
    call<Account>("set_account_status", { id, status }),
  deleteAccount: (id: string, confirmName: string) =>
    call<DeleteResult>("delete_account", { id, confirmName }),
  checkAccountProfile: (accountId: string) =>
    call<ProfileCheck>("check_account_profile", { accountId }),

  openProviderView: (accountId: string, bounds: Bounds) =>
    call<ProviderViewInfo>("open_provider_view", { accountId, bounds }),
  closeProviderView: () => call<void>("close_provider_view"),
  resizeProviderView: (bounds: Bounds) => call<void>("resize_provider_view", { bounds }),
  reloadProviderView: () => call<void>("reload_provider_view"),
  getProviderView: () => call<ProviderViewInfo | null>("get_provider_view"),
  openProviderTool: (accountId: string, toolId: string, bounds: Bounds) =>
    call<ProviderViewInfo>("open_provider_tool", { accountId, toolId, bounds }),

  listWorkflows: () => call<WorkflowSummary[]>("list_workflows"),
  getWorkflow: (id: string) => call<Workflow>("get_workflow", { id }),
  createWorkflow: (input: WorkflowInput) => call<Workflow>("create_workflow", { input }),
  updateWorkflow: (id: string, input: WorkflowInput) =>
    call<Workflow>("update_workflow", { id, input }),
  duplicateWorkflow: (id: string) => call<Workflow>("duplicate_workflow", { id }),
  deleteWorkflow: (id: string, confirmName: string) =>
    call<DeleteResult>("delete_workflow", { id, confirmName }),
  setWorkflowEnabled: (id: string, enabled: boolean) =>
    call<void>("set_workflow_enabled", { id, enabled }),
  validateWorkflowDefinition: (definition: WorkflowDefinition) =>
    call<ValidationReport>("validate_workflow_definition", { definition }),
  listSchedules: () => call<Schedule[]>("list_schedules"),

  runWorkflow: (workflowId: string, input: unknown, idempotencyKey?: string) =>
    call<Run>("run_workflow", { workflowId, input, idempotencyKey }),
  cancelRun: (id: string) => call<boolean>("cancel_run", { id }),
  retryRun: (id: string) => call<Run>("retry_run", { id }),
  listRuns: (filter?: RunFilter) => call<Run[]>("list_runs", { filter }),
  getRun: (id: string) => call<RunDetail>("get_run", { id }),
  listLogs: (filter?: LogFilter) => call<LogEntry[]>("list_logs", { filter }),
  clearLogs: (confirm: boolean) => call<number>("clear_logs", { confirm }),

  getSettings: () => call<Settings>("get_settings"),
  updateSettings: (settings: Settings) => call<Settings>("update_settings", { settings }),

  listSecrets: () => call<SecretRef[]>("list_secrets"),
  setSecret: (name: string, value: string) => call<SecretRef>("set_secret", { name, value }),
  deleteSecret: (name: string, confirmName: string) =>
    call<void>("delete_secret", { name, confirmName }),
  setProxyPassword: (password: string | null) => call<void>("set_proxy_password", { password }),

  generateWorkflowDraft: (description: string) =>
    call<WorkflowDraft>("generate_workflow_draft", { description }),

  getLicenseStatus: () => call<LicenseStatus>("get_license_status"),
  getLicensePlans: () => call<LicensePlan[]>("get_license_plans"),
  activateLicense: (token: string) => call<LicenseStatus>("activate_license", { token }),
  deactivateLicense: () => call<LicenseStatus>("deactivate_license"),

  listStoryboards: () => call<StoryboardSummary[]>("list_storyboards"),
  getStoryboard: (id: string) => call<Storyboard>("get_storyboard", { id }),
  createStoryboard: (input: StoryboardInput) =>
    call<Storyboard>("create_storyboard", { input }),
  updateStoryboard: (id: string, input: StoryboardInput) =>
    call<Storyboard>("update_storyboard", { id, input }),
  deleteStoryboard: (id: string) => call<void>("delete_storyboard", { id }),
  duplicateStoryboard: (id: string) => call<Storyboard>("duplicate_storyboard", { id }),
  exportStoryboard: (id: string, path: string, format: "markdown" | "json") =>
    call<number>("export_storyboard", { id, path, format }),
  listVoiceoverAssets: (storyboardId?: string) =>
    call<VoiceoverAsset[]>("list_voiceover_assets", { storyboardId }),
  deleteVoiceoverAsset: (id: string) => call<void>("delete_voiceover_asset", { id }),
  synthesizeVoiceover: (text: string, path: string, storyboardId?: string, sceneId?: string) =>
    call<VoiceoverAsset>("synthesize_voiceover", { text, path, storyboardId, sceneId }),

  listPrompts: (filter?: PromptFilter) => call<Prompt[]>("list_prompts", { filter }),
  createPrompt: (input: PromptInput) => call<Prompt>("create_prompt", { input }),
  updatePrompt: (id: string, input: PromptInput) => call<Prompt>("update_prompt", { id, input }),
  deletePrompt: (id: string) => call<void>("delete_prompt", { id }),
  setPromptPinned: (id: string, pinned: boolean) => call<Prompt>("set_prompt_pinned", { id, pinned }),

  listPlugins: () => call<PluginSummary[]>("list_plugins"),
  installPlugin: (path: string) => call<PluginSummary>("install_plugin", { path }),
  getPluginManifest: (id: string) => call<PluginManifest>("get_plugin_manifest", { id }),
  setPluginEnabled: (id: string, enabled: boolean) =>
    call<PluginSummary>("set_plugin_enabled", { id, enabled }),
  deletePlugin: (id: string, confirmId: string) =>
    call<void>("delete_plugin", { id, confirmId }),

  getLocalApiStatus: () => call<LocalApiStatus>("get_local_api_status"),
  revealLocalApiToken: () => call<string>("reveal_local_api_token"),
  rotateLocalApiToken: () => call<string>("rotate_local_api_token"),

  checkForUpdates: () => call<UpdateInfo | null>("check_for_updates"),
  installUpdate: () => call<void>("install_update"),

  importPreview: (path: string, strategy: DuplicateStrategy) =>
    call<ImportPreview>("import_preview", { path, strategy }),
  importApply: (path: string, strategy: DuplicateStrategy) =>
    call<ImportResult>("import_apply", { path, strategy }),
  exportData: (path: string) => call<number>("export_data", { path }),
  createBackup: () => call<BackupInfo>("create_backup"),
  listBackups: () => call<BackupInfo[]>("list_backups"),
  verifyBackup: (path: string) => call<string>("verify_backup", { path }),
  stageRestore: (path: string) => call<string>("stage_restore", { path }),
};
