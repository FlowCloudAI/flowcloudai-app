use super::common::*;
use git2::{BranchType, Oid, Repository, Sort};
use worldflow_core::{AppendResult, SnapshotBranchInfo, SnapshotInfo, SnapshotRestoreReport};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRestoreReportDto {
    pub preserved_legacy_page_documents: usize,
    pub preserved_legacy_component_definitions: usize,
    pub warning: Option<String>,
}

impl From<SnapshotRestoreReport> for SnapshotRestoreReportDto {
    fn from(report: SnapshotRestoreReport) -> Self {
        Self {
            preserved_legacy_page_documents: report.preserved_legacy_page_documents,
            preserved_legacy_component_definitions: report.preserved_legacy_component_definitions,
            warning: report.warning,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfoDto {
    pub id: String,
    pub message: String,
    pub timestamp: i64,
}

impl From<SnapshotInfo> for SnapshotInfoDto {
    fn from(s: SnapshotInfo) -> Self {
        Self {
            id: s.id,
            message: s.message,
            timestamp: s.timestamp,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotBranchInfoDto {
    pub name: String,
    pub head: Option<String>,
    pub is_current: bool,
    pub is_active: bool,
}

impl From<SnapshotBranchInfo> for SnapshotBranchInfoDto {
    fn from(branch: SnapshotBranchInfo) -> Self {
        Self {
            name: branch.name,
            head: branch.head,
            is_current: branch.is_current,
            is_active: branch.is_active,
        }
    }
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

impl From<AppendResult> for AppendResultDto {
    fn from(r: AppendResult) -> Self {
        Self {
            projects: r.projects,
            categories: r.categories,
            entries: r.entries,
            tag_schemas: r.tag_schemas,
            relations: r.relations,
            links: r.links,
            entry_types: r.entry_types,
            idea_notes: r.idea_notes,
            preserved_legacy_page_documents: r.preserved_legacy_page_documents,
            preserved_legacy_component_definitions: r.preserved_legacy_component_definitions,
        }
    }
}

fn snapshot_repo_dir(paths: &PathsState) -> Result<PathBuf, String> {
    paths
        .db_path
        .parent()
        .map(|dir| dir.join("snapshots"))
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))
}

fn parse_snapshot_project_id(project_id: Option<String>) -> Result<Option<Uuid>, String> {
    project_id
        .map(|id| Uuid::parse_str(&id).map_err(|e| e.to_string()))
        .transpose()
}

async fn open_snapshot_db(state: &AppState, project_id: Option<&Uuid>) -> Result<SqliteDb, String> {
    match project_id {
        Some(project_id) => open_project_db(state, project_id).await,
        None => Ok(state.sqlite_db.lock().await.clone()),
    }
}

fn snapshot_repo_dir_for_project(
    state: &AppState,
    paths: &PathsState,
    project_id: Option<&Uuid>,
) -> Result<PathBuf, String> {
    match project_id {
        Some(project_id) => Ok(state.world_store.paths(*project_id).snapshots_dir),
        None => snapshot_repo_dir(paths),
    }
}

fn load_snapshot_graph(repo_dir: &Path, active_branch: &str) -> Result<SnapshotGraphDto, String> {
    let repo = match Repository::open(repo_dir) {
        Ok(repo) => repo,
        Err(_) => {
            return Ok(SnapshotGraphDto {
                active_branch: active_branch.to_string(),
                branches: Vec::new(),
                nodes: Vec::new(),
            });
        }
    };

    let mut branches = Vec::new();
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk
        .set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .map_err(|e| e.to_string())?;

    for branch_result in repo
        .branches(Some(BranchType::Local))
        .map_err(|e| e.to_string())?
    {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
        let name = branch
            .name()
            .map_err(|e| e.to_string())?
            .unwrap_or("")
            .to_string();
        let target = branch.get().target().map(|oid| oid.to_string());
        let is_current = branch.is_head();
        let is_active = name == active_branch;

        if let Some(oid) = branch.get().target() {
            revwalk.push(oid).map_err(|e| e.to_string())?;
        }

        branches.push(SnapshotGraphBranchDto {
            name,
            target,
            is_current,
            is_active,
        });
    }

    let current_head_target = branches
        .iter()
        .find(|branch| branch.is_current)
        .and_then(|branch| branch.target.clone());
    let active_tip_target = branches
        .iter()
        .find(|branch| branch.is_active)
        .and_then(|branch| branch.target.clone());

    let mut visited = std::collections::HashSet::<Oid>::new();
    let mut nodes = Vec::new();

    for oid_result in revwalk {
        let oid = oid_result.map_err(|e| e.to_string())?;
        if !visited.insert(oid) {
            continue;
        }

        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let id = commit.id().to_string();
        let parents = commit
            .parent_ids()
            .map(|parent| parent.to_string())
            .collect::<Vec<_>>();
        let branch_names = branches
            .iter()
            .filter(|branch| branch.target.as_deref() == Some(id.as_str()))
            .map(|branch| branch.name.clone())
            .collect::<Vec<_>>();

        nodes.push(SnapshotGraphNodeDto {
            short_id: id.chars().take(8).collect(),
            is_current_head: current_head_target.as_deref() == Some(id.as_str()),
            is_active_tip: active_tip_target.as_deref() == Some(id.as_str()),
            id,
            message: commit.summary().unwrap_or("未命名快照").to_string(),
            timestamp: commit.time().seconds(),
            parents,
            branch_names,
        });
    }

    Ok(SnapshotGraphDto {
        active_branch: active_branch.to_string(),
        branches,
        nodes,
    })
}

/// 手动触发一次快照（消息前缀 "manual <unix_secs>"）
/// 返回 true 表示创建了新快照，false 表示内容无变化跳过
#[tauri::command]
pub async fn db_snapshot(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
) -> Result<bool, String> {
    let project_id = parse_snapshot_project_id(project_id)?;
    let db = open_snapshot_db(state.inner(), project_id.as_ref()).await?;
    match db.snapshot().await {
        Ok(()) => Ok(true),
        Err(WorldflowError::NoChanges) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// 手动触发一次带说明的快照
/// 返回 true 表示创建了新快照，false 表示内容无变化跳过
#[tauri::command]
pub async fn db_snapshot_with_message(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    message: String,
) -> Result<bool, String> {
    let project_id = parse_snapshot_project_id(project_id)?;
    let db = open_snapshot_db(state.inner(), project_id.as_ref()).await?;
    match db.snapshot_with_message(&message).await {
        Ok(()) => Ok(true),
        Err(WorldflowError::NoChanges) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// 获取当前活动分支
#[tauri::command]
pub async fn db_get_active_branch(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
) -> Result<String, String> {
    let project_id = parse_snapshot_project_id(project_id)?;
    let db = open_snapshot_db(state.inner(), project_id.as_ref()).await?;
    db.active_branch().await.map_err(|e| e.to_string())
}

/// 列出所有本地分支
#[tauri::command]
pub async fn db_list_branches(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
) -> Result<Vec<SnapshotBranchInfoDto>, String> {
    let project_id = parse_snapshot_project_id(project_id)?;
    let db = open_snapshot_db(state.inner(), project_id.as_ref()).await?;
    db.list_branches()
        .await
        .map(|list| list.into_iter().map(SnapshotBranchInfoDto::from).collect())
        .map_err(|e| e.to_string())
}

/// 创建分支。未传 from_ref 时，默认从当前活动分支分出
#[tauri::command]
pub async fn db_create_branch(
    state: State<'_, Arc<AppState>>,
    branch_name: String,
    from_ref: Option<String>,
    project_id: Option<String>,
) -> Result<(), String> {
    let project_id = parse_snapshot_project_id(project_id)?;
    let db = open_snapshot_db(state.inner(), project_id.as_ref()).await?;
    db.create_branch(&branch_name, from_ref.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// 切换活动分支，并把数据库恢复到目标分支 tip
#[tauri::command]
pub async fn db_switch_branch(
    state: State<'_, Arc<AppState>>,
    branch_name: String,
    project_id: Option<String>,
) -> Result<SnapshotRestoreReportDto, String> {
    let project_id = parse_snapshot_project_id(project_id)?;
    let db = open_snapshot_db(state.inner(), project_id.as_ref()).await?;
    db.switch_branch(&branch_name)
        .await
        .map(SnapshotRestoreReportDto::from)
        .map_err(|e| e.to_string())
}

/// 列出所有历史快照，最新的在 index 0
#[tauri::command]
pub async fn db_list_snapshots(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
) -> Result<Vec<SnapshotInfoDto>, String> {
    let project_id = parse_snapshot_project_id(project_id)?;
    let db = open_snapshot_db(state.inner(), project_id.as_ref()).await?;
    db.list_snapshots()
        .await
        .map(|list| list.into_iter().map(SnapshotInfoDto::from).collect())
        .map_err(|e| e.to_string())
}

/// 查看指定分支的历史快照
#[tauri::command]
pub async fn db_list_snapshots_in_branch(
    state: State<'_, Arc<AppState>>,
    branch_name: String,
    project_id: Option<String>,
) -> Result<Vec<SnapshotInfoDto>, String> {
    let project_id = parse_snapshot_project_id(project_id)?;
    let db = open_snapshot_db(state.inner(), project_id.as_ref()).await?;
    db.list_snapshots_in_branch(&branch_name)
        .await
        .map(|list| list.into_iter().map(SnapshotInfoDto::from).collect())
        .map_err(|e| e.to_string())
}

/// 获取快照提交图，用于树状版本视图
#[tauri::command]
pub async fn db_get_snapshot_graph(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, PathsState>,
    project_id: Option<String>,
) -> Result<SnapshotGraphDto, String> {
    let project_id = parse_snapshot_project_id(project_id)?;
    let db = open_snapshot_db(state.inner(), project_id.as_ref()).await?;
    let active_branch = db.active_branch().await.map_err(|e| e.to_string())?;
    let repo_dir = snapshot_repo_dir_for_project(state.inner(), &paths, project_id.as_ref())?;
    load_snapshot_graph(&repo_dir, &active_branch)
}

/// 直接把当前数据库状态提交到指定分支
/// 返回 true 表示创建了新快照，false 表示内容无变化跳过
#[tauri::command]
pub async fn db_snapshot_to_branch(
    state: State<'_, Arc<AppState>>,
    branch_name: String,
    message: String,
    project_id: Option<String>,
) -> Result<bool, String> {
    let project_id = parse_snapshot_project_id(project_id)?;
    let db = open_snapshot_db(state.inner(), project_id.as_ref()).await?;
    match db.snapshot_to_branch(&branch_name, &message).await {
        Ok(()) => Ok(true),
        Err(WorldflowError::NoChanges) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// 回退到指定快照（要求当前数据库已提交快照，并把当前分支重置到目标提交）
#[tauri::command]
pub async fn db_rollback_to(
    state: State<'_, Arc<AppState>>,
    snapshot_id: String,
    project_id: Option<String>,
) -> Result<SnapshotRestoreReportDto, String> {
    let project_id = parse_snapshot_project_id(project_id)?;
    let db = open_snapshot_db(state.inner(), project_id.as_ref()).await?;
    db.rollback_to(&snapshot_id)
        .await
        .map(SnapshotRestoreReportDto::from)
        .map_err(|e| e.to_string())
}

/// 追加恢复：把历史快照里有、当前 DB 没有的记录补回来（非破坏性）
#[tauri::command]
pub async fn db_append_from(
    state: State<'_, Arc<AppState>>,
    snapshot_id: String,
    project_id: Option<String>,
) -> Result<AppendResultDto, String> {
    let project_id = parse_snapshot_project_id(project_id)?;
    let db = open_snapshot_db(state.inner(), project_id.as_ref()).await?;
    db.append_from(&snapshot_id)
        .await
        .map(AppendResultDto::from)
        .map_err(|e| e.to_string())
}
