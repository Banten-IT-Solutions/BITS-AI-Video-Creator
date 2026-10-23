use crate::db::{latest_schema_version, Database};
use crate::error::{CoreError, Result};
use crate::legacy;
use crate::models::{
    now_rfc3339, AccountFilter, AccountInput, BackupInfo, DuplicateStrategy, ImportPreview,
    ImportPreviewItem, ImportResult, ValidationIssue, WorkflowInput,
};
use crate::validation;
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};

#[cfg(unix)]
fn restrict_permissions(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(metadata) = std::fs::metadata(path) {
        let mut permissions = metadata.permissions();
        permissions.set_mode(mode);
        let _ = std::fs::set_permissions(path, permissions);
    }
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path, _mode: u32) {}

pub const EXPORT_SCHEMA_VERSION: u32 = 1;
pub const EXPORT_KIND: &str = "bits-ai-video-creator.export";
pub const MAX_IMPORT_BYTES: u64 = 20 * 1024 * 1024;
pub const MAX_EXPORT_ACCOUNTS: usize = 5_000;
pub const MAX_EXPORT_WORKFLOWS: usize = 500;
pub const PENDING_RESTORE_FILE: &str = "bits-ai-video-creator-restore-pending.db";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBundle {
    pub kind: String,
    pub schema_version: u32,
    pub exported_at: String,
    pub app_version: String,
    #[serde(default)]
    pub accounts: Vec<AccountInput>,
    #[serde(default)]
    pub workflows: Vec<WorkflowInput>,
    /// Names only. Secret values deliberately never leave the keyring.
    #[serde(default)]
    pub secret_names: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ParsedImport {
    pub format: String,
    pub bundle: ExportBundle,
    pub warnings: Vec<String>,
}

pub fn build_export(db: &Database, app_version: &str) -> Result<ExportBundle> {
    let accounts = db
        .list_accounts(&AccountFilter::default())?
        .into_iter()
        .map(|account| AccountInput {
            provider: account.provider,
            name: account.name,
            email: account.email,
            external_id: account.external_id,
            status: Some(account.status),
            favorite: Some(account.favorite),
            tags: Some(account.tags),
            notes: Some(account.notes),
            sort_order: Some(account.sort_order),
        })
        .collect::<Vec<_>>();
    if accounts.len() > MAX_EXPORT_ACCOUNTS {
        return Err(CoreError::validation("Too many accounts to export at once"));
    }

    let mut workflows = Vec::new();
    for summary in db.list_workflows()? {
        let workflow = db.get_workflow(&summary.id)?;
        workflows.push(WorkflowInput {
            name: workflow.name,
            description: workflow.description,
            tags: workflow.tags,
            enabled: workflow.enabled,
            definition: workflow.definition,
            schedule: workflow
                .schedule
                .map(|schedule| crate::models::ScheduleInput {
                    cron: schedule.cron,
                    timezone: schedule.timezone,
                    enabled: schedule.enabled,
                }),
        });
    }
    if workflows.len() > MAX_EXPORT_WORKFLOWS {
        return Err(CoreError::validation(
            "Too many workflows to export at once",
        ));
    }

    let secret_names = db
        .list_secret_refs()?
        .into_iter()
        .map(|item| item.name)
        .collect();

    Ok(ExportBundle {
        kind: EXPORT_KIND.to_string(),
        schema_version: EXPORT_SCHEMA_VERSION,
        exported_at: now_rfc3339(),
        app_version: app_version.to_string(),
        accounts,
        workflows,
        secret_names,
    })
}

pub fn export_to_path(db: &Database, app_version: &str, path: &Path) -> Result<u64> {
    if !matches!(
        path.extension().and_then(|value| value.to_str()),
        Some("json") | Some("bits-ai-video-creator")
    ) {
        return Err(CoreError::validation(
            "Exports must use a .json or .bits-ai-video-creator extension",
        ));
    }
    let bundle = build_export(db, app_version)?;
    let mut bytes = serde_json::to_vec_pretty(&bundle)?;
    bytes.push(b'\n');
    write_atomic(path, &bytes)?;
    Ok(bytes.len() as u64)
}

/// Accepts the BITS AI Video Creator export envelope and plain legacy account-array JSON
/// files. Detection is structural; a file cannot opt into a parser by name.
pub fn parse_import(raw: &str) -> Result<ParsedImport> {
    if raw.len() as u64 > MAX_IMPORT_BYTES {
        return Err(CoreError::validation("Import file exceeds the 20 MB limit"));
    }
    if raw.trim().is_empty() {
        return Err(CoreError::validation("Import file is empty"));
    }
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|_| CoreError::validation("Import file is not valid JSON"))?;

    let kind = value.get("kind").and_then(|kind| kind.as_str());

    if let Some(kind) = kind {
        if kind != EXPORT_KIND {
            return Err(CoreError::validation("Unsupported import file kind"));
        }
        let bundle: ExportBundle = serde_json::from_value(value).map_err(|error| {
            CoreError::validation(format!("Import file has an invalid structure: {error}"))
        })?;
        if bundle.schema_version != EXPORT_SCHEMA_VERSION {
            return Err(CoreError::validation("Unsupported export schema version"));
        }
        if bundle.accounts.len() > MAX_EXPORT_ACCOUNTS
            || bundle.workflows.len() > MAX_EXPORT_WORKFLOWS
        {
            return Err(CoreError::validation(
                "Import file contains too many records",
            ));
        }
        let mut warnings = Vec::new();
        if !bundle.secret_names.is_empty() {
            warnings.push(
                "Secret names were exported, but secret values are never exported. Re-enter missing secrets in Settings."
                    .to_string(),
            );
        }
        Ok(ParsedImport {
            format: "bits-ai-video-creator".into(),
            bundle,
            warnings,
        })
    } else {
        let parsed = legacy::parse_legacy_accounts(raw)?;
        Ok(ParsedImport {
            format: "legacy-accounts".into(),
            bundle: ExportBundle {
                kind: EXPORT_KIND.into(),
                schema_version: EXPORT_SCHEMA_VERSION,
                exported_at: now_rfc3339(),
                app_version: "1.x".into(),
                accounts: parsed.accounts,
                workflows: vec![],
                secret_names: vec![],
            },
            warnings: parsed.warnings,
        })
    }
}

pub fn read_import_file(path: &Path) -> Result<ParsedImport> {
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(CoreError::validation("Select a file to import"));
    }
    if metadata.len() > MAX_IMPORT_BYTES {
        return Err(CoreError::validation("Import file exceeds the 20 MB limit"));
    }
    let raw = std::fs::read_to_string(path)?;
    parse_import(&raw)
}

pub fn preview_import(
    db: &Database,
    parsed: &ParsedImport,
    strategy: DuplicateStrategy,
) -> Result<ImportPreview> {
    let mut preview = ImportPreview {
        kind: parsed.format.clone(),
        schema_version: parsed.bundle.schema_version,
        total: parsed.bundle.accounts.len() + parsed.bundle.workflows.len(),
        ..Default::default()
    };
    for warning in &parsed.warnings {
        preview.errors.push(ValidationIssue {
            path: "import".into(),
            message: warning.clone(),
            severity: "warning".into(),
        });
    }

    for (index, account) in parsed.bundle.accounts.iter().enumerate() {
        let key = format!(
            "{}:{}",
            account.provider,
            validation::normalize_name(&account.name)
        );
        let mut valid = true;
        if let Err(error) = validation::validate_account(account) {
            preview.errors.push(ValidationIssue {
                path: format!("accounts[{index}]"),
                message: error.to_string(),
                severity: "error".into(),
            });
            valid = false;
        }
        let duplicate = db
            .account_duplicate(
                account.provider.trim(),
                &account.name,
                account.email.as_deref(),
                account.external_id.as_deref(),
            )?
            .is_some();
        if duplicate {
            preview.duplicates += 1;
        }
        if valid {
            preview.valid += 1;
        }
        preview.items.push(ImportPreviewItem {
            key,
            label: format!("{} · {}", account.provider, account.name.trim()),
            duplicate,
            action: action_for(duplicate, strategy),
        });
    }

    let existing_workflows: HashSet<String> = db
        .list_workflows()?
        .into_iter()
        .map(|workflow| workflow.name.to_lowercase())
        .collect();
    for (index, workflow) in parsed.bundle.workflows.iter().enumerate() {
        let mut valid = true;
        if let Err(error) = validation::validate_workflow_input(workflow) {
            preview.errors.push(ValidationIssue {
                path: format!("workflows[{index}]"),
                message: error.to_string(),
                severity: "error".into(),
            });
            valid = false;
        }
        let duplicate = existing_workflows.contains(&workflow.name.trim().to_lowercase());
        if duplicate {
            preview.duplicates += 1;
        }
        if valid {
            preview.valid += 1;
        }
        preview.items.push(ImportPreviewItem {
            key: format!("workflow:{}", workflow.name.trim().to_lowercase()),
            label: format!("Workflow · {}", workflow.name.trim()),
            duplicate,
            action: action_for(duplicate, strategy),
        });
    }

    Ok(preview)
}

fn action_for(duplicate: bool, strategy: DuplicateStrategy) -> String {
    if !duplicate {
        return "create".into();
    }
    match strategy {
        DuplicateStrategy::Skip => "skip".into(),
        DuplicateStrategy::Replace => "replace".into(),
        DuplicateStrategy::Duplicate => "create copy".into(),
    }
}

pub fn apply_import(
    db: &Database,
    parsed: &ParsedImport,
    strategy: DuplicateStrategy,
) -> Result<ImportResult> {
    let mut result = ImportResult {
        imported: 0,
        skipped: 0,
        replaced: 0,
        errors: vec![],
    };
    if !parsed.bundle.accounts.is_empty() {
        let accounts = db.import_accounts(&parsed.bundle.accounts, strategy)?;
        result.imported += accounts.imported;
        result.skipped += accounts.skipped;
        result.replaced += accounts.replaced;
        result.errors.extend(accounts.errors);
    }
    if !parsed.bundle.workflows.is_empty() {
        let workflows = db.import_workflows(&parsed.bundle.workflows, strategy)?;
        result.imported += workflows.imported;
        result.skipped += workflows.skipped;
        result.replaced += workflows.replaced;
        result.errors.extend(workflows.errors);
    }
    Ok(result)
}

// ---------- Backups ----------

pub fn create_backup(db: &Database, backup_dir: &Path) -> Result<BackupInfo> {
    if backup_dir.exists() && !backup_dir.is_dir() {
        return Err(CoreError::validation("Backup location must be a directory"));
    }
    std::fs::create_dir_all(backup_dir)?;
    restrict_permissions(backup_dir, 0o700);
    let stamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let mut path = backup_dir.join(format!("bits-ai-video-creator-backup-{stamp}.db"));
    let mut attempt = 1;
    while path.exists() {
        path = backup_dir.join(format!("bits-ai-video-creator-backup-{stamp}-{attempt}.db"));
        attempt += 1;
        if attempt > 100 {
            return Err(CoreError::conflict(
                "Unable to allocate a unique backup file name",
            ));
        }
    }
    let bytes = db.backup_to(&path)?;
    restrict_permissions(&path, 0o600);
    let integrity = verify_sqlite_database(&path)?;
    Ok(BackupInfo {
        path: path.to_string_lossy().to_string(),
        bytes,
        created_at: now_rfc3339(),
        integrity,
    })
}

pub fn list_backups(backup_dir: &Path) -> Result<Vec<BackupInfo>> {
    if !backup_dir.exists() {
        return Ok(vec![]);
    }
    if !backup_dir.is_dir() {
        return Err(CoreError::validation("Backup location must be a directory"));
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(backup_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if !matches!(extension, "db" | "sqlite" | "backup") {
            continue;
        }
        if path.file_name().and_then(|value| value.to_str()) == Some(PENDING_RESTORE_FILE) {
            continue;
        }
        let metadata = entry.metadata()?;
        let created_at = metadata
            .modified()
            .ok()
            .map(|time| {
                DateTime::<Utc>::from(time).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
            })
            .unwrap_or_else(now_rfc3339);
        out.push(BackupInfo {
            path: path.to_string_lossy().to_string(),
            bytes: metadata.len(),
            created_at,
            integrity: "unchecked".into(),
        });
        if out.len() >= 200 {
            break;
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

pub fn verify_sqlite_database(path: &Path) -> Result<String> {
    if !path.is_file() {
        return Err(CoreError::validation("Database file was not found"));
    }
    let mut header = [0u8; 16];
    {
        use std::io::Read;
        let mut file = std::fs::File::open(path)?;
        file.read_exact(&mut header).map_err(|_| {
            CoreError::validation("File is too small to be a BITS AI Video Creator database")
        })?;
    }
    if &header != b"SQLite format 3\0" {
        return Err(CoreError::validation("File is not a SQLite database"));
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(CoreError::validation(format!(
            "Database integrity check failed: {integrity}"
        )));
    }
    let tables: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('accounts','workflows','runs')",
        [],
        |row| row.get(0),
    )?;
    if tables < 3 {
        return Err(CoreError::validation(
            "File is not a BITS AI Video Creator database",
        ));
    }
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version < 1 || version > latest_schema_version() {
        return Err(CoreError::validation(format!(
            "Database schema version {version} is not supported by this build"
        )));
    }
    Ok(integrity)
}

pub fn pending_restore_path(data_dir: &Path) -> PathBuf {
    data_dir.join(PENDING_RESTORE_FILE)
}

/// Validates a user-selected database and stages it for replacement on next
/// launch. The live database is never overwritten while the app is running.
pub fn stage_restore(source: &Path, data_dir: &Path) -> Result<PathBuf> {
    verify_sqlite_database(source)?;
    std::fs::create_dir_all(data_dir)?;
    let staged = pending_restore_path(data_dir);
    if source == staged {
        return Err(CoreError::validation("Select a different database file"));
    }
    std::fs::copy(source, &staged)?;
    restrict_permissions(&staged, 0o600);
    verify_sqlite_database(&staged)?;
    Ok(staged)
}

/// Called by the desktop shell before opening the database. Returns true when
/// a staged restore was applied. A safety copy of the previous database is
/// kept next to it.
pub fn apply_pending_restore(data_dir: &Path, live_db_path: &Path) -> Result<bool> {
    let staged = pending_restore_path(data_dir);
    if !staged.exists() {
        return Ok(false);
    }
    verify_sqlite_database(&staged)?;
    std::fs::create_dir_all(data_dir)?;
    if live_db_path.exists() {
        verify_sqlite_database(live_db_path)?;
        let safety = data_dir.join(format!(
            "bits-ai-video-creator-before-restore-{}.db",
            Utc::now().format("%Y%m%d-%H%M%S")
        ));
        std::fs::copy(live_db_path, &safety)?;
    }
    let _ = std::fs::remove_file(live_db_path.with_extension("db-wal"));
    let _ = std::fs::remove_file(live_db_path.with_extension("db-shm"));
    // Rename after the safety copy. `fs::rename` replaces an existing file on
    // both Unix and Windows, so the live database is never absent between
    // these two steps.
    std::fs::rename(&staged, live_db_path)?;
    Ok(true)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    if path.is_dir() {
        return Err(CoreError::validation("Choose a file path, not a directory"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| CoreError::validation("Choose an export location"))?;
    std::fs::create_dir_all(parent)?;
    let temp = parent.join(format!(
        ".bits-ai-video-creator-export-{}.tmp",
        uuid::Uuid::new_v4()
    ));
    let result = (|| -> Result<()> {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        // `fs::rename` replaces an existing destination on Unix and Windows;
        // do not delete the previous export first.
        std::fs::rename(&temp, path)?;
        restrict_permissions(path, 0o600);
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{WorkflowDefinition, WorkflowEdge, WorkflowNode};

    fn sample_workflow(name: &str) -> WorkflowInput {
        WorkflowInput {
            name: name.into(),
            description: "Test workflow".into(),
            tags: vec!["test".into()],
            enabled: true,
            definition: WorkflowDefinition {
                schema_version: 1,
                nodes: vec![
                    WorkflowNode {
                        id: "start".into(),
                        node_type: "trigger.manual".into(),
                        name: "Start".into(),
                        config: serde_json::json!({}),
                        position: None,
                    },
                    WorkflowNode {
                        id: "log".into(),
                        node_type: "action.log".into(),
                        name: "Log".into(),
                        config: serde_json::json!({"message": "hello {{input.name}}"}),
                        position: None,
                    },
                ],
                edges: vec![WorkflowEdge {
                    id: "e1".into(),
                    from: "start".into(),
                    to: "log".into(),
                    branch: None,
                }],
            },
            schedule: None,
        }
    }

    fn sample_account(name: &str) -> AccountInput {
        AccountInput {
            provider: "google-flow".into(),
            name: name.into(),
            email: None,
            external_id: None,
            status: Some("active".into()),
            favorite: Some(false),
            tags: Some(vec!["imported".into()]),
            notes: None,
            sort_order: None,
        }
    }

    #[test]
    fn exports_and_imports_round_trip() {
        let source = Database::open_in_memory().unwrap();
        source.create_account(&sample_account("Main")).unwrap();
        source.create_workflow(&sample_workflow("Daily")).unwrap();
        let bundle = build_export(&source, "1.0.0").unwrap();
        let raw = serde_json::to_string(&bundle).unwrap();
        let parsed = parse_import(&raw).unwrap();
        assert_eq!(parsed.format, "bits-ai-video-creator");
        assert_eq!(parsed.bundle.accounts.len(), 1);
        assert_eq!(parsed.bundle.workflows.len(), 1);

        let target = Database::open_in_memory().unwrap();
        let preview = preview_import(&target, &parsed, DuplicateStrategy::Skip).unwrap();
        assert_eq!(preview.total, 2);
        assert_eq!(preview.valid, 2);
        let result = apply_import(&target, &parsed, DuplicateStrategy::Skip).unwrap();
        assert_eq!(result.imported, 2);
        assert_eq!(
            target
                .list_accounts(&AccountFilter::default())
                .unwrap()
                .len(),
            1
        );
        assert_eq!(target.list_workflows().unwrap().len(), 1);
    }

    #[test]
    fn duplicate_strategies_are_applied() {
        let source = Database::open_in_memory().unwrap();
        source.create_account(&sample_account("Main")).unwrap();
        let bundle = build_export(&source, "1.0.0").unwrap();
        let parsed = ParsedImport {
            format: "bits-ai-video-creator".into(),
            bundle,
            warnings: vec![],
        };

        let skipped_source = Database::open_in_memory().unwrap();
        let result = apply_import(&skipped_source, &parsed, DuplicateStrategy::Skip).unwrap();
        assert_eq!(result.imported, 1);
        let result = apply_import(&skipped_source, &parsed, DuplicateStrategy::Skip).unwrap();
        assert_eq!(result.skipped, 1);

        let duplicated = Database::open_in_memory().unwrap();
        apply_import(&duplicated, &parsed, DuplicateStrategy::Duplicate).unwrap();
        apply_import(&duplicated, &parsed, DuplicateStrategy::Duplicate).unwrap();
        let accounts = duplicated.list_accounts(&AccountFilter::default()).unwrap();
        assert_eq!(accounts.len(), 2);
        assert!(accounts
            .iter()
            .any(|account| account.name.contains("imported")));
    }

    #[test]
    fn imports_legacy_account_files() {
        let raw = r#"[{"id":"a","name":"Legacy","email":null,"favorite":true,"order":0}]"#;
        let parsed = parse_import(raw).unwrap();
        assert_eq!(parsed.format, "legacy-accounts");
        assert_eq!(parsed.bundle.accounts.len(), 1);
        assert_eq!(parsed.bundle.accounts[0].provider, "google-flow");
    }

    #[test]
    fn rejects_invalid_envelopes() {
        assert!(parse_import("{}").is_err());
        assert!(parse_import("not json").is_err());
        let raw = r#"{"kind":"bits-ai-video-creator.export","schemaVersion":99,"accounts":[],"workflows":[]}"#;
        assert!(parse_import(raw).is_err());
        let raw = r#"{"kind":"legacy.export","schemaVersion":1,"accounts":[],"workflows":[]}"#;
        assert!(parse_import(raw).is_err());
    }

    #[test]
    fn export_path_requires_safe_extension() {
        let db = Database::open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        assert!(export_to_path(&db, "1.0.0", &dir.path().join("export.txt")).is_err());
        let path = dir.path().join("export.json");
        let bytes = export_to_path(&db, "1.0.0", &path).unwrap();
        assert!(bytes > 0);
        assert!(path.exists());
    }

    #[test]
    fn backup_stage_and_restore_flow() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("live").join("bits-ai-video-creator.db");
        std::fs::create_dir_all(live.parent().unwrap()).unwrap();
        let db = Database::open(&live).unwrap();
        db.create_account(&sample_account("Backup Me")).unwrap();
        let backups = dir.path().join("backups");
        let info = create_backup(&db, &backups).unwrap();
        assert_eq!(info.integrity, "ok");
        assert!(Path::new(&info.path).exists());
        assert_eq!(list_backups(&backups).unwrap().len(), 1);
        drop(db);

        let staged = stage_restore(Path::new(&info.path), live.parent().unwrap()).unwrap();
        assert!(staged.exists());
        let applied = apply_pending_restore(live.parent().unwrap(), &live).unwrap();
        assert!(applied);
        assert!(!staged.exists());

        let restored = Database::open(&live).unwrap();
        assert_eq!(
            restored
                .list_accounts(&AccountFilter::default())
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn rejects_non_sqlite_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fake.db");
        std::fs::write(&path, b"definitely not sqlite").unwrap();
        assert!(verify_sqlite_database(&path).is_err());
    }

    #[test]
    fn preview_reports_duplicates_and_errors() {
        let db = Database::open_in_memory().unwrap();
        db.create_account(&sample_account("Main")).unwrap();
        let mut bundle = build_export(&db, "1.0.0").unwrap();
        bundle.accounts.push(AccountInput {
            name: "".into(),
            ..sample_account("x")
        });
        let parsed = ParsedImport {
            format: "bits-ai-video-creator".into(),
            bundle,
            warnings: vec![],
        };
        let preview = preview_import(&db, &parsed, DuplicateStrategy::Replace).unwrap();
        assert_eq!(preview.duplicates, 1);
        assert!(preview.errors.iter().any(|issue| issue.severity == "error"));
        assert!(preview.items.iter().any(|item| item.action == "replace"));
    }
}
