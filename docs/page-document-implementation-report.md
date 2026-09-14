# 页面文档编辑器迁入实施报告

- 状态：现行
- 日期：2026-09-15

本轮完成 M1–M6 的可编译切片与 M7 的最小桌面开关入口。未决事项：原生画布、输入法、Dock 交互仍需人工验收；完整 M7 能力尚未完成。

现象是生产正文仍以 Markdown 字符串保存，实验仓已有纯 TypeScript 内核和会话模型。方案是在 `core_world_data` 新增词条文档、项目首页文档、CAS、幂等回执、派生纯文本、出链事务和删除墓碑，在 `app_main` 增加 Rust 校验、Tauri 命令、页面文档 API、内核/会话移植与 `VITE_PAGE_DOCUMENT_EDITOR=1` 的最小工作区。代价是 CSV、快照、`.fcworld`、FTS、移动端和完整属性编辑仍未接入。

M1 完成，提交 `98e1fa3`；M2 完成，提交 `0900e80`；M3 完成，包含 Rust 校验与命令；M4 完成，内核测试 40/40；M5 完成最小草稿/队列/冲突切片；M6 仅完成 iframe `sandbox="allow-scripts"` 的最小画布壳，bridge 协议与发布 CSP 的原生证据仍缺；M7 部分完成，已接开关、TabBar/ButtonToolbar/Select/Input/Slider/Tree、源码模式、状态提示和 Dock 注册，属性面板实际内容与完整可视编辑尚缺。

实际门禁：`core_world_data/cargo test` 通过；`cargo test --no-default-features --features sqlite` 通过；`app_main/npm run test:page-document` 40/40 通过；`npm run lint` 通过；`npm run build` 通过；`app_main/src-tauri/cargo check` 通过。`src-tauri/cargo test` 已启动编译，但本轮未取得最终测试汇总，不把它写成通过。

相对计划的偏离是没有复制完整 bridge 测试、没有把所有实验会话 hook 接入 UI、没有实现双作用域联合保存 UI，也没有改快照/导入导出路径。这些部分依赖完整 M7 和既有 `.fcworld` 改动边界，避免与他人工作冲突。设计稿六项默认决定采用如下：属性单开保留左栏且 AI 开启时收起；分屏 AI 在上、属性在下；分屏只在编辑页可用；属性页签平铺文字/布局/颜色与效果；标题栏取消后保留当前页面壳；最窄宽度不设固定断点，按内容下限处理。

CSP 结论：当前画布使用 opaque sandbox iframe，不加 `allow-same-origin`，文档通过 `srcDoc` 载入。发布 CSP 未包含 `script-src 'unsafe-inline'`，内联 bridge 脚本可能被拦截，因此本轮未声称原生 bridge 已验证，也没有放宽 `tauri.conf.json`。需要在实际桌面包上验证 iframe 渲染、消息来源/会话 token/序号拒绝和 CSP 控制台结果。

已知缺口：搜索仍索引 `entries.content`；CSV、快照、`.fcworld` 不含新表；AI 工具未接页面会话；移动端继续 Markdown；Grid、渐变、阴影、旋转和双线圆角未做；属性 Dock 仅注册配对，尚未接入完整内容。

人工验收清单：

- 前置：桌面开发环境与本地数据库；步骤：以 `VITE_PAGE_DOCUMENT_EDITOR=1` 启动 Tauri，打开词条；预期：页面文档工作区和画布显示，关闭开关回到 Markdown。
- 前置：中文输入法；步骤：在源码或画布文本处输入组合音节并确认；预期：组合过程不丢字、不重复提交。
- 前置：有可编辑文本；步骤：选区应用字体/字号后撤销；预期：一次连续操作对应一步撤销。
- 前置：已有页面文档；步骤：保存、关闭词条、重新打开；预期：HTML/CSS、revision 和保存状态一致。
- 前置：两个窗口打开同一词条；步骤：窗口 A 保存后窗口 B 使用旧 revision 保存；预期：B 收到冲突且草稿保留。
- 前置：源码模式；步骤：修改 HTML，切换画布，再切回源码；预期：内容往返不丢失。
- 前置：页面文档输入；步骤：粘贴含 `<script>`、事件属性或危险链接的 HTML；预期：Rust 校验拒绝并显示诊断。
- 前置：桌面 Dock；步骤：打开属性面板、与 AI 上下分栏、拖动分隔条并收起；预期：属性按页面作用域进入 Dock，离开词条页释放。
- 前置：未设置开发开关；步骤：打开词条并编辑 Markdown；预期：原 Markdown 工具栏、预览和保存行为不变。
