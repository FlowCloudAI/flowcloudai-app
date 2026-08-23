# Android 测试流程

本文记录 FlowCloudAI 的 Android 测试约定。默认在 Windows PowerShell 下执行，包名为 `cn.flowcloudai.www`。

## 前置检查

1. 确认模拟器或真机在线：

   ```powershell
   adb devices
   ```

2. 如果同时连接了多个设备，先指定目标设备：

   ```powershell
   $env:ANDROID_SERIAL = "emulator-5554"
   ```

3. 常用日志过滤前先清空旧日志：

   ```powershell
   adb logcat -c
   ```

## Dev 测试

Dev 测试用于日常功能验证、快速复现问题、查看前端改动和启动日志。它会依赖本机开发服务和 `adb reverse`，不能代表真实安装包行为。

1. 启动 Android dev 模式：

   ```powershell
   npm run android:dev
   ```

   当前脚本会自动执行：

    - 等待设备连接。
    - 清理并配置 `adb reverse`。
    - 设置 Cargo dev profile，剥离 Rust debuginfo，避免调试包过大。
    - 启动 `tauri android dev --host 127.0.0.1`。

2. 重点验证：

    - 页面能正常打开，没有白屏。
    - 修改前端后能正常刷新或重新加载。
    - Rust 后端没有 panic。
    - WebView 没有资源加载失败。
    - Android 私有目录、数据库路径、模板路径等平台路径正确。

3. 抓取本次启动日志：

   ```powershell
   adb logcat -c
   adb shell monkey -p cn.flowcloudai.www -c android.intent.category.LAUNCHER 1
   Start-Sleep -Seconds 8
   $appPid = (adb shell pidof -s cn.flowcloudai.www).Trim()
   adb logcat --pid $appPid -d -t 500
   ```

## Debug APK 测试

Debug APK 测试用于验证“不依赖 Vite dev server”的安装包行为，适合检查资源打包、模板内嵌、数据库路径、启动初始化等问题。它仍然是
debug 构建，不等同于 release。

1. 构建 x86_64 模拟器调试 APK：

   ```powershell
   npm run android:build:debug:x86_64
   ```

2. 安装最新 debug APK：

   ```powershell
   $apk = "src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk"
   adb install -r -d -t $apk
   ```

3. 启动并看日志：

   ```powershell
   adb logcat -c
   adb shell monkey -p cn.flowcloudai.www -c android.intent.category.LAUNCHER 1
   Start-Sleep -Seconds 8
   $appPid = (adb shell pidof -s cn.flowcloudai.www).Trim()
   adb logcat --pid $appPid -d -t 500
   ```

4. 重点验证：

    - 不启动 Vite 时应用仍能打开。
    - 内置模板、前端 `dist`、图标等资源可访问。
    - 日志中没有开发机本机绝对路径（如 `E:\Projects\...`、`/Users/<用户名>/...`）。
    - APK 体积没有异常膨胀。

## Release 测试

Release 测试用于交付前验证真实安装包。它不依赖本机开发服务，也不应依赖 `adb reverse`。

1. 构建 release APK：

   ```powershell
   npm run android:build:apk
   ```

2. 查找最新 release APK：

   ```powershell
   $apk = Get-ChildItem -LiteralPath "src-tauri\gen\android\app\build\outputs\apk" -Recurse -Filter "*.apk" |
     Where-Object { $_.FullName -like "*release*" } |
     Sort-Object LastWriteTime -Descending |
     Select-Object -First 1 -ExpandProperty FullName
   ```

3. 安装 release APK：

   ```powershell
   adb install -r $apk
   ```

   如果提示签名不兼容，说明设备上已有 debug 包，先卸载再安装：

   ```powershell
   adb uninstall cn.flowcloudai.www
   adb install $apk
   ```

4. 启动并抓取日志：

   ```powershell
   adb logcat -c
   adb shell monkey -p cn.flowcloudai.www -c android.intent.category.LAUNCHER 1
   Start-Sleep -Seconds 8
   $appPid = (adb shell pidof -s cn.flowcloudai.www).Trim()
   adb logcat --pid $appPid -d -t 500
   ```

5. 重点验证：

    - 冷启动正常，没有白屏或闪退。
    - 前端静态资源来自安装包，不依赖 Vite。
    - 数据库位于 Android 应用私有目录。
    - 内置模板、图片访问、插件安装、文件选择等平台能力正常。
    - 日志中没有 Rust panic、WebView 资源错误、路径错误和权限错误。

## 截图与取证

需要保留截图时使用设备文件中转，避免 PowerShell 直接重定向二进制流：

```powershell
adb shell screencap -p /sdcard/flowcloudai-test.png
adb pull /sdcard/flowcloudai-test.png .\flowcloudai-test.png
```

需要查看当前 UI 树：

```powershell
adb exec-out uiautomator dump /dev/tty
```

## 选择标准

- 只验证普通 UI 或业务流程：优先跑 Dev 测试。
- 验证资源路径、模板、数据库、Tauri 配置、Android 权限：至少跑 Debug APK 测试。
- 准备交付、发布、回归平台能力：必须跑 Release 测试。
- 不要直接把 Gradle `assemble` 当作主要入口；优先使用 `npm run android:*` 或 `tauri android build`，确保 Tauri 的构建上下文完整。
