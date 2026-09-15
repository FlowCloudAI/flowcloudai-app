pub(super) use crate::{AppState, NetworkState, PathsState};
pub(super) use serde::Serialize;
pub(super) use serde_json::Value;
pub(super) use std::collections::BTreeSet;
pub(super) use std::env;
pub(super) use std::path::{Path, PathBuf};
pub(super) use std::sync::Arc;
pub(super) use tauri::{AppHandle, State, Window};
pub(super) use tauri_plugin_opener::OpenerExt;
pub(super) use uuid::Uuid;
#[cfg(not(target_os = "android"))]
pub(super) use worldflow_core::WorldflowError;
pub(super) use worldflow_core::{
    CategoryOps, CsvImportBundle, CsvImportMode, EntryLinkOps, EntryOps, EntryRelationOps,
    EntryTypeOps, IdeaNoteOps, ProjectOps, ProjectSettingOps, SqliteDb, TagSchemaOps, models::*,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TimelineTagRole {
    Start,
    End,
    Parent,
    Show,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTimelineEvent {
    pub id: String,
    pub title: String,
    pub start_time: i32,
    pub end_time: Option<i32>,
    pub description: Option<String>,
    pub parent_id: Option<String>,
    pub entry_type: Option<String>,
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTimelineData {
    pub events: Vec<ProjectTimelineEvent>,
    pub year_start: Option<i32>,
    pub year_end: Option<i32>,
    pub scanned_entry_count: usize,
    pub matched_entry_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntryTypeStat {
    pub entry_type: Option<String>,
    pub count: usize,
    pub word_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCategoryStat {
    pub category_id: Option<String>,
    pub count: usize,
    pub word_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGovernanceCheck {
    pub label: String,
    pub passed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGovernanceDimension {
    pub key: String,
    pub label: String,
    pub score: usize,
    pub weight: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGovernanceScore {
    pub score: usize,
    pub checks: Vec<ProjectGovernanceCheck>,
    pub dimensions: Vec<ProjectGovernanceDimension>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    pub entry_count: usize,
    pub image_count: usize,
    pub word_count: usize,
    pub relation_count: usize,
    pub internal_link_count: usize,
    pub entries_by_type: Vec<ProjectEntryTypeStat>,
    pub entries_by_category: Vec<ProjectCategoryStat>,
    pub uncategorized_entry_count: usize,
    pub empty_content_entry_count: usize,
    pub short_content_entry_count: usize,
    pub missing_summary_entry_count: usize,
    pub isolated_entry_count: usize,
    pub created_last_7_days: usize,
    pub updated_last_7_days: usize,
    pub governance_score: ProjectGovernanceScore,
}

pub(super) fn normalize_timeline_tag_name(name: &str) -> String {
    name.trim()
        .chars()
        .filter(|ch| !matches!(ch, ' ' | '\t' | '\r' | '\n' | '_' | '-'))
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

pub(super) fn timeline_tag_role_from_name(name: &str) -> Option<TimelineTagRole> {
    match normalize_timeline_tag_name(name).as_str() {
        "start" | "startyear" | "starttime" | "year" | "年份" | "开始" | "开始年" | "开始年份"
        | "开始时间" | "起始" | "起始年" | "起始年份" | "起始时间" => {
            Some(TimelineTagRole::Start)
        }
        "end" | "endyear" | "endtime" | "结束" | "结束年" | "结束年份" | "结束时间" | "终止"
        | "终止年" | "终止年份" | "终止时间" => Some(TimelineTagRole::End),
        "parent" | "parentid" | "父事件" | "父级事件" | "父事件id" | "父级事件id" | "上级事件"
        | "上级事件id" => Some(TimelineTagRole::Parent),
        "timeline" | "ontimeline" | "showtimeline" | "时间线" | "纳入时间线" | "显示在时间线"
        | "显示时间线" => Some(TimelineTagRole::Show),
        _ => None,
    }
}

pub(super) fn parse_timeline_year_from_str(raw: &str) -> Option<i32> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(value) = trimmed.parse::<i32>() {
        return Some(value);
    }

    let normalized = trimmed.replace(' ', "").to_lowercase();
    let negative = normalized.contains("公元前")
        || normalized.contains("前")
        || normalized.contains("bc")
        || normalized.contains("bce");

    let digits = normalized
        .chars()
        .filter(|ch| ch.is_ascii_digit() || *ch == '-')
        .collect::<String>();

    if digits.is_empty() {
        return None;
    }

    let parsed = digits.parse::<i32>().ok()?;
    if negative && parsed > 0 {
        Some(-parsed)
    } else {
        Some(parsed)
    }
}

pub(super) fn parse_timeline_year(value: &Value) -> Option<i32> {
    match value {
        Value::Number(number) => number.as_i64().and_then(|value| i32::try_from(value).ok()),
        Value::String(text) => parse_timeline_year_from_str(text),
        _ => None,
    }
}

pub(super) fn parse_timeline_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(flag) => Some(*flag),
        Value::Number(number) => number.as_i64().map(|value| value != 0),
        Value::String(text) => match text.trim().to_lowercase().as_str() {
            "true" | "1" | "yes" | "y" | "on" | "是" | "显示" | "加入" => Some(true),
            "false" | "0" | "no" | "n" | "off" | "否" | "隐藏" | "移除" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

pub(super) fn parse_timeline_parent(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

// ============ 日志与窗口 ============

/// 前端日志桥接，将日志写入后端日志系统

pub(super) async fn touch_project_updated_at(
    db: &SqliteDb,
    project_id: &Uuid,
) -> Result<(), String> {
    db.update_project(
        project_id,
        UpdateProject {
            name: None,
            description: None,
            cover_image: None,
        },
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub(super) async fn ensure_project_world(
    state: &AppState,
    source_db: &SqliteDb,
    project: &Project,
) -> Result<(), String> {
    if let Ok(world_db) = state.world_store.open_world(project.id).await {
        if world_db.get_project(&project.id).await.is_ok() {
            return Ok(());
        }
    }
    sync_project_to_world(state, source_db, project).await
}

pub(crate) async fn open_project_db(
    state: &AppState,
    project_id: &Uuid,
) -> Result<SqliteDb, String> {
    if let Ok(world_db) = state.world_store.open_world(*project_id).await {
        if world_db.get_project(project_id).await.is_ok() {
            return Ok(world_db);
        }
    }

    let source_db = state.sqlite_db.lock().await.clone();
    let project = source_db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    sync_project_to_world(state, &source_db, &project).await?;
    state
        .world_store
        .open_world(*project_id)
        .await
        .map_err(|e| e.to_string())
}

pub(crate) async fn open_entry_db(
    state: &AppState,
    entry_id: &Uuid,
    project_id: Option<&Uuid>,
) -> Result<SqliteDb, String> {
    if let Some(project_id) = project_id {
        return open_project_db(state, project_id).await;
    }

    for world in state
        .world_store
        .list_worlds()
        .await
        .map_err(|e| e.to_string())?
    {
        let Ok(db) = state.world_store.open_world(world.id).await else {
            continue;
        };
        if db.get_entry(entry_id).await.is_ok() {
            return Ok(db);
        }
    }

    let source_db = state.sqlite_db.lock().await.clone();
    let entry = source_db
        .get_entry(entry_id)
        .await
        .map_err(|e| e.to_string())?;
    let project = source_db
        .get_project(&entry.project_id)
        .await
        .map_err(|e| e.to_string())?;
    sync_project_to_world(state, &source_db, &project).await?;
    open_project_db(state, &entry.project_id).await
}

pub(crate) async fn open_category_db(
    state: &AppState,
    category_id: &Uuid,
    project_id: Option<&Uuid>,
) -> Result<SqliteDb, String> {
    if let Some(project_id) = project_id {
        return open_project_db(state, project_id).await;
    }

    for world in state
        .world_store
        .list_worlds()
        .await
        .map_err(|e| e.to_string())?
    {
        let Ok(db) = state.world_store.open_world(world.id).await else {
            continue;
        };
        if db.get_category(category_id).await.is_ok() {
            return Ok(db);
        }
    }

    let source_db = state.sqlite_db.lock().await.clone();
    let category = source_db
        .get_category(category_id)
        .await
        .map_err(|e| e.to_string())?;
    let project = source_db
        .get_project(&category.project_id)
        .await
        .map_err(|e| e.to_string())?;
    sync_project_to_world(state, &source_db, &project).await?;
    open_project_db(state, &category.project_id).await
}

pub(crate) async fn open_relation_db(
    state: &AppState,
    relation_id: &Uuid,
    project_id: Option<&Uuid>,
) -> Result<SqliteDb, String> {
    if let Some(project_id) = project_id {
        return open_project_db(state, project_id).await;
    }

    for world in state
        .world_store
        .list_worlds()
        .await
        .map_err(|e| e.to_string())?
    {
        let Ok(db) = state.world_store.open_world(world.id).await else {
            continue;
        };
        if db.get_relation(relation_id).await.is_ok() {
            return Ok(db);
        }
    }

    let source_db = state.sqlite_db.lock().await.clone();
    let relation = source_db
        .get_relation(relation_id)
        .await
        .map_err(|e| e.to_string())?;
    let project = source_db
        .get_project(&relation.project_id)
        .await
        .map_err(|e| e.to_string())?;
    sync_project_to_world(state, &source_db, &project).await?;
    open_project_db(state, &relation.project_id).await
}

async fn ensure_world_record(state: &AppState, project: &Project) -> Result<(), String> {
    if state.world_store.get_world(project.id).await.is_ok() {
        state
            .world_store
            .rename_world(project.id, project.name.clone())
            .await
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    state
        .world_store
        .create_world_with_id(project.id, project.name.clone())
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub(super) async fn sync_project_to_world(
    state: &AppState,
    source_db: &SqliteDb,
    project: &Project,
) -> Result<(), String> {
    ensure_world_record(state, project).await?;
    let world_db = state
        .world_store
        .open_world(project.id)
        .await
        .map_err(|e| e.to_string())?;
    let export = source_db
        .export_project_csvs(project.id)
        .await
        .map_err(|e| e.to_string())?;
    world_db
        .import_csvs(
            CsvImportBundle::from_export_items(export.items),
            CsvImportMode::Replace,
        )
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}
