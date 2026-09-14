use super::common::*;
use super::images::{copy_entry_images, use_derived_cover_thumbnails};
use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use tauri::Emitter;
use worldflow_core::link_refs::{FcEntryRef, parse_fc_entry_ref};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEntryRelationDraft {
    pub id: Option<String>,
    pub other_entry_id: Option<String>,
    pub direction: String,
    pub content: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEntryBundleInput {
    pub id: String,
    pub project_id: String,
    pub source_id: Option<String>,
    pub category_id: Option<String>,
    pub title: String,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub r#type: Option<String>,
    pub tags: Option<Vec<EntryTag>>,
    pub images: Option<Vec<FCImage>>,
    #[serde(default)]
    pub relation_drafts: Vec<SaveEntryRelationDraft>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEntryBundleResponse {
    pub entry: Entry,
    pub outgoing_links: Vec<EntryLink>,
    pub incoming_links: Vec<EntryLink>,
    pub relations: Vec<EntryRelation>,
}

const CHARACTER_VOICE_TAG_SCHEMAS: [(&str, &str, &str); 4] = [
    (
        "c64f7bf6-737d-4c4d-9ad9-97f12b7bac01",
        "fc_role_voice_plugin_id",
        "string",
    ),
    (
        "c64f7bf6-737d-4c4d-9ad9-97f12b7bac02",
        "fc_role_voice_model",
        "string",
    ),
    (
        "c64f7bf6-737d-4c4d-9ad9-97f12b7bac03",
        "fc_role_voice_id",
        "string",
    ),
    (
        "c64f7bf6-737d-4c4d-9ad9-97f12b7bac04",
        "fc_role_voice_auto_play",
        "boolean",
    ),
];

/// 角色语音沿用词条标签存储；保存前补齐隐藏 schema，避免悬空外键。
async fn ensure_character_voice_tag_schemas(
    db: &SqliteDb,
    project_id: &Uuid,
    tags: Option<&[EntryTag]>,
) -> Result<(), String> {
    let Some(tags) = tags else {
        return Ok(());
    };
    let requested_ids = tags.iter().map(|tag| tag.schema_id).collect::<HashSet<_>>();
    for (id, name, value_type) in CHARACTER_VOICE_TAG_SCHEMAS {
        let id = Uuid::parse_str(id).map_err(|error| error.to_string())?;
        if !requested_ids.contains(&id) {
            continue;
        }
        sqlx::query(
            "INSERT OR IGNORE INTO tag_schemas
             (id, project_id, name, description, type, target, default_val, range_min, range_max, sort_order)
             VALUES (?, ?, ?, NULL, ?, '[]', NULL, NULL, NULL, -1)",
        )
        .bind(id)
        .bind(project_id)
        .bind(name)
        .bind(value_type)
        .execute(&db.pool)
        .await
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn normalize_entry_compare_text(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_string()
}

fn normalize_stats_entry_type(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn parse_entry_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|date_time| date_time.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f")
                .or_else(|_| NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S"))
                .ok()
                .map(|date_time| DateTime::<Utc>::from_naive_utc_and_offset(date_time, Utc))
        })
}

fn sort_type_stats(stats: &mut [ProjectEntryTypeStat]) {
    stats.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.entry_type.cmp(&right.entry_type))
    });
}

fn sort_category_stats(stats: &mut [ProjectCategoryStat]) {
    stats.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.category_id.cmp(&right.category_id))
    });
}

fn ratio_score(numerator: usize, denominator: usize) -> usize {
    if denominator == 0 {
        return 0;
    }
    ((numerator as f64 / denominator as f64) * 100.0).round() as usize
}

fn clamp_score(value: usize) -> usize {
    value.min(100)
}

struct GovernanceScoreInput {
    category_count: usize,
    entry_type_count: usize,
    tag_schema_count: usize,
    entry_count: usize,
    word_count: usize,
    length_score_total: usize,
    relation_count: usize,
    internal_link_count: usize,
    capped_connection_count: usize,
    unset_type_count: usize,
    uncategorized_entry_count: usize,
    empty_content_entry_count: usize,
    missing_summary_entry_count: usize,
    isolated_entry_count: usize,
}

fn build_governance_score(input: GovernanceScoreInput) -> ProjectGovernanceScore {
    let average_words = if input.entry_count > 0 {
        input.word_count / input.entry_count
    } else {
        0
    };
    let classified_count = input
        .entry_count
        .saturating_sub(input.uncategorized_entry_count);
    let typed_count = input.entry_count.saturating_sub(input.unset_type_count);
    let non_empty_count = input
        .entry_count
        .saturating_sub(input.empty_content_entry_count);
    let summary_count = input
        .entry_count
        .saturating_sub(input.missing_summary_entry_count);
    let connected_count = input.entry_count.saturating_sub(input.isolated_entry_count);
    let length_score = ratio_score(input.length_score_total, input.entry_count * 100);
    let content_score = clamp_score(
        (ratio_score(non_empty_count, input.entry_count) * 35
            + ratio_score(summary_count, input.entry_count) * 35
            + length_score * 30)
            / 100,
    );
    let structure_score = [
        input.category_count > 0,
        input.entry_type_count > 0,
        input.tag_schema_count > 0,
        input.entry_count > 0,
        input.relation_count > 0 || input.internal_link_count > 0,
    ]
    .iter()
    .filter(|passed| **passed)
    .count()
        * 20;
    let ownership_score = clamp_score(
        (ratio_score(classified_count, input.entry_count) * 55
            + ratio_score(typed_count, input.entry_count) * 45)
            / 100,
    );
    let relation_density_score = if input.entry_count > 0 {
        (input.capped_connection_count * 100 / (input.entry_count * 3)).min(100)
    } else {
        0
    };
    let connectivity_score = clamp_score(
        (ratio_score(connected_count, input.entry_count) * 70 + relation_density_score * 30) / 100,
    );
    let dimensions = vec![
        ProjectGovernanceDimension {
            key: "content".to_string(),
            label: "内容完整".to_string(),
            score: content_score,
            weight: 35,
        },
        ProjectGovernanceDimension {
            key: "ownership".to_string(),
            label: "组织归属".to_string(),
            score: ownership_score,
            weight: 30,
        },
        ProjectGovernanceDimension {
            key: "connectivity".to_string(),
            label: "关系连通".to_string(),
            score: connectivity_score,
            weight: 25,
        },
        ProjectGovernanceDimension {
            key: "structure".to_string(),
            label: "结构配置".to_string(),
            score: structure_score,
            weight: 10,
        },
    ];
    let score = dimensions
        .iter()
        .map(|item| item.score * item.weight)
        .sum::<usize>()
        / dimensions
            .iter()
            .map(|item| item.weight)
            .sum::<usize>()
            .max(1);

    ProjectGovernanceScore {
        score,
        dimensions,
        checks: vec![
            ProjectGovernanceCheck {
                label: "分类体系".to_string(),
                passed: input.category_count > 0,
            },
            ProjectGovernanceCheck {
                label: "词条类型".to_string(),
                passed: input.entry_type_count > 0,
            },
            ProjectGovernanceCheck {
                label: "标签字段".to_string(),
                passed: input.tag_schema_count > 0,
            },
            ProjectGovernanceCheck {
                label: "内容资产".to_string(),
                passed: input.entry_count > 0,
            },
            ProjectGovernanceCheck {
                label: "平均字数".to_string(),
                passed: average_words >= 100,
            },
        ],
    }
}

#[cfg(test)]
mod governance_score_tests {
    use super::*;

    fn base_input() -> GovernanceScoreInput {
        GovernanceScoreInput {
            category_count: 1,
            entry_type_count: 1,
            tag_schema_count: 1,
            entry_count: 10,
            word_count: 1000,
            length_score_total: 1000,
            relation_count: 1,
            internal_link_count: 0,
            capped_connection_count: 30,
            unset_type_count: 0,
            uncategorized_entry_count: 0,
            empty_content_entry_count: 0,
            missing_summary_entry_count: 0,
            isolated_entry_count: 0,
        }
    }

    #[test]
    fn governance_score_uses_v2_weights_without_risk_dimension() {
        let mut input = base_input();
        input.word_count = 500;
        input.length_score_total = 500;
        input.empty_content_entry_count = 5;
        input.missing_summary_entry_count = 5;

        let score = build_governance_score(input);

        assert_eq!(score.score, 82);
        assert!(!score.dimensions.iter().any(|item| item.key == "risk"));
        assert_eq!(
            score
                .dimensions
                .iter()
                .find(|item| item.key == "content")
                .map(|item| item.weight),
            Some(35)
        );
        assert_eq!(
            score
                .dimensions
                .iter()
                .find(|item| item.key == "structure")
                .map(|item| item.weight),
            Some(10)
        );
    }
}

fn parse_entry_uri(raw: &str) -> Option<Uuid> {
    let decoded = urlencoding::decode(raw).ok()?;
    Uuid::parse_str(decoded.trim()).ok()
}

fn parse_internal_entry_links(content: &str, project_id: &Uuid) -> Vec<(Option<Uuid>, String)> {
    let mut links = Vec::new();
    let mut offset = 0usize;

    while offset < content.len() {
        let Some(open_rel) = content[offset..].find('[') else {
            break;
        };
        let open = offset + open_rel;

        if content[open..].starts_with("[[") {
            let title_start = open + 2;
            if let Some(close_rel) = content[title_start..].find("]]") {
                let close = title_start + close_rel;
                let title = content[title_start..close].trim();
                if !title.is_empty() && !title.contains('\n') {
                    links.push((None, title.to_string()));
                }
                offset = close + 2;
                continue;
            }
        }

        let title_start = open + 1;
        let Some(title_close_rel) = content[title_start..].find(']') else {
            offset = title_start;
            continue;
        };
        let title_close = title_start + title_close_rel;
        if !content[title_close..].starts_with("](") {
            offset = title_close + 1;
            continue;
        }

        let href_start = title_close + 2;
        let Some(href_close_rel) = content[href_start..].find(')') else {
            offset = href_start;
            continue;
        };
        let href_close = href_start + href_close_rel;
        let href = &content[href_start..href_close];
        let entry_id = match parse_fc_entry_ref(href, project_id) {
            Some(FcEntryRef::CurrentProject(entry_id)) => Some(entry_id),
            // entry_links 只记录项目内链接，跨项目引用不能记成本项目出链。
            Some(FcEntryRef::OtherProject { .. }) => {
                offset = href_close + 1;
                continue;
            }
            // 旧式 entry:// 链接的 ID 解析失败时退回按标题解析，保留历史行为。
            None => match href.strip_prefix("entry://") {
                Some(raw_id) => parse_entry_uri(raw_id),
                None => {
                    offset = title_close + 1;
                    continue;
                }
            },
        };
        let title = content[title_start..title_close].trim();
        if !title.is_empty() && !title.contains('\n') {
            links.push((entry_id, title.to_string()));
        }
        offset = href_close + 1;
    }

    links
}

fn outgoing_link_targets(content: &str, project_id: &Uuid) -> Vec<SaveEntryLinkTarget> {
    parse_internal_entry_links(content, project_id)
        .into_iter()
        .map(|(entry_id, title)| SaveEntryLinkTarget { entry_id, title })
        .collect()
}

/// 按词条当前正文重建出链，返回需要广播 `entry:updated` 的词条 ID（本词条与新旧出链目标）。
///
/// AI 工具写正文不经过 `db_save_entry_bundle`，写完不重建的话，目标词条的反链会停在旧正文。
pub(crate) async fn sync_outgoing_links_from_content(
    db: &SqliteDb,
    entry: &Entry,
) -> Result<BTreeSet<Uuid>, String> {
    let previous_links = db
        .list_outgoing_links(&entry.id)
        .await
        .map_err(|e| e.to_string())?;
    let links = db
        .replace_outgoing_link_targets(
            &entry.project_id,
            &entry.id,
            &outgoing_link_targets(&entry.content, &entry.project_id),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(collect_affected_entry_ids(
        entry.id,
        previous_links
            .iter()
            .chain(links.iter())
            .map(|link| link.b_id),
        [],
    ))
}

fn resolve_relation_payload(
    entry_id: &Uuid,
    draft: &SaveEntryRelationDraft,
) -> Result<(Uuid, Uuid, RelationDirection, String), String> {
    let other_entry_id = draft
        .other_entry_id
        .as_deref()
        .ok_or_else(|| "存在未完成的词条关系，请先选择目标词条。".to_string())
        .and_then(|id| Uuid::parse_str(id).map_err(|e| e.to_string()))?;
    if &other_entry_id == entry_id {
        return Err("存在未完成的词条关系，请先选择目标词条。".to_string());
    }

    let content = normalize_entry_compare_text(draft.content.as_deref().unwrap_or_default());
    match draft.direction.as_str() {
        "incoming" => Ok((
            other_entry_id,
            *entry_id,
            RelationDirection::OneWay,
            content,
        )),
        "two_way" => Ok((
            *entry_id,
            other_entry_id,
            RelationDirection::TwoWay,
            content,
        )),
        _ => Ok((
            *entry_id,
            other_entry_id,
            RelationDirection::OneWay,
            content,
        )),
    }
}

fn collect_affected_entry_ids(
    entry_id: Uuid,
    link_targets: impl IntoIterator<Item = Uuid>,
    relation_endpoints: impl IntoIterator<Item = (Uuid, Uuid)>,
) -> BTreeSet<Uuid> {
    let mut entry_ids = BTreeSet::from([entry_id]);
    entry_ids.extend(link_targets);
    for (a_id, b_id) in relation_endpoints {
        entry_ids.insert(a_id);
        entry_ids.insert(b_id);
    }
    entry_ids
}

#[cfg(test)]
mod entry_update_event_tests {
    use super::*;

    #[test]
    fn affected_entries_include_link_and_relation_peers_without_duplicates() {
        let current = Uuid::from_u128(1);
        let linked = Uuid::from_u128(2);
        let related = Uuid::from_u128(3);

        let affected = collect_affected_entry_ids(
            current,
            [linked, linked],
            [(current, related), (related, current)],
        );

        assert_eq!(affected, BTreeSet::from([current, linked, related]));
    }

    const PROJECT_ID: &str = "018f5fbb-0f3b-7c6d-8c4f-2a4a0b8f9c01";
    const ENTRY_ID: &str = "018f5fbb-0f3b-7c6d-8c4f-2a4a0b8f9c02";

    fn ids() -> (Uuid, Uuid) {
        (
            Uuid::parse_str(PROJECT_ID).unwrap(),
            Uuid::parse_str(ENTRY_ID).unwrap(),
        )
    }

    #[test]
    fn internal_links_accept_fc_self_entry_refs() {
        let (project_id, entry_id) = ids();

        let links = parse_internal_entry_links(
            &format!("见[目标](fc://self/entry/{entry_id})。"),
            &project_id,
        );

        assert_eq!(links, vec![(Some(entry_id), "目标".to_string())]);
    }

    #[test]
    fn internal_links_accept_fc_refs_with_current_project_id() {
        let (project_id, entry_id) = ids();

        let links = parse_internal_entry_links(
            &format!("[目标](fc://{project_id}/entry/{entry_id})"),
            &project_id,
        );

        assert_eq!(links, vec![(Some(entry_id), "目标".to_string())]);
    }

    #[test]
    fn internal_links_skip_fc_refs_to_other_projects() {
        let (project_id, entry_id) = ids();
        let other_project_id = Uuid::from_u128(9);

        let links = parse_internal_entry_links(
            &format!("[外部](fc://{other_project_id}/entry/{entry_id}) [[本项目]]"),
            &project_id,
        );

        assert_eq!(links, vec![(None, "本项目".to_string())]);
    }

    #[test]
    fn internal_links_decode_percent_encoded_entry_ids() {
        let (project_id, entry_id) = ids();
        let encoded = ENTRY_ID.replace('-', "%2D");

        let links =
            parse_internal_entry_links(&format!("[目标](fc://self/entry/{encoded})"), &project_id);

        assert_eq!(links, vec![(Some(entry_id), "目标".to_string())]);
    }

    #[test]
    fn internal_links_skip_fc_refs_with_invalid_uuid_or_non_entry_resource() {
        let (project_id, entry_id) = ids();

        let links = parse_internal_entry_links(
            &format!(
                "[坏链](fc://self/entry/not-a-uuid) ![图](fc://self/image/{entry_id}) [外链](https://example.com)"
            ),
            &project_id,
        );

        assert!(links.is_empty(), "{links:?}");
    }

    #[test]
    fn internal_links_keep_legacy_entry_uri_and_wiki_title_links() {
        let (project_id, entry_id) = ids();

        let links = parse_internal_entry_links(
            &format!("[旧链](entry://{entry_id}) [旧坏链](entry://not-a-uuid) [[维基标题]]"),
            &project_id,
        );

        assert_eq!(
            links,
            vec![
                (Some(entry_id), "旧链".to_string()),
                (None, "旧坏链".to_string()),
                (None, "维基标题".to_string()),
            ]
        );
    }
}

#[tauri::command]
pub async fn db_create_entry(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, PathsState>,
    project_id: String,
    category_id: Option<String>,
    title: String,
    summary: Option<String>,
    content: Option<String>,
    r#type: Option<String>,
    tags: Option<Vec<EntryTag>>,
    images: Option<Vec<FCImage>>,
) -> Result<Entry, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let images = copy_entry_images(paths.inner(), &project_id, images)?;
    let db = open_project_db(state.inner(), &project_id).await?;
    let entry = db
        .create_entry(CreateEntry {
            project_id,
            category_id,
            title,
            summary,
            content,
            r#type,
            tags,
            images,
            cover_path: None,
        })
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &entry.project_id).await?;
    Ok(entry)
}

/// 获取完整词条（含 content、tags、images）
#[tauri::command]
pub async fn db_get_entry(
    state: State<'_, Arc<AppState>>,
    id: String,
    project_id: Option<String>,
) -> Result<Entry, String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let project_id = project_id
        .as_deref()
        .map(|id| Uuid::parse_str(id).map_err(|e| e.to_string()))
        .transpose()?;
    let db = open_entry_db(state.inner(), &id, project_id.as_ref()).await?;
    db.get_entry(&id).await.map_err(|e| e.to_string())
}

/// 分页列出词条简报（不含 content）；可按分类和词条类型过滤
#[tauri::command]
pub async fn db_list_entries(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, PathsState>,
    project_id: String,
    category_id: Option<String>,
    entry_type: Option<String>,
    limit: usize,
    offset: usize,
) -> Result<Vec<EntryBrief>, String> {
    log::info!(
        "[worldflow] db_list_entries 请求 project_id={} category_id={:?} entry_type={:?} limit={} offset={}",
        project_id,
        category_id,
        entry_type,
        limit,
        offset
    );
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let db = open_project_db(state.inner(), &project_id).await?;
    let category_id_ref = category_id.as_ref();
    let result = db
        .list_entries(
            &project_id,
            EntryFilter {
                category_id: category_id_ref,
                entry_type: entry_type.as_deref(),
            },
            limit,
            offset,
        )
        .await
        .map(|mut entries| {
            use_derived_cover_thumbnails(paths.inner(), &project_id, &mut entries);
            entries
        });

    match &result {
        Ok(entries) => {
            let preview = entries
                .iter()
                .take(5)
                .map(|entry| entry.title.as_str())
                .collect::<Vec<_>>();
            log::info!(
                "[worldflow] db_list_entries 返回 count={} preview_titles={:?}",
                entries.len(),
                preview
            );
        }
        Err(err) => {
            log::error!("[worldflow] db_list_entries 失败: {}", err);
        }
    }

    result.map_err(|e| e.to_string())
}

/// 聚合项目内带时间标签的词条，输出时间线事件数据
#[tauri::command]
pub async fn db_list_timeline_events(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<ProjectTimelineData, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let db = open_project_db(state.inner(), &project_id).await?;

    let tag_schemas = db
        .list_tag_schemas(&project_id)
        .await
        .map_err(|e| e.to_string())?;

    let schema_role_map = tag_schemas
        .iter()
        .filter_map(|schema| {
            timeline_tag_role_from_name(&schema.name).map(|role| (schema.id, role))
        })
        .collect::<std::collections::HashMap<_, _>>();

    let mut entry_briefs = Vec::new();
    let mut offset = 0usize;
    const PAGE_SIZE: usize = 500;

    loop {
        let batch = db
            .list_entries(
                &project_id,
                EntryFilter {
                    category_id: None,
                    entry_type: None,
                },
                PAGE_SIZE,
                offset,
            )
            .await
            .map_err(|e| e.to_string())?;

        let batch_len = batch.len();
        if batch_len == 0 {
            break;
        }

        offset += batch_len;
        entry_briefs.extend(batch);

        if batch_len < PAGE_SIZE {
            break;
        }
    }

    let scanned_entry_count = entry_briefs.len();
    let mut events = Vec::new();

    for brief in entry_briefs {
        let entry = db.get_entry(&brief.id).await.map_err(|e| e.to_string())?;
        let mut start_time = None;
        let mut end_time = None;
        let mut parent_id = None;
        let mut show_on_timeline = None;

        for tag in &entry.tags.0 {
            let Some(role) = schema_role_map.get(&tag.schema_id).copied() else {
                continue;
            };

            match role {
                TimelineTagRole::Start => {
                    if start_time.is_none() {
                        start_time = parse_timeline_year(&tag.value);
                    }
                }
                TimelineTagRole::End => {
                    if end_time.is_none() {
                        end_time = parse_timeline_year(&tag.value);
                    }
                }
                TimelineTagRole::Parent => {
                    if parent_id.is_none() {
                        parent_id = parse_timeline_parent(&tag.value);
                    }
                }
                TimelineTagRole::Show => {
                    if show_on_timeline.is_none() {
                        show_on_timeline = parse_timeline_bool(&tag.value);
                    }
                }
            }
        }

        let Some(start_time) = start_time else {
            continue;
        };

        if matches!(show_on_timeline, Some(false)) {
            continue;
        }

        let (start_time, end_time) = match end_time {
            Some(end_time) if end_time < start_time => (end_time, Some(start_time)),
            Some(end_time) => (start_time, Some(end_time)),
            None => (start_time, None),
        };

        events.push(ProjectTimelineEvent {
            id: entry.id.to_string(),
            title: entry.title.clone(),
            start_time,
            end_time,
            description: entry.summary.clone(),
            parent_id,
            entry_type: entry.r#type.clone(),
            category_id: entry.category_id.map(|category_id| category_id.to_string()),
        });
    }

    let title_to_id = events
        .iter()
        .map(|event| (normalize_timeline_tag_name(&event.title), event.id.clone()))
        .collect::<std::collections::HashMap<_, _>>();
    let valid_ids = events
        .iter()
        .map(|event| event.id.clone())
        .collect::<std::collections::HashSet<_>>();

    for event in &mut events {
        let resolved_parent = event.parent_id.as_ref().and_then(|parent| {
            if valid_ids.contains(parent) {
                Some(parent.clone())
            } else {
                title_to_id
                    .get(&normalize_timeline_tag_name(parent))
                    .cloned()
            }
        });

        event.parent_id = match resolved_parent {
            Some(parent_id) if parent_id != event.id => Some(parent_id),
            _ => None,
        };
    }

    events.sort_by(|left, right| {
        left.start_time
            .cmp(&right.start_time)
            .then_with(|| {
                left.end_time
                    .unwrap_or(left.start_time)
                    .cmp(&right.end_time.unwrap_or(right.start_time))
            })
            .then_with(|| left.title.cmp(&right.title))
    });

    let year_start = events.iter().map(|event| event.start_time).min();
    let year_end = events
        .iter()
        .map(|event| event.end_time.unwrap_or(event.start_time))
        .max();

    Ok(ProjectTimelineData {
        matched_entry_count: events.len(),
        scanned_entry_count,
        year_start,
        year_end,
        events,
    })
}

/// 统计项目图片总数和总字数
#[tauri::command]
pub async fn db_get_project_stats(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<ProjectStats, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let db = open_project_db(state.inner(), &project_id).await?;

    let mut image_count = 0usize;
    let mut word_count = 0usize;
    let mut length_score_total = 0usize;
    let mut entry_count = 0usize;
    let mut internal_link_count = 0usize;
    let mut unset_type_count = 0usize;
    let mut uncategorized_entry_count = 0usize;
    let mut empty_content_entry_count = 0usize;
    let mut short_content_entry_count = 0usize;
    let mut missing_summary_entry_count = 0usize;
    let mut created_last_7_days = 0usize;
    let mut updated_last_7_days = 0usize;
    let mut entries_by_type = HashMap::<Option<String>, (usize, usize)>::new();
    let mut entries_by_category = HashMap::<Option<Uuid>, (usize, usize)>::new();
    let mut entry_ids = HashSet::<Uuid>::new();
    let mut connection_neighbors = HashMap::<Uuid, HashSet<Uuid>>::new();
    let mut offset = 0usize;
    const PAGE_SIZE: usize = 500;
    const SHORT_CONTENT_CHAR_THRESHOLD: usize = 100;
    let recent_threshold = Utc::now() - Duration::days(7);

    let relations = db
        .list_relations_for_project(&project_id)
        .await
        .map_err(|e| e.to_string())?;
    let category_count = db
        .list_categories(&project_id)
        .await
        .map_err(|e| e.to_string())?
        .len();
    let entry_type_count = db
        .list_all_entry_types(&project_id)
        .await
        .map_err(|e| e.to_string())?
        .len();
    let tag_schema_count = db
        .list_tag_schemas(&project_id)
        .await
        .map_err(|e| e.to_string())?
        .len();
    let mut relation_pairs = HashSet::<(Uuid, Uuid)>::new();
    for relation in &relations {
        if relation.a_id == relation.b_id {
            continue;
        }
        let pair = if relation.a_id < relation.b_id {
            (relation.a_id, relation.b_id)
        } else {
            (relation.b_id, relation.a_id)
        };
        if relation_pairs.insert(pair) {
            connection_neighbors
                .entry(relation.a_id)
                .or_default()
                .insert(relation.b_id);
            connection_neighbors
                .entry(relation.b_id)
                .or_default()
                .insert(relation.a_id);
        }
    }

    loop {
        let batch = db
            .list_entries(
                &project_id,
                EntryFilter {
                    category_id: None,
                    entry_type: None,
                },
                PAGE_SIZE,
                offset,
            )
            .await
            .map_err(|e| e.to_string())?;

        let batch_len = batch.len();
        if batch_len == 0 {
            break;
        }

        for brief in &batch {
            let entry = db.get_entry(&brief.id).await.map_err(|e| e.to_string())?;
            let entry_word_count = entry.content.chars().count();
            let entry_type = normalize_stats_entry_type(entry.r#type.as_deref());
            let category_id = entry.category_id;

            entry_count += 1;
            entry_ids.insert(entry.id);
            image_count += entry.images.0.len();
            word_count += entry_word_count;
            length_score_total += entry_word_count.min(SHORT_CONTENT_CHAR_THRESHOLD) * 100
                / SHORT_CONTENT_CHAR_THRESHOLD;

            if category_id.is_none() {
                uncategorized_entry_count += 1;
            }
            if entry_type.is_none() {
                unset_type_count += 1;
            }
            if entry.content.trim().is_empty() {
                empty_content_entry_count += 1;
            }
            if entry_word_count < SHORT_CONTENT_CHAR_THRESHOLD {
                short_content_entry_count += 1;
            }
            if entry
                .summary
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .is_empty()
            {
                missing_summary_entry_count += 1;
            }
            if parse_entry_timestamp(&entry.created_at)
                .map(|created_at| created_at >= recent_threshold)
                .unwrap_or(false)
            {
                created_last_7_days += 1;
            }
            if parse_entry_timestamp(&entry.updated_at)
                .map(|updated_at| updated_at >= recent_threshold)
                .unwrap_or(false)
            {
                updated_last_7_days += 1;
            }

            let type_entry = entries_by_type.entry(entry_type).or_insert((0, 0));
            type_entry.0 += 1;
            type_entry.1 += entry_word_count;

            let category_entry = entries_by_category.entry(category_id).or_insert((0, 0));
            category_entry.0 += 1;
            category_entry.1 += entry_word_count;

            let outgoing_links = db
                .list_outgoing_links(&entry.id)
                .await
                .map_err(|e| e.to_string())?;
            let incoming_links = db
                .list_incoming_links(&entry.id)
                .await
                .map_err(|e| e.to_string())?;
            internal_link_count += outgoing_links.len();
            let linked_entry_ids = outgoing_links
                .iter()
                .chain(incoming_links.iter())
                .filter_map(|link| {
                    if link.a_id == entry.id && link.b_id != entry.id {
                        Some(link.b_id)
                    } else if link.b_id == entry.id && link.a_id != entry.id {
                        Some(link.a_id)
                    } else {
                        None
                    }
                })
                .collect::<HashSet<_>>();
            if !linked_entry_ids.is_empty() {
                connection_neighbors
                    .entry(entry.id)
                    .or_default()
                    .extend(linked_entry_ids);
            }
        }

        offset += batch_len;
        if batch_len < PAGE_SIZE {
            break;
        }
    }

    let isolated_entry_count = entry_ids
        .iter()
        .filter(|entry_id| {
            connection_neighbors
                .get(entry_id)
                .map(|neighbors| {
                    !neighbors
                        .iter()
                        .any(|neighbor| entry_ids.contains(neighbor))
                })
                .unwrap_or(true)
        })
        .count();
    let capped_connection_count = entry_ids
        .iter()
        .map(|entry_id| {
            connection_neighbors
                .get(entry_id)
                .map(|neighbors| {
                    neighbors
                        .iter()
                        .filter(|neighbor| entry_ids.contains(neighbor))
                        .count()
                        .min(3)
                })
                .unwrap_or(0)
        })
        .sum::<usize>();
    let mut entries_by_type = entries_by_type
        .into_iter()
        .map(|(entry_type, (count, word_count))| ProjectEntryTypeStat {
            entry_type,
            count,
            word_count,
        })
        .collect::<Vec<_>>();
    let mut entries_by_category = entries_by_category
        .into_iter()
        .map(|(category_id, (count, word_count))| ProjectCategoryStat {
            category_id: category_id.map(|id| id.to_string()),
            count,
            word_count,
        })
        .collect::<Vec<_>>();
    sort_type_stats(&mut entries_by_type);
    sort_category_stats(&mut entries_by_category);
    let governance_score = build_governance_score(GovernanceScoreInput {
        category_count,
        entry_type_count,
        tag_schema_count,
        entry_count,
        word_count,
        length_score_total,
        relation_count: relations.len(),
        internal_link_count,
        capped_connection_count,
        unset_type_count,
        uncategorized_entry_count,
        empty_content_entry_count,
        missing_summary_entry_count,
        isolated_entry_count,
    });

    Ok(ProjectStats {
        entry_count,
        image_count,
        word_count,
        relation_count: relations.len(),
        internal_link_count,
        entries_by_type,
        entries_by_category,
        uncategorized_entry_count,
        empty_content_entry_count,
        short_content_entry_count,
        missing_summary_entry_count,
        isolated_entry_count,
        created_last_7_days,
        updated_last_7_days,
        governance_score,
    })
}

/// 全文搜索词条（FTS）；可按分类和词条类型过滤
#[tauri::command]
pub async fn db_search_entries(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, PathsState>,
    project_id: String,
    query: String,
    category_id: Option<String>,
    entry_type: Option<String>,
    limit: usize,
) -> Result<Vec<EntryBrief>, String> {
    log::info!(
        "[worldflow] db_search_entries 请求 project_id={} category_id={:?} entry_type={:?} limit={} query={:?}",
        project_id,
        category_id,
        entry_type,
        limit,
        query
    );
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let db = open_project_db(state.inner(), &project_id).await?;
    let category_id_ref = category_id.as_ref();
    let result = db
        .search_entries(
            &project_id,
            &query,
            EntryFilter {
                category_id: category_id_ref,
                entry_type: entry_type.as_deref(),
            },
            limit,
        )
        .await
        .map(|mut entries| {
            use_derived_cover_thumbnails(paths.inner(), &project_id, &mut entries);
            entries
        });

    match &result {
        Ok(entries) => {
            let preview = entries
                .iter()
                .take(5)
                .map(|entry| entry.title.as_str())
                .collect::<Vec<_>>();
            log::info!(
                "[worldflow] db_search_entries 返回 count={} preview_titles={:?}",
                entries.len(),
                preview
            );
        }
        Err(err) => {
            log::error!("[worldflow] db_search_entries 失败: {}", err);
        }
    }

    result.map_err(|e| e.to_string())
}

/// 统计词条数量；可按分类和词条类型过滤
#[tauri::command]
pub async fn db_count_entries(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    category_id: Option<String>,
    entry_type: Option<String>,
) -> Result<i64, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let db = open_project_db(state.inner(), &project_id).await?;
    let category_id_ref = category_id.as_ref();
    db.count_entries(
        &project_id,
        EntryFilter {
            category_id: category_id_ref,
            entry_type: entry_type.as_deref(),
        },
    )
    .await
    .map_err(|e| e.to_string())
}

/// 更新词条；仅传入需要修改的字段，None 表示不变
#[tauri::command]
pub async fn db_update_entry(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, PathsState>,
    id: String,
    project_id: Option<String>,
    category_id: Option<String>,
    title: Option<String>,
    summary: Option<String>,
    summary_set: Option<bool>,
    content: Option<String>,
    r#type: Option<String>,
    tags: Option<Vec<EntryTag>>,
    images: Option<Vec<FCImage>>,
) -> Result<Entry, String> {
    log::info!(
        "[db_update_entry] 开始保存 entry_id={}, images_count={:?}",
        id,
        images.as_ref().map(|v| v.len())
    );
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let project_id = project_id
        .as_deref()
        .map(|id| Uuid::parse_str(id).map_err(|e| e.to_string()))
        .transpose()?;
    let db = open_entry_db(state.inner(), &id, project_id.as_ref()).await?;
    let current_entry = db.get_entry(&id).await.map_err(|e| e.to_string())?;
    ensure_character_voice_tag_schemas(&db, &current_entry.project_id, tags.as_deref()).await?;
    let images = copy_entry_images(paths.inner(), &current_entry.project_id, images)?;
    let cover_path = images.as_ref().map(|_| None);
    let category_id = category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;
    let entry = db
        .update_entry(
            &id,
            UpdateEntry {
                category_id: Some(category_id),
                title,
                summary: if summary_set.unwrap_or(false) {
                    Some(summary)
                } else {
                    None
                },
                content,
                r#type: Some(r#type),
                tags,
                images,
                cover_path,
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    touch_project_updated_at(&db, &entry.project_id).await?;
    log::info!(
        "[db_update_entry] 保存完成 entry_id={}, images_count={}",
        entry.id,
        entry.images.0.len()
    );
    Ok(entry)
}

/// 保存词条主体、正文内链和关系草稿，减少前端多轮 IPC。
#[tauri::command]
pub async fn db_save_entry_bundle(
    app_handle: AppHandle,
    state: State<'_, Arc<AppState>>,
    paths: State<'_, PathsState>,
    input: SaveEntryBundleInput,
) -> Result<SaveEntryBundleResponse, String> {
    let project_id = Uuid::parse_str(&input.project_id).map_err(|e| e.to_string())?;
    let entry_id = Uuid::parse_str(&input.id).map_err(|e| e.to_string())?;
    let category_id = input
        .category_id
        .map(|cid| Uuid::parse_str(&cid).map_err(|e| e.to_string()))
        .transpose()?;

    let db = open_project_db(state.inner(), &project_id).await?;
    let current_entry = db.get_entry(&entry_id).await.map_err(|e| e.to_string())?;
    ensure_character_voice_tag_schemas(&db, &project_id, input.tags.as_deref()).await?;
    let previous_outgoing_links = db
        .list_outgoing_links(&entry_id)
        .await
        .map_err(|e| e.to_string())?;
    let previous_relations = db
        .list_relations_for_entry(&entry_id)
        .await
        .map_err(|e| e.to_string())?;
    let content = input.content.clone().unwrap_or_default();
    let source_id = input.source_id.clone();
    let outgoing_link_targets = outgoing_link_targets(&content, &project_id);
    let relation_patches = input
        .relation_drafts
        .iter()
        .map(|draft| {
            let (a_id, b_id, relation, content) = resolve_relation_payload(&entry_id, draft)?;
            let id = draft.id.as_deref().and_then(|id| Uuid::parse_str(id).ok());
            Ok(SaveEntryRelationPatch {
                id,
                a_id,
                b_id,
                relation,
                content,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let relation_patch_endpoints = relation_patches
        .iter()
        .map(|patch| (patch.a_id, patch.b_id))
        .collect::<Vec<_>>();

    let images = copy_entry_images(paths.inner(), &current_entry.project_id, input.images)?;
    let cover_path = images.as_ref().map(|_| None);
    let result = db
        .save_entry_bundle(SaveEntryBundle {
            project_id,
            entry_id,
            category_id,
            title: input.title,
            summary: input.summary,
            content,
            r#type: input.r#type,
            tags: input.tags,
            images,
            cover_path,
            outgoing_link_targets,
            relation_patches,
        })
        .await
        .map_err(|e| e.to_string())?;

    let affected_entry_ids = collect_affected_entry_ids(
        entry_id,
        previous_outgoing_links
            .iter()
            .chain(result.outgoing_links.iter())
            .map(|link| link.b_id),
        previous_relations
            .iter()
            .map(|relation| (relation.a_id, relation.b_id))
            .chain(relation_patch_endpoints),
    );
    #[derive(Clone, Serialize)]
    struct EntryUpdatedEventPayload {
        entry_id: String,
        source_id: Option<String>,
    }
    for affected_entry_id in affected_entry_ids {
        if let Err(error) = app_handle.emit(
            "entry:updated",
            EntryUpdatedEventPayload {
                entry_id: affected_entry_id.to_string(),
                source_id: source_id.clone(),
            },
        ) {
            log::warn!(
                "[db_save_entry_bundle] 广播词条更新失败 entry_id={}, error={}",
                affected_entry_id,
                error
            );
        }
    }

    Ok(SaveEntryBundleResponse {
        entry: result.entry,
        outgoing_links: result.outgoing_links,
        incoming_links: result.incoming_links,
        relations: result.relations,
    })
}

/// 删除词条
#[tauri::command]
pub async fn db_delete_entry(
    state: State<'_, Arc<AppState>>,
    id: String,
    project_id: Option<String>,
) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let project_id = project_id
        .as_deref()
        .map(|id| Uuid::parse_str(id).map_err(|e| e.to_string()))
        .transpose()?;
    let db = open_entry_db(state.inner(), &id, project_id.as_ref()).await?;
    let entry = db.get_entry(&id).await.map_err(|e| e.to_string())?;
    db.delete_entry(&id).await.map_err(|e| e.to_string())?;
    touch_project_updated_at(&db, &entry.project_id).await
}

/// 批量创建词条；返回成功插入的条数
#[tauri::command]
pub async fn db_create_entries_bulk(
    state: State<'_, Arc<AppState>>,
    entries: Vec<CreateEntry>,
) -> Result<usize, String> {
    let project_ids = entries
        .iter()
        .map(|entry| entry.project_id)
        .collect::<BTreeSet<_>>();
    if project_ids.len() != 1 {
        return Err("批量创建词条必须属于同一个项目".to_owned());
    }
    let project_id = *project_ids
        .iter()
        .next()
        .ok_or_else(|| "批量创建词条不能为空".to_owned())?;
    let db = open_project_db(state.inner(), &project_id).await?;

    let count = db
        .create_entries_bulk(entries)
        .await
        .map_err(|e| e.to_string())?;

    for project_id in project_ids {
        touch_project_updated_at(&db, &project_id).await?;
    }

    Ok(count)
}

/// 优化 FTS 索引，消除碎片；建议在 create_entries_bulk 后调用
#[tauri::command]
pub async fn db_optimize_fts(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
) -> Result<(), String> {
    let db = if let Some(project_id) = project_id {
        let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
        open_project_db(state.inner(), &project_id).await?
    } else {
        state.inner().sqlite_db.lock().await.clone()
    };
    db.optimize_fts().await.map_err(|e| e.to_string())
}

// ============ 标签模式 ============
