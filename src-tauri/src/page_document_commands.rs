//! 页面文档 Tauri 命令：选择目标世界库，执行独立校验，再把派生结果交给 core 存储。
use crate::{
    ApiError, AppState,
    apis::worldflow::common::{open_entry_db, open_project_db},
    document_validation, page_document_assets,
};
use flowcloudai_client::ErrorCode;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashSet;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;
use worldflow_core::models::{
    CreateComponentDefinition, PageDocument, PageDocumentProjection, PageTextBlock,
    ProjectHomeDocument, SaveEntryLinkTarget, SavePageDocumentResult,
};
use worldflow_core::{ComponentOps, PageDocumentOps, WorldflowError};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveInput {
    pub entry_id: String,
    pub project_id: String,
    pub html: String,
    pub css: String,
    pub expected_revision: Option<i64>,
    pub request_key: String,
    pub modified_by: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentPropertySchemaInput {
    pub name: String,
    pub value_type: String,
    pub required: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentPartSchemaInput {
    pub name: String,
    pub accepts: Vec<String>,
    pub required: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentStyleVariableSchemaInput {
    pub name: String,
    pub syntax: String,
    pub initial_value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveComponentInput {
    pub project_id: String,
    pub component_id: String,
    pub expected_revision: Option<i64>,
    pub html: String,
    pub css: String,
    pub property_schema: Vec<ComponentPropertySchemaInput>,
    pub part_schema: Vec<ComponentPartSchemaInput>,
    pub style_variable_schema: Vec<ComponentStyleVariableSchemaInput>,
    pub name: String,
    pub category: String,
    pub preview_asset_id: Option<String>,
}

#[tauri::command]
pub async fn page_document_read_entry(
    state: State<'_, Arc<AppState>>,
    entry_id: String,
) -> Result<Option<PageDocument>, ApiError> {
    let entry_id = parse_uuid("entryId", &entry_id)?;
    read_entry(state.inner(), &entry_id).await
}

/// 读取当前项目的公共组件最新修订；定义本身只在宿主侧进入编译快照。
#[tauri::command]
pub async fn page_document_list_components(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<worldflow_core::models::ComponentDefinition>, ApiError> {
    let project_id = parse_uuid("projectId", &project_id)?;
    let db = open_project_db(state.inner(), &project_id)
        .await
        .map_err(ApiError::internal)?;
    db.list_component_definitions(&project_id)
        .await
        .map_err(ApiError::from_display)
}

/// 读取项目范围内全部组件修订；固定修订实例也必须能在预览中解析。
#[tauri::command]
pub async fn page_document_list_component_revisions(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<worldflow_core::models::ComponentDefinition>, ApiError> {
    let project_id = parse_uuid("projectId", &project_id)?;
    let db = open_project_db(state.inner(), &project_id)
        .await
        .map_err(ApiError::internal)?;
    db.list_component_definition_revisions(&project_id)
        .await
        .map_err(ApiError::from_display)
}

#[tauri::command]
pub async fn page_document_create_component(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, crate::PathsState>,
    input: SaveComponentInput,
) -> Result<worldflow_core::models::ComponentDefinition, ApiError> {
    if input.expected_revision.is_some() {
        return Err(ApiError::new(
            ErrorCode::ValidationFormatError,
            "新建公共组件不能携带基准修订",
        ));
    }
    create_component_definition(state.inner(), paths.inner(), &input).await
}

#[tauri::command]
pub async fn page_document_update_component(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, crate::PathsState>,
    input: SaveComponentInput,
) -> Result<worldflow_core::models::ComponentDefinition, ApiError> {
    if !input.expected_revision.is_some_and(|revision| revision > 0) {
        return Err(ApiError::new(
            ErrorCode::ValidationFormatError,
            "编辑公共组件必须携带正整数基准修订",
        ));
    }
    create_component_definition(state.inner(), paths.inner(), &input).await
}

#[tauri::command]
pub async fn page_document_component_impact(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    component_id: String,
) -> Result<worldflow_core::models::ComponentImpact, ApiError> {
    let project_id = parse_uuid("projectId", &project_id)?;
    let component_id = parse_uuid("componentId", &component_id)?;
    let db = open_project_db(state.inner(), &project_id)
        .await
        .map_err(ApiError::internal)?;
    if db
        .get_component_definition(&project_id, &component_id, None)
        .await
        .map_err(ApiError::from_display)?
        .is_none()
    {
        return Err(ApiError::new(
            ErrorCode::ValidationFormatError,
            "当前项目不存在该公共组件定义",
        ));
    }
    db.get_component_impact(&component_id)
        .await
        .map_err(ApiError::from_display)
}

#[tauri::command]
pub async fn page_document_delete_component(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    component_id: String,
) -> Result<(), ApiError> {
    let project_id = parse_uuid("projectId", &project_id)?;
    let component_id = parse_uuid("componentId", &component_id)?;
    delete_component_definition(state.inner(), &project_id, &component_id).await
}

fn schema_name(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes.next().is_some_and(|byte| byte.is_ascii_lowercase())
        && value.len() <= 64
        && bytes.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

pub(crate) fn validate_component_definition_metadata(
    name: &str,
    category: &str,
    property_schema: &[ComponentPropertySchemaInput],
    part_schema: &[ComponentPartSchemaInput],
    style_variable_schema: &[ComponentStyleVariableSchemaInput],
) -> Result<(), ApiError> {
    if name.trim().is_empty()
        || name.trim().len() > 128
        || category.trim().is_empty()
        || category.trim().len() > 128
    {
        return Err(ApiError::new(
            ErrorCode::ValidationFormatError,
            "公共组件名称与分类必须是 1–128 字符",
        ));
    }
    let mut names = HashSet::new();
    for property in property_schema {
        if !schema_name(&property.name)
            || !schema_name(&property.value_type)
            || !names.insert(property.name.as_str())
        {
            return Err(ApiError::new(
                ErrorCode::ValidationFormatError,
                "组件属性 schema 名称、类型或唯一性无效",
            ));
        }
    }
    names.clear();
    for part in part_schema {
        let mut accepts = HashSet::new();
        if !schema_name(&part.name)
            || !names.insert(part.name.as_str())
            || part.accepts.is_empty()
            || part
                .accepts
                .iter()
                .any(|item| !schema_name(item) || !accepts.insert(item.as_str()))
        {
            return Err(ApiError::new(
                ErrorCode::ValidationFormatError,
                "组件插槽 schema 名称、内容类型或唯一性无效",
            ));
        }
    }
    names.clear();
    for variable in style_variable_schema {
        let suffix = variable.name.strip_prefix("--").unwrap_or_default();
        if !schema_name(suffix)
            || !names.insert(variable.name.as_str())
            || variable.syntax.len() > 128
            || variable
                .initial_value
                .as_ref()
                .is_some_and(|value| value.len() > 128)
        {
            return Err(ApiError::new(
                ErrorCode::ValidationFormatError,
                "组件样式变量 schema 无效",
            ));
        }
    }
    Ok(())
}

fn validate_component_schema(input: &SaveComponentInput) -> Result<(), ApiError> {
    validate_component_definition_metadata(
        &input.name,
        &input.category,
        &input.property_schema,
        &input.part_schema,
        &input.style_variable_schema,
    )
}

async fn create_component_definition(
    state: &AppState,
    paths: &crate::PathsState,
    input: &SaveComponentInput,
) -> Result<worldflow_core::models::ComponentDefinition, ApiError> {
    validate_component_schema(input)?;
    let project_id = parse_uuid("projectId", &input.project_id)?;
    let component_id = parse_uuid("componentId", &input.component_id)?;
    let validation = document_validation::validate_component_definition(
        &input.html,
        &input.css,
        Some(&input.project_id),
    );
    require_valid_component(&validation)?;
    let db = open_project_db(state, &project_id)
        .await
        .map_err(ApiError::internal)?;
    for asset_id in &validation.asset_ids {
        page_document_assets::require_asset(&db, paths, &project_id, asset_id).await?;
    }
    let preview_asset_id = input
        .preview_asset_id
        .as_deref()
        .map(|value| parse_uuid("previewAssetId", value))
        .transpose()?;
    if let Some(asset_id) = preview_asset_id {
        page_document_assets::require_asset(&db, paths, &project_id, &asset_id).await?;
    }
    let property_schema = serde_json::Value::Array(
        input
            .property_schema
            .iter()
            .map(|item| {
                serde_json::json!({
                    "name": item.name,
                    "valueType": item.value_type,
                    "required": item.required,
                })
            })
            .collect(),
    );
    let part_schema = serde_json::Value::Array(
        input
            .part_schema
            .iter()
            .map(|item| {
                serde_json::json!({
                    "name": item.name,
                    "accepts": item.accepts,
                    "required": item.required,
                })
            })
            .collect(),
    );
    let style_variable_schema = serde_json::Value::Array(
        input
            .style_variable_schema
            .iter()
            .map(|item| {
                serde_json::json!({
                    "name": item.name,
                    "syntax": item.syntax,
                    "initialValue": item.initial_value,
                })
            })
            .collect(),
    );
    db.create_component_definition(CreateComponentDefinition {
        component_id,
        scope_kind: "project".into(),
        scope_id: project_id,
        html: input.html.clone(),
        css: input.css.clone(),
        property_schema,
        part_schema,
        style_variable_schema,
        asset_dependencies: validation.asset_ids,
        name: input.name.trim().to_string(),
        category: input.category.trim().to_string(),
        preview_asset_id,
        expected_revision: input.expected_revision,
    })
    .await
    .map_err(map_component_save_error)
}

async fn delete_component_definition(
    state: &AppState,
    project_id: &Uuid,
    component_id: &Uuid,
) -> Result<(), ApiError> {
    let db = open_project_db(state, project_id)
        .await
        .map_err(ApiError::internal)?;
    if db
        .get_component_definition(project_id, component_id, None)
        .await
        .map_err(ApiError::from_display)?
        .is_none()
    {
        return Err(ApiError::new(
            ErrorCode::ValidationFormatError,
            "当前项目不存在该公共组件定义",
        ));
    }
    // 删除者由本地主机确定，前端不能伪造审计主体。
    db.delete_component_definition(component_id, "local")
        .await
        .map_err(ApiError::from_display)
}

#[tauri::command]
pub async fn page_document_save_entry(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, crate::PathsState>,
    input: SaveInput,
) -> Result<SavePageDocumentResult<PageDocument>, ApiError> {
    save_entry(state.inner(), paths.inner(), &input).await
}

#[tauri::command]
pub fn page_document_validate(
    html: String,
    css: String,
    project_id: Option<String>,
) -> document_validation::ValidationResult {
    document_validation::validate(&html, &css, project_id.as_deref())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionRebuildReport {
    pub rebuilt: usize,
    pub skipped_count: usize,
    pub skipped: Vec<String>,
}

/// 显式重建旧页面派生数据；失败对象保留原源码和旧纯文本检索兜底。
#[tauri::command]
pub async fn page_document_rebuild_projection(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, crate::PathsState>,
    project_id: String,
) -> Result<ProjectionRebuildReport, ApiError> {
    let project_id = parse_uuid("projectId", &project_id)?;
    rebuild_projection(state.inner(), paths.inner(), project_id).await
}

async fn rebuild_projection(
    state: &AppState,
    paths: &crate::PathsState,
    project_id: Uuid,
) -> Result<ProjectionRebuildReport, ApiError> {
    let db = open_project_db(state, &project_id)
        .await
        .map_err(ApiError::internal)?;
    let rows = sqlx::query(
        "SELECT d.entry_id FROM entry_page_documents d WHERE d.project_id=?
        AND NOT EXISTS(SELECT 1 FROM object_text_blocks b WHERE b.object_id=d.entry_id)
        AND NOT EXISTS(
            SELECT 1 FROM object_changes c
            WHERE c.object_id=d.entry_id
              AND c.revision=d.revision
              AND c.change_type='projection-rebuild'
              AND c.source='page-document'
        )",
    )
    .bind(project_id)
    .fetch_all(&db.pool)
    .await
    .map_err(ApiError::from_display)?;
    let mut report = ProjectionRebuildReport {
        rebuilt: 0,
        skipped_count: 0,
        skipped: Vec::new(),
    };
    for row in rows {
        let entry_id: Uuid = row.try_get("entry_id").map_err(ApiError::from_display)?;
        let Some(document) = db
            .get_entry_page_document(&entry_id)
            .await
            .map_err(ApiError::from_display)?
        else {
            continue;
        };
        let validation = document_validation::validate(
            &document.html,
            &document.css,
            Some(&project_id.to_string()),
        );
        if !validation.valid {
            report
                .skipped
                .push(format!("词条 {entry_id}：源码未通过当前校验"));
            continue;
        }
        let mut asset_error = false;
        for asset_id in &validation.asset_ids {
            if page_document_assets::require_asset(&db, paths, &project_id, asset_id)
                .await
                .is_err()
            {
                asset_error = true;
                break;
            }
        }
        if asset_error {
            report
                .skipped
                .push(format!("词条 {entry_id}：页面资产缺失或不可读取"));
            continue;
        }
        if let Err(error) = db
            .rebuild_page_document_projection(
                &project_id,
                &entry_id,
                document.revision,
                &validation.derived_text,
                &projection_from_validation(&validation),
            )
            .await
        {
            report.skipped.push(format!("词条 {entry_id}：{error}"));
        } else {
            if let Err(error) =
                mark_projection_rebuilt(&db.pool, &entry_id, "entry", document.revision).await
            {
                report
                    .skipped
                    .push(format!("词条 {entry_id}：无法记录投影重建水位：{error}"));
            } else {
                report.rebuilt += 1;
            }
        }
    }
    let home_missing_blocks: bool = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM project_home_documents d WHERE d.project_id=?
         AND NOT EXISTS(SELECT 1 FROM object_text_blocks b WHERE b.object_id=d.object_id)
         AND NOT EXISTS(
             SELECT 1 FROM object_changes c
             WHERE c.object_id=d.object_id
               AND c.revision=d.revision
               AND c.change_type='projection-rebuild'
               AND c.source='page-document'
         )",
    )
    .bind(project_id)
    .fetch_one(&db.pool)
    .await
    .map_err(ApiError::from_display)?
        > 0;
    if let Some(document) = db
        .get_project_home_document(&project_id)
        .await
        .map_err(ApiError::from_display)?
        .filter(|_| home_missing_blocks)
    {
        let object_id: Uuid =
            sqlx::query_scalar("SELECT object_id FROM project_home_documents WHERE project_id=?")
                .bind(project_id)
                .fetch_one(&db.pool)
                .await
                .map_err(ApiError::from_display)?;
        let validation = document_validation::validate(
            &document.html,
            &document.css,
            Some(&project_id.to_string()),
        );
        let mut valid = validation.valid;
        if valid {
            for asset_id in &validation.asset_ids {
                if page_document_assets::require_asset(&db, paths, &project_id, asset_id)
                    .await
                    .is_err()
                {
                    valid = false;
                    break;
                }
            }
        }
        if !valid {
            report
                .skipped
                .push(format!("项目首页 {project_id}：校验或资产读取失败"));
        } else if let Err(error) = db
            .rebuild_page_document_projection(
                &project_id,
                &object_id,
                document.revision,
                &validation.derived_text,
                &projection_from_validation(&validation),
            )
            .await
        {
            report
                .skipped
                .push(format!("项目首页 {project_id}：{error}"));
        } else {
            if let Err(error) =
                mark_projection_rebuilt(&db.pool, &object_id, "project_home", document.revision)
                    .await
            {
                report.skipped.push(format!(
                    "项目首页 {project_id}：无法记录投影重建水位：{error}"
                ));
            } else {
                report.rebuilt += 1;
            }
        }
    }
    report.skipped_count = report.skipped.len();
    Ok(report)
}

async fn mark_projection_rebuilt(
    pool: &sqlx::SqlitePool,
    object_id: &Uuid,
    kind: &str,
    revision: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO object_changes(object_id,kind,revision,change_type,actor,source)
         VALUES(?,?,?,'projection-rebuild','local','page-document')",
    )
    .bind(object_id)
    .bind(kind)
    .bind(revision)
    .execute(pool)
    .await
    .map(|_| ())
}

#[tauri::command]
pub async fn page_document_read_project_home(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Option<ProjectHomeDocument>, ApiError> {
    let project_id = parse_uuid("projectId", &project_id)?;
    read_project_home(state.inner(), &project_id).await
}

#[tauri::command]
pub async fn page_document_save_project_home(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, crate::PathsState>,
    project_id: String,
    html: String,
    css: String,
    expected_revision: Option<i64>,
    request_key: String,
    modified_by: Option<String>,
) -> Result<SavePageDocumentResult<ProjectHomeDocument>, ApiError> {
    let project_id = parse_uuid("projectId", &project_id)?;
    save_project_home(
        state.inner(),
        paths.inner(),
        &project_id,
        &html,
        &css,
        expected_revision,
        &request_key,
        modified_by.as_deref(),
    )
    .await
}

async fn save_project_home(
    state: &AppState,
    paths: &crate::PathsState,
    project_id: &Uuid,
    html: &str,
    css: &str,
    expected_revision: Option<i64>,
    request_key: &str,
    modified_by: Option<&str>,
) -> Result<SavePageDocumentResult<ProjectHomeDocument>, ApiError> {
    let validation = document_validation::validate(&html, &css, Some(&project_id.to_string()));
    require_valid(&validation)?;
    let db = open_project_db(state, project_id)
        .await
        .map_err(ApiError::internal)?;
    for id in &validation.asset_ids {
        page_document_assets::require_asset(&db, paths, project_id, id).await?;
    }
    db.save_project_home_document(
        project_id,
        html,
        css,
        &validation.derived_text,
        &projection_from_validation(&validation),
        expected_revision,
        request_key,
        modified_by.unwrap_or("local"),
    )
    .await
    .map_err(|error| map_save_error(error, "项目首页"))
}

async fn read_entry(state: &AppState, entry_id: &Uuid) -> Result<Option<PageDocument>, ApiError> {
    let db = open_entry_db(state, entry_id, None)
        .await
        .map_err(ApiError::internal)?;
    db.get_entry_page_document(entry_id)
        .await
        .map_err(ApiError::from_display)
}

async fn save_entry(
    state: &AppState,
    paths: &crate::PathsState,
    input: &SaveInput,
) -> Result<SavePageDocumentResult<PageDocument>, ApiError> {
    let entry_id = parse_uuid("entryId", &input.entry_id)?;
    let project_id = parse_uuid("projectId", &input.project_id)?;
    let validation =
        document_validation::validate(&input.html, &input.css, Some(&input.project_id));
    require_valid(&validation)?;
    let link_targets = validation
        .link_targets
        .iter()
        .map(|target| SaveEntryLinkTarget {
            entry_id: target.entry_id,
            title: target.title.clone(),
        })
        .collect::<Vec<_>>();
    let db = open_entry_db(state, &entry_id, Some(&project_id))
        .await
        .map_err(ApiError::internal)?;
    for id in &validation.asset_ids {
        page_document_assets::require_asset(&db, paths, &project_id, id).await?;
    }
    db.save_entry_page_document(
        &entry_id,
        &project_id,
        &input.html,
        &input.css,
        &validation.derived_text,
        &link_targets,
        &projection_from_validation(&validation),
        input.expected_revision,
        &input.request_key,
        input.modified_by.as_deref().unwrap_or("local"),
    )
    .await
    .map_err(|error| map_save_error(error, "词条页面"))
}

fn projection_from_validation(
    validation: &document_validation::ValidationResult,
) -> PageDocumentProjection {
    PageDocumentProjection {
        text_blocks: validation
            .text_blocks
            .iter()
            .map(|block| PageTextBlock {
                node_id: block.node_id,
                text: block.text.clone(),
            })
            .collect(),
        asset_ids: validation.asset_ids.clone(),
        component_references: validation
            .component_references
            .iter()
            .map(|reference| worldflow_core::models::PageComponentReference {
                node_id: reference.node_id,
                component_id: reference.component_id,
                follows_latest: reference.follows_latest,
            })
            .collect(),
    }
}

async fn read_project_home(
    state: &AppState,
    project_id: &Uuid,
) -> Result<Option<ProjectHomeDocument>, ApiError> {
    let db = open_project_db(state, project_id)
        .await
        .map_err(ApiError::internal)?;
    db.get_project_home_document(project_id)
        .await
        .map_err(ApiError::from_display)
}

fn parse_uuid(field: &str, value: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(value).map_err(|error| {
        ApiError::new(
            ErrorCode::ValidationFormatError,
            format!("{field} 不是合法 UUID"),
        )
        .with_kv("field", field)
        .with_kv("reason", error.to_string())
    })
}

fn require_valid(result: &document_validation::ValidationResult) -> Result<(), ApiError> {
    if result.valid {
        return Ok(());
    }
    let diagnostics = serde_json::to_value(&result.diagnostics).unwrap_or_default();
    Err(
        ApiError::new(ErrorCode::ValidationFormatError, "页面文档校验失败")
            .with_kv("diagnostics", diagnostics),
    )
}

fn require_valid_component(result: &document_validation::ValidationResult) -> Result<(), ApiError> {
    if result.valid {
        return Ok(());
    }
    let diagnostics = serde_json::to_value(&result.diagnostics).unwrap_or_default();
    Err(
        ApiError::new(ErrorCode::ValidationFormatError, "公共组件定义校验失败")
            .with_kv("diagnostics", diagnostics),
    )
}

fn map_save_error(error: WorldflowError, target: &str) -> ApiError {
    match error {
        WorldflowError::DocumentRevisionConflict { current_revision } => ApiError::new(
            ErrorCode::DocumentRevisionConflict,
            format!("{target} revision 冲突"),
        )
        .with_kv("currentRevision", serde_json::json!(current_revision)),
        other => ApiError::from_display(other),
    }
}

fn map_component_save_error(error: WorldflowError) -> ApiError {
    match error {
        WorldflowError::ComponentRevisionConflict { current_revision } => ApiError::new(
            ErrorCode::DocumentRevisionConflict,
            "公共组件 revision 已变化，请重新打开编辑",
        )
        .with_kv("currentRevision", serde_json::json!(current_revision)),
        other => ApiError::from_display(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tempfile::tempdir;
    use tokio::sync::Mutex;
    use worldflow_core::{EntryLinkOps, EntryOps, SqliteDb, WorldStore};

    struct Fixture {
        _dir: tempfile::TempDir,
        state: AppState,
        paths: crate::PathsState,
        project_id: Uuid,
        other_project_id: Uuid,
        entry_id: Uuid,
    }

    async fn setup() -> Fixture {
        let dir = tempdir().unwrap();
        let catalog_url = format!(
            "sqlite:{}?mode=rwc",
            dir.path().join("catalog.db").display()
        );
        let catalog = SqliteDb::new(&catalog_url).await.unwrap();
        let world_store = WorldStore::open(dir.path().join("world-store"))
            .await
            .unwrap();
        let project_id = Uuid::new_v4();
        let other_project_id = Uuid::new_v4();
        let entry_id = Uuid::new_v4();

        for (id, name) in [(project_id, "目标世界"), (other_project_id, "其他世界")] {
            world_store.create_world_with_id(id, name).await.unwrap();
            let db = world_store.open_world(id).await.unwrap();
            sqlx::query("INSERT INTO projects(id,name) VALUES(?,?)")
                .bind(id)
                .bind(name)
                .execute(&db.pool)
                .await
                .unwrap();
            if id == project_id {
                sqlx::query("INSERT INTO entries(id,project_id,title,content) VALUES(?,?,?,?)")
                    .bind(entry_id)
                    .bind(project_id)
                    .bind("独立世界词条")
                    .bind("")
                    .execute(&db.pool)
                    .await
                    .unwrap();
            }
        }

        Fixture {
            paths: crate::PathsState {
                db_path: dir.path().join("catalog.db"),
                plugins_path: dir.path().join("plugins"),
            },
            _dir: dir,
            state: AppState {
                sqlite_db: Mutex::new(catalog),
                world_store,
                thumbnail_jobs: Mutex::new(HashMap::new()),
            },
            project_id,
            other_project_id,
            entry_id,
        }
    }

    fn component_input(project_id: Uuid) -> SaveComponentInput {
        SaveComponentInput {
            project_id: project_id.to_string(),
            component_id: Uuid::new_v4().to_string(),
            expected_revision: None,
            html: "<article><h2>{{title}}</h2><div data-fc-part='body'></div></article>".into(),
            css: "@layer fc-component { [data-fc-component=template] article { display: grid; } }"
                .into(),
            property_schema: vec![ComponentPropertySchemaInput {
                name: "title".into(),
                value_type: "text".into(),
                required: false,
            }],
            part_schema: vec![ComponentPartSchemaInput {
                name: "body".into(),
                accepts: vec!["text".into()],
                required: false,
            }],
            style_variable_schema: Vec::new(),
            name: "信息卡片".into(),
            category: "基础".into(),
            preview_asset_id: None,
        }
    }

    #[tokio::test]
    async fn creates_component_revision_one_and_records_real_delete_actor() {
        let fixture = setup().await;
        let created = create_component_definition(
            &fixture.state,
            &fixture.paths,
            &component_input(fixture.project_id),
        )
        .await
        .unwrap();
        assert_eq!(created.revision, 1);
        assert_eq!(created.scope_id, fixture.project_id);

        delete_component_definition(&fixture.state, &fixture.project_id, &created.component_id)
            .await
            .unwrap();
        let world = fixture
            .state
            .world_store
            .open_world(fixture.project_id)
            .await
            .unwrap();
        let deleted_by: String =
            sqlx::query_scalar("SELECT deleted_by FROM object_registry WHERE id=?")
                .bind(created.component_id)
                .fetch_one(&world.pool)
                .await
                .unwrap();
        assert_eq!(deleted_by, "local");
        assert!(
            world
                .list_component_definitions(&fixture.project_id)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn component_update_appends_revision_and_rejects_stale_baseline() {
        let fixture = setup().await;
        let initial = component_input(fixture.project_id);
        let created = create_component_definition(&fixture.state, &fixture.paths, &initial)
            .await
            .unwrap();
        let mut update = component_input(fixture.project_id);
        update.component_id = created.component_id.to_string();
        update.expected_revision = Some(created.revision);
        update.html = "<section><p>修订二</p></section>".into();
        let revised = create_component_definition(&fixture.state, &fixture.paths, &update)
            .await
            .unwrap();
        assert_eq!(revised.revision, 2);

        let mut stale = update;
        stale.html = "<section><p>过期修订</p></section>".into();
        let error = create_component_definition(&fixture.state, &fixture.paths, &stale)
            .await
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::DocumentRevisionConflict.as_str());
        assert!(error.message.contains("重新打开编辑"));
        assert_eq!(error.detail["currentRevision"], 2);
    }

    #[tokio::test]
    async fn create_component_rejects_unsafe_source_and_foreign_asset() {
        let fixture = setup().await;
        let mut unsafe_input = component_input(fixture.project_id);
        unsafe_input.html = "<article onclick='run()'>不安全</article>".into();
        assert!(
            create_component_definition(&fixture.state, &fixture.paths, &unsafe_input)
                .await
                .is_err()
        );

        let source = fixture._dir.path().join("foreign-component.png");
        image::RgbaImage::from_pixel(1, 1, image::Rgba([1, 2, 3, 255]))
            .save(&source)
            .unwrap();
        let foreign_asset = page_document_assets::import_asset(
            &fixture.state,
            &fixture.paths,
            &fixture.other_project_id,
            &source,
        )
        .await
        .unwrap();
        let mut foreign_input = component_input(fixture.project_id);
        foreign_input.html = format!("<img src='fcasset://{}'>", foreign_asset.id);
        assert!(
            create_component_definition(&fixture.state, &fixture.paths, &foreign_input)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn deleting_referenced_component_returns_domain_reason() {
        let fixture = setup().await;
        let created = create_component_definition(
            &fixture.state,
            &fixture.paths,
            &component_input(fixture.project_id),
        )
        .await
        .unwrap();
        let node_id = Uuid::new_v4();
        let instance_id = Uuid::new_v4();
        save_entry(
            &fixture.state,
            &fixture.paths,
            &SaveInput {
                entry_id: fixture.entry_id.to_string(),
                project_id: fixture.project_id.to_string(),
                html: format!(
                    "<div data-fc-node-id='{node_id}' data-fc-node-kind='component' data-fc-component='{}' data-fc-component-revision='latest' data-fc-instance='{instance_id}'></div>",
                    created.component_id
                ),
                css: String::new(),
                expected_revision: None,
                request_key: "component-delete-protection".into(),
                modified_by: None,
            },
        )
        .await
        .unwrap();

        let error =
            delete_component_definition(&fixture.state, &fixture.project_id, &created.component_id)
                .await
                .unwrap_err();
        assert!(error.message.contains("仍被页面实例引用"));
    }

    #[tokio::test]
    async fn saves_and_reads_entry_document_from_independent_world_database() {
        let fixture = setup().await;
        let input = SaveInput {
            entry_id: fixture.entry_id.to_string(),
            project_id: fixture.project_id.to_string(),
            html: "<p>独立世界正文</p>".into(),
            css: String::new(),
            expected_revision: None,
            request_key: "world-save-1".into(),
            modified_by: None,
        };
        let saved = save_entry(&fixture.state, &fixture.paths, &input)
            .await
            .unwrap();
        assert_eq!(saved.document.derived_text, "独立世界正文");

        let read = read_entry(&fixture.state, &fixture.entry_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(read.revision, 1);
        assert_eq!(read.html, input.html);

        let catalog = fixture.state.sqlite_db.lock().await.clone();
        assert!(
            catalog
                .get_entry_page_document(&fixture.entry_id)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn legacy_ai_content_write_is_rejected_after_page_document_exists() {
        let fixture = setup().await;
        save_entry(
            &fixture.state,
            &fixture.paths,
            &SaveInput {
                entry_id: fixture.entry_id.to_string(),
                project_id: fixture.project_id.to_string(),
                html: "<p>页面正文</p>".into(),
                css: String::new(),
                expected_revision: None,
                request_key: "ai-guard".into(),
                modified_by: None,
            },
        )
        .await
        .unwrap();
        assert!(
            crate::tools::ensure_legacy_content_write_allowed(
                &fixture.state,
                &fixture.entry_id.to_string(),
            )
            .await
            .unwrap_err()
            .contains("请使用页面编辑")
        );
        let error = crate::tools::update_entry_content(
            &fixture.state,
            &fixture.entry_id.to_string(),
            Some("旧正文覆盖".into()),
        )
        .await
        .unwrap_err();
        assert!(error.contains("请使用页面编辑"));
        let db = fixture
            .state
            .world_store
            .open_world(fixture.project_id)
            .await
            .unwrap();
        assert_eq!(db.get_entry(&fixture.entry_id).await.unwrap().content, "");
    }

    #[tokio::test]
    async fn legacy_ai_content_write_still_works_without_page_document() {
        let fixture = setup().await;
        crate::tools::ensure_legacy_content_write_allowed(
            &fixture.state,
            &fixture.entry_id.to_string(),
        )
        .await
        .unwrap();
        crate::tools::update_entry_content(
            &fixture.state,
            &fixture.entry_id.to_string(),
            Some("旧正文可编辑".into()),
        )
        .await
        .unwrap();
        let db = fixture
            .state
            .world_store
            .open_world(fixture.project_id)
            .await
            .unwrap();
        assert_eq!(
            db.get_entry(&fixture.entry_id).await.unwrap().content,
            "旧正文可编辑"
        );
    }

    #[tokio::test]
    async fn rejects_entry_and_project_mismatch() {
        let fixture = setup().await;
        let input = SaveInput {
            entry_id: fixture.entry_id.to_string(),
            project_id: fixture.other_project_id.to_string(),
            html: "<p>不能写入其他世界</p>".into(),
            css: String::new(),
            expected_revision: None,
            request_key: "wrong-world".into(),
            modified_by: None,
        };
        assert!(
            save_entry(&fixture.state, &fixture.paths, &input)
                .await
                .is_err()
        );

        let original_world = fixture
            .state
            .world_store
            .open_world(fixture.project_id)
            .await
            .unwrap();
        assert!(
            original_world
                .get_entry_page_document(&fixture.entry_id)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn title_link_resolves_after_target_entry_is_created_and_document_is_resaved() {
        let fixture = setup().await;
        let html =
            "<p><a href=\"entry-title://%E5%BE%85%E5%BB%BA%E8%AF%8D%E6%9D%A1\">待建词条</a></p>";
        let first = save_entry(
            &fixture.state,
            &fixture.paths,
            &SaveInput {
                entry_id: fixture.entry_id.to_string(),
                project_id: fixture.project_id.to_string(),
                html: html.into(),
                css: String::new(),
                expected_revision: None,
                request_key: "title-link-before-target".into(),
                modified_by: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(first.document.revision, 1);

        let world = fixture
            .state
            .world_store
            .open_world(fixture.project_id)
            .await
            .unwrap();
        assert!(
            world
                .list_outgoing_links(&fixture.entry_id)
                .await
                .unwrap()
                .is_empty()
        );

        let target_id = Uuid::new_v4();
        sqlx::query("INSERT INTO entries(id,project_id,title,content) VALUES(?,?,?,?)")
            .bind(target_id)
            .bind(fixture.project_id)
            .bind("待建词条")
            .bind("")
            .execute(&world.pool)
            .await
            .unwrap();

        let second = save_entry(
            &fixture.state,
            &fixture.paths,
            &SaveInput {
                entry_id: fixture.entry_id.to_string(),
                project_id: fixture.project_id.to_string(),
                html: html.into(),
                css: String::new(),
                expected_revision: Some(1),
                request_key: "title-link-after-target".into(),
                modified_by: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(second.document.revision, 2);
        let links = world.list_outgoing_links(&fixture.entry_id).await.unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].b_id, target_id);
    }

    #[tokio::test]
    async fn stale_entry_revision_returns_conflict_code_and_current_revision() {
        let fixture = setup().await;
        let input = SaveInput {
            entry_id: fixture.entry_id.to_string(),
            project_id: fixture.project_id.to_string(),
            html: "<p>第一版</p>".into(),
            css: String::new(),
            expected_revision: None,
            request_key: "entry-conflict-first".into(),
            modified_by: None,
        };
        let first = save_entry(&fixture.state, &fixture.paths, &input)
            .await
            .unwrap();
        assert_eq!(first.revision, 1);

        let error = save_entry(
            &fixture.state,
            &fixture.paths,
            &SaveInput {
                html: "<p>过期写入</p>".into(),
                expected_revision: None,
                request_key: "entry-conflict-stale".into(),
                ..input
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::DocumentRevisionConflict.as_str());
        assert_eq!(error.detail["currentRevision"], 1);
    }

    #[tokio::test]
    async fn production_save_and_rebuild_store_validated_blocks_without_revision_change() {
        let fixture = setup().await;
        let node_id = Uuid::now_v7();
        let html = format!(
            "<p data-fc-node-id='{node_id}' data-fc-node-kind='paragraph'>海风中文正文 &amp; 远航</p>"
        );
        let saved = save_entry(
            &fixture.state,
            &fixture.paths,
            &SaveInput {
                entry_id: fixture.entry_id.to_string(),
                project_id: fixture.project_id.to_string(),
                html,
                css: ".marker { color: red; }".into(),
                expected_revision: None,
                request_key: "indexed-save".into(),
                modified_by: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(saved.revision, 1);
        let world = fixture
            .state
            .world_store
            .open_world(fixture.project_id)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT text FROM object_text_blocks WHERE object_id=? AND node_id=?"
            )
            .bind(fixture.entry_id)
            .bind(node_id)
            .fetch_one(&world.pool)
            .await
            .unwrap(),
            "海风中文正文 & 远航"
        );
        assert_eq!(
            world
                .search_entries(&fixture.project_id, "海风中文正文", Default::default(), 20)
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(
            world
                .search_entries(&fixture.project_id, "marker", Default::default(), 20)
                .await
                .unwrap()
                .is_empty()
        );

        sqlx::query("DELETE FROM object_text_blocks WHERE object_id=?")
            .bind(fixture.entry_id)
            .execute(&world.pool)
            .await
            .unwrap();
        let report = rebuild_projection(&fixture.state, &fixture.paths, fixture.project_id)
            .await
            .unwrap();
        assert_eq!(report.rebuilt, 1);
        assert_eq!(report.skipped_count, 0);
        assert!(report.skipped.is_empty());
        let second = rebuild_projection(&fixture.state, &fixture.paths, fixture.project_id)
            .await
            .unwrap();
        assert_eq!(second.rebuilt, 0);
        assert_eq!(second.skipped_count, 0);
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT text FROM object_text_blocks WHERE object_id=? AND node_id=?"
            )
            .bind(fixture.entry_id)
            .bind(node_id)
            .fetch_one(&world.pool)
            .await
            .unwrap(),
            "海风中文正文 & 远航"
        );
        assert_eq!(
            world
                .get_entry_page_document(&fixture.entry_id)
                .await
                .unwrap()
                .unwrap()
                .revision,
            1
        );
    }

    #[tokio::test]
    async fn rebuild_projection_marks_empty_page_revision_and_skips_it_next_time() {
        let fixture = setup().await;
        let html = "<div data-fc-node-kind='container'></div>";
        let saved = save_entry(
            &fixture.state,
            &fixture.paths,
            &SaveInput {
                entry_id: fixture.entry_id.to_string(),
                project_id: fixture.project_id.to_string(),
                html: html.into(),
                css: String::new(),
                expected_revision: None,
                request_key: "empty-page-projection".into(),
                modified_by: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(saved.revision, 1);

        let first = rebuild_projection(&fixture.state, &fixture.paths, fixture.project_id)
            .await
            .unwrap();
        assert_eq!(first.rebuilt, 1);
        assert_eq!(first.skipped_count, 0);

        let second = rebuild_projection(&fixture.state, &fixture.paths, fixture.project_id)
            .await
            .unwrap();
        assert_eq!(second.rebuilt, 0);
        assert_eq!(second.skipped_count, 0);

        let world = fixture
            .state
            .world_store
            .open_world(fixture.project_id)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM object_changes
                 WHERE object_id=? AND revision=? AND change_type='projection-rebuild'
                   AND source='page-document'",
            )
            .bind(fixture.entry_id)
            .bind(1_i64)
            .fetch_one(&world.pool)
            .await
            .unwrap(),
            1,
        );
        let reopened = world
            .get_entry_page_document(&fixture.entry_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(reopened.revision, 1);
        assert_eq!(reopened.html, html);
    }

    #[tokio::test]
    async fn stale_project_home_revision_returns_conflict_code_and_current_revision() {
        let fixture = setup().await;
        let first = save_project_home(
            &fixture.state,
            &fixture.paths,
            &fixture.project_id,
            "<main>第一版</main>",
            "",
            None,
            "project-conflict-first",
            None,
        )
        .await
        .unwrap();
        assert_eq!(first.revision, 1);

        let error = save_project_home(
            &fixture.state,
            &fixture.paths,
            &fixture.project_id,
            "<main>过期写入</main>",
            "",
            None,
            "project-conflict-stale",
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::DocumentRevisionConflict.as_str());
        assert_eq!(error.detail["currentRevision"], 1);
    }

    #[tokio::test]
    async fn idempotent_replay_and_key_mismatch_are_not_revision_conflicts() {
        let fixture = setup().await;
        let input = SaveInput {
            entry_id: fixture.entry_id.to_string(),
            project_id: fixture.project_id.to_string(),
            html: "<p>幂等正文</p>".into(),
            css: String::new(),
            expected_revision: None,
            request_key: "entry-idempotent".into(),
            modified_by: None,
        };
        let first = save_entry(&fixture.state, &fixture.paths, &input)
            .await
            .unwrap();
        let replay = save_entry(&fixture.state, &fixture.paths, &input)
            .await
            .unwrap();
        assert_eq!(replay.revision, first.revision);
        assert_eq!(replay.request_key, first.request_key);

        let error = save_entry(
            &fixture.state,
            &fixture.paths,
            &SaveInput {
                html: "<p>不同正文</p>".into(),
                ..input
            },
        )
        .await
        .unwrap_err();
        assert_ne!(error.code, ErrorCode::DocumentRevisionConflict.as_str());
    }

    #[tokio::test]
    async fn imported_asset_is_project_bound_readable_and_required_before_save() {
        let fixture = setup().await;
        let source = fixture._dir.path().join("sample.png");
        image::RgbaImage::from_pixel(2, 2, image::Rgba([20, 40, 60, 255]))
            .save(&source)
            .unwrap();
        let asset = page_document_assets::import_asset(
            &fixture.state,
            &fixture.paths,
            &fixture.project_id,
            &source,
        )
        .await
        .unwrap();
        let frame = page_document_assets::read_asset_frame(
            &fixture.state,
            &fixture.paths,
            &fixture.project_id,
            &asset.id,
        )
        .await
        .unwrap();
        assert_eq!((frame.width, frame.height), (2, 2));
        assert_eq!((frame.original_width, frame.original_height), (2, 2));
        assert_eq!(
            base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                frame.rgba_base64
            )
            .unwrap()
            .len(),
            16
        );
        assert!(
            page_document_assets::read_asset_frame(
                &fixture.state,
                &fixture.paths,
                &fixture.other_project_id,
                &asset.id,
            )
            .await
            .is_err()
        );
        assert!(
            save_project_home(
                &fixture.state,
                &fixture.paths,
                &fixture.other_project_id,
                &format!("<img src=\"fcasset://{}\">", asset.id),
                "",
                None,
                "foreign-project-asset",
                None,
            )
            .await
            .is_err()
        );
        assert!(
            read_project_home(&fixture.state, &fixture.other_project_id)
                .await
                .unwrap()
                .is_none()
        );

        let html = format!(
            "<figure data-fc-node-id=\"{}\" data-fc-node-kind=\"asset\"><img src=\"fcasset://{}\" data-fc-asset-id=\"{}\" alt=\"图\"></figure>",
            Uuid::new_v4(),
            asset.id,
            asset.id
        );
        let input = SaveInput {
            entry_id: fixture.entry_id.to_string(),
            project_id: fixture.project_id.to_string(),
            html,
            css: String::new(),
            expected_revision: None,
            request_key: "asset-first-save".into(),
            modified_by: None,
        };
        assert_eq!(
            save_entry(&fixture.state, &fixture.paths, &input)
                .await
                .unwrap()
                .revision,
            1
        );
        let world = fixture
            .state
            .world_store
            .open_world(fixture.project_id)
            .await
            .unwrap();
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM object_references WHERE source_id=? AND target_id=? AND ref_type='asset'")
            .bind(fixture.entry_id).bind(asset.id).fetch_one(&world.pool).await.unwrap(), 1);
        let missing = SaveInput {
            html: format!("<img src=\"fcasset://{}\">", Uuid::new_v4()),
            expected_revision: Some(1),
            request_key: "asset-missing".into(),
            ..input.clone()
        };
        assert!(
            save_entry(&fixture.state, &fixture.paths, &missing)
                .await
                .is_err()
        );
        assert_eq!(
            read_entry(&fixture.state, &fixture.entry_id)
                .await
                .unwrap()
                .unwrap()
                .revision,
            1
        );
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM object_references WHERE source_id=? AND target_id=? AND ref_type='asset'")
            .bind(fixture.entry_id).bind(asset.id).fetch_one(&world.pool).await.unwrap(), 1);

        let path = page_document_assets::asset_path(&fixture.paths, &asset).unwrap();
        std::fs::write(path, b"corrupted").unwrap();
        assert!(
            page_document_assets::read_asset_frame(
                &fixture.state,
                &fixture.paths,
                &fixture.project_id,
                &asset.id,
            )
            .await
            .is_err()
        );
        let resave = SaveInput {
            expected_revision: Some(1),
            request_key: "asset-corrupt".into(),
            ..input
        };
        assert!(
            save_entry(&fixture.state, &fixture.paths, &resave)
                .await
                .is_err()
        );
        assert_eq!(
            read_entry(&fixture.state, &fixture.entry_id)
                .await
                .unwrap()
                .unwrap()
                .revision,
            1
        );
    }

    #[tokio::test]
    async fn preview_frame_keeps_original_geometry_when_pixels_are_downsampled() {
        let fixture = setup().await;
        let source = fixture._dir.path().join("wide.png");
        image::RgbaImage::from_pixel(1024, 512, image::Rgba([20, 40, 60, 255]))
            .save(&source)
            .unwrap();
        let asset = page_document_assets::import_asset(
            &fixture.state,
            &fixture.paths,
            &fixture.project_id,
            &source,
        )
        .await
        .unwrap();
        let frame = page_document_assets::read_asset_frame(
            &fixture.state,
            &fixture.paths,
            &fixture.project_id,
            &asset.id,
        )
        .await
        .unwrap();
        assert_eq!((frame.width, frame.height), (512, 256));
        assert_eq!((frame.original_width, frame.original_height), (1024, 512));
        let wire = serde_json::to_value(&frame).unwrap();
        assert_eq!(wire["originalWidth"], 1024);
        assert_eq!(wire["originalHeight"], 512);
    }

    #[test]
    fn validation_failure_returns_structured_diagnostics() {
        let validation = document_validation::validate("<script>x</script>", "", None);
        let error = require_valid(&validation).unwrap_err();
        assert_eq!(error.code, ErrorCode::ValidationFormatError.as_str());
        assert!(error.detail["diagnostics"].is_array());
    }
}
