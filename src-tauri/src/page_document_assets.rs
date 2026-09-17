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
use worldflow_core::{PageAssetOps, SqliteDb, models::PageDocumentAsset};

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
    Ok(asset_root(paths, &asset.project_id)?.join(format!("{}.{}", asset.id, extension)))
}

fn verified_bytes(paths: &PathsState, asset: &PageDocumentAsset) -> Result<Vec<u8>, ApiError> {
    let root = asset_root(paths, &asset.project_id)?;
    let images_root = paths
        .db_path
        .parent()
        .ok_or_else(|| unavailable("无法定位图片根目录"))?
        .join("images");
    let canonical_images =
        std::fs::canonicalize(images_root).map_err(|_| unavailable("图片根目录不存在"))?;
    let canonical_root =
        std::fs::canonicalize(&root).map_err(|_| unavailable("项目图片目录不存在"))?;
    if canonical_root
        != canonical_images
            .join(asset.project_id.to_string())
            .join("page-document")
    {
        return Err(unavailable("项目图片目录越界"));
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
    verified_bytes(paths, &asset)?;
    Ok(asset)
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
    let root = asset_root(paths, project_id)?;
    std::fs::create_dir_all(&root).map_err(|_| unavailable("无法创建项目图片目录"))?;
    let images_root = paths
        .db_path
        .parent()
        .ok_or_else(|| unavailable("无法定位图片根目录"))?
        .join("images");
    let canonical_images =
        std::fs::canonicalize(images_root).map_err(|_| unavailable("无法核验图片根目录"))?;
    let canonical_root =
        std::fs::canonicalize(&root).map_err(|_| unavailable("无法核验项目图片目录"))?;
    if canonical_root
        != canonical_images
            .join(project_id.to_string())
            .join("page-document")
    {
        return Err(unavailable("项目图片目录越界"));
    }
    let path = root.join(format!("{asset_id}.{extension}"));
    let temporary = root.join(format!("{asset_id}.{extension}.tmp"));
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| unavailable("无法准备图片原件"))?;
    if file.write_all(&bytes).is_err() {
        drop(file);
        let _ = std::fs::remove_file(&temporary);
        return Err(unavailable("无法写入图片原件"));
    }
    drop(file);
    if let Err(error) = std::fs::rename(&temporary, &path) {
        let _ = std::fs::remove_file(&temporary);
        return Err(unavailable(format!("无法存储图片原件: {error}")));
    }
    let asset = PageDocumentAsset {
        id: asset_id,
        project_id: *project_id,
        media_type: media_type.into(),
        size_bytes: i64::try_from(bytes.len()).unwrap_or(i64::MAX),
        sha256: digest,
        width: i64::from(width),
        height: i64::from(height),
        created_at: String::new(),
    };
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
            created_at: String::new(),
        };
        let paths = PathsState {
            db_path: dir.path().join("catalog.db"),
            plugins_path: dir.path().join("plugins"),
        };
        let root = asset_root(&paths, &project_id).unwrap();
        std::fs::create_dir_all(&root).unwrap();
        let outside = dir.path().join("outside.png");
        std::fs::write(&outside, b"other").unwrap();
        symlink(&outside, asset_path(&paths, &asset).unwrap()).unwrap();
        assert!(verified_bytes(&paths, &asset).is_err());
    }
}
