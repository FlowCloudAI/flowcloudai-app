use crate::apis::ai_client::plugins::{PluginInfo, list_plugins_for_kind};
use crate::state::{
    BackendReadyState, BackendStartupStatus, SearchEngineState, SearchSourcesState,
};
use crate::{AiState, ApiKeyStore, AppSettings, SettingsState};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use tauri::window::EffectState;
#[cfg(any(windows, target_os = "macos"))]
use tauri::window::{Effect, EffectsBuilder};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

/// 返回平台默认的数据根目录。
/// - Windows：若 exe 在 C 盘（系统盘，可能不可写）则用 Documents/FlowCloudAI；
///   若 exe 在其他盘（便携安装）则沿用 exe 目录。
/// - 其他平台：app_data_dir()
pub(crate) fn default_data_root(app: &AppHandle) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| std::env::current_dir().unwrap());

        let on_c_drive = exe_dir
            .to_str()
            .map(|s| {
                let lower = s.to_lowercase();
                lower.starts_with("c:") || lower.starts_with("\\\\?\\c:")
            })
            .unwrap_or(true); // 路径无效时假定在 C 盘，保守使用 Documents

        if on_c_drive {
            // 可能在 Program Files 等受保护目录 → 用 Documents
            app.path()
                .document_dir()
                .map(|p| p.join("FlowCloudAI"))
                .unwrap_or(exe_dir)
        } else {
            // 非系统盘 → 便携安装，直接用 exe 目录
            exe_dir
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        app.path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::current_dir().unwrap())
    }
}

/// 应用各平台的存储策略。
///
/// 移动系统会管理应用沙箱，重装或升级时容器的绝对路径可能变化。iOS 与 Android 因此不
/// 持久化任何自定义存储路径，每次启动都从 Tauri 当前返回的系统目录动态解析实际位置。
pub(crate) fn enforce_platform_storage_policy(settings: &mut AppSettings) -> bool {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        return clear_mobile_storage_overrides(settings);
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let _ = settings;
        false
    }
}

fn clear_mobile_storage_overrides(settings: &mut AppSettings) -> bool {
    let changed = settings.media_dir.is_some()
        || settings.db_path.is_some()
        || settings.plugins_path.is_some()
        || settings.backup_dir.is_some();
    settings.media_dir = None;
    settings.db_path = None;
    settings.plugins_path = None;
    settings.backup_dir = None;
    changed
}

// ── 设置读写 ──────────────────────────────────────────────────────────────────

/// 读取全部设置。桌面端会补齐默认路径；移动端保留空值并在使用时动态解析系统目录。
#[tauri::command]
pub async fn setting_get_settings(
    app: AppHandle,
    state: State<'_, SettingsState>,
) -> Result<AppSettings, String> {
    let mut settings = state.settings.lock().await;

    let need_save = enforce_platform_storage_policy(&mut settings);

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    let need_save = {
        let data_root = default_data_root(&app);
        let mut need_save = need_save;
        if settings.db_path.is_none() {
            settings.db_path = Some(data_root.join("db").to_string_lossy().to_string());
            need_save = true;
        }

        if settings.plugins_path.is_none() {
            settings.plugins_path = Some(data_root.join("plugins").to_string_lossy().to_string());
            need_save = true;
        }
        need_save
    };
    #[cfg(any(target_os = "ios", target_os = "android"))]
    let _ = &app;

    // 如果填充了默认值，立即保存
    if need_save {
        settings.save(&state.path).map_err(|e| e.to_string())?;
    }

    Ok(settings.clone())
}

/// 覆盖全部设置并持久化到 settings.json。
/// 若 db_path / plugins_path 发生变更，自动将旧目录下的文件复制到新目录。
/// 移动端会丢弃全部自定义存储路径，始终使用系统托管目录。
/// 返回迁移摘要（无变更时为空字符串）。
#[tauri::command]
pub async fn setting_update_settings(
    app: AppHandle,
    state: State<'_, SettingsState>,
    mut new_settings: AppSettings,
) -> Result<String, String> {
    enforce_platform_storage_policy(&mut new_settings);

    // 同步搜索工具状态（供 AI 工具实时读取）
    if let Some(se_state) = app.try_state::<SearchEngineState>() {
        *se_state.engine.lock().await = new_settings.search_engine.clone();
    }
    if let Some(ss_state) = app.try_state::<SearchSourcesState>() {
        *ss_state.sources.lock().await = new_settings.search_sources.clone();
    }

    let mut s = state.settings.lock().await;
    let old_db = s.db_path.clone();
    let old_plugins = s.plugins_path.clone();
    let old_shell_acrylic_enabled = s.shell_acrylic_enabled;

    *s = new_settings.clone();
    s.save(&state.path).map_err(|e| e.to_string())?;
    drop(s);

    if old_shell_acrylic_enabled != new_settings.shell_acrylic_enabled {
        if let Err(error) =
            apply_shell_window_effect_setting(&app, new_settings.shell_acrylic_enabled)
        {
            log::warn!("应用窗口原生材质效果失败: {}", error);
        }
    }

    // 路径变更后自动迁移文件
    let mut messages: Vec<String> = Vec::new();

    // 数据库目录迁移
    if let (Some(old_path), Some(new_path)) = (&old_db, &new_settings.db_path) {
        let old_p = PathBuf::from(old_path);
        let new_p = PathBuf::from(new_path);
        if old_p != new_p && old_p.exists() {
            match copy_dir_if_empty(&old_p, &new_p) {
                Ok(n) if n > 0 => {
                    messages.push(format!("数据库文件已复制到新位置（{} 个文件）", n));
                }
                Err(e) => {
                    log::warn!("数据库目录迁移失败: {}", e);
                    messages.push(format!("数据库迁移失败：{}，原文件仍在旧目录", e));
                }
                _ => {}
            }
        }
    }

    // 插件目录迁移
    if let (Some(old_path), Some(new_path)) = (&old_plugins, &new_settings.plugins_path) {
        let old_p = PathBuf::from(old_path);
        let new_p = PathBuf::from(new_path);
        if old_p != new_p && old_p.exists() {
            match copy_dir_if_empty(&old_p, &new_p) {
                Ok(n) if n > 0 => {
                    messages.push(format!("插件文件已复制到新位置（{} 个文件）", n));
                }
                Err(e) => {
                    log::warn!("插件目录迁移失败: {}", e);
                    messages.push(format!("插件迁移失败：{}，原文件仍在旧目录", e));
                }
                _ => {}
            }
        }
    }

    Ok(messages.join("；"))
}

pub(crate) fn apply_shell_window_effect_setting(
    app: &AppHandle,
    enabled: bool,
) -> Result<(), String> {
    #[cfg(any(windows, target_os = "macos"))]
    {
        let Some(window) = app.get_webview_window("main") else {
            return Ok(());
        };

        if enabled {
            #[cfg(windows)]
            let effects = EffectsBuilder::new().effect(Effect::Acrylic).build();

            #[cfg(target_os = "macos")]
            let effects = EffectsBuilder::new()
                .effect(Effect::UnderWindowBackground)
                .state(EffectState::FollowsWindowActiveState)
                .build();

            window.set_effects(effects).map_err(|e| e.to_string())
        } else {
            window
                .set_effects(Option::<tauri::utils::config::WindowEffectsConfig>::None)
                .map_err(|e| e.to_string())
        }
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, enabled);
        Ok(())
    }
}

/// 递归复制 src 到 dst，如果 dst 已有文件则跳过。
/// 返回实际复制的文件数。
fn copy_dir_if_empty(src: &PathBuf, dst: &PathBuf) -> std::io::Result<u64> {
    if !src.exists() {
        return Ok(0);
    }
    std::fs::create_dir_all(dst)?;
    let mut count = 0u64;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        let src_path = entry.path();
        let dst_path = dst.join(&name);
        if src_path.is_dir() {
            count += copy_dir_if_empty(&src_path, &dst_path)?;
        } else if !dst_path.exists() {
            std::fs::copy(&src_path, &dst_path)?;
            count += 1;
        }
    }
    Ok(count)
}

/// 返回当前生效的媒体根目录（有自定义路径则用它，否则 fallback 到 Documents/FlowCloudAI）
#[tauri::command]
pub async fn setting_get_media_dir(
    app: AppHandle,
    state: State<'_, SettingsState>,
) -> Result<String, String> {
    let settings = state.settings.lock().await;

    if let Some(ref dir) = settings.media_dir {
        return Ok(dir.clone());
    }

    // 后备：Documents/FlowCloudAI
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("FlowCloudAI");

    Ok(dir.to_string_lossy().to_string())
}

/// 获取默认的数据库和插件目录路径
#[derive(serde::Serialize)]
pub struct DefaultPaths {
    pub db_path: String,
    pub plugins_path: String,
    pub backup_path: String,
}

#[tauri::command]
pub fn setting_get_default_paths(app: AppHandle) -> Result<DefaultPaths, String> {
    let data_root = default_data_root(&app);
    let db_path = data_root.join("db");
    Ok(DefaultPaths {
        db_path: db_path.to_string_lossy().to_string(),
        plugins_path: data_root.join("plugins").to_string_lossy().to_string(),
        backup_path: db_path.join("backup").to_string_lossy().to_string(),
    })
}

/// 确保 CSV 备份目录存在，并在系统文件管理器中打开。
#[tauri::command]
pub fn setting_open_backup_dir(app: AppHandle, path: String) -> Result<(), String> {
    let backup_dir = PathBuf::from(path);
    std::fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败：{}", e))?;
    app.opener()
        .open_path(backup_dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// 将主题配置导出到用户通过保存对话框选择的路径。
/// 注意：本命令是注册过的 IPC，webview 脚本可用任意 path+content 调用（任意写原语）。
/// 加固：禁止落地可执行/脚本类扩展名，避免被用于向启动目录等写入 .exe/.bat/.lnk。
#[tauri::command]
pub fn setting_export_theme_config(path: String, content: String) -> Result<(), String> {
    const BLOCKED_EXTS: &[&str] = &[
        "exe", "bat", "cmd", "com", "scr", "pif", "lnk", "ps1", "psm1", "vbs", "vbe", "js", "jse",
        "wsf", "wsh", "msi", "msp", "reg", "dll", "sys", "cpl", "jar", "hta", "gadget", "url",
    ];
    let export_path = PathBuf::from(path);
    if let Some(ext) = export_path.extension().and_then(|e| e.to_str()) {
        if BLOCKED_EXTS.contains(&ext.to_ascii_lowercase().as_str()) {
            return Err(format!("不允许导出为该类型文件：.{}", ext));
        }
    }
    if let Some(parent) = export_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建导出目录失败：{}", e))?;
    }
    std::fs::write(&export_path, content).map_err(|e| format!("写入主题配置失败：{}", e))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsBootstrap {
    pub settings: AppSettings,
    pub llm_plugins: Vec<PluginInfo>,
    pub image_plugins: Vec<PluginInfo>,
    pub tts_plugins: Vec<PluginInfo>,
    pub api_key_status: HashMap<String, bool>,
    pub media_dir: String,
    pub default_paths: DefaultPaths,
}

/// 设置页首屏聚合数据，减少多轮 IPC 和串行 API Key 检查。
#[tauri::command]
pub async fn setting_get_settings_bootstrap(
    app: AppHandle,
    settings_state: State<'_, SettingsState>,
    ai_state: State<'_, AiState>,
) -> Result<SettingsBootstrap, String> {
    let settings = setting_get_settings(app.clone(), settings_state.clone()).await?;
    let default_paths = setting_get_default_paths(app.clone())?;
    let media_dir = if let Some(dir) = &settings.media_dir {
        dir.clone()
    } else {
        app.path()
            .document_dir()
            .map_err(|e| e.to_string())?
            .join("FlowCloudAI")
            .to_string_lossy()
            .to_string()
    };

    let llm_plugins = list_plugins_for_kind(ai_state.inner(), "llm")
        .await
        .map_err(|e| e.to_string())?;
    let image_plugins = list_plugins_for_kind(ai_state.inner(), "image")
        .await
        .map_err(|e| e.to_string())?;
    let tts_plugins = list_plugins_for_kind(ai_state.inner(), "tts")
        .await
        .map_err(|e| e.to_string())?;
    let api_key_status = llm_plugins
        .iter()
        .chain(image_plugins.iter())
        .chain(tts_plugins.iter())
        .map(|plugin| (plugin.id.clone(), ApiKeyStore::get(&plugin.id).is_some()))
        .collect::<HashMap<_, _>>();

    Ok(SettingsBootstrap {
        settings,
        llm_plugins,
        image_plugins,
        tts_plugins,
        api_key_status,
        media_dir,
        default_paths,
    })
}

/// 返回后端核心状态是否已经就绪。
/// 前端启动时会先监听 `backend-ready`，再主动查询一次，避免错过早发事件后永久卡在启动页。
#[tauri::command]
pub fn setting_is_backend_ready(app: AppHandle) -> bool {
    app.try_state::<BackendReadyState>()
        .map(|state| state.is_ready())
        .unwrap_or(false)
}

#[tauri::command]
pub fn setting_get_backend_status(app: AppHandle) -> BackendStartupStatus {
    app.try_state::<BackendReadyState>()
        .map(|state| state.status())
        .unwrap_or(BackendStartupStatus {
            phase: "initializing".to_string(),
            message: None,
        })
}

// ── API Key 管理 ──────────────────────────────────────────────────────────────

/// 将 API Key 存入系统密钥链（不经过任何文件）
#[tauri::command]
pub fn setting_set_api_key(plugin_id: String, api_key: String) -> Result<(), String> {
    ApiKeyStore::set(&plugin_id, &api_key).map_err(|e| e.to_string())
}

/// 检查某插件是否已配置 API Key（不返回明文）
#[tauri::command]
pub fn setting_has_api_key(plugin_id: String) -> bool {
    ApiKeyStore::get(&plugin_id).is_some()
}

/// 从系统密钥链删除 API Key
#[tauri::command]
pub fn setting_delete_api_key(plugin_id: String) -> Result<(), String> {
    ApiKeyStore::delete(&plugin_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mobile_storage_policy_clears_all_path_overrides() {
        let mut settings = AppSettings {
            media_dir: Some("/custom/media".to_string()),
            db_path: Some("/old-container/app-data/db".to_string()),
            plugins_path: Some("/old-container/app-data/plugins".to_string()),
            backup_dir: Some("/old-container/app-data/db/backup".to_string()),
            ..AppSettings::default()
        };

        assert!(clear_mobile_storage_overrides(&mut settings));
        assert!(settings.media_dir.is_none());
        assert!(settings.db_path.is_none());
        assert!(settings.plugins_path.is_none());
        assert!(settings.backup_dir.is_none());
        assert!(!clear_mobile_storage_overrides(&mut settings));
    }
}
