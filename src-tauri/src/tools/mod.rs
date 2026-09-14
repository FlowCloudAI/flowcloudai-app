//! Worldflow 数据访问工具的领域服务与输出格式化。
//!
//! 子模块负责把模型工具调用注册到客户端；本文件提供与数据库的异步操作和 Markdown 回退格式，
//! 不负责会话权限判定，读写能力由 `registry` 的标注与 Sense 白名单共同约束。

use crate::AppState;
use crate::apis::worldflow::common::{
    open_category_db, open_entry_db, open_project_db, open_relation_db,
};
use crate::apis::worldflow::entries::sync_outgoing_links_from_content;
use std::collections::BTreeSet;
use uuid::Uuid;
use worldflow_core::{
    CategoryOps, EntryOps, EntryRelationOps, EntryTypeOps, ProjectOps, SqliteDb, TagSchemaOps,
    models::*,
};

pub mod category_tools;
pub mod confirm;
pub mod edit_tools;
pub mod entry_tools;
pub mod project_tools;
pub mod registry;
pub mod state;
pub mod web_tools;
pub use registry::register_worldflow_tools;

/// 工具返回结果格式化辅助。
///
/// 全局模板可覆盖回退格式；两者都面向模型消费，修改字段或标题会影响提示词与工具链兼容性。
pub mod format {
    use super::*;
    use crate::template::render_global_template;
    use serde::Serialize;

    #[derive(Serialize)]
    struct ListItemsTemplateContext {
        items: Vec<String>,
    }

    #[derive(Serialize)]
    struct EntryTemplateContext {
        title: String,
        summary: Option<String>,
        entry_type: Option<String>,
        content: Option<String>,
        tags: Vec<String>,
    }

    #[derive(Serialize)]
    struct RelationsTemplateContext {
        current_name: String,
        items: Vec<String>,
    }

    #[derive(Serialize)]
    struct ProjectSummaryTemplateContext {
        name: String,
        description: Option<String>,
        count_lines: Vec<String>,
        created_at: String,
        updated_at: String,
    }

    #[derive(Serialize)]
    struct LinesTemplateContext {
        lines: Vec<String>,
    }

    #[derive(Serialize)]
    struct CategoriesSubtreeTemplateContext {
        header: String,
        lines: Vec<String>,
    }

    /// 格式化词条简报列表（用于 search_entries 返回）
    pub fn format_entry_briefs(briefs: &[EntryBrief]) -> String {
        if briefs.is_empty() {
            return "未找到相关词条".to_string();
        }

        let items = briefs
            .iter()
            .enumerate()
            .map(|(i, brief)| {
                let type_str = brief.r#type.as_deref().unwrap_or("未分类");
                let mut item = format!(
                    "{}. **{}** [{}] (ID: {})\n",
                    i + 1,
                    brief.title,
                    type_str,
                    brief.id
                );
                if let Some(summary) = &brief.summary {
                    item.push_str(&format!("   摘要：{}\n", summary));
                }
                item
            })
            .collect::<Vec<_>>();

        if let Some(rendered) = render_global_template(
            "formats/entry_briefs",
            &ListItemsTemplateContext {
                items: items.clone(),
            },
        ) {
            return rendered;
        }

        let mut result = String::from("找到以下词条：\n\n");
        for item in items {
            result.push_str(&item);
            result.push('\n');
        }
        result
    }

    /// 格式化完整词条（用于 get_entry 返回）
    pub fn format_entry(entry: &Entry) -> String {
        if let Some(rendered) = render_global_template(
            "formats/entry_full",
            &EntryTemplateContext {
                title: entry.title.clone(),
                summary: entry.summary.clone(),
                entry_type: entry.r#type.clone(),
                content: (!entry.content.is_empty()).then(|| entry.content.clone()),
                tags: entry
                    .tags
                    .0
                    .iter()
                    .map(|tag| format!("{} : {}", tag.schema_id, tag.value))
                    .collect(),
            },
        ) {
            return rendered;
        }

        let mut result = String::new();
        result.push_str(&format!("# {}\n\n", entry.title));

        if let Some(summary) = &entry.summary {
            result.push_str(&format!("**摘要**：{}\n\n", summary));
        }

        if let Some(entry_type) = &entry.r#type {
            result.push_str(&format!("**类型**：{}\n\n", entry_type));
        }

        if !entry.content.is_empty() {
            result.push_str(&format!("## 内容\n\n{}\n\n", entry.content));
        }

        if !entry.tags.0.is_empty() {
            result.push_str("## 标签\n\n");
            for tag in &entry.tags.0 {
                result.push_str(&format!("- {} : {}\n", tag.schema_id, tag.value));
            }
            result.push('\n');
        }

        result
    }

    /// 格式化标签定义列表（用于 list_tag_schemas 返回）
    pub fn format_tag_schemas(schemas: &[TagSchema]) -> String {
        if schemas.is_empty() {
            return "该项目未定义任何标签".to_string();
        }

        let items = schemas
            .iter()
            .map(|schema| {
                let mut item = format!(
                    "- **{}** (schema_id: `{}`, 类型: {}, 目标: {})\n",
                    schema.name, schema.id, schema.r#type, schema.target
                );
                if let Some(desc) = &schema.description {
                    item.push_str(&format!("  描述：{}\n", desc));
                }
                if let Some(default) = &schema.default_val {
                    item.push_str(&format!("  默认值：{}\n", default));
                }
                item
            })
            .collect::<Vec<_>>();

        if let Some(rendered) = render_global_template(
            "formats/tag_schemas",
            &ListItemsTemplateContext {
                items: items.clone(),
            },
        ) {
            return rendered;
        }

        let mut result = String::from("项目标签定义：\n\n");
        for item in items {
            result.push_str(&item);
        }
        result
    }

    /// 格式化词条关系列表（用于 get_entry_relations 返回）
    pub fn format_relations(
        relations: &[EntryRelation],
        current_entry_id: &str,
        entry_names: &std::collections::HashMap<String, String>,
    ) -> String {
        if relations.is_empty() {
            return "该词条没有任何关系".to_string();
        }

        let current_id = match Uuid::parse_str(current_entry_id) {
            Ok(id) => id,
            Err(_) => return "当前词条 ID 格式无效".to_string(),
        };

        let name = |id: &Uuid| -> String {
            entry_names
                .get(&id.to_string())
                .cloned()
                .unwrap_or_else(|| id.to_string())
        };

        let current_name = name(&current_id);
        let items = relations
            .iter()
            .map(|rel| match rel.relation {
                RelationDirection::TwoWay => format!(
                    "- **{}** ↔ **{}**（双向）\n  描述：{}\n  关系ID：{}",
                    name(&rel.a_id),
                    name(&rel.b_id),
                    rel.content,
                    rel.id,
                ),
                RelationDirection::OneWay => format!(
                    "- **{}** → **{}**（单向）\n  描述：{}\n  关系ID：{}",
                    name(&rel.a_id),
                    name(&rel.b_id),
                    rel.content,
                    rel.id,
                ),
            })
            .collect::<Vec<_>>();

        if let Some(rendered) = render_global_template(
            "formats/relations",
            &RelationsTemplateContext {
                current_name: current_name.clone(),
                items: items.clone(),
            },
        ) {
            return rendered;
        }

        let mut result = format!("「{}」的关系网络：\n\n", current_name);
        for item in items {
            result.push_str(&item);
            result.push_str("\n\n");
        }
        result
    }

    /// 格式化项目统计信息（用于 get_project_summary 返回）
    pub fn format_project_summary(
        project: &Project,
        entry_counts: &std::collections::HashMap<String, i64>,
    ) -> String {
        let count_lines = entry_counts
            .iter()
            .map(|(entry_type, count)| format!("- {} : {} 个", entry_type, count))
            .collect::<Vec<_>>();

        if let Some(rendered) = render_global_template(
            "formats/project_summary",
            &ProjectSummaryTemplateContext {
                name: project.name.clone(),
                description: project.description.clone(),
                count_lines: count_lines.clone(),
                created_at: project.created_at.to_string(),
                updated_at: project.updated_at.to_string(),
            },
        ) {
            return rendered;
        }

        let mut result = String::new();
        result.push_str(&format!("# 项目：{}\n\n", project.name));

        if let Some(desc) = &project.description {
            result.push_str(&format!("**描述**：{}\n\n", desc));
        }

        result.push_str("## 词条统计\n\n");
        if count_lines.is_empty() {
            result.push_str("暂无词条\n");
        } else {
            for line in count_lines {
                result.push_str(&line);
                result.push('\n');
            }
        }

        result.push_str(&format!("\n**创建时间**：{}\n", project.created_at));
        result.push_str(&format!("**更新时间**：{}\n", project.updated_at));

        result
    }

    /// 格式化项目列表（用于 list_projects 返回）
    pub fn format_projects(projects: &[Project]) -> String {
        if projects.is_empty() {
            return "暂无任何项目".to_string();
        }

        let items = projects
            .iter()
            .enumerate()
            .map(|(i, project)| {
                let mut item = format!("{}. **{}** (ID: {})\n", i + 1, project.name, project.id);
                if let Some(desc) = &project.description {
                    item.push_str(&format!("   描述：{}\n", desc));
                }
                item
            })
            .collect::<Vec<_>>();

        if let Some(rendered) = render_global_template(
            "formats/projects",
            &ListItemsTemplateContext {
                items: items.clone(),
            },
        ) {
            return rendered;
        }

        let mut result = String::from("项目列表：\n\n");
        for item in items {
            result.push_str(&item);
            result.push('\n');
        }
        result
    }

    /// 格式化分类列表（用于 list_categories 返回）
    pub fn format_categories(categories: &[Category]) -> String {
        if categories.is_empty() {
            return "该项目暂无分类".to_string();
        }

        let mut children_map: std::collections::HashMap<Option<Uuid>, Vec<&Category>> =
            std::collections::HashMap::new();
        for cat in categories {
            children_map.entry(cat.parent_id).or_default().push(cat);
        }

        fn render(
            parent: Option<Uuid>,
            depth: usize,
            map: &std::collections::HashMap<Option<Uuid>, Vec<&Category>>,
            out: &mut Vec<String>,
        ) {
            let Some(children) = map.get(&parent) else {
                return;
            };
            for cat in children {
                let indent = "  ".repeat(depth);
                out.push(format!("{}- **{}** (ID: {})", indent, cat.name, cat.id));
                render(Some(cat.id), depth + 1, map, out);
            }
        }

        let mut lines = Vec::new();
        render(None, 0, &children_map, &mut lines);

        if let Some(rendered) = render_global_template(
            "formats/categories",
            &LinesTemplateContext {
                lines: lines.clone(),
            },
        ) {
            return rendered;
        }

        let mut result = String::from("分类列表：\n\n");
        for line in lines {
            result.push_str(&line);
            result.push('\n');
        }
        result
    }

    /// 格式化词条类型列表（用于 list_entry_types 返回）
    pub fn format_entry_types(types: &[EntryTypeView]) -> String {
        if types.is_empty() {
            return "该项目未定义任何词条类型".to_string();
        }

        let lines = types
            .iter()
            .map(|et| match et {
                EntryTypeView::Builtin {
                    key,
                    name,
                    description,
                    ..
                } => {
                    let mut line = format!("- **{}** (key: `{}`, 内置)", name, key);
                    if !description.is_empty() {
                        line.push_str(&format!("\n  {}", description));
                    }
                    line
                }
                EntryTypeView::Custom(c) => {
                    let mut line = format!("- **{}** (id: `{}`, 自定义)", c.name, c.id);
                    if let Some(d) = &c.description {
                        line.push_str(&format!("\n  {}", d));
                    }
                    line
                }
            })
            .collect::<Vec<_>>();

        if let Some(rendered) = render_global_template(
            "formats/entry_types",
            &LinesTemplateContext {
                lines: lines.clone(),
            },
        ) {
            return rendered;
        }

        let mut result = String::from("可用词条类型：\n\n");
        for line in lines {
            result.push_str(&line);
            result.push('\n');
        }
        result
    }

    /// 格式化分类子树（用于 query_categories 返回）
    pub fn format_categories_subtree(
        categories: &[Category],
        parent_id: Option<Uuid>,
        max_depth: Option<usize>,
    ) -> String {
        let mut children_map: std::collections::HashMap<Option<Uuid>, Vec<&Category>> =
            std::collections::HashMap::new();
        for cat in categories {
            children_map.entry(cat.parent_id).or_default().push(cat);
        }

        if !children_map.contains_key(&parent_id) {
            return match parent_id {
                None => "该项目暂无分类".to_string(),
                Some(pid) => {
                    let name = categories
                        .iter()
                        .find(|c| c.id == pid)
                        .map(|c| c.name.as_str())
                        .unwrap_or("未知分类");
                    format!("分类「{}」下暂无子分类", name)
                }
            };
        }

        let header = match parent_id {
            None => String::from("根目录下的分类：\n\n"),
            Some(pid) => {
                let name = categories
                    .iter()
                    .find(|c| c.id == pid)
                    .map(|c| c.name.as_str())
                    .unwrap_or("未知分类");
                format!("分类「{}」（ID: {}）的子分类：\n\n", name, pid)
            }
        };

        fn render(
            parent: Option<Uuid>,
            depth: usize,
            max_depth: Option<usize>,
            map: &std::collections::HashMap<Option<Uuid>, Vec<&Category>>,
            out: &mut Vec<String>,
        ) {
            if let Some(max) = max_depth {
                if depth >= max {
                    return;
                }
            }
            let Some(children) = map.get(&parent) else {
                return;
            };
            for cat in children {
                let indent = "  ".repeat(depth);
                out.push(format!("{}- **{}** (ID: {})", indent, cat.name, cat.id));
                render(Some(cat.id), depth + 1, max_depth, map, out);
            }
        }

        let mut lines = Vec::new();
        render(parent_id, 0, max_depth, &children_map, &mut lines);

        if let Some(rendered) = render_global_template(
            "formats/categories_subtree",
            &CategoriesSubtreeTemplateContext {
                header: header.clone(),
                lines: lines.clone(),
            },
        ) {
            return rendered;
        }

        let mut result = header;
        for line in lines {
            result.push_str(&line);
            result.push('\n');
        }
        result
    }

    // （已移除：format_category 和 format_project — 由统一工具返回消息替代）
}

/// 开发版词条信息选择器。
/// FULL 表示一次性返回完整上下文；其他值用于限制返回字段，降低工具输出体积。
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum EntryInfo {
    Full,
    Title,
    Type,
    Summary,
    Tag,
    Content,
    Relations,
}

impl EntryInfo {
    pub fn parse(name: &str) -> Result<Self, String> {
        match name.trim().to_ascii_uppercase().as_str() {
            "FULL" => Ok(Self::Full),
            "TITLE" => Ok(Self::Title),
            "TYPE" => Ok(Self::Type),
            "SUM" | "SUMMARY" => Ok(Self::Summary),
            "TAG" | "TAGS" => Ok(Self::Tag),
            "CONTENT" => Ok(Self::Content),
            "RELATION" | "RELATIONS" => Ok(Self::Relations),
            other => Err(format!(
                "未知 EntryInfo「{}」，可用值：FULL、TITLE、TYPE、SUM、TAG、CONTENT、RELATIONS",
                other
            )),
        }
    }

    fn normalize(input: Option<Vec<Self>>) -> Vec<Self> {
        match input {
            Some(items) if !items.is_empty() => items,
            _ => vec![Self::Full],
        }
    }

    fn wants(items: &[Self], target: Self) -> bool {
        items.contains(&Self::Full) || items.contains(&target)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EntryListScopeKind {
    Project,
    Category,
}

impl EntryListScopeKind {
    fn label(self) -> &'static str {
        match self {
            Self::Project => "项目",
            Self::Category => "分类",
        }
    }
}

#[derive(Clone, Debug)]
struct EntryListScope {
    kind: EntryListScopeKind,
    id: Uuid,
    name: String,
    project_id: Uuid,
    project_name: String,
    category_ids: Option<Vec<Uuid>>,
}

#[derive(Clone, Debug)]
struct EntryTitleCandidate {
    entry_id: Uuid,
    title: String,
    project_id: Uuid,
    project_name: String,
    entry_type: Option<String>,
}

#[derive(Clone, Debug)]
struct EntryListItemDev {
    id: Uuid,
    title: String,
    entry_type: Option<String>,
    summary: Option<String>,
    created_at: String,
    updated_at: String,
}

// ============ 内部工具函数（不暴露给前端） ============

/// 开发版：按项目或分类名称/ID 列出词条标题、ID 和类型。
/// 分类范围默认包含其全部子分类，避免 AI 需要手动遍历分类树。
pub async fn get_entries_dev(
    state: &AppState,
    key: &str,
    kind: Option<&str>,
    info: Option<Vec<EntryInfo>>,
    sort: Option<&str>,
    limit: Option<usize>,
) -> Result<String, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("key 不能为空".to_string());
    }

    let scope = if let Ok(id) = Uuid::parse_str(key) {
        if let Ok(project_db) = open_project_db(state, &id).await {
            let project = project_db
                .get_project(&id)
                .await
                .map_err(|e| e.to_string())?;
            EntryListScope {
                kind: EntryListScopeKind::Project,
                id: project.id,
                name: project.name.clone(),
                project_id: project.id,
                project_name: project.name,
                category_ids: None,
            }
        } else if let Ok(category_db) = open_category_db(state, &id, None).await {
            let category = category_db
                .get_category(&id)
                .await
                .map_err(|e| e.to_string())?;
            let project = category_db
                .get_project(&category.project_id)
                .await
                .map_err(|e| e.to_string())?;
            let categories = category_db
                .list_categories(&category.project_id)
                .await
                .map_err(|e| e.to_string())?;
            EntryListScope {
                kind: EntryListScopeKind::Category,
                id: category.id,
                name: category.name,
                project_id: category.project_id,
                project_name: project.name,
                category_ids: Some(collect_subtree_ids(category.id, &categories)),
            }
        } else {
            return Err(format!("未找到项目或分类：{}", key));
        }
    } else {
        let catalog_db = state.sqlite_db.lock().await.clone();
        let projects = catalog_db
            .list_projects()
            .await
            .map_err(|e| e.to_string())?;
        let mut exact_candidates = Vec::new();
        let mut relaxed_candidates = Vec::new();

        for catalog_project in &projects {
            let db = open_project_db(state, &catalog_project.id).await?;
            let project = db
                .get_project(&catalog_project.id)
                .await
                .unwrap_or_else(|_| catalog_project.clone());
            let project_scope = EntryListScope {
                kind: EntryListScopeKind::Project,
                id: project.id,
                name: project.name.clone(),
                project_id: project.id,
                project_name: project.name.clone(),
                category_ids: None,
            };
            if project.name == key {
                exact_candidates.push(project_scope.clone());
            } else if project.name.eq_ignore_ascii_case(key) {
                relaxed_candidates.push(project_scope);
            }

            let categories = db
                .list_categories(&project.id)
                .await
                .map_err(|e| e.to_string())?;
            for category in &categories {
                let category_scope = EntryListScope {
                    kind: EntryListScopeKind::Category,
                    id: category.id,
                    name: category.name.clone(),
                    project_id: project.id,
                    project_name: project.name.clone(),
                    category_ids: Some(collect_subtree_ids(category.id, &categories)),
                };
                if category.name == key {
                    exact_candidates.push(category_scope.clone());
                } else if category.name.eq_ignore_ascii_case(key) {
                    relaxed_candidates.push(category_scope);
                }
            }
        }

        let candidates = if exact_candidates.is_empty() {
            relaxed_candidates
        } else {
            exact_candidates
        };

        match candidates.len() {
            0 => return Err(format!("未找到项目或分类：{}", key)),
            1 => candidates.into_iter().next().unwrap(),
            _ => {
                return Err(format!(
                    "key「{}」命中多个项目/分类，请改用 ID：\n{}",
                    key,
                    format_entry_scope_candidates_dev(&candidates)
                ));
            }
        }
    };

    let db = open_project_db(state, &scope.project_id).await?;
    let entry_types = db
        .list_all_entry_types(&scope.project_id)
        .await
        .map_err(|e| e.to_string())?;
    let entry_type_filter = match kind.map(str::trim).filter(|s| !s.is_empty()) {
        Some(value) => Some(resolve_entry_type_filter_dev(value, &entry_types)?),
        None => None,
    };

    let mut entries = Vec::new();
    if let Some(category_ids) = &scope.category_ids {
        for category_id in category_ids {
            let mut offset = 0usize;
            loop {
                let batch = db
                    .list_entries(
                        &scope.project_id,
                        EntryFilter {
                            category_id: Some(category_id),
                            entry_type: entry_type_filter.as_deref(),
                        },
                        200,
                        offset,
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                let batch_len = batch.len();
                entries.extend(batch);
                if batch_len < 200 {
                    break;
                }
                offset += 200;
            }
        }
    } else {
        let mut offset = 0usize;
        loop {
            let batch = db
                .list_entries(
                    &scope.project_id,
                    EntryFilter {
                        category_id: None,
                        entry_type: entry_type_filter.as_deref(),
                    },
                    200,
                    offset,
                )
                .await
                .map_err(|e| e.to_string())?;
            let batch_len = batch.len();
            entries.extend(batch);
            if batch_len < 200 {
                break;
            }
            offset += 200;
        }
    }

    let include_summary = info
        .as_ref()
        .map(|items| EntryInfo::wants(items, EntryInfo::Summary))
        .unwrap_or(false);

    let mut list_items = Vec::with_capacity(entries.len());
    for brief in entries {
        let entry = db.get_entry(&brief.id).await.map_err(|e| e.to_string())?;
        list_items.push(EntryListItemDev {
            id: entry.id,
            title: entry.title,
            entry_type: entry.r#type,
            summary: entry.summary,
            created_at: entry.created_at.to_string(),
            updated_at: entry.updated_at.to_string(),
        });
    }

    sort_entry_list_items_dev(&mut list_items, sort)?;
    if let Some(limit) = limit {
        list_items.truncate(limit);
    }

    let mut result = String::new();
    result.push_str("# 词条列表（dev）\n\n");
    result.push_str(&format!(
        "范围：{}「{}」\n范围ID：{}\n所属项目：{} ({})\n",
        scope.kind.label(),
        scope.name,
        scope.id,
        scope.project_name,
        scope.project_id
    ));
    if let Some(kind) = kind.map(str::trim).filter(|s| !s.is_empty()) {
        result.push_str(&format!("类型筛选：{}\n", kind));
    }
    if let Some(sort) = sort.map(str::trim).filter(|s| !s.is_empty()) {
        result.push_str(&format!("排序：{}\n", sort));
    }
    if let Some(limit) = limit {
        result.push_str(&format!("数量上限：{}\n", limit));
    }
    result.push_str(&format!("词条数量：{}\n\n", list_items.len()));

    if list_items.is_empty() {
        result.push_str("未找到符合条件的词条");
        return Ok(result);
    }

    for (index, entry) in list_items.iter().enumerate() {
        result.push_str(&format!(
            "{}. {} | ID: {} | 类型: {} | 创建: {} | 更新: {}\n",
            index + 1,
            entry.title,
            entry.id,
            format_entry_type_value_dev(entry.entry_type.as_deref(), &entry_types),
            entry.created_at,
            entry.updated_at
        ));
        if include_summary {
            result.push_str(&format!(
                "   摘要：{}\n",
                entry.summary.as_deref().unwrap_or("无摘要")
            ));
        }
    }

    Ok(result)
}

/// 开发版：按词条名称/ID 获取高密度词条上下文。
/// 默认 FULL 会一次性补齐类型、分类路径、标签定义、关系对端和图片状态。
pub async fn list_entry_dev(
    state: &AppState,
    keys: &[String],
    info: Option<Vec<EntryInfo>>,
) -> Result<String, String> {
    if keys.is_empty() {
        return Err("必须提供 key 或 keys".to_string());
    }

    let requested = EntryInfo::normalize(info);
    let mut outputs = Vec::with_capacity(keys.len());

    for key in keys {
        let key = key.trim();
        if key.is_empty() {
            return Err("key 不能为空".to_string());
        }

        let entry = if let Ok(id) = Uuid::parse_str(key) {
            let db = open_entry_db(state, &id, None).await?;
            db.get_entry(&id).await.map_err(|e| e.to_string())?
        } else {
            let catalog_db = state.sqlite_db.lock().await.clone();
            let projects = catalog_db
                .list_projects()
                .await
                .map_err(|e| e.to_string())?;
            let mut exact_candidates = Vec::new();
            let mut relaxed_candidates = Vec::new();

            for project in &projects {
                let db = open_project_db(state, &project.id).await?;
                let mut offset = 0usize;
                loop {
                    let batch = db
                        .list_entries(
                            &project.id,
                            EntryFilter {
                                category_id: None,
                                entry_type: None,
                            },
                            200,
                            offset,
                        )
                        .await
                        .map_err(|e| e.to_string())?;
                    let batch_len = batch.len();
                    for brief in batch {
                        let candidate = EntryTitleCandidate {
                            entry_id: brief.id,
                            title: brief.title.clone(),
                            project_id: project.id,
                            project_name: project.name.clone(),
                            entry_type: brief.r#type.clone(),
                        };
                        if brief.title == key {
                            exact_candidates.push(candidate);
                        } else if brief.title.eq_ignore_ascii_case(key) {
                            relaxed_candidates.push(candidate);
                        }
                    }
                    if batch_len < 200 {
                        break;
                    }
                    offset += 200;
                }
            }

            let candidates = if exact_candidates.is_empty() {
                relaxed_candidates
            } else {
                exact_candidates
            };

            match candidates.len() {
                0 => return Err(format!("未找到词条：{}", key)),
                1 => {
                    let candidate = &candidates[0];
                    let db = open_project_db(state, &candidate.project_id).await?;
                    db.get_entry(&candidate.entry_id)
                        .await
                        .map_err(|e| e.to_string())?
                }
                _ => {
                    return Err(format!(
                        "词条名「{}」命中多个候选，请改用 ID：\n{}",
                        key,
                        format_entry_title_candidates_dev(&candidates)
                    ));
                }
            }
        };

        let db = open_project_db(state, &entry.project_id).await?;
        let project = db
            .get_project(&entry.project_id)
            .await
            .map_err(|e| e.to_string())?;
        let categories = db
            .list_categories(&entry.project_id)
            .await
            .map_err(|e| e.to_string())?;
        let entry_types = db
            .list_all_entry_types(&entry.project_id)
            .await
            .map_err(|e| e.to_string())?;

        let category_text = entry
            .category_id
            .map(|category_id| build_category_path_dev(&categories, category_id))
            .unwrap_or_else(|| "未分类".to_string());

        let mut result = String::new();
        result.push_str("# 词条上下文（dev）\n\n");
        result.push_str("## 标识\n\n");
        result.push_str(&format!("- 标题：{}\n", entry.title));
        result.push_str(&format!("- 词条ID：{}\n", entry.id));
        result.push_str(&format!("- 项目：{} ({})\n", project.name, project.id));
        result.push_str(&format!("- 分类路径：{}\n", category_text));
        result.push_str(&format!("- 创建时间：{}\n", entry.created_at));
        result.push_str(&format!("- 更新时间：{}\n", entry.updated_at));

        if EntryInfo::wants(&requested, EntryInfo::Type) {
            result.push_str("\n## 类型\n\n");
            result.push_str(&format!(
                "{}\n",
                format_entry_type_value_dev(entry.r#type.as_deref(), &entry_types)
            ));
        }

        if EntryInfo::wants(&requested, EntryInfo::Summary) {
            result.push_str("\n## 摘要\n\n");
            result.push_str(entry.summary.as_deref().unwrap_or("无摘要"));
            result.push('\n');
        }

        if EntryInfo::wants(&requested, EntryInfo::Tag) {
            let schemas = db
                .list_tag_schemas(&entry.project_id)
                .await
                .map_err(|e| e.to_string())?;
            let schema_map = schemas
                .iter()
                .map(|schema| (schema.id, schema))
                .collect::<std::collections::HashMap<_, _>>();

            result.push_str("\n## 标签\n\n");
            if entry.tags.0.is_empty() {
                result.push_str("无标签\n");
            } else {
                for tag in &entry.tags.0 {
                    if let Some(schema) = schema_map.get(&tag.schema_id) {
                        result.push_str(&format!(
                            "- {} (schema_id: {}, 类型: {}, 目标: {}): {}\n",
                            schema.name,
                            schema.id,
                            schema.r#type,
                            schema.target,
                            format_json_value_dev(&tag.value)
                        ));
                        if let Some(description) = &schema.description {
                            result.push_str(&format!("  描述：{}\n", description));
                        }
                        if let Some(default_value) = &schema.default_val {
                            result.push_str(&format!("  默认值：{}\n", default_value));
                        }
                    } else {
                        result.push_str(&format!(
                            "- 未知标签定义 (schema_id: {}): {}\n",
                            tag.schema_id,
                            format_json_value_dev(&tag.value)
                        ));
                    }
                }
            }
        }

        if EntryInfo::wants(&requested, EntryInfo::Content) {
            result.push_str("\n## 正文\n\n");
            if entry.content.is_empty() {
                result.push_str("正文为空\n");
            } else {
                result.push_str(&entry.content);
                result.push('\n');
            }
        }

        if EntryInfo::wants(&requested, EntryInfo::Relations) {
            let relations = db
                .list_relations_for_entry(&entry.id)
                .await
                .map_err(|e| e.to_string())?;

            result.push_str("\n## 关系\n\n");
            if relations.is_empty() {
                result.push_str("无关系\n");
            } else {
                for relation in &relations {
                    let peer_id = if relation.a_id == entry.id {
                        relation.b_id
                    } else {
                        relation.a_id
                    };
                    let direction = match relation.relation {
                        RelationDirection::TwoWay => "双向".to_string(),
                        RelationDirection::OneWay if relation.a_id == entry.id => {
                            "当前词条 -> 对方".to_string()
                        }
                        RelationDirection::OneWay => "对方 -> 当前词条".to_string(),
                    };

                    if let Ok(peer) = db.get_entry(&peer_id).await {
                        result.push_str(&format!(
                            "- {} | 关系ID: {} | 对方：{} ({}) | 对方类型：{}\n",
                            direction,
                            relation.id,
                            peer.title,
                            peer.id,
                            format_entry_type_value_dev(peer.r#type.as_deref(), &entry_types)
                        ));
                        if let Some(summary) = &peer.summary {
                            result.push_str(&format!("  对方摘要：{}\n", summary));
                        }
                        result.push_str(&format!("  关系描述：{}\n", relation.content));
                    } else {
                        result.push_str(&format!(
                            "- {} | 关系ID: {} | 对方ID：{}\n  关系描述：{}\n",
                            direction, relation.id, peer_id, relation.content
                        ));
                    }
                }
            }
        }

        if requested.contains(&EntryInfo::Full) {
            result.push_str("\n## 图片\n\n");
            result.push_str(&format!("- 图库图片数：{}\n", entry.images.0.len()));
            result.push_str(&format!(
                "- 卡片封面路径：{}\n",
                entry.cover_path.as_deref().unwrap_or("无")
            ));
            let original_cover = entry
                .images
                .0
                .iter()
                .find(|image| image.is_cover)
                .map(|image| image.path.display().to_string())
                .unwrap_or_else(|| "无".to_string());
            result.push_str(&format!("- 图库主图原图：{}\n", original_cover));
        }

        outputs.push(result);
    }

    if outputs.len() == 1 {
        Ok(outputs.remove(0))
    } else {
        let mut result = String::from("# 批量词条上下文（dev）\n\n");
        result.push_str(&outputs.join("\n\n---\n\n"));
        Ok(result)
    }
}

fn format_entry_scope_candidates_dev(candidates: &[EntryListScope]) -> String {
    candidates
        .iter()
        .map(|candidate| {
            format!(
                "- {}「{}」 ID: {}，所属项目：{} ({})",
                candidate.kind.label(),
                candidate.name,
                candidate.id,
                candidate.project_name,
                candidate.project_id
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn sort_entry_list_items_dev(
    entries: &mut [EntryListItemDev],
    sort: Option<&str>,
) -> Result<(), String> {
    let sort = sort
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("title");
    let (descending, field) = sort
        .strip_prefix('-')
        .map(|field| (true, field))
        .unwrap_or((false, sort));

    match field {
        "title" => entries.sort_by(|a, b| a.title.cmp(&b.title).then_with(|| a.id.cmp(&b.id))),
        "created_at" => entries.sort_by(|a, b| {
            a.created_at
                .cmp(&b.created_at)
                .then_with(|| a.title.cmp(&b.title))
                .then_with(|| a.id.cmp(&b.id))
        }),
        "updated_at" => entries.sort_by(|a, b| {
            a.updated_at
                .cmp(&b.updated_at)
                .then_with(|| a.title.cmp(&b.title))
                .then_with(|| a.id.cmp(&b.id))
        }),
        other => {
            return Err(format!(
                "未知 sort「{}」，可用值：title、created_at、updated_at，也可加 - 前缀倒序",
                other
            ));
        }
    }

    if descending {
        entries.reverse();
    }

    Ok(())
}

fn format_entry_title_candidates_dev(candidates: &[EntryTitleCandidate]) -> String {
    candidates
        .iter()
        .map(|candidate| {
            let type_text = candidate.entry_type.as_deref().unwrap_or("未设置");
            format!(
                "- {} | ID: {} | 项目：{} ({}) | 类型：{}",
                candidate.title,
                candidate.entry_id,
                candidate.project_name,
                candidate.project_id,
                type_text
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn resolve_entry_type_filter_dev(kind: &str, types: &[EntryTypeView]) -> Result<String, String> {
    let kind = kind.trim();
    if kind.is_empty() {
        return Err("kind 不能为空".to_string());
    }

    let mut matches = Vec::new();
    for entry_type in types {
        match entry_type {
            EntryTypeView::Builtin { key, name, .. } => {
                let key_value = key.to_string();
                let name_value = name.to_string();
                if key_value == kind
                    || name_value == kind
                    || key_value.eq_ignore_ascii_case(kind)
                    || name_value.eq_ignore_ascii_case(kind)
                {
                    matches.push((
                        key_value.clone(),
                        format!("{} (内置 key: {})", name_value, key_value),
                    ));
                }
            }
            EntryTypeView::Custom(custom) => {
                let id_value = custom.id.to_string();
                if id_value == kind
                    || custom.name == kind
                    || id_value.eq_ignore_ascii_case(kind)
                    || custom.name.eq_ignore_ascii_case(kind)
                {
                    matches.push((
                        id_value.clone(),
                        format!("{} (自定义 id: {})", custom.name, id_value),
                    ));
                }
            }
        }
    }

    match matches.len() {
        0 => Err(format!(
            "未找到词条类型「{}」。可用类型：\n{}",
            kind,
            format_available_entry_types_dev(types)
        )),
        1 => Ok(matches.remove(0).0),
        _ => Err(format!(
            "词条类型「{}」命中多个候选，请改用 key 或 ID：\n{}",
            kind,
            matches
                .iter()
                .map(|(_, label)| format!("- {}", label))
                .collect::<Vec<_>>()
                .join("\n")
        )),
    }
}

fn format_available_entry_types_dev(types: &[EntryTypeView]) -> String {
    if types.is_empty() {
        return "无可用词条类型".to_string();
    }

    types
        .iter()
        .map(|entry_type| match entry_type {
            EntryTypeView::Builtin { key, name, .. } => {
                format!("- {} (内置 key: {})", name, key)
            }
            EntryTypeView::Custom(custom) => {
                format!("- {} (自定义 id: {})", custom.name, custom.id)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_entry_type_value_dev(entry_type: Option<&str>, types: &[EntryTypeView]) -> String {
    let Some(raw) = entry_type.map(str::trim).filter(|value| !value.is_empty()) else {
        return "未设置".to_string();
    };

    for entry_type in types {
        match entry_type {
            EntryTypeView::Builtin { key, name, .. } if key.to_string() == raw => {
                return format!("{} (内置 key: {})", name, key);
            }
            EntryTypeView::Custom(custom) if custom.id.to_string() == raw => {
                return format!("{} (自定义 id: {})", custom.name, custom.id);
            }
            _ => {}
        }
    }

    raw.to_string()
}

fn build_category_path_dev(categories: &[Category], category_id: Uuid) -> String {
    let mut parts = Vec::new();
    let mut current = Some(category_id);
    let mut seen = std::collections::HashSet::new();

    while let Some(id) = current {
        if !seen.insert(id) {
            parts.push(format!("循环引用分类({})", id));
            break;
        }

        let Some(category) = categories.iter().find(|category| category.id == id) else {
            parts.push(format!("未知分类({})", id));
            break;
        };

        parts.push(category.name.clone());
        current = category.parent_id;
    }

    parts.reverse();
    parts.join(" / ")
}

fn format_json_value_dev(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// 创建词条，并按正文建立出链；返回值同 [`update_entry_content`]。
pub async fn create_entry(
    state: &AppState,
    project_id: &str,
    category_id: &str,
    title: String,
    entry_type: Option<String>,
    summary: Option<String>,
    content: Option<String>,
) -> Result<(Entry, BTreeSet<Uuid>), String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let category_id = Uuid::parse_str(category_id).map_err(|e| e.to_string())?;
    let db = open_project_db(state, &project_id).await?;
    let entry = db
        .create_entry(CreateEntry {
            project_id,
            category_id: Some(category_id),
            title,
            summary,
            content,
            r#type: entry_type,
            tags: None,
            images: None,
            cover_path: None,
        })
        .await
        .map_err(|e| e.to_string())?;
    let affected_entry_ids = if entry.content.is_empty() {
        BTreeSet::from([entry.id])
    } else {
        sync_outgoing_links_or_log(&db, &entry).await
    };
    Ok((entry, affected_entry_ids))
}

/// 按正文重建出链；失败只记日志并退回只刷新本词条。
///
/// 调用时正文已经落库，此时返回错误会让模型以为“修改未完成”而重复写入。
async fn sync_outgoing_links_or_log(db: &SqliteDb, entry: &Entry) -> BTreeSet<Uuid> {
    sync_outgoing_links_from_content(db, entry)
        .await
        .unwrap_or_else(|error| {
            log::warn!(
                "[tools] 按正文重建出链失败 entry_id={}, error={}",
                entry.id,
                error
            );
            BTreeSet::from([entry.id])
        })
}

/// 列出项目分类
pub async fn list_categories(state: &AppState, project_id: &str) -> Result<Vec<Category>, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let db = open_project_db(state, &project_id).await?;
    db.list_categories(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 搜索词条（FTS）
pub async fn search_entries(
    state: &AppState,
    project_id: &str,
    query: &str,
    entry_type: Option<&str>,
    category_id: Option<&str>,
    limit: usize,
) -> Result<Vec<EntryBrief>, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|id| Uuid::parse_str(id).map_err(|e| e.to_string()))
        .transpose()?;
    let db = open_project_db(state, &project_id).await?;
    db.search_entries(
        &project_id,
        query,
        EntryFilter {
            category_id: category_id.as_ref(),
            entry_type,
        },
        limit,
    )
    .await
    .map_err(|e| e.to_string())
}

/// 获取词条完整内容
pub async fn get_entry(state: &AppState, entry_id: &str) -> Result<Entry, String> {
    let entry_id = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let db = open_entry_db(state, &entry_id, None).await?;
    db.get_entry(&entry_id).await.map_err(|e| e.to_string())
}

/// 列出项目内所有词条简报（不限类型）
pub async fn list_all_entries(
    state: &AppState,
    project_id: &str,
    category_id: Option<&str>,
    limit: usize,
    offset: usize,
) -> Result<Vec<EntryBrief>, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|id| Uuid::parse_str(id).map_err(|e| e.to_string()))
        .transpose()?;
    let db = open_project_db(state, &project_id).await?;
    db.list_entries(
        &project_id,
        EntryFilter {
            category_id: category_id.as_ref(),
            entry_type: None,
        },
        limit,
        offset,
    )
    .await
    .map_err(|e| e.to_string())
}

/// 列出指定类型的词条简报
pub async fn list_entries_by_type(
    state: &AppState,
    project_id: &str,
    entry_type: &str,
    category_id: Option<&str>,
    limit: usize,
    offset: usize,
) -> Result<Vec<EntryBrief>, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|id| Uuid::parse_str(id).map_err(|e| e.to_string()))
        .transpose()?;
    let db = open_project_db(state, &project_id).await?;
    db.list_entries(
        &project_id,
        EntryFilter {
            category_id: category_id.as_ref(),
            entry_type: Some(entry_type),
        },
        limit,
        offset,
    )
    .await
    .map_err(|e| e.to_string())
}

/// 获取项目标签定义
pub async fn list_tag_schemas(
    state: &AppState,
    project_id: &str,
) -> Result<Vec<TagSchema>, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let db = open_project_db(state, &project_id).await?;
    db.list_tag_schemas(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 获取词条关系网络
pub async fn get_entry_relations(
    state: &AppState,
    entry_id: &str,
) -> Result<
    (
        Vec<EntryRelation>,
        std::collections::HashMap<String, String>,
    ),
    String,
> {
    let entry_id = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let db = open_entry_db(state, &entry_id, None).await?;
    let relations = db
        .list_relations_for_entry(&entry_id)
        .await
        .map_err(|e| e.to_string())?;

    // 收集关系中出现的所有词条 ID，查出名称
    let mut names: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut seen: std::collections::HashSet<Uuid> = std::collections::HashSet::new();
    for rel in &relations {
        seen.insert(rel.a_id);
        seen.insert(rel.b_id);
    }
    for id in seen {
        if let Ok(entry) = db.get_entry(&id).await {
            names.insert(id.to_string(), entry.title);
        }
    }

    Ok((relations, names))
}

/// 获取单条关系
pub async fn get_relation(state: &AppState, relation_id: &str) -> Result<EntryRelation, String> {
    let id = Uuid::parse_str(relation_id).map_err(|e| e.to_string())?;
    let db = open_relation_db(state, &id, None).await?;
    db.get_relation(&id).await.map_err(|e| e.to_string())
}

/// 创建词条关系
pub async fn create_relation(
    state: &AppState,
    a_id: &str,
    b_id: &str,
    relation: RelationDirection,
    content: String,
) -> Result<EntryRelation, String> {
    let a_id = Uuid::parse_str(a_id).map_err(|e| e.to_string())?;
    let b_id = Uuid::parse_str(b_id).map_err(|e| e.to_string())?;
    let db = open_entry_db(state, &a_id, None).await?;
    // project_id 从 a_id 所属词条推导，无需调用方传入
    let entry_a = db.get_entry(&a_id).await.map_err(|e| e.to_string())?;
    db.create_relation(CreateEntryRelation {
        project_id: entry_a.project_id,
        a_id,
        b_id,
        relation,
        content,
    })
    .await
    .map_err(|e| e.to_string())
}

/// 更新词条关系
pub async fn update_relation(
    state: &AppState,
    relation_id: &str,
    relation: Option<RelationDirection>,
    content: Option<String>,
) -> Result<EntryRelation, String> {
    let id = Uuid::parse_str(relation_id).map_err(|e| e.to_string())?;
    let db = open_relation_db(state, &id, None).await?;
    db.update_relation(&id, UpdateEntryRelation { relation, content })
        .await
        .map_err(|e| e.to_string())
}

/// 删除词条关系
pub async fn delete_relation(state: &AppState, relation_id: &str) -> Result<(), String> {
    let id = Uuid::parse_str(relation_id).map_err(|e| e.to_string())?;
    let db = open_relation_db(state, &id, None).await?;
    db.delete_relation(&id).await.map_err(|e| e.to_string())
}

/// 获取项目统计信息
pub async fn get_project_summary(
    state: &AppState,
    project_id: &str,
) -> Result<(Project, std::collections::HashMap<String, i64>), String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let db = open_project_db(state, &project_id).await?;

    // 获取项目信息
    let project = db
        .get_project(&project_id)
        .await
        .map_err(|e| e.to_string())?;

    // 查出项目实际存在的所有词条类型，再分别统计数量
    let all_types = db
        .list_all_entry_types(&project_id)
        .await
        .map_err(|e| e.to_string())?;

    let mut counts = std::collections::HashMap::new();
    for et in &all_types {
        // builtin 以 key 作为 Entry.type 的值；custom 以 id（UUID string）作为值
        let (type_key, display_name): (String, String) = match et {
            EntryTypeView::Builtin { key, name, .. } => (key.to_string(), name.to_string()),
            EntryTypeView::Custom(c) => (c.id.to_string(), c.name.clone()),
        };
        let count = db
            .count_entries(
                &project_id,
                EntryFilter {
                    category_id: None,
                    entry_type: Some(type_key.as_str()),
                },
            )
            .await
            .map_err(|e| e.to_string())?;

        if count > 0 {
            counts.insert(display_name, count);
        }
    }

    Ok((project, counts))
}

/// 列出所有项目
pub async fn list_projects(state: &AppState) -> Result<Vec<Project>, String> {
    let catalog_db = state.sqlite_db.lock().await.clone();
    let projects = catalog_db
        .list_projects()
        .await
        .map_err(|e| e.to_string())?;
    let mut result = Vec::with_capacity(projects.len());
    for project in projects {
        match open_project_db(state, &project.id).await {
            Ok(db) => match db.get_project(&project.id).await {
                Ok(world_project) => result.push(world_project),
                Err(_) => result.push(project),
            },
            Err(_) => result.push(project),
        }
    }
    Ok(result)
}

/// 更新词条基本字段（标题、摘要、类型，均可选）
/// - title:      None = 不更新；Some(s) = 更新
/// - summary:    None = 不更新；Some(None) = 清空；Some(Some(s)) = 更新
/// - entry_type: None = 不更新；Some(None) = 清空；Some(Some(s)) = 更新
pub async fn update_entry_fields(
    state: &AppState,
    entry_id: &str,
    title: Option<String>,
    summary: Option<Option<String>>,
    entry_type: Option<Option<String>>,
) -> Result<Entry, String> {
    let entry_id = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let db = open_entry_db(state, &entry_id, None).await?;
    db.update_entry(
        &entry_id,
        UpdateEntry {
            category_id: None,
            title,
            summary,
            content: None,
            r#type: entry_type,
            tags: None,
            images: None,
            cover_path: None,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 更新词条正文，并按新正文重建出链。
///
/// 返回的 ID 集合包含本词条与新旧出链目标，调用方需逐个广播 `entry:updated`，目标词条的反链才会刷新。
pub async fn update_entry_content(
    state: &AppState,
    entry_id: &str,
    content: Option<String>,
) -> Result<(Entry, BTreeSet<Uuid>), String> {
    let entry_id = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let db = open_entry_db(state, &entry_id, None).await?;
    let entry = db
        .update_entry(
            &entry_id,
            UpdateEntry {
                category_id: None,
                title: None,
                summary: None,
                content,
                r#type: None,
                tags: None,
                images: None,
                cover_path: None,
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    let affected_entry_ids = sync_outgoing_links_or_log(&db, &entry).await;
    Ok((entry, affected_entry_ids))
}

/// 向词条添加单个标签（如 schema_id 已存在则覆盖其 value）
pub async fn add_entry_tag(
    state: &AppState,
    entry_id: &str,
    schema_id: &str,
    value: String,
) -> Result<Entry, String> {
    let entry_id_uuid = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let schema_id_uuid = Uuid::parse_str(schema_id).map_err(|e| e.to_string())?;
    let db = open_entry_db(state, &entry_id_uuid, None).await?;
    db.upsert_entry_tag(
        &entry_id_uuid,
        EntryTag {
            schema_id: schema_id_uuid,
            value: serde_json::Value::String(value),
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 从词条移除指定 schema_id 的标签
pub async fn remove_entry_tag(
    state: &AppState,
    entry_id: &str,
    schema_id: &str,
) -> Result<Entry, String> {
    let entry_id_uuid = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let schema_id_uuid = Uuid::parse_str(schema_id).map_err(|e| e.to_string())?;
    let db = open_entry_db(state, &entry_id_uuid, None).await?;
    db.remove_entry_tag(&entry_id_uuid, &schema_id_uuid)
        .await
        .map_err(|e| e.to_string())
}

/// 更新词条标签（全量替换）
pub async fn update_entry_tags(
    state: &AppState,
    entry_id: &str,
    tags: Vec<EntryTag>,
) -> Result<Entry, String> {
    let entry_id = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let db = open_entry_db(state, &entry_id, None).await?;
    db.update_entry(
        &entry_id,
        UpdateEntry {
            category_id: None,
            title: None,
            summary: None,
            content: None,
            r#type: None,
            tags: Some(tags),
            images: None,
            cover_path: None,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 删除词条
pub async fn delete_entry(state: &AppState, entry_id: &str) -> Result<(), String> {
    let entry_id = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let db = open_entry_db(state, &entry_id, None).await?;
    db.delete_entry(&entry_id).await.map_err(|e| e.to_string())
}

/// 创建分类
pub async fn create_category(
    state: &AppState,
    project_id: &str,
    name: String,
    parent_id: Option<&str>,
) -> Result<Category, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let parent_id = parent_id
        .map(|id| Uuid::parse_str(id).map_err(|e| e.to_string()))
        .transpose()?;
    let db = open_project_db(state, &project_id).await?;
    db.create_category(CreateCategory {
        project_id,
        parent_id,
        name,
        sort_order: None,
    })
    .await
    .map_err(|e| e.to_string())
}

/// 获取分类（含 project_id / parent_id 信息）
pub async fn get_category(state: &AppState, category_id: &str) -> Result<Category, String> {
    let category_id = Uuid::parse_str(category_id).map_err(|e| e.to_string())?;
    let db = open_category_db(state, &category_id, None).await?;
    db.get_category(&category_id)
        .await
        .map_err(|e| e.to_string())
}

/// 收集以 root_id 为根的分类子树（包含根节点本身），广度优先。
/// all_categories 为项目内全部分类列表（已从 DB 取出）。
pub fn collect_subtree_ids(root_id: Uuid, all_categories: &[Category]) -> Vec<Uuid> {
    let mut result = vec![root_id];
    let mut queue = vec![root_id];
    while let Some(current) = queue.pop() {
        for cat in all_categories {
            if cat.parent_id == Some(current) {
                result.push(cat.id);
                queue.push(cat.id);
            }
        }
    }
    result
}

/// 预览联级删除的影响范围，不执行任何写操作。
/// 返回 (entry_count, subcategory_count)
pub async fn preview_cascade_delete(
    state: &AppState,
    category_id: &str,
) -> Result<(usize, usize), String> {
    let root_id = Uuid::parse_str(category_id).map_err(|e| e.to_string())?;
    let db = open_category_db(state, &root_id, None).await?;
    let root_cat = db.get_category(&root_id).await.map_err(|e| e.to_string())?;
    let all_cats = db
        .list_categories(&root_cat.project_id)
        .await
        .map_err(|e| e.to_string())?;
    let cat_ids = collect_subtree_ids(root_id, &all_cats);
    let subcategory_count = cat_ids.len().saturating_sub(1);

    let mut entry_count = 0usize;
    for cid in &cat_ids {
        let mut offset = 0usize;
        loop {
            let batch = db
                .list_entries(
                    &root_cat.project_id,
                    EntryFilter {
                        category_id: Some(cid),
                        entry_type: None,
                    },
                    200,
                    offset,
                )
                .await
                .map_err(|e| e.to_string())?;
            entry_count += batch.len();
            if batch.len() < 200 {
                break;
            }
            offset += 200;
        }
    }
    Ok((entry_count, subcategory_count))
}

/// 执行联级删除：删除子树内所有词条，再从叶到根删除所有分类。
/// 返回 (deleted_entries, deleted_categories)
pub async fn cascade_delete_category(
    state: &AppState,
    category_id: &str,
) -> Result<(usize, usize), String> {
    let root_id = Uuid::parse_str(category_id).map_err(|e| e.to_string())?;
    let db = open_category_db(state, &root_id, None).await?;
    let result = db
        .cascade_delete_category(&root_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok((result.deleted_entries, result.deleted_categories))
}

/// 删除分类并将直接子分类和词条上移到父分类（或根节点）。
pub async fn delete_category_move_to_parent(
    state: &AppState,
    category_id: &str,
) -> Result<(), String> {
    let cat_id = Uuid::parse_str(category_id).map_err(|e| e.to_string())?;
    let db = open_category_db(state, &cat_id, None).await?;
    db.delete_category_move_to_parent(&cat_id)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 列出项目所有词条类型（内置 + 自定义）
pub async fn list_entry_types(
    state: &AppState,
    project_id: &str,
) -> Result<Vec<EntryTypeView>, String> {
    let project_id = Uuid::parse_str(project_id).map_err(|e| e.to_string())?;
    let db = open_project_db(state, &project_id).await?;
    db.list_all_entry_types(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// 移动词条到指定分类；category_id = None 表示移出所有分类（置为根节点词条）
pub async fn move_entry(
    state: &AppState,
    entry_id: &str,
    category_id: Option<&str>,
) -> Result<Entry, String> {
    let entry_id = Uuid::parse_str(entry_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|id| Uuid::parse_str(id).map_err(|e| e.to_string()))
        .transpose()?;
    let db = open_entry_db(state, &entry_id, None).await?;
    db.update_entry(
        &entry_id,
        UpdateEntry {
            category_id: Some(category_id),
            title: None,
            summary: None,
            content: None,
            r#type: None,
            tags: None,
            images: None,
            cover_path: None,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 创建项目（含默认模板初始化）
pub async fn create_project(
    state: &AppState,
    name: String,
    description: Option<String>,
) -> Result<Project, String> {
    let project = {
        let db = state.sqlite_db.lock().await;
        db.create_project_with_default_timeline_tags(CreateProject {
            name,
            description,
            cover_image: None,
        })
        .await
        .map_err(|e| e.to_string())?
    };
    open_project_db(state, &project.id).await?;
    Ok(project)
}
