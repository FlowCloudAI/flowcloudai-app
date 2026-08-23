# iOS 输入视口回归验证

> 问题 → 方案的摘要记录见 `docs/devlog/2026-08-18-ios-输入视口-二次缩短.md`（在工作区根仓库，不在本仓）。本目录是证据包，截图与验证边界以本文为准。

## 验证对象

- 应用：FlowCloudAI 移动端（`cn.flowcloudai.www`）
- 设备：iPhone 17 Pro 模拟器
- 系统：iOS 26.5
- 流程：首页启动 → 点击“灵感”Tab → 自动聚焦全文输入框 → 确认软键盘出现 → 截图
- 驱动方式：XCUITest 通过可访问名称定位真实控件，不依赖浏览器 mock 或坐标脚本

## 结论

问题由移动壳层重复处理软键盘高度引起。WKWebView 已经完成键盘避让后，旧实现又把 `visualViewport.height` 写回 `.mobile-app` 根节点，导致应用高度被二次缩短，全文输入框被挤到页面顶部，并在输入框与键盘之间留下大面积无效空白。

修复后，`visualViewport` 只参与“键盘是否可见”的状态判断，用于隐藏底部 Tab 和安排返回行为；根节点保持 `100dvh`，交由 WebView 处理键盘可用高度。iOS 与 Android 使用同一套 React/CSS 移动端逻辑。

后续又发现系统直接收起键盘时，输入框可能继续保持焦点。旧逻辑把“有文本焦点”等同于“键盘仍在显示”，因此 Tab 无法恢复。当前实现记录每次焦点会话是否真正出现过软键盘：首次聚焦仍立即隐藏 Tab；键盘曾出现后又被系统收起，则普通输入恢复 Tab；`data-mobile-editing` 声明的整页编辑态仍按既定交互保持 Tab 隐藏。

真机反馈又暴露了第二种事件顺序：部分 WebView 会先按键盘高度缩短 viewport，随后才派发 `focusin`。如果在 `focusin` 当下采样，缩短后的高度会被误当成完整视口，后续即使系统收起键盘也无法识别高度恢复。最终实现改为缓存最近一次无键盘的完整视口；焦点保留期间每 250ms 低频补采样，兜底处理系统收起键盘却漏发 `resize` 的 WebView，同时不再反复推迟 180ms 的 Tab 恢复计时器。

## 截图证据

1. `01-home-before-focus.png`：主页未聚焦基线。
2. `02-home-keyboard-regression.png`：旧实现的主页输入状态；由于输入框原本就在顶部，该页面不足以单独证明缺陷。
3. `03-home-keyboard-fixed.png`：修复后的主页输入状态。
4. `04-idea-editor-keyboard-regression.png`：同一流程下的旧实现；输入框被压成顶部短条，下方到键盘之间存在大面积空白。
5. `05-idea-editor-keyboard-fixed.png`：从最终修复源码重建并安装后复拍；全文输入区连续填满键盘上方空间。
6. `06-home-keyboard-dismissed-tabs-restored.png`：通过 Simulator 系统菜单收起软键盘，输入框仍保留蓝色焦点边框，底部四个 Tab 已恢复。
7. `07-home-keyboard-visible-final.png`：从包含完整视口缓存修复的最终源码重建；键盘打开时 Tab 隐藏。
8. `08-home-keyboard-dismissed-tab-restored-final.png`：同一次焦点会话中用 Simulator 系统菜单收起键盘；输入框仍聚焦，四个 Tab 已恢复。

## 自动化与可访问性结果

- XCUITest 可按“灵感”可访问名称定位 Tab，并能定位全文 `TextView`。
- 软键盘出现断言通过。
- 输入模式下 Tab 的视觉隐藏、`aria-hidden`、`inert` 和点击禁用逻辑仍由移动壳层专项测试覆盖。
- `npm run test:mobile-shell`：34/34 通过；其中输入状态覆盖 iOS overlay、Android resize-content、先 resize 后 focus、键盘收起但焦点保留、漏发 resize 的补采样、整页编辑态与沉浸编辑隔离。
- XCUITest 负责启动真实应用、点击“快速记录灵感”输入框并确认软键盘出现；Simulator 的系统键盘菜单负责制造“键盘收起但焦点保留”状态。该主机菜单切换后 XCUITest 的键盘/导航可访问快照没有同步刷新，因此最终 Tab 恢复以模拟器直接截图和纯状态测试为证据，没有把失真的端到端断言标记为通过。

## 验证边界

- 已验证：iOS 模拟器竖屏、主页快速输入、灵感全文编辑、软键盘出现与最终视觉布局。
- 未验证：iPhone 真机键盘动画、横屏、第三方键盘、VoiceOver 全流程，以及 Android 原生包/真机表现。
- 当前 Mac 缺少或未配置 Android SDK/NDK，因此只能确认 Android 会消费同一共享实现，不能把它标记为原生验收通过。
