use super::common::*;
use image::{GenericImageView, codecs::jpeg::JpegEncoder, imageops::FilterType};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::BufWriter;

#[cfg(target_os = "android")]
use crate::android_file_import::{copy_android_file_uri_to_dir, is_android_file_uri};
#[cfg(any(target_os = "ios", test))]
use tauri::Url;

const COVER_THUMB_MAX_EDGE: u32 = 640;
const PROJECT_COVER_THUMB_MAX_EDGE: u32 = 1280;
const COVER_THUMB_JPEG_QUALITY: u8 = 82;

fn build_entry_images_dir(paths: &PathsState, project_id: &Uuid) -> Result<PathBuf, String> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(db_dir.join("images").join(project_id.to_string()))
}

fn canonical_images_root(paths: &PathsState) -> Result<PathBuf, String> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    let images_root = db_dir.join("images");
    std::fs::canonicalize(&images_root)
        .map_err(|e| format!("无法解析图片根目录 {:?}: {}", images_root, e))
}

fn ensure_image_path_allowed(paths: &PathsState, path: &Path) -> Result<PathBuf, String> {
    let canonical_requested =
        std::fs::canonicalize(path).map_err(|e| format!("无法访问图片路径 {:?}: {}", path, e))?;
    let canonical_root = canonical_images_root(paths)?;

    if !canonical_requested.starts_with(&canonical_root) {
        return Err(format!("图片路径不在允许范围内: {:?}", canonical_requested));
    }

    Ok(canonical_requested)
}

fn should_keep_existing_image(path: &Path, target_dir: &Path) -> bool {
    path.starts_with(target_dir)
}

/// iOS 文件选择器返回 `file://` URL，而 Rust 文件 API 需要解码后的本地绝对路径。
/// 普通路径保持原样，确保同一导入命令仍可接受应用内部生成的路径。
#[cfg(any(target_os = "ios", test))]
fn resolve_ios_file_dialog_path(raw_path: &str) -> Result<PathBuf, String> {
    if !raw_path.starts_with("file:") {
        return Ok(PathBuf::from(raw_path));
    }

    let file_url =
        Url::parse(raw_path).map_err(|error| format!("无法解析 iOS 图片文件 URL: {error}"))?;
    file_url
        .to_file_path()
        .map_err(|_| "iOS 图片文件 URL 不是可访问的本地路径".to_string())
}

fn build_entry_thumbnails_dir(paths: &PathsState, project_id: &Uuid) -> Result<PathBuf, String> {
    Ok(build_entry_images_dir(paths, project_id)?.join("thumbs"))
}

fn cover_thumbnail_hash(source_path: &Path) -> u64 {
    let mut hasher = DefaultHasher::new();
    source_path.to_string_lossy().hash(&mut hasher);
    if let Ok(metadata) = std::fs::metadata(source_path) {
        metadata.len().hash(&mut hasher);
        if let Ok(modified) = metadata.modified() {
            if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                duration.as_secs().hash(&mut hasher);
                duration.subsec_nanos().hash(&mut hasher);
            }
        }
    }
    hasher.finish()
}

pub(super) fn entry_cover_thumbnail_path(
    paths: &PathsState,
    project_id: &Uuid,
    source_path: &Path,
) -> Result<PathBuf, String> {
    if source_path.as_os_str().is_empty() {
        return Err("主图路径为空，无法生成缩略图".to_string());
    }
    if !source_path.exists() {
        return Err(format!("主图文件不存在: {:?}", source_path));
    }

    Ok(build_entry_thumbnails_dir(paths, project_id)?.join(format!(
        "cover_{:016x}.jpg",
        cover_thumbnail_hash(source_path)
    )))
}

fn project_cover_thumbnail_path(
    paths: &PathsState,
    project_id: &Uuid,
    source_path: &Path,
) -> Result<PathBuf, String> {
    if is_valid_cover_thumbnail(source_path) {
        return Ok(source_path.to_path_buf());
    }
    if source_path.as_os_str().is_empty() {
        return Err("项目封面路径为空，无法生成缩略图".to_string());
    }
    if !source_path.exists() {
        return Err(format!("项目封面文件不存在: {:?}", source_path));
    }

    Ok(build_entry_thumbnails_dir(paths, project_id)?.join(format!(
        "project_cover_{:016x}.jpg",
        cover_thumbnail_hash(source_path)
    )))
}

fn is_valid_cover_thumbnail(path: &Path) -> bool {
    let is_jpeg = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "jpg" | "jpeg"))
        .unwrap_or(false);
    let in_thumbs_dir = path
        .components()
        .any(|component| component.as_os_str().to_string_lossy() == "thumbs");
    is_jpeg && in_thumbs_dir && path.exists()
}

fn create_cover_thumbnail(
    source_path: &Path,
    thumb_path: PathBuf,
    max_edge: u32,
) -> Result<PathBuf, String> {
    let thumbs_dir = thumb_path
        .parent()
        .ok_or_else(|| format!("无法解析缩略图目录: {:?}", thumb_path))?;
    std::fs::create_dir_all(&thumbs_dir)
        .map_err(|e| format!("创建缩略图目录失败 {:?}: {}", thumbs_dir, e))?;

    if thumb_path.exists() {
        return Ok(thumb_path);
    }

    let image =
        image::open(source_path).map_err(|e| format!("读取主图失败 {:?}: {}", source_path, e))?;
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return Err(format!("主图尺寸无效: {:?}", source_path));
    }

    let scale = (max_edge as f64 / width.max(height) as f64).min(1.0);
    let target_width = ((width as f64 * scale).round() as u32).max(1);
    let target_height = ((height as f64 * scale).round() as u32).max(1);
    let resized = if target_width == width && target_height == height {
        image
    } else {
        image.resize(target_width, target_height, FilterType::Lanczos3)
    };

    let file = std::fs::File::create(&thumb_path)
        .map_err(|e| format!("创建缩略图失败 {:?}: {}", thumb_path, e))?;
    let mut writer = BufWriter::new(file);
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, COVER_THUMB_JPEG_QUALITY);
    encoder
        .encode_image(&resized.to_rgb8())
        .map_err(|e| format!("写入缩略图失败 {:?}: {}", thumb_path, e))?;

    Ok(thumb_path)
}

pub(super) fn create_entry_cover_thumbnail(
    paths: &PathsState,
    project_id: &Uuid,
    source_path: &Path,
) -> Result<PathBuf, String> {
    let thumb_path = entry_cover_thumbnail_path(paths, project_id, source_path)?;
    create_cover_thumbnail(source_path, thumb_path, COVER_THUMB_MAX_EDGE)
}

fn create_project_cover_thumbnail(
    paths: &PathsState,
    project_id: &Uuid,
    source_path: &Path,
) -> Result<PathBuf, String> {
    let thumb_path = project_cover_thumbnail_path(paths, project_id, source_path)?;
    if thumb_path == source_path {
        return Ok(thumb_path);
    }
    create_cover_thumbnail(source_path, thumb_path, PROJECT_COVER_THUMB_MAX_EDGE)
}

pub(super) fn use_derived_cover_thumbnails(
    paths: &PathsState,
    project_id: &Uuid,
    entries: &mut [EntryBrief],
) {
    for entry in entries {
        let Some(source_path) = entry.cover.as_ref() else {
            continue;
        };
        entry.cover = match entry_cover_thumbnail_path(paths, project_id, source_path) {
            Ok(path) => Some(path),
            Err(error) => {
                log::debug!(
                    "[cover_thumbnail] 跳过派生缩略图路径: entry_id={} path={:?} error={}",
                    entry.id,
                    source_path,
                    error
                );
                None
            }
        }
    }
}

async fn clear_thumbnail_job(
    state: &AppState,
    thumb_path: &Path,
    job_lock: &Arc<tokio::sync::Mutex<()>>,
) {
    let mut jobs = state.thumbnail_jobs.lock().await;
    if jobs
        .get(thumb_path)
        .map(|current| Arc::ptr_eq(current, job_lock))
        .unwrap_or(false)
    {
        jobs.remove(thumb_path);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverThumbnailMigrationSummary {
    pub scanned: usize,
    pub generated: usize,
    pub skipped: usize,
    pub failed: usize,
}

pub(super) async fn ensure_project_cover_thumbnails_with_progress<F>(
    db: &SqliteDb,
    paths: &PathsState,
    project_id: &Uuid,
    mut progress: F,
) -> Result<CoverThumbnailMigrationSummary, String>
where
    F: FnMut(usize, usize),
{
    let mut entries = Vec::new();
    let mut offset = 0usize;
    const PAGE_SIZE: usize = 200;

    loop {
        let batch = db
            .list_entries(project_id, EntryFilter::default(), PAGE_SIZE, offset)
            .await
            .map_err(|e| e.to_string())?;
        if batch.is_empty() {
            break;
        }
        let batch_len = batch.len();
        for brief in batch {
            entries.push(db.get_entry(&brief.id).await.map_err(|e| e.to_string())?);
        }
        offset += batch_len;
        if batch_len < PAGE_SIZE {
            break;
        }
    }

    let total = entries.len();
    let mut summary = CoverThumbnailMigrationSummary {
        scanned: 0,
        generated: 0,
        skipped: 0,
        failed: 0,
    };

    for entry in entries {
        summary.scanned += 1;
        let cover_image = entry.images.0.iter().find(|image| image.is_cover);
        let Some(cover_image) = cover_image else {
            if entry.cover_path.is_some() {
                db.update_entry(
                    &entry.id,
                    UpdateEntry {
                        category_id: None,
                        title: None,
                        summary: None,
                        content: None,
                        r#type: None,
                        tags: None,
                        images: None,
                        cover_path: Some(None),
                    },
                )
                .await
                .map_err(|e| e.to_string())?;
                summary.generated += 1;
            } else {
                summary.skipped += 1;
            }
            progress(summary.scanned, total);
            continue;
        };

        if entry
            .cover_path
            .as_deref()
            .map(Path::new)
            .map(is_valid_cover_thumbnail)
            .unwrap_or(false)
        {
            summary.skipped += 1;
            progress(summary.scanned, total);
            continue;
        }

        let thumb_path = match create_entry_cover_thumbnail(paths, project_id, &cover_image.path) {
            Ok(path) => path,
            Err(error) => {
                summary.failed += 1;
                log::warn!(
                    "[cover_thumbnail] 迁移词条主图缩略图失败: entry_id={} path={:?} error={}",
                    entry.id,
                    cover_image.path,
                    error
                );
                progress(summary.scanned, total);
                continue;
            }
        };
        let next_cover_path = thumb_path.to_string_lossy().to_string();
        if entry.cover_path.as_deref() == Some(next_cover_path.as_str()) {
            summary.skipped += 1;
            progress(summary.scanned, total);
            continue;
        }

        db.update_entry(
            &entry.id,
            UpdateEntry {
                category_id: None,
                title: None,
                summary: None,
                content: None,
                r#type: None,
                tags: None,
                images: None,
                cover_path: Some(Some(next_cover_path)),
            },
        )
        .await
        .map_err(|e| e.to_string())?;
        summary.generated += 1;
        progress(summary.scanned, total);
    }

    Ok(summary)
}

#[tauri::command]
pub fn open_entry_image_path(
    app: AppHandle,
    paths: State<'_, PathsState>,
    path: String,
) -> Result<(), String> {
    let allowed_path = ensure_image_path_allowed(paths.inner(), Path::new(&path))?;
    let folder_path = allowed_path
        .parent()
        .ok_or_else(|| format!("无法解析图片所在文件夹: {:?}", allowed_path))?;
    app.opener()
        .open_path(folder_path.to_string_lossy().into_owned(), None::<String>)
        .map_err(|e| format!("打开图片所在文件夹失败: {}", e))
}

pub(super) fn copy_entry_images(
    paths: &PathsState,
    project_id: &Uuid,
    images: Option<Vec<FCImage>>,
) -> Result<Option<Vec<FCImage>>, String> {
    let Some(images) = images else {
        log::info!("[copy_entry_images] images=None, 跳过复制");
        return Ok(None);
    };

    log::info!(
        "[copy_entry_images] 开始复制 {} 张图片, project_id={}",
        images.len(),
        project_id
    );

    let target_dir = build_entry_images_dir(paths, project_id)?;
    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("创建图片目录失败 {:?}: {}", target_dir, e))?;

    let total = images.len();
    let copied_images = images
        .into_iter()
        .enumerate()
        .map(|(i, mut image)| {
            log::info!(
                "[copy_entry_images] 图片 [{}/{}] path={:?} is_cover={}",
                i + 1,
                total,
                image.path,
                image.is_cover
            );
            if image.path.as_os_str().is_empty() {
                log::info!("[copy_entry_images] 图片 [{}] path为空，跳过", i);
                return Ok(image);
            }

            let source_path = image.path.clone();
            if should_keep_existing_image(&source_path, &target_dir) {
                log::info!("[copy_entry_images] 图片 [{}] 已在目标目录，跳过复制", i);
                return Ok(image);
            }
            if !source_path.exists() {
                log::error!(
                    "[copy_entry_images] 图片 [{}] 文件不存在: {:?}",
                    i,
                    source_path
                );
                return Err(format!("图片文件不存在: {:?}", source_path));
            }

            let extension = source_path
                .extension()
                .and_then(|ext| ext.to_str())
                .filter(|ext| !ext.is_empty());
            let file_name = match extension {
                Some(ext) => format!("{}.{}", Uuid::now_v7(), ext),
                None => Uuid::now_v7().to_string(),
            };
            let target_path = target_dir.join(&file_name);

            log::info!(
                "[copy_entry_images] 复制 {:?} -> {:?}",
                source_path,
                target_path
            );
            std::fs::copy(&source_path, &target_path).map_err(|e| {
                log::error!(
                    "[copy_entry_images] 复制失败: {:?} -> {:?}, {}",
                    source_path,
                    target_path,
                    e
                );
                format!(
                    "复制图片失败: {:?} -> {:?}, {}",
                    source_path, target_path, e
                )
            })?;

            image.path = target_path;
            log::info!(
                "[copy_entry_images] 图片 [{}] 复制完成, 新path={:?}",
                i,
                image.path
            );
            Ok(image)
        })
        .collect::<Result<Vec<_>, String>>()?;

    log::info!(
        "[copy_entry_images] 全部复制完成, 共 {} 张",
        copied_images.len()
    );
    Ok(Some(copied_images))
}

#[tauri::command]
pub fn import_entry_images(
    paths: State<'_, PathsState>,
    project_id: String,
    file_paths: Vec<String>,
) -> Result<Vec<FCImage>, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    #[cfg(target_os = "android")]
    let android_target_dir = {
        let target_dir = build_entry_images_dir(paths.inner(), &project_id)?;
        std::fs::create_dir_all(&target_dir)
            .map_err(|e| format!("创建图片目录失败 {:?}: {}", target_dir, e))?;
        target_dir
    };
    let images = file_paths
        .into_iter()
        .map(|path| {
            #[cfg(target_os = "android")]
            let path_buf = if is_android_file_uri(&path) {
                copy_android_file_uri_to_dir(&path, &android_target_dir)?
            } else {
                PathBuf::from(&path)
            };
            #[cfg(target_os = "ios")]
            let path_buf = resolve_ios_file_dialog_path(&path)?;
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            let path_buf = PathBuf::from(&path);

            Ok(FCImage {
                path: path_buf,
                is_cover: false,
                caption: None,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok(copy_entry_images(paths.inner(), &project_id, Some(images))?.unwrap_or_default())
}

#[tauri::command]
pub async fn import_remote_images(
    paths: State<'_, PathsState>,
    network: State<'_, NetworkState>,
    project_id: String,
    urls: Vec<String>,
) -> Result<Vec<FCImage>, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let target_dir = build_entry_images_dir(paths.inner(), &project_id)?;
    std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

    let mut images = Vec::new();
    for url in urls {
        // 清洗 URL：移除查询参数，提取纯净扩展名
        let clean_url = url.split('?').next().unwrap_or(&url);
        let ext = clean_url
            .split('.')
            .last()
            .filter(|value| !value.is_empty() && value.len() <= 8)
            .unwrap_or("png");
        let filename = format!("{}.{}", Uuid::now_v7(), ext);
        let local_path = target_dir.join(&filename);

        let bytes = network
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .bytes()
            .await
            .map_err(|e| e.to_string())?;

        std::fs::write(&local_path, &bytes).map_err(|e| e.to_string())?;

        images.push(FCImage {
            path: local_path,
            is_cover: false,
            caption: None,
        });
    }
    Ok(images)
}

#[tauri::command]
pub async fn db_ensure_project_cover_thumbnails(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, PathsState>,
    project_id: String,
) -> Result<CoverThumbnailMigrationSummary, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let db = open_project_db(state.inner(), &project_id).await?;
    ensure_project_cover_thumbnails_with_progress(&db, paths.inner(), &project_id, |_, _| {}).await
}

#[tauri::command]
pub async fn db_ensure_project_cover_thumbnail(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, PathsState>,
    project_id: String,
) -> Result<Option<String>, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let db = open_project_db(state.inner(), &project_id).await?;
    let project = db
        .get_project(&project_id)
        .await
        .map_err(|e| e.to_string())?;
    let Some(source_path) = project.cover_image.map(PathBuf::from) else {
        return Ok(None);
    };
    let thumb_path = match project_cover_thumbnail_path(paths.inner(), &project_id, &source_path) {
        Ok(path) => path,
        Err(error) => {
            log::warn!(
                "[cover_thumbnail] 无法派生项目封面缩略图路径: project_id={} path={:?} error={}",
                project_id,
                source_path,
                error
            );
            return Ok(None);
        }
    };
    if thumb_path.exists() {
        return Ok(Some(thumb_path.to_string_lossy().to_string()));
    }

    let job_lock = {
        let mut jobs = state.thumbnail_jobs.lock().await;
        jobs.entry(thumb_path.clone())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    };
    let guard = job_lock.lock().await;
    if thumb_path.exists() {
        drop(guard);
        return Ok(Some(thumb_path.to_string_lossy().to_string()));
    }

    let paths_state = paths.inner().clone();
    let source_path_for_task = source_path.clone();
    let result = match tauri::async_runtime::spawn_blocking(move || {
        create_project_cover_thumbnail(&paths_state, &project_id, &source_path_for_task)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => {
            drop(guard);
            clear_thumbnail_job(state.inner(), &thumb_path, &job_lock).await;
            return Err(format!("生成项目封面缩略图任务失败: {error}"));
        }
    };

    drop(guard);
    clear_thumbnail_job(state.inner(), &thumb_path, &job_lock).await;
    result.map(|path| Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn db_ensure_entry_cover_thumbnail(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, PathsState>,
    project_id: String,
    entry_id: String,
) -> Result<Option<String>, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let entry_id = Uuid::parse_str(&entry_id).map_err(|e| e.to_string())?;
    let db = open_project_db(state.inner(), &project_id).await?;
    let entry = db.get_entry(&entry_id).await.map_err(|e| e.to_string())?;
    if entry.project_id != project_id {
        return Err("词条不属于当前项目".to_string());
    }

    let Some(cover_image) = entry.images.0.iter().find(|image| image.is_cover) else {
        return Ok(None);
    };
    let source_path = cover_image.path.clone();
    let thumb_path = match entry_cover_thumbnail_path(paths.inner(), &project_id, &source_path) {
        Ok(path) => path,
        Err(error) => {
            log::warn!(
                "[cover_thumbnail] 无法派生词条主图缩略图路径: entry_id={} path={:?} error={}",
                entry_id,
                source_path,
                error
            );
            return Ok(None);
        }
    };
    if thumb_path.exists() {
        return Ok(Some(thumb_path.to_string_lossy().to_string()));
    }

    let job_lock = {
        let mut jobs = state.thumbnail_jobs.lock().await;
        jobs.entry(thumb_path.clone())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    };
    let guard = job_lock.lock().await;
    if thumb_path.exists() {
        drop(guard);
        return Ok(Some(thumb_path.to_string_lossy().to_string()));
    }

    let paths_state = paths.inner().clone();
    let project_id_for_task = project_id;
    let source_path_for_task = source_path.clone();
    let result = match tauri::async_runtime::spawn_blocking(move || {
        create_entry_cover_thumbnail(&paths_state, &project_id_for_task, &source_path_for_task)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => {
            drop(guard);
            clear_thumbnail_job(state.inner(), &thumb_path, &job_lock).await;
            return Err(format!("生成缩略图任务失败: {error}"));
        }
    };

    drop(guard);
    clear_thumbnail_job(state.inner(), &thumb_path, &job_lock).await;

    result.map(|path| Some(path.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_ios_file_dialog_url_with_spaces_and_unicode() {
        let temp = tempfile::tempdir().expect("应创建临时目录");
        let expected = temp.path().join("图片 IMG 3576.jpeg");
        std::fs::write(&expected, b"test image bytes").expect("应创建临时图片");
        let file_url = Url::from_file_path(&expected).expect("应创建本地文件 URL");
        let resolved =
            resolve_ios_file_dialog_path(file_url.as_str()).expect("应解析 iOS 文件 URL");

        assert_eq!(resolved, expected);
        assert!(resolved.exists(), "解码后的路径应能被 Rust 文件 API 访问");
    }

    #[test]
    fn keeps_plain_ios_file_dialog_path_unchanged() {
        let expected = std::env::temp_dir().join("plain-image.jpeg");
        let raw_path = expected.to_string_lossy().to_string();

        assert_eq!(
            resolve_ios_file_dialog_path(&raw_path).expect("应保留普通文件路径"),
            expected
        );
    }

    #[test]
    fn project_cover_thumbnail_limits_long_edge() {
        let temp = tempfile::tempdir().expect("应创建临时目录");
        let project_id = Uuid::now_v7();
        let project_images = temp.path().join("images").join(project_id.to_string());
        std::fs::create_dir_all(&project_images).expect("应创建项目图片目录");
        let source_path = project_images.join("cover.png");
        image::DynamicImage::new_rgb8(1600, 800)
            .save(&source_path)
            .expect("应写入测试封面");
        let paths = PathsState {
            db_path: temp.path().join("worldflow.db"),
            plugins_path: temp.path().join("plugins"),
        };

        let thumbnail = create_project_cover_thumbnail(&paths, &project_id, &source_path)
            .expect("应生成项目封面缩略图");

        assert_eq!(image::image_dimensions(thumbnail).unwrap(), (1280, 640));
    }
}
