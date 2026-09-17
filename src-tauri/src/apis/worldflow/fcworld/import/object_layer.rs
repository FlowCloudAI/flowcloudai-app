//! 世界包对象层导入：按结构重映射身份，以 HTML 解析器仅改写链接属性，并重校验页面与资产。

use super::{ImportIdMaps, PreparedImportAsset, ValidatedFcworldPackage};
use crate::{PathsState, document_validation};
use lol_html::{RewriteStrSettings, element, rewrite_str};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use uuid::Uuid;

fn id_field(row: &Value, key: &str) -> Result<String, String> {
    row.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| format!("对象层字段 {key} 缺失"))
}

fn put_id(row: &mut Value, key: &str, mapped: &str) -> Result<(), String> {
    let object = row.as_object_mut().ok_or("对象层记录不是对象")?;
    object.insert(key.to_string(), Value::String(mapped.to_string()));
    Ok(())
}

fn array_mut<'a>(value: &'a mut Value, key: &str) -> Result<&'a mut Vec<Value>, String> {
    value
        .get_mut(key)
        .and_then(Value::as_array_mut)
        .ok_or_else(|| format!("对象层载荷缺少 {key} 数组"))
}

fn mapped<'a>(map: &'a HashMap<String, String>, old: &str, label: &str) -> Result<&'a str, String> {
    map.get(old)
        .map(String::as_str)
        .ok_or_else(|| format!("{label} 引用了未导入的对象 {old}"))
}

fn rewrite_href(href: &str, maps: &ImportIdMaps) -> Result<Option<String>, String> {
    let decoded = html_escape::decode_html_entities(href);
    // 链接语法中的身份均为 ASCII UUID；先归一大小写，与校验器接受的形式一致。
    let normalized = decoded.to_ascii_lowercase();
    let href = normalized.as_str();
    if let Some(old_entry) = href.strip_prefix("fc://self/entry/") {
        return Ok(Some(format!(
            "fc://self/entry/{}",
            mapped(&maps.entries, old_entry, "页面链接")?
        )));
    }
    if let Some(rest) = href.strip_prefix("fc://") {
        if let Some((project, entry)) = rest.split_once("/entry/") {
            if maps.projects.contains_key(project) {
                return Ok(Some(format!(
                    "fc://self/entry/{}",
                    mapped(&maps.entries, entry, "页面链接")?
                )));
            }
        }
    }
    if let Some(rest) = href.strip_prefix("entry://") {
        if let Some((project, entry)) = rest.split_once('/') {
            if let Some(new_project) = maps.projects.get(project) {
                return Ok(Some(format!(
                    "entry://{new_project}/{}",
                    mapped(&maps.entries, entry, "页面链接")?
                )));
            }
        } else {
            return Ok(Some(format!(
                "entry://{}",
                mapped(&maps.entries, rest, "页面链接")?
            )));
        }
    }
    Ok(None)
}

fn rewrite_html_links(html: &str, maps: &ImportIdMaps) -> Result<String, String> {
    let failure = RefCell::new(None::<String>);
    // lol_html 按解析出的起始标签位置局部改写属性；正文、注释、CSS 和无关属性原样保留。
    let result = rewrite_str(
        html,
        RewriteStrSettings::new().append_element_content_handler(element!(
            "a[href],area[href]",
            |element| {
                if let Some(href) = element.get_attribute("href") {
                    match rewrite_href(&href, maps) {
                        Ok(Some(next)) => {
                            if let Err(error) = element.set_attribute("href", &next) {
                                *failure.borrow_mut() = Some(format!("改写页面链接失败：{error}"));
                            }
                        }
                        Ok(None) => {}
                        Err(error) => *failure.borrow_mut() = Some(error),
                    }
                }
                Ok(())
            }
        )),
    )
    .map_err(|error| format!("解析页面 HTML 失败：{error}"))?;
    if let Some(error) = failure.into_inner() {
        return Err(error);
    }
    Ok(result)
}

fn remap_field(row: &mut Value, key: &str, map: &HashMap<String, String>) -> Result<(), String> {
    let old = id_field(row, key)?;
    put_id(row, key, mapped(map, &old, key)?)
}

fn remap_optional_field(
    row: &mut Value,
    key: &str,
    map: &HashMap<String, String>,
) -> Result<(), String> {
    if let Some(old) = row.get(key).and_then(Value::as_str).map(str::to_owned) {
        if let Some(next) = map.get(&old) {
            put_id(row, key, next)?;
        }
    }
    Ok(())
}

fn remap_object_rows(
    value: &mut Value,
    maps: &ImportIdMaps,
) -> Result<HashMap<String, String>, String> {
    let mut ids = HashMap::new();
    for row in array_mut(value, "registry")? {
        let old = id_field(row, "id")?;
        Uuid::parse_str(&old).map_err(|_| format!("对象 ID 无效：{old}"))?;
        let kind = id_field(row, "kind")?;
        let next = match kind.as_str() {
            "project" => mapped(&maps.projects, &old, "项目对象")?.to_string(),
            "entry" if maps.entries.contains_key(&old) => {
                mapped(&maps.entries, &old, "词条对象")?.to_string()
            }
            _ => Uuid::now_v7().to_string(),
        };
        if ids.insert(old, next).is_some() {
            return Err("对象登记含重复 ID".into());
        }
    }
    for row in array_mut(value, "registry")? {
        remap_field(row, "id", &ids)?;
        remap_optional_field(row, "project_id", &maps.projects)?;
        remap_optional_field(row, "cascade_source_id", &ids)?;
    }
    for row in array_mut(value, "entry_documents")? {
        remap_field(row, "entry_id", &ids)?;
        remap_field(row, "project_id", &maps.projects)?;
        let html = id_field(row, "html")?;
        put_id(row, "html", &rewrite_html_links(&html, maps)?)?;
    }
    for row in array_mut(value, "home_documents")? {
        remap_field(row, "object_id", &ids)?;
        remap_field(row, "project_id", &maps.projects)?;
        let html = id_field(row, "html")?;
        put_id(row, "html", &rewrite_html_links(&html, maps)?)?;
    }
    for key in ["text_blocks", "legacy_text", "changes", "receipts"] {
        for row in array_mut(value, key)? {
            remap_field(row, "object_id", &ids)?;
        }
    }
    for row in array_mut(value, "references")? {
        remap_field(row, "source_id", &ids)?;
        remap_optional_field(row, "target_id", &ids)?;
    }
    for row in array_mut(value, "assets")? {
        remap_optional_field(row, "project_id", &maps.projects)?;
        row.as_object_mut()
            .ok_or("页面资产记录不是对象")?
            .insert("storage_layout".into(), json!(1));
    }
    for row in array_mut(value, "asset_scopes")? {
        if row["scope_kind"] == "project" {
            remap_field(row, "scope_id", &maps.projects)?;
        }
    }
    Ok(ids)
}

fn rebuild_projections(value: &mut Value, project_id: Uuid) -> Result<(), String> {
    let asset_ids = array_mut(value, "assets")?
        .iter()
        .map(|row| id_field(row, "id"))
        .collect::<Result<HashSet<_>, _>>()?;
    let scopes = array_mut(value, "asset_scopes")?
        .iter()
        .filter(|row| row["scope_kind"] == "project" && row["scope_id"] == project_id.to_string())
        .map(|row| id_field(row, "asset_id"))
        .collect::<Result<HashSet<_>, _>>()?;
    let mut blocks = Vec::new();
    let mut asset_refs = Vec::new();
    let mut derived = HashMap::<String, (String, i64)>::new();
    for key in ["entry_documents", "home_documents"] {
        for row in array_mut(value, key)? {
            let object_id = id_field(
                row,
                if key == "entry_documents" {
                    "entry_id"
                } else {
                    "object_id"
                },
            )?;
            let html = id_field(row, "html")?;
            let css = id_field(row, "css")?;
            let revision = row["revision"].as_i64().ok_or("页面文档缺少 revision")?;
            let validation =
                document_validation::validate(&html, &css, Some(&project_id.to_string()));
            if !validation.valid {
                return Err(format!("导入页面文档未通过 Rust 校验：{object_id}"));
            }
            if key == "entry_documents" {
                row.as_object_mut().ok_or("词条页面记录不是对象")?.insert(
                    "validated_link_targets".into(),
                    Value::Array(validation.link_targets.iter().map(|target|
                        json!({"entry_id": target.entry_id, "title": target.title})
                    ).collect()),
                );
            }
            for (ord, block) in validation.text_blocks.iter().enumerate() {
                blocks.push(json!({"object_id": object_id, "node_id": block.node_id,
                    "ord": ord, "text": block.text, "revision": revision}));
            }
            for asset_id in &validation.asset_ids {
                if !asset_ids.contains(&asset_id.to_string())
                    || !scopes.contains(&asset_id.to_string())
                {
                    return Err(format!("页面文档引用未授权或缺失资产：{asset_id}"));
                }
                asset_refs.push(json!({"source_id": object_id,
                    "source_node_id": Uuid::nil(), "target_id": asset_id,
                    "target_node_id": Uuid::nil(), "ref_type": "asset", "source_revision": revision}));
            }
            derived.insert(object_id, (validation.derived_text, revision));
        }
    }
    *array_mut(value, "text_blocks")? = blocks;
    let refs = array_mut(value, "references")?;
    refs.retain(|row| row["ref_type"] != "asset" && row["ref_type"] != "entry-link");
    refs.extend(asset_refs);
    let legacy = array_mut(value, "legacy_text")?;
    legacy.retain(|row| !derived.contains_key(row["object_id"].as_str().unwrap_or_default()));
    legacy.extend(derived.into_iter().map(|(object_id, (text, revision))|
        json!({"object_id": object_id, "text": text, "revision": revision})));
    Ok(())
}

fn shared_asset_root(paths: &PathsState) -> Result<PathBuf, String> {
    Ok(paths
        .db_path
        .parent()
        .ok_or("无法定位页面资产目录")?
        .join("images")
        .join("page-document"))
}

pub(super) fn prepare(
    package: &ValidatedFcworldPackage,
    maps: &ImportIdMaps,
    paths: &PathsState,
    new_project_id: Uuid,
) -> Result<(Option<String>, Vec<PreparedImportAsset>), String> {
    let Some(json) = &package.object_layer_json else {
        return Ok((None, Vec::new()));
    };
    let mut value: Value =
        serde_json::from_str(json).map_err(|error| format!("解析对象层载荷失败：{error}"))?;
    remap_object_rows(&mut value, maps)?;
    rebuild_projections(&mut value, new_project_id)?;
    let root = shared_asset_root(paths)?;
    let mut files = Vec::new();
    for row in array_mut(&mut value, "assets")? {
        let id = id_field(row, "id")?;
        let media = id_field(row, "media_type")?;
        let extension = match media.as_str() {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            _ => return Err("不支持的页面资产媒体类型".into()),
        };
        let package_path = format!("assets/page-document/{id}.{extension}");
        let bytes = package
            .page_asset_bytes_by_path
            .get(&package_path)
            .ok_or_else(|| format!("世界包缺少页面资产：{id}"))?;
        let target_path = root.join(format!("{id}.{extension}"));
        if target_path.exists() {
            let metadata = std::fs::symlink_metadata(&target_path)
                .map_err(|error| format!("检查同 ID 页面资产失败：{error}"))?;
            if !metadata.file_type().is_file() || metadata.len() > 10 * 1024 * 1024 {
                return Err(format!("本地同 ID 页面资产不是安全原件：{id}"));
            }
            let existing = std::fs::read(&target_path)
                .map_err(|error| format!("读取同 ID 页面资产失败：{error}"))?;
            if existing != *bytes {
                return Err(format!("本地同 ID 页面资产摘要冲突：{id}"));
            }
        } else {
            files.push(PreparedImportAsset {
                target_path,
                bytes: bytes.clone(),
            });
        }
    }
    let rewritten =
        serde_json::to_string(&value).map_err(|error| format!("序列化导入对象层失败：{error}"))?;
    Ok((Some(rewritten), files))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_parser_rewrites_only_author_link_attributes() {
        let old = Uuid::now_v7().to_string();
        let new = Uuid::now_v7().to_string();
        let old_project = Uuid::now_v7().to_string();
        let new_project = Uuid::now_v7().to_string();
        let mut maps = ImportIdMaps::default();
        maps.entries.insert(old.clone(), new.clone());
        maps.projects
            .insert(old_project.clone(), new_project.clone());
        let html = format!(
            "<!-- entry://{old} --><p data-note='entry://{old}'>entry://{old}<a href='entry://{old}'>链接</a><a href='entry&#58;//{old}'>实体</a><a href='FC://{old_project}/ENTRY/{old}'>项目</a></p>"
        );
        let rewritten = rewrite_html_links(&html, &maps).unwrap();
        assert_eq!(rewritten.matches(&format!("entry://{new}")).count(), 2);
        assert!(rewritten.contains(&format!("fc://self/entry/{new}")));
        assert!(rewritten.contains(&format!("data-note='entry://{old}'")));
        assert!(rewritten.contains(&format!("<!-- entry://{old} -->")));
        assert!(rewritten.contains(&format!(">entry://{old}<")));
    }
}
