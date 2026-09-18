//! 页面图片的受管原件适配：世界库授权稳定 ID，宿主解码为有界像素供隔离画布绘制。

use crate::{ApiError, AppState, PathsState, apis::worldflow::common::open_project_db};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use flowcloudai_client::ErrorCode;
use image::{ImageFormat, ImageReader};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;
use worldflow_core::{PageAssetOps, SqliteDb, WorldStore, models::PageDocumentAsset};

const MAX_SOURCE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_SOURCE_PIXELS: u64 = 24_000_000;
const MAX_PREVIEW_EDGE: u32 = 512;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageAssetFrame {
    pub asset_id: Uuid,
    pub width: u32,
    pub height: u32,
    pub original_width: u32,
    pub original_height: u32,
    pub rgba_base64: String,
}

fn parse_id(field: &str, raw: &str) -> Result<Uuid, ApiError> {
    let id = Uuid::parse_str(raw).map_err(|_| {
        ApiError::new(
            ErrorCode::ValidationFormatError,
            format!("{field} 不是合法 UUID"),
        )
    })?;
    if id.is_nil() || !matches!(id.get_version_num(), 1..=8) || id.as_bytes()[8] & 0xc0 != 0x80 {
        return Err(ApiError::new(
            ErrorCode::ValidationFormatError,
            format!("{field} UUID 版本无效"),
        ));
    }
    Ok(id)
}

fn invalid(message: impl Into<String>) -> ApiError {
    ApiError::new(ErrorCode::ValidationFormatError, message).with_kv("assetStatus", "invalid")
}

fn unavailable(message: impl Into<String>) -> ApiError {
    ApiError::new(ErrorCode::FsOpenFailed, message).with_kv("assetStatus", "unavailable")
}

fn media_format(bytes: &[u8]) -> Result<(ImageFormat, &'static str, &'static str), ApiError> {
    match image::guess_format(bytes).map_err(|_| invalid("不是可识别的图片文件"))? {
        ImageFormat::Png => Ok((ImageFormat::Png, "image/png", "png")),
        ImageFormat::Jpeg => Ok((ImageFormat::Jpeg, "image/jpeg", "jpg")),
        ImageFormat::WebP => Ok((ImageFormat::WebP, "image/webp", "webp")),
        _ => Err(invalid("页面图片仅支持 PNG、JPEG 和 WebP")),
    }
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, ApiError> {
    let size = std::fs::metadata(path)
        .map_err(|_| unavailable("图片原件不存在或无法读取"))?
        .len();
    if size == 0 || size > MAX_SOURCE_BYTES {
        return Err(invalid("图片文件为空或超过 10 MiB"));
    }
    let file = std::fs::File::open(path).map_err(|_| unavailable("图片原件读取失败"))?;
    let mut bytes = Vec::with_capacity(size as usize);
    file.take(MAX_SOURCE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| unavailable("图片原件读取失败"))?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_SOURCE_BYTES {
        return Err(invalid("图片文件为空或超过 10 MiB"));
    }
    Ok(bytes)
}

fn inspect_image(
    bytes: &[u8],
) -> Result<(ImageFormat, &'static str, &'static str, u32, u32), ApiError> {
    let (format, media_type, extension) = media_format(bytes)?;
    let (width, height) = ImageReader::with_format(Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|_| invalid("图片头部损坏"))?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_SOURCE_PIXELS {
        return Err(invalid("图片尺寸无效或超过像素上限"));
    }
    image::load_from_memory_with_format(bytes, format).map_err(|_| invalid("图片内容损坏"))?;
    Ok((format, media_type, extension, width, height))
}

/// 世界包导入前按与本地原件相同的媒体、容量、尺寸和摘要规则独立核验。
pub(crate) fn validate_packaged_asset(
    bytes: &[u8],
    media_type: &str,
    size_bytes: i64,
    sha256: &str,
    width: i64,
    height: i64,
) -> Result<(), ApiError> {
    if bytes.len() as u64 > MAX_SOURCE_BYTES
        || bytes.is_empty()
        || i64::try_from(bytes.len()).ok() != Some(size_bytes)
        || format!("{:x}", Sha256::digest(bytes)) != sha256
    {
        return Err(invalid("世界包页面资产大小或摘要不匹配"));
    }
    let (_, actual_media_type, _, actual_width, actual_height) = inspect_image(bytes)?;
    if actual_media_type != media_type
        || i64::from(actual_width) != width
        || i64::from(actual_height) != height
    {
        return Err(invalid("世界包页面资产类型或尺寸不匹配"));
    }
    Ok(())
}

fn asset_root(paths: &PathsState, project_id: &Uuid) -> Result<PathBuf, ApiError> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| unavailable("无法定位图片目录"))?;
    Ok(db_dir
        .join("images")
        .join(project_id.to_string())
        .join("page-document"))
}

fn shared_asset_root(paths: &PathsState) -> Result<PathBuf, ApiError> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| unavailable("无法定位图片目录"))?;
    Ok(db_dir.join("images").join("page-document"))
}

pub(crate) fn asset_path(
    paths: &PathsState,
    asset: &PageDocumentAsset,
) -> Result<PathBuf, ApiError> {
    let extension = match asset.media_type.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => return Err(invalid("资产媒体类型无效")),
    };
    let root = match asset.storage_layout {
        0 => asset_root(paths, &asset.project_id)?,
        1 => shared_asset_root(paths)?,
        _ => return Err(invalid("资产存储布局版本无效")),
    };
    Ok(root.join(format!("{}.{}", asset.id, extension)))
}

pub(crate) fn verified_bytes(
    paths: &PathsState,
    asset: &PageDocumentAsset,
) -> Result<Vec<u8>, ApiError> {
    let root = match asset.storage_layout {
        0 => asset_root(paths, &asset.project_id)?,
        1 => shared_asset_root(paths)?,
        _ => return Err(invalid("资产存储布局版本无效")),
    };
    let images_root = paths
        .db_path
        .parent()
        .ok_or_else(|| unavailable("无法定位图片根目录"))?
        .join("images");
    let canonical_images =
        std::fs::canonicalize(images_root).map_err(|_| unavailable("图片根目录不存在"))?;
    let canonical_root = std::fs::canonicalize(&root).map_err(|_| unavailable("图片目录不存在"))?;
    let expected_root = match asset.storage_layout {
        0 => canonical_images
            .join(asset.project_id.to_string())
            .join("page-document"),
        1 => canonical_images.join("page-document"),
        _ => return Err(invalid("资产存储布局版本无效")),
    };
    if canonical_root != expected_root {
        return Err(unavailable("图片目录越界"));
    }
    let path = std::fs::canonicalize(asset_path(paths, asset)?)
        .map_err(|_| unavailable("图片原件不存在"))?;
    if !path.starts_with(&canonical_root) {
        return Err(unavailable("图片原件路径越界"));
    }
    let bytes = read_bounded(&path)?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    if hash != asset.sha256 {
        return Err(unavailable("图片原件摘要不匹配"));
    }
    let (_, media_type, _, width, height) = inspect_image(&bytes)?;
    if media_type != asset.media_type
        || i64::from(width) != asset.width
        || i64::from(height) != asset.height
    {
        return Err(unavailable("图片原件类型或尺寸与资产记录不一致"));
    }
    Ok(bytes)
}

async fn migrate_legacy_asset(
    db: &SqliteDb,
    paths: &PathsState,
    asset: &PageDocumentAsset,
) -> Result<PageDocumentAsset, ApiError> {
    if asset.storage_layout == 1 {
        return Ok(asset.clone());
    }
    if asset.storage_layout != 0 {
        return Err(invalid("资产存储布局版本无效"));
    }
    let bytes = verified_bytes(paths, asset)?;
    let shared_root = shared_asset_root(paths)?;
    std::fs::create_dir_all(&shared_root).map_err(|_| unavailable("无法创建共享图片目录"))?;
    let mut migrated = asset.clone();
    migrated.storage_layout = 1;
    let destination = asset_path(paths, &migrated)?;
    if !destination.exists() {
        let temporary = shared_root.join(format!("{}.{}.tmp", asset.id, Uuid::new_v4()));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| unavailable("无法准备迁移后的图片原件"))?;
        if file.write_all(&bytes).is_err() || file.sync_all().is_err() {
            drop(file);
            let _ = std::fs::remove_file(&temporary);
            return Err(unavailable("无法复制图片原件"));
        }
        drop(file);
        if let Err(error) = std::fs::hard_link(&temporary, &destination) {
            let _ = std::fs::remove_file(&temporary);
            if !destination.exists() {
                return Err(unavailable(format!("无法切换图片原件位置: {error}")));
            }
        } else {
            let _ = std::fs::remove_file(&temporary);
        }
    }
    verified_bytes(paths, &migrated)?;
    db.set_page_asset_storage_layout(&asset.project_id, &asset.id, 1)
        .await
        .map_err(ApiError::from_display)?;
    // 切换记录后，已核验的共享原件成为唯一权威位置；清旧文件失败不回退记录。
    let old_path = asset_path(paths, asset)?;
    if let Err(error) = std::fs::remove_file(&old_path) {
        log::warn!("页面资产旧原件清理失败 {}: {error}", asset.id);
    }
    Ok(migrated)
}

async fn asset_has_live_scope_or_reference(db: &SqliteDb, asset_id: Uuid) -> Result<bool, String> {
    let count: i64 = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM asset_scopes WHERE asset_id=?) +
                (SELECT COUNT(*) FROM object_references WHERE target_id=? AND ref_type='asset')",
    )
    .bind(asset_id)
    .bind(asset_id)
    .fetch_one(&db.pool)
    .await
    .map_err(|error| error.to_string())?;
    Ok(count > 0)
}

/// 项目删除已成功后才清理原件；任何数据库不可读、摘要不符或删除失败都保留文件。
pub(crate) async fn cleanup_deleted_project_assets(
    catalog: &SqliteDb,
    worlds: &WorldStore,
    paths: &PathsState,
    assets: &[PageDocumentAsset],
) -> Result<usize, String> {
    let remaining_worlds = worlds
        .list_worlds()
        .await
        .map_err(|error| error.to_string())?;
    let mut cleaned = 0;
    let mut errors = Vec::new();
    for asset in assets {
        if asset.storage_layout == 1 {
            let mut referenced = asset_has_live_scope_or_reference(catalog, asset.id).await?;
            for world in &remaining_worlds {
                let db = worlds
                    .open_world(world.id)
                    .await
                    .map_err(|error| error.to_string())?;
                let found = asset_has_live_scope_or_reference(&db, asset.id).await;
                db.pool.close().await;
                referenced |= found?;
            }
            if referenced {
                continue;
            }
        }
        if let Err(error) = verified_bytes(paths, asset) {
            errors.push(format!("资产 {} 原件未通过清理前校验：{error}", asset.id));
            continue;
        }
        let path = asset_path(paths, asset).map_err(|error| error.to_string())?;
        match std::fs::remove_file(&path) {
            Ok(()) => cleaned += 1,
            Err(error) => errors.push(format!("资产 {} 原件未能清理：{error}", asset.id)),
        }
    }
    if errors.is_empty() {
        Ok(cleaned)
    } else {
        Err(errors.join("；"))
    }
}

pub(crate) async fn require_asset(
    db: &SqliteDb,
    paths: &PathsState,
    project_id: &Uuid,
    asset_id: &Uuid,
) -> Result<PageDocumentAsset, ApiError> {
    let asset = db
        .get_page_asset(project_id, asset_id)
        .await
        .map_err(ApiError::from_display)?
        .ok_or_else(|| unavailable("图片不存在或不属于当前项目"))?;
    let migrated = migrate_legacy_asset(db, paths, &asset).await?;
    verified_bytes(paths, &migrated)?;
    Ok(migrated)
}

pub(crate) async fn import_asset(
    state: &AppState,
    paths: &PathsState,
    project_id: &Uuid,
    source: &Path,
) -> Result<PageDocumentAsset, ApiError> {
    let db = open_project_db(state, project_id)
        .await
        .map_err(ApiError::internal)?;
    if !source.is_absolute() {
        return Err(invalid("导入源必须是文件选择器返回的绝对路径"));
    }
    let bytes = read_bounded(source)?;
    let (_, media_type, extension, width, height) = inspect_image(&bytes)?;
    let asset_id = Uuid::new_v4();
    let root = shared_asset_root(paths)?;
    std::fs::create_dir_all(&root).map_err(|_| unavailable("无法创建图片目录"))?;
    let images_root = paths
        .db_path
        .parent()
        .ok_or_else(|| unavailable("无法定位图片根目录"))?
        .join("images");
    let canonical_images =
        std::fs::canonicalize(images_root).map_err(|_| unavailable("无法核验图片根目录"))?;
    let canonical_root =
        std::fs::canonicalize(&root).map_err(|_| unavailable("无法核验项目图片目录"))?;
    if canonical_root != canonical_images.join("page-document") {
        return Err(unavailable("图片目录越界"));
    }
    let path = root.join(format!("{asset_id}.{extension}"));
    let temporary = root.join(format!("{asset_id}.{extension}.tmp"));
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| unavailable("无法准备图片原件"))?;
    if file.write_all(&bytes).is_err() || file.sync_all().is_err() {
        drop(file);
        let _ = std::fs::remove_file(&temporary);
        return Err(unavailable("无法写入图片原件"));
    }
    drop(file);
    if let Err(error) = std::fs::hard_link(&temporary, &path) {
        let _ = std::fs::remove_file(&temporary);
        return Err(unavailable(format!("无法存储图片原件: {error}")));
    }
    let _ = std::fs::remove_file(&temporary);
    let asset = PageDocumentAsset {
        id: asset_id,
        project_id: *project_id,
        media_type: media_type.into(),
        size_bytes: i64::try_from(bytes.len()).unwrap_or(i64::MAX),
        sha256: digest,
        width: i64::from(width),
        height: i64::from(height),
        storage_layout: 1,
        created_at: String::new(),
    };
    if let Err(error) = verified_bytes(paths, &asset) {
        let _ = std::fs::remove_file(&path);
        return Err(error);
    }
    match db.register_page_asset(&asset).await {
        Ok(stored) => Ok(stored),
        Err(error) => {
            let _ = std::fs::remove_file(&path);
            Err(ApiError::from_display(error))
        }
    }
}

pub(crate) async fn read_asset_frame(
    state: &AppState,
    paths: &PathsState,
    project_id: &Uuid,
    asset_id: &Uuid,
) -> Result<PageAssetFrame, ApiError> {
    let db = open_project_db(state, project_id)
        .await
        .map_err(ApiError::internal)?;
    let asset = require_asset(&db, paths, project_id, asset_id).await?;
    let bytes = verified_bytes(paths, &asset)?;
    let (format, _, _, _, _) = inspect_image(&bytes)?;
    let decoded = image::load_from_memory_with_format(&bytes, format)
        .map_err(|_| unavailable("图片原件解码失败"))?;
    let preview = if decoded.width() <= MAX_PREVIEW_EDGE && decoded.height() <= MAX_PREVIEW_EDGE {
        decoded.to_rgba8()
    } else {
        decoded
            .thumbnail(MAX_PREVIEW_EDGE, MAX_PREVIEW_EDGE)
            .to_rgba8()
    };
    let (width, height) = preview.dimensions();
    Ok(PageAssetFrame {
        asset_id: *asset_id,
        width,
        height,
        original_width: u32::try_from(asset.width).map_err(|_| invalid("图片原始宽度无效"))?,
        original_height: u32::try_from(asset.height).map_err(|_| invalid("图片原始高度无效"))?,
        rgba_base64: STANDARD.encode(preview.as_raw()),
    })
}

#[tauri::command]
pub async fn page_document_import_asset(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    paths: State<'_, PathsState>,
    project_id: String,
) -> Result<Option<PageDocumentAsset>, ApiError> {
    let project_id = parse_id("projectId", &project_id)?;
    // 选择路径只在原生命令内部产生；前端不能用任意绝对路径调用导入。
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("图片", &["png", "jpg", "jpeg", "webp"])
        .pick_file(move |selected| {
            let _ = sender.send(selected);
        });
    let selected = receiver
        .await
        .map_err(|_| unavailable("图片选择器未返回结果"))?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let source = selected
        .into_path()
        .map_err(|_| invalid("图片选择器没有返回可读取文件"))?;
    import_asset(state.inner(), paths.inner(), &project_id, &source)
        .await
        .map(Some)
}

#[tauri::command]
pub async fn page_document_list_assets(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<PageDocumentAsset>, ApiError> {
    let project_id = parse_id("projectId", &project_id)?;
    let db = open_project_db(state.inner(), &project_id)
        .await
        .map_err(ApiError::internal)?;
    db.list_page_assets(&project_id)
        .await
        .map_err(ApiError::from_display)
}

#[tauri::command]
pub async fn page_document_read_asset_frame(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, PathsState>,
    project_id: String,
    asset_id: String,
) -> Result<PageAssetFrame, ApiError> {
    let project_id = parse_id("projectId", &project_id)?;
    let asset_id = parse_id("assetId", &asset_id)?;
    read_asset_frame(state.inner(), paths.inner(), &project_id, &asset_id).await
}

#[tauri::command]
pub async fn page_document_check_asset(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, PathsState>,
    project_id: String,
    asset_id: String,
) -> Result<PageDocumentAsset, ApiError> {
    let project_id = parse_id("projectId", &project_id)?;
    let asset_id = parse_id("assetId", &asset_id)?;
    let db = open_project_db(state.inner(), &project_id)
        .await
        .map_err(ApiError::internal)?;
    require_asset(&db, paths.inner(), &project_id, &asset_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    use sqlx::Row;
    use worldflow_core::ProjectOps;

    #[test]
    fn media_type_and_byte_limits_are_checked_from_content() {
        let image = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            2,
            3,
            image::Rgb([10, 20, 30]),
        ));
        for format in [ImageFormat::Png, ImageFormat::Jpeg, ImageFormat::WebP] {
            let mut encoded = Cursor::new(Vec::new());
            image.write_to(&mut encoded, format).unwrap();
            let result = inspect_image(&encoded.into_inner()).unwrap();
            assert_eq!(result.0, format);
            assert_eq!((result.3, result.4), (2, 3));
        }
        let mut gif = Cursor::new(Vec::new());
        image.write_to(&mut gif, ImageFormat::Gif).unwrap();
        assert!(inspect_image(&gif.into_inner()).is_err());
        assert!(inspect_image(b"not-an-image").is_err());
        let dir = tempfile::tempdir().unwrap();
        let too_large = dir.path().join("oversize.png");
        let file = std::fs::File::create(&too_large).unwrap();
        file.set_len(MAX_SOURCE_BYTES + 1).unwrap();
        assert!(read_bounded(&too_large).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_asset_file_cannot_escape_project_image_directory() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let project_id = Uuid::new_v4();
        let asset = PageDocumentAsset {
            id: Uuid::new_v4(),
            project_id,
            media_type: "image/png".into(),
            size_bytes: 5,
            sha256: "a".repeat(64),
            width: 1,
            height: 1,
            storage_layout: 1,
            created_at: String::new(),
        };
        let paths = PathsState {
            db_path: dir.path().join("catalog.db"),
            plugins_path: dir.path().join("plugins"),
        };
        let root = shared_asset_root(&paths).unwrap();
        std::fs::create_dir_all(&root).unwrap();
        let outside = dir.path().join("outside.png");
        std::fs::write(&outside, b"other").unwrap();
        symlink(&outside, asset_path(&paths, &asset).unwrap()).unwrap();
        assert!(verified_bytes(&paths, &asset).is_err());
    }

    #[tokio::test]
    async fn legacy_asset_is_copied_and_verified_before_switching_storage_layout() {
        let dir = tempfile::tempdir().unwrap();
        let paths = PathsState {
            db_path: dir.path().join("catalog.db"),
            plugins_path: dir.path().join("plugins"),
        };
        let db = SqliteDb::new(&format!(
            "sqlite:{}?mode=rwc",
            dir.path().join("world.db").display()
        ))
        .await
        .unwrap();
        let project_id = Uuid::now_v7();
        sqlx::query("INSERT INTO projects(id,name) VALUES(?,'迁移测试')")
            .bind(project_id)
            .execute(&db.pool)
            .await
            .unwrap();
        let mut encoded = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(2, 3, image::Rgb([1, 2, 3])))
            .write_to(&mut encoded, ImageFormat::Png)
            .unwrap();
        let bytes = encoded.into_inner();
        let asset = PageDocumentAsset {
            id: Uuid::now_v7(),
            project_id,
            media_type: "image/png".into(),
            size_bytes: bytes.len() as i64,
            sha256: format!("{:x}", Sha256::digest(&bytes)),
            width: 2,
            height: 3,
            storage_layout: 0,
            created_at: String::new(),
        };
        db.register_page_asset(&asset).await.unwrap();
        let old_path = asset_path(&paths, &asset).unwrap();
        std::fs::create_dir_all(old_path.parent().unwrap()).unwrap();
        std::fs::write(&old_path, &bytes).unwrap();

        let migrated = require_asset(&db, &paths, &project_id, &asset.id)
            .await
            .unwrap();
        assert_eq!(migrated.storage_layout, 1);
        assert!(!old_path.exists());
        assert_eq!(
            std::fs::read(asset_path(&paths, &migrated).unwrap()).unwrap(),
            bytes
        );
        assert_eq!(
            sqlx::query("SELECT storage_layout FROM page_document_assets WHERE id=?")
                .bind(asset.id)
                .fetch_one(&db.pool)
                .await
                .unwrap()
                .try_get::<i64, _>("storage_layout")
                .unwrap(),
            1
        );
        let second_project = Uuid::now_v7();
        sqlx::query("INSERT INTO projects(id,name) VALUES(?,'第二项目')")
            .bind(second_project)
            .execute(&db.pool)
            .await
            .unwrap();
        assert!(
            db.get_page_asset(&second_project, &asset.id)
                .await
                .unwrap()
                .is_none()
        );
        let shared = PageDocumentAsset {
            project_id: second_project,
            ..migrated.clone()
        };
        db.register_page_asset(&shared).await.unwrap();
        let second = require_asset(&db, &paths, &second_project, &asset.id)
            .await
            .unwrap();
        assert_eq!(
            asset_path(&paths, &second).unwrap(),
            asset_path(&paths, &migrated).unwrap()
        );
    }

    #[tokio::test]
    async fn failed_legacy_asset_migration_keeps_original_and_layout_marker() {
        let dir = tempfile::tempdir().unwrap();
        let paths = PathsState {
            db_path: dir.path().join("catalog.db"),
            plugins_path: dir.path().join("plugins"),
        };
        let db = SqliteDb::new(&format!(
            "sqlite:{}?mode=rwc",
            dir.path().join("world.db").display()
        ))
        .await
        .unwrap();
        let project_id = Uuid::now_v7();
        sqlx::query("INSERT INTO projects(id,name) VALUES(?,'损坏资产')")
            .bind(project_id)
            .execute(&db.pool)
            .await
            .unwrap();
        let asset = PageDocumentAsset {
            id: Uuid::now_v7(),
            project_id,
            media_type: "image/png".into(),
            size_bytes: 9,
            sha256: "a".repeat(64),
            width: 1,
            height: 1,
            storage_layout: 0,
            created_at: String::new(),
        };
        db.register_page_asset(&asset).await.unwrap();
        let old_path = asset_path(&paths, &asset).unwrap();
        std::fs::create_dir_all(old_path.parent().unwrap()).unwrap();
        std::fs::write(&old_path, b"corrupted").unwrap();

        assert!(
            require_asset(&db, &paths, &project_id, &asset.id)
                .await
                .is_err()
        );
        assert_eq!(std::fs::read(&old_path).unwrap(), b"corrupted");
        assert_eq!(
            db.get_page_asset(&project_id, &asset.id)
                .await
                .unwrap()
                .unwrap()
                .storage_layout,
            0
        );
        let mut shared = asset;
        shared.storage_layout = 1;
        assert!(!asset_path(&paths, &shared).unwrap().exists());
    }

    #[tokio::test]
    async fn deleted_project_cleans_only_last_unscoped_shared_original() {
        let dir = tempfile::tempdir().unwrap();
        let paths = PathsState {
            db_path: dir.path().join("index.db"),
            plugins_path: dir.path().join("plugins"),
        };
        let catalog = SqliteDb::new(&format!("sqlite:{}?mode=rwc", paths.db_path.display()))
            .await
            .unwrap();
        let worlds = WorldStore::open(dir.path().join("world-store"))
            .await
            .unwrap();
        let first = Uuid::now_v7();
        let second = Uuid::now_v7();
        let mut encoded = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(2, 3, image::Rgb([1, 2, 3])))
            .write_to(&mut encoded, ImageFormat::Png)
            .unwrap();
        let bytes = encoded.into_inner();
        let asset = PageDocumentAsset {
            id: Uuid::now_v7(),
            project_id: first,
            media_type: "image/png".into(),
            size_bytes: bytes.len() as i64,
            sha256: format!("{:x}", Sha256::digest(&bytes)),
            width: 2,
            height: 3,
            storage_layout: 1,
            created_at: String::new(),
        };
        let original = asset_path(&paths, &asset).unwrap();
        std::fs::create_dir_all(original.parent().unwrap()).unwrap();
        std::fs::write(&original, &bytes).unwrap();
        for project in [first, second] {
            worlds
                .create_world_with_id(project, "测试世界")
                .await
                .unwrap();
            let db = worlds.open_world(project).await.unwrap();
            sqlx::query("INSERT INTO projects(id,name) VALUES(?,'测试项目')")
                .bind(project)
                .execute(&db.pool)
                .await
                .unwrap();
            db.register_page_asset(&PageDocumentAsset {
                project_id: project,
                ..asset.clone()
            })
            .await
            .unwrap();
            db.pool.close().await;
        }
        let first_db = worlds.open_world(first).await.unwrap();
        first_db.delete_project(&first).await.unwrap();
        first_db.pool.close().await;
        worlds.delete_world(first).await.unwrap();
        assert_eq!(
            cleanup_deleted_project_assets(&catalog, &worlds, &paths, &[asset.clone()])
                .await
                .unwrap(),
            0
        );
        assert!(original.exists(), "另一世界仍有项目范围时不得删除共享原件");

        let second_db = worlds.open_world(second).await.unwrap();
        second_db.delete_project(&second).await.unwrap();
        second_db.pool.close().await;
        worlds.delete_world(second).await.unwrap();
        assert_eq!(
            cleanup_deleted_project_assets(&catalog, &worlds, &paths, &[asset.clone()])
                .await
                .unwrap(),
            1
        );
        assert!(!original.exists());
        std::fs::write(&original, b"corrupted").unwrap();
        assert!(
            cleanup_deleted_project_assets(&catalog, &worlds, &paths, &[asset])
                .await
                .is_err()
        );
        assert_eq!(std::fs::read(&original).unwrap(), b"corrupted");
    }
}
