use super::common::*;
use crate::senses::app_sense::AppSense;
use flowcloudai_client::ErrorCode;

const LEGACY_DEFAULT_MAX_TOKENS: i64 = 2000;
const TOOL_SAFE_DEFAULT_MAX_TOKENS: i64 = 8192;

/// 创建 LLM 会话并启动后台事件循环。
///
/// 创建后立即可通过 `ai_send_message` 发送消息。
/// 事件通过 Tauri 事件推送到前端：
///
/// - `"ai:ready"`        `{ session_id, run_id }`                      —— 会话就绪，等待用户输入
/// - `"ai:delta"`        `{ session_id, run_id, text }`                —— AI 生成内容片段
/// - `"ai:reasoning"`    `{ session_id, run_id, text }`                —— 思考过程片段
/// - `"ai:tool_call"`    `{ session_id, run_id, index, name }`         —— AI 调用工具
/// - `"ai:turn_end"`     `{ session_id, run_id, status, usage }`       —— 对话结束
/// - `"ai:error"`        `{ session_id, run_id, error }`               —— 发生错误
#[tauri::command]
pub async fn ai_create_llm_session(
    app: AppHandle,
    ai_state: State<'_, AiState>,
    paths: State<'_, PathsState>,
    settings_state: State<'_, SettingsState>,
    session_id: String,
    plugin_id: String,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
    max_tool_rounds: Option<i32>,
    conversation_id: Option<String>,
    client_trace_id: Option<String>,
    settings: Option<StoredConversationSettings>,
    tool_access: Option<String>,
    web_search_enabled: Option<bool>,
) -> Result<CreateLlmSessionResult, ApiError> {
    let trace_id = client_trace_id.as_deref().unwrap_or("none");
    let global_llm_defaults = {
        let settings = settings_state.settings.lock().await;
        settings.llm.clone()
    };
    log::info!(
        "[ai_create_llm_session][recv] trace_id={} session_id={} plugin_id={} model={:?} conversation_id={:?} temperature={:?} max_tokens={:?} max_tool_rounds={:?} tool_access={:?} web_search_enabled={:?}",
        trace_id,
        session_id,
        plugin_id,
        model,
        conversation_id,
        temperature,
        max_tokens,
        max_tool_rounds,
        tool_access,
        web_search_enabled
    );
    let api_key = match ApiKeyStore::get(&plugin_id) {
        Some(api_key) => api_key,
        None => {
            log::warn!(
                "[ai_create_llm_session][missing_api_key] trace_id={} session_id={} plugin_id={}",
                trace_id,
                session_id,
                plugin_id
            );
            return Err(ApiError::new(
                ErrorCode::AuthApiKeyMissing,
                format!("插件 '{}' 未配置 API Key，请在设置中配置", plugin_id),
            )
            .with_kv("plugin_id", plugin_id.clone()));
        }
    };

    log::info!(
        "[ai_create_llm_session][lock_client_start] trace_id={} session_id={} plugin_id={}",
        trace_id,
        session_id,
        plugin_id
    );
    let mut restored_head = None;
    let mut restored_model = None;
    let mut restored_settings = None;
    let mut restored_history = None;
    let mut restored_context_snapshots = None;
    let resolved_conversation_id = if let Some(conv_id) = conversation_id.as_deref() {
        let conversation = chat_store_get_conversation(paths.inner(), conv_id)
            .map_err(ApiError::internal)?
            .ok_or_else(|| {
                ApiError::new(
                    ErrorCode::LlmSessionNotFound,
                    format!("未找到会话：{}", conv_id),
                )
                .with_kv("conversation_id", conv_id.to_string())
            })?;
        restored_head = conversation.head;
        restored_model = Some(conversation.meta.model.clone());
        restored_settings = Some(conversation.settings.clone());
        restored_context_snapshots = Some(stored_conversation_to_runtime_context_snapshots(
            &conversation,
        ));
        restored_history = Some(stored_conversation_to_runtime_seeds(&conversation));
        conversation.meta.id
    } else {
        session_id.clone()
    };

    let model_to_apply = model
        .clone()
        .or_else(|| restored_model.filter(|m| !m.is_empty() && m != "default"));
    let resolved_model = model_to_apply
        .clone()
        .unwrap_or_else(|| "default".to_string());

    let client = ai_state.client.lock().await;
    log::info!(
        "[ai_create_llm_session][lock_client_done] trace_id={} session_id={} plugin_id={}",
        trace_id,
        session_id,
        plugin_id
    );
    let registry = client.tool_registry().clone();
    let (config, calibration_key) = build_llm_session_config(
        &client,
        &plugin_id,
        model_to_apply.as_deref(),
        max_tool_rounds.map(|rounds| rounds as usize),
        &global_llm_defaults,
    );
    log::info!(
        "[ai_create_llm_session][create_start] trace_id={} session_id={} plugin_id={} conversation_id={} restored={}",
        trace_id,
        session_id,
        plugin_id,
        resolved_conversation_id,
        restored_history.is_some()
    );
    let mut session = client
        .create_llm_session(&plugin_id, &api_key, Some(config))
        .map_err(|e| {
            log::error!(
                "[ai_create_llm_session][create_failed] trace_id={} session_id={} plugin_id={} error={}",
                trace_id,
                session_id,
                plugin_id,
                e
            );
            ApiError::from(e)
        })?;
    drop(client);

    if let Some(history) = restored_history {
        session.preload_history(history, restored_head);
    }
    if let Some(context_snapshots) = restored_context_snapshots {
        session.preload_context_snapshots(context_snapshots);
    }
    let requested_tool_access = tool_access.as_deref().unwrap_or("assistant");
    let effective_tool_access =
        if requested_tool_access == "writer" && !global_llm_defaults.writer_mode_enabled {
            "assistant"
        } else if matches!(requested_tool_access, "reader" | "assistant" | "writer") {
            requested_tool_access
        } else {
            "assistant"
        };
    let allow_web_tools = web_search_enabled.unwrap_or(false);
    let sense = AppSense::new(Some(global_llm_defaults.app_sense_custom_prompt.clone()));
    let whitelist = Some(match effective_tool_access {
        "reader" => AppSense::reader_tool_whitelist(allow_web_tools),
        "assistant" | "writer" => AppSense::assistant_tool_whitelist(allow_web_tools),
        _ => AppSense::assistant_tool_whitelist(allow_web_tools),
    });
    session.load_sense(sense).await?;
    session.set_orchestrator(Box::new(
        DefaultOrchestrator::new(registry).with_whitelist(whitelist),
    ));
    let runtime_settings = settings.as_ref().or(restored_settings.as_ref());

    if let Some(m) = model_to_apply {
        session.set_model(&m).await;
    }
    let temperature_to_apply = temperature
        .or_else(|| runtime_settings.map(|settings| settings.temperature))
        .unwrap_or(global_llm_defaults.temperature)
        .clamp(0.0, 2.0);
    let top_p_to_apply = runtime_settings
        .map(|settings| settings.top_p)
        .unwrap_or(global_llm_defaults.top_p)
        .clamp(0.0, 1.0);
    let frequency_penalty_to_apply = runtime_settings
        .map(|settings| {
            if settings.frequency_penalty_enabled {
                settings.frequency_penalty
            } else {
                0.0
            }
        })
        .unwrap_or(global_llm_defaults.frequency_penalty)
        .clamp(-2.0, 2.0);
    let presence_penalty_to_apply = runtime_settings
        .map(|settings| {
            if settings.presence_penalty_enabled {
                settings.presence_penalty
            } else {
                0.0
            }
        })
        .unwrap_or(global_llm_defaults.presence_penalty)
        .clamp(-2.0, 2.0);
    let configured_max_tokens = max_tokens.unwrap_or(global_llm_defaults.max_tokens).max(1);
    let max_tokens_to_apply = if max_tokens.is_none()
        && configured_max_tokens <= LEGACY_DEFAULT_MAX_TOKENS
    {
        log::info!(
            "[ai_create_llm_session][max_tokens_legacy_default_upgraded] trace_id={} session_id={} configured={} applied={}",
            trace_id,
            session_id,
            configured_max_tokens,
            TOOL_SAFE_DEFAULT_MAX_TOKENS
        );
        TOOL_SAFE_DEFAULT_MAX_TOKENS
    } else {
        configured_max_tokens
    };
    session.set_temperature(temperature_to_apply).await;
    session.set_top_p(top_p_to_apply).await;
    session
        .set_frequency_penalty(frequency_penalty_to_apply)
        .await;
    session
        .set_presence_penalty(presence_penalty_to_apply)
        .await;
    session.set_max_tokens(max_tokens_to_apply).await;
    session.set_stream(true).await;
    log::info!(
        "[ai_create_llm_session][configured] trace_id={} session_id={} plugin_id={} model={}",
        trace_id,
        session_id,
        plugin_id,
        resolved_model
    );
    let (input_tx, input_rx) = mpsc::channel::<String>(32);
    log::info!(
        "[ai_create_llm_session][try_run_start] trace_id={} session_id={} conversation_id={}",
        trace_id,
        session_id,
        resolved_conversation_id
    );
    let (event_stream, handle) = session.try_run(input_rx).map_err(|e| {
        log::error!(
            "[ai_create_llm_session][try_run_failed] trace_id={} session_id={} conversation_id={} error={}",
            trace_id,
            session_id,
            resolved_conversation_id,
            e
        );
        ApiError::from(e)
    })?;
    let run_id = Uuid::new_v4().to_string();
    let conversation_settings = settings.clone().or(restored_settings);
    log::info!(
        "[ai_create_llm_session][run_started] trace_id={} conversation_id={} session_id={} run_id={} plugin_id={} model={}",
        trace_id,
        resolved_conversation_id,
        session_id,
        run_id,
        plugin_id,
        resolved_model
    );

    let persistence = SessionPersistence {
        conversation_id: resolved_conversation_id.clone(),
        plugin_id: plugin_id.clone(),
        model: resolved_model.clone(),
        settings: conversation_settings,
        handle: handle.clone(),
    };

    {
        let mut sessions = ai_state.sessions.lock().await;
        sessions.insert(
            session_id.clone(),
            crate::SessionEntry {
                run_id: run_id.clone(),
                input_tx: Some(input_tx),
                handle,
                kind: AiSessionKind::General,
                model: resolved_model.clone(),
                plugin_id: plugin_id.clone(),
            },
        );
        log::info!(
            "[ai_create_llm_session][registered] trace_id={} session_id={} run_id={} active_count={}",
            trace_id,
            session_id,
            run_id,
            sessions.len()
        );
    }
    ai_state
        .conversation_owners
        .lock()
        .await
        .insert(resolved_conversation_id.clone(), session_id.clone());
    spawn_session_event_loop(
        app,
        session_id.clone(),
        run_id.clone(),
        calibration_key,
        persistence,
        event_stream,
    );

    Ok(CreateLlmSessionResult {
        session_id,
        conversation_id: resolved_conversation_id,
        run_id,
    })
}

/// 将消息树 head 移动到指定节点（重说 / 分支 / 历史回退）
///
/// node_id 来自 `ai:turn_begin` 或 `ai:turn_end` 事件中的 `node_id` 字段。
/// 在会话等待用户输入期间生效：
/// - 目标节点 role 为 "user" → drive loop 立即继续（免去下一次输入）
/// - 目标节点 role 为 "assistant" → drive loop 继续等待用户输入
#[tauri::command]
pub async fn ai_checkout(
    ai_state: State<'_, AiState>,
    session_id: String,
    node_id: u64,
) -> Result<(), ApiError> {
    let handle = {
        let sessions = ai_state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| entry.handle.clone())
            .ok_or_else(|| {
                ApiError::new(
                    ErrorCode::LlmSessionNotFound,
                    format!("Session '{}' 不存在", session_id),
                )
                .with_kv("session_id", session_id.clone())
            })?
    };

    handle.checkout(node_id).await.map_err(ApiError::internal)
}

/// 返回运行时会话的完整分支树，用于前端分支导航。
#[tauri::command]
pub async fn ai_get_conversation_tree(
    ai_state: State<'_, AiState>,
    session_id: String,
) -> Result<Vec<ConversationNode>, ApiError> {
    let handle = {
        let sessions = ai_state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| entry.handle.clone())
            .ok_or_else(|| {
                ApiError::new(
                    ErrorCode::LlmSessionNotFound,
                    format!("Session '{}' 不存在", session_id),
                )
                .with_kv("session_id", session_id.clone())
            })?
    };

    Ok(handle.get_all_nodes().await)
}

/// 切换会话使用的插件（下一轮对话生效）
#[tauri::command]
pub async fn ai_switch_plugin(
    ai_state: State<'_, AiState>,
    session_id: String,
    plugin_id: String,
) -> Result<(), ApiError> {
    let api_key = ApiKeyStore::get(&plugin_id).ok_or_else(|| {
        ApiError::new(
            ErrorCode::AuthApiKeyMissing,
            format!("插件 '{}' 未配置 API Key，请在设置中配置", plugin_id),
        )
        .with_kv("plugin_id", plugin_id.clone())
    })?;

    let (handle, run_id) = {
        let sessions = ai_state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| (entry.handle.clone(), entry.run_id.clone()))
            .ok_or_else(|| {
                ApiError::new(
                    ErrorCode::LlmSessionNotFound,
                    format!("Session '{}' 不存在", session_id),
                )
                .with_kv("session_id", session_id.clone())
            })?
    };

    handle
        .switch_plugin(&plugin_id, &api_key)
        .await
        .map_err(ApiError::internal)?;
    if let Some(entry) = ai_state
        .sessions
        .lock()
        .await
        .get_mut(&session_id)
        .filter(|entry| entry.run_id == run_id)
    {
        entry.plugin_id = plugin_id;
    }
    Ok(())
}

/// 运行时会话参数更新（所有字段可选，只更新传入的字段）
#[tauri::command]
pub async fn ai_update_session(
    ai_state: State<'_, AiState>,
    session_id: String,
    params: serde_json::Value,
) -> Result<(), ApiError> {
    use flowcloudai_client::ThinkingType;
    use serde::Deserialize;

    #[derive(Debug, Default, Deserialize)]
    #[serde(default)]
    struct SessionUpdateParams {
        model: Option<Option<String>>,
        #[serde(rename = "temperature")]
        temperature: Option<Option<f64>>,
        #[serde(rename = "maxTokens")]
        max_tokens: Option<Option<i64>>,
        stream: Option<Option<bool>>,
        thinking: Option<Option<bool>>,
        #[serde(rename = "frequencyPenalty")]
        frequency_penalty: Option<Option<f64>>,
        #[serde(rename = "presencePenalty")]
        presence_penalty: Option<Option<f64>>,
        #[serde(rename = "topP")]
        top_p: Option<Option<f64>>,
        stop: Option<Option<Vec<String>>>,
        #[serde(rename = "responseFormat")]
        response_format: Option<serde_json::Value>,
        n: Option<Option<i32>>,
        #[serde(rename = "toolChoice")]
        tool_choice: Option<Option<String>>,
        logprobs: Option<Option<bool>>,
        #[serde(rename = "topLogprobs")]
        top_logprobs: Option<Option<i64>>,
    }

    fn validate_f64(value: f64, name: &str, min: f64, max: f64) -> Result<(), ApiError> {
        if !value.is_finite() {
            return Err(ApiError::new(
                ErrorCode::ValidationFormatError,
                format!("参数 '{}' 不能是 NaN 或 Infinity", name),
            )
            .with_kv("field", name.to_string()));
        }
        if value < min || value > max {
            return Err(ApiError::new(
                ErrorCode::ValidationFormatError,
                format!("参数 '{}' 必须在 {}-{} 之间", name, min, max),
            )
            .with_kv("field", name.to_string())
            .with_kv("min", min)
            .with_kv("max", max));
        }
        Ok(())
    }

    let params: SessionUpdateParams = serde_json::from_value(params).map_err(|e| {
        ApiError::new(
            ErrorCode::ValidationFormatError,
            format!("参数解析失败: {}", e),
        )
    })?;

    if let Some(Some(t)) = params.temperature {
        validate_f64(t, "temperature", 0.0, 2.0)?;
    }
    if let Some(Some(fp)) = params.frequency_penalty {
        validate_f64(fp, "frequencyPenalty", -2.0, 2.0)?;
    }
    if let Some(Some(pp)) = params.presence_penalty {
        validate_f64(pp, "presencePenalty", -2.0, 2.0)?;
    }
    if let Some(Some(tp)) = params.top_p {
        validate_f64(tp, "topP", 0.0, 1.0)?;
    }
    if let Some(Some(mt)) = params.max_tokens {
        if mt < 1 {
            return Err(ApiError::new(
                ErrorCode::ValidationFormatError,
                "参数 'maxTokens' 必须大于 0",
            )
            .with_kv("field", "maxTokens"));
        }
    }
    if let Some(Some(n)) = params.n {
        if n < 1 {
            return Err(
                ApiError::new(ErrorCode::ValidationFormatError, "参数 'n' 必须大于 0")
                    .with_kv("field", "n"),
            );
        }
    }
    if let Some(Some(tl)) = params.top_logprobs {
        if tl < 0 {
            return Err(ApiError::new(
                ErrorCode::ValidationFormatError,
                "参数 'topLogprobs' 不能为负数",
            )
            .with_kv("field", "topLogprobs"));
        }
    }
    let changed_fields = [
        params.model.is_some().then_some("model"),
        params.temperature.is_some().then_some("temperature"),
        params.max_tokens.is_some().then_some("maxTokens"),
        params.stream.is_some().then_some("stream"),
        params.thinking.is_some().then_some("thinking"),
        params
            .frequency_penalty
            .is_some()
            .then_some("frequencyPenalty"),
        params
            .presence_penalty
            .is_some()
            .then_some("presencePenalty"),
        params.top_p.is_some().then_some("topP"),
        params.stop.is_some().then_some("stop"),
        params.response_format.is_some().then_some("responseFormat"),
        params.n.is_some().then_some("n"),
        params.tool_choice.is_some().then_some("toolChoice"),
        params.logprobs.is_some().then_some("logprobs"),
        params.top_logprobs.is_some().then_some("topLogprobs"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    log::info!(
        "[ai_update_session][recv] session_id={} fields={:?}",
        session_id,
        changed_fields
    );

    let (handle, run_id) = {
        let sessions = ai_state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| (entry.handle.clone(), entry.run_id.clone()))
            .ok_or_else(|| {
                ApiError::new(
                    ErrorCode::LlmSessionNotFound,
                    format!("Session '{}' 不存在", session_id),
                )
                .with_kv("session_id", session_id.clone())
            })?
    };

    let updated_model = params.model.clone().flatten();
    handle
        .update(|req| {
            if let Some(v) = params.model {
                if let Some(v) = v {
                    req.model = v;
                }
            }
            if let Some(v) = params.temperature {
                req.temperature = v;
            }
            if let Some(v) = params.max_tokens {
                req.max_tokens = v;
            }
            if let Some(v) = params.stream {
                req.stream = v;
            }
            if let Some(v) = params.thinking {
                req.thinking = v.map(|flag| {
                    if flag {
                        ThinkingType::enabled()
                    } else {
                        ThinkingType::disabled()
                    }
                });
            }
            if let Some(v) = params.frequency_penalty {
                req.frequency_penalty = v;
            }
            if let Some(v) = params.presence_penalty {
                req.presence_penalty = v;
            }
            if let Some(v) = params.top_p {
                req.top_p = v;
            }
            if let Some(v) = params.stop {
                req.stop = v;
            }
            if let Some(v) = params.response_format {
                req.response_format = Some(v);
            }
            if let Some(v) = params.n {
                req.n = v;
            }
            if let Some(v) = params.tool_choice {
                req.tool_choice = v;
            }
            if let Some(v) = params.logprobs {
                req.logprobs = v;
            }
            if let Some(v) = params.top_logprobs {
                req.top_logprobs = v;
            }
        })
        .await;
    if let Some(model) = updated_model {
        if let Some(entry) = ai_state
            .sessions
            .lock()
            .await
            .get_mut(&session_id)
            .filter(|entry| entry.run_id == run_id)
        {
            entry.model = model;
        }
    }
    log::info!(
        "[ai_update_session][applied] session_id={} fields={:?}",
        session_id,
        changed_fields
    );

    Ok(())
}

fn message_log_preview(message: &str) -> String {
    let normalized = message.split_whitespace().collect::<Vec<_>>().join(" ");
    let preview: String = normalized.chars().take(120).collect();
    if normalized.chars().count() > 120 {
        format!("{}...", preview)
    } else {
        preview
    }
}

/// 向指定会话发送用户消息
#[tauri::command]
pub async fn ai_send_message(
    ai_state: State<'_, AiState>,
    settings_state: State<'_, SettingsState>,
    session_id: String,
    message: String,
    client_trace_id: Option<String>,
    ctx: Option<super::task_context::TaskContextDto>,
) -> Result<(), ApiError> {
    let trace_id = client_trace_id.as_deref().unwrap_or("none");
    let message_bytes = message.len();
    let message_chars = message.chars().count();
    let preview = message_log_preview(&message);
    log::info!(
        "[ai_send_message][recv] trace_id={} session_id={} bytes={} chars={} preview={:?}",
        trace_id,
        session_id,
        message_bytes,
        message_chars,
        preview
    );

    let submitted_context = match ctx {
        Some(ctx) => {
            Some(super::task_context::resolve_task_context(settings_state.inner(), ctx).await)
        }
        None => None,
    };

    let (handle, run_id, plugin_id, model, kind, channel_capacity, channel_max_capacity) = {
        let sessions = ai_state.sessions.lock().await;
        let active_count = sessions.len();
        let Some(entry) = sessions.get(&session_id) else {
            let active_session_ids = sessions.keys().cloned().collect::<Vec<_>>();
            log::warn!(
                "[ai_send_message][missing_session] trace_id={} session_id={} active_count={} active_session_ids={:?}",
                trace_id,
                session_id,
                active_count,
                active_session_ids
            );
            return Err(ApiError::new(
                ErrorCode::LlmSessionNotFound,
                format!("Session '{}' 不存在", session_id),
            )
            .with_kv("session_id", session_id.clone()));
        };
        let Some(input_tx) = entry.input_tx.as_ref() else {
            return Err(ApiError::new(
                ErrorCode::LlmSessionClosed,
                format!("Session '{}' 已关闭", session_id),
            )
            .with_kv("session_id", session_id.clone()));
        };
        log::info!(
            "[ai_send_message][session_found] trace_id={} session_id={} run_id={} kind={:?} plugin_id={} model={} active_count={} channel_capacity={} channel_max_capacity={}",
            trace_id,
            session_id,
            entry.run_id,
            entry.kind,
            entry.plugin_id,
            entry.model,
            active_count,
            input_tx.capacity(),
            input_tx.max_capacity()
        );
        (
            entry.handle.clone(),
            entry.run_id.clone(),
            entry.plugin_id.clone(),
            entry.model.clone(),
            entry.kind.clone(),
            input_tx.capacity(),
            input_tx.max_capacity(),
        )
    };

    handle
        .submit_user_turn(message, submitted_context)
        .await
        .map_err(|error| {
            log::error!(
                "[ai_send_message][submit_failed] trace_id={} session_id={} run_id={} kind={:?} plugin_id={} model={} error={}",
                trace_id,
                session_id,
                run_id,
                kind,
                plugin_id,
                model,
                error
            );
            ApiError::new(ErrorCode::LlmSessionClosed, error)
                .with_kv("session_id", session_id.clone())
        })?;
    log::info!(
        "[ai_send_message][queued] trace_id={} session_id={} run_id={} kind={:?} plugin_id={} model={} bytes={} chars={} previous_capacity={} previous_max_capacity={} current_capacity={}",
        trace_id,
        session_id,
        run_id,
        kind,
        plugin_id,
        model,
        message_bytes,
        message_chars,
        channel_capacity,
        channel_max_capacity,
        channel_capacity
    );
    Ok(())
}

/// 从当前未完成的助手节点继续生成，不写入伪造的用户消息。
#[tauri::command]
pub async fn ai_continue_generation(
    ai_state: State<'_, AiState>,
    session_id: String,
    node_id: u64,
    client_trace_id: Option<String>,
) -> Result<(), ApiError> {
    let trace_id = client_trace_id.as_deref().unwrap_or("none");
    let (handle, run_id) = {
        let sessions = ai_state.sessions.lock().await;
        let entry = sessions.get(&session_id).ok_or_else(|| {
            ApiError::new(
                ErrorCode::LlmSessionNotFound,
                format!("Session '{}' 不存在", session_id),
            )
            .with_kv("session_id", session_id.clone())
        })?;
        (entry.handle.clone(), entry.run_id.clone())
    };

    handle.continue_generation(node_id).await.map_err(|error| {
        ApiError::new(ErrorCode::ValidationFormatError, "无法继续当前回复")
            .with_kv("session_id", session_id.clone())
            .with_kv("node_id", node_id)
            .with_kv("source", error)
    })?;
    log::info!(
        "[ai_continue_generation][queued] trace_id={} session_id={} run_id={} node_id={}",
        trace_id,
        session_id,
        run_id,
        node_id
    );
    Ok(())
}

/// 取消当前进行中的 LLM 轮次
#[tauri::command]
pub async fn ai_cancel_session(
    ai_state: State<'_, AiState>,
    session_id: String,
) -> Result<(), ApiError> {
    let handle = {
        let sessions = ai_state.sessions.lock().await;
        sessions
            .get(&session_id)
            .map(|entry| entry.handle.clone())
            .ok_or_else(|| {
                ApiError::new(
                    ErrorCode::LlmSessionNotFound,
                    format!("Session '{}' 不存在", session_id),
                )
                .with_kv("session_id", session_id.clone())
            })?
    };
    handle.cancel();
    Ok(())
}

/// 关闭并释放 LLM 会话
#[tauri::command]
pub async fn ai_close_session(
    ai_state: State<'_, AiState>,
    session_id: String,
) -> Result<(), ApiError> {
    let mut sessions = ai_state.sessions.lock().await;
    if let Some(entry) = sessions.get_mut(&session_id)
        && entry.input_tx.is_some()
    {
        entry.handle.cancel();
        entry.input_tx.take();
    }
    Ok(())
}

/// 关闭并释放所有 LLM 会话
#[tauri::command]
pub async fn ai_close_all_sessions(ai_state: State<'_, AiState>) -> Result<usize, ApiError> {
    let mut sessions = ai_state.sessions.lock().await;
    let mut count = 0;
    for entry in sessions.values_mut() {
        if entry.input_tx.is_some() {
            entry.handle.cancel();
            entry.input_tx.take();
            count += 1;
        }
    }
    Ok(count)
}
