use crate::ai_services::artifact_parser::parse_json_value_artifact;
use crate::ai_services::context_builders::{build_task_context, build_world_check_prompt};
use crate::ai_services::world_check::{
    WorldCheckLoadRequest, load_world_check_corpus, world_check_definition,
};
use crate::apis::ai_client::{
    CreateLlmSessionResult, EventContextTrimmed, EventDelta, EventError, EventReady,
    EventRequestUsage, EventToolCall, EventToolResult, EventToolRetrying, EventTurnBegin,
    EventTurnEnd, build_llm_session_config, cleanup_session_state, save_api_usage,
    save_token_calibration, turn_status_error, turn_status_str,
};
use crate::apis::ai_contradiction::StoredContradictionReport;
use crate::reports::world_check_report::{WorldCheckKind, WorldCheckReport};
use crate::senses::world_check_sense::WorldCheckSense;
use crate::{
    AiSessionKind, AiState, ApiError, ApiKeyStore, AppState, SettingsState,
    WorldCheckSessionBinding,
};
use flowcloudai_client::{DefaultOrchestrator, ErrorCode, SessionEvent, TurnStatus};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use uuid::Uuid;

const WORLD_CHECK_MAX_REPORT_ATTEMPTS: usize = 3;

enum WorldCheckTurnOutcome {
    Valid(WorldCheckReport),
    Invalid(String),
    Failed(ApiError),
}

#[derive(Debug, Clone, Serialize)]
struct EventWorldCheckRetrying {
    session_id: String,
    run_id: String,
    attempt: usize,
    max_attempts: usize,
    error: String,
}

fn next_world_check_attempt(failed_attempt: usize) -> Option<usize> {
    (failed_attempt < WORLD_CHECK_MAX_REPORT_ATTEMPTS).then_some(failed_attempt + 1)
}

fn build_world_check_repair_prompt(
    validation_error: &str,
    expected_kind: WorldCheckKind,
    next_attempt: usize,
) -> String {
    format!(
        "上一次检测报告未通过程序校验：{validation_error}\n\
         现在进行第 {next_attempt}/{WORLD_CHECK_MAX_REPORT_ATTEMPTS} 次输出。请直接修正错误并重新输出完整 JSON 对象，无需再次调用工具；不要解释、不要使用 Markdown，也不要只输出局部字段。\n\
         checkKind 必须为 \"{}\"。overview 及发现、证据中的文本字段必须是字符串；relatedEntryIds、unresolvedQuestions、suggestions 必须是字符串数组；recommendation、note 必须是字符串或 null；metadata 必须是对象或 null；score 必须是数字或 null。",
        expected_kind.as_str()
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldCheckSessionRequest {
    pub session_id: String,
    pub plugin_id: String,
    pub check_kind: WorldCheckKind,
    #[serde(flatten)]
    pub load: WorldCheckLoadRequest,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
    pub max_tool_rounds: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldCheckSessionResult {
    #[serde(flatten)]
    pub session: CreateLlmSessionResult,
    pub report_id: String,
    pub check_kind: WorldCheckKind,
    pub report: WorldCheckReport,
    pub project_id: String,
    pub project_name: String,
    pub plugin_id: String,
    pub model: Option<String>,
    pub scope_summary: String,
    pub source_entry_ids: Vec<String>,
    pub target_entry_id: Option<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredWorldCheckReport {
    pub report_id: String,
    pub session_id: String,
    pub conversation_id: String,
    pub check_kind: WorldCheckKind,
    pub plugin_id: String,
    pub model: Option<String>,
    pub project_id: String,
    pub project_name: String,
    pub created_at: String,
    pub scope_summary: String,
    pub source_entry_ids: Vec<String>,
    pub target_entry_id: Option<String>,
    pub truncated: bool,
    pub report: WorldCheckReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldCheckReportHistoryItem {
    pub report_id: String,
    pub conversation_id: String,
    pub check_kind: WorldCheckKind,
    pub plugin_id: String,
    pub model: Option<String>,
    pub project_id: String,
    pub project_name: String,
    pub created_at: String,
    pub scope_summary: String,
    pub source_entry_ids: Vec<String>,
    pub target_entry_id: Option<String>,
    pub truncated: bool,
    pub finding_count: usize,
    pub unresolved_count: usize,
    pub overview: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldCheckReportView {
    pub report: WorldCheckReport,
    pub scope_summary: String,
    pub source_entry_ids: Vec<String>,
    pub target_entry_id: Option<String>,
    pub truncated: bool,
}

fn world_check_report_file_path(base_dir: &Path, report_id: &str) -> PathBuf {
    base_dir.join(format!("{}.json", report_id))
}

fn history_item_from_record(record: &StoredWorldCheckReport) -> WorldCheckReportHistoryItem {
    WorldCheckReportHistoryItem {
        report_id: record.report_id.clone(),
        conversation_id: record.conversation_id.clone(),
        check_kind: record.check_kind,
        plugin_id: record.plugin_id.clone(),
        model: record.model.clone(),
        project_id: record.project_id.clone(),
        project_name: record.project_name.clone(),
        created_at: record.created_at.clone(),
        scope_summary: record.scope_summary.clone(),
        source_entry_ids: record.source_entry_ids.clone(),
        target_entry_id: record.target_entry_id.clone(),
        truncated: record.truncated,
        finding_count: record.report.findings.len(),
        unresolved_count: record.report.unresolved_questions.len(),
        overview: record.report.overview.clone(),
    }
}

fn read_report_record(file_path: &Path) -> Result<StoredWorldCheckReport, String> {
    let content =
        std::fs::read_to_string(file_path).map_err(|e| format!("读取检测报告文件失败: {}", e))?;
    serde_json::from_str::<StoredWorldCheckReport>(&content)
        .map_err(|e| format!("解析检测报告文件失败: {}", e))
}

fn legacy_contradiction_report_file_path(base_dir: &Path, report_id: &str) -> PathBuf {
    base_dir.join(format!("{}.json", report_id))
}

fn legacy_record_to_world_check(record: StoredContradictionReport) -> StoredWorldCheckReport {
    StoredWorldCheckReport {
        report_id: record.report_id,
        session_id: record.session_id,
        conversation_id: record.conversation_id,
        check_kind: WorldCheckKind::Contradiction,
        plugin_id: record.plugin_id,
        model: record.model,
        project_id: record.project_id,
        project_name: record.project_name,
        created_at: record.created_at,
        scope_summary: record.scope_summary,
        source_entry_ids: record.source_entry_ids,
        target_entry_id: None,
        truncated: record.truncated,
        report: WorldCheckReport::from(record.report),
    }
}

fn read_legacy_contradiction_record(file_path: &Path) -> Result<StoredWorldCheckReport, String> {
    let content =
        std::fs::read_to_string(file_path).map_err(|e| format!("读取旧矛盾报告文件失败: {}", e))?;
    let record = serde_json::from_str::<StoredContradictionReport>(&content)
        .map_err(|e| format!("解析旧矛盾报告文件失败: {}", e))?;
    Ok(legacy_record_to_world_check(record))
}

fn list_legacy_contradiction_records(
    base_dir: &Path,
    project_id: &str,
) -> Result<Vec<StoredWorldCheckReport>, String> {
    std::fs::create_dir_all(base_dir).map_err(|e| format!("创建旧矛盾报告目录失败: {}", e))?;

    let mut records = Vec::new();
    let entries =
        std::fs::read_dir(base_dir).map_err(|e| format!("读取旧矛盾报告目录失败: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取旧矛盾报告目录项失败: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        match read_legacy_contradiction_record(&path) {
            Ok(record) if record.project_id == project_id => records.push(record),
            Ok(_) => {}
            Err(error) => {
                log::warn!("跳过损坏的旧矛盾报告文件 {:?}: {}", path, error);
            }
        }
    }

    Ok(records)
}

fn save_report_record(base_dir: &Path, record: &StoredWorldCheckReport) -> Result<(), String> {
    std::fs::create_dir_all(base_dir).map_err(|e| format!("创建检测报告目录失败: {}", e))?;
    let file_path = world_check_report_file_path(base_dir, &record.report_id);
    let content =
        serde_json::to_string_pretty(record).map_err(|e| format!("序列化检测报告失败: {}", e))?;
    std::fs::write(file_path, content).map_err(|e| format!("写入检测报告文件失败: {}", e))
}

fn list_report_records(
    base_dir: &Path,
    project_id: &str,
    check_kind: Option<WorldCheckKind>,
) -> Result<Vec<StoredWorldCheckReport>, String> {
    std::fs::create_dir_all(base_dir).map_err(|e| format!("创建检测报告目录失败: {}", e))?;

    let mut records = Vec::new();
    let entries =
        std::fs::read_dir(base_dir).map_err(|e| format!("读取检测报告目录失败: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取检测报告目录项失败: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        match read_report_record(&path) {
            Ok(record)
                if record.project_id == project_id
                    && check_kind.is_none_or(|kind| record.check_kind == kind) =>
            {
                records.push(record)
            }
            Ok(_) => {}
            Err(error) => {
                log::warn!("跳过损坏的检测报告文件 {:?}: {}", path, error);
            }
        }
    }

    records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(records)
}

#[tauri::command]
pub async fn ai_start_world_check_session(
    app: AppHandle,
    ai_state: State<'_, AiState>,
    app_state: State<'_, Arc<AppState>>,
    settings_state: State<'_, SettingsState>,
    request: WorldCheckSessionRequest,
) -> Result<WorldCheckSessionResult, ApiError> {
    let api_key = ApiKeyStore::get(&request.plugin_id).ok_or_else(|| {
        ApiError::new(
            ErrorCode::AuthApiKeyMissing,
            format!(
                "插件 '{}' 未配置 API Key，请在设置中配置",
                request.plugin_id
            ),
        )
        .with_kv("plugin_id", request.plugin_id.clone())
        .with_kv("stage", "prepare")
    })?;

    let check_definition = world_check_definition(request.check_kind);
    if check_definition.requires_target_entry && request.load.target_entry_id.is_none() {
        return Err(ApiError::internal(format!(
            "{}需要传入 targetEntryId",
            check_definition.title
        ))
        .with_kv("stage", "prepare"));
    }

    let corpus = {
        let app_state = app_state.inner().as_ref();
        load_world_check_corpus(app_state, &request.load)
            .await
            .map_err(|error| ApiError::internal(error).with_kv("stage", "prepare"))?
    };
    if check_definition.requires_target_entry && corpus.target_entry_block.is_none() {
        return Err(
            ApiError::internal(format!("{}未能载入目标词条", check_definition.title))
                .with_kv("stage", "prepare"),
        );
    }

    let prompt = build_world_check_prompt(&check_definition, &corpus);

    let llm_defaults = settings_state.settings.lock().await.llm.clone();
    let client = ai_state.client.lock().await;
    let registry = client.tool_registry().clone();
    let sense = WorldCheckSense::new(check_definition.clone());
    let whitelist = check_definition.tool_whitelist.clone();
    let (config, calibration_key) = build_llm_session_config(
        &client,
        &request.plugin_id,
        request.model.as_deref(),
        Some(request.max_tool_rounds.unwrap_or(50)),
        &llm_defaults,
    );
    let mut session = client
        .create_llm_session(&request.plugin_id, &api_key, Some(config))
        .map_err(|error| ApiError::from(error).with_kv("stage", "analyze"))?;
    drop(client);

    session
        .load_sense(sense)
        .await
        .map_err(|error| ApiError::from(error).with_kv("stage", "analyze"))?;
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
    let (event_stream, handle) = session
        .try_run(input_rx)
        .map_err(|error| ApiError::from(error).with_kv("stage", "analyze"))?;
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
        .map_err(|error| ApiError::internal(error).with_kv("stage", "analyze"))?;

    let (turn_result_tx, mut turn_result_rx) =
        mpsc::channel::<WorldCheckTurnOutcome>(WORLD_CHECK_MAX_REPORT_ATTEMPTS);
    let mut quote_sources = corpus.entry_blocks.clone();
    if let Some(target_entry_block) = &corpus.target_entry_block {
        quote_sources.push(target_entry_block.clone());
    }
    let resolved_model = request
        .model
        .clone()
        .unwrap_or_else(|| "default".to_string());
    spawn_world_check_event_loop(
        app.clone(),
        request.session_id.clone(),
        run_id.clone(),
        calibration_key,
        request.plugin_id.clone(),
        resolved_model.clone(),
        event_stream,
        turn_result_tx,
        request.check_kind,
        quote_sources,
    );

    ai_state.sessions.lock().await.insert(
        request.session_id.clone(),
        crate::SessionEntry {
            run_id: run_id.clone(),
            input_tx: Some(input_tx.clone()),
            handle,
            kind: AiSessionKind::WorldCheck,
            model: resolved_model,
            plugin_id: request.plugin_id.clone(),
        },
    );

    input_tx.send(prompt).await.map_err(|_| {
        ApiError::new(ErrorCode::LlmSessionClosed, "检测会话已关闭").with_kv("stage", "analyze")
    })?;

    let mut attempt = 1;
    let report_result = loop {
        match turn_result_rx.recv().await {
            Some(WorldCheckTurnOutcome::Valid(report)) => break Ok(report),
            Some(WorldCheckTurnOutcome::Invalid(error)) => {
                let Some(next_attempt) = next_world_check_attempt(attempt) else {
                    break Err(ApiError::new(
                        ErrorCode::ValidationFormatError,
                        format!(
                            "AI 连续 {} 次未能输出有效检测报告：{}",
                            WORLD_CHECK_MAX_REPORT_ATTEMPTS, error
                        ),
                    )
                    .with_kv("stage", "validate")
                    .with_kv("attempts", WORLD_CHECK_MAX_REPORT_ATTEMPTS)
                    .with_kv("last_error", error));
                };

                app.emit(
                    "ai:world_check_retrying",
                    EventWorldCheckRetrying {
                        session_id: request.session_id.clone(),
                        run_id: run_id.clone(),
                        attempt: next_attempt,
                        max_attempts: WORLD_CHECK_MAX_REPORT_ATTEMPTS,
                        error: error.clone(),
                    },
                )
                .ok();
                let repair_prompt =
                    build_world_check_repair_prompt(&error, request.check_kind, next_attempt);
                if input_tx.send(repair_prompt).await.is_err() {
                    break Err(ApiError::new(
                        ErrorCode::LlmSessionClosed,
                        "检测会话在修正报告时已关闭",
                    )
                    .with_kv("stage", "validate")
                    .with_kv("attempt", next_attempt));
                }
                attempt = next_attempt;
            }
            Some(WorldCheckTurnOutcome::Failed(error)) => break Err(error),
            None => {
                break Err(ApiError::internal("检测会话未返回结果").with_kv("stage", "analyze"));
            }
        }
    };

    let report = match report_result {
        Ok(report) => report,
        Err(api_err) => {
            app.emit(
                "ai:error",
                EventError {
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
    let stored_record = StoredWorldCheckReport {
        report_id: report_id.clone(),
        session_id: request.session_id.clone(),
        conversation_id: conversation_id.clone(),
        check_kind: request.check_kind,
        plugin_id: request.plugin_id.clone(),
        model: request.model.clone(),
        project_id: corpus.project_id.clone(),
        project_name: corpus.project_name.clone(),
        created_at,
        scope_summary: corpus.scope_summary.clone(),
        source_entry_ids: corpus.source_entry_ids.clone(),
        target_entry_id: corpus.target_entry_id.clone(),
        truncated: corpus.truncated,
        report: report.clone(),
    };
    save_report_record(&ai_state.world_check_reports_dir, &stored_record)
        .map_err(|error| ApiError::internal(error).with_kv("stage", "persist"))?;

    ai_state.world_check_bindings.lock().await.insert(
        request.session_id.clone(),
        WorldCheckSessionBinding {
            report: report.clone(),
            scope_summary: corpus.scope_summary.clone(),
            source_entry_ids: corpus.source_entry_ids.clone(),
            target_entry_id: corpus.target_entry_id.clone(),
            truncated: corpus.truncated,
        },
    );

    Ok(WorldCheckSessionResult {
        session: CreateLlmSessionResult {
            session_id: request.session_id,
            conversation_id,
            run_id,
        },
        report_id,
        check_kind: request.check_kind,
        report,
        project_id: corpus.project_id,
        project_name: corpus.project_name,
        plugin_id: request.plugin_id,
        model: request.model,
        scope_summary: corpus.scope_summary,
        source_entry_ids: corpus.source_entry_ids,
        target_entry_id: corpus.target_entry_id,
        truncated: corpus.truncated,
    })
}

#[tauri::command]
pub async fn ai_get_world_check_report(
    ai_state: State<'_, AiState>,
    session_id: String,
) -> Result<Option<WorldCheckReportView>, ApiError> {
    let bindings = ai_state.world_check_bindings.lock().await;
    Ok(bindings
        .get(&session_id)
        .map(|binding| WorldCheckReportView {
            report: binding.report.clone(),
            scope_summary: binding.scope_summary.clone(),
            source_entry_ids: binding.source_entry_ids.clone(),
            target_entry_id: binding.target_entry_id.clone(),
            truncated: binding.truncated,
        }))
}

#[tauri::command]
pub async fn ai_list_world_check_reports(
    ai_state: State<'_, AiState>,
    project_id: String,
    check_kind: Option<WorldCheckKind>,
) -> Result<Vec<WorldCheckReportHistoryItem>, ApiError> {
    let mut records =
        list_report_records(&ai_state.world_check_reports_dir, &project_id, check_kind)
            .map_err(ApiError::internal)?;
    if check_kind.is_none_or(|kind| kind == WorldCheckKind::Contradiction) {
        records.extend(
            list_legacy_contradiction_records(&ai_state.contradiction_reports_dir, &project_id)
                .map_err(ApiError::internal)?,
        );
        records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    }
    Ok(records.iter().map(history_item_from_record).collect())
}

#[tauri::command]
pub async fn ai_get_world_check_report_entry(
    ai_state: State<'_, AiState>,
    report_id: String,
) -> Result<Option<StoredWorldCheckReport>, ApiError> {
    let file_path = world_check_report_file_path(&ai_state.world_check_reports_dir, &report_id);
    if !file_path.exists() {
        let legacy_path =
            legacy_contradiction_report_file_path(&ai_state.contradiction_reports_dir, &report_id);
        if !legacy_path.exists() {
            return Ok(None);
        }
        return Ok(Some(
            read_legacy_contradiction_record(&legacy_path).map_err(ApiError::internal)?,
        ));
    }
    Ok(Some(
        read_report_record(&file_path).map_err(ApiError::internal)?,
    ))
}

#[tauri::command]
pub async fn ai_delete_world_check_report(
    ai_state: State<'_, AiState>,
    report_id: String,
) -> Result<bool, ApiError> {
    let file_path = world_check_report_file_path(&ai_state.world_check_reports_dir, &report_id);
    if !file_path.exists() {
        let legacy_path =
            legacy_contradiction_report_file_path(&ai_state.contradiction_reports_dir, &report_id);
        if !legacy_path.exists() {
            return Ok(false);
        }
        std::fs::remove_file(&legacy_path)?;
        return Ok(true);
    }
    std::fs::remove_file(&file_path)?;
    Ok(true)
}

fn spawn_world_check_event_loop<S>(
    app: AppHandle,
    session_id: String,
    run_id: String,
    calibration_key: String,
    plugin_id: String,
    model: String,
    event_stream: S,
    turn_result_tx: mpsc::Sender<WorldCheckTurnOutcome>,
    expected_kind: WorldCheckKind,
    quote_sources: Vec<String>,
) where
    S: futures::Stream<Item = SessionEvent> + Send + 'static,
{
    let sid = session_id.clone();
    let rid = run_id.clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        futures::pin_mut!(event_stream);
        let mut report_resolved = false;
        let mut turn_buffer = String::new();
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
                    if !report_resolved {
                        turn_buffer.clear();
                    }
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
                    if !report_resolved {
                        turn_buffer.push_str(&text);
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

                    if !report_resolved {
                        let raw_response = std::mem::take(&mut turn_buffer);
                        log::info!(
                            "[world_check] 原始响应 ({} chars): {}",
                            raw_response.len(),
                            raw_response
                        );
                        app_clone
                            .emit(
                                "ai:debug_raw_response",
                                EventDelta {
                                    session_id: sid.clone(),
                                    run_id: rid.clone(),
                                    text: raw_response.clone(),
                                },
                            )
                            .ok();

                        let outcome = match status {
                            TurnStatus::Ok => match parse_json_value_artifact(&raw_response)
                                .and_then(|value| {
                                    WorldCheckReport::from_value_and_validate(
                                        value,
                                        expected_kind,
                                        &quote_sources,
                                    )
                                }) {
                                Ok(report) => {
                                    report_resolved = true;
                                    WorldCheckTurnOutcome::Valid(report)
                                }
                                Err(error) => WorldCheckTurnOutcome::Invalid(error),
                            },
                            TurnStatus::Cancelled => {
                                report_resolved = true;
                                WorldCheckTurnOutcome::Failed(
                                    ApiError::internal("检测已取消").with_kv("stage", "analyze"),
                                )
                            }
                            TurnStatus::Interrupted => {
                                report_resolved = true;
                                WorldCheckTurnOutcome::Failed(
                                    ApiError::internal("检测被中断").with_kv("stage", "analyze"),
                                )
                            }
                            TurnStatus::Error(error) => {
                                report_resolved = true;
                                WorldCheckTurnOutcome::Failed(
                                    ApiError::from(error).with_kv("stage", "analyze"),
                                )
                            }
                        };
                        let _ = turn_result_tx.send(outcome).await;
                    }
                }
                SessionEvent::ToolRetrying {
                    index,
                    name,
                    attempt,
                    max_retries,
                    delay_ms,
                } => {
                    log::warn!(
                        "[ai:world_check][tool_retrying] run_id={} name={} attempt={}/{} delay_ms={}",
                        rid,
                        name,
                        attempt,
                        max_retries,
                        delay_ms
                    );
                    app_clone
                        .emit(
                            "ai:tool_retrying",
                            EventToolRetrying {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                index,
                                name,
                                attempt,
                                max_retries,
                                delay_ms,
                            },
                        )
                        .ok();
                }
                SessionEvent::ContextTrimmed {
                    dropped_rounds,
                    truncated_messages,
                    before,
                    after,
                    suggest_compaction,
                    estimate_source,
                } => {
                    log::warn!(
                        "[ai:world_check][context_trimmed] run_id={} dropped_rounds={} truncated_messages={} before={} after={}",
                        rid,
                        dropped_rounds,
                        truncated_messages,
                        before,
                        after
                    );
                    app_clone
                        .emit(
                            "ai:context_trimmed",
                            EventContextTrimmed {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                dropped_rounds,
                                truncated_messages,
                                before,
                                after,
                                suggest_compaction,
                                estimate_source,
                            },
                        )
                        .ok();
                }
                SessionEvent::Error(error) => {
                    let api_err = ApiError::from(error.clone()).with_kv("stage", "analyze");
                    app_clone
                        .emit(
                            "ai:error",
                            EventError {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                error: api_err.clone(),
                            },
                        )
                        .ok();
                    if !report_resolved {
                        report_resolved = true;
                        let _ = turn_result_tx
                            .send(WorldCheckTurnOutcome::Failed(api_err))
                            .await;
                    }
                    break;
                }
                SessionEvent::BranchChanged { .. } => {}
            }
        }

        if !report_resolved {
            let _ = turn_result_tx
                .send(WorldCheckTurnOutcome::Failed(
                    ApiError::internal("检测会话提前结束").with_kv("stage", "analyze"),
                ))
                .await;
        }

        cleanup_session_state(&app_clone, &sid, &rid, None).await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_invalid_report_twice_before_final_failure() {
        assert_eq!(next_world_check_attempt(1), Some(2));
        assert_eq!(next_world_check_attempt(2), Some(3));
        assert_eq!(next_world_check_attempt(3), None);

        let prompt = build_world_check_repair_prompt(
            "$.overview 必须是字符串，实际为对象",
            WorldCheckKind::EntryAlignment,
            2,
        );
        assert!(prompt.contains("$.overview 必须是字符串，实际为对象"));
        assert!(prompt.contains("第 2/3 次输出"));
        assert!(prompt.contains("checkKind 必须为 \"entry_alignment\""));
    }
}
