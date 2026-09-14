//! 词条、标签与关系工具的注册及操作分派。
//!
//! 本文件将模型参数解析为受限操作，再统一执行数据访问、确认与界面更新事件；写入路径不能
//! 绕过确认分派，否则模型工具调用会脱离用户审核。

use crate::tools;
use crate::tools::confirm::request_write_confirmation;
use crate::tools::format;
use anyhow::Result;
use flowcloudai_client::llm::types::ToolFunctionArg;
use flowcloudai_client::tool::{ToolRegistry, arg_str};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::{Mutex, oneshot};

// ── 词条操作分派枚举 ─────────────────────────────────────────────────────────

enum EntryOp {
    GetEntriesDev {
        key: String,
        kind: Option<String>,
        info: Option<Vec<tools::EntryInfo>>,
        sort: Option<String>,
        limit: Option<usize>,
    },
    GetEntryDev {
        keys: Vec<String>,
        info: Option<Vec<tools::EntryInfo>>,
    },
    SearchEntries {
        project_id: String,
        query: String,
        entry_type: Option<String>,
        category_id: Option<String>,
        limit: usize,
    },
    GetEntry {
        entry_id: String,
    },
    GetEntryContentByLine {
        entry_id: String,
        start_line: usize,
        end_line: Option<u64>,
    },
    ListAllEntries {
        project_id: String,
        category_id: Option<String>,
        limit: usize,
        offset: usize,
    },
    ListCategories {
        project_id: String,
    },
    ListEntriesByType {
        project_id: String,
        entry_type: String,
        category_id: Option<String>,
        limit: usize,
        offset: usize,
    },
    ListTagSchemas {
        project_id: String,
    },
    GetEntryRelations {
        entry_id: String,
    },
    GetProjectSummary {
        project_id: String,
    },
    ListProjects,
    ListEntryTypes {
        project_id: String,
    },
    CreateEntry {
        project_id: String,
        category_id: String,
        title: String,
        entry_type: Option<String>,
        summary: Option<String>,
        content: Option<String>,
    },
    UpdateEntry {
        entry_id: String,
        title: Option<String>,
        summary: Option<Option<String>>,
        entry_type: Option<Option<String>>,
    },
    UpdateEntryTags {
        entry_id: String,
        tags: serde_json::Value,
    },
    AddEntryTag {
        entry_id: String,
        schema_id: String,
        value: String,
    },
    RemoveEntryTag {
        entry_id: String,
        schema_id: String,
    },
    CreateRelation {
        a_id: String,
        b_id: String,
        relation: worldflow_core::models::RelationDirection,
        content: String,
    },
    UpdateRelation {
        relation_id: String,
        relation: Option<worldflow_core::models::RelationDirection>,
        content: Option<String>,
    },
    DeleteRelation {
        relation_id: String,
    },
    MoveEntry {
        entry_id: String,
        category_id: Option<String>,
    },
}

async fn dispatch_confirmed_entry_op(
    state: Arc<crate::AppState>,
    app_handle: Option<tauri::AppHandle>,
    pending_edits: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
    op: EntryOp,
) -> anyhow::Result<String> {
    use EntryOp::*;
    let confirmed = match &op {
        CreateEntry {
            project_id,
            category_id,
            title,
            entry_type,
            summary,
            content,
        } => {
            request_write_confirmation(
                app_handle.as_ref(),
                &pending_edits,
                "create_entry",
                format!("新建词条：{}", title),
                summary.clone(),
                vec![
                    format!("项目ID：{}", project_id),
                    format!("分类ID：{}", category_id),
                    format!("类型：{}", entry_type.as_deref().unwrap_or("未指定")),
                    format!(
                        "正文长度：{} 字符",
                        content.as_deref().map(|s| s.chars().count()).unwrap_or(0)
                    ),
                ],
                None,
            )
            .await?
        }
        UpdateEntry {
            entry_id,
            title,
            summary,
            entry_type,
        } => {
            if title.is_none() && summary.is_none() && entry_type.is_none() {
                anyhow::bail!("修改未完成：title、summary、entry_type 至少需要提供一个");
            }
            let entry = tools::get_entry(state.as_ref(), entry_id)
                .await
                .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            let mut details = Vec::new();
            if let Some(title) = title {
                details.push(format!("标题：{} -> {}", entry.title, title));
            }
            if let Some(summary) = summary {
                details.push(format!(
                    "摘要：{} -> {}",
                    entry.summary.as_deref().unwrap_or("无"),
                    summary.as_deref().unwrap_or("清空")
                ));
            }
            if let Some(entry_type) = entry_type {
                details.push(format!(
                    "类型：{} -> {}",
                    entry.r#type.as_deref().unwrap_or("未指定"),
                    entry_type.as_deref().unwrap_or("清空")
                ));
            }
            request_write_confirmation(
                app_handle.as_ref(),
                &pending_edits,
                "update_entry",
                format!("更新词条：{}", entry.title),
                entry.summary.clone(),
                details,
                None,
            )
            .await?
        }
        UpdateEntryTags { entry_id, tags } => {
            let entry = tools::get_entry(state.as_ref(), entry_id)
                .await
                .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            let tag_count = tags.as_array().map(Vec::len).unwrap_or(0);
            request_write_confirmation(
                app_handle.as_ref(),
                &pending_edits,
                "update_entry_tags",
                format!("全量替换标签：{}", entry.title),
                entry.summary.clone(),
                vec![
                    format!("原标签数量：{}", entry.tags.0.len()),
                    format!("新标签数量：{}", tag_count),
                    "该操作会替换整个标签列表，而不是只追加差异。".to_string(),
                ],
                Some("确认后原标签列表会被新列表覆盖。".to_string()),
            )
            .await?
        }
        AddEntryTag {
            entry_id,
            schema_id,
            value,
        } => {
            let entry = tools::get_entry(state.as_ref(), entry_id)
                .await
                .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            request_write_confirmation(
                app_handle.as_ref(),
                &pending_edits,
                "add_entry_tag",
                format!("添加或覆盖标签：{}", entry.title),
                entry.summary.clone(),
                vec![
                    format!("标签定义ID：{}", schema_id),
                    format!("标签值：{}", value),
                    "若该标签已存在，将覆盖原值。".to_string(),
                ],
                None,
            )
            .await?
        }
        RemoveEntryTag {
            entry_id,
            schema_id,
        } => {
            let entry = tools::get_entry(state.as_ref(), entry_id)
                .await
                .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            request_write_confirmation(
                app_handle.as_ref(),
                &pending_edits,
                "remove_entry_tag",
                format!("移除标签：{}", entry.title),
                entry.summary.clone(),
                vec![format!("标签定义ID：{}", schema_id)],
                Some("确认后该标签值会从词条中移除。".to_string()),
            )
            .await?
        }
        CreateRelation {
            a_id,
            b_id,
            relation,
            content,
        } => {
            let a_title = tools::get_entry(state.as_ref(), a_id)
                .await
                .map(|entry| entry.title)
                .unwrap_or_else(|_| a_id.clone());
            let b_title = tools::get_entry(state.as_ref(), b_id)
                .await
                .map(|entry| entry.title)
                .unwrap_or_else(|_| b_id.clone());
            request_write_confirmation(
                app_handle.as_ref(),
                &pending_edits,
                "create_relation",
                format!("创建关系：{} -> {}", a_title, b_title),
                Some(content.clone()),
                vec![
                    format!("起点：{} ({})", a_title, a_id),
                    format!("终点：{} ({})", b_title, b_id),
                    format!("方向：{}", relation_direction_label(relation)),
                ],
                None,
            )
            .await?
        }
        UpdateRelation {
            relation_id,
            relation,
            content,
        } => {
            if relation.is_none() && content.is_none() {
                anyhow::bail!("修改未完成：relation 和 content 至少需要提供一个");
            }
            let old = tools::get_relation(state.as_ref(), relation_id)
                .await
                .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            let mut details = vec![format!("关系ID：{}", relation_id)];
            if let Some(relation) = relation {
                details.push(format!(
                    "方向：{} -> {}",
                    relation_direction_label(&old.relation),
                    relation_direction_label(relation)
                ));
            }
            if let Some(content) = content {
                details.push(format!("描述：{} -> {}", old.content, content));
            }
            request_write_confirmation(
                app_handle.as_ref(),
                &pending_edits,
                "update_relation",
                "更新词条关系",
                Some(old.content.clone()),
                details,
                None,
            )
            .await?
        }
        DeleteRelation { relation_id } => {
            let rel = tools::get_relation(state.as_ref(), relation_id)
                .await
                .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            request_write_confirmation(
                app_handle.as_ref(),
                &pending_edits,
                "delete_relation",
                "删除词条关系",
                Some(rel.content.clone()),
                vec![
                    format!("关系ID：{}", relation_id),
                    format!("起点ID：{}", rel.a_id),
                    format!("终点ID：{}", rel.b_id),
                    format!("方向：{}", relation_direction_label(&rel.relation)),
                ],
                Some("确认后该关系会被删除。".to_string()),
            )
            .await?
        }
        MoveEntry {
            entry_id,
            category_id,
        } => {
            let entry = tools::get_entry(state.as_ref(), entry_id)
                .await
                .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            let target = match category_id {
                Some(category_id) => tools::get_category(state.as_ref(), category_id)
                    .await
                    .map(|category| format!("{} ({})", category.name, category_id))
                    .unwrap_or_else(|_| category_id.clone()),
                None => "无分类".to_string(),
            };
            request_write_confirmation(
                app_handle.as_ref(),
                &pending_edits,
                "move_entry",
                format!("移动词条：{}", entry.title),
                entry.summary.clone(),
                vec![format!("目标分类：{}", target)],
                None,
            )
            .await?
        }
        _ => true,
    };

    if !confirmed {
        return Ok("用户审核未通过，请停止任务并向用户确认需求".to_string());
    }

    dispatch_entry_op(state, app_handle, op).await
}

fn relation_direction_label(direction: &worldflow_core::models::RelationDirection) -> &'static str {
    match direction {
        worldflow_core::models::RelationDirection::OneWay => "one_way（单向）",
        worldflow_core::models::RelationDirection::TwoWay => "two_way（双向）",
    }
}

async fn dispatch_entry_op(
    state: Arc<crate::AppState>,
    app_handle: Option<tauri::AppHandle>,
    op: EntryOp,
) -> anyhow::Result<String> {
    use EntryOp::*;
    match op {
        GetEntriesDev {
            key,
            kind,
            info,
            sort,
            limit,
        } => tools::get_entries_dev(
            state.as_ref(),
            &key,
            kind.as_deref(),
            info,
            sort.as_deref(),
            limit,
        )
        .await
        .map_err(|e| anyhow::anyhow!("{}", e)),
        GetEntryDev { keys, info } => tools::list_entry_dev(state.as_ref(), &keys, info)
            .await
            .map_err(|e| anyhow::anyhow!("{}", e)),
        SearchEntries {
            project_id,
            query,
            entry_type,
            category_id,
            limit,
        } => {
            let result = tools::search_entries(
                state.as_ref(),
                &project_id,
                &query,
                entry_type.as_deref(),
                category_id.as_deref(),
                limit,
            )
            .await
            .map_err(|e| anyhow::anyhow!("{}", e))?;
            Ok(format::format_entry_briefs(&result))
        }
        GetEntry { entry_id } => {
            let entry = tools::get_entry(state.as_ref(), &entry_id)
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            Ok(format::format_entry(&entry))
        }
        GetEntryContentByLine {
            entry_id,
            start_line,
            end_line,
        } => {
            if start_line == 0 {
                anyhow::bail!("start_line 必须从 1 开始");
            }
            let entry = tools::get_entry(state.as_ref(), &entry_id)
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            let lines: Vec<&str> = entry.content.lines().collect();
            let total_lines = lines.len();
            if total_lines == 0 {
                return Ok("该词条正文为空".to_string());
            }
            let start = if start_line > total_lines {
                return Ok(format!(
                    "起始行号 {} 超出总行数 {}",
                    start_line, total_lines
                ));
            } else {
                start_line - 1
            };
            let end = match end_line {
                Some(e) => {
                    if e == 0 {
                        anyhow::bail!("end_line 必须从 1 开始");
                    }
                    (e as usize).min(total_lines) - 1
                }
                None => total_lines - 1,
            };
            if end < start {
                anyhow::bail!("end_line ({}) 不能小于 start_line ({})", end + 1, start + 1);
            }
            let mut result = format!("词条: {} (共 {} 行)\n\n", entry.title, total_lines);
            for (i, line) in lines[start..=end].iter().enumerate() {
                result.push_str(&format!("{:>4}: {}\n", start + i + 1, line));
            }
            Ok(result)
        }
        ListAllEntries {
            project_id,
            category_id,
            limit,
            offset,
        } => {
            let result = tools::list_all_entries(
                state.as_ref(),
                &project_id,
                category_id.as_deref(),
                limit,
                offset,
            )
            .await
            .map_err(|e| anyhow::anyhow!("{}", e))?;
            Ok(format::format_entry_briefs(&result))
        }
        ListCategories { project_id } => {
            let categories = tools::list_categories(state.as_ref(), &project_id)
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            Ok(format::format_categories(&categories))
        }
        ListEntriesByType {
            project_id,
            entry_type,
            category_id,
            limit,
            offset,
        } => {
            let result = tools::list_entries_by_type(
                state.as_ref(),
                &project_id,
                &entry_type,
                category_id.as_deref(),
                limit,
                offset,
            )
            .await
            .map_err(|e| anyhow::anyhow!("{}", e))?;
            Ok(format::format_entry_briefs(&result))
        }
        ListTagSchemas { project_id } => {
            let schemas = tools::list_tag_schemas(state.as_ref(), &project_id)
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            Ok(format::format_tag_schemas(&schemas))
        }
        GetEntryRelations { entry_id } => {
            let (relations, entry_names) = tools::get_entry_relations(state.as_ref(), &entry_id)
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            Ok(format::format_relations(
                &relations,
                &entry_id,
                &entry_names,
            ))
        }
        GetProjectSummary { project_id } => {
            let (project, counts) = tools::get_project_summary(state.as_ref(), &project_id)
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            Ok(format::format_project_summary(&project, &counts))
        }
        ListProjects => {
            let projects = tools::list_projects(state.as_ref())
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            Ok(format::format_projects(&projects))
        }
        ListEntryTypes { project_id } => {
            let types = tools::list_entry_types(state.as_ref(), &project_id)
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            Ok(format::format_entry_types(&types))
        }
        CreateEntry {
            project_id,
            category_id,
            title,
            entry_type,
            summary,
            content,
        } => {
            let (entry, affected_entry_ids) = tools::create_entry(
                state.as_ref(),
                &project_id,
                &category_id,
                title,
                entry_type,
                summary,
                content,
            )
            .await
            .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            if let Some(ref h) = app_handle {
                #[derive(serde::Serialize, Clone)]
                struct Evt {
                    entry_id: String,
                    project_id: String,
                }
                let _ = h.emit(
                    "entry:created",
                    Evt {
                        entry_id: entry.id.to_string(),
                        project_id: entry.project_id.to_string(),
                    },
                );
                #[derive(serde::Serialize, Clone)]
                struct UpdatedEvt {
                    entry_id: String,
                }
                for linked_entry_id in affected_entry_ids.iter().filter(|id| **id != entry.id) {
                    let _ = h.emit(
                        "entry:updated",
                        UpdatedEvt {
                            entry_id: linked_entry_id.to_string(),
                        },
                    );
                }
            }
            Ok("修改已完成".to_string())
        }
        UpdateEntry {
            entry_id,
            title,
            summary,
            entry_type,
        } => {
            if title.is_none() && summary.is_none() && entry_type.is_none() {
                anyhow::bail!("修改未完成：title、summary、entry_type 至少需要提供一个");
            }
            let entry =
                tools::update_entry_fields(state.as_ref(), &entry_id, title, summary, entry_type)
                    .await
                    .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            if let Some(ref h) = app_handle {
                #[derive(serde::Serialize, Clone)]
                struct Evt {
                    entry_id: String,
                }
                let _ = h.emit(
                    "entry:updated",
                    Evt {
                        entry_id: entry.id.to_string(),
                    },
                );
            }
            Ok("修改已完成".to_string())
        }
        UpdateEntryTags { entry_id, tags } => {
            let tags: Vec<worldflow_core::models::EntryTag> = serde_json::from_value(tags)
                .map_err(|e| anyhow::anyhow!("修改未完成：tags 格式错误: {}", e))?;
            let entry = tools::update_entry_tags(state.as_ref(), &entry_id, tags)
                .await
                .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            if let Some(ref h) = app_handle {
                #[derive(serde::Serialize, Clone)]
                struct Evt {
                    entry_id: String,
                }
                let _ = h.emit(
                    "entry:updated",
                    Evt {
                        entry_id: entry.id.to_string(),
                    },
                );
            }
            Ok("修改已完成".to_string())
        }
        AddEntryTag {
            entry_id,
            schema_id,
            value,
        } => {
            let entry = tools::add_entry_tag(state.as_ref(), &entry_id, &schema_id, value)
                .await
                .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            if let Some(ref h) = app_handle {
                #[derive(serde::Serialize, Clone)]
                struct Evt {
                    entry_id: String,
                }
                let _ = h.emit(
                    "entry:updated",
                    Evt {
                        entry_id: entry.id.to_string(),
                    },
                );
            }
            Ok("修改已完成".to_string())
        }
        RemoveEntryTag {
            entry_id,
            schema_id,
        } => {
            let entry = tools::remove_entry_tag(state.as_ref(), &entry_id, &schema_id)
                .await
                .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            if let Some(ref h) = app_handle {
                #[derive(serde::Serialize, Clone)]
                struct Evt {
                    entry_id: String,
                }
                let _ = h.emit(
                    "entry:updated",
                    Evt {
                        entry_id: entry.id.to_string(),
                    },
                );
            }
            Ok("修改已完成".to_string())
        }
        CreateRelation {
            a_id,
            b_id,
            relation,
            content,
        } => {
            let _rel = tools::create_relation(state.as_ref(), &a_id, &b_id, relation, content)
                .await
                .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            if let Some(ref h) = app_handle {
                #[derive(serde::Serialize, Clone)]
                struct Evt {
                    entry_id: String,
                }
                let _ = h.emit(
                    "entry:updated",
                    Evt {
                        entry_id: a_id.clone(),
                    },
                );
                let _ = h.emit(
                    "entry:updated",
                    Evt {
                        entry_id: b_id.clone(),
                    },
                );
            }
            Ok("修改已完成".to_string())
        }
        UpdateRelation {
            relation_id,
            relation,
            content,
        } => {
            if relation.is_none() && content.is_none() {
                anyhow::bail!("修改未完成：relation 和 content 至少需要提供一个");
            }
            let (a_id, b_id) = {
                let rel = tools::get_relation(state.as_ref(), &relation_id)
                    .await
                    .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
                (rel.a_id, rel.b_id)
            };
            let _rel = tools::update_relation(state.as_ref(), &relation_id, relation, content)
                .await
                .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            if let Some(ref h) = app_handle {
                #[derive(serde::Serialize, Clone)]
                struct Evt {
                    entry_id: String,
                }
                let _ = h.emit(
                    "entry:updated",
                    Evt {
                        entry_id: a_id.to_string(),
                    },
                );
                let _ = h.emit(
                    "entry:updated",
                    Evt {
                        entry_id: b_id.to_string(),
                    },
                );
            }
            Ok("修改已完成".to_string())
        }
        DeleteRelation { relation_id } => {
            let (a_id, b_id) = {
                let rel = tools::get_relation(state.as_ref(), &relation_id)
                    .await
                    .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
                (rel.a_id, rel.b_id)
            };
            tools::delete_relation(state.as_ref(), &relation_id)
                .await
                .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            if let Some(ref h) = app_handle {
                #[derive(serde::Serialize, Clone)]
                struct Evt {
                    entry_id: String,
                }
                let _ = h.emit(
                    "entry:updated",
                    Evt {
                        entry_id: a_id.to_string(),
                    },
                );
                let _ = h.emit(
                    "entry:updated",
                    Evt {
                        entry_id: b_id.to_string(),
                    },
                );
            }
            Ok("修改已完成".to_string())
        }
        MoveEntry {
            entry_id,
            category_id,
        } => {
            let entry = tools::move_entry(state.as_ref(), &entry_id, category_id.as_deref())
                .await
                .map_err(|e| anyhow::anyhow!("修改未完成：{}", e))?;
            if let Some(ref h) = app_handle {
                #[derive(serde::Serialize, Clone)]
                struct Evt {
                    entry_id: String,
                }
                let _ = h.emit(
                    "entry:updated",
                    Evt {
                        entry_id: entry.id.to_string(),
                    },
                );
            }
            Ok("修改已完成".to_string())
        }
    }
}

// ── 注册入口 ─────────────────────────────────────────────────────────────────

/// 注册词条相关工具（查询、列表、更新）
pub fn register_entry_tools(registry: &mut ToolRegistry) -> Result<()> {
    registry.register_async::<WorldflowToolState, _>(
        "list_entries_dev",
        "开发版：get_entries_dev 的语义化别名；按项目或分类的名称/ID 获取词条轻量列表，可按类型、摘要、排序和数量限制控制输出",
        vec![
            ToolFunctionArg::new("key", "string")
                .required(true)
                .desc("项目或分类的名称/ID；同名命中多个范围时会返回候选而不是自动猜测"),
            ToolFunctionArg::new("kind", "string")
                .desc("可选：词条类型名称、内置 key 或自定义类型 ID"),
            ToolFunctionArg::new("info", "array")
                .desc("可选：EntryInfo 字符串数组；目前 SUM/SUMMARY/FULL 会为列表追加摘要")
                .items(serde_json::json!({
                    "type": "string",
                    "enum": ["FULL", "TITLE", "TYPE", "SUMMARY", "TAG", "CONTENT", "RELATIONS"]
                })),
            ToolFunctionArg::new("sort", "string")
                .desc("可选：排序字段，支持 title、created_at、updated_at；前缀 - 表示倒序，例如 -updated_at"),
            ToolFunctionArg::new("limit", "integer")
                .desc("可选：返回数量上限")
                .min(1)
                .max(500),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let result = (|| -> Result<EntryOp> {
                let key = arg_str(args, "key")?.to_string();
                let kind = args
                    .get("kind")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let info = parse_entry_info_arg(args.get("info"))?;
                let sort = args
                    .get("sort")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let limit = args.get("limit").and_then(|v| v.as_u64()).map(|v| v as usize);
                Ok(EntryOp::GetEntriesDev {
                    key,
                    kind,
                    info,
                    sort,
                    limit,
                })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_entry_op(app_state, app_handle, op))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "search_entries",
        "在项目中全文搜索词条，返回匹配的词条简报列表",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
            ToolFunctionArg::new("query", "string")
                .required(true)
                .desc("搜索关键词"),
            ToolFunctionArg::new("entry_type", "string")
                .desc("可选：词条类型过滤（如 character, item, location）"),
            ToolFunctionArg::new("category_id", "string")
                .desc("可选：只搜索该分类下的词条（从 list_categories 获取分类ID）"),
            ToolFunctionArg::new("limit", "integer")
                .desc("返回数量限制，默认10")
                .min(1)
                .max(100)
                .default(10),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let project_id = arg_str(args, "project_id")?.to_string();
                let query = arg_str(args, "query")?.to_string();
                let entry_type = args
                    .get("entry_type")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let category_id = args
                    .get("category_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;
                Ok(EntryOp::SearchEntries {
                    project_id,
                    query,
                    entry_type,
                    category_id,
                    limit,
                })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "get_entry",
        "根据词条ID获取完整的词条内容，包括正文、标签和图像信息",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let entry_id = arg_str(args, "entry_id")?.to_string();
                Ok(EntryOp::GetEntry { entry_id })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "get_entry_content_by_line",
        "按行范围获取词条正文内容，用于精确编辑前的内容预览；返回带行号的文本",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
            ToolFunctionArg::new("start_line", "integer")
                .desc("起始行号（从1开始），默认为1")
                .min(1),
            ToolFunctionArg::new("end_line", "integer")
                .desc("结束行号（含），默认为最后一行")
                .min(1),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let entry_id = arg_str(args, "entry_id")?.to_string();
                let start_line =
                    args.get("start_line").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                let end_line = args.get("end_line").and_then(|v| v.as_u64());
                Ok(EntryOp::GetEntryContentByLine {
                    entry_id,
                    start_line,
                    end_line,
                })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "list_all_entries",
        "列出项目内所有词条的简报（不限类型），支持按分类过滤和分页",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
            ToolFunctionArg::new("category_id", "string")
                .desc("可选：只列出该分类下的词条（从 list_categories 获取分类ID）"),
            ToolFunctionArg::new("limit", "integer")
                .desc("返回数量限制，默认50")
                .min(1)
                .max(200)
                .default(50),
            ToolFunctionArg::new("offset", "integer")
                .desc("跳过条数，用于分页，默认0")
                .min(0)
                .default(0),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let project_id = arg_str(args, "project_id")?.to_string();
                let category_id = args
                    .get("category_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
                let offset = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                Ok(EntryOp::ListAllEntries {
                    project_id,
                    category_id,
                    limit,
                    offset,
                })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "list_categories",
        "列出项目的所有分类（含层级结构），用于获取分类ID以过滤词条列表",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let project_id = arg_str(args, "project_id")?.to_string();
                Ok(EntryOp::ListCategories { project_id })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "list_entries_by_type",
        "列出项目中指定类型的词条简报，支持按分类过滤和分页",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
            ToolFunctionArg::new("entry_type", "string")
                .required(true)
                .desc("词条类型（如 character, item, location, event, faction）"),
            ToolFunctionArg::new("category_id", "string")
                .desc("可选：只列出该分类下的词条（从 list_categories 获取分类ID）"),
            ToolFunctionArg::new("limit", "integer")
                .desc("返回数量限制，默认50")
                .min(1)
                .max(100)
                .default(50),
            ToolFunctionArg::new("offset", "integer")
                .desc("跳过条数，用于分页，默认0")
                .min(0)
                .default(0),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let project_id = arg_str(args, "project_id")?.to_string();
                let entry_type = arg_str(args, "entry_type")?.to_string();
                let category_id = args
                    .get("category_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
                let offset = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                Ok(EntryOp::ListEntriesByType {
                    project_id,
                    entry_type,
                    category_id,
                    limit,
                    offset,
                })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "list_tag_schemas",
        "获取项目的标签定义列表，了解可用的标签名称、类型和目标",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let project_id = arg_str(args, "project_id")?.to_string();
                Ok(EntryOp::ListTagSchemas { project_id })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "get_entry_relations",
        "获取指定词条的所有关联关系（单向/双向），用于检测关系链中的矛盾",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let entry_id = arg_str(args, "entry_id")?.to_string();
                Ok(EntryOp::GetEntryRelations { entry_id })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "get_project_summary",
        "获取项目的基本信息和各类型词条的统计数据",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let project_id = arg_str(args, "project_id")?.to_string();
                Ok(EntryOp::GetProjectSummary { project_id })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "list_projects",
        "列出所有项目的ID、名称和描述，用于了解有哪些可用项目",
        vec![],
        |_state, _args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            Box::pin(dispatch_entry_op(
                app_state,
                app_handle,
                EntryOp::ListProjects,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "create_entry",
        "在指定项目的指定分类下新建一个词条，返回新词条的完整信息",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
            ToolFunctionArg::new("category_id", "string")
                .required(true)
                .desc("分类ID（必填，从 list_categories 或 query_categories 获取）"),
            ToolFunctionArg::new("title", "string")
                .required(true)
                .desc("词条标题"),
            ToolFunctionArg::new("entry_type", "string")
                .desc("词条类型（如 character, item, location, event, faction）"),
            ToolFunctionArg::new("summary", "string").desc("词条摘要"),
            ToolFunctionArg::new("content", "string").desc("词条正文，支持 Markdown"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let project_id = arg_str(args, "project_id")?.to_string();
                let category_id = arg_str(args, "category_id")?.to_string();
                let title = arg_str(args, "title")?.to_string();
                let entry_type = args
                    .get("entry_type")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let summary = args
                    .get("summary")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let content = args
                    .get("content")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                Ok(EntryOp::CreateEntry {
                    project_id,
                    category_id,
                    title,
                    entry_type,
                    summary,
                    content,
                })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "update_entry",
        "更新词条的标题、摘要或类型；三个字段均可选，但至少需提供一个。entry_type 传空字符串可清空类型",
        vec![
            ToolFunctionArg::new("entry_id", "string").required(true).desc("词条ID"),
            ToolFunctionArg::new("title", "string").desc("新标题"),
            ToolFunctionArg::new("summary", "string").desc("新摘要内容"),
            ToolFunctionArg::new("entry_type", "string").desc("新类型（如 character, item, location）；空字符串表示清空"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let entry_id = arg_str(args, "entry_id")?.to_string();
                let title: Option<String> = args.get("title").and_then(|v| v.as_str()).map(|s| s.to_string());
                let summary: Option<Option<String>> = args.get("summary").and_then(|v| v.as_str()).map(|s| {
                    if s.is_empty() { None } else { Some(s.to_string()) }
                });
                let entry_type: Option<Option<String>> = args.get("entry_type").and_then(|v| v.as_str()).map(|s| {
                    if s.is_empty() { None } else { Some(s.to_string()) }
                });
                Ok(EntryOp::UpdateEntry { entry_id, title, summary, entry_type })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) })
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "update_entry_tags",
        "全量替换指定词条的标签列表；调用前建议先用 list_tag_schemas 确认可用标签",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
            ToolFunctionArg::new("tags", "array")
                .required(true)
                .desc("标签对象数组，每个对象包含 schema_id（或 name）和 value")
                .items(serde_json::json!({
                    "type": "object",
                    "properties": {
                        "schema_id": { "type": "string", "description": "标签定义ID，优先使用 list_tag_schemas 返回的 schema_id" },
                        "name": { "type": "string", "description": "标签名称；缺少 schema_id 时可用 name 匹配" },
                        "value": { "description": "标签值，可为字符串、数字、布尔值、对象或数组" }
                    },
                    "anyOf": [
                        { "required": ["schema_id", "value"] },
                        { "required": ["name", "value"] }
                    ],
                    "additionalProperties": false
                })),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let entry_id = arg_str(args, "entry_id")?.to_string();
                let tags = args
                    .get("tags")
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("缺少 tags 参数"))?;
                Ok(EntryOp::UpdateEntryTags { entry_id, tags })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "add_entry_tag",
        "向词条添加一个标签；若该 schema_id 的标签已存在则覆盖其值",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
            ToolFunctionArg::new("schema_id", "string")
                .required(true)
                .desc("标签定义ID（从 list_tag_schemas 获取）"),
            ToolFunctionArg::new("value", "string")
                .required(true)
                .desc("标签值"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let entry_id = arg_str(args, "entry_id")?.to_string();
                let schema_id = arg_str(args, "schema_id")?.to_string();
                let value = arg_str(args, "value")?.to_string();
                Ok(EntryOp::AddEntryTag {
                    entry_id,
                    schema_id,
                    value,
                })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "remove_entry_tag",
        "从词条移除指定 schema_id 的标签",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
            ToolFunctionArg::new("schema_id", "string")
                .required(true)
                .desc("要移除的标签定义ID"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let entry_id = arg_str(args, "entry_id")?.to_string();
                let schema_id = arg_str(args, "schema_id")?.to_string();
                Ok(EntryOp::RemoveEntryTag {
                    entry_id,
                    schema_id,
                })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "create_relation",
        "在两个词条之间创建关系；one_way 表示 a → b 单向，two_way 表示双向",
        vec![
            ToolFunctionArg::new("a_id", "string")
                .required(true)
                .desc("关系起点词条ID"),
            ToolFunctionArg::new("b_id", "string")
                .required(true)
                .desc("关系终点词条ID"),
            ToolFunctionArg::new("relation", "string")
                .required(true)
                .desc("关系方向：one_way（a→b 单向）或 two_way（双向）")
                .enum_values(["one_way", "two_way"]),
            ToolFunctionArg::new("content", "string")
                .required(true)
                .desc("关系描述内容"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let a_id = arg_str(args, "a_id")?.to_string();
                let b_id = arg_str(args, "b_id")?.to_string();
                let relation = parse_relation_direction(arg_str(args, "relation")?)?;
                let content = arg_str(args, "content")?.to_string();
                Ok(EntryOp::CreateRelation {
                    a_id,
                    b_id,
                    relation,
                    content,
                })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "update_relation",
        "更新词条关系的方向或描述内容；两个参数均可选，但至少需传一个",
        vec![
            ToolFunctionArg::new("relation_id", "string")
                .required(true)
                .desc("关系ID"),
            ToolFunctionArg::new("relation", "string")
                .desc("新的关系方向：one_way 或 two_way")
                .enum_values(["one_way", "two_way"]),
            ToolFunctionArg::new("content", "string").desc("新的关系描述内容"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let relation_id = arg_str(args, "relation_id")?.to_string();
                let relation = args
                    .get("relation")
                    .and_then(|v| v.as_str())
                    .map(parse_relation_direction)
                    .transpose()?;
                let content = args
                    .get("content")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                Ok(EntryOp::UpdateRelation {
                    relation_id,
                    relation,
                    content,
                })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "delete_relation",
        "删除指定的词条关系",
        vec![
            ToolFunctionArg::new("relation_id", "string")
                .required(true)
                .desc("关系ID"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let relation_id = arg_str(args, "relation_id")?.to_string();
                Ok(EntryOp::DeleteRelation { relation_id })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "list_entry_types",
        "列出项目中所有可用的词条类型（内置类型 + 自定义类型），包含 key/id 和名称",
        vec![
            ToolFunctionArg::new("project_id", "string")
                .required(true)
                .desc("项目ID"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let project_id = arg_str(args, "project_id")?.to_string();
                Ok(EntryOp::ListEntryTypes { project_id })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    registry.register_async::<WorldflowToolState, _>(
        "move_entry",
        "将词条移动到指定分类；不填 category_id 则将词条移出所有分类（置为无分类状态）",
        vec![
            ToolFunctionArg::new("entry_id", "string")
                .required(true)
                .desc("词条ID"),
            ToolFunctionArg::new("category_id", "string").desc("目标分类ID；不填则移出分类"),
        ],
        |_state, args| {
            let app_state = _state.app_state.clone().unwrap();
            let app_handle = _state.app_handle.clone();
            let pending_edits = _state.pending_edits.clone();
            let result = (|| -> anyhow::Result<EntryOp> {
                let entry_id = arg_str(args, "entry_id")?.to_string();
                let category_id = args
                    .get("category_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                Ok(EntryOp::MoveEntry {
                    entry_id,
                    category_id,
                })
            })();
            let op = match result {
                Ok(op) => op,
                Err(e) => return Box::pin(async move { Err(e) }),
            };
            Box::pin(dispatch_confirmed_entry_op(
                app_state,
                app_handle,
                pending_edits,
                op,
            ))
        },
    );

    Ok(())
}

fn parse_string_array_arg(value: &serde_json::Value, name: &str) -> anyhow::Result<Vec<String>> {
    let Some(items) = value.as_array() else {
        anyhow::bail!("{} 必须是字符串数组", name);
    };

    let mut parsed = Vec::with_capacity(items.len());
    for item in items {
        let Some(text) = item.as_str() else {
            anyhow::bail!("{} 数组只能包含字符串", name);
        };
        let text = text.trim();
        if !text.is_empty() {
            parsed.push(text.to_string());
        }
    }
    Ok(parsed)
}

fn parse_entry_info_arg(
    value: Option<&serde_json::Value>,
) -> anyhow::Result<Option<Vec<tools::EntryInfo>>> {
    let Some(value) = value else {
        return Ok(None);
    };

    if value.is_null() {
        return Ok(None);
    }

    if let Some(text) = value.as_str() {
        let text = text.trim();
        if text.is_empty() {
            return Ok(None);
        }
        let items = text
            .split(',')
            .map(|part| tools::EntryInfo::parse(part.trim()).map_err(anyhow::Error::msg))
            .collect::<Result<Vec<_>, _>>()?;
        return Ok(Some(items));
    }

    let Some(items) = value.as_array() else {
        anyhow::bail!("info 必须是字符串数组，或用逗号分隔的字符串");
    };

    if items.is_empty() {
        return Ok(None);
    }

    let mut parsed = Vec::with_capacity(items.len());
    for item in items {
        let Some(name) = item.as_str() else {
            anyhow::bail!("info 数组只能包含字符串");
        };
        parsed.push(tools::EntryInfo::parse(name).map_err(anyhow::Error::msg)?);
    }

    Ok(Some(parsed))
}

fn parse_relation_direction(s: &str) -> anyhow::Result<worldflow_core::models::RelationDirection> {
    match s {
        "one_way" => Ok(worldflow_core::models::RelationDirection::OneWay),
        "two_way" => Ok(worldflow_core::models::RelationDirection::TwoWay),
        other => anyhow::bail!("未知 relation 值: {}，应为 one_way 或 two_way", other),
    }
}

use super::state::WorldflowToolState;
