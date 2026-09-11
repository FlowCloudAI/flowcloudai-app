use super::common::*;

/// 前端传入的任务上下文 DTO。
///
/// 所有字段可选——只传有意义的字段，未传的字段在后端以 Default 填充。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContextDto {
    pub project_id: Option<String>,
    pub task_type: Option<String>,
    pub attributes: Option<HashMap<String, String>>,
    pub instruction_attributes: Option<HashMap<String, String>>,
    pub flags: Option<HashMap<String, bool>>,
}

pub(super) async fn resolve_task_context(
    settings_state: &SettingsState,
    ctx: TaskContextDto,
) -> TaskContext {
    let mut flags = ctx.flags.unwrap_or_default();
    if flags.get("auto_confirm_writes").copied().unwrap_or(false) {
        let writer_mode_enabled = {
            let settings = settings_state.settings.lock().await;
            settings.llm.writer_mode_enabled
        };
        if !writer_mode_enabled {
            flags.insert("auto_confirm_writes".to_string(), false);
        }
    }
    TaskContext {
        project_id: ctx.project_id,
        task_type: ctx.task_type.unwrap_or_default(),
        attributes: ctx.attributes.unwrap_or_default(),
        instruction_attributes: ctx.instruction_attributes.unwrap_or_default(),
        flags,
        ..Default::default()
    }
}

/// 更新指定会话的编排上下文（下一轮对话开始前生效）。
///
/// Session 每轮调用 `Orchestrate::assemble` 前会通过 `try_recv` 拉取最新值，
/// 多次调用只保留最后一次——前端可以放心高频推送（如 tab 切换时）。
#[tauri::command]
pub async fn ai_set_task_context(
    ai_state: State<'_, AiState>,
    settings_state: State<'_, SettingsState>,
    session_id: String,
    ctx: TaskContextDto,
) -> Result<(), ApiError> {
    let context = resolve_task_context(settings_state.inner(), ctx).await;
    log::info!(
        "[ai_set_task_context][recv] session_id={} project_id={:?} task_type={} attributes={} instruction_attributes={} flags={}",
        session_id,
        context.project_id,
        context.task_type,
        context.attributes.len(),
        context.instruction_attributes.len(),
        context.flags.len()
    );
    let handle = {
        let sessions = ai_state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| entry.handle.clone())
            .ok_or_else(|| {
                ApiError::new(
                    flowcloudai_client::ErrorCode::LlmSessionNotFound,
                    format!("Session '{}' 不存在", session_id),
                )
                .with_kv("session_id", session_id.clone())
            })?
    };

    let result = handle.set_task_context(context).await;
    match &result {
        Ok(()) => log::info!("[ai_set_task_context][queued] session_id={}", session_id),
        Err(error) => log::warn!(
            "[ai_set_task_context][failed] session_id={} error={}",
            session_id,
            error
        ),
    }
    result.map_err(ApiError::internal)
}
