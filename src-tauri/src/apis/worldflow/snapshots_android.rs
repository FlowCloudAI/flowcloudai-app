use super::common::*;

#[cfg(target_os = "android")]
const SNAPSHOT_UNSUPPORTED_MESSAGE: &str = "Android 端暂不支持快照功能";
#[cfg(target_os = "ios")]
const SNAPSHOT_UNSUPPORTED_MESSAGE: &str = "iOS 端暂不支持快照功能";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfoDto {
    pub id: String,
    pub message: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotBranchInfoDto {
    pub name: String,
    pub head: Option<String>,
    pub is_current: bool,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendResultDto {
    pub projects: usize,
    pub categories: usize,
    pub entries: usize,
    pub tag_schemas: usize,
    pub relations: usize,
    pub links: usize,
    pub entry_types: usize,
    pub idea_notes: usize,
    pub preserved_legacy_page_documents: usize,
    pub preserved_legacy_component_definitions: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRestoreReportDto {
    pub preserved_legacy_page_documents: usize,
    pub preserved_legacy_component_definitions: usize,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotGraphBranchDto {
    pub name: String,
    pub target: Option<String>,
    pub is_current: bool,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotGraphNodeDto {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub timestamp: i64,
    pub parents: Vec<String>,
    pub branch_names: Vec<String>,
    pub is_current_head: bool,
    pub is_active_tip: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotGraphDto {
    pub active_branch: String,
    pub branches: Vec<SnapshotGraphBranchDto>,
    pub nodes: Vec<SnapshotGraphNodeDto>,
}

fn snapshot_unsupported<T>() -> Result<T, String> {
    Err(SNAPSHOT_UNSUPPORTED_MESSAGE.to_string())
}

#[tauri::command]
pub async fn db_snapshot(
    _state: State<'_, Arc<AppState>>,
    _project_id: Option<String>,
) -> Result<bool, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_snapshot_with_message(
    _state: State<'_, Arc<AppState>>,
    _project_id: Option<String>,
    _message: String,
) -> Result<bool, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_get_active_branch(
    _state: State<'_, Arc<AppState>>,
    _project_id: Option<String>,
) -> Result<String, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_list_branches(
    _state: State<'_, Arc<AppState>>,
    _project_id: Option<String>,
) -> Result<Vec<SnapshotBranchInfoDto>, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_create_branch(
    _state: State<'_, Arc<AppState>>,
    _branch_name: String,
    _from_ref: Option<String>,
    _project_id: Option<String>,
) -> Result<(), String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_switch_branch(
    _state: State<'_, Arc<AppState>>,
    _branch_name: String,
    _project_id: Option<String>,
) -> Result<SnapshotRestoreReportDto, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_list_snapshots(
    _state: State<'_, Arc<AppState>>,
    _project_id: Option<String>,
) -> Result<Vec<SnapshotInfoDto>, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_list_snapshots_in_branch(
    _state: State<'_, Arc<AppState>>,
    _branch_name: String,
    _project_id: Option<String>,
) -> Result<Vec<SnapshotInfoDto>, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_get_snapshot_graph(
    _state: State<'_, Arc<AppState>>,
    _paths: State<'_, PathsState>,
    _project_id: Option<String>,
) -> Result<SnapshotGraphDto, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_snapshot_to_branch(
    _state: State<'_, Arc<AppState>>,
    _branch_name: String,
    _message: String,
    _project_id: Option<String>,
) -> Result<bool, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_rollback_to(
    _state: State<'_, Arc<AppState>>,
    _snapshot_id: String,
    _project_id: Option<String>,
) -> Result<SnapshotRestoreReportDto, String> {
    snapshot_unsupported()
}

#[tauri::command]
pub async fn db_append_from(
    _state: State<'_, Arc<AppState>>,
    _snapshot_id: String,
    _project_id: Option<String>,
) -> Result<AppendResultDto, String> {
    snapshot_unsupported()
}
