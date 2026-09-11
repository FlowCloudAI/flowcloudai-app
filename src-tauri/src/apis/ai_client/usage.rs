//! AI Token 估算与已落库用量查询，前端估算统一复用核心库口径。

use crate::{AiState, ApiError, AppState};
use flowcloudai_client::RequestPreflight;
use flowcloudai_client::llm::{
    token_estimate::{estimate_request_tokens, estimate_with_factor},
    types::{ChatRequest, Message, ToolCall, ToolFunctionCall},
};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use tauri::State;
use worldflow_core::{query_usage_by_model, query_usage_daily, query_usage_summary};

#[derive(Debug, Deserialize)]
pub struct AiTokenEstimateMessage {
    pub content: Option<String>,
    pub reasoning_content: Option<String>,
    #[serde(default)]
    pub tool_payloads: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct AiTokenEstimateRequest {
    #[serde(default)]
    pub messages: Vec<AiTokenEstimateMessage>,
    pub calibration_factor: Option<f64>,
    pub plugin_id: Option<String>,
    pub model: Option<String>,
}

/// 按核心库与实际请求相同的字符分类、消息开销和校准边界估算 Token。
#[tauri::command]
pub async fn ai_estimate_tokens(
    ai_state: State<'_, AiState>,
    request: AiTokenEstimateRequest,
) -> Result<u64, ApiError> {
    let include_tools = request
        .plugin_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        && request
            .model
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());
    let tools = if include_tools {
        ai_state.client.lock().await.tool_registry().schemas()
    } else {
        None
    };
    Ok(estimate_token_request(request, tools))
}

fn estimate_token_request(request: AiTokenEstimateRequest, tools: Option<Vec<Value>>) -> u64 {
    let messages = request
        .messages
        .into_iter()
        .map(|message| Message {
            role: "user".to_string(),
            content: message.content,
            reasoning_content: message.reasoning_content,
            tool_call_id: None,
            tool_calls: (!message.tool_payloads.is_empty()).then(|| {
                message
                    .tool_payloads
                    .into_iter()
                    .enumerate()
                    .map(|(index, arguments)| ToolCall {
                        function: ToolFunctionCall {
                            name: String::new(),
                            arguments,
                        },
                        index,
                        ..Default::default()
                    })
                    .collect()
            }),
        })
        .collect::<Vec<_>>();
    let chat_request = ChatRequest {
        messages,
        model: request.model.unwrap_or_default(),
        tools,
        ..ChatRequest::default()
    };
    estimate_with_factor(
        estimate_request_tokens(&chat_request),
        request.calibration_factor.unwrap_or(1.0),
    )
}

/// 使用活动会话的真实历史、上下文、模型与工具预检下一次有效请求。
#[tauri::command]
pub async fn ai_preflight_request(
    ai_state: State<'_, AiState>,
    session_id: String,
    pending_user_message: String,
) -> Result<RequestPreflight, ApiError> {
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
    handle
        .preflight_request(pending_user_message)
        .await
        .map_err(ApiError::internal)
}

/// 查询 API 用量总览
#[tauri::command]
pub async fn ai_get_usage_summary(
    state: State<'_, Arc<AppState>>,
) -> Result<worldflow_core::models::ApiUsageSummary, ApiError> {
    let db = state.inner().sqlite_db.lock().await;
    query_usage_summary(&db.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
}

/// 按模型分组查询 API 用量
#[tauri::command]
pub async fn ai_get_usage_by_model(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<worldflow_core::models::ApiUsageByModel>, ApiError> {
    let db = state.inner().sqlite_db.lock().await;
    query_usage_by_model(&db.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
}

/// 按本地日期聚合最近 52 周 API 用量
#[tauri::command]
pub async fn ai_get_usage_daily(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<worldflow_core::models::ApiUsageDaily>, ApiError> {
    let db = state.inner().sqlite_db.lock().await;
    query_usage_daily(&db.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request() -> AiTokenEstimateRequest {
        AiTokenEstimateRequest {
            messages: vec![AiTokenEstimateMessage {
                content: Some("测试消息".to_string()),
                reasoning_content: None,
                tool_payloads: Vec::new(),
            }],
            calibration_factor: Some(1.0),
            plugin_id: Some("test-plugin".to_string()),
            model: Some("test-model".to_string()),
        }
    }

    #[test]
    fn 工具_schema_会增加前端请求估算() {
        let without_tools = estimate_token_request(request(), None);
        let with_tools = estimate_token_request(
            request(),
            Some(vec![json!({
                "type": "function",
                "function": {
                    "name": "search_entries",
                    "description": "搜索词条",
                    "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}
                }
            })]),
        );

        assert!(with_tools > without_tools);
    }
}
