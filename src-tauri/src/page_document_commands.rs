//! 页面文档 Tauri 命令：选择目标世界库，执行独立校验，再把派生结果交给 core 存储。
use crate::{
    ApiError, AppState,
    apis::worldflow::common::{open_entry_db, open_project_db},
    document_validation,
};
use flowcloudai_client::ErrorCode;
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;
use worldflow_core::PageDocumentOps;
use worldflow_core::models::{
    PageDocument, ProjectHomeDocument, SaveEntryLinkTarget, SavePageDocumentResult,
};

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
) -> Result<Option<PageDocument>, ApiError> {
    let entry_id = parse_uuid("entryId", &entry_id)?;
    read_entry(state.inner(), &entry_id).await
}

#[tauri::command]
pub async fn page_document_save_entry(
    state: State<'_, Arc<AppState>>,
    input: SaveInput,
) -> Result<SavePageDocumentResult<PageDocument>, ApiError> {
    save_entry(state.inner(), &input).await
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
) -> Result<Option<ProjectHomeDocument>, ApiError> {
    let project_id = parse_uuid("projectId", &project_id)?;
    read_project_home(state.inner(), &project_id).await
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
) -> Result<SavePageDocumentResult<ProjectHomeDocument>, ApiError> {
    let project_id = parse_uuid("projectId", &project_id)?;
    let validation = document_validation::validate(&html, &css, Some(&project_id.to_string()));
    require_valid(&validation)?;
    let db = open_project_db(state.inner(), &project_id)
        .await
        .map_err(ApiError::internal)?;
    db.save_project_home_document(
        &project_id,
        &html,
        &css,
        &validation.derived_text,
        expected_revision,
        &request_key,
        modified_by.as_deref().unwrap_or("local"),
    )
    .await
    .map_err(ApiError::from_display)
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
    db.save_entry_page_document(
        &entry_id,
        &project_id,
        &input.html,
        &input.css,
        &validation.derived_text,
        &link_targets,
        input.expected_revision,
        &input.request_key,
        input.modified_by.as_deref().unwrap_or("local"),
    )
    .await
    .map_err(ApiError::from_display)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tempfile::tempdir;
    use tokio::sync::Mutex;
    use worldflow_core::{EntryLinkOps, SqliteDb, WorldStore};

    struct Fixture {
        _dir: tempfile::TempDir,
        state: AppState,
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
        let saved = save_entry(&fixture.state, &input).await.unwrap();
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
        assert!(save_entry(&fixture.state, &input).await.is_err());

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

    #[test]
    fn validation_failure_returns_structured_diagnostics() {
        let validation = document_validation::validate("<script>x</script>", "", None);
        let error = require_valid(&validation).unwrap_err();
        assert_eq!(error.code, ErrorCode::ValidationFormatError.as_str());
        assert!(error.detail["diagnostics"].is_array());
    }
}
