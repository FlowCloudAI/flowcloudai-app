use super::*;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

mod object_layer;

const KNOWN_ASSET_KINDS: &[&str] = &[
    "project_cover",
    "entry_image",
    "entry_cover",
    "map_background",
];

#[derive(Debug, Clone)]
pub(super) enum FcworldPackageProgress {
    AddTotal {
        amount: usize,
        phase: &'static str,
        message: String,
    },
    Step {
        phase: &'static str,
        message: String,
    },
}

#[derive(Debug, Clone)]
pub(super) struct ValidatedFcworldPackage {
    pub manifest: FcworldManifest,
    pub csv_items: Vec<worldflow_core::CsvImportItem>,
    pub assets_index: FcworldAssetsIndex,
    pub asset_bytes_by_path: HashMap<String, Vec<u8>>,
    pub object_layer_json: Option<String>,
    pub page_asset_bytes_by_path: HashMap<String, Vec<u8>>,
    pub maps_json: String,
    pub history_files: Vec<PackageHistoryFile>,
    pub input_file_size: u64,
}

#[derive(Debug, Clone, Default)]
pub(super) struct ImportIdMaps {
    pub projects: HashMap<String, String>,
    pub categories: HashMap<String, String>,
    pub tag_schemas: HashMap<String, String>,
    pub entry_types: HashMap<String, String>,
    pub entries: HashMap<String, String>,
    pub entry_relations: HashMap<String, String>,
    pub entry_links: HashMap<String, String>,
    pub idea_notes: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub(super) struct PreparedImportAsset {
    pub target_path: PathBuf,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub(super) struct PreparedFcworldImport {
    pub package_id: String,
    pub source_project_id: String,
    pub new_project_id: Uuid,
    pub project_name: String,
    pub csv_items: Vec<worldflow_core::CsvImportItem>,
    pub object_layer_json: Option<String>,
    pub assets: Vec<PreparedImportAsset>,
    pub page_assets: Vec<PreparedImportAsset>,
    pub maps_json: String,
    pub history_files: Vec<PackageHistoryFile>,
    pub asset_count: usize,
    pub map_count: usize,
    pub input_file_size: u64,
    pub warnings: Vec<String>,
    #[cfg(test)]
    pub id_maps: ImportIdMaps,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct FcworldImportProgressEstimate {
    validation_units: usize,
    write_file_units: usize,
    import_row_units: usize,
}

impl FcworldImportProgressEstimate {
    pub(super) fn validation_total(self) -> usize {
        self.validation_units
    }

    pub(super) fn import_total(self, cleanup_units: usize) -> usize {
        self.validation_units
            .saturating_add(self.write_file_units)
            .saturating_add(self.import_row_units)
            .saturating_add(cleanup_units)
    }
}

fn validate_package_path(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("包内路径不能为空".to_string());
    }
    if path.contains('\\') {
        return Err(format!("包内路径不能包含反斜杠: {path}"));
    }
    if path.starts_with('/') || path.contains(':') {
        return Err(format!("包内路径不能是绝对路径: {path}"));
    }
    if path
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(format!("包内路径包含非法片段: {path}"));
    }
    Ok(())
}

pub(super) fn estimate_fcworld_import_progress(
    input_path: &Path,
    current_schema_version: u32,
) -> Result<FcworldImportProgressEstimate, String> {
    if !input_path.exists() {
        return Err(format!("导入文件不存在: {:?}", input_path));
    }
    if !input_path.is_file() {
        return Err(format!("导入路径不是文件: {:?}", input_path));
    }

    let file =
        File::open(input_path).map_err(|e| format!("打开导入文件失败 {:?}: {e}", input_path))?;
    let mut zip = ZipArchive::new(file).map_err(|e| format!("读取 fcworld zip 失败: {e}"))?;
    let zip_entry_units = zip.len();
    let manifest_json = read_zip_text(&mut zip, "manifest.json")?;
    let manifest = validate_manifest(&manifest_json, current_schema_version)?;
    let table_units = WorldflowCsvTable::ordered().len();
    let asset_units = manifest.contents.assets_index.count;
    let history_units = manifest
        .contents
        .history
        .as_ref()
        .map(|history| history.count)
        .unwrap_or(0);
    let import_row_units = manifest
        .contents
        .worldflow
        .tables
        .iter()
        .fold(0usize, |total, table| total.saturating_add(table.row_count));
    let validation_units = 1usize
        .saturating_add(zip_entry_units)
        .saturating_add(1)
        .saturating_add(table_units)
        .saturating_add(1)
        .saturating_add(asset_units)
        .saturating_add(1)
        .saturating_add(history_units);
    let write_file_units = asset_units.saturating_add(1).saturating_add(history_units);

    Ok(FcworldImportProgressEstimate {
        validation_units,
        write_file_units,
        import_row_units,
    })
}

fn validate_known_zip_entries_with_progress<F>(
    zip: &mut ZipArchive<File>,
    progress: &mut F,
) -> Result<HashSet<String>, String>
where
    F: FnMut(FcworldPackageProgress),
{
    progress(FcworldPackageProgress::AddTotal {
        amount: zip.len(),
        phase: "validate_zip",
        message: "检查导入包文件项".to_string(),
    });
    let mut names = HashSet::new();
    for index in 0..zip.len() {
        let file = zip
            .by_index(index)
            .map_err(|e| format!("读取 zip 文件项失败: {e}"))?;
        let name = file.name().to_string();
        validate_package_path(&name)?;
        if !names.insert(name.clone()) {
            return Err(format!("zip 包含重复文件项: {name}"));
        }
        let known = name == "manifest.json"
            || name == ASSETS_INDEX_PATH
            || name == MAPS_PATH
            || name == OBJECT_LAYER_PATH
            || name.starts_with("assets/page-document/")
            || name.starts_with(HISTORY_SNAPSHOTS_DIR)
            || name
                .strip_prefix(WORLD_DATA_DIR)
                .map(|file_name| {
                    WorldflowCsvTable::ordered()
                        .iter()
                        .any(|table| table.file_name() == file_name)
                })
                .unwrap_or(false)
            || name.starts_with("assets/images/");
        if !known {
            return Err(format!("zip 包含未知文件项: {name}"));
        }
        progress(FcworldPackageProgress::Step {
            phase: "validate_zip",
            message: format!("已检查文件项：{name}"),
        });
    }
    Ok(names)
}

fn read_zip_bytes(zip: &mut ZipArchive<File>, path: &str) -> Result<Vec<u8>, String> {
    let mut file = zip
        .by_name(path)
        .map_err(|e| format!("zip 缺少文件项 {path}: {e}"))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|e| format!("读取 zip 文件项失败 {path}: {e}"))?;
    Ok(bytes)
}

fn digest_to_hex(digest: impl AsRef<[u8]>) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = digest.as_ref();
    let mut output = String::with_capacity(digest.len() * 2);
    for &byte in digest {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn read_zip_asset_bytes_with_sha256(
    zip: &mut ZipArchive<File>,
    path: &str,
    expected_size: u64,
) -> Result<(Vec<u8>, String), String> {
    let mut file = zip
        .by_name(path)
        .map_err(|e| format!("zip 缺少文件项 {path}: {e}"))?;
    if file.size() != expected_size {
        return Err(format!("资源大小不匹配: {path}"));
    }

    // 防解压/容量炸弹：expected_size 来自不可信 manifest，封顶后再预分配，
    // 否则一个声明 20GB 的条目会触发超大分配 → OOM，在 panic="abort" 下直接杀进程。
    const MAX_ASSET_BYTES: u64 = 128 * 1024 * 1024;
    if expected_size > MAX_ASSET_BYTES {
        return Err(format!(
            "资源过大（{expected_size} 字节，超过 {MAX_ASSET_BYTES} 字节上限）: {path}"
        ));
    }

    let mut bytes = Vec::with_capacity(usize::try_from(expected_size).unwrap_or(0));
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("读取 zip 文件项失败 {path}: {e}"))?;
        if read == 0 {
            break;
        }
        let chunk = &buffer[..read];
        hasher.update(chunk);
        bytes.extend_from_slice(chunk);
    }

    Ok((bytes, digest_to_hex(hasher.finalize())))
}

fn read_zip_text(zip: &mut ZipArchive<File>, path: &str) -> Result<String, String> {
    let bytes = read_zip_bytes(zip, path)?;
    String::from_utf8(bytes).map_err(|e| format!("zip 文件项不是 UTF-8 {path}: {e}"))
}

fn table_from_name(name: &str) -> Option<WorldflowCsvTable> {
    WorldflowCsvTable::ordered()
        .iter()
        .copied()
        .find(|table| table_name(*table) == name)
}

fn csv_data_row_count(table: WorldflowCsvTable, content: &str) -> Result<usize, String> {
    if content.trim().is_empty() {
        return Ok(0);
    }

    let mut reader = csv::Reader::from_reader(content.as_bytes());
    let mut count = 0usize;
    for record in reader.records() {
        record.map_err(|e| format!("解析 {} 失败: {e}", table.file_name()))?;
        count += 1;
    }
    Ok(count)
}

/// 允许导入的最旧 worldflow schema 版本。
/// 仅用于校验**没有** `bundleFormatVersion` 字段的旧版本包；新包的兼容性
/// 以 CSV 交换格式版本为准，schema_version 降级为纯诊断信息。
/// （v6→v7 的 0007 仅重建 FTS 触发器，包格式逐字节一致。）
const MIN_COMPATIBLE_SCHEMA_VERSION: u32 = 6;

/// 允许导入的最旧 CSV 交换格式版本。当前只有 v1；将来格式变化时在
/// `validate_bundle_format_version` 中为旧版本挂 per-version 升级器，
/// 只有确实无法升级的版本才抬高此下限。
const MIN_COMPATIBLE_BUNDLE_FORMAT_VERSION: u32 = 1;

fn validate_schema_version(
    label: &str,
    package_version: u32,
    current_schema_version: u32,
) -> Result<(), String> {
    if package_version > current_schema_version {
        return Err(format!(
            "{label}: 包内 {package_version} 高于当前 {current_schema_version}，请升级应用后再导入"
        ));
    }
    if package_version < MIN_COMPATIBLE_SCHEMA_VERSION {
        return Err(format!(
            "{label}: 包内 {package_version} 低于最低兼容版本 {MIN_COMPATIBLE_SCHEMA_VERSION}"
        ));
    }
    Ok(())
}

fn validate_bundle_format_version(package_version: u32) -> Result<(), String> {
    if package_version > worldflow_core::CSV_BUNDLE_FORMAT_VERSION {
        return Err(format!(
            "CSV 交换格式版本过新: 包内 {package_version}，当前支持 {}，请升级应用后再导入",
            worldflow_core::CSV_BUNDLE_FORMAT_VERSION
        ));
    }
    if package_version < MIN_COMPATIBLE_BUNDLE_FORMAT_VERSION {
        return Err(format!(
            "CSV 交换格式版本过旧: 包内 {package_version}，最低兼容 {MIN_COMPATIBLE_BUNDLE_FORMAT_VERSION}"
        ));
    }
    Ok(())
}

fn validate_manifest(
    manifest_json: &str,
    current_schema_version: u32,
) -> Result<FcworldManifest, String> {
    let manifest = serde_json::from_str::<FcworldManifest>(manifest_json)
        .map_err(|e| format!("解析 manifest.json 失败: {e}"))?;
    if manifest.format != FCWORLD_FORMAT {
        return Err(format!("不支持的 fcworld 格式: {}", manifest.format));
    }
    if !matches!(
        manifest.format_version,
        FCWORLD_FORMAT_VERSION | FCWORLD_OBJECT_FORMAT_VERSION
    ) {
        return Err(format!(
            "不支持的 fcworld 版本: {}",
            manifest.format_version
        ));
    }
    if (manifest.format_version == FCWORLD_OBJECT_FORMAT_VERSION)
        != manifest.contents.object_layer.is_some()
    {
        return Err("世界包版本与对象层载荷声明不一致".to_string());
    }
    if let Some(layer) = &manifest.contents.object_layer {
        if layer.path != OBJECT_LAYER_PATH {
            return Err(format!("对象层载荷路径不匹配: {}", layer.path));
        }
    }
    match manifest.contents.worldflow.bundle_format_version {
        // 新包：CSV 交换格式版本是唯一兼容性契约，schema_version 仅作诊断。
        Some(bundle_version) => validate_bundle_format_version(bundle_version)?,
        // 旧包（无该字段）：回退到 schema_version 区间校验。
        None => {
            validate_schema_version(
                "worldflow schema 版本不兼容",
                manifest.generator.worldflow_schema_version,
                current_schema_version,
            )?;
            validate_schema_version(
                "CSV schema 版本不兼容",
                manifest.contents.worldflow.schema_version,
                current_schema_version,
            )?;
        }
    }
    if manifest.contents.worldflow.path != WORLD_DATA_DIR {
        return Err(format!(
            "worldflow 数据目录不匹配: {}",
            manifest.contents.worldflow.path
        ));
    }
    if manifest.contents.assets_index.path != ASSETS_INDEX_PATH {
        return Err(format!(
            "资源索引路径不匹配: {}",
            manifest.contents.assets_index.path
        ));
    }
    if manifest.contents.maps.path != MAPS_PATH {
        return Err(format!("地图路径不匹配: {}", manifest.contents.maps.path));
    }
    if let Some(history) = &manifest.contents.history {
        if history.path != HISTORY_SNAPSHOTS_DIR {
            return Err(format!("历史路径不匹配: {}", history.path));
        }
    }
    if manifest.contents.worldflow.tables.len() != WorldflowCsvTable::ordered().len() {
        return Err("CSV 表数量不匹配".to_string());
    }
    Ok(manifest)
}

fn validate_csv_items_with_progress_inner<F>(
    zip: &mut ZipArchive<File>,
    manifest: &FcworldManifest,
    progress: &mut F,
) -> Result<Vec<worldflow_core::CsvImportItem>, String>
where
    F: FnMut(FcworldPackageProgress),
{
    progress(FcworldPackageProgress::AddTotal {
        amount: WorldflowCsvTable::ordered().len(),
        phase: "validate_csv",
        message: "校验 CSV 数据表".to_string(),
    });
    let mut items = Vec::with_capacity(WorldflowCsvTable::ordered().len());
    for (index, expected_table) in WorldflowCsvTable::ordered().iter().copied().enumerate() {
        let table_manifest = manifest
            .contents
            .worldflow
            .tables
            .get(index)
            .ok_or_else(|| format!("manifest 缺少 CSV 表索引: {index}"))?;
        let table = table_from_name(&table_manifest.name)
            .ok_or_else(|| format!("manifest 包含未知 CSV 表: {}", table_manifest.name))?;
        if table != expected_table {
            return Err(format!(
                "CSV 表顺序不匹配: 第 {} 项为 {}",
                index + 1,
                table_manifest.name
            ));
        }
        let expected_path = format!("{WORLD_DATA_DIR}{}", expected_table.file_name());
        if table_manifest.path != expected_path {
            return Err(format!(
                "CSV 路径不匹配: {} 应为 {}",
                table_manifest.path, expected_path
            ));
        }

        let content = read_zip_text(zip, &expected_path)?;
        let sha256 = sha256_hex(content.as_bytes());
        if sha256 != table_manifest.sha256 {
            return Err(format!("CSV 摘要不匹配: {expected_path}"));
        }
        let row_count = csv_data_row_count(expected_table, &content)?;
        if row_count != table_manifest.row_count {
            return Err(format!(
                "CSV 行数不匹配: {expected_path} manifest={} actual={row_count}",
                table_manifest.row_count
            ));
        }
        items.push(worldflow_core::CsvImportItem {
            table: expected_table,
            file_name: expected_table.file_name().to_string(),
            content,
        });
        progress(FcworldPackageProgress::Step {
            phase: "validate_csv",
            message: format!("已校验 CSV：{}", expected_table.file_name()),
        });
    }
    Ok(items)
}

fn validate_assets_index_with_progress_inner<F>(
    zip: &mut ZipArchive<File>,
    zip_names: &HashSet<String>,
    manifest: &FcworldManifest,
    progress: &mut F,
) -> Result<(FcworldAssetsIndex, HashMap<String, Vec<u8>>), String>
where
    F: FnMut(FcworldPackageProgress),
{
    progress(FcworldPackageProgress::AddTotal {
        amount: 1,
        phase: "validate_assets",
        message: "读取资源索引".to_string(),
    });
    let assets_index_json = read_zip_text(zip, ASSETS_INDEX_PATH)?;
    let assets_sha = sha256_hex(assets_index_json.as_bytes());
    if assets_sha != manifest.contents.assets_index.sha256 {
        return Err("assets/index.json 摘要不匹配".to_string());
    }
    let assets_index = serde_json::from_str::<FcworldAssetsIndex>(&assets_index_json)
        .map_err(|e| format!("解析 assets/index.json 失败: {e}"))?;
    if assets_index.version != 1 {
        return Err(format!("不支持的资源索引版本: {}", assets_index.version));
    }
    if assets_index.assets.len() != manifest.contents.assets_index.count {
        return Err(format!(
            "资源数量不匹配: manifest={} actual={}",
            manifest.contents.assets_index.count,
            assets_index.assets.len()
        ));
    }
    progress(FcworldPackageProgress::Step {
        phase: "validate_assets",
        message: "已校验资源索引".to_string(),
    });
    progress(FcworldPackageProgress::AddTotal {
        amount: assets_index.assets.len(),
        phase: "validate_assets",
        message: "校验资源文件".to_string(),
    });

    let mut asset_ids = HashSet::new();
    let mut asset_paths = HashSet::new();
    let mut bytes_by_path = HashMap::new();

    for asset in &assets_index.assets {
        if !asset_ids.insert(asset.id.clone()) {
            return Err(format!("资源 ID 重复: {}", asset.id));
        }
        if !KNOWN_ASSET_KINDS.contains(&asset.kind.as_str()) {
            return Err(format!("未知资源类型: {}", asset.kind));
        }
        validate_package_path(&asset.path)?;
        if !asset.path.starts_with("assets/images/") {
            return Err(format!("资源路径必须位于 assets/images/: {}", asset.path));
        }
        if !asset_paths.insert(asset.path.clone()) {
            return Err(format!("资源路径重复: {}", asset.path));
        }

        let (bytes, sha256) = read_zip_asset_bytes_with_sha256(zip, &asset.path, asset.size)?;
        let size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
        if size != asset.size {
            return Err(format!("资源大小不匹配: {}", asset.path));
        }
        if sha256 != asset.sha256 {
            return Err(format!("资源摘要不匹配: {}", asset.path));
        }
        let guessed_mime = mime_guess::from_path(&asset.path)
            .first_or_octet_stream()
            .to_string();
        if guessed_mime != asset.mime {
            return Err(format!(
                "资源 MIME 不匹配: {} manifest={} actual={guessed_mime}",
                asset.path, asset.mime
            ));
        }
        bytes_by_path.insert(asset.path.clone(), bytes);
        progress(FcworldPackageProgress::Step {
            phase: "validate_assets",
            message: format!("已校验资源：{}", asset.path),
        });
    }

    for name in zip_names
        .iter()
        .filter(|name| name.starts_with("assets/images/"))
    {
        if !asset_paths.contains(name) {
            return Err(format!("zip 包含未登记资源: {name}"));
        }
    }

    Ok((assets_index, bytes_by_path))
}

fn validate_maps_json_with_progress_inner<F>(
    zip: &mut ZipArchive<File>,
    manifest: &FcworldManifest,
    progress: &mut F,
) -> Result<String, String>
where
    F: FnMut(FcworldPackageProgress),
{
    progress(FcworldPackageProgress::AddTotal {
        amount: 1,
        phase: "validate_maps",
        message: "校验地图数据".to_string(),
    });
    let maps_json = read_zip_text(zip, MAPS_PATH)?;
    let maps_sha = sha256_hex(maps_json.as_bytes());
    if maps_sha != manifest.contents.maps.sha256 {
        return Err("maps/maps.json 摘要不匹配".to_string());
    }
    let maps_value = serde_json::from_str::<Value>(&maps_json)
        .map_err(|e| format!("解析 maps/maps.json 失败: {e}"))?;
    let maps = maps_value
        .get("maps")
        .and_then(Value::as_array)
        .ok_or_else(|| "maps/maps.json 缺少 maps 数组".to_string())?;
    if maps.len() != manifest.contents.maps.count {
        return Err(format!(
            "地图数量不匹配: manifest={} actual={}",
            manifest.contents.maps.count,
            maps.len()
        ));
    }
    progress(FcworldPackageProgress::Step {
        phase: "validate_maps",
        message: "已校验地图数据".to_string(),
    });
    Ok(maps_json)
}

fn validate_object_layer_in_package(
    zip: &mut ZipArchive<File>,
    zip_names: &HashSet<String>,
    manifest: &FcworldManifest,
) -> Result<(Option<String>, HashMap<String, Vec<u8>>), String> {
    let Some(declaration) = &manifest.contents.object_layer else {
        if zip_names.contains(OBJECT_LAYER_PATH)
            || zip_names
                .iter()
                .any(|name| name.starts_with("assets/page-document/"))
        {
            return Err("旧版世界包包含未声明的页面文档载荷".into());
        }
        return Ok((None, HashMap::new()));
    };
    let file = zip
        .by_name(OBJECT_LAYER_PATH)
        .map_err(|error| format!("世界包缺少对象层载荷：{error}"))?;
    const MAX_OBJECT_LAYER_BYTES: u64 = 64 * 1024 * 1024;
    if file.size() > MAX_OBJECT_LAYER_BYTES {
        return Err("对象层载荷超过 64 MiB".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_OBJECT_LAYER_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("读取对象层载荷失败：{error}"))?;
    if bytes.len() as u64 > MAX_OBJECT_LAYER_BYTES {
        return Err("对象层载荷超过 64 MiB".into());
    }
    let json =
        String::from_utf8(bytes).map_err(|error| format!("对象层载荷不是 UTF-8：{error}"))?;
    if sha256_hex(json.as_bytes()) != declaration.sha256 {
        return Err("页面文档对象层载荷摘要不匹配".into());
    }
    let value: Value =
        serde_json::from_str(&json).map_err(|error| format!("页面文档对象层载荷无效：{error}"))?;
    if value["version"].as_u64() != Some(2) {
        return Err("不支持的页面文档对象层载荷版本".into());
    }
    let assets = value["assets"]
        .as_array()
        .ok_or("页面文档对象层载荷缺少资产表")?;
    if assets.len() != declaration.count {
        return Err("页面文档资产数量与 manifest 不一致".into());
    }
    let mut bytes_by_path = HashMap::new();
    let mut ids = HashSet::new();
    for asset in assets {
        let id = asset["id"].as_str().ok_or("页面资产缺少 ID")?;
        let id = Uuid::parse_str(id).map_err(|_| "页面资产 ID 无效")?;
        if !ids.insert(id) {
            return Err(format!("页面资产 ID 重复：{id}"));
        }
        let media = asset["media_type"].as_str().ok_or("页面资产缺少媒体类型")?;
        let extension = match media {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            _ => return Err(format!("页面资产类型不受支持：{media}")),
        };
        let path = format!("assets/page-document/{id}.{extension}");
        let size = asset["size_bytes"].as_i64().ok_or("页面资产缺少大小")?;
        let sha256 = asset["sha256"].as_str().ok_or("页面资产缺少摘要")?;
        let width = asset["width"].as_i64().ok_or("页面资产缺少宽度")?;
        let height = asset["height"].as_i64().ok_or("页面资产缺少高度")?;
        let (bytes, hash) = read_zip_asset_bytes_with_sha256(
            zip,
            &path,
            size.try_into().map_err(|_| "页面资产大小无效")?,
        )?;
        if hash != sha256 {
            return Err(format!("页面资产摘要不匹配：{id}"));
        }
        crate::page_document_assets::validate_packaged_asset(
            &bytes, media, size, sha256, width, height,
        )
        .map_err(|error| format!("页面资产独立校验失败 {id}：{error}"))?;
        bytes_by_path.insert(path, bytes);
    }
    for name in zip_names
        .iter()
        .filter(|name| name.starts_with("assets/page-document/"))
    {
        if !bytes_by_path.contains_key(name) {
            return Err(format!("世界包含未登记页面资产：{name}"));
        }
    }
    Ok((Some(json), bytes_by_path))
}

fn validate_history_files_with_progress_inner<F>(
    zip: &mut ZipArchive<File>,
    zip_names: &HashSet<String>,
    manifest: &FcworldManifest,
    progress: &mut F,
) -> Result<Vec<PackageHistoryFile>, String>
where
    F: FnMut(FcworldPackageProgress),
{
    let mut names = zip_names
        .iter()
        .filter(|name| name.starts_with(HISTORY_SNAPSHOTS_DIR))
        .cloned()
        .collect::<Vec<_>>();
    names.sort();

    let Some(history_manifest) = &manifest.contents.history else {
        if names.is_empty() {
            return Ok(Vec::new());
        }
        return Err("zip 包含未声明的历史文件".to_string());
    };

    if names.len() != history_manifest.count {
        return Err(format!(
            "历史文件数量不匹配: manifest={} actual={}",
            history_manifest.count,
            names.len()
        ));
    }

    progress(FcworldPackageProgress::AddTotal {
        amount: names.len(),
        phase: "validate_history",
        message: "校验历史文件".to_string(),
    });

    let mut files = Vec::with_capacity(names.len());
    for name in names {
        let bytes = read_zip_bytes(zip, &name)?;
        files.push(PackageHistoryFile {
            path: name.clone(),
            bytes,
        });
        progress(FcworldPackageProgress::Step {
            phase: "validate_history",
            message: format!("已校验历史文件：{name}"),
        });
    }

    let sha256 = sha256_history_files(&files);
    if sha256 != history_manifest.sha256 {
        return Err("历史文件摘要不匹配".to_string());
    }

    Ok(files)
}

#[cfg(test)]
pub(super) fn read_and_validate_fcworld_package(
    input_path: &Path,
    current_schema_version: u32,
) -> Result<ValidatedFcworldPackage, String> {
    read_and_validate_fcworld_package_with_progress(input_path, current_schema_version, |_| {})
}

pub(super) fn read_and_validate_fcworld_package_with_progress<F>(
    input_path: &Path,
    current_schema_version: u32,
    mut progress: F,
) -> Result<ValidatedFcworldPackage, String>
where
    F: FnMut(FcworldPackageProgress),
{
    if !input_path.exists() {
        return Err(format!("导入文件不存在: {:?}", input_path));
    }
    if !input_path.is_file() {
        return Err(format!("导入路径不是文件: {:?}", input_path));
    }

    let input_file_size = std::fs::metadata(input_path)
        .map_err(|e| format!("读取导入文件信息失败 {:?}: {e}", input_path))?
        .len();
    let file =
        File::open(input_path).map_err(|e| format!("打开导入文件失败 {:?}: {e}", input_path))?;
    let mut zip = ZipArchive::new(file).map_err(|e| format!("读取 fcworld zip 失败: {e}"))?;
    progress(FcworldPackageProgress::AddTotal {
        amount: 1,
        phase: "validate_open",
        message: "读取导入包".to_string(),
    });
    progress(FcworldPackageProgress::Step {
        phase: "validate_open",
        message: "已读取导入包".to_string(),
    });
    let zip_names = validate_known_zip_entries_with_progress(&mut zip, &mut progress)?;

    progress(FcworldPackageProgress::AddTotal {
        amount: 1,
        phase: "validate_manifest",
        message: "校验 manifest".to_string(),
    });
    let manifest_json = read_zip_text(&mut zip, "manifest.json")?;
    let manifest = validate_manifest(&manifest_json, current_schema_version)?;
    progress(FcworldPackageProgress::Step {
        phase: "validate_manifest",
        message: "已校验 manifest".to_string(),
    });
    let csv_items = validate_csv_items_with_progress_inner(&mut zip, &manifest, &mut progress)?;
    let (assets_index, asset_bytes_by_path) =
        validate_assets_index_with_progress_inner(&mut zip, &zip_names, &manifest, &mut progress)?;
    let maps_json = validate_maps_json_with_progress_inner(&mut zip, &manifest, &mut progress)?;
    let (object_layer_json, page_asset_bytes_by_path) =
        validate_object_layer_in_package(&mut zip, &zip_names, &manifest)?;
    let history_files =
        validate_history_files_with_progress_inner(&mut zip, &zip_names, &manifest, &mut progress)?;

    Ok(ValidatedFcworldPackage {
        manifest,
        csv_items,
        assets_index,
        asset_bytes_by_path,
        object_layer_json,
        page_asset_bytes_by_path,
        maps_json,
        history_files,
        input_file_size,
    })
}

fn csv_item_content(
    items: &[worldflow_core::CsvImportItem],
    table: WorldflowCsvTable,
) -> Result<&str, String> {
    items
        .iter()
        .find(|item| item.table == table)
        .map(|item| item.content.as_str())
        .ok_or_else(|| format!("缺少 CSV 表: {:?}", table))
}

fn read_csv_rows(
    content: &str,
    context: &str,
) -> Result<Option<(StringRecord, Vec<Vec<String>>)>, String> {
    if content.trim().is_empty() {
        return Ok(None);
    }
    let mut reader = csv::Reader::from_reader(content.as_bytes());
    let headers = reader
        .headers()
        .map_err(|e| format!("读取 {context} 表头失败: {e}"))?
        .clone();
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|e| format!("读取 {context} 记录失败: {e}"))?;
        rows.push(record.iter().map(|value| value.to_string()).collect());
    }
    Ok(Some((headers, rows)))
}

fn set_field(row: &mut [String], index: usize, value: String, context: &str) -> Result<(), String> {
    let field = row
        .get_mut(index)
        .ok_or_else(|| format!("{context} 记录字段数量不足"))?;
    *field = value;
    Ok(())
}

fn required_mapped_id(
    map: &HashMap<String, String>,
    old_id: &str,
    context: &str,
) -> Result<String, String> {
    map.get(old_id)
        .cloned()
        .ok_or_else(|| format!("{context} 引用了未导入的 ID: {old_id}"))
}

fn optional_mapped_id(
    map: &HashMap<String, String>,
    old_id: &str,
    context: &str,
) -> Result<String, String> {
    if old_id.trim().is_empty() {
        return Ok(String::new());
    }
    required_mapped_id(map, old_id, context)
}

fn collect_id_map(
    items: &[worldflow_core::CsvImportItem],
    table: WorldflowCsvTable,
) -> Result<HashMap<String, String>, String> {
    let content = csv_item_content(items, table)?;
    let Some((headers, rows)) = read_csv_rows(content, table.file_name())? else {
        return Ok(HashMap::new());
    };
    let id_index = header_index(&headers, "id")?;
    let mut map = HashMap::new();
    for row in rows {
        let old_id = row
            .get(id_index)
            .ok_or_else(|| format!("{} 记录缺少 id", table.file_name()))?
            .to_string();
        if old_id.trim().is_empty() {
            return Err(format!("{} 存在空 id", table.file_name()));
        }
        if map.insert(old_id.clone(), old_id.clone()).is_some() {
            return Err(format!("{} 存在重复 id: {old_id}", table.file_name()));
        }
    }
    Ok(map)
}

fn collect_import_id_maps(
    package: &ValidatedFcworldPackage,
    new_project_id: Uuid,
) -> Result<ImportIdMaps, String> {
    let mut projects = collect_id_map(&package.csv_items, WorldflowCsvTable::Projects)?;
    if projects.len() != 1 {
        return Err(format!(
            "projects.csv 必须包含 1 个项目，实际 {}",
            projects.len()
        ));
    }
    if let Some(value) = projects.values_mut().next() {
        *value = new_project_id.to_string();
    }

    let fresh = |table| -> Result<HashMap<String, String>, String> {
        let mut ids = collect_id_map(&package.csv_items, table)?;
        for mapped in ids.values_mut() {
            *mapped = Uuid::now_v7().to_string();
        }
        Ok(ids)
    };
    Ok(ImportIdMaps {
        projects,
        categories: fresh(WorldflowCsvTable::Categories)?,
        tag_schemas: fresh(WorldflowCsvTable::TagSchemas)?,
        entry_types: fresh(WorldflowCsvTable::EntryTypes)?,
        entries: fresh(WorldflowCsvTable::Entries)?,
        entry_relations: fresh(WorldflowCsvTable::EntryRelations)?,
        entry_links: fresh(WorldflowCsvTable::EntryLinks)?,
        idea_notes: fresh(WorldflowCsvTable::IdeaNotes)?,
    })
}

fn sanitize_asset_file_stem(asset_id: &str) -> Result<String, String> {
    let stem = asset_id.trim();
    if stem.is_empty()
        || !stem
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(format!("资源 ID 不能作为文件名: {asset_id}"));
    }
    Ok(stem.to_string())
}

fn imported_asset_file_name(asset: &FcworldAsset) -> Result<String, String> {
    let stem = sanitize_asset_file_stem(&asset.id)?;
    let extension = clean_extension_from_path(Path::new(&asset.path))
        .unwrap_or_else(|| extension_from_mime(&asset.mime).to_string());
    Ok(format!("{stem}.{extension}"))
}

pub(super) fn import_images_dir(paths: &PathsState, project_id: &Uuid) -> Result<PathBuf, String> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(db_dir.join("images").join(project_id.to_string()))
}

fn prepare_import_assets(
    package: &ValidatedFcworldPackage,
    paths: &PathsState,
    project_id: &Uuid,
) -> Result<(Vec<PreparedImportAsset>, HashMap<String, PathBuf>), String> {
    let target_dir = import_images_dir(paths, project_id)?;
    let mut prepared = Vec::with_capacity(package.assets_index.assets.len());
    let mut by_package_path = HashMap::new();

    for asset in &package.assets_index.assets {
        let bytes = package
            .asset_bytes_by_path
            .get(&asset.path)
            .cloned()
            .ok_or_else(|| format!("资源内容缺失: {}", asset.path))?;
        let target_path = target_dir.join(imported_asset_file_name(asset)?);
        by_package_path.insert(asset.path.clone(), target_path.clone());
        prepared.push(PreparedImportAsset { target_path, bytes });
    }

    Ok((prepared, by_package_path))
}

fn target_path_for_package_asset(
    asset_targets: &HashMap<String, PathBuf>,
    package_path: &str,
    context: &str,
) -> Result<String, String> {
    asset_targets
        .get(package_path)
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| format!("{context} 引用了未登记资源: {package_path}"))
}

fn rewrite_csv_asset_opt_string(
    raw: &str,
    asset_targets: &HashMap<String, PathBuf>,
    context: &str,
) -> Result<String, String> {
    let value = decode_csv_opt_string(raw)?;
    let Some(path) = value.filter(|path| !path.trim().is_empty()) else {
        return encode_csv_opt_string(None);
    };
    let target = target_path_for_package_asset(asset_targets, &path, context)?;
    encode_csv_opt_string(Some(&target))
}

fn rewrite_entry_images_json_for_import(
    raw: &str,
    entry_id: &str,
    asset_targets: &HashMap<String, PathBuf>,
) -> Result<String, String> {
    if raw.trim().is_empty() {
        return Ok(raw.to_string());
    }
    let mut value = serde_json::from_str::<Value>(raw)
        .map_err(|e| format!("解析 entries.images JSON 失败 entry_id={entry_id}: {e}"))?;
    let images = value
        .as_array_mut()
        .ok_or_else(|| format!("entries.images 不是数组 entry_id={entry_id}"))?;
    for image in images {
        let Some(object) = image.as_object_mut() else {
            continue;
        };
        let Some(path) = object.get("path").and_then(Value::as_str) else {
            continue;
        };
        if path.trim().is_empty() {
            continue;
        }
        let target = target_path_for_package_asset(asset_targets, path, "entries.images")?;
        object.insert("path".to_string(), Value::String(target));
    }
    serde_json::to_string(&value)
        .map_err(|e| format!("序列化 entries.images JSON 失败 entry_id={entry_id}: {e}"))
}

fn rewrite_entry_tags_json(
    raw: &str,
    id_maps: &ImportIdMaps,
    entry_id: &str,
) -> Result<String, String> {
    if raw.trim().is_empty() {
        return Ok(raw.to_string());
    }
    let mut value = serde_json::from_str::<Value>(raw)
        .map_err(|e| format!("解析 entries.tags JSON 失败 entry_id={entry_id}: {e}"))?;
    let tags = value
        .as_array_mut()
        .ok_or_else(|| format!("entries.tags 不是数组 entry_id={entry_id}"))?;
    for tag in tags {
        let Some(object) = tag.as_object_mut() else {
            continue;
        };
        let Some(schema_id) = object.get("schema_id").and_then(Value::as_str) else {
            continue;
        };
        let mapped = required_mapped_id(&id_maps.tag_schemas, schema_id, "entries.tags.schema_id")?;
        object.insert("schema_id".to_string(), Value::String(mapped));
    }
    serde_json::to_string(&value)
        .map_err(|e| format!("序列化 entries.tags JSON 失败 entry_id={entry_id}: {e}"))
}

fn is_entry_href_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '%' || ch == '/'
}

fn file_name_from_path(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .next_back()
        .map(|value| value.to_string())
}

fn file_stem_from_name(file_name: &str) -> Option<String> {
    let stem = Path::new(file_name).file_stem()?.to_str()?.trim();
    if stem.is_empty() {
        None
    } else {
        Some(stem.to_string())
    }
}

fn insert_fcimg_ref_candidates(map: &mut HashMap<String, String>, path: &str, target_ref: &str) {
    let Some(file_name) = file_name_from_path(path) else {
        return;
    };
    if let Some(stem) = file_stem_from_name(&file_name) {
        map.insert(stem.to_ascii_lowercase(), target_ref.to_string());
    }
    map.insert(file_name.to_ascii_lowercase(), target_ref.to_string());
}

fn is_fcimg_ref_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '%' || ch == '.' || ch == '/'
}

fn rewrite_fcimg_refs(
    content: &str,
    image_ref_map: &HashMap<String, String>,
    project_map: &HashMap<String, String>,
) -> Result<String, String> {
    let with_fcimg = rewrite_legacy_fcimg_refs(content, image_ref_map)?;
    rewrite_fc_image_refs(&with_fcimg, image_ref_map, project_map)
}

fn rewrite_legacy_fcimg_refs(
    content: &str,
    image_ref_map: &HashMap<String, String>,
) -> Result<String, String> {
    if image_ref_map.is_empty() || !content.contains("fcimg:") {
        return Ok(content.to_string());
    }

    let mut output = String::with_capacity(content.len());
    let mut cursor = 0usize;
    while let Some(offset) = content[cursor..].find("fcimg:") {
        let prefix_start = cursor + offset;
        let value_start = prefix_start + "fcimg:".len();
        output.push_str(&content[cursor..value_start]);

        let mut value_end = value_start;
        for (relative, ch) in content[value_start..].char_indices() {
            if is_fcimg_ref_char(ch) {
                value_end = value_start + relative + ch.len_utf8();
            } else {
                break;
            }
        }

        if value_end == value_start {
            cursor = value_start;
            continue;
        }

        let encoded = &content[value_start..value_end];
        let decoded = urlencoding::decode(encoded)
            .map_err(|e| format!("解析 fcimg 引用失败: {e}"))?
            .trim_start_matches('/')
            .to_string();
        if let Some(mapped) = image_ref_map.get(&decoded.to_ascii_lowercase()) {
            output.push_str(mapped);
        } else {
            output.push_str(encoded);
        }
        cursor = value_end;
    }
    output.push_str(&content[cursor..]);
    Ok(output)
}

fn rewrite_fc_image_refs(
    content: &str,
    image_ref_map: &HashMap<String, String>,
    project_map: &HashMap<String, String>,
) -> Result<String, String> {
    if image_ref_map.is_empty() || !content.contains("fc://") {
        return Ok(content.to_string());
    }

    let mut output = String::with_capacity(content.len());
    let mut cursor = 0usize;
    while let Some(offset) = content[cursor..].find("fc://") {
        let prefix_start = cursor + offset;
        let value_start = prefix_start + "fc://".len();
        output.push_str(&content[cursor..value_start]);

        let mut value_end = value_start;
        for (relative, ch) in content[value_start..].char_indices() {
            if is_fcimg_ref_char(ch) {
                value_end = value_start + relative + ch.len_utf8();
            } else {
                break;
            }
        }

        if value_end == value_start {
            cursor = value_start;
            continue;
        }

        let encoded = &content[value_start..value_end];
        let parts = encoded.split('/').collect::<Vec<_>>();
        if parts.len() == 3 && parts[1] == "image" {
            let project_id = urlencoding::decode(parts[0])
                .map_err(|e| format!("解析 fc 图片项目引用失败: {e}"))?
                .to_string();
            let image_id = urlencoding::decode(parts[2])
                .map_err(|e| format!("解析 fc 图片引用失败: {e}"))?
                .to_string();
            if let Some(mapped_image) = image_ref_map.get(&image_id.to_ascii_lowercase()) {
                let project_ref = if project_map.contains_key(&project_id) {
                    "self"
                } else {
                    parts[0]
                };
                output.push_str(project_ref);
                output.push_str("/image/");
                output.push_str(mapped_image);
            } else {
                output.push_str(encoded);
            }
        } else {
            output.push_str(encoded);
        }
        cursor = value_end;
    }
    output.push_str(&content[cursor..]);
    Ok(output)
}

fn build_import_fcimg_ref_map(
    package: &ValidatedFcworldPackage,
    asset_targets: &HashMap<String, PathBuf>,
) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for asset in &package.assets_index.assets {
        let Some(target_path) = asset_targets.get(&asset.path) else {
            continue;
        };
        let Some(target_ref) = target_path
            .file_stem()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string())
        else {
            continue;
        };
        map.insert(asset.id.to_ascii_lowercase(), target_ref.clone());
        insert_fcimg_ref_candidates(&mut map, &asset.path, &target_ref);
        if let Some(original_name) = &asset.original_name {
            insert_fcimg_ref_candidates(&mut map, original_name, &target_ref);
        }
    }
    map
}

fn rewrite_entry_hrefs(content: &str, id_maps: &ImportIdMaps) -> Result<String, String> {
    let with_fc = rewrite_fc_hrefs(content, id_maps)?;
    rewrite_legacy_entry_hrefs(&with_fc, id_maps)
}

fn rewrite_fc_hrefs(content: &str, id_maps: &ImportIdMaps) -> Result<String, String> {
    if !content.contains("fc://") {
        return Ok(content.to_string());
    }

    let mut output = String::with_capacity(content.len());
    let mut cursor = 0usize;
    while let Some(offset) = content[cursor..].find("fc://") {
        let prefix_start = cursor + offset;
        let value_start = prefix_start + "fc://".len();
        output.push_str(&content[cursor..value_start]);

        let mut value_end = value_start;
        for (relative, ch) in content[value_start..].char_indices() {
            if is_fcimg_ref_char(ch) {
                value_end = value_start + relative + ch.len_utf8();
            } else {
                break;
            }
        }

        if value_end == value_start {
            cursor = value_start;
            continue;
        }

        let encoded = &content[value_start..value_end];
        let parts = encoded.split('/').collect::<Vec<_>>();
        if parts.len() == 1 {
            let project_id = urlencoding::decode(parts[0])
                .map_err(|e| format!("解析 fc 项目链接失败: {e}"))?
                .to_string();
            if id_maps.projects.contains_key(&project_id) {
                output.push_str("self");
            } else {
                output.push_str(parts[0]);
            }
        } else if parts.len() == 3 && parts[1] == "entry" {
            let project_id = urlencoding::decode(parts[0])
                .map_err(|e| format!("解析 fc 词条项目链接失败: {e}"))?
                .to_string();
            let entry_id = urlencoding::decode(parts[2])
                .map_err(|e| format!("解析 fc 词条链接失败: {e}"))?
                .to_string();
            if project_id == "self" || id_maps.projects.contains_key(&project_id) {
                let mapped_entry =
                    required_mapped_id(&id_maps.entries, &entry_id, "entries.content fc entry")?;
                output.push_str("self");
                output.push_str("/entry/");
                output.push_str(&mapped_entry);
            } else {
                output.push_str(encoded);
            }
        } else {
            output.push_str(encoded);
        }
        cursor = value_end;
    }
    output.push_str(&content[cursor..]);
    Ok(output)
}

fn rewrite_legacy_entry_hrefs(content: &str, id_maps: &ImportIdMaps) -> Result<String, String> {
    let mut output = String::with_capacity(content.len());
    let mut cursor = 0usize;
    while let Some(offset) = content[cursor..].find("entry://") {
        let prefix_start = cursor + offset;
        let value_start = prefix_start + "entry://".len();
        output.push_str(&content[cursor..value_start]);

        let mut value_end = value_start;
        for (relative, ch) in content[value_start..].char_indices() {
            if is_entry_href_char(ch) {
                value_end = value_start + relative + ch.len_utf8();
            } else {
                break;
            }
        }

        if value_end == value_start {
            cursor = value_start;
            continue;
        }

        let encoded = &content[value_start..value_end];
        let decoded = urlencoding::decode(encoded)
            .map_err(|e| format!("解析 entry:// 链接失败: {e}"))?
            .to_string();
        if Uuid::parse_str(&decoded).is_ok() {
            let mapped =
                required_mapped_id(&id_maps.entries, &decoded, "entries.content entry://")?;
            output.push_str(&mapped);
        } else if let Some((project_id, entry_id)) = decoded.split_once('/') {
            if let Some(mapped_project) = id_maps.projects.get(project_id) {
                let mapped_entry =
                    required_mapped_id(&id_maps.entries, entry_id, "entries.content entry://")?;
                output.push_str(mapped_project);
                output.push('/');
                output.push_str(&mapped_entry);
            } else {
                output.push_str(encoded);
            }
        } else {
            output.push_str(encoded);
        }
        cursor = value_end;
    }
    output.push_str(&content[cursor..]);
    Ok(output)
}

fn rewrite_projects_csv(
    content: &str,
    id_maps: &ImportIdMaps,
    asset_targets: &HashMap<String, PathBuf>,
    import_project_name: &str,
) -> Result<(String, String), String> {
    let Some((headers, mut rows)) = read_csv_rows(content, "projects.csv")? else {
        return Err("projects.csv 不能为空".to_string());
    };
    if rows.len() != 1 {
        return Err(format!("projects.csv 必须包含 1 行，实际 {}", rows.len()));
    }
    let id_index = header_index(&headers, "id")?;
    let name_index = header_index(&headers, "name")?;
    let cover_index = header_index(&headers, "cover_image")?;
    let row = rows
        .get_mut(0)
        .ok_or_else(|| "projects.csv 缺少项目记录".to_string())?;
    let old_project_id = row
        .get(id_index)
        .ok_or_else(|| "projects.csv 缺少 id".to_string())?
        .to_string();
    let new_project_id = required_mapped_id(&id_maps.projects, &old_project_id, "projects.id")?;
    let project_name = import_project_name.trim().to_string();
    if project_name.is_empty() {
        return Err("导入世界观名称不能为空".to_string());
    }
    let rewritten_cover = rewrite_csv_asset_opt_string(
        row.get(cover_index).map(String::as_str).unwrap_or_default(),
        asset_targets,
        "projects.cover_image",
    )?;

    set_field(row, id_index, new_project_id, "projects.csv")?;
    set_field(row, name_index, project_name.clone(), "projects.csv")?;
    set_field(row, cover_index, rewritten_cover, "projects.csv")?;
    Ok((write_csv_records(&headers, &rows)?, project_name))
}

fn rewrite_simple_project_table(
    content: &str,
    table: WorldflowCsvTable,
    id_map: &HashMap<String, String>,
    id_maps: &ImportIdMaps,
) -> Result<String, String> {
    let Some((headers, mut rows)) = read_csv_rows(content, table.file_name())? else {
        return Ok(content.to_string());
    };
    let id_index = header_index(&headers, "id")?;
    let project_index = header_index(&headers, "project_id")?;
    for row in &mut rows {
        let old_id = row.get(id_index).cloned().unwrap_or_default();
        let old_project_id = row.get(project_index).cloned().unwrap_or_default();
        set_field(
            row,
            id_index,
            required_mapped_id(id_map, &old_id, table.file_name())?,
            table.file_name(),
        )?;
        set_field(
            row,
            project_index,
            required_mapped_id(&id_maps.projects, &old_project_id, table.file_name())?,
            table.file_name(),
        )?;
    }
    write_csv_records(&headers, &rows)
}

fn rewrite_categories_csv(content: &str, id_maps: &ImportIdMaps) -> Result<String, String> {
    let Some((headers, mut rows)) = read_csv_rows(content, "categories.csv")? else {
        return Ok(content.to_string());
    };
    let id_index = header_index(&headers, "id")?;
    let project_index = header_index(&headers, "project_id")?;
    let parent_index = header_index(&headers, "parent_id")?;
    for row in &mut rows {
        let old_id = row.get(id_index).cloned().unwrap_or_default();
        let old_project_id = row.get(project_index).cloned().unwrap_or_default();
        let old_parent_id = row.get(parent_index).cloned().unwrap_or_default();
        set_field(
            row,
            id_index,
            required_mapped_id(&id_maps.categories, &old_id, "categories.id")?,
            "categories.csv",
        )?;
        set_field(
            row,
            project_index,
            required_mapped_id(&id_maps.projects, &old_project_id, "categories.project_id")?,
            "categories.csv",
        )?;
        set_field(
            row,
            parent_index,
            optional_mapped_id(&id_maps.categories, &old_parent_id, "categories.parent_id")?,
            "categories.csv",
        )?;
    }
    write_csv_records(&headers, &rows)
}

fn rewrite_entries_csv_for_import(
    content: &str,
    id_maps: &ImportIdMaps,
    asset_targets: &HashMap<String, PathBuf>,
    fcimg_ref_map: &HashMap<String, String>,
) -> Result<String, String> {
    let Some((headers, mut rows)) = read_csv_rows(content, "entries.csv")? else {
        return Ok(content.to_string());
    };
    let id_index = header_index(&headers, "id")?;
    let project_index = header_index(&headers, "project_id")?;
    let category_index = header_index(&headers, "category_id")?;
    let content_index = header_index(&headers, "content")?;
    let tags_index = header_index(&headers, "tags")?;
    let images_index = header_index(&headers, "images")?;
    let cover_index = header_index(&headers, "cover_path")?;
    for row in &mut rows {
        let old_id = row.get(id_index).cloned().unwrap_or_default();
        let old_project_id = row.get(project_index).cloned().unwrap_or_default();
        let old_category_id = row.get(category_index).cloned().unwrap_or_default();
        let new_id = required_mapped_id(&id_maps.entries, &old_id, "entries.id")?;
        let rewritten_entry_content = rewrite_entry_hrefs(
            row.get(content_index)
                .map(String::as_str)
                .unwrap_or_default(),
            id_maps,
        )?;
        let rewritten_content =
            rewrite_fcimg_refs(&rewritten_entry_content, fcimg_ref_map, &id_maps.projects)?;
        let rewritten_tags = rewrite_entry_tags_json(
            row.get(tags_index).map(String::as_str).unwrap_or_default(),
            id_maps,
            &old_id,
        )?;
        let rewritten_images = rewrite_entry_images_json_for_import(
            row.get(images_index)
                .map(String::as_str)
                .unwrap_or_default(),
            &old_id,
            asset_targets,
        )?;
        let rewritten_cover = rewrite_csv_asset_opt_string(
            row.get(cover_index).map(String::as_str).unwrap_or_default(),
            asset_targets,
            "entries.cover_path",
        )?;

        set_field(row, id_index, new_id, "entries.csv")?;
        set_field(
            row,
            project_index,
            required_mapped_id(&id_maps.projects, &old_project_id, "entries.project_id")?,
            "entries.csv",
        )?;
        set_field(
            row,
            category_index,
            optional_mapped_id(&id_maps.categories, &old_category_id, "entries.category_id")?,
            "entries.csv",
        )?;
        set_field(row, content_index, rewritten_content, "entries.csv")?;
        set_field(row, tags_index, rewritten_tags, "entries.csv")?;
        set_field(row, images_index, rewritten_images, "entries.csv")?;
        set_field(row, cover_index, rewritten_cover, "entries.csv")?;
    }
    write_csv_records(&headers, &rows)
}

fn rewrite_entry_relations_csv(content: &str, id_maps: &ImportIdMaps) -> Result<String, String> {
    let Some((headers, mut rows)) = read_csv_rows(content, "entry_relations.csv")? else {
        return Ok(content.to_string());
    };
    let id_index = header_index(&headers, "id")?;
    let project_index = header_index(&headers, "project_id")?;
    let a_index = header_index(&headers, "a_id")?;
    let b_index = header_index(&headers, "b_id")?;
    let relation_index = header_index(&headers, "relation")?;
    for row in &mut rows {
        let old_id = row.get(id_index).cloned().unwrap_or_default();
        let old_project_id = row.get(project_index).cloned().unwrap_or_default();
        let old_a_id = row.get(a_index).cloned().unwrap_or_default();
        let old_b_id = row.get(b_index).cloned().unwrap_or_default();
        let relation = row.get(relation_index).cloned().unwrap_or_default();
        let mut new_a_id = required_mapped_id(&id_maps.entries, &old_a_id, "entry_relations.a_id")?;
        let mut new_b_id = required_mapped_id(&id_maps.entries, &old_b_id, "entry_relations.b_id")?;
        if relation == "two_way" {
            let parsed_a = Uuid::parse_str(&new_a_id)
                .map_err(|e| format!("entry_relations.a_id 不是合法 UUID: {new_a_id}: {e}"))?;
            let parsed_b = Uuid::parse_str(&new_b_id)
                .map_err(|e| format!("entry_relations.b_id 不是合法 UUID: {new_b_id}: {e}"))?;
            if parsed_a > parsed_b {
                std::mem::swap(&mut new_a_id, &mut new_b_id);
            }
        }
        set_field(
            row,
            id_index,
            required_mapped_id(&id_maps.entry_relations, &old_id, "entry_relations.id")?,
            "entry_relations.csv",
        )?;
        set_field(
            row,
            project_index,
            required_mapped_id(
                &id_maps.projects,
                &old_project_id,
                "entry_relations.project_id",
            )?,
            "entry_relations.csv",
        )?;
        set_field(row, a_index, new_a_id, "entry_relations.csv")?;
        set_field(row, b_index, new_b_id, "entry_relations.csv")?;
    }
    write_csv_records(&headers, &rows)
}

fn rewrite_entry_links_csv(content: &str, id_maps: &ImportIdMaps) -> Result<String, String> {
    let Some((headers, mut rows)) = read_csv_rows(content, "entry_links.csv")? else {
        return Ok(content.to_string());
    };
    let id_index = header_index(&headers, "id")?;
    let project_index = header_index(&headers, "project_id")?;
    let a_index = header_index(&headers, "a_id")?;
    let b_index = header_index(&headers, "b_id")?;
    for row in &mut rows {
        let old_id = row.get(id_index).cloned().unwrap_or_default();
        let old_project_id = row.get(project_index).cloned().unwrap_or_default();
        let old_a_id = row.get(a_index).cloned().unwrap_or_default();
        let old_b_id = row.get(b_index).cloned().unwrap_or_default();
        set_field(
            row,
            id_index,
            required_mapped_id(&id_maps.entry_links, &old_id, "entry_links.id")?,
            "entry_links.csv",
        )?;
        set_field(
            row,
            project_index,
            required_mapped_id(&id_maps.projects, &old_project_id, "entry_links.project_id")?,
            "entry_links.csv",
        )?;
        set_field(
            row,
            a_index,
            required_mapped_id(&id_maps.entries, &old_a_id, "entry_links.a_id")?,
            "entry_links.csv",
        )?;
        set_field(
            row,
            b_index,
            required_mapped_id(&id_maps.entries, &old_b_id, "entry_links.b_id")?,
            "entry_links.csv",
        )?;
    }
    write_csv_records(&headers, &rows)
}

fn rewrite_idea_notes_csv(content: &str, id_maps: &ImportIdMaps) -> Result<String, String> {
    let Some((headers, mut rows)) = read_csv_rows(content, "idea_notes.csv")? else {
        return Ok(content.to_string());
    };
    let id_index = header_index(&headers, "id")?;
    let project_index = header_index(&headers, "project_id")?;
    let converted_index = header_index(&headers, "converted_entry_id")?;
    for row in &mut rows {
        let old_id = row.get(id_index).cloned().unwrap_or_default();
        let old_project_id = row.get(project_index).cloned().unwrap_or_default();
        let old_converted_id = row.get(converted_index).cloned().unwrap_or_default();
        set_field(
            row,
            id_index,
            required_mapped_id(&id_maps.idea_notes, &old_id, "idea_notes.id")?,
            "idea_notes.csv",
        )?;
        set_field(
            row,
            project_index,
            optional_mapped_id(&id_maps.projects, &old_project_id, "idea_notes.project_id")?,
            "idea_notes.csv",
        )?;
        set_field(
            row,
            converted_index,
            optional_mapped_id(
                &id_maps.entries,
                &old_converted_id,
                "idea_notes.converted_entry_id",
            )?,
            "idea_notes.csv",
        )?;
    }
    write_csv_records(&headers, &rows)
}

fn rewrite_csv_items_for_import(
    package: &ValidatedFcworldPackage,
    id_maps: &ImportIdMaps,
    asset_targets: &HashMap<String, PathBuf>,
    import_project_name: &str,
) -> Result<(Vec<worldflow_core::CsvImportItem>, String), String> {
    let mut output = Vec::with_capacity(WorldflowCsvTable::ordered().len());
    let mut project_name = String::new();
    let fcimg_ref_map = build_import_fcimg_ref_map(package, asset_targets);

    for table in WorldflowCsvTable::ordered().iter().copied() {
        let content = csv_item_content(&package.csv_items, table)?;
        let rewritten = match table {
            WorldflowCsvTable::Projects => {
                let (content, name) =
                    rewrite_projects_csv(content, id_maps, asset_targets, import_project_name)?;
                project_name = name;
                content
            }
            WorldflowCsvTable::Categories => rewrite_categories_csv(content, id_maps)?,
            WorldflowCsvTable::TagSchemas => {
                rewrite_simple_project_table(content, table, &id_maps.tag_schemas, id_maps)?
            }
            WorldflowCsvTable::EntryTypes => {
                rewrite_simple_project_table(content, table, &id_maps.entry_types, id_maps)?
            }
            WorldflowCsvTable::Entries => {
                rewrite_entries_csv_for_import(content, id_maps, asset_targets, &fcimg_ref_map)?
            }
            WorldflowCsvTable::EntryRelations => rewrite_entry_relations_csv(content, id_maps)?,
            WorldflowCsvTable::EntryLinks => rewrite_entry_links_csv(content, id_maps)?,
            WorldflowCsvTable::IdeaNotes => rewrite_idea_notes_csv(content, id_maps)?,
        };
        output.push(worldflow_core::CsvImportItem {
            table,
            file_name: table.file_name().to_string(),
            content: rewritten,
        });
    }

    Ok((output, project_name))
}

fn asset_data_url(asset: &FcworldAsset, bytes: &[u8]) -> String {
    format!(
        "data:{};base64,{}",
        asset.mime,
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn asset_data_url_by_path(
    package: &ValidatedFcworldPackage,
    asset_by_path: &HashMap<String, FcworldAsset>,
    package_path: &str,
    context: &str,
) -> Result<String, String> {
    let asset = asset_by_path
        .get(package_path)
        .ok_or_else(|| format!("{context} 引用了未登记资源: {package_path}"))?;
    let bytes = package
        .asset_bytes_by_path
        .get(package_path)
        .ok_or_else(|| format!("{context} 资源内容缺失: {package_path}"))?;
    Ok(asset_data_url(asset, bytes))
}

fn rewrite_json_entry_refs(
    value: &mut Value,
    id_maps: &ImportIdMaps,
    strict_linked: bool,
) -> Result<(), String> {
    match value {
        Value::Array(items) => {
            for item in items {
                rewrite_json_entry_refs(item, id_maps, strict_linked)?;
            }
        }
        Value::Object(object) => {
            for (key, item) in object.iter_mut() {
                if matches!(key.as_str(), "linkedEntryId" | "entryId" | "bizId") {
                    if let Some(old_id) = item.as_str().map(|value| value.to_string()) {
                        if Uuid::parse_str(&old_id).is_ok() {
                            if let Some(new_id) = id_maps.entries.get(&old_id) {
                                *item = Value::String(new_id.clone());
                                continue;
                            }
                            if strict_linked && key != "bizId" {
                                return Err(format!("地图 {key} 引用了未导入的词条: {old_id}"));
                            }
                        }
                    }
                }
                rewrite_json_entry_refs(item, id_maps, strict_linked)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn rewrite_scene_background(
    scene: &mut Value,
    package: &ValidatedFcworldPackage,
    asset_by_path: &HashMap<String, FcworldAsset>,
) -> Result<(), String> {
    let Some(url_value) = scene.pointer_mut("/backgroundImage/url") else {
        return Ok(());
    };
    let Some(package_path) = url_value.as_str().map(|value| value.to_string()) else {
        return Ok(());
    };
    if package_path.starts_with("assets/images/") {
        *url_value = Value::String(asset_data_url_by_path(
            package,
            asset_by_path,
            &package_path,
            "sceneJson.backgroundImage.url",
        )?);
    }
    Ok(())
}

fn rewrite_maps_json_for_import(
    package: &ValidatedFcworldPackage,
    id_maps: &ImportIdMaps,
    new_project_id: &Uuid,
) -> Result<(String, usize), String> {
    let mut value = serde_json::from_str::<Value>(&package.maps_json)
        .map_err(|e| format!("解析 maps/maps.json 失败: {e}"))?;
    let asset_by_path = package
        .assets_index
        .assets
        .iter()
        .cloned()
        .map(|asset| (asset.path.clone(), asset))
        .collect::<HashMap<_, _>>();

    if let Some(object) = value.as_object_mut() {
        object.insert(
            "projectId".to_string(),
            Value::String(new_project_id.to_string()),
        );
    }

    let maps = value
        .get_mut("maps")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "maps/maps.json 缺少 maps 数组".to_string())?;
    let map_count = maps.len();

    for map in maps {
        let Some(object) = map.as_object_mut() else {
            continue;
        };
        if let Some(background_value) = object.get_mut("backgroundImageUrl") {
            if let Some(package_path) = background_value.as_str().map(|value| value.to_string()) {
                if package_path.starts_with("assets/images/") {
                    *background_value = Value::String(asset_data_url_by_path(
                        package,
                        &asset_by_path,
                        &package_path,
                        "backgroundImageUrl",
                    )?);
                }
            }
        }

        if let Some(draft_value) = object.get_mut("draftJson") {
            if let Some(draft_json) = draft_value.as_str().map(|value| value.to_string()) {
                if !draft_json.trim().is_empty() {
                    let mut draft = serde_json::from_str::<Value>(&draft_json)
                        .map_err(|e| format!("解析地图 draftJson 失败: {e}"))?;
                    rewrite_json_entry_refs(&mut draft, id_maps, true)?;
                    *draft_value = Value::String(
                        serde_json::to_string(&draft)
                            .map_err(|e| format!("序列化地图 draftJson 失败: {e}"))?,
                    );
                }
            }
        }

        if let Some(scene_value) = object.get_mut("sceneJson") {
            if let Some(scene_json) = scene_value.as_str().map(|value| value.to_string()) {
                if !scene_json.trim().is_empty() {
                    let mut scene = serde_json::from_str::<Value>(&scene_json)
                        .map_err(|e| format!("解析地图 sceneJson 失败: {e}"))?;
                    rewrite_scene_background(&mut scene, package, &asset_by_path)?;
                    rewrite_json_entry_refs(&mut scene, id_maps, true)?;
                    *scene_value = Value::String(
                        serde_json::to_string(&scene)
                            .map_err(|e| format!("序列化地图 sceneJson 失败: {e}"))?,
                    );
                }
            }
        }
    }

    serde_json::to_string_pretty(&value)
        .map(|content| (content, map_count))
        .map_err(|e| format!("序列化导入地图数据失败: {e}"))
}

pub(super) fn prepare_fcworld_import(
    package: ValidatedFcworldPackage,
    paths: &PathsState,
    import_project_name: &str,
) -> Result<PreparedFcworldImport, String> {
    let new_project_id = Uuid::new_v4();
    let id_maps = collect_import_id_maps(&package, new_project_id)?;
    let (assets, asset_targets) = prepare_import_assets(&package, paths, &new_project_id)?;
    let (csv_items, project_name) =
        rewrite_csv_items_for_import(&package, &id_maps, &asset_targets, import_project_name)?;
    let (maps_json, map_count) = rewrite_maps_json_for_import(&package, &id_maps, &new_project_id)?;
    let (object_layer_json, page_assets) =
        object_layer::prepare(&package, &id_maps, paths, new_project_id)?;

    Ok(PreparedFcworldImport {
        package_id: package.manifest.package_id.clone(),
        source_project_id: package.manifest.world.source_project_id.clone(),
        new_project_id,
        project_name,
        csv_items,
        object_layer_json,
        assets,
        page_assets,
        maps_json,
        history_files: package.history_files,
        asset_count: package.assets_index.assets.len() + package.page_asset_bytes_by_path.len(),
        map_count,
        input_file_size: package.input_file_size,
        warnings: Vec::new(),
        #[cfg(test)]
        id_maps,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest_json(bundle_format_version: Option<u32>, schema_version: u32) -> String {
        let tables: Vec<serde_json::Value> = WorldflowCsvTable::ordered()
            .iter()
            .map(|table| {
                serde_json::json!({
                    "name": table_name(*table),
                    "path": format!("{WORLD_DATA_DIR}{}", table.file_name()),
                    "rowCount": 0,
                    "sha256": "0",
                })
            })
            .collect();

        let mut worldflow = serde_json::json!({
            "path": WORLD_DATA_DIR,
            "schemaVersion": schema_version,
            "tables": tables,
        });
        if let Some(version) = bundle_format_version {
            worldflow["bundleFormatVersion"] = serde_json::json!(version);
        }

        serde_json::json!({
            "format": "com.flowcloudai.fcworld",
            "formatVersion": 1,
            "packageId": "pkg-test",
            "createdAt": "2026-07-17T00:00:00Z",
            "generator": {
                "app": "FlowCloudAI",
                "appVersion": "0.0.0",
                "platform": "test",
                "worldflowSchemaVersion": schema_version,
            },
            "compatibility": { "minAppVersion": "0.1.0", "features": [] },
            "world": {
                "sourceProjectId": "018f5fbb-0f3b-7c6d-8c4f-2a4a0b8f9c01",
                "name": "测试世界",
                "description": null,
                "coverAssetId": null,
                "createdAt": "2026-07-17",
                "updatedAt": "2026-07-17",
                "language": "zh-CN",
            },
            "contents": {
                "worldflow": worldflow,
                "assetsIndex": { "path": ASSETS_INDEX_PATH, "count": 0, "sha256": "0" },
                "maps": { "path": MAPS_PATH, "count": 0, "sha256": "0" },
                "counts": {
                    "categories": 0, "entries": 0, "tagSchemas": 0, "entryTypes": 0,
                    "relations": 0, "entryLinks": 0, "ideaNotes": 0, "images": 0, "maps": 0,
                },
            },
        })
        .to_string()
    }

    #[test]
    fn manifest_with_bundle_version_ignores_schema_version() {
        // 带交换格式版本的新包：schema_version 与当前差异再大也应通过，
        // 它只是诊断信息，不参与兼容性判断。
        let json = manifest_json(Some(1), 999);
        assert!(
            validate_manifest(&json, 7).is_ok(),
            "bundleFormatVersion=1 应通过: {:?}",
            validate_manifest(&json, 7).err()
        );
    }

    #[test]
    fn manifest_with_newer_bundle_version_requires_upgrade() {
        let json = manifest_json(Some(2), 7);
        let err = validate_manifest(&json, 7).unwrap_err();
        assert!(err.contains("请升级应用"), "错误信息: {err}");
    }

    #[test]
    fn legacy_manifest_falls_back_to_schema_range() {
        assert!(validate_manifest(&manifest_json(None, 6), 7).is_ok());
        assert!(validate_manifest(&manifest_json(None, 7), 7).is_ok());

        let too_old = validate_manifest(&manifest_json(None, 5), 7).unwrap_err();
        assert!(too_old.contains("最低兼容版本"), "错误信息: {too_old}");

        let too_new = validate_manifest(&manifest_json(None, 8), 7).unwrap_err();
        assert!(too_new.contains("请升级应用"), "错误信息: {too_new}");
    }

    #[test]
    fn schema_version_accepts_compatible_range() {
        let current = 7;
        assert!(validate_schema_version("测试", 7, current).is_ok());
        assert!(
            validate_schema_version("测试", 6, current).is_ok(),
            "v6 包与 v7 交换格式一致，应允许导入"
        );

        let too_old = validate_schema_version("测试", 5, current).unwrap_err();
        assert!(too_old.contains("最低兼容版本"), "错误信息: {too_old}");

        let too_new = validate_schema_version("测试", 8, current).unwrap_err();
        assert!(too_new.contains("请升级应用"), "错误信息: {too_new}");
    }

    #[test]
    fn collect_id_map_preserves_entity_ids() {
        let entry_id = "aaaaaaaa-aaaa-7aaa-aaaa-aaaaaaaaaaaa";
        let items = vec![worldflow_core::CsvImportItem {
            table: WorldflowCsvTable::Entries,
            file_name: "entries.csv".to_string(),
            content: format!("id,project_id,title\n{entry_id},项目,词条\n"),
        }];

        let map = collect_id_map(&items, WorldflowCsvTable::Entries).expect("应可收集 ID");

        assert_eq!(map.get(entry_id), Some(&entry_id.to_string()));
    }

    #[test]
    fn rewrite_fc_hrefs_normalizes_source_project_to_self() {
        let old_project_id = "11111111-1111-7111-8111-111111111111".to_string();
        let new_project_id = "22222222-2222-7222-8222-222222222222".to_string();
        let entry_id = "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa".to_string();
        let other_project_id = "33333333-3333-7333-8333-333333333333";

        let mut id_maps = ImportIdMaps::default();
        id_maps
            .projects
            .insert(old_project_id.clone(), new_project_id);
        id_maps.entries.insert(entry_id.clone(), entry_id.clone());

        let content = format!(
            "fc://{old_project_id} [词条](fc://{old_project_id}/entry/{entry_id}) fc://{other_project_id}/entry/{entry_id}"
        );
        let rewritten = rewrite_fc_hrefs(&content, &id_maps).expect("新协议链接应可重写");

        assert_eq!(
            rewritten,
            format!(
                "fc://self [词条](fc://self/entry/{entry_id}) fc://{other_project_id}/entry/{entry_id}"
            )
        );
    }

    #[test]
    fn rewrite_fc_hrefs_remaps_entry_identity() {
        let old_project_id = "11111111-1111-7111-8111-111111111111";
        let old_entry_id = "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa";
        let new_entry_id = "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb";
        let mut id_maps = ImportIdMaps::default();
        id_maps.projects.insert(
            old_project_id.into(),
            "22222222-2222-7222-8222-222222222222".into(),
        );
        id_maps
            .entries
            .insert(old_entry_id.into(), new_entry_id.into());
        assert_eq!(
            rewrite_entry_hrefs(&format!("[a](entry://{old_entry_id}) [b](fc://{old_project_id}/entry/{old_entry_id}) [c](fc://self/entry/{old_entry_id})"), &id_maps).expect("链接应重映射"),
            format!("[a](entry://{new_entry_id}) [b](fc://self/entry/{new_entry_id}) [c](fc://self/entry/{new_entry_id})")
        );
    }

    #[test]
    fn rewrite_fc_image_refs_normalizes_source_project_to_self() {
        let old_project_id = "11111111-1111-7111-8111-111111111111".to_string();
        let new_project_id = "22222222-2222-7222-8222-222222222222".to_string();
        let mut project_map = HashMap::new();
        project_map.insert(old_project_id.clone(), new_project_id);
        let mut image_ref_map = HashMap::new();
        image_ref_map.insert("asset-000001".to_string(), "local-image-id".to_string());

        let content = format!(
            "![](fc://{old_project_id}/image/asset-000001) ![](fc://self/image/asset-000001)"
        );
        let rewritten = rewrite_fc_image_refs(&content, &image_ref_map, &project_map)
            .expect("图片链接应可重写");

        assert_eq!(
            rewritten,
            "![](fc://self/image/local-image-id) ![](fc://self/image/local-image-id)"
        );
    }

    #[test]
    fn rewrite_entry_relations_sorts_two_way_after_id_mapping() {
        let old_project_id = "11111111-1111-1111-1111-111111111111".to_string();
        let new_project_id = "22222222-2222-2222-2222-222222222222".to_string();
        let old_relation_id = "33333333-3333-3333-3333-333333333333".to_string();
        let new_relation_id = "44444444-4444-4444-4444-444444444444".to_string();
        let old_a_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string();
        let old_b_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string();
        let high_new_id = "ffffffff-ffff-ffff-ffff-ffffffffffff".to_string();
        let low_new_id = "00000000-0000-0000-0000-000000000001".to_string();

        let mut id_maps = ImportIdMaps::default();
        id_maps
            .projects
            .insert(old_project_id.clone(), new_project_id.clone());
        id_maps
            .entry_relations
            .insert(old_relation_id.clone(), new_relation_id.clone());
        id_maps
            .entries
            .insert(old_a_id.clone(), high_new_id.clone());
        id_maps.entries.insert(old_b_id.clone(), low_new_id.clone());

        let content = format!(
            "id,project_id,a_id,b_id,relation,content,created_at,updated_at\n{old_relation_id},{old_project_id},{old_a_id},{old_b_id},two_way,同盟,2026-05-18T00:00:00Z,2026-05-18T00:00:00Z\n"
        );
        let rewritten = rewrite_entry_relations_csv(&content, &id_maps).expect("双向关系应可重写");
        let mut reader = csv::Reader::from_reader(rewritten.as_bytes());
        let headers = reader.headers().expect("应有表头").clone();
        let a_index = header_index(&headers, "a_id").expect("应有 a_id");
        let b_index = header_index(&headers, "b_id").expect("应有 b_id");
        let relation_index = header_index(&headers, "relation").expect("应有 relation");
        let row = reader
            .records()
            .next()
            .expect("应有关系记录")
            .expect("关系记录应合法");

        assert_eq!(row.get(a_index), Some(low_new_id.as_str()));
        assert_eq!(row.get(b_index), Some(high_new_id.as_str()));
        assert_eq!(row.get(relation_index), Some("two_way"));
    }

    #[test]
    fn rewrite_entry_relations_keeps_one_way_direction() {
        let old_project_id = "11111111-1111-1111-1111-111111111111".to_string();
        let new_project_id = "22222222-2222-2222-2222-222222222222".to_string();
        let old_relation_id = "33333333-3333-3333-3333-333333333333".to_string();
        let new_relation_id = "44444444-4444-4444-4444-444444444444".to_string();
        let old_a_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string();
        let old_b_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string();
        let high_new_id = "ffffffff-ffff-ffff-ffff-ffffffffffff".to_string();
        let low_new_id = "00000000-0000-0000-0000-000000000001".to_string();

        let mut id_maps = ImportIdMaps::default();
        id_maps
            .projects
            .insert(old_project_id.clone(), new_project_id);
        id_maps
            .entry_relations
            .insert(old_relation_id.clone(), new_relation_id);
        id_maps
            .entries
            .insert(old_a_id.clone(), high_new_id.clone());
        id_maps.entries.insert(old_b_id.clone(), low_new_id.clone());

        let content = format!(
            "id,project_id,a_id,b_id,relation,content,created_at,updated_at\n{old_relation_id},{old_project_id},{old_a_id},{old_b_id},one_way,指向,2026-05-18T00:00:00Z,2026-05-18T00:00:00Z\n"
        );
        let rewritten = rewrite_entry_relations_csv(&content, &id_maps).expect("单向关系应可重写");
        let mut reader = csv::Reader::from_reader(rewritten.as_bytes());
        let headers = reader.headers().expect("应有表头").clone();
        let a_index = header_index(&headers, "a_id").expect("应有 a_id");
        let b_index = header_index(&headers, "b_id").expect("应有 b_id");
        let row = reader
            .records()
            .next()
            .expect("应有关系记录")
            .expect("关系记录应合法");

        assert_eq!(row.get(a_index), Some(high_new_id.as_str()));
        assert_eq!(row.get(b_index), Some(low_new_id.as_str()));
    }
}
