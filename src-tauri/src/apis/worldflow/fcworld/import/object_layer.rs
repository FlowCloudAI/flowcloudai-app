//! 世界包对象层导入：按结构重映射身份，以 HTML 解析器仅改写链接属性，并重校验页面与资产。

use super::{ImportIdMaps, PreparedImportAsset, ValidatedFcworldPackage};
use crate::{
    PathsState, document_validation,
    page_document_commands::{
        ComponentPartSchemaInput, ComponentPropertySchemaInput, ComponentStyleVariableSchemaInput,
        validate_component_definition_metadata,
    },
};
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

fn optional_array_mut<'a>(
    value: &'a mut Value,
    key: &str,
) -> Result<Option<&'a mut Vec<Value>>, String> {
    match value.get_mut(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Array(rows)) => Ok(Some(rows)),
        Some(_) => Err(format!("对象层载荷的 {key} 不是数组")),
    }
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

fn rewrite_page_html_identities(html: &str, maps: &ImportIdMaps) -> Result<String, String> {
    let failure = RefCell::new(None::<String>);
    // lol_html 按解析出的起始标签位置局部改写属性；正文、注释、CSS 和无关属性原样保留。
    let result = rewrite_str(
        html,
        RewriteStrSettings::new().append_element_content_handler(element!(
            "a[href],area[href],[data-fc-component]",
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
                if let Some(component_id) = element.get_attribute("data-fc-component") {
                    let normalized = component_id.to_ascii_lowercase();
                    match maps.components.get(&normalized) {
                        Some(next) => {
                            if let Err(error) = element.set_attribute("data-fc-component", next) {
                                *failure.borrow_mut() =
                                    Some(format!("改写页面组件引用失败：{error}"));
                            }
                        }
                        // v2 对象载荷没有组件定义表；保留引用身份，让旧包继续导入并显示缺失状态。
                        None => {}
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
            "component_definition" => {
                mapped(&maps.components, &old.to_ascii_lowercase(), "组件对象")?.to_string()
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
        put_id(row, "html", &rewrite_page_html_identities(&html, maps)?)?;
    }
    for row in array_mut(value, "home_documents")? {
        remap_field(row, "object_id", &ids)?;
        remap_field(row, "project_id", &maps.projects)?;
        let html = id_field(row, "html")?;
        put_id(row, "html", &rewrite_page_html_identities(&html, maps)?)?;
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
    for row in optional_array_mut(value, "component_definitions")?
        .into_iter()
        .flatten()
    {
        let old_component_id = id_field(row, "component_id")?.to_ascii_lowercase();
        put_id(
            row,
            "component_id",
            mapped(&maps.components, &old_component_id, "组件定义")?,
        )?;
        if row["scope_kind"] == "project" {
            remap_field(row, "scope_id", &maps.projects)?;
        }
        if let Some(preview) = row
            .get("preview_asset_id")
            .and_then(Value::as_str)
            .map(str::to_owned)
        {
            put_id(
                row,
                "preview_asset_id",
                mapped(
                    &maps.page_assets,
                    &preview.to_ascii_lowercase(),
                    "组件预览资产",
                )?,
            )?;
        }
        let dependencies = row
            .get("asset_dependencies_json")
            .and_then(Value::as_str)
            .ok_or("组件定义缺少资源依赖")?;
        let dependencies: Vec<String> = serde_json::from_str(dependencies)
            .map_err(|error| format!("组件资源依赖无效：{error}"))?;
        let remapped = dependencies
            .into_iter()
            .map(|asset_id| {
                mapped(
                    &maps.page_assets,
                    &asset_id.to_ascii_lowercase(),
                    "组件资源依赖",
                )
                .map(str::to_owned)
            })
            .collect::<Result<Vec<_>, _>>()?;
        row.as_object_mut().ok_or("组件定义不是对象")?.insert(
            "asset_dependencies_json".into(),
            Value::String(
                serde_json::to_string(&remapped)
                    .map_err(|error| format!("序列化组件资源依赖失败：{error}"))?,
            ),
        );
    }
    Ok(ids)
}

#[derive(Default)]
struct PreparedComponentDefinitions {
    valid_component_ids: HashSet<String>,
    asset_references: Vec<Value>,
    warnings: Vec<String>,
    skipped: usize,
}

fn prepare_component_definitions(
    value: &mut Value,
    project_id: Uuid,
) -> Result<PreparedComponentDefinitions, String> {
    let asset_ids = array_mut(value, "assets")?
        .iter()
        .map(|row| id_field(row, "id").map(|id| id.to_ascii_lowercase()))
        .collect::<Result<HashSet<_>, _>>()?;
    let scopes = array_mut(value, "asset_scopes")?
        .iter()
        .filter(|row| row["scope_kind"] == "project" && row["scope_id"] == project_id.to_string())
        .map(|row| id_field(row, "asset_id").map(|id| id.to_ascii_lowercase()))
        .collect::<Result<HashSet<_>, _>>()?;
    let Some(rows) = optional_array_mut(value, "component_definitions")? else {
        array_mut(value, "registry")?.retain(|row| row["kind"] != "component_definition");
        return Ok(PreparedComponentDefinitions::default());
    };
    let mut prepared = PreparedComponentDefinitions::default();
    let mut valid_rows = Vec::new();
    for row in std::mem::take(rows) {
        let component_id = id_field(&row, "component_id")?;
        let revision = row["revision"].as_i64().ok_or("组件定义缺少 revision")?;
        let html = id_field(&row, "html")?;
        let css = id_field(&row, "css")?;
        let name = id_field(&row, "name")?;
        let category = id_field(&row, "category")?;
        let property_schema = row
            .get("property_schema_json")
            .and_then(Value::as_str)
            .and_then(|raw| serde_json::from_str::<Vec<ComponentPropertySchemaInput>>(raw).ok());
        let part_schema = row
            .get("part_schema_json")
            .and_then(Value::as_str)
            .and_then(|raw| serde_json::from_str::<Vec<ComponentPartSchemaInput>>(raw).ok());
        let style_variable_schema = row
            .get("style_variable_schema_json")
            .and_then(Value::as_str)
            .and_then(|raw| {
                serde_json::from_str::<Vec<ComponentStyleVariableSchemaInput>>(raw).ok()
            });
        let metadata_valid = property_schema
            .as_ref()
            .zip(part_schema.as_ref())
            .zip(style_variable_schema.as_ref())
            .is_some_and(|((properties, parts), variables)| {
                validate_component_definition_metadata(
                    &name, &category, properties, parts, variables,
                )
                .is_ok()
            });
        let scope_valid =
            row["scope_kind"] == "project" && row["scope_id"] == project_id.to_string();
        let dependencies = row
            .get("asset_dependencies_json")
            .and_then(Value::as_str)
            .and_then(|raw| serde_json::from_str::<Vec<String>>(raw).ok());
        let preview = row
            .get("preview_asset_id")
            .and_then(Value::as_str)
            .map(str::to_ascii_lowercase);
        let declared_assets = dependencies.as_ref().map(|items| {
            items
                .iter()
                .map(|id| id.to_ascii_lowercase())
                .collect::<HashSet<_>>()
        });
        let validation = document_validation::validate_component_definition(
            &html,
            &css,
            Some(&project_id.to_string()),
        );
        let referenced_assets = validation
            .asset_ids
            .iter()
            .map(ToString::to_string)
            .collect::<HashSet<_>>();
        let assets_valid = dependencies.as_ref().is_some_and(|items| {
            items.iter().all(|id| {
                let id = id.to_ascii_lowercase();
                asset_ids.contains(&id) && scopes.contains(&id)
            })
        }) && preview
            .as_ref()
            .is_none_or(|id| asset_ids.contains(id) && scopes.contains(id))
            && declared_assets.as_ref() == Some(&referenced_assets);
        if !scope_valid || !assets_valid || !validation.valid || !metadata_valid {
            prepared.skipped += 1;
            prepared.warnings.push(format!(
                "公共组件 {component_id} 的修订 {revision} 未通过导入校验，已跳过；引用该修订的实例将显示缺失状态"
            ));
            continue;
        }
        prepared
            .valid_component_ids
            .insert(component_id.to_ascii_lowercase());
        valid_rows.push(row);
    }
    *rows = valid_rows;

    let valid_ids = &prepared.valid_component_ids;
    array_mut(value, "registry")?.retain(|row| {
        row["kind"] != "component_definition"
            || row["id"]
                .as_str()
                .is_some_and(|id| valid_ids.contains(&id.to_ascii_lowercase()))
    });

    let mut latest = HashMap::<String, &Value>::new();
    for row in optional_array_mut(value, "component_definitions")?
        .into_iter()
        .flatten()
    {
        let component_id = id_field(row, "component_id")?.to_ascii_lowercase();
        let revision = row["revision"].as_i64().unwrap_or_default();
        let replace = latest
            .get(&component_id)
            .and_then(|current| current["revision"].as_i64())
            .is_none_or(|current| revision > current);
        if replace {
            latest.insert(component_id, row);
        }
    }
    for (component_id, row) in latest {
        let revision = row["revision"].as_i64().ok_or("组件定义缺少 revision")?;
        let mut dependencies: Vec<String> = serde_json::from_str(
            row["asset_dependencies_json"]
                .as_str()
                .ok_or("组件定义缺少资源依赖")?,
        )
        .map_err(|error| format!("组件资源依赖无效：{error}"))?;
        if let Some(preview) = row["preview_asset_id"].as_str() {
            if !dependencies.iter().any(|id| id == preview) {
                dependencies.push(preview.to_string());
            }
        }
        dependencies.sort();
        dependencies.dedup();
        prepared
            .asset_references
            .extend(dependencies.into_iter().map(|asset_id| {
                json!({"source_id": component_id, "source_node_id": Uuid::nil(),
                "target_id": asset_id, "target_node_id": Uuid::nil(), "ref_type": "asset",
                "source_revision": revision})
            }));
    }
    Ok(prepared)
}

fn rebuild_projections(
    value: &mut Value,
    project_id: Uuid,
    valid_component_ids: &HashSet<String>,
    component_asset_references: Vec<Value>,
) -> Result<(), String> {
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
    let mut derived_refs = component_asset_references;
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
                derived_refs.push(json!({"source_id": object_id,
                    "source_node_id": Uuid::nil(), "target_id": asset_id,
                    "target_node_id": Uuid::nil(), "ref_type": "asset", "source_revision": revision}));
            }
            for component in &validation.component_references {
                let component_id = component.component_id.to_string();
                if !valid_component_ids.contains(&component_id) {
                    continue;
                }
                derived_refs.push(json!({"source_id": object_id,
                    "source_node_id": component.node_id, "target_id": component.component_id,
                    "target_node_id": Uuid::nil(),
                    "ref_type": if component.follows_latest { "component-latest" } else { "component-fixed" },
                    "source_revision": revision}));
            }
            derived.insert(object_id, (validation.derived_text, revision));
        }
    }
    *array_mut(value, "text_blocks")? = blocks;
    let refs = array_mut(value, "references")?;
    refs.retain(|row| {
        row["ref_type"] != "asset"
            && row["ref_type"] != "entry-link"
            && row["ref_type"] != "component"
            && row["ref_type"] != "component-latest"
            && row["ref_type"] != "component-fixed"
    });
    refs.extend(derived_refs);
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
) -> Result<(Option<String>, Vec<PreparedImportAsset>, Vec<String>, usize), String> {
    let Some(json) = &package.object_layer_json else {
        return Ok((None, Vec::new(), Vec::new(), 0));
    };
    let mut value: Value =
        serde_json::from_str(json).map_err(|error| format!("解析对象层载荷失败：{error}"))?;
    remap_object_rows(&mut value, maps)?;
    let PreparedComponentDefinitions {
        valid_component_ids,
        asset_references,
        warnings,
        skipped,
    } = prepare_component_definitions(&mut value, new_project_id)?;
    rebuild_projections(
        &mut value,
        new_project_id,
        &valid_component_ids,
        asset_references,
    )?;
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
    Ok((Some(rewritten), files, warnings, skipped))
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
        let rewritten = rewrite_page_html_identities(&html, &maps).unwrap();
        assert_eq!(rewritten.matches(&format!("entry://{new}")).count(), 2);
        assert!(rewritten.contains(&format!("fc://self/entry/{new}")));
        assert!(rewritten.contains(&format!("data-note='entry://{old}'")));
        assert!(rewritten.contains(&format!("<!-- entry://{old} -->")));
        assert!(rewritten.contains(&format!(">entry://{old}<")));
    }
}
