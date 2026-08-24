//! 暴露给 WebView 的最小命令面；原生调度与平台分支留在插件状态中。

use tauri::{AppHandle, Manager, Runtime};

use crate::{CapturedPhoto, FlowCamera};

#[tauri::command]
pub(crate) async fn capture<R: Runtime>(app: AppHandle<R>) -> crate::Result<CapturedPhoto> {
    app.state::<FlowCamera<R>>().capture().await
}

#[tauri::command]
pub(crate) async fn discard<R: Runtime>(app: AppHandle<R>, temp_path: String) -> crate::Result<()> {
    app.state::<FlowCamera<R>>().discard(&temp_path).await
}
