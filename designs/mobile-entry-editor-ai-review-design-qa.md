# 移动端词条编辑与 AI 差异审阅视觉 QA

## 对照目标

- 源设计：`designs/mobile-entry-editor.html`
- 源设计：`designs/mobile-ai-entry-review.html`
- 实现位置：`src/app/mobile/pages/MobileEntryDetailEditView.tsx`、`src/app/mobile/pages/MobileEntryImmersiveEditor.tsx`、`src/features/entries/components/EntryEditModal.tsx`
- 目标视口：390 × 844 CSS px、360 × 740 CSS px
- 状态：编辑页紧凑态、沉浸正文键盘展开态、AI 审阅等待态、AI 审阅 busy 态

## 证据

- 源设计像素尺寸：未捕获；源文件为可交互 HTML 设计稿。
- 实现截图路径：无。
- 实现像素尺寸与密度归一：未执行。
- 全局对照：阻塞；当前 Codex 环境没有可调用的本地浏览器截图工具，且生产页面需要 Tauri 数据与 Android 软键盘才能进入目标状态。
- 局部对照：阻塞；无同视口、同状态的实现截图可供合并比较。

## Findings

- [P1] 缺少真机键盘可视证据
  - 位置：沉浸正文编辑器底部 Markdown 工具栏。
  - 证据：实现已跟随 `visualViewport`，但 Android WebView 的 IME resize/pan 行为无法由构建命令证明。
  - 影响：无法确认工具栏在真机键盘上沿始终可见且可点。
  - 验收：在 Android 真机打开沉浸编辑，分别聚焦、收起键盘并旋转屏幕，截取同状态图像后对照。

- [P1] 缺少 AI Tab 实际背景上的毛玻璃证据
  - 位置：`EntryEditModal` 移动端样式。
  - 证据：实现已去掉工具栏、diff 容器和折叠提示的不透明底色，但 `backdrop-filter` 在 Android WebView 的最终像素效果不能从计算样式确认。
  - 影响：无法确认面板与 AI 对话背景的层次与可读性达到设计稿。
  - 验收：在 AI Tab 触发词条编辑审阅，分别截取浅色/深色与 busy 状态。

## 必查表面

- 字体与排版：已在代码中把移动端 diff 改为应用字体栈；缺少截图证据。
- 间距与布局节奏：已实现双列属性、附加内容折叠和 44px 工具触控高度；缺少截图证据。
- 颜色与 token：使用现有 `--fc-*` / `--mobile-*` token；缺少真机活合成证据。
- 图像质量：两个目标界面没有新增图像资产。
- 文案：保留现有业务文案，并增加「应用中…」 busy 反馈。

## 对照历史

- 本轮未进入像素对照；阻塞原因为缺少可捕获的生产页面目标状态。

## 后续检查清单

1. Android 真机验证键盘展开/收起/旋转下的正文可见区与工具栏。
2. AI Tab 触发差异审阅，截取浅色、深色、busy 状态。
3. 把实现截图与对应 HTML 设计稿合并成同视口对照图，修复所有 P0/P1/P2 差异。

final result: blocked
