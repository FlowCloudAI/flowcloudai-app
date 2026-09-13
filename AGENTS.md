# app_main — AGENTS.md

Tauri 2 + React 19 主应用，一套代码承载 Windows、Linux、macOS、Android、iOS；前端只经 `src-tauri` 访问文件与系统能力。

文档索引 `docs/README.md`（覆盖 `docs/`、`plans/`、`designs/`）；踩坑记录在工作区根 `docs/devlog/`，本仓条目最多。

## 验证

- 前端改动跑 `npm run lint && npm run build`；`src-tauri/` 有改动再跑 `cargo check` / `cargo test`。
- Windows 上 `cargo test` 可能报 `STATUS_ENTRYPOINT_NOT_FOUND`：测试 exe 缺 common-controls v6 清单，是清单/链接问题，`cargo clean` 无效（根 `docs/devlog/2026-06-02-cargo-test-入口点缺失.md`）。
- 浏览器预览不加载 Tauri 后端，依赖真实数据的界面只能用原生应用或 debug APK + ADB 验证；静态布局例外，详见根 `AGENTS.md`「验证」。
- 打包、发布或原生配置（窗口、CSP、capability、签名）改动：构建成功不等于可用，要实际运行产物，验收清单在对应平台手册里。

## 平台

动某个平台的窗口、构建或发布链路前先读对应手册：macOS `docs/tauri_macos_debug_and_release.md`、iOS `docs/tauri_ios_debug_and_release.md`、Android `docs/Android.md`。以下几条改错会直接坏掉，而且从代码里看不出来：

- **启动顺序敏感**：Windows 无边框透明窗口、macOS 隐藏的 Overlay 窗口都依赖初始化顺序，出错表现为白屏或窗口不出现。主窗口初始 `visible: false`，前端 ready/failed 后直接调 `showWindow()`；不要包进 `requestAnimationFrame`——macOS 会暂停隐藏 WKWebView 的帧回调，窗口不显示就没有下一帧，形成启动死锁。
- **dev 端口**：桌面/iOS 为 `5175`、HMR `1421`，`src-tauri/tauri.conf.json` 与 `vite.config.ts` 必须一致；Android 覆盖为 `5176`/`1422`，改动时同步 `vite.config.ts`、`src-tauri/tauri.android.conf.json`、`scripts/android-dev.cjs` 三处。
- **macOS**：`tauri.macos.conf.json` 必须保留 `create: false`，由 setup 创建唯一的 `main` 窗口，否则重复 label 启动即崩。setup 阶段不能启用 `tauri-plugin-single-instance`：新进程可能在 Launch Services 交付文件 URL 前退出，吞掉 Finder 双击。透明窗口依赖 `macos-private-api`，Mac App Store 不接受，换发行渠道前要先替换实现。
- **共享 CSP 与 capability**：CSP 必须允许 `connect-src 'self' ipc: http://ipc.localhost`，否则打包后 WebKit 持续报 IPC 违规；启用 `zoomHotkeysEnabled` 时桌面 capability 要含 `core:webview:allow-set-webview-zoom`。这是全平台共享配置，改完回归所有平台。
- **iOS**：`src-tauri/gen/apple/` 是可重建的生成目录，长期改动写进 `src-tauri/ios/project.yml` 与 `src-tauri/icons/ios/`，否则 `ios:init` 后丢失。每次安装的沙箱容器 UUID 可能变化，移动端不能持久化系统默认数据目录的绝对路径。
- **Android 签名**：已发布版本必须永久复用同一把 release keystore。`scripts/sign-android-apk.ps1` 在默认 keystore 不存在时会**新建**密钥，只适合首次建钥——执行前确认路径，换电脑也不能重建。
- `.fcworld` / `.fcplug` 的系统打开请求统一进入 `src-tauri/src/desktop_file_open.rs` 队列，再由前端串行进入导入/安装确认；任何平台都不能在原生事件回调里跳过确认直接改数据。
- Team ID、Apple 凭据、证书、keystore 与密码文件只放本机环境或 CI secrets。

## 移动端界面

- 页面文件不超过 800 行，超过前先拆 hook 或子组件（`src/app/mobile/pages/` 由 eslint `max-lines` 检查）。
- 移动端界面代码不直接 import `@tauri-apps/*`，经 `src/api/` 或共享适配层，浏览器预览才能 mock、双端才能同测（`src/app/mobile/` 由 eslint 检查）。
- 新增横向滚动区域加 `data-mobile-horizontal-scroll`，侧边抽屉手势据此放行横滑。不要为 Android 纵向压扁问题恢复 `translateZ(0)` 强制合成层：2026-07-13 起暂停，Chromium 148 模拟器持续 tile 内存超限、可能触发 renderer OOM，而真机未复现压扁。
- 跨页或跨端共享状态走 store（参考 `projectListStore` 的 `useSyncExternalStore` 模式），不新增 `CustomEvent` 事件名做长期同步。
- **软键盘布局只有一个 owner**：WebView 与应用外壳几何保持稳定，Android / iOS 各自的原生适配器发布遮挡量 `--fc-kb`，前端只压缩 AI 消息区、灵感正文等内部空间。不写根高度、不整壳平移、不预测键盘高度；`visualViewport` 只用于判断输入态。消费公式、已接入页面与验收边界见 `docs/mobile_keyboard_layout.md`。已实测无效、不要再试：Tauri Android WebView 的 `navigator.virtualKeyboard` 可写但 `env(keyboard-inset-height)` 恒为 0、`geometrychange` 不触发；viewport meta 的 `interactive-widget` 三个取值在 iOS 与 Android 上都无差异。
- 侧边抽屉拖动态 `is-drawer-dragging` 与页面边缘返回 `is-edge-back-direct` 必须分开，不能重新引入同时命中外壳与页面层的 `is-dragging`，否则 Android WebView 在手势开始和回弹结束时各闪一次。改这组状态或 selector 时运行 `mobilePageTransition.test.mjs`；真机慢拖与取消回弹需要用户验证，交付时说明。

## 桌面布局

- 工作区页面区与 Dock 槽位由 `.workspace-content` 的 `grid-template-areas` 定位，不依赖 DOM 顺序；新增槽位只扩展 areas，不改回 flex 横排。
- 中央页面主体最小宽度统一用 `--workspace-page-content-min-width`，主页、设置、项目/词条编辑不各自硬编码。
- `--app-drag-handle-width` 同时控制外壳留白、Dock 间距与侧栏拖拽手柄，macOS 下也不能设为 0。

## 复用与数据安全

- 新界面先查 `flowcloudai-ui`（导出以 `lib_ui/ui/src/index.ts` 为准）与 `src/shared/ui`：浮层用 `shared/ui/overlay`（`Overlay` / `FloatingPanel` 已处理 portal、遮罩、Esc、滚动锁与返回栈），Dock 面板用 `shared/ui/layout`，词条/标签表单复用 `TagCreator`、`EntryTypeCreator` 等现有领域组件，词条正文双端都用 `features/entries/components/MarkdownEditor`，缺 AI 插件提示用 `AiPluginMissingOverlay`。主题、右键菜单与 alert 的 Provider 已在 `src/app/index/AppShell.tsx` 接入，不另建。
- **监听后端 `*-request` 事件的确认组件必须同时挂到 `DesktopApp` 和 `MobileApp`**，漏挂一端会让后端请求静默挂起。
- **任何渲染 Markdown 的表面都要自己接管锚点点击**：容器 `onClick` 里用 `resolveMarkdownAnchor` 取锚点、无条件 `preventDefault`，再决定跳词条、走 `api/opener` 还是提示拒绝。WebView 主文档一旦导航离开，整个应用连同未保存内容被替换且无法返回；`AppShell` 的 `useTopLevelNavigationGuard` 只是兜底，不是可以不接的许可。2026-08-25 因此丢过一次正文（根 `docs/devlog/2026-08-25-移动端预览链接把应用打没.md`）。

## 设计稿

用户要"设计稿 / 视觉规划 / 界面方案"，或新增整页、大改布局而用户没给出具体布局要求时，先做 `designs/<主题>.html` 单文件设计稿，确认后再实现；其余界面改动直接实现。制作规则见 `designs/设计稿约定.md`。

## 提交

PR 附实际跑过的验证命令与结果、关键风险；动启动链路时说明白屏、窗口初始化与插件加载顺序的核验。
