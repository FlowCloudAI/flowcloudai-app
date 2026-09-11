use crate::AppState;
use crate::ai_services::artifact_parser::parse_json_value_artifact;
use crate::ai_services::context_builders::{build_contradiction_prompt, build_task_context};
use crate::ai_services::contradiction_loader::{
    ContradictionLoadRequest, load_contradiction_corpus,
};
use crate::ai_services::world_check::world_check_definition;
use crate::apis::ai_client::{
    CreateLlmSessionResult, EventDelta, EventError, EventReady, EventRequestUsage, EventToolCall,
    EventToolResult, EventTurnBegin, EventTurnEnd, build_llm_session_config, cleanup_session_state,
    save_api_usage, save_token_calibration, turn_status_error, turn_status_str,
};
use crate::reports::contradiction_report::ContradictionReport;
use crate::reports::world_check_report::{WorldCheckKind, WorldCheckReport};
use crate::senses::contradiction_sense::ContradictionSense;
use crate::{
    AiSessionKind, AiState, ApiError, ApiKeyStore, ContradictionSessionBinding, SettingsState,
};
use flowcloudai_client::{DefaultOrchestrator, ErrorCode, SessionEvent, TurnStatus};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContradictionSessionRequest {
    pub session_id: String,
    pub plugin_id: String,
    #[serde(flatten)]
    pub load: ContradictionLoadRequest,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
    pub max_tool_rounds: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredContradictionReport {
    pub report_id: String,
    pub session_id: String,
    pub conversation_id: String,
    pub plugin_id: String,
    pub model: Option<String>,
    pub project_id: String,
    pub project_name: String,
    pub created_at: String,
    pub scope_summary: String,
    pub source_entry_ids: Vec<String>,
    pub truncated: bool,
    pub report: ContradictionReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContradictionReportHistoryItem {
    pub report_id: String,
    pub conversation_id: String,
    pub plugin_id: String,
    pub model: Option<String>,
    pub project_id: String,
    pub project_name: String,
    pub created_at: String,
    pub scope_summary: String,
    pub source_entry_ids: Vec<String>,
    pub truncated: bool,
    pub issue_count: usize,
    pub unresolved_count: usize,
    pub overview: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContradictionSessionResult {
    #[serde(flatten)]
    pub session: CreateLlmSessionResult,
    pub report_id: String,
    pub report: ContradictionReport,
    pub project_id: String,
    pub project_name: String,
    pub plugin_id: String,
    pub model: Option<String>,
    pub scope_summary: String,
    pub source_entry_ids: Vec<String>,
    pub truncated: bool,
    pub world_check_report: WorldCheckReport,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContradictionReportView {
    pub report: ContradictionReport,
    pub scope_summary: String,
    pub source_entry_ids: Vec<String>,
    pub truncated: bool,
}

fn contradiction_report_file_path(base_dir: &Path, report_id: &str) -> PathBuf {
    base_dir.join(format!("{}.json", report_id))
}

fn history_item_from_record(record: &StoredContradictionReport) -> ContradictionReportHistoryItem {
    ContradictionReportHistoryItem {
        report_id: record.report_id.clone(),
        conversation_id: record.conversation_id.clone(),
        plugin_id: record.plugin_id.clone(),
        model: record.model.clone(),
        project_id: record.project_id.clone(),
        project_name: record.project_name.clone(),
        created_at: record.created_at.clone(),
        scope_summary: record.scope_summary.clone(),
        source_entry_ids: record.source_entry_ids.clone(),
        truncated: record.truncated,
        issue_count: record.report.issues.len(),
        unresolved_count: record.report.unresolved_questions.len(),
        overview: record.report.overview.clone(),
    }
}

fn read_report_record(file_path: &Path) -> Result<StoredContradictionReport, String> {
    let content =
        std::fs::read_to_string(file_path).map_err(|e| format!("读取报告文件失败: {}", e))?;
    serde_json::from_str::<StoredContradictionReport>(&content)
        .map_err(|e| format!("解析报告文件失败: {}", e))
}

fn save_report_record(base_dir: &Path, record: &StoredContradictionReport) -> Result<(), String> {
    std::fs::create_dir_all(base_dir).map_err(|e| format!("创建矛盾报告目录失败: {}", e))?;
    let file_path = contradiction_report_file_path(base_dir, &record.report_id);
    let content =
        serde_json::to_string_pretty(record).map_err(|e| format!("序列化报告失败: {}", e))?;
    std::fs::write(file_path, content).map_err(|e| format!("写入报告文件失败: {}", e))
}

fn list_report_records(
    base_dir: &Path,
    project_id: &str,
) -> Result<Vec<StoredContradictionReport>, String> {
    std::fs::create_dir_all(base_dir).map_err(|e| format!("创建矛盾报告目录失败: {}", e))?;

    let mut records = Vec::new();
    let entries = std::fs::read_dir(base_dir).map_err(|e| format!("读取报告目录失败: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取报告目录项失败: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        match read_report_record(&path) {
            Ok(record) if record.project_id == project_id => records.push(record),
            Ok(_) => {}
            Err(error) => {
                log::warn!("跳过损坏的矛盾报告文件 {:?}: {}", path, error);
            }
        }
    }

    records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(records)
}

#[tauri::command]
pub async fn ai_start_contradiction_session(
    app: AppHandle,
    ai_state: State<'_, AiState>,
    app_state: State<'_, Arc<AppState>>,
    settings_state: State<'_, SettingsState>,
    request: ContradictionSessionRequest,
) -> Result<ContradictionSessionResult, ApiError> {
    let api_key = ApiKeyStore::get(&request.plugin_id).ok_or_else(|| {
        ApiError::new(
            ErrorCode::AuthApiKeyMissing,
            format!(
                "插件 '{}' 未配置 API Key，请在设置中配置",
                request.plugin_id
            ),
        )
        .with_kv("plugin_id", request.plugin_id.clone())
    })?;

    let check_definition = world_check_definition(WorldCheckKind::Contradiction);
    let corpus = {
        let app_state = app_state.inner().as_ref();
        load_contradiction_corpus(app_state, &request.load)
            .await
            .map_err(ApiError::internal)?
    };
    let prompt = build_contradiction_prompt(&corpus);

    let llm_defaults = settings_state.settings.lock().await.llm.clone();
    let client = ai_state.client.lock().await;
    let registry = client.tool_registry().clone();
    let sense = ContradictionSense::new();
    let whitelist = check_definition.tool_whitelist.clone();
    let (config, calibration_key) = build_llm_session_config(
        &client,
        &request.plugin_id,
        request.model.as_deref(),
        Some(request.max_tool_rounds.unwrap_or(50)),
        &llm_defaults,
    );
    let mut session = client.create_llm_session(&request.plugin_id, &api_key, Some(config))?;
    drop(client);

    session.load_sense(sense).await?;
    session.set_orchestrator(Box::new(
        DefaultOrchestrator::new(registry).with_whitelist(Some(whitelist)),
    ));
    session
        .set_response_format(json!({ "type": "json_object" }))
        .await;

    if let Some(model) = &request.model {
        session.set_model(model).await;
    }
    if let Some(temperature) = request.temperature {
        session.set_temperature(temperature).await;
    } else {
        session
            .set_temperature(check_definition.default_temperature)
            .await;
    }
    if let Some(max_tokens) = request.max_tokens {
        session.set_max_tokens(max_tokens).await;
    }
    session.set_stream(true).await;

    let conversation_id = request.session_id.clone();

    let (input_tx, input_rx) = mpsc::channel::<String>(32);
    let (event_stream, handle) = session.try_run(input_rx)?;
    let run_id = Uuid::new_v4().to_string();
    let handle_for_error = handle.clone();

    handle
        .set_task_context(build_task_context(
            Some(corpus.project_id.clone()),
            check_definition.task_type,
            HashMap::from([
                (
                    "checkKind".to_string(),
                    check_definition.kind.as_str().to_string(),
                ),
                (
                    "promptTemplate".to_string(),
                    check_definition.prompt_template.to_string(),
                ),
                (
                    "systemTemplate".to_string(),
                    check_definition.system_template.to_string(),
                ),
                ("scope".to_string(), corpus.scope_summary.clone()),
                (
                    "entryCount".to_string(),
                    corpus.source_entry_ids.len().to_string(),
                ),
            ]),
            HashMap::from([("read_only".to_string(), true)]),
        ))
        .await
        .map_err(ApiError::internal)?;

    let resolved_model = request
        .model
        .clone()
        .unwrap_or_else(|| "default".to_string());
    let (first_turn_tx, first_turn_rx) = oneshot::channel::<Result<ContradictionReport, String>>();
    spawn_contradiction_event_loop(
        app.clone(),
        request.session_id.clone(),
        run_id.clone(),
        calibration_key,
        request.plugin_id.clone(),
        resolved_model.clone(),
        event_stream,
        first_turn_tx,
        corpus.entry_blocks.clone(),
    );

    ai_state.sessions.lock().await.insert(
        request.session_id.clone(),
        crate::SessionEntry {
            run_id: run_id.clone(),
            input_tx: Some(input_tx.clone()),
            handle,
            kind: AiSessionKind::Contradiction,
            model: resolved_model,
            plugin_id: request.plugin_id.clone(),
        },
    );

    input_tx
        .send(prompt)
        .await
        .map_err(|_| ApiError::new(ErrorCode::LlmSessionClosed, "矛盾检测会话已关闭"))?;

    let report = match first_turn_rx.await {
        Ok(Ok(report)) => report,
        Ok(Err(error)) => {
            let api_err = ApiError::internal(error);
            // Cancel 前先发射详细错误事件，避免 Tauri IPC 吞掉原始错误信息
            app.emit(
                "ai:error",
                crate::apis::ai_client::EventError {
                    session_id: request.session_id.clone(),
                    run_id: run_id.clone(),
                    error: api_err.clone(),
                },
            )
            .ok();
            ai_state.sessions.lock().await.remove(&request.session_id);
            handle_for_error.cancel();
            return Err(api_err);
        }
        Err(_) => {
            let api_err = ApiError::internal("矛盾检测首轮未返回结果");
            app.emit(
                "ai:error",
                crate::apis::ai_client::EventError {
                    session_id: request.session_id.clone(),
                    run_id: run_id.clone(),
                    error: api_err.clone(),
                },
            )
            .ok();
            ai_state.sessions.lock().await.remove(&request.session_id);
            handle_for_error.cancel();
            return Err(api_err);
        }
    };

    if let Some(handle) = ai_state
        .sessions
        .lock()
        .await
        .get(&request.session_id)
        .map(|entry| entry.handle.clone())
    {
        handle
            .update(|req| {
                req.response_format = None;
            })
            .await;
    }

    let report_id = Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    let world_check_report = WorldCheckReport::from(&report);
    let stored_record = StoredContradictionReport {
        report_id: report_id.clone(),
        session_id: request.session_id.clone(),
        conversation_id: conversation_id.clone(),
        plugin_id: request.plugin_id.clone(),
        model: request.model.clone(),
        project_id: corpus.project_id.clone(),
        project_name: corpus.project_name.clone(),
        created_at,
        scope_summary: corpus.scope_summary.clone(),
        source_entry_ids: corpus.source_entry_ids.clone(),
        truncated: corpus.truncated,
        report: report.clone(),
    };
    save_report_record(&ai_state.contradiction_reports_dir, &stored_record)
        .map_err(ApiError::internal)?;

    ai_state.contradiction_bindings.lock().await.insert(
        request.session_id.clone(),
        ContradictionSessionBinding {
            report: report.clone(),
            scope_summary: corpus.scope_summary.clone(),
            source_entry_ids: corpus.source_entry_ids.clone(),
            truncated: corpus.truncated,
        },
    );

    Ok(ContradictionSessionResult {
        session: CreateLlmSessionResult {
            session_id: request.session_id,
            conversation_id,
            run_id,
        },
        report_id,
        report,
        world_check_report,
        project_id: corpus.project_id,
        project_name: corpus.project_name,
        plugin_id: request.plugin_id,
        model: request.model,
        scope_summary: corpus.scope_summary,
        source_entry_ids: corpus.source_entry_ids,
        truncated: corpus.truncated,
    })
}

#[tauri::command]
pub async fn ai_get_contradiction_report(
    ai_state: State<'_, AiState>,
    session_id: String,
) -> Result<Option<ContradictionReportView>, ApiError> {
    let bindings = ai_state.contradiction_bindings.lock().await;
    Ok(bindings
        .get(&session_id)
        .map(|binding| ContradictionReportView {
            report: binding.report.clone(),
            scope_summary: binding.scope_summary.clone(),
            source_entry_ids: binding.source_entry_ids.clone(),
            truncated: binding.truncated,
        }))
}

#[tauri::command]
pub async fn ai_list_contradiction_reports(
    ai_state: State<'_, AiState>,
    project_id: String,
) -> Result<Vec<ContradictionReportHistoryItem>, ApiError> {
    let records = list_report_records(&ai_state.contradiction_reports_dir, &project_id)
        .map_err(ApiError::internal)?;
    Ok(records.iter().map(history_item_from_record).collect())
}

#[tauri::command]
pub async fn ai_get_contradiction_report_entry(
    ai_state: State<'_, AiState>,
    report_id: String,
) -> Result<Option<StoredContradictionReport>, ApiError> {
    let file_path = contradiction_report_file_path(&ai_state.contradiction_reports_dir, &report_id);
    if !file_path.exists() {
        return Ok(None);
    }
    Ok(Some(
        read_report_record(&file_path).map_err(ApiError::internal)?,
    ))
}

#[tauri::command]
pub async fn ai_delete_contradiction_report(
    ai_state: State<'_, AiState>,
    report_id: String,
) -> Result<bool, ApiError> {
    let file_path = contradiction_report_file_path(&ai_state.contradiction_reports_dir, &report_id);
    if !file_path.exists() {
        return Ok(false);
    }
    std::fs::remove_file(&file_path)?;
    Ok(true)
}

fn spawn_contradiction_event_loop<S>(
    app: AppHandle,
    session_id: String,
    run_id: String,
    calibration_key: String,
    plugin_id: String,
    model: String,
    event_stream: S,
    first_turn_tx: oneshot::Sender<Result<ContradictionReport, String>>,
    quote_sources: Vec<String>,
) where
    S: futures::Stream<Item = SessionEvent> + Send + 'static,
{
    let sid = session_id.clone();
    let rid = run_id.clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        futures::pin_mut!(event_stream);
        let mut first_turn_sender = Some(first_turn_tx);
        let mut first_turn_buffer = String::new();
        let mut quote_sources = quote_sources;

        while let Some(event) = event_stream.next().await {
            match event {
                SessionEvent::NeedInput => {
                    app_clone
                        .emit(
                            "ai:ready",
                            EventReady {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                            },
                        )
                        .ok();
                }
                SessionEvent::TurnBegin { turn_id, node_id } => {
                    app_clone
                        .emit(
                            "ai:turn_begin",
                            EventTurnBegin {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                turn_id,
                                node_id,
                            },
                        )
                        .ok();
                }
                SessionEvent::ContentDelta(text) => {
                    if first_turn_sender.is_some() {
                        first_turn_buffer.push_str(&text);
                    }
                    app_clone
                        .emit(
                            "ai:delta",
                            EventDelta {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                text,
                            },
                        )
                        .ok();
                }
                SessionEvent::ReasoningDelta(text) => {
                    app_clone
                        .emit(
                            "ai:reasoning",
                            EventDelta {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                text,
                            },
                        )
                        .ok();
                }
                SessionEvent::ToolCall {
                    index,
                    name,
                    arguments,
                } => {
                    app_clone
                        .emit(
                            "ai:tool_call",
                            EventToolCall {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                index,
                                name,
                                arguments,
                            },
                        )
                        .ok();
                }
                SessionEvent::ToolResult {
                    index,
                    output,
                    is_error,
                } => {
                    if !is_error {
                        quote_sources.push(output.clone());
                    }
                    app_clone
                        .emit(
                            "ai:tool_result",
                            EventToolResult {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                index,
                                output: output.clone(),
                                result: output.clone(),
                                is_error,
                            },
                        )
                        .ok();
                }
                SessionEvent::RequestUsage {
                    turn_id,
                    request_id,
                    attempt,
                    usage,
                } => {
                    save_api_usage(
                        &app_clone, &sid, &rid, turn_id, request_id, attempt, &plugin_id, &model,
                        &usage,
                    )
                    .await;
                    app_clone
                        .emit(
                            "ai:request_usage",
                            EventRequestUsage {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                turn_id,
                                request_id,
                                attempt,
                                usage,
                            },
                        )
                        .ok();
                }
                SessionEvent::TurnEnd {
                    status,
                    node_id,
                    finish_reason,
                    continuation_of,
                    usage,
                    calibration_factor,
                } => {
                    if let Some(factor) = calibration_factor {
                        save_token_calibration(&app_clone, &calibration_key, factor).await;
                    }
                    app_clone
                        .emit(
                            "ai:turn_end",
                            EventTurnEnd {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                status: turn_status_str(&status),
                                error: turn_status_error(&status),
                                node_id,
                                finish_reason,
                                continuation_of,
                                usage,
                                calibration_factor,
                                calibration_key: calibration_key.clone(),
                            },
                        )
                        .ok();

                    // 在解析前打完整 log 并发送到前端
                    log::info!(
                        "[contradiction] 原始响应 ({} chars): {}",
                        first_turn_buffer.len(),
                        first_turn_buffer
                    );
                    app_clone
                        .emit(
                            "ai:debug_raw_response",
                            crate::apis::ai_client::EventDelta {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                text: first_turn_buffer.clone(),
                            },
                        )
                        .ok();

                    if let Some(sender) = first_turn_sender.take() {
                        let result = match status {
                            TurnStatus::Ok => parse_json_value_artifact(&first_turn_buffer)
                                .and_then(|value| {
                                    ContradictionReport::from_value_and_validate(
                                        value,
                                        &quote_sources,
                                    )
                                }),
                            TurnStatus::Cancelled => Err("矛盾检测首轮已取消".to_string()),
                            TurnStatus::Interrupted => Err("矛盾检测首轮被中断".to_string()),
                            TurnStatus::Error(error) => Err(error.to_string()),
                        };
                        let _ = sender.send(result);
                    }
                }
                SessionEvent::ToolRetrying {
                    name,
                    attempt,
                    max_retries,
                    delay_ms,
                    ..
                } => log::warn!(
                    "[ai:contradiction][tool_retrying] run_id={} name={} attempt={}/{} delay_ms={}",
                    rid,
                    name,
                    attempt,
                    max_retries,
                    delay_ms
                ),
                SessionEvent::ContextTrimmed {
                    dropped_rounds,
                    truncated_messages,
                    before,
                    after,
                    ..
                } => log::warn!(
                    "[ai:contradiction][context_trimmed] run_id={} dropped_rounds={} truncated_messages={} before={} after={}",
                    rid,
                    dropped_rounds,
                    truncated_messages,
                    before,
                    after
                ),
                SessionEvent::Error(error) => {
                    let api_err: crate::ApiError = error.clone().into();
                    app_clone
                        .emit(
                            "ai:error",
                            EventError {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                error: api_err,
                            },
                        )
                        .ok();
                    if let Some(sender) = first_turn_sender.take() {
                        let _ = sender.send(Err(error.to_string()));
                    }
                    break;
                }
                SessionEvent::BranchChanged { .. } => {}
            }
        }

        if let Some(sender) = first_turn_sender.take() {
            let _ = sender.send(Err("矛盾检测会话提前结束".to_string()));
        }

        cleanup_session_state(&app_clone, &sid, &rid, None).await;
    });
}
