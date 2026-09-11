pub(super) use crate::AiSessionKind;
pub(super) use crate::AiState;
pub(super) use crate::ApiError;
pub(super) use crate::ApiKeyStore;
pub(super) use crate::PathsState;
pub(super) use crate::PendingEditsState;
pub(super) use crate::SettingsState;
pub(super) use flowcloudai_client::llm::config::SessionConfig;
pub(super) use flowcloudai_client::{
    AudioDecoder, AudioSource, ContextSnapshotPlacement, ConversationNode, ConversationNodeSeed,
    DefaultOrchestrator, ImageSession, PluginKind, SessionEvent, SessionHandle, TaskContext,
    TurnContextSnapshot, TurnStatus, Usage,
    image::ImageRequest,
    llm::types::{Message, ToolCall},
};
pub(super) use futures::StreamExt;
pub(super) use serde::{Deserialize, Serialize};
pub(super) use std::collections::{HashMap, HashSet};
pub(super) use std::fs::File;
pub(super) use std::io::{Read, Write};
pub(super) use std::path::{Path, PathBuf};
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use std::time::Duration;
pub(super) use tauri::{AppHandle, Emitter, Manager, State};
pub(super) use tokio::sync::mpsc;
pub(super) use uuid::Uuid;
pub(super) use zip::ZipArchive;

// ============ 前端事件 Payload ============

#[derive(Serialize, Clone)]
pub(crate) struct EventReady {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
}

#[derive(Serialize, Clone)]
pub(crate) struct EventDelta {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) text: String,
}

#[derive(Serialize, Clone)]
pub(crate) struct EventToolCall {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) index: usize,
    pub(crate) name: String,
    pub(crate) arguments: String,
}

#[derive(Serialize, Clone)]
pub(crate) struct EventToolRetrying {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) index: usize,
    pub(crate) name: String,
    pub(crate) attempt: usize,
    pub(crate) max_retries: usize,
    pub(crate) delay_ms: u64,
}

#[derive(Serialize, Clone)]
pub(crate) struct EventTurnEnd {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) status: String, // "ok" | "cancelled" | "interrupted" | "error"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<ApiError>,
    pub(crate) node_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) finish_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) continuation_of: Option<u64>,
    pub(crate) usage: Option<Usage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) calibration_factor: Option<f64>,
    pub(crate) calibration_key: String,
}

#[derive(Serialize, Clone)]
pub(crate) struct EventTurnBegin {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) turn_id: u64,
    pub(crate) node_id: u64,
}

#[derive(Serialize, Clone)]
pub(crate) struct EventToolResult {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) index: usize,
    pub(crate) output: String,
    pub(crate) result: String,
    pub(crate) is_error: bool,
}

#[derive(Serialize, Clone)]
pub(crate) struct EventContextTrimmed {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) dropped_rounds: usize,
    pub(crate) truncated_messages: usize,
    pub(crate) before: u64,
    pub(crate) after: u64,
    pub(crate) suggest_compaction: bool,
    pub(crate) estimate_source: String,
}

#[derive(Serialize, Clone)]
pub(crate) struct EventRequestUsage {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) turn_id: u64,
    pub(crate) request_id: u64,
    pub(crate) attempt: u32,
    pub(crate) usage: Usage,
}

#[derive(Serialize, Clone)]
pub(crate) struct EventBranchChanged {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) node_id: u64,
}

#[derive(Debug, Serialize)]
pub struct CreateLlmSessionResult {
    pub session_id: String,
    pub conversation_id: String,
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterConversationMeta {
    pub mode: Option<String>,
    pub character_entry_id: Option<String>,
    pub character_name: Option<String>,
    pub background_image_url: Option<String>,
    pub character_voice_plugin_id: Option<String>,
    pub character_voice_model: Option<String>,
    pub character_voice_id: Option<String>,
    pub character_auto_play: Option<bool>,
    pub report_context: Option<serde_json::Value>,
    pub report_seeded: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationUiState {
    pub pinned_at: Option<String>,
    pub archived_at: Option<String>,
}

/// 对话元信息（不含消息体，用于列表展示）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMeta {
    pub id: String,
    pub title: String,
    pub plugin_id: String,
    pub model: String,
    pub created_at: String,
    pub updated_at: String,
}

/// App 侧保存的单条对话消息。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMessage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<u64>,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation_of: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<StoredMessageAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessageAttachment {
    pub attachment_id: String,
    pub document_context_item_id: String,
    pub file_name: String,
    pub extension: String,
    pub sha256: String,
    pub status: String,
}

/// compact 文本的 App 侧元数据。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCompact {
    pub position_node_id: u64,
    pub text: String,
    pub created_at: String,
    /// 压缩边界处仍然有效的参考材料；恢复时作为 user 参考消息放在摘要之后。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_snapshot: Option<TurnContextSnapshot>,
}

/// 当前对话独有的大模型参数与系统提示词。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StoredConversationSettings {
    pub temperature: f64,
    pub top_p: f64,
    pub frequency_penalty_enabled: bool,
    pub frequency_penalty: f64,
    pub presence_penalty_enabled: bool,
    pub presence_penalty: f64,
    pub system_prompt: String,
}

impl Default for StoredConversationSettings {
    fn default() -> Self {
        Self {
            temperature: 0.7,
            top_p: 1.0,
            frequency_penalty_enabled: false,
            frequency_penalty: 1.1,
            presence_penalty_enabled: false,
            presence_penalty: 0.0,
            system_prompt: String::new(),
        }
    }
}

impl StoredConversationSettings {
    pub fn is_default(value: &Self) -> bool {
        value == &Self::default()
    }
}

/// 事件循环收尾所需的会话数据，不依赖全局注册表中的条目生命周期。
pub(crate) struct SessionPersistence {
    pub(crate) conversation_id: String,
    pub(crate) plugin_id: String,
    pub(crate) model: String,
    pub(crate) settings: Option<StoredConversationSettings>,
    pub(crate) handle: SessionHandle,
}

/// App 侧对话文件结构，兼容旧 core v3 JSON。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredConversation {
    #[serde(default = "default_conversation_schema_version")]
    pub schema_version: u32,
    #[serde(flatten)]
    pub meta: ConversationMeta,
    #[serde(
        default,
        skip_serializing_if = "StoredConversationSettings::is_default"
    )]
    pub settings: StoredConversationSettings,
    pub messages: Vec<StoredMessage>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub context_snapshots: Vec<TurnContextSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compact: Option<StoredCompact>,
}

fn default_conversation_schema_version() -> u32 {
    5
}

pub(super) fn character_conversation_meta_path(
    paths: &PathsState,
) -> Result<std::path::PathBuf, String> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(db_dir
        .join("chats")
        .join("metadata")
        .join("character_conversations.json"))
}

pub(super) fn conversation_ui_state_path(paths: &PathsState) -> Result<std::path::PathBuf, String> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(db_dir
        .join("chats")
        .join("metadata")
        .join("conversation_ui_state.json"))
}

pub(super) fn conversations_dir(paths: &PathsState) -> Result<PathBuf, String> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(db_dir.join("chats"))
}

fn sanitize_conversation_id(id: &str) -> Result<&str, String> {
    let valid = !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'));
    if valid {
        Ok(id)
    } else {
        Err("无效的会话 ID".to_string())
    }
}

fn conversation_file_path(paths: &PathsState, id: &str) -> Result<PathBuf, String> {
    let safe_id = sanitize_conversation_id(id)?;
    Ok(conversations_dir(paths)?.join(format!("{}.json", safe_id)))
}

pub(super) fn chat_store_list_conversations(
    paths: &PathsState,
) -> Result<Vec<ConversationMeta>, String> {
    let dir = conversations_dir(paths)?;
    let mut metas = Vec::new();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(metas);
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        match std::fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str::<StoredConversation>(&content).ok())
        {
            Some(conversation) => metas.push(conversation.meta),
            None => log::warn!("[chat_store] 解析对话文件失败: path={}", path.display()),
        }
    }

    metas.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(metas)
}

pub(super) fn chat_store_get_conversation(
    paths: &PathsState,
    id: &str,
) -> Result<Option<StoredConversation>, String> {
    let path = conversation_file_path(paths, id)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取对话文件失败 {:?}: {}", path, e))?;
    serde_json::from_str::<StoredConversation>(&content)
        .map(Some)
        .map_err(|e| format!("解析对话文件失败 {:?}: {}", path, e))
}

pub(super) fn chat_store_save_conversation(
    paths: &PathsState,
    conversation: &StoredConversation,
) -> Result<(), String> {
    let path = conversation_file_path(paths, &conversation.meta.id)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建对话目录失败 {:?}: {}", parent, e))?;
    }

    let json =
        serde_json::to_string_pretty(conversation).map_err(|e| format!("序列化对话失败: {}", e))?;
    if let Ok(previous) = std::fs::read_to_string(&path)
        && let Ok(previous_value) = serde_json::from_str::<serde_json::Value>(&previous)
        && let Some(previous_schema) = previous_value
            .get("schema_version")
            .and_then(serde_json::Value::as_u64)
        && previous_schema < u64::from(conversation.schema_version)
    {
        let backup_path = path.with_extension(format!("schema-v{previous_schema}.json.bak"));
        if !backup_path.exists() {
            let mut backup = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&backup_path)
                .map_err(|e| format!("创建会话升级备份失败 {:?}: {}", backup_path, e))?;
            backup
                .write_all(previous.as_bytes())
                .and_then(|_| backup.sync_all())
                .map_err(|e| format!("写入会话升级备份失败 {:?}: {}", backup_path, e))?;
        }
    }
    let temp_path = path.with_extension("json.tmp");
    {
        let mut file = std::fs::File::create(&temp_path)
            .map_err(|e| format!("创建对话临时文件失败 {:?}: {}", temp_path, e))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("写入对话临时文件失败 {:?}: {}", temp_path, e))?;
        file.sync_all()
            .map_err(|e| format!("刷新对话临时文件失败 {:?}: {}", temp_path, e))?;
    }

    replace_conversation_file(&temp_path, &path)
}

#[cfg(not(target_os = "windows"))]
fn replace_conversation_file(temp_path: &Path, path: &Path) -> Result<(), String> {
    std::fs::rename(temp_path, path).map_err(|e| format!("保存对话文件失败 {:?}: {}", path, e))
}

#[cfg(target_os = "windows")]
fn replace_conversation_file(temp_path: &Path, path: &Path) -> Result<(), String> {
    if !path.exists() {
        return std::fs::rename(temp_path, path)
            .map_err(|e| format!("保存对话文件失败 {:?}: {}", path, e));
    }
    let recovery_path = path.with_extension("json.recovery");
    if recovery_path.exists() {
        std::fs::remove_file(&recovery_path)
            .map_err(|e| format!("清理旧恢复文件失败 {:?}: {}", recovery_path, e))?;
    }
    std::fs::rename(path, &recovery_path)
        .map_err(|e| format!("创建对话恢复文件失败 {:?}: {}", recovery_path, e))?;
    match std::fs::rename(temp_path, path) {
        Ok(()) => {
            let _ = std::fs::remove_file(recovery_path);
            Ok(())
        }
        Err(error) => {
            let _ = std::fs::rename(&recovery_path, path);
            Err(format!("保存对话文件失败 {:?}: {}", path, error))
        }
    }
}

pub(super) fn chat_store_delete_conversation(paths: &PathsState, id: &str) -> Result<(), String> {
    let path = conversation_file_path(paths, id)?;
    if !path.exists() {
        return Err(format!("未找到会话：{}", id));
    }
    std::fs::remove_file(&path).map_err(|e| format!("删除对话文件失败 {:?}: {}", path, e))
}

pub(super) fn chat_store_rename_conversation(
    paths: &PathsState,
    id: &str,
    title: String,
) -> Result<(), String> {
    let mut conversation =
        chat_store_get_conversation(paths, id)?.ok_or_else(|| format!("未找到会话：{}", id))?;
    conversation.meta.title = title;
    conversation.meta.updated_at = chrono::Utc::now().to_rfc3339();
    chat_store_save_conversation(paths, &conversation)
}

pub(super) fn stored_messages_to_seeds(messages: Vec<StoredMessage>) -> Vec<ConversationNodeSeed> {
    messages
        .into_iter()
        .map(|message| ConversationNodeSeed {
            node_id: message.node_id,
            parent: message.parent,
            turn_id: message.turn_id,
            timestamp: Some(message.timestamp),
            message: Message {
                role: message.role,
                content: message.content,
                reasoning_content: message.reasoning,
                tool_call_id: message.tool_call_id,
                tool_calls: message.tool_calls,
            },
        })
        .collect()
}

fn compact_runtime_content(text: &str) -> String {
    format!(
        "以下是此前对话的压缩摘要，代表本摘要之前的完整聊天记录。继续对话时请把它当作历史上下文，但不要向用户主动提及压缩。\n\n{}",
        text.trim()
    )
}

pub(super) fn active_message_path(
    messages: &[StoredMessage],
    head: Option<u64>,
) -> Vec<StoredMessage> {
    let by_id = messages
        .iter()
        .filter_map(|message| message.node_id.map(|node_id| (node_id, message)))
        .collect::<HashMap<_, _>>();
    let mut current = head
        .filter(|node_id| by_id.contains_key(node_id))
        .or_else(|| messages.iter().rev().find_map(|message| message.node_id));
    let mut path = Vec::new();
    let mut visited = HashSet::new();

    while let Some(node_id) = current {
        if !visited.insert(node_id) {
            log::warn!(
                "[chat_store] active path detected parent cycle at node_id={}",
                node_id
            );
            break;
        }
        let Some(message) = by_id.get(&node_id) else {
            break;
        };
        path.push((*message).clone());
        current = message.parent;
    }

    path.reverse();
    path
}

pub(super) fn stored_conversation_to_runtime_seeds(
    conversation: &StoredConversation,
) -> Vec<ConversationNodeSeed> {
    let Some(compact) = conversation.compact.as_ref() else {
        return stored_messages_to_seeds(conversation.messages.clone());
    };

    let path = active_message_path(&conversation.messages, conversation.head);
    let Some(boundary_index) = path
        .iter()
        .position(|message| message.node_id == Some(compact.position_node_id))
    else {
        return stored_messages_to_seeds(conversation.messages.clone());
    };

    let Some(boundary_message) = path.get(boundary_index) else {
        return stored_messages_to_seeds(conversation.messages.clone());
    };

    let mut seeds = Vec::new();
    let mut parent = None;
    for message in path[..=boundary_index]
        .iter()
        .filter(|message| message.role == "system")
    {
        let node_id = message.node_id;
        seeds.push(ConversationNodeSeed {
            node_id,
            parent,
            turn_id: message.turn_id,
            timestamp: Some(message.timestamp.clone()),
            message: Message {
                role: message.role.clone(),
                content: message.content.clone(),
                reasoning_content: message.reasoning.clone(),
                tool_call_id: message.tool_call_id.clone(),
                tool_calls: message.tool_calls.clone(),
            },
        });
        if node_id.is_some() {
            parent = node_id;
        }
    }

    seeds.push(ConversationNodeSeed {
        node_id: Some(compact.position_node_id),
        parent,
        turn_id: boundary_message.turn_id,
        timestamp: Some(boundary_message.timestamp.clone()),
        message: Message::system(compact_runtime_content(&compact.text)),
    });

    parent = Some(compact.position_node_id);
    for message in path.into_iter().skip(boundary_index + 1) {
        let node_id = message.node_id;
        seeds.push(ConversationNodeSeed {
            node_id,
            parent,
            turn_id: message.turn_id,
            timestamp: Some(message.timestamp),
            message: Message {
                role: message.role,
                content: message.content,
                reasoning_content: message.reasoning,
                tool_call_id: message.tool_call_id,
                tool_calls: message.tool_calls,
            },
        });
        parent = node_id;
    }

    seeds
}

pub(super) fn stored_conversation_to_runtime_context_snapshots(
    conversation: &StoredConversation,
) -> Vec<TurnContextSnapshot> {
    let Some(compact) = conversation.compact.as_ref() else {
        return conversation.context_snapshots.clone();
    };
    let path = active_message_path(&conversation.messages, conversation.head);
    let Some(boundary_index) = path
        .iter()
        .position(|message| message.node_id == Some(compact.position_node_id))
    else {
        return conversation.context_snapshots.clone();
    };
    let retained_node_ids = path
        .iter()
        .skip(boundary_index + 1)
        .filter_map(|message| message.node_id)
        .collect::<HashSet<_>>();
    let mut snapshots = compact.context_snapshot.iter().cloned().collect::<Vec<_>>();
    snapshots.extend(
        conversation
            .context_snapshots
            .iter()
            .filter(|snapshot| retained_node_ids.contains(&snapshot.owner_node_id))
            .cloned(),
    );
    snapshots
}

fn conversation_nodes_to_stored_messages(nodes: Vec<ConversationNode>) -> Vec<StoredMessage> {
    let mut turn_start_times: HashMap<u64, chrono::DateTime<chrono::FixedOffset>> = HashMap::new();
    for node in &nodes {
        if let Ok(timestamp) = chrono::DateTime::parse_from_rfc3339(&node.timestamp) {
            turn_start_times
                .entry(node.turn_id)
                .and_modify(|start| {
                    if timestamp < *start {
                        *start = timestamp;
                    }
                })
                .or_insert(timestamp);
        }
    }

    nodes
        .into_iter()
        .map(|node| {
            let work_seconds = if node.message.role == "assistant" {
                let end_time = chrono::DateTime::parse_from_rfc3339(&node.timestamp).ok();
                end_time
                    .zip(turn_start_times.get(&node.turn_id).copied())
                    .map(|(end, start)| {
                        end.signed_duration_since(start).num_seconds().max(0) as u64
                    })
            } else {
                None
            };
            let message = node.message;
            StoredMessage {
                message_id: Some(format!("msg_{}", node.id)),
                node_id: Some(node.id),
                turn_id: Some(node.turn_id),
                parent: node.parent,
                role: message.role,
                content: message.content,
                reasoning: message.reasoning_content,
                timestamp: node.timestamp,
                work_seconds,
                turn_status: None,
                finish_reason: None,
                continuation_of: None,
                tool_call_id: message.tool_call_id,
                tool_calls: message.tool_calls,
                attachments: Vec::new(),
            }
        })
        .collect()
}

fn auto_title(messages: &[StoredMessage]) -> String {
    messages
        .iter()
        .find(|message| message.role == "user")
        .and_then(|message| message.content.as_deref())
        .map(|content| {
            let truncated: String = content.chars().take(50).collect();
            if content.chars().count() > 50 {
                format!("{}…", truncated)
            } else {
                truncated
            }
        })
        .unwrap_or_else(|| "新对话".to_string())
}

fn merge_compacted_runtime_snapshot(
    existing: StoredConversation,
    mut runtime_messages: Vec<StoredMessage>,
) -> Vec<StoredMessage> {
    apply_existing_message_metadata(&existing.messages, &mut runtime_messages);
    let Some(compact) = existing.compact.as_ref() else {
        return runtime_messages;
    };

    let runtime_compact_content = compact_runtime_content(&compact.text);
    let mut seen_ids = existing
        .messages
        .iter()
        .filter_map(|message| message.node_id)
        .collect::<HashSet<_>>();
    let mut merged = existing.messages;

    for message in runtime_messages {
        if message.node_id == Some(compact.position_node_id)
            && message.role == "system"
            && message.content.as_deref() == Some(runtime_compact_content.as_str())
        {
            continue;
        }

        if let Some(node_id) = message.node_id {
            if !seen_ids.insert(node_id) {
                continue;
            }
        }
        merged.push(message);
    }

    merged.sort_by_key(|message| message.node_id.unwrap_or(u64::MAX));
    merged
}

fn apply_existing_message_metadata(
    existing_messages: &[StoredMessage],
    runtime_messages: &mut [StoredMessage],
) {
    let existing_by_node = existing_messages
        .iter()
        .filter_map(|message| message.node_id.map(|node_id| (node_id, message)))
        .collect::<HashMap<_, _>>();

    if existing_by_node.is_empty() {
        return;
    }

    for message in runtime_messages {
        let Some(node_id) = message.node_id else {
            continue;
        };
        if let Some(existing) = existing_by_node.get(&node_id) {
            if !existing.attachments.is_empty() {
                message.attachments = existing.attachments.clone();
            }
            if message.turn_status.is_none() {
                message.turn_status.clone_from(&existing.turn_status);
            }
            if message.finish_reason.is_none() {
                message.finish_reason.clone_from(&existing.finish_reason);
            }
            if message.continuation_of.is_none() {
                message.continuation_of = existing.continuation_of;
            }
        }
    }
}

#[derive(Debug, Clone)]
struct TurnSnapshotOutcome {
    node_id: u64,
    turn_status: String,
    finish_reason: Option<String>,
    continuation_of: Option<u64>,
}

fn apply_turn_outcome(messages: &mut [StoredMessage], outcome: &TurnSnapshotOutcome) {
    let Some(message) = messages
        .iter_mut()
        .find(|message| message.node_id == Some(outcome.node_id))
    else {
        return;
    };
    message.turn_status = Some(outcome.turn_status.clone());
    message.finish_reason.clone_from(&outcome.finish_reason);
    message.continuation_of = outcome.continuation_of;
}

fn chat_store_save_snapshot(
    paths: &PathsState,
    conversation_id: &str,
    plugin_id: &str,
    model: &str,
    requested_settings: Option<StoredConversationSettings>,
    nodes: Vec<ConversationNode>,
    head: Option<u64>,
    context_snapshots: Vec<TurnContextSnapshot>,
    outcome: Option<TurnSnapshotOutcome>,
) -> Result<(), String> {
    let messages = conversation_nodes_to_stored_messages(nodes);
    if messages.is_empty() {
        return Ok(());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let existing = chat_store_get_conversation(paths, conversation_id)?;
    let (title, created_at, compact, settings, context_snapshots, mut messages) = match existing {
        Some(conversation) => {
            let merged_context_snapshots =
                merge_runtime_context_snapshots(&conversation, context_snapshots);
            (
                conversation.meta.title.clone(),
                conversation.meta.created_at.clone(),
                conversation.compact.clone(),
                conversation.settings.clone(),
                merged_context_snapshots,
                merge_compacted_runtime_snapshot(conversation, messages),
            )
        }
        None => (
            auto_title(&messages),
            now.clone(),
            None,
            requested_settings.unwrap_or_default(),
            context_snapshots,
            messages,
        ),
    };
    if let Some(outcome) = outcome.as_ref() {
        apply_turn_outcome(&mut messages, outcome);
    }

    let conversation = StoredConversation {
        schema_version: default_conversation_schema_version(),
        meta: ConversationMeta {
            id: conversation_id.to_string(),
            title,
            plugin_id: plugin_id.to_string(),
            model: model.to_string(),
            created_at,
            updated_at: now,
        },
        settings,
        messages,
        context_snapshots,
        head,
        compact,
    };

    chat_store_save_conversation(paths, &conversation)
}

fn merge_runtime_context_snapshots(
    existing: &StoredConversation,
    runtime_snapshots: Vec<TurnContextSnapshot>,
) -> Vec<TurnContextSnapshot> {
    if existing.compact.is_none() {
        return runtime_snapshots;
    }
    let carried = existing
        .compact
        .as_ref()
        .and_then(|compact| compact.context_snapshot.as_ref());
    let mut merged = existing.context_snapshots.clone();
    for snapshot in runtime_snapshots {
        if carried.is_some_and(|carried| carried == &snapshot) {
            continue;
        }
        if let Some(index) = merged.iter().position(|item| {
            item.owner_node_id == snapshot.owner_node_id && item.placement == snapshot.placement
        }) {
            merged[index] = snapshot;
        } else {
            merged.push(snapshot);
        }
    }
    merged.sort_by_key(|snapshot| snapshot.owner_node_id);
    merged
}

fn conversation_is_owned_by(
    owners: &HashMap<String, String>,
    conversation_id: &str,
    session_id: &str,
) -> bool {
    owners
        .get(conversation_id)
        .is_some_and(|owner| owner == session_id)
}

fn release_conversation_owner(
    owners: &mut HashMap<String, String>,
    conversation_id: &str,
    session_id: &str,
) {
    if conversation_is_owned_by(owners, conversation_id, session_id) {
        owners.remove(conversation_id);
    }
}

async fn save_session_snapshot(
    app: &AppHandle,
    session_id: &str,
    persistence: &SessionPersistence,
    outcome: Option<TurnSnapshotOutcome>,
) {
    let (nodes, head, context_snapshots) = persistence.handle.persistence_snapshot().await;
    let ai_state = app.state::<AiState>();
    let (plugin_id, model) = {
        let sessions = ai_state.sessions.lock().await;
        sessions
            .get(session_id)
            .map(|entry| (entry.plugin_id.clone(), entry.model.clone()))
            .unwrap_or_else(|| (persistence.plugin_id.clone(), persistence.model.clone()))
    };
    // owner 检查与写盘必须在同一临界区，避免检查后被新会话接管再迟到覆盖。
    let owners = ai_state.conversation_owners.lock().await;
    if !conversation_is_owned_by(&owners, &persistence.conversation_id, session_id) {
        log::info!(
            "[chat_store] 跳过过期会话快照: session_id={} conversation_id={} current_owner={:?}",
            session_id,
            persistence.conversation_id,
            owners.get(&persistence.conversation_id)
        );
        return;
    }
    let paths = app.state::<PathsState>();
    match chat_store_save_snapshot(
        paths.inner(),
        &persistence.conversation_id,
        &plugin_id,
        &model,
        persistence.settings.clone(),
        nodes,
        head,
        context_snapshots,
        outcome,
    ) {
        Ok(()) => log::info!(
            "[chat_store] 已保存会话快照: session_id={} conversation_id={}",
            session_id,
            persistence.conversation_id
        ),
        Err(error) => log::error!(
            "[chat_store] 保存会话快照失败: session_id={} conversation_id={} error={}",
            session_id,
            persistence.conversation_id,
            error
        ),
    }
    drop(owners);
}

#[derive(Serialize, Clone)]
pub(crate) struct EventError {
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) error: ApiError,
}

pub(crate) fn turn_status_str(s: &TurnStatus) -> String {
    match s {
        TurnStatus::Ok => "ok".to_string(),
        TurnStatus::Cancelled => "cancelled".to_string(),
        TurnStatus::Interrupted => "interrupted".to_string(),
        TurnStatus::Error(_) => "error".to_string(),
    }
}

pub(crate) fn turn_status_error(s: &TurnStatus) -> Option<ApiError> {
    match s {
        TurnStatus::Error(error) => Some(error.into()),
        _ => None,
    }
}

pub(crate) async fn cleanup_session_state(
    app: &AppHandle,
    session_id: &str,
    run_id: &str,
    conversation_id: Option<&str>,
) {
    let state = app.state::<AiState>();
    let mut sessions = state.sessions.lock().await;
    let current_entry_run_id = sessions.get(session_id).map(|entry| entry.run_id.clone());
    log::info!(
        "[ai:cleanup] session_id={} stream_run_id={} current_entry_run_id={:?}",
        session_id,
        run_id,
        current_entry_run_id
    );
    let should_remove = sessions
        .get(session_id)
        .map(|entry| entry.run_id == run_id)
        .unwrap_or(false);
    if should_remove {
        sessions.remove(session_id);
        drop(sessions);
        state.contradiction_bindings.lock().await.remove(session_id);
        state.world_check_bindings.lock().await.remove(session_id);
        if let Some(conversation_id) = conversation_id {
            let mut owners = state.conversation_owners.lock().await;
            release_conversation_owner(&mut owners, conversation_id, session_id);
        }
    }
}

pub(crate) async fn save_api_usage(
    app: &AppHandle,
    session_id: &str,
    run_id: &str,
    turn_id: u64,
    request_id: u64,
    request_attempt: u32,
    plugin_id: &str,
    model: &str,
    usage: &Usage,
) {
    let ai_state = app.state::<AiState>();
    let manifest_model = {
        let client = ai_state.client.lock().await;
        client
            .list_plugins()
            .into_iter()
            .find(|plugin| plugin.id == plugin_id)
            .and_then(|plugin| plugin.model_info(model).cloned())
    };
    let defaults = {
        let settings_state = app.state::<SettingsState>();
        settings_state.settings.lock().await.llm.clone()
    };
    let (prompt_price_per_m, completion_price_per_m, currency) =
        resolve_usage_price(&defaults, plugin_id, model, manifest_model.as_ref());

    log::info!(
        "[usage] saving request: session={} run={} turn={} request={}.{} model={} plugin={} prompt={} completion={} total={} cached={:?}",
        session_id,
        run_id,
        turn_id,
        request_id,
        request_attempt,
        model,
        plugin_id,
        usage.prompt_tokens,
        usage.completion_tokens,
        usage.total_tokens,
        usage.cached_prompt_tokens,
    );

    let app_state = app.state::<std::sync::Arc<crate::AppState>>();
    let db = app_state.inner().sqlite_db.lock().await;
    let input = worldflow_core::models::CreateApiUsageLog {
        id: Uuid::new_v4().to_string(),
        session_id: session_id.to_string(),
        model: model.to_string(),
        provider: plugin_id.to_string(),
        modality: "llm".to_string(),
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        prompt_price_per_m,
        completion_price_per_m,
        currency,
        record_granularity: "request".to_string(),
        run_id: Some(run_id.to_string()),
        turn_id: i64::try_from(turn_id).ok(),
        request_id: i64::try_from(request_id).ok(),
        request_attempt: Some(i64::from(request_attempt)),
        cached_prompt_tokens: usage.cached_prompt_tokens,
        cache_creation_prompt_tokens: usage.cache_creation_prompt_tokens,
    };
    if let Err(e) = worldflow_core::insert_api_usage(&db.pool, &input).await {
        log::error!("[usage] insert failed: {}", e);
    } else {
        log::info!("[usage] saved successfully for session {}", session_id);
    }
}

fn resolve_usage_price(
    defaults: &crate::settings::LlmDefaults,
    plugin_id: &str,
    model: &str,
    manifest_model: Option<&flowcloudai_client::plugin::types::ModelInfo>,
) -> (Option<f64>, Option<f64>, Option<String>) {
    let key = format!("{plugin_id}:{model}");
    let overridden = defaults.model_price_overrides.get(&key).and_then(|price| {
        normalize_usage_price(
            Some(price.prompt_price_per_m),
            Some(price.completion_price_per_m),
            Some(price.currency.as_str()),
        )
    });
    overridden
        .or_else(|| {
            let price = manifest_model?;
            normalize_usage_price(
                price.prompt_price_per_m,
                price.completion_price_per_m,
                price.currency.as_deref(),
            )
        })
        .map_or((None, None, None), |(prompt, completion, currency)| {
            (Some(prompt), Some(completion), Some(currency))
        })
}

fn normalize_usage_price(
    prompt: Option<f64>,
    completion: Option<f64>,
    currency: Option<&str>,
) -> Option<(f64, f64, String)> {
    let (prompt, completion, currency) = (prompt?, completion?, currency?.trim());
    (prompt.is_finite()
        && completion.is_finite()
        && prompt >= 0.0
        && completion >= 0.0
        && !currency.is_empty())
    .then(|| (prompt, completion, currency.to_uppercase()))
}

pub(crate) fn build_llm_session_config(
    client: &flowcloudai_client::FlowCloudAIClient,
    plugin_id: &str,
    model: Option<&str>,
    max_tool_rounds: Option<usize>,
    defaults: &crate::settings::LlmDefaults,
) -> (SessionConfig, String) {
    let plugin = client
        .list_plugins()
        .into_iter()
        .find(|plugin| plugin.id == plugin_id);
    let metadata_model = model
        .filter(|model| !model.is_empty() && *model != "default")
        .map(str::to_string)
        .or_else(|| {
            plugin
                .as_ref()
                .and_then(|plugin| plugin.default_model().map(str::to_string))
        });
    let context_window_tokens = plugin.as_ref().and_then(|plugin| {
        metadata_model
            .as_deref()
            .and_then(|model| plugin.model_info(model))
            .and_then(|model| model.context_window_tokens)
    });
    let calibration_key = format!(
        "{}:{}",
        plugin_id,
        metadata_model.as_deref().unwrap_or("default")
    );
    let mut config = SessionConfig {
        context_window_tokens,
        calibration_factor: defaults
            .token_calibration_factors
            .get(&calibration_key)
            .copied(),
        ..Default::default()
    };
    if let Some(rounds) = max_tool_rounds {
        config.max_tool_rounds = rounds;
    }
    (config, calibration_key)
}

pub(crate) async fn save_token_calibration(app: &AppHandle, key: &str, factor: f64) {
    if key.is_empty() || !factor.is_finite() || !(0.5..=2.0).contains(&factor) {
        return;
    }
    let Some(state) = app.try_state::<SettingsState>() else {
        return;
    };
    let mut settings = state.settings.lock().await;
    if settings
        .llm
        .token_calibration_factors
        .get(key)
        .is_some_and(|current| (current - factor).abs() < f64::EPSILON)
    {
        return;
    }

    let previous = settings
        .llm
        .token_calibration_factors
        .insert(key.to_string(), factor);
    if let Err(error) = settings.save(&state.path) {
        match previous {
            Some(previous) => {
                settings
                    .llm
                    .token_calibration_factors
                    .insert(key.to_string(), previous);
            }
            None => {
                settings.llm.token_calibration_factors.remove(key);
            }
        }
        log::warn!(
            "[ai:token_calibration_save_failed] key={} error={}",
            key,
            error
        );
    }
}

fn schedule_turn_begin_stall_watchdog(
    app: AppHandle,
    session_id: String,
    run_id: String,
    turn_id: u64,
    node_id: u64,
    event_seq: Arc<AtomicU64>,
    turn_begin_seq: u64,
    delay_secs: u64,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(delay_secs)).await;
        if event_seq.load(Ordering::Relaxed) != turn_begin_seq {
            return;
        }

        let ai_state = app.state::<AiState>();
        let snapshot_target = {
            let sessions = ai_state.sessions.lock().await;
            sessions.get(&session_id).map(|entry| {
                (
                    entry.handle.clone(),
                    entry.kind.clone(),
                    entry.plugin_id.clone(),
                    entry.model.clone(),
                    sessions.len(),
                )
            })
        };
        if let Some((handle, kind, plugin_id, model, active_count)) = snapshot_target {
            log::warn!(
                "[ai:turn_stall] session_id={} run_id={} turn_id={} node_id={} stalled_secs={} kind={:?} plugin_id={} model={} active_count={} hint=turn_begin 后没有收到 delta/tool/turn_end/error，卡点在 client 内部的 snapshot/orchestrator/prepare_request/http_send/stream_read 阶段",
                session_id,
                run_id,
                turn_id,
                node_id,
                delay_secs,
                kind,
                plugin_id,
                model,
                active_count
            );
            log::warn!(
                "[ai:turn_stall_snapshot][start] session_id={} run_id={} stalled_secs={} timeout_secs=3",
                session_id,
                run_id,
                delay_secs
            );
            match tokio::time::timeout(Duration::from_secs(3), handle.get_conversation()).await {
                Ok(req) => {
                    let tool_count = req.tools.as_ref().map_or(0, Vec::len);
                    let content_chars: usize = req
                        .messages
                        .iter()
                        .filter_map(|message| message.content.as_ref())
                        .map(|content| content.chars().count())
                        .sum();
                    let last_role = req
                        .messages
                        .last()
                        .map(|message| message.role.as_str())
                        .unwrap_or("<none>");
                    log::warn!(
                        "[ai:turn_stall_snapshot] session_id={} run_id={} stalled_secs={} snapshot_read=ok messages={} last_role={} content_chars={} tool_count={} stream={:?} thinking_set={}",
                        session_id,
                        run_id,
                        delay_secs,
                        req.messages.len(),
                        last_role,
                        content_chars,
                        tool_count,
                        req.stream,
                        req.thinking.is_some()
                    );
                }
                Err(_) => {
                    log::warn!(
                        "[ai:turn_stall_snapshot] session_id={} run_id={} stalled_secs={} snapshot_read=timeout timeout_secs=3 hint=读取 session 快照超时，优先检查 conversation/tree 锁或快照线性化",
                        session_id,
                        run_id,
                        delay_secs
                    );
                }
            }
        } else {
            log::warn!(
                "[ai:turn_stall] session_id={} run_id={} turn_id={} node_id={} stalled_secs={} session_missing=true hint=turn_begin 后没有收到下游事件，但 session 已不在活动表中",
                session_id,
                run_id,
                turn_id,
                node_id,
                delay_secs
            );
        }
    });
}

pub(crate) fn spawn_session_event_loop<S>(
    app: AppHandle,
    session_id: String,
    run_id: String,
    calibration_key: String,
    persistence: SessionPersistence,
    event_stream: S,
) where
    S: futures::Stream<Item = SessionEvent> + Send + 'static,
{
    let sid = session_id.clone();
    let rid = run_id.clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        log::info!("[ai:event_loop][start] session_id={} run_id={}", sid, rid);
        futures::pin_mut!(event_stream);
        let event_seq = Arc::new(AtomicU64::new(0));
        while let Some(ev) = event_stream.next().await {
            let current_event_seq = event_seq.fetch_add(1, Ordering::Relaxed) + 1;
            match ev {
                SessionEvent::NeedInput => {
                    log::info!("[ai:ready] session_id={} run_id={}", sid, rid);
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
                    log::info!(
                        "[ai:turn_begin] session_id={} run_id={} turn_id={} node_id={}",
                        sid,
                        rid,
                        turn_id,
                        node_id
                    );
                    for delay_secs in [15_u64, 45, 90] {
                        schedule_turn_begin_stall_watchdog(
                            app_clone.clone(),
                            sid.clone(),
                            rid.clone(),
                            turn_id,
                            node_id,
                            Arc::clone(&event_seq),
                            current_event_seq,
                            delay_secs,
                        );
                    }
                    // 用户节点已经进入消息树；此时先落盘，避免回复失败或应用退出时丢失首条消息。
                    save_session_snapshot(&app_clone, &sid, &persistence, None).await;
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
                    log::info!("[ai:delta] run_id={} len={}", rid, text.len());
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
                    log::info!("[ai:reasoning] run_id={} len={}", rid, text.len());
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
                    log::info!(
                        "[ai:tool_call] run_id={} index={} name={} args_len={}",
                        rid,
                        index,
                        name,
                        arguments.len()
                    );
                    let name_for_log = name.clone();
                    let args_len = arguments.len();
                    match app_clone.emit(
                        "ai:tool_call",
                        EventToolCall {
                            session_id: sid.clone(),
                            run_id: rid.clone(),
                            index,
                            name,
                            arguments,
                        },
                    ) {
                        Ok(()) => log::info!(
                            "[ai:tool_call_emit_done] session_id={} run_id={} index={} name={} args_len={}",
                            sid,
                            rid,
                            index,
                            name_for_log,
                            args_len
                        ),
                        Err(error) => log::warn!(
                            "[ai:tool_call_emit_failed] session_id={} run_id={} index={} name={} error={}",
                            sid,
                            rid,
                            index,
                            name_for_log,
                            error
                        ),
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
                        "[ai:tool_retrying] run_id={} index={} name={} attempt={}/{} delay_ms={}",
                        rid,
                        index,
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
                SessionEvent::ToolResult {
                    index,
                    output,
                    is_error,
                } => {
                    log::info!(
                        "[ai:tool_result] run_id={} index={} is_error={} output_len={}",
                        rid,
                        index,
                        is_error,
                        output.len()
                    );
                    let output_len = output.len();
                    match app_clone.emit(
                        "ai:tool_result",
                        EventToolResult {
                            session_id: sid.clone(),
                            run_id: rid.clone(),
                            index,
                            output: output.clone(),
                            result: output,
                            is_error,
                        },
                    ) {
                        Ok(()) => log::info!(
                            "[ai:tool_result_emit_done] session_id={} run_id={} index={} is_error={} output_len={}",
                            sid,
                            rid,
                            index,
                            is_error,
                            output_len
                        ),
                        Err(error) => log::warn!(
                            "[ai:tool_result_emit_failed] session_id={} run_id={} index={} is_error={} error={}",
                            sid,
                            rid,
                            index,
                            is_error,
                            error
                        ),
                    }
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
                        "[ai:context_trimmed] session_id={} run_id={} dropped_rounds={} truncated_messages={} before={} after={} suggest_compaction={} estimate_source={}",
                        sid,
                        rid,
                        dropped_rounds,
                        truncated_messages,
                        before,
                        after,
                        suggest_compaction,
                        estimate_source
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
                SessionEvent::RequestUsage {
                    turn_id,
                    request_id,
                    attempt,
                    usage,
                } => {
                    let (plugin_id, model) = {
                        let ai_state = app_clone.state::<AiState>();
                        let sessions = ai_state.sessions.lock().await;
                        sessions
                            .get(&sid)
                            .map(|entry| (entry.plugin_id.clone(), entry.model.clone()))
                            .unwrap_or_else(|| {
                                (persistence.plugin_id.clone(), persistence.model.clone())
                            })
                    };
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
                    let status_text = turn_status_str(&status);
                    log::info!(
                        "[ai:turn_end] session_id={} run_id={} status={} node_id={:?} finish_reason={:?} continuation_of={:?} has_usage={}",
                        sid,
                        rid,
                        status_text,
                        node_id,
                        finish_reason,
                        continuation_of,
                        usage.is_some()
                    );
                    let snapshot_outcome = node_id.map(|node_id| TurnSnapshotOutcome {
                        node_id,
                        turn_status: status_text.clone(),
                        finish_reason: finish_reason.clone(),
                        continuation_of,
                    });
                    save_session_snapshot(&app_clone, &sid, &persistence, snapshot_outcome).await;
                    if let Some(factor) = calibration_factor {
                        save_token_calibration(&app_clone, &calibration_key, factor).await;
                    }
                    app_clone
                        .emit(
                            "ai:turn_end",
                            EventTurnEnd {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                status: status_text,
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
                }
                SessionEvent::Error(e) => {
                    log::error!("[ai:error] session_id={} run_id={} error={}", sid, rid, e);
                    // 部分供应商会在 TurnBegin 后直接报错，保留已进入消息树的用户内容。
                    save_session_snapshot(&app_clone, &sid, &persistence, None).await;
                    app_clone
                        .emit(
                            "ai:error",
                            EventError {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                error: e.into(),
                            },
                        )
                        .ok();
                    break;
                }
                SessionEvent::BranchChanged { node_id } => {
                    log::info!("[ai:branch_changed] run_id={} node_id={}", rid, node_id);
                    save_session_snapshot(&app_clone, &sid, &persistence, None).await;
                    app_clone
                        .emit(
                            "ai:branch_changed",
                            EventBranchChanged {
                                session_id: sid.clone(),
                                run_id: rid.clone(),
                                node_id,
                            },
                        )
                        .ok();
                }
            }
        }

        log::info!(
            "[ai:event_loop][finished] session_id={} run_id={}",
            sid,
            rid
        );
        cleanup_session_state(&app_clone, &sid, &rid, Some(&persistence.conversation_id)).await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_message_path_无效_head_退回最后一条消息() {
        let messages: Vec<StoredMessage> = serde_json::from_value(serde_json::json!([
            {
                "node_id": 1,
                "role": "user",
                "content": "问题",
                "timestamp": "2026-08-01T00:00:00Z"
            },
            {
                "node_id": 2,
                "parent": 1,
                "role": "assistant",
                "content": "回答",
                "timestamp": "2026-08-01T00:00:01Z"
            }
        ]))
        .unwrap();

        let path = active_message_path(&messages, Some(999));

        assert_eq!(
            path.iter()
                .filter_map(|message| message.node_id)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
    }

    #[test]
    fn newer_session_keeps_conversation_ownership() {
        let mut owners = HashMap::from([("conversation".to_string(), "session-1".to_string())]);
        assert!(conversation_is_owned_by(
            &owners,
            "conversation",
            "session-1"
        ));

        owners.insert("conversation".to_string(), "session-2".to_string());
        assert!(!conversation_is_owned_by(
            &owners,
            "conversation",
            "session-1"
        ));
        release_conversation_owner(&mut owners, "conversation", "session-1");
        assert!(conversation_is_owned_by(
            &owners,
            "conversation",
            "session-2"
        ));

        release_conversation_owner(&mut owners, "conversation", "session-2");
        assert!(!owners.contains_key("conversation"));
    }

    #[test]
    fn usage_price_override_wins_and_is_normalized() {
        let mut defaults = crate::settings::LlmDefaults::default();
        defaults.model_price_overrides.insert(
            "plugin:model".to_string(),
            crate::settings::ModelPriceOverride {
                prompt_price_per_m: 3.0,
                completion_price_per_m: 6.0,
                currency: " usd ".to_string(),
            },
        );
        let manifest = flowcloudai_client::plugin::types::ModelInfo {
            id: "model".to_string(),
            prompt_price_per_m: Some(1.0),
            completion_price_per_m: Some(2.0),
            currency: Some("CNY".to_string()),
            ..Default::default()
        };

        assert_eq!(
            resolve_usage_price(&defaults, "plugin", "model", Some(&manifest)),
            (Some(3.0), Some(6.0), Some("USD".to_string()))
        );
    }

    #[test]
    fn user_only_snapshot_is_persisted() {
        let root =
            std::env::temp_dir().join(format!("flowcloudai-user-snapshot-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let paths = PathsState {
            db_path: root.join("flowcloudai.db"),
            plugins_path: root.join("plugins"),
        };
        let timestamp = chrono::Utc::now().to_rfc3339();

        chat_store_save_snapshot(
            &paths,
            "session_test",
            "test-plugin",
            "test-model",
            None,
            vec![ConversationNode {
                id: 1,
                message: Message::user("首条消息"),
                parent: None,
                turn_id: 1,
                timestamp,
            }],
            Some(1),
            Vec::new(),
            None,
        )
        .unwrap();

        let saved = chat_store_get_conversation(&paths, "session_test")
            .unwrap()
            .unwrap();
        assert_eq!(saved.meta.title, "首条消息");
        assert_eq!(saved.messages.len(), 1);
        assert_eq!(saved.messages[0].role, "user");
        assert_eq!(saved.messages[0].content.as_deref(), Some("首条消息"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn v3_message_without_outcome_fields_still_loads() {
        let conversation: StoredConversation = serde_json::from_value(serde_json::json!({
            "schema_version": 3,
            "id": "legacy",
            "title": "旧对话",
            "plugin_id": "deepseek",
            "model": "deepseek-reasoner",
            "created_at": "2026-07-31T00:00:00Z",
            "updated_at": "2026-07-31T00:00:01Z",
            "messages": [{
                "node_id": 1,
                "role": "assistant",
                "reasoning": "旧思考",
                "timestamp": "2026-07-31T00:00:01Z"
            }],
            "head": 1
        }))
        .unwrap();

        assert_eq!(conversation.schema_version, 3);
        assert_eq!(conversation.messages[0].turn_status, None);
        assert_eq!(conversation.messages[0].finish_reason, None);
        assert_eq!(conversation.messages[0].continuation_of, None);
        assert!(conversation.context_snapshots.is_empty());
    }

    #[test]
    fn snapshot_preserves_previous_outcome_and_saves_continuation_relation() {
        let root = std::env::temp_dir().join(format!(
            "flowcloudai-outcome-snapshot-test-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let paths = PathsState {
            db_path: root.join("flowcloudai.db"),
            plugins_path: root.join("plugins"),
        };
        let timestamp = "2026-07-31T00:00:00Z".to_string();
        let user = ConversationNode {
            id: 1,
            message: Message::user("长文"),
            parent: None,
            turn_id: 1,
            timestamp: timestamp.clone(),
        };
        let first = ConversationNode {
            id: 2,
            message: Message::assistant(Some("前半"), Some("思考"), None),
            parent: Some(1),
            turn_id: 1,
            timestamp: timestamp.clone(),
        };

        chat_store_save_snapshot(
            &paths,
            "session_outcome",
            "deepseek",
            "deepseek-reasoner",
            None,
            vec![user.clone(), first.clone()],
            Some(2),
            Vec::new(),
            Some(TurnSnapshotOutcome {
                node_id: 2,
                turn_status: "ok".to_string(),
                finish_reason: Some("length".to_string()),
                continuation_of: None,
            }),
        )
        .unwrap();

        let second = ConversationNode {
            id: 3,
            message: Message::assistant(Some("后半"), None::<String>, None),
            parent: Some(2),
            turn_id: 2,
            timestamp,
        };
        chat_store_save_snapshot(
            &paths,
            "session_outcome",
            "deepseek",
            "deepseek-reasoner",
            None,
            vec![user, first, second],
            Some(3),
            Vec::new(),
            Some(TurnSnapshotOutcome {
                node_id: 3,
                turn_status: "ok".to_string(),
                finish_reason: Some("stop".to_string()),
                continuation_of: Some(2),
            }),
        )
        .unwrap();

        let saved = chat_store_get_conversation(&paths, "session_outcome")
            .unwrap()
            .unwrap();
        assert_eq!(saved.schema_version, 5);
        let first = saved
            .messages
            .iter()
            .find(|message| message.node_id == Some(2))
            .unwrap();
        assert_eq!(first.finish_reason.as_deref(), Some("length"));
        let second = saved
            .messages
            .iter()
            .find(|message| message.node_id == Some(3))
            .unwrap();
        assert_eq!(second.finish_reason.as_deref(), Some("stop"));
        assert_eq!(second.continuation_of, Some(2));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn compact_restore_carries_effective_context_after_summary_boundary() {
        let context_snapshot = TurnContextSnapshot {
            owner_node_id: 2,
            placement: ContextSnapshotPlacement::AfterNode,
            assembly_version: 1,
            content_hash: "digest".to_string(),
            sources: vec![flowcloudai_client::ContextSnapshotSource {
                source: "entry".to_string(),
                version: 1,
                content_hash: "source-digest".to_string(),
                content: "仍然有效的词条资料".to_string(),
            }],
        };
        let timestamp = "2026-09-09T00:00:00Z".to_string();
        let message = |node_id, parent, role: &str, content: &str| StoredMessage {
            message_id: Some(format!("msg_{node_id}")),
            node_id: Some(node_id),
            turn_id: Some(node_id),
            parent,
            role: role.to_string(),
            content: Some(content.to_string()),
            reasoning: None,
            timestamp: timestamp.clone(),
            work_seconds: None,
            turn_status: None,
            finish_reason: None,
            continuation_of: None,
            tool_call_id: None,
            tool_calls: None,
            attachments: Vec::new(),
        };
        let conversation = StoredConversation {
            schema_version: 5,
            meta: ConversationMeta {
                id: "compact-context".to_string(),
                title: "压缩恢复".to_string(),
                plugin_id: "test".to_string(),
                model: "test".to_string(),
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
            },
            settings: StoredConversationSettings::default(),
            messages: vec![
                message(1, None, "user", "旧问题"),
                message(2, Some(1), "assistant", "旧回答"),
                message(3, Some(2), "user", "保留问题"),
                message(4, Some(3), "assistant", "保留回答"),
            ],
            context_snapshots: Vec::new(),
            head: Some(4),
            compact: Some(StoredCompact {
                position_node_id: 2,
                text: "历史摘要".to_string(),
                created_at: timestamp,
                context_snapshot: Some(context_snapshot.clone()),
            }),
        };

        let seeds = stored_conversation_to_runtime_seeds(&conversation);
        assert_eq!(seeds.first().and_then(|seed| seed.node_id), Some(2));
        assert_eq!(seeds.first().unwrap().message.role, "system");
        let snapshots = stored_conversation_to_runtime_context_snapshots(&conversation);
        assert_eq!(snapshots, vec![context_snapshot]);
    }

    #[test]
    fn schema_upgrade_preserves_original_file_as_recovery_backup() {
        let root = std::env::temp_dir().join(format!(
            "flowcloudai-schema-upgrade-backup-test-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(root.join("chats")).unwrap();
        let paths = PathsState {
            db_path: root.join("flowcloudai.db"),
            plugins_path: root.join("plugins"),
        };
        let old_json = serde_json::json!({
            "schema_version": 4,
            "id": "upgrade_test",
            "title": "旧格式",
            "plugin_id": "test",
            "model": "test",
            "created_at": "2026-09-09T00:00:00Z",
            "updated_at": "2026-09-09T00:00:00Z",
            "messages": []
        });
        let conversation_path = root.join("chats/upgrade_test.json");
        std::fs::write(
            &conversation_path,
            serde_json::to_string_pretty(&old_json).unwrap(),
        )
        .unwrap();
        let mut upgraded: StoredConversation = serde_json::from_value(old_json.clone()).unwrap();
        upgraded.schema_version = 5;

        chat_store_save_conversation(&paths, &upgraded).unwrap();

        let backup_path = root.join("chats/upgrade_test.schema-v4.json.bak");
        let backup: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(backup_path).unwrap()).unwrap();
        assert_eq!(backup, old_json);
        assert_eq!(
            chat_store_get_conversation(&paths, "upgrade_test")
                .unwrap()
                .unwrap()
                .schema_version,
            5
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
