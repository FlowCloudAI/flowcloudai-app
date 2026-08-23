//! 桌面系统文件打开请求的统一入口。
//!
//! Windows 的单实例参数与 macOS 的 `RunEvent::Opened` 都在这里归一化为队列；前端只消费
//! `.fcworld` / `.fcplug` 请求，不在系统事件回调中直接执行导入或安装，以保留业务确认边界。

use crate::BackendReadyState;
use serde::Serialize;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Url};

pub const DESKTOP_FILE_OPEN_PENDING_EVENT: &str = "desktop-file-open-pending";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopFileKind {
    Fcworld,
    Fcplug,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopFileOpenRequest {
    pub id: u64,
    pub kind: DesktopFileKind,
    pub path: String,
}

#[derive(Default)]
pub struct DesktopFileOpenState {
    pending: Mutex<VecDeque<DesktopFileOpenRequest>>,
    next_id: AtomicU64,
}

impl DesktopFileOpenState {
    fn enqueue_path(&self, path: &Path) -> Option<DesktopFileOpenRequest> {
        let canonical_path = path.canonicalize().ok()?;
        if !canonical_path.is_file() {
            return None;
        }
        let kind = classify_path(&canonical_path)?;
        let path = canonical_path.to_string_lossy().into_owned();
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        // 同一次系统打开可能同时经过平台事件与单实例参数，队列内按规范路径去重。
        if pending.iter().any(|request| request.path == path) {
            return None;
        }

        let request = DesktopFileOpenRequest {
            id: self.next_id.fetch_add(1, Ordering::Relaxed) + 1,
            kind,
            path,
        };
        pending.push_back(request.clone());
        Some(request)
    }

    fn take_all(&self) -> Vec<DesktopFileOpenRequest> {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain(..)
            .collect()
    }
}

fn classify_path(path: &Path) -> Option<DesktopFileKind> {
    let extension = path.extension()?.to_str()?;
    if extension.eq_ignore_ascii_case("fcworld") {
        Some(DesktopFileKind::Fcworld)
    } else if extension.eq_ignore_ascii_case("fcplug") {
        Some(DesktopFileKind::Fcplug)
    } else {
        None
    }
}

fn resolve_cli_argument(argument: &str, cwd: &Path) -> Option<PathBuf> {
    if let Ok(url) = Url::parse(argument)
        && url.scheme() == "file"
    {
        return url.to_file_path().ok();
    }

    let path = PathBuf::from(argument);
    Some(if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    })
}

fn queue_paths<R: Runtime>(app: &AppHandle<R>, paths: impl IntoIterator<Item = PathBuf>) -> usize {
    let Some(state) = app.try_state::<DesktopFileOpenState>() else {
        log::warn!("桌面文件打开状态尚未初始化，忽略系统请求");
        return 0;
    };

    let mut queued = 0;
    for path in paths {
        if let Some(request) = state.enqueue_path(&path) {
            log::info!(
                "桌面文件打开请求已排队 kind={:?} path={}",
                request.kind,
                request.path
            );
            queued += 1;
        }
    }

    if queued > 0 {
        if let Err(error) = app.emit(DESKTOP_FILE_OPEN_PENDING_EVENT, ()) {
            log::warn!("发送桌面文件打开提示事件失败: {}", error);
        }
        focus_main_window_if_ready(app);
    }
    queued
}

fn focus_main_window_if_ready<R: Runtime>(app: &AppHandle<R>) {
    let backend_ready = app
        .try_state::<BackendReadyState>()
        .is_some_and(|state| state.is_ready());
    if !backend_ready {
        return;
    }

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Err(error) = window.show() {
        log::warn!("显示桌面主窗口失败: {}", error);
    }
    if let Err(error) = window.unminimize() {
        log::warn!("恢复桌面主窗口失败: {}", error);
    }
    if let Err(error) = window.set_focus() {
        log::warn!("聚焦桌面主窗口失败: {}", error);
    }
}

/// 处理 Windows/Linux 首次启动或第二实例传入的命令行参数。
pub fn queue_cli_arguments<R: Runtime>(
    app: &AppHandle<R>,
    arguments: Vec<String>,
    cwd: &Path,
) -> usize {
    let paths = arguments
        .into_iter()
        .skip(1)
        .filter_map(|argument| resolve_cli_argument(&argument, cwd));
    queue_paths(app, paths)
}

/// 处理 macOS 通过 Launch Services 交付的文件 URL。
#[cfg(target_os = "macos")]
pub fn queue_opened_urls<R: Runtime>(app: &AppHandle<R>, urls: Vec<Url>) -> usize {
    queue_paths(
        app,
        urls.into_iter().filter_map(|url| url.to_file_path().ok()),
    )
}

/// 前端挂载监听器后主动拉取，避免冷启动期间的系统事件先于 WebView 消费者到达。
#[tauri::command]
pub fn desktop_take_pending_file_open_requests(
    state: State<'_, DesktopFileOpenState>,
) -> Vec<DesktopFileOpenRequest> {
    state.take_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn classifies_supported_extensions_case_insensitively() {
        assert_eq!(
            classify_path(Path::new("example.FCWORLD")),
            Some(DesktopFileKind::Fcworld)
        );
        assert_eq!(
            classify_path(Path::new("plugin.FcPlUg")),
            Some(DesktopFileKind::Fcplug)
        );
        assert_eq!(classify_path(Path::new("notes.txt")), None);
    }

    #[test]
    fn resolves_relative_cli_arguments_against_sender_cwd() {
        assert_eq!(
            resolve_cli_argument("exports/example.fcworld", Path::new("/workspace")),
            Some(PathBuf::from("/workspace/exports/example.fcworld"))
        );
    }

    #[test]
    fn resolves_file_url_arguments_to_local_paths() {
        let path = std::env::current_dir()
            .expect("resolve test cwd")
            .join("example.fcplug");
        let url = Url::from_file_path(&path).expect("create test file URL");
        assert_eq!(
            resolve_cli_argument(url.as_str(), Path::new("unused")),
            Some(path)
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn keeps_windows_drive_and_unc_paths_absolute() {
        let cwd = Path::new(r"D:\FlowCloudAI");
        let drive_path = PathBuf::from(r"C:\Users\Tester\Desktop\world.fcworld");
        let unc_path = PathBuf::from(r"\\server\share\plugin.fcplug");
        assert_eq!(
            resolve_cli_argument(drive_path.to_str().unwrap(), cwd),
            Some(drive_path)
        );
        assert_eq!(
            resolve_cli_argument(unc_path.to_str().unwrap(), cwd),
            Some(unc_path)
        );
    }

    #[test]
    fn queues_existing_supported_file_once_until_consumed() {
        let path = std::env::temp_dir().join(format!(
            "flowcloudai-desktop-open-{}.fcplug",
            Uuid::new_v4()
        ));
        std::fs::write(&path, b"test").expect("create desktop file-open fixture");

        let state = DesktopFileOpenState::default();
        let first = state.enqueue_path(&path).expect("queue supported fixture");
        assert_eq!(first.kind, DesktopFileKind::Fcplug);
        assert!(state.enqueue_path(&path).is_none());
        assert_eq!(state.take_all(), vec![first]);

        std::fs::remove_file(path).expect("remove desktop file-open fixture");
    }
}
