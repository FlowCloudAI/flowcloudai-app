//! FlowCloudAI Tauri 后端的装配与启动入口。
//!
//! 此处集中声明功能模块、初始化全局状态和注册前端命令；领域逻辑应保留在各自模块，避免把
//! 运行时装配层变成新的业务实现入口。

mod ai_services;
#[cfg(target_os = "android")]
mod android_file_import;
mod api_error;
mod apis;
mod auto_backup;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop_file_open;
mod document_context;
mod layout;
/// `#[doc(hidden)]` 仅为让集成测试（`tests/coastline_v2.rs`）访问 map 模块；非稳定公开 API。
#[doc(hidden)]
pub mod map;
mod reports;
mod senses;
mod settings;
mod state;
mod template;
mod tools;

/// 仅供集成测试访问 `web_tools` 内部实现的桥接（`#[doc(hidden)]`，非稳定公开 API）。
/// 详见 `tests/web_tools.rs` 与 `web_tools::__test_api`。
#[doc(hidden)]
pub use crate::tools::web_tools::__test_api as test_api;

pub use api_error::ApiError;
pub use settings::*;
pub use state::*;

use apis::ai_character::*;
use apis::ai_client::confirmations::*;
use apis::ai_client::conversations::*;
use apis::ai_client::media::*;
use apis::ai_client::plugins::*;
use apis::ai_client::sessions::*;
use apis::ai_client::task_context::*;
use apis::ai_client::tools::*;
use apis::ai_client::usage::*;
use apis::ai_contradiction::*;
use apis::ai_summary::*;
use apis::ai_world_check::*;
use apis::app_settings::*;
use apis::app_update::*;
use apis::document_context::*;
use apis::feedback::*;
use apis::layout::*;
use apis::map::*;
use apis::map_persistence::*;
use apis::ocr::*;
use apis::plugins::local::*;
use apis::plugins::market::*;
use apis::plugins::remote::*;
use apis::templates::*;
use apis::webview_control::*;
use apis::worldflow::categories::*;
use apis::worldflow::entries::*;
use apis::worldflow::entry_types::*;
use apis::worldflow::fcworld::*;
use apis::worldflow::ideas::*;
use apis::worldflow::images::*;
use apis::worldflow::links::*;
use apis::worldflow::project_settings::*;
use apis::worldflow::projects::*;
use apis::worldflow::relations::*;
use apis::worldflow::snapshots::*;
use apis::worldflow::system::*;
use apis::worldflow::tags::*;
use auto_backup::start_auto_backup_worker;
use layout::cache::LayoutCacheState;
use template::install_global_template_runtime;

use anyhow::Result;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{
    AppHandle, Emitter, Manager, Runtime, UriSchemeContext,
    http::{Response, StatusCode, header::CONTENT_TYPE},
};
use tauri_plugin_log;
use tokio::sync::Mutex;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use worldflow_core::SnapshotConfig;
use worldflow_core::{SqliteDb, WorldStore, WorldStoreConfig};

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_flowcloudai_www_MainActivity_initRustlsPlatformVerifier<'local>(
    mut env: jni::EnvUnowned<'local>,
    activity: jni::objects::JObject<'local>,
) {
    let outcome = env.with_env(|env| -> jni::errors::Result<()> {
        crate::android_file_import::init_android_file_import(env, &activity)?;
        rustls_platform_verifier::android::init_with_env(env, activity)
    });

    match outcome.into_outcome() {
        jni::Outcome::Ok(()) => {
            log::info!("Android TLS 证书校验器初始化完成");
        }
        jni::Outcome::Err(error) => {
            log::error!("Android TLS 证书校验器初始化失败: {}", error);
        }
        jni::Outcome::Panic(payload) => {
            log::error!(
                "Android TLS 证书校验器初始化 panic: {}",
                panic_payload_to_string(payload.as_ref())
            );
        }
    }
}

#[cfg(target_os = "android")]
fn panic_payload_to_string(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    "未知 panic 载荷".to_string()
}

/// 运行时设置状态：持有设置值 + 配置文件路径（供保存时使用）
pub struct SettingsState {
    pub settings: Mutex<AppSettings>,
    pub path: PathBuf,
}

fn resolve_template_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let mut candidates: Vec<(&str, PathBuf)> = Vec::new();

    if let Some(exe_template_dir) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("templates")))
    {
        candidates.push(("exe", exe_template_dir));
    }

    #[cfg(debug_assertions)]
    {
        let _ = app;
        candidates.push((
            "dev",
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("templates"),
        ));
    }

    #[cfg(not(debug_assertions))]
    {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| anyhow::anyhow!("解析模板资源目录失败: {}", e))?;
        candidates.push(("resource", resource_dir.join("templates")));
    }

    for (source, path) in &candidates {
        if is_template_dir(path) {
            log::info!("模板目录解析完成 source={} path={}", source, path.display());
            return Ok(path.clone());
        }
        if path.exists() {
            log::warn!(
                "跳过无效模板目录 source={} path={}，未找到分层模板文件",
                source,
                path.display()
            );
        }
    }

    let fallback = candidates
        .into_iter()
        .next()
        .map(|(_, path)| path)
        .ok_or_else(|| anyhow::anyhow!("无法解析模板目录"))?;
    log::warn!(
        "未找到实际存在的模板目录，将使用默认路径并依赖内嵌模板 source=fallback path={}",
        fallback.display()
    );
    Ok(fallback)
}

fn is_template_dir(path: &Path) -> bool {
    path.join("sense").join("app_system.tera").is_file()
}

// ── 入口 ──────────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .register_uri_scheme_protocol("fcimg", |ctx, request| handle_fcimg_request(ctx, request))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    // 单实例插件可能早于应用 setup 收到第二进程参数，桌面文件队列必须先注册。
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.manage(desktop_file_open::DesktopFileOpenState::default());

    // macOS 由 Launch Services 原生复用应用实例；若在 setup 阶段启用单实例插件，
    // 新进程可能在 `RunEvent::Opened` 交付文件 URL 前退出，导致 Finder 双击丢失。
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        desktop_file_open::queue_cli_arguments(app, args, Path::new(&cwd));
    }));

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .setup(|app| {
            // ── 日志初始化 ────────────────────────────────────────────────────────
            // release 模式：写入 settings.json 同目录（app_config_dir）；
            //   文件目标过滤至 Info 级，避免 wasmtime/cranelift Debug 噪音。
            // debug 模式：桌面仅 stdout；移动端同时写 app.log，便于在关于页查看。
            {
                #[cfg(any(not(debug_assertions), target_os = "android", target_os = "ios"))]
                let log_config_dir = app
                    .handle()
                    .path()
                    .app_config_dir()
                    .unwrap_or_else(|_| std::env::current_dir().unwrap());

                let stdout_target = tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                )
                .filter(|meta| {
                    // 过滤第三方依赖的高频诊断日志，避免启动时刷屏。
                    let target = meta.target();
                    !target.starts_with("sqlx::")
                        && !target.starts_with("hyper")
                        && !target.starts_with("hyper_util")
                        && !target.starts_with("h2::")
                        && !target.starts_with("reqwest::")
                        && !target.starts_with("cranelift_codegen::timing")
                });
                #[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
                let log_targets = [stdout_target];
                #[cfg(any(not(debug_assertions), target_os = "android", target_os = "ios"))]
                let log_targets = [
                    stdout_target,
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                        path: log_config_dir,
                        file_name: Some("app".to_string()),
                    })
                    .filter(|meta| meta.level() <= log::Level::Info),
                ];
                let log_builder = tauri_plugin_log::Builder::new()
                    .level(log::LevelFilter::Info)
                    .level_for("app_lib", log::LevelFilter::Debug)
                    .level_for("FlowCloudAI", log::LevelFilter::Debug)
                    .level_for("flowcloudai_client", log::LevelFilter::Debug)
                    .level_for("worldflow_core", log::LevelFilter::Debug)
                    .targets(log_targets);

                app.handle().plugin(log_builder.build())?;
            }

            // 禁用 release 模式下的 WebView 右键菜单
            #[cfg(not(debug_assertions))]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(
                    "document.addEventListener('contextmenu', e => e.preventDefault(), true);",
                );
            }

            let app_handle = app.handle().clone();

            // HTTP 客户端（连接池在进程生命周期内共享）
            app.manage(NetworkState::new());
            app.manage(LayoutCacheState::new());
            app.manage(BackendReadyState::new());
            app.manage(TtsPlaybackState::default());
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                let cwd = std::env::current_dir().unwrap_or_default();
                desktop_file_open::queue_cli_arguments(
                    &app_handle,
                    std::env::args().collect(),
                    &cwd,
                );
            }

            // 加载设置
            let settings_path = app_handle
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::env::current_dir().unwrap())
                .join("settings.json");

            let mut settings = AppSettings::load(&settings_path);
            if let Err(error) =
                apply_shell_acrylic_setting(&app_handle, settings.shell_acrylic_enabled)
            {
                log::warn!("应用窗口 Acrylic 效果失败: {}", error);
            }

            // 在 settings 移入 manage 之前应用平台存储策略。
            let data_root = default_data_root(&app_handle);
            if enforce_platform_storage_policy(&mut settings) {
                log::warn!(
                    "移动端已取消自定义存储目录，将使用当前系统沙箱 {}",
                    data_root.display()
                );
                if let Err(error) = settings.save(&settings_path) {
                    log::error!("保存移动端存储策略失败: {}", error);
                }
            }

            // Android 无系统密钥链，API Key 改存应用私有目录的明文文件，此处注入存储目录。
            #[cfg(target_os = "android")]
            settings::init_api_key_storage(data_root.clone());
            let resolved_db_path = settings
                .db_path
                .as_deref()
                .map(PathBuf::from)
                .unwrap_or_else(|| data_root.join("db"));
            let resolved_plugins_path = settings
                .plugins_path
                .as_deref()
                .map(PathBuf::from)
                .unwrap_or_else(|| data_root.join("plugins"));

            // 搜索工具状态（供 AI 工具实时读取，随设置更新）
            let search_engine_arc = Arc::new(Mutex::new(settings.search_engine.clone()));
            let search_sources_arc = Arc::new(Mutex::new(settings.search_sources.clone()));
            app.manage(SearchEngineState {
                engine: search_engine_arc.clone(),
            });
            app.manage(SearchSourcesState {
                sources: search_sources_arc.clone(),
            });

            app.manage(SettingsState {
                settings: Mutex::new(settings),
                path: settings_path,
            });

            let override_template_dir = app_handle
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::env::current_dir().unwrap())
                .join("templates");

            match resolve_template_dir(&app_handle)
                .and_then(|dir| install_global_template_runtime(dir, override_template_dir.clone()))
            {
                Ok(()) => {
                    log::info!("模板引擎初始化完成");
                }
                Err(error) => {
                    log::warn!("模板引擎初始化失败，将继续使用硬编码回退：{}", error);
                }
            }

            // 异步初始化数据库
            let db_path = match prepare_db_path(&app_handle, &resolved_db_path) {
                Ok(path) => path,
                Err(e) => {
                    mark_backend_failed(&app_handle, e.to_string());
                    return Ok(());
                }
            };
            let snapshot_dir = db_path.parent().map(|p| p.join("snapshots"));

            tauri::async_runtime::spawn(async move {
                let world_store = match init_world_store(&resolved_db_path).await {
                    Ok(store) => store,
                    Err(e) => {
                        mark_backend_failed(&app_handle, format!("世界观库初始化失败: {}", e));
                        return;
                    }
                };

                match init_db(&db_path, snapshot_dir.as_deref()).await {
                    Ok(db) => {
                        let app_state = Arc::new(AppState {
                            sqlite_db: Mutex::new(db),
                            world_store,
                            thumbnail_jobs: Mutex::new(std::collections::HashMap::new()),
                        });

                        let app = app_handle.clone();
                        if let Err(e) = app_handle.run_on_main_thread(move || {
                            // 先管理 AppState
                            app.manage(app_state.clone());

                            // 管理路径状态
                            app.manage(PathsState {
                                db_path: db_path.clone(),
                                plugins_path: resolved_plugins_path.clone(),
                            });

                            // 创建待确认编辑请求状态（AI 工具和 confirm command 共享同一个 Arc）
                            let pending_edits = Arc::new(Mutex::new(std::collections::HashMap::<
                                String,
                                tokio::sync::oneshot::Sender<bool>,
                            >::new(
                            )));
                            app.manage(PendingEditsState {
                                pending: pending_edits.clone(),
                            });

                            // 再初始化 AI 客户端（需要 AppState）
                            std::fs::create_dir_all(&resolved_plugins_path).ok();
                            let chats_path = db_path.parent().map(|p| p.join("chats"));
                            let ai_state = match AiState::new(
                                resolved_plugins_path,
                                chats_path,
                                app_state,
                                search_engine_arc,
                                search_sources_arc,
                                app.clone(),
                                pending_edits,
                            ) {
                                Ok(ai_state) => ai_state,
                                Err(e) => {
                                    if let Some(ready_state) = app.try_state::<BackendReadyState>()
                                    {
                                        ready_state
                                            .mark_failed(format!("AI 客户端初始化失败: {}", e));
                                    }
                                    emit_backend_status(&app);
                                    return;
                                }
                            };
                            app.manage(ai_state);
                            if let Some(ready_state) = app.try_state::<BackendReadyState>() {
                                ready_state.mark_ready();
                            }
                            start_auto_backup_worker(app.clone());
                            emit_backend_status(&app);
                        }) {
                            log::error!("run_on_main_thread failed: {}", e);
                            mark_backend_failed(
                                &app_handle,
                                format!("run_on_main_thread failed: {}", e),
                            );
                        }
                    }
                    Err(e) => {
                        mark_backend_failed(&app_handle, format!("数据库初始化失败: {}", e));
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            log_message,
            read_app_log,
            open_in_file_manager,
            show_main_window,
            exit_app,
            get_platform_info,
            check_mobile_app_update,
            get_app_update_changelog,
            // 项目
            db_create_project,
            db_get_project,
            db_list_projects,
            db_update_project,
            db_delete_project,
            db_export_project_fcworld,
            db_import_project_fcworld,
            db_preview_project_fcworld,
            // 分类
            db_create_category,
            db_get_category,
            db_list_categories,
            db_update_category,
            db_delete_category,
            db_cascade_delete_category,
            db_delete_category_move_to_parent,
            // 词条
            db_create_entry,
            db_get_entry,
            db_list_entries,
            db_list_timeline_events,
            db_get_project_stats,
            db_search_entries,
            db_count_entries,
            db_update_entry,
            db_save_entry_bundle,
            db_delete_entry,
            db_create_entries_bulk,
            db_optimize_fts,
            import_entry_images,
            db_ensure_entry_cover_thumbnail,
            db_ensure_project_cover_thumbnail,
            db_ensure_project_cover_thumbnails,
            open_entry_image_path,
            // 标签模式
            db_create_tag_schema,
            db_get_tag_schema,
            db_list_tag_schemas,
            db_update_tag_schema,
            db_delete_tag_schema,
            // 词条关系
            db_create_relation,
            db_get_relation,
            db_list_relations_for_entry,
            db_list_relations_for_project,
            db_get_relation_graph_data,
            db_update_relation,
            db_delete_relation,
            db_delete_relations_between,
            // 项目级设置
            db_get_project_setting,
            db_set_project_setting,
            // 词条类型
            db_list_all_entry_types,
            db_list_custom_entry_types,
            db_create_entry_type,
            db_get_entry_type,
            db_update_entry_type,
            db_delete_entry_type,
            // 词条链接
            db_create_entry_link,
            db_list_outgoing_links,
            db_list_incoming_links,
            db_delete_links_from_entry,
            db_replace_outgoing_links,
            import_remote_images,
            // 灵感笔记
            db_create_idea_note,
            db_get_idea_note,
            db_list_idea_notes,
            db_update_idea_note,
            db_delete_idea_note,
            // AI Client
            ai_list_plugins,
            ai_create_llm_session,
            ai_build_character_project_snapshot,
            ai_create_character_session,
            ai_start_contradiction_session,
            ai_start_world_check_session,
            ai_get_world_check_report,
            ai_list_world_check_reports,
            ai_get_world_check_report_entry,
            ai_delete_world_check_report,
            ai_get_contradiction_report,
            ai_list_contradiction_reports,
            ai_get_contradiction_report_entry,
            ai_delete_contradiction_report,
            ai_generate_entry_summary,
            ai_fill_image_prompt,
            ai_send_message,
            ai_continue_generation,
            ai_cancel_session,
            ai_close_session,
            ai_close_all_sessions,
            ai_checkout,
            ai_get_conversation_tree,
            ai_switch_plugin,
            ai_update_session,
            ai_text_to_image,
            ai_edit_image,
            ai_merge_images,
            ai_speak,
            ai_play_tts,
            ai_cancel_tts,
            ai_enable_tool,
            ai_disable_tool,
            ai_is_enabled,
            ai_list_tools,
            ai_list_conversations,
            ai_get_conversation,
            ai_update_conversation_settings,
            ai_update_message_attachments,
            ai_compact_conversation,
            ai_export_conversation,
            ai_delete_conversation,
            ai_rename_conversation,
            ai_get_character_conversation_meta,
            ai_save_character_conversation_meta,
            ai_get_conversation_ui_state,
            ai_save_conversation_ui_state,
            confirm_entry_edit,
            ai_set_task_context,
            ai_get_usage_summary,
            ai_get_usage_by_model,
            ai_get_usage_daily,
            ai_estimate_tokens,
            docctx_supported_extensions,
            docctx_add_files,
            docctx_list_items,
            docctx_remove_item,
            docctx_reassign_conversation,
            docctx_retry_item,
            docctx_build_context,
            // 应用设置
            setting_get_settings,
            setting_get_settings_bootstrap,
            setting_update_settings,
            setting_get_media_dir,
            setting_get_default_paths,
            setting_open_backup_dir,
            setting_export_theme_config,
            setting_is_backend_ready,
            setting_get_backend_status,
            setting_set_api_key,
            setting_has_api_key,
            setting_delete_api_key,
            submit_public_feedback,
            template_list,
            template_get,
            template_get_default,
            template_get_local_root_dir,
            template_get_effective_path,
            template_save,
            // Plugin Management — 本地
            plugin_list_local,
            plugin_install_from_file,
            plugin_uninstall,
            // Plugin Management — 通用注册表
            plugin_fetch_remote,
            plugin_check_updates,
            // Plugin Management — 官方市场
            plugin_market_list,
            plugin_market_install,
            map_save_scene,
            map_list_project_maps,
            map_save_map_entry,
            map_delete_map_entry,
            compute_layout,
            ocr_recognize_image,
            // 快照
            db_snapshot,
            db_snapshot_with_message,
            db_get_active_branch,
            db_list_branches,
            db_create_branch,
            db_switch_branch,
            db_list_snapshots,
            db_list_snapshots_in_branch,
            db_get_snapshot_graph,
            db_snapshot_to_branch,
            db_rollback_to,
            db_append_from,
            suspend_webview,
            resume_webview,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            desktop_file_open::desktop_take_pending_file_open_requests,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                desktop_file_open::queue_opened_urls(app, urls);
            }

            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

// ── 初始化辅助 ────────────────────────────────────────────────────────────────

async fn init_db(db_path: &Path, snapshot_dir: Option<&Path>) -> Result<SqliteDb> {
    if !db_path.exists() {
        std::fs::File::create(db_path).map_err(|e| anyhow::anyhow!("无法创建数据库文件: {}", e))?;
    }
    let path_str = db_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("数据库路径包含非法 UTF-8 字符: {:?}", db_path))?
        .replace('\\', "/");
    log::info!("Connecting to database: {}", path_str);

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = snapshot_dir;
        SqliteDb::new(&path_str).await.map_err(Into::into)
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(dir) = snapshot_dir {
        std::fs::create_dir_all(dir)?;
        let config = SnapshotConfig {
            dir: dir.to_path_buf(),
            author_name: "FlowCloudAI".to_string(),
            author_email: "app@flowcloud.ai".to_string(),
        };
        SqliteDb::new_with_snapshot(&path_str, config)
            .await
            .map_err(Into::into)
    } else {
        SqliteDb::new(&path_str).await.map_err(Into::into)
    }
}

async fn init_world_store(root_dir: &Path) -> Result<WorldStore> {
    std::fs::create_dir_all(root_dir)?;
    let config =
        WorldStoreConfig::new(root_dir).with_snapshot_author("FlowCloudAI", "app@flowcloud.ai");
    WorldStore::open_with_config(config)
        .await
        .map_err(Into::into)
}

fn prepare_db_path(_app: &AppHandle, db_dir: &Path) -> Result<PathBuf> {
    let db_path = db_dir.join("main.db");
    log::info!("Database path: {:?}", db_path);

    if let Some(parent) = db_path.parent() {
        // 先区分“目录已存在”和“目录确实需要创建”，让路径错误保留准确上下文。
        if !parent.is_dir() {
            std::fs::create_dir_all(parent).map_err(|error| {
                anyhow::anyhow!("无法创建数据库目录 {}: {}", parent.display(), error)
            })?;
        }
        let test_file = parent.join(".write_test");
        std::fs::write(&test_file, b"test")
            .map_err(|error| anyhow::anyhow!("数据库目录不可写 {}: {}", parent.display(), error))?;
        if let Err(error) = std::fs::remove_file(&test_file) {
            log::warn!(
                "数据库目录写入测试文件清理失败 {}: {}",
                test_file.display(),
                error
            );
        }
    }

    Ok(db_path)
}

fn emit_backend_status<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<BackendReadyState>() else {
        return;
    };

    let status = state.status();
    let is_ready = status.phase == "ready";
    app.emit("backend-status-changed", status).ok();
    if is_ready {
        app.emit("backend-ready", ()).ok();
    }
}

fn mark_backend_failed<R: Runtime>(app: &AppHandle<R>, message: String) {
    log::error!("{}", message);
    if let Some(state) = app.try_state::<BackendReadyState>() {
        state.mark_failed(message);
        emit_backend_status(app);
    }
}

fn build_fcimg_response(
    status: StatusCode,
    body: Vec<u8>,
    content_type: Option<&str>,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder().status(status);
    if let Some(content_type) = content_type {
        builder = builder.header(CONTENT_TYPE, content_type);
    }
    builder.body(body).expect("failed to build fcimg response")
}

fn handle_fcimg_request<R: Runtime>(
    ctx: UriSchemeContext<R>,
    request: tauri::http::Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let raw_uri = request.uri().to_string();
    log::debug!("[fcimg] request uri: {}", raw_uri);

    let Some(paths) = ctx.app_handle().try_state::<PathsState>() else {
        log::warn!(
            "[fcimg] PathsState not ready — db may still be initializing. uri={}",
            raw_uri
        );
        return build_fcimg_response(
            StatusCode::SERVICE_UNAVAILABLE,
            b"paths state unavailable".to_vec(),
            Some("text/plain; charset=utf-8"),
        );
    };

    let encoded_path = request.uri().path().trim_start_matches('/');
    if encoded_path.is_empty() {
        log::warn!("[fcimg] empty path in uri={}", raw_uri);
        return build_fcimg_response(
            StatusCode::BAD_REQUEST,
            b"missing image path".to_vec(),
            Some("text/plain; charset=utf-8"),
        );
    }

    let decoded_path = match urlencoding::decode(encoded_path) {
        Ok(value) => value.into_owned(),
        Err(e) => {
            log::warn!("[fcimg] url-decode failed: {} | uri={}", e, raw_uri);
            return build_fcimg_response(
                StatusCode::BAD_REQUEST,
                format!("invalid image path: {}", raw_uri).into_bytes(),
                Some("text/plain; charset=utf-8"),
            );
        }
    };
    log::debug!("[fcimg] decoded path: {}", decoded_path);

    let requested_path = PathBuf::from(&decoded_path);
    let canonical_requested = match std::fs::canonicalize(&requested_path) {
        Ok(path) => path,
        Err(e) => {
            log::warn!(
                "[fcimg] canonicalize requested failed: {} | decoded={}",
                e,
                decoded_path
            );
            return build_fcimg_response(
                StatusCode::NOT_FOUND,
                b"image not found".to_vec(),
                Some("text/plain; charset=utf-8"),
            );
        }
    };
    log::debug!("[fcimg] canonical requested: {:?}", canonical_requested);

    let Some(db_dir) = paths.db_path.parent() else {
        log::error!("[fcimg] db_path has no parent: {:?}", paths.db_path);
        return build_fcimg_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            b"invalid db path".to_vec(),
            Some("text/plain; charset=utf-8"),
        );
    };
    let images_root = db_dir.join("images");
    log::debug!("[fcimg] images_root (pre-canonical): {:?}", images_root);

    let canonical_images_root = match std::fs::canonicalize(&images_root) {
        Ok(path) => path,
        Err(e) => {
            log::warn!(
                "[fcimg] canonicalize images_root failed: {} | path={:?}",
                e,
                images_root
            );
            return build_fcimg_response(
                StatusCode::NOT_FOUND,
                b"images root not found".to_vec(),
                Some("text/plain; charset=utf-8"),
            );
        }
    };
    log::debug!("[fcimg] canonical images_root: {:?}", canonical_images_root);

    if !canonical_requested.starts_with(&canonical_images_root) {
        log::warn!(
            "[fcimg] path outside images root — requested={:?} root={:?}",
            canonical_requested,
            canonical_images_root
        );
        return build_fcimg_response(
            StatusCode::FORBIDDEN,
            b"forbidden".to_vec(),
            Some("text/plain; charset=utf-8"),
        );
    }

    let bytes = match std::fs::read(&canonical_requested) {
        Ok(bytes) => {
            log::debug!(
                "[fcimg] OK {} bytes for {:?}",
                bytes.len(),
                canonical_requested
            );
            bytes
        }
        Err(e) => {
            log::error!(
                "[fcimg] read failed: {} | path={:?}",
                e,
                canonical_requested
            );
            return build_fcimg_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                b"failed to read image".to_vec(),
                Some("text/plain; charset=utf-8"),
            );
        }
    };
    let mime = mime_guess::from_path(&canonical_requested)
        .first_or_octet_stream()
        .to_string();

    build_fcimg_response(StatusCode::OK, bytes, Some(&mime))
}
