//! 页面文档 Tauri 命令：前端只通过此适配边界访问文档存储和 Rust 校验。
use crate::{AppState, document_validation};
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;
use worldflow_core::PageDocumentOps;
use worldflow_core::models::{PageDocument, ProjectHomeDocument, SavePageDocumentResult};

#[derive(Debug, Deserialize)]
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
#[tauri::command]
pub async fn page_document_read_entry(
    state: State<'_, Arc<AppState>>,
    entry_id: String,
) -> Result<Option<PageDocument>, String> {
    let id = Uuid::parse_str(&entry_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await.clone();
    db.get_entry_page_document(&id)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn page_document_save_entry(
    state: State<'_, Arc<AppState>>,
    input: SaveInput,
) -> Result<SavePageDocumentResult<PageDocument>, String> {
    let e = Uuid::parse_str(&input.entry_id).map_err(|e| e.to_string())?;
    let p = Uuid::parse_str(&input.project_id).map_err(|e| e.to_string())?;
    let v = document_validation::validate(&input.html, &input.css, Some(&input.project_id));
    if !v.valid {
        return Err(serde_json::to_string(&v).unwrap());
    };
    let db = state.sqlite_db.lock().await.clone();
    db.save_entry_page_document(
        &e,
        &p,
        &input.html,
        &input.css,
        input.expected_revision,
        &input.request_key,
        input.modified_by.as_deref().unwrap_or("local"),
    )
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn page_document_validate(
    html: String,
    css: String,
    project_id: Option<String>,
) -> document_validation::ValidationResult {
    document_validation::validate(&html, &css, project_id.as_deref())
}
#[tauri::command]
pub async fn page_document_read_project_home(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Option<ProjectHomeDocument>, String> {
    let p = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let db = state.sqlite_db.lock().await.clone();
    db.get_project_home_document(&p)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn page_document_save_project_home(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    html: String,
    css: String,
    expected_revision: Option<i64>,
    request_key: String,
    modified_by: Option<String>,
) -> Result<SavePageDocumentResult<ProjectHomeDocument>, String> {
    let p = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let v = document_validation::validate(&html, &css, Some(&project_id));
    if !v.valid {
        return Err(serde_json::to_string(&v).unwrap());
    };
    let db = state.sqlite_db.lock().await.clone();
    db.save_project_home_document(
        &p,
        &html,
        &css,
        expected_revision,
        &request_key,
        modified_by.as_deref().unwrap_or("local"),
    )
    .await
    .map_err(|e| e.to_string())
}
