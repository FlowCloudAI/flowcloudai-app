//! FlowCloudAI 的系统相机插件。
//!
//! Android 端只委托系统相机拍摄一张原图，原生层把结果写入应用私有缓存；
//! WebView 仅获得路径和元数据。插件不负责图片持久化、编辑或 AI 模型输入。

use serde::{Deserialize, Serialize};
use tauri::{Manager, Runtime, plugin::TauriPlugin};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

mod commands;
mod error;

pub use error::{Error, Result};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "cn.flowcloudai.camera";

/// 系统相机返回的应用私有临时图片。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapturedPhoto {
    /// 应用私有缓存中的绝对路径；调用方消费完后可以移动、导入或删除。
    pub temp_path: String,
    pub mime_type: String,
    pub width: u32,
    pub height: u32,
    pub byte_length: u64,
}

pub(crate) struct FlowCamera<R: Runtime> {
    #[cfg(target_os = "android")]
    mobile_plugin_handle: PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _marker: std::marker::PhantomData<fn() -> R>,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscardPhotoRequest<'a> {
    temp_path: &'a str,
}

impl<R: Runtime> FlowCamera<R> {
    async fn capture(&self) -> Result<CapturedPhoto> {
        #[cfg(target_os = "android")]
        {
            return self
                .mobile_plugin_handle
                .run_mobile_plugin_async("capture", ())
                .await
                .map_err(Into::into);
        }

        #[cfg(not(target_os = "android"))]
        Err(Error::UnsupportedPlatform)
    }

    async fn discard(&self, temp_path: &str) -> Result<()> {
        #[cfg(target_os = "android")]
        {
            return self
                .mobile_plugin_handle
                .run_mobile_plugin_async("discard", DiscardPhotoRequest { temp_path })
                .await
                .map_err(Into::into);
        }

        #[cfg(not(target_os = "android"))]
        {
            let _ = temp_path;
            Err(Error::UnsupportedPlatform)
        }
    }
}

/// 初始化插件；非 Android 平台仍注册同名命令，并返回明确的不支持错误。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("flow-camera")
        .invoke_handler(tauri::generate_handler![
            commands::capture,
            commands::discard
        ])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let camera = FlowCamera {
                mobile_plugin_handle: api
                    .register_android_plugin(PLUGIN_IDENTIFIER, "CameraPlugin")?,
            };

            #[cfg(not(target_os = "android"))]
            let camera: FlowCamera<R> = {
                let _ = api;
                FlowCamera {
                    _marker: std::marker::PhantomData,
                }
            };

            app.manage(camera);
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::CapturedPhoto;

    #[test]
    fn captured_photo_keeps_native_contract_fields() {
        let photo = CapturedPhoto {
            temp_path: "/cache/flow-camera/photo.jpg".into(),
            mime_type: "image/jpeg".into(),
            width: 4032,
            height: 3024,
            byte_length: 2_048,
        };

        let value = serde_json::to_value(photo).expect("相机结果应可序列化");
        assert_eq!(value["tempPath"], "/cache/flow-camera/photo.jpg");
        assert_eq!(value["mimeType"], "image/jpeg");
        assert_eq!(value["width"], 4032);
        assert_eq!(value["height"], 3024);
        assert_eq!(value["byteLength"], 2_048);
        assert!(value.get("temp_path").is_none());
    }
}
