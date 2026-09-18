use super::common::*;
use worldflow_core::PageAssetOps;

fn project_map_sidecar_paths(
    state: &AppState,
    paths: &PathsState,
    project_id: &Uuid,
) -> Result<Vec<PathBuf>, String> {
    let safe_id = project_id.to_string();
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(vec![
        state
            .world_store
            .paths(*project_id)
            .root_dir
            .join("maps.json"),
        db_dir.join("maps").join(format!("{safe_id}.json")),
    ])
}

fn cleanup_project_map_sidecars(
    state: &AppState,
    paths: &PathsState,
    project_id: &Uuid,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for path in project_map_sidecar_paths(state, paths, project_id)? {
        if path.exists() {
            if let Err(error) = std::fs::remove_file(&path) {
                errors.push(format!("清理项目地图文件失败 {:?}: {error}", path));
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

#[tauri::command]
pub async fn db_create_project(
    state: State<'_, Arc<AppState>>,
    name: String,
    description: Option<String>,
    cover_image: Option<String>,
    create_default_template: Option<bool>,
) -> Result<Project, String> {
    let db = state.inner().sqlite_db.lock().await.clone();
    let input = CreateProject {
        name,
        description,
        cover_image,
    };
    let project = if create_default_template.unwrap_or(true) {
        db.create_project_with_default_timeline_tags(input).await
    } else {
        db.create_project(input).await
    }
    .map_err(|e| e.to_string())?;
    sync_project_to_world(state.inner(), &db, &project).await?;
    Ok(project)
}

/// 查询单个项目
#[tauri::command]
pub async fn db_get_project(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Project, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await.clone();
    let project = db.get_project(&id).await.map_err(|e| e.to_string())?;
    ensure_project_world(state.inner(), &db, &project).await?;
    let world_db = open_project_db(state.inner(), &id).await?;
    world_db.get_project(&id).await.map_err(|e| e.to_string())
}

/// 查询所有项目列表
#[tauri::command]
pub async fn db_list_projects(state: State<'_, Arc<AppState>>) -> Result<Vec<Project>, String> {
    let db = state.inner().sqlite_db.lock().await.clone();
    let projects = db.list_projects().await.map_err(|e| e.to_string())?;
    let mut world_projects = Vec::with_capacity(projects.len());
    for project in &projects {
        ensure_project_world(state.inner(), &db, project).await?;
        let world_db = open_project_db(state.inner(), &project.id).await?;
        world_projects.push(
            world_db
                .get_project(&project.id)
                .await
                .map_err(|e| e.to_string())?,
        );
    }
    Ok(world_projects)
}

/// 更新项目信息
#[tauri::command]
pub async fn db_update_project(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    description_set: Option<bool>,
    cover_image: Option<Option<String>>,
) -> Result<Project, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let description = if description_set.unwrap_or(false) {
        Some(description)
    } else {
        None
    };
    let db = state.inner().sqlite_db.lock().await.clone();
    db.update_project(
        &id,
        UpdateProject {
            name: name.clone(),
            description: description.clone(),
            cover_image: cover_image.clone(),
        },
    )
    .await
    .map_err(|e| e.to_string())?;

    let world_db = open_project_db(state.inner(), &id).await?;
    let project = world_db
        .update_project(
            &id,
            UpdateProject {
                name,
                description,
                cover_image,
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    if let Err(error) = state
        .inner()
        .world_store
        .rename_world(project.id, project.name.clone())
        .await
    {
        log::warn!("更新项目对应世界观名称失败: {}", error);
    }
    Ok(project)
}

/// 删除项目（级联删除所有分类、词条、标签定义、关系）
#[tauri::command]
pub async fn db_delete_project(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, PathsState>,
    id: String,
) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await.clone();
    let world_db = open_project_db(state.inner(), &id).await?;
    let mut assets = world_db
        .list_page_assets(&id)
        .await
        .map_err(|e| e.to_string())?;
    world_db.pool.close().await;
    for asset in db.list_page_assets(&id).await.map_err(|e| e.to_string())? {
        if !assets.iter().any(|existing| existing.id == asset.id) {
            assets.push(asset);
        }
    }
    db.delete_project(&id).await.map_err(|e| e.to_string())?;
    state
        .inner()
        .world_store
        .delete_world(id)
        .await
        .map_err(|e| e.to_string())?;
    crate::page_document_assets::cleanup_deleted_project_assets(
        &db,
        &state.inner().world_store,
        paths.inner(),
        &assets,
    )
    .await
    .map_err(|error| format!("项目已删除，但图片原件清理未完成：{error}"))?;
    if let Err(error) = cleanup_project_map_sidecars(state.inner(), paths.inner(), &id) {
        log::warn!("清理项目地图文件失败: {}", error);
    }
    Ok(())
}

// ============ 分类 ============
