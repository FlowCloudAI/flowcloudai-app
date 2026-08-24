//! 为 Tauri 生成相机命令权限，并在 Android 构建中挂载仓库内的 Kotlin 模块。

const COMMANDS: &[&str] = &["capture", "discard"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
