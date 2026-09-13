# macOS 调试与发布流程

> 状态：现行 ｜ 日期：2026-09-13

本文记录 `app_main` 的 macOS 原生窗口、调试、打包、签名与公证边界。所有命令都在 Mac 的 `app_main` 根目录执行。

## 1. 当前架构

- macOS 与 Windows/Linux 共用 React 桌面业务壳、Rust 后端、数据库与插件能力，不维护一份 SwiftUI 业务副本。
- `src-tauri/tauri.macos.conf.json` 只在 macOS 构建时覆盖窗口与安装包配置，不影响 Windows、Linux、Android 或 iOS。
- macOS 使用 AppKit 原生标题栏、交通灯和系统菜单。Windows/Linux 继续使用应用内的自绘窗口按钮。
- `.fcplug` 与 `.fcworld` 的扩展名关联由共享 `tauri.conf.json` 声明；macOS 专属 UTI 和 Finder 图标由 `src-tauri/Info.macos.plist`、`src-tauri/icons/*.icns` 提供，不复用 Windows 的 NSIS 注册表钩子。
- macOS 主窗口保持 `create: false`，由 setup 读取合并后的平台配置创建唯一窗口；同时保留 `decorations: true` 与 `titleBarStyle: Overlay`，启用透明 WKWebView 和 `underWindowBackground` 系统材质。设置中的“毛玻璃效果”会同时控制原生材质与 WebView 半透明着色层。
- Tauri 的透明 WKWebView 依赖 `app.macOSPrivateApi: true` 和 Cargo `macos-private-api` 特性。该实现使用系统 `NSVisualEffectView` 做模糊，但透明背景入口仍属于 Tauri 标注的私有 API：当前官网 Developer ID DMG 路线接受这一取舍，Mac App Store 不接受。正式 DMG 必须以实际公证结果为准。
- 当前正式发行目标是官网直接下载的已签名、公证 DMG。Mac App Store 需要 App Sandbox，而现有自定义数据目录、插件和通用文件访问必须先完成单独的沙箱兼容评估。
- 交通灯位置当前验收值为 `trafficLightPosition: {x: 16, y: 26}`；`src/App.css` 在 macOS 隐藏应用内 Logo，但保留 `5.25rem` 的交通灯避让。调整坐标要同步检查主页/Tab 左侧间距，并在不同缩放与内外接屏幕上验证，未经验收不提交新坐标值。
- 不要给 `fileAssociations` 添加当前 schema 不支持的 `icon` 字段，也不要把文件类型配置写进生成的 `.app/Contents/Info.plist`；长期来源是 `src-tauri/Info.macos.plist` 与 `src-tauri/icons/fcplug.icns`、`fcworld.icns`。
- `.fcworld` / `.fcplug` 的系统打开请求统一进入 `src-tauri/src/desktop_file_open.rs` 队列：Windows/Linux 由单实例参数转发，macOS 由 `RunEvent::Opened` 转发，再由 `src/features/desktop-file-open/DesktopFileOpenController.tsx` 串行消费并进入导入/安装确认。macOS 禁止在 setup 阶段启用 `tauri-plugin-single-instance`，否则新进程可能在 Launch Services 交付文件 URL 前退出并吞掉 Finder 双击事件；任何平台都不能在原生事件回调中绕过确认直接改数据。
- `scripts/macos-workflow.mjs` 统一执行环境检查、dev、本地 Release 和正式 Universal 发布。Mac 专属行为收口在平台配置、OS class 或 target 条件代码中，不为 macOS 复制 `MacApp.tsx` 或 React 业务状态。
- `--app-drag-handle-width` 同时控制桌面 shell 留白、Dock 面板间距和侧栏拖拽手柄；原生窗口边框负责缩放，不等于可以把它设为 `0`。
- `src-tauri/tauri.conf.json` 的 CSP 必须允许 `connect-src 'self' ipc: http://ipc.localhost`，否则打包后的 WebKit 会持续报告 Tauri IPC 违规；启用 `zoomHotkeysEnabled` 时桌面 capability 必须包含 `core:webview:allow-set-webview-zoom`。二者是共享配置，修改后要回归 Windows、Linux 与移动端。

## 2. 首次环境检查

```zsh
npm install
npm run macos:doctor
```

`macos:doctor` 会检查 Xcode、macOS SDK、Apple Silicon/Intel 两个 Rust target、本地 Tauri CLI、平台配置和图标。Developer ID 与公证凭据只影响正式站外发行，不阻止本机调试。

## 3. 日常调试

```zsh
npm run macos:dev
```

该命令等价于在当前 Mac 上启动 Tauri 开发模式，终端会持续显示前端、Rust 与 WebView 相关日志。开发模式只编译当前机器架构，不会额外编译 iOS、Windows、Android 或 Intel 版本。

- React/TypeScript/CSS 保存后走 Vite HMR，Rust 自动重编译；`tauri.macos.conf.json` 等原生窗口配置会触发应用重建/重启，不能靠 HMR 验证。
- 主窗口初始为 `visible: false`，前端后端状态变为 ready/failed 后直接调用 `showWindow()`。不要把显示操作包进 `requestAnimationFrame`：macOS 可能暂停隐藏 WKWebView 的帧回调，形成“窗口不显示就没有下一帧”的启动死锁。正常启动日志必须出现 `主窗口显示完成 platform=macos ... visible_after=true`。
- React StrictMode/HMR 可能让 Tauri 原生监听器先于 React cleanup 被释放；事件清理统一经过 `src/api/events.ts` 的安全释放逻辑，窗口 resize/close 监听也不能直接调用异步 unlisten 而留下未处理拒绝。
- 同时只运行一个 macOS dev/Release 实例与一套 Vite 服务。程序坞有图标但没有窗口时，先检查端口和旧进程，再看窗口显示日志，不要先归因于前端白屏。

首轮至少验证：

1. 左上角显示原生红黄绿交通灯，顶部没有重复的 Windows 风格按钮。
2. 顶栏、侧栏与内容卡片间隙能透出经过模糊的桌面或后方窗口；不得只看到锐利透明背景，也不得被不透明 WebView 底色完全盖住。窗口失焦时材质应跟随系统切换为非活动状态。
3. 在设置中关闭“毛玻璃效果”后原生材质与半透明着色层同时消失，重新开启后恢复；不能只切换组件 CSS。
4. 拖动顶栏、缩放、最小化、全屏、关闭窗口和未保存内容拦截均正常，重点检查透明窗口阴影与圆角是否出现黑边或闪烁。
5. `Command+C/V/A/Q`、系统菜单与文本输入正常。
6. 项目、词条、聊天、插件、图片/文件导入和日志读取能够工作。
7. API Key 重启后仍可从 Keychain 读取。
8. 默认数据目录和桌面端自定义数据目录都能重启恢复；iOS 的移动沙箱路径策略不会覆盖 macOS 设置。
9. Finder 中 `.fcplug` 与 `.fcworld` 显示各自图标；“打开方式”包含流云AI。图标正确只代表 Launch Services 元数据生效，不代表双击后的导入/安装业务已经接通。

## 4. 本地安装包

```zsh
npm run macos:build:debug
npm run macos:build:local
```

- `macos:build:debug` 生成当前架构的未签名 Debug `.app`，用于快速验证打包资源。
- `macos:build:local` 生成当前架构的 Release `.app` 与 `.dmg`，使用 ad-hoc 签名，只适合本机/内部验证，其他用户打开时仍可能看到 Gatekeeper 提示。
- 产物位于 `src-tauri/target/<profile>/bundle/macos/` 与 `src-tauri/target/<profile>/bundle/dmg/`，不提交 Git。
- 前端或 Tauri 配置变化会重新嵌入资源并触发 Release 链接，在 Apple Silicon 开发机上可能耗时数分钟；这不代表在编译全平台。
- 文件图标变更后检查 `.app/Contents/Info.plist` 的 `CFBundleDocumentTypes`、`UTExportedTypeDeclarations`，并确认两个 `.icns` 位于 `.app/Contents/Resources/`。

## 5. 正式站外发行

正式发行需要付费 Apple Developer Program 中的 `Developer ID Application` 证书、公证凭据，以及与现有 updater 公钥匹配的 Tauri 更新签名私钥。敏感值只放本机环境或 CI Secret：

```zsh
export APPLE_SIGNING_IDENTITY="Developer ID Application: 你的名称 (TEAMID)"
export APPLE_API_ISSUER="App Store Connect Issuer ID"
export APPLE_API_KEY="Key ID"
export APPLE_API_KEY_PATH="/绝对路径/AuthKey_XXXXXX.p8"
export TAURI_SIGNING_PRIVATE_KEY="/绝对路径/tauri-updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="更新签名密钥密码"
export MACOS_BUILD_NUMBER="42"

npm run macos:build:release
```

也可使用 `APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID` 代替 API Key 三件套。`APPLE_PASSWORD` 应使用 App 专用密码或钥匙串引用，不要写入脚本。

正式命令默认构建 `universal-apple-darwin`，同时支持 Apple Silicon 与 Intel，因此编译时间和产物大小都会高于日常单架构构建。若明确只发行 Apple Silicon，可临时设置：

```zsh
MACOS_TARGET=aarch64-apple-darwin MACOS_BUILD_NUMBER=42 npm run macos:build:release
```

每次发布必须递增 `MACOS_BUILD_NUMBER`。构建完成后还要在另一台 Mac 或全新用户账户验证 DMG 挂载、拖入 Applications、首次启动、Gatekeeper、公证状态、自动更新和数据恢复。

透明 WKWebView 使用了 Tauri 的 `macos-private-api`。每个正式版本都必须对最终 DMG 执行公证并验证 Gatekeeper；如果 Apple 后续收紧站外公证规则，应回退为不透明窗口或改用不需要透明 WKWebView 的原生容器方案，不能绕过公证发布。

参考：[Tauri macOS 签名与公证](https://v2.tauri.app/distribute/sign/macos/)、[Tauri DMG](https://v2.tauri.app/distribute/dmg/)。

## 6. 不可提交内容

- Developer ID/Distribution 证书、`.p12`、`.p8`、描述文件和钥匙串导出。
- Apple ID、App 专用密码、Team ID、API Key、Issuer ID。
- Tauri updater 私钥及密码。
- `src-tauri/target/`、`.app`、`.dmg`、公证日志和本机数据目录。
