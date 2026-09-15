# 页面文档编辑接入计划

> 状态：现行 ｜ 日期：2026-09-14
>
> 范围：`app_main` 页面文档接入及其 `core_world_data` 存储接口；本文是计划，不代表实现或原生验收已经完成。

## 1. 定位

本计划采用移植式重写，覆盖 0.2.0 阶段 A–C 中与页面文档有关的部分。唯一上游输入是实验仓的[可行性结论与移交清单](../../app_entry_page_editor/docs/可行性结论与移交清单.md)，对应代码快照 `6e73b02`；实验已经结束，已有内核、引擎和测试可逐模块作为草稿移入，随后按本仓目录、命名、token 和平台边界重组，后续实现归 `app_main` 所有。当前生产入口仍是 Markdown，实验机制证据尚不能证明原生闭环；因此先完成阶段 A 的隔离、存储和资产切片，再完成阶段 C 的词条闭环，不引用实验仓源码、不建子模块、不写同步脚本，代价是本仓独立维护实现与回归证据。

阶段 B 的图片服务和阶段 D 的首页、模板、组件只作为接口依赖。B 须提供逻辑资产 ID、原件/预览读取、变体状态、失败占位与缓存失效接口，正文图片接入依赖其完成；D 消费本计划形成的文档会话、保存、预览和资产边界，提供首页绑定环境、不可变模板版本与组件依赖清单。A 的项目首页仅用于验证存储复用，不展开首页界面、动态模块、类型模板或组件管理；C 的双作用域保存只验证词条与所依赖的项目页面样式，不把项目默认模板当作项目首页。

## 2. app_main 现状快照

生产代码仍以字符串正文和路径资产为中心，HTML 接入需要同时替换正文消费与保存边界。下表来自代码静态核对：`app_main ad41a68`、`core_world_data 77eb5ea`；未运行原生应用。`fcworld.rs` 仅以 `git show HEAD:src-tauri/src/apis/worldflow/fcworld.rs` 读取已提交版本，未把其工作区改动计入快照。代码变化后须重新核对，静态阅读不构成功能验收。

| 核对项与代码位置 | 现状 | 接入 HTML 文档后必须改什么 |
| --- | --- | --- |
| 桌面正文：[EntryEditor](../src/features/entries/components/EntryEditor.tsx)、[MarkdownEditor](../src/features/entries/components/MarkdownEditor/MarkdownEditor.tsx)、[DesktopApp](../src/app/desktop/DesktopApp.tsx)、[ProjectEditor](../src/pages/ProjectEditor.tsx) | 桌面壳经 ProjectEditor 挂载 EntryEditor；其编辑和预览使用封装的 `@uiw/react-md-editor`，草稿是 `content` 字符串，编辑器处理保存、自动保存状态和历史 | 词条入口接页面文档公开接口；阅读与编辑共用安全编译结果；可视/源码/AI 共用 HTML/CSS 会话，壳消费统一保存状态。代价是替换依赖 Markdown 的工具栏、选区、预览和恢复逻辑 |
| 移动正文：[MobileEntryDetail](../src/app/mobile/pages/MobileEntryDetail.tsx)、[内联编辑](../src/app/mobile/pages/MobileEntryDetailEditView.tsx)、[沉浸编辑](../src/app/mobile/pages/MobileEntryImmersiveEditor.tsx)、[查看态](../src/app/mobile/pages/MobileEntryDetailView.tsx) | 详情页持有字符串草稿；内联和 Overlay 沉浸入口均使用 MarkdownEditor；查看态用 Markdown 预览源码；正文长度也从字符串计算 | 两个入口共享同一 HTML 会话及受控输入 bridge，查看态消费安全 HTML 与派生字数；保留原生键盘唯一 owner。必须分别验收触摸、组合输入、返回与草稿恢复 |
| 正文辅助：[entryMarkdown](../src/features/entries/lib/entryMarkdown.ts)、[entryLinkHref](../src/features/entries/lib/entryLinkHref.ts)、[useWikiLink](../src/features/entries/hooks/useWikiLink.ts) | `[[` 用于候选，选中后生成 Markdown 中的 `fc://` 链接；摘要通过 `stripMarkdown` 派生；图片预览替换字符串；锚点由宿主接管 | 用 HTML 解析结果生成摘要、链接、选区与导航意图；保留合法 `href` 和按标题待解析链接，拒绝画布自行导航。旧 Markdown 正则不能继续处理 HTML |
| 保存包：[entries.rs](../src-tauri/src/apis/worldflow/entries.rs) 的 `db_save_entry_bundle`、`parse_internal_entry_links` | 保存包包含正文、标题/摘要/类型/标签/图片、分类及关系草稿；提交前读取旧链接/关系并复制图片，交 core 保存后向旧新关联端点广播 `entry:updated`。Rust 从正文中的 `[[标题]]`、`entry://...` 和合法 `fc://...` 链接生成出链目标；只记录本项目目标，跨项目与死链由 core 重建时跳过 | 接入版本化页面保存请求、期望 revision、请求幂等身份、独立 HTML 校验和链接提取；提交后刷新所有受影响反链。图片文件复制目前位于数据库事务外，须通过受管资产准备/引用提交处理失败，不把现有保存包称为跨资产原子保存 |
| 词条模型与存储：core 的 [entry 模型](../../core_world_data/src/models/entry.rs)、[存储接口](../../core_world_data/src/db/traits.rs)、[entry 存储](../../core_world_data/src/db/entry.rs) | `Entry.content: String`，`FCImage.path: PathBuf`；只有创建/更新时间，无文档 revision/CAS。`save_entry_bundle` 在一个 SQL 事务中更新词条、重建出链并保存关系；`update_entry` 仍是单独入口 | 在数据 ADR 后加入 HTML/CSS、修订前置条件与原子保存；正文引用和显式关系保持独立；所有正文写入口统一生产校验及事务。不能把秒级更新时间当冲突令牌 |
| 搜索与历史：core 的 `src/db/entry.rs`、[FTS 投影迁移](../../core_world_data/migrations/0005_entries_fts_summary.sql)、[FTS 更新触发器](../../core_world_data/migrations/0007_entries_fts_update_of.sql)、[snapshot](../../core_world_data/src/db/snapshot.rs)、[CSV 交换](../../core_world_data/src/db/csv_bundle.rs) | 搜索查询 `entries_fts`；触发器将标题、摘要、原 `content` 写入 FTS；快照/CSV 保存现有词条数据 | 确定性纯文本投影替换 Markdown 正文索引；FTS 可重建且不改 HTML/CSS 或 revision；快照/CSV 补齐页面源码与修订。代价是迁移索引与恢复路径，不能只换编辑组件 |
| AI 读写：[entry_tools.rs](../src-tauri/src/tools/entry_tools.rs)、[edit_tools.rs](../src-tauri/src/tools/edit_tools.rs)、[registry.rs](../src-tauri/src/tools/registry.rs)、[tools/mod.rs](../src-tauri/src/tools/mod.rs) | 读取含按 `content.lines()` 分行的工具；`edit_entry_content_lines`、`replace_entry_content` 经 `entry:edit-request` 确认后调用 `update_entry_content`，创建词条调用 `create_entry`；正文落库后均按新正文重建出链，并向本词条及新旧出链目标广播 `entry:updated`；registry 维护读写工具集合 | 读取返回绑定源 revision 的文档/文本视图；写入改为语义 intent 候选，统一进入草稿并经 Rust 重校验，取消/过期拒绝。同步替换工具描述、权限集合和两端确认组件，避免留下绕过链路 |
| 图片和 CSP：[entryImage](../src/features/entries/lib/entryImage.ts)、[assets API](../src/api/assets.ts)、[协议注册及处理](../src-tauri/src/lib.rs)、[tauri.conf.json](../src-tauri/tauri.conf.json) | 图片从 `FCImage.path` 推出文件名身份；正文支持 `fc://.../image/...` 和旧 `fcimg:`，运行时 `convertFileSrc(..., 'fcimg')`。协议解码路径并 canonicalize，限制在 images 根。发布 CSP 允许 IPC、`fcimg:`/localhost 图片以及站点图片，脚本有 `unsafe-eval`、样式有 `unsafe-inline` | 源码只存稳定资产 ID；运行 URL 由宿主受权解析且不可持久化。EntryCanvas 必须有独立隔离与更窄 CSP，不能从主文档 CSP 推断无网络；验证 Android 协议映射和项目边界，承担协议与引用迁移成本 |
| `.fcworld`：[fcworld.rs](../src-tauri/src/apis/worldflow/fcworld.rs)（HEAD）、[fcworld/import.rs](../src-tauri/src/apis/worldflow/fcworld/import.rs) | 当前格式版本 1，ZIP + JSON manifest，世界数据在 `data/worldflow/` CSV；导出对 entries 的 `content` 扫描并重写 `fcimg:`/`fc://` 图片引用，导入重映射项目/词条/图片引用及历史，未形成独立 HTML/CSS 文档载荷 | 纳入源码、文档版本、revision 与受管资产清单，以解析器定位的引用区间替代正文字符串扫描；同一快照导出，导入独立重校验并重建派生索引。C 验证语义往返，容器字节布局冻结仍属阶段 E |
| Dock：[sidePanelContents](../src/app/desktop/sidePanelContents.ts)、[sidePanelLayout](../src/app/desktop/sidePanelLayout.ts)、[DockableSidePanel](../src/shared/ui/layout/DockableSidePanel.tsx) | 全屏已删除；四种内容为灵感、AI、快照、帮助，当前最小宽度均为 500。已预留主/副内容、上下比例、作用域规整和按内容计算宽度；允许配对表为空，没有可用的 AI/属性分栏 | 注册页面作用域的属性内容和 AI/属性配对，消费已有分栏机制并按内容设宽度下限。左栏只保留图层/导航；不重新引入 Dock 全屏或独立第三列属性栏 |

根规划当前版本已同步实验结题决策，§0.10、§11、§15 不再构成本计划与代码现状的差异。Markdown 正文的 `fc://` 出链与 AI 写后重建已在 `0d8c128`、`e92937f` 修复，HTML 接入沿用同一出链语义（本项目记出链，跨项目、死链跳过），并由 Rust 从合法 HTML 链接生成；根规划对属性面板与 AI 面板只提出可收起并避免多侧栏挤压正文，尚未反映 `ad41a68` 已预留的 Dock 上下分栏、按内容最小宽度和配对注册。接入时据此保留统一出链语义、语义 intent 和 Dock 内容注册；这些差异只确定接入工作，不扩大本批改动。

## 3. 模块移植图

页面文档应成为独立功能模块，其纯 TypeScript 领域层可由词条和项目首页共用。现有[功能模块化单体 ADR](../docs/adr/0001-frontend-feature-modular-monolith.md)把业务用例放在 `features`，但尚无页面文档边界；建议新建 `src/features/page-document/`，以 `domain/` 承载 kernel/engine、`application/` 承载会话与用例、`components/` 承载界面，稳定出口放 `index.ts`。`entries` 与 `project-editor` 通过出口组装，领域层不能反向依赖它们，也不能依赖 React、Tauri、DOM 或平台全局；代价是移植时重排依赖并补边界测试，不为此新建包或第二套顶层架构。

### 3.1 资产与实现的落点

移植表中的目标路径均为拟建位置，处理方式决定的是本仓归属而非整目录复制。规模和证据以移交清单为准；本文不重新宣称实验仓已完成原生验证。

| 实验仓模块 | app_main 目标位置 | 处理方式 | 移植后的验证方式 |
| --- | --- | --- | --- |
| `src/domain/document/kernel/` 及测试 | `src/features/page-document/domain/kernel/`，测试就近 | 移植 | 语法保全、身份、最小 patch、intent、覆盖影响与漂移测试；完整相对 import 闭包与平台全局检查 |
| `src/domain/document/engine/`、`contract.ts`、`sourceEdits.ts` 及测试 | `src/features/page-document/domain/engine/`、`domain/contract.ts`、`domain/sourceEdits.ts` | 移植 | 解析/安全预检/文本投影/资产引用回归；保留 `parse5`、`postcss`、`postcss-value-parser`、`css-select`、`css-what`、`entities` 的实际依赖闭包，测试运行器适配本仓 Node 测试 |
| `src/features/document-editor/session/` 的草稿模型、队列与会话 | `src/features/page-document/application/`；React hook 在 `hooks/` | 移植 | 双作用域、串行候选、前置 revision、取消、防抖、一次交互一次撤销和保存失败；去除实验 API 耦合 |
| `src/features/document-editor/visual/`、源码工作台和 preview runtime/bridge | `src/features/page-document/components/`、`canvas/` | 参考重写 | 保留准入语义，重接 `--fc-*`、Dock、焦点和原生键盘；A1/C 原生验收，不能直接套实验壳 |
| `mock-backend/storage/` 的事务、索引和校验机制 | `src-tauri/src/apis/page_document/`；持久化落 `core_world_data` 的模型/存储/迁移目录 | 参考重写 | 数据 ADR、CAS 并发、失败回滚、派生重建与两套 core 特性测试；SQLite v4 表不搬入 |
| 作者预检、安全编译规则 | `src-tauri/src/document_validation/`；由页面 command 调用 | 参考重写 | Rust 使用独立 HTML/CSS 解析与规则实现，同一 fixture 检查接受/拒绝、诊断类别、资产和链接投影；不得逐行翻译 TS 或调用 TS 当重校验 |
| AI intent 契约与候选机制、`mock-backend/ai/` 工作流语义 | `src-tauri/src/tools/entry_tools.rs`、`edit_tools.rs`、`registry.rs` 与页面会话适配 | 参考重写 | 现有 `core_ai_client` 会话/权限路径下验证只读、确认、取消、过期、应用、撤销；模型输出不能直接保存 |
| `contracts/fixtures/v1–v3/` 全部合法/恶意/资产样例 | `tests/fixtures/page-document/v1/`、`v2/`、`v3/`，追加 `malicious/` 与 `expected/` | 移植 | TS 就近测试和 `src-tauri/tests/page_document_contract.rs` 读取同一份文件；Rust 从 `CARGO_MANIFEST_DIR` 相对定位 `../tests/fixtures/page-document/`，不保留两套拷贝 |
| `contracts/document-api-v1.openapi.json` 的能力语义 | `src/api/pageDocument.ts` 的类型/适配契约及 §3.3 | 参考重写 | 请求、错误、revision 和取消语义的 command 适配测试；不迁入 OpenAPI 的 HTTP 路由实现 |
| 准入标准、词汇、机制说明、Office 交互契约、旋转结论 | 本计划能力边界与本仓后续就近规则/验收证据 | 参考重写 | 按本仓接入范围重登记；旋转计算结论只作后续设计前提 |
| Bun HTTP 服务、CORS、SSE 心跳与旧 API 兼容外壳 | 无 | 不迁移 | §3.3 检查能力映射齐全；构建/import 不依赖实验服务 |
| SQLite schema v4 具体表结构与实验迁移脚本 | 无 | 不迁移 | core 数据 ADR 决定生产布局，失败切片证明行为 |
| DeepSeek 直连与凭据配置 | 无 | 不迁移 | 使用主应用 AI 配置/工具权限；页面模块无独立模型凭据或提供方调用 |
| `scripts/dev.ts`、开发 URL 参数、`cleanup-responsive-breakpoints` | 无 | 不迁移 | 本仓启动、导航与数据迁移不需要实验运行器或维护命令 |

Rust 文档侧只承担存储事务与独立重校验，不再实现另一套作者编辑引擎。当前实验可在同一 JS 环境复用预检，但生产必须独立判定来源权限、版本、资源预算、节点/资产身份与候选源码；因此 Rust 从规范和共享样例实现校验，数据库派生文本/链接由已校验内容生成，宿主平台读取与通知沿用现有 Tauri 边界。代价是两种实现需要持续做差分测试，前端接受而 Rust 拒绝应成为可定位的诊断，不允许保存时静默删改合法源码。

### 3.2 通用控件的边界

通用控件只处理输入和展示，文档属性语义留在页面模块。已核对 `lib_ui/ui/src/index.ts`，当前公开导出含 Input、Select、Slider 等，但没有专用单位、颜色或四边编辑器；按 0.2.0 §7 逐项决定，不能把实验 NumericStyleField 整体迁入 UI 库。

| 实验控件类型 | 目标位置与处理方式 | 边界、理由与验证 |
| --- | --- | --- |
| 数值输入 | 参考重写；基础受控数值输入进入 `lib_ui/ui/src/components/Input/`，属性适配在 `features/page-document/components/properties/` | UI 库处理输入中间态、提交/取消、步进与无障碍；CSS 合法范围、混合/继承、拖动历史和 dirty intent 留本仓。用一般数值表单及文档表单证明 API 不含节点/revision |
| 单位选择 | 参考重写；复用 lib_ui Select，本仓属性面板组合 | 单位菜单是通用选择器，属性允许的单位、单位换算是否有损及语义选项属于文档域；不新增全属性共用的 CSS 单位全集 |
| 颜色弹层 | 参考重写；无业务颜色值选择器可进 `lib_ui/ui/src/components/ColorPicker/`，弹层接本仓 `src/shared/ui/overlay/` | 颜色输入/透明度/键盘可达通用；主题绑定、最近色生命周期、节点背景冲突和候选写回留本仓。先核对浮层焦点/取消，再决定是否抽公开选择器，不能让库依赖应用 overlay |
| 四边间距 | 参考重写；留 `features/page-document/components/properties/`，组合通用数值与 Select | 逻辑/物理边、margin 负值、padding 限制、简写保全、联动、两档覆盖都是领域行为；不进 lib_ui。验证只改一边保全另三边及原单位 |

### 3.3 HTTP 能力与 Tauri 对应

实验 HTTP 能力在本仓由类型化适配层转换成 command 或宿主事件，UI 不直接拼 command。下表核对 OpenAPI v1 及 `mock-backend/app.ts` 的路由；`{id}` 表示词条、`{cid}` 表示会话。标为“拟新增”的名称尚未实现，最终入参与错误版本在 A/C 各自接入时确定；旧接口的兼容壳不迁移，但其有效读写能力必须有去向。

| 实验能力 | app_main 对应 Tauri command / 通道 | 前端适配位置与边界 |
| --- | --- | --- |
| `GET /api/health` | 拟新增 `page_document_get_capabilities` | `src/api/pageDocument.ts`；返回契约/策略版本和能力，不返回 Bun/开发库信息 |
| `GET /api/project` | 现有 `db_get_project` | `src/api/worldflow.ts`；结构化项目资料 |
| `GET /api/templates/default` | 拟新增 `page_document_read_template` | `src/api/pageDocument.ts`；C 的基础模板读取，D 扩展类型模板管理 |
| `GET /api/entries` | 现有 `db_list_entries` | `src/api/worldflow.ts`；列表元数据，正文按需读取 |
| `GET /api/project/source` | 拟新增 `page_document_read_project_source` | `src/api/pageDocument.ts`；返回默认 HTML、项目 CSS 及 revision，不能只映射 CSS。实验 project 是默认模板/样式，不是首页。A2 首页另用拟新增 `page_document_create_project_home` / `page_document_read_project_home` / `page_document_save_project_home` |
| `POST /api/project/validate` | 拟新增 `page_document_validate`，项目默认文档目标 | `src/api/pageDocument.ts`；校验 HTML/CSS 整体及依赖版本，C 消费默认结构并编辑项目样式；D 的模板编辑复用该校验接口 |
| `GET /api/entries/{id}/source` | 拟新增 `page_document_read_entry` | `src/api/pageDocument.ts`；源码、revision、绑定和资产清单 |
| `POST /api/entries/{id}/save-bundle` | 拟新增 `page_document_save_entry_bundle`，衔接现有词条保存用例；D 的项目默认结构修改接拟新增 `page_document_save_template` | `src/api/pageDocument.ts`；词条与本次脏项目样式联合校验/提交，携带两者 expected revision 并保全未改默认 HTML；元数据和关系不另走第二次正文保存。模板结构写入转到 D 的独立版本接口，不默认为改所有词条 |
| `POST /api/entries/{id}/validate` | 拟新增 `page_document_validate`，词条目标 | `src/api/pageDocument.ts`；独立重校验，结果不能代替最终保存时 CAS |
| `POST /api/entries/{id}/preview` | 拟新增 `page_document_compile_preview` | `src/api/pageDocument.ts`；首次/安全边界变化走 Rust 校验；连续输入使用纯 TS 候选预览，最终保存仍重校验，避免每次按键 IPC |
| `POST /api/entries/{id}/assets` | 拟新增 `page_document_import_asset` | `src/api/pageDocument.ts` 调用 B 的资产服务；只返回逻辑 ID 和状态 |
| `GET /api/entries/{id}/assets/{assetId}` | 拟新增 `page_document_resolve_asset`，实际二进制由受管 Tauri 协议提供 | `src/api/pageDocument.ts` / `src/api/assets.ts`；按项目、文档授权，不向画布暴露路径 |
| `GET /api/search` | 现有 `db_search_entries` 的页面投影适配 | `src/api/worldflow.ts`；已保存版本的检索，草稿不冒充数据库结果 |
| `GET /api/events` | 拟新增 `page_document_watch` / `page_document_unwatch` 与版本化 `page-document:changed` 事件 | `src/api/pageDocument.ts`；宿主订阅与释放，事件后按 revision 重读，断线重建；不搬 SSE |
| `GET /api/ai/provider` | 现有 `ai_list_plugins` 和会话配置路径 | `src/api/ai_client.ts`；返回可用提供能力，不复制 DeepSeek 状态 API |
| `GET /api/entries/{id}/ai/conversations` | 现有 `ai_list_conversations`，补文档上下文筛选 | `src/api/ai_client.ts`；条目身份绑定在任务上下文 |
| `POST /api/entries/{id}/ai/conversations` | 现有 `ai_create_llm_session` + `ai_set_task_context` | `src/api/ai_client.ts`；通过现有持久会话建立文档关联 |
| `GET /api/entries/{id}/ai/conversations/{cid}` | 现有 `ai_get_conversation` / `ai_get_conversation_tree` | `src/api/ai_client.ts`；读取既有会话数据 |
| `PUT /api/entries/{id}/ai/conversations/{cid}` | 现有 `ai_rename_conversation` / `ai_update_conversation_settings` / `ai_save_conversation_ui_state` | `src/api/ai_client.ts`；按字段映射，消息由既有会话运行时保存，不允许前端任意覆盖权威消息 |
| `DELETE /api/entries/{id}/ai/conversations/{cid}` | 现有 `ai_delete_conversation` | `src/api/ai_client.ts`；复用会话删除语义 |
| `POST /api/entries/{id}/ai/chat` | 现有 `ai_set_task_context` / `ai_send_message`，挂接语义 intent 工具 | `src/api/ai_client.ts`；候选进入页面会话，不自动持久化 |
| `POST /api/entries/{id}/ai/chat/cancel` | 现有 `ai_cancel_session` | `src/api/ai_client.ts`；终止实际请求并丢弃未应用候选 |
| 已弃用 `GET /api/entries/{id}` | 结构化资料用 `db_get_entry`，文档用 `page_document_read_entry` | `src/api/worldflow.ts` / `src/api/pageDocument.ts`；不保留旧 HTTP 响应形状 |
| 已弃用 `PUT /api/entries/{id}` | 创建用拟新增 `page_document_create_entry`，修改用 `page_document_save_entry_bundle` | `src/api/pageDocument.ts`；不保留绕过 revision 的 upsert |
| HTTP `OPTIONS` / CORS | 无对应 command，不迁移 | IPC 无 HTTP 跨域预检，来源授权由 Tauri capability 与文档校验承担 |

## 4. 阶段 A：技术尖刺与共同不变量

阶段 A 只关闭隔离、最小存储和资产往返的不确定性，不以完整编辑器为退出条件。现有实验机制缺原生与生产模型证据，因此以下三个切片按 A1、A2、A3 收敛，并各自保留失败用例；代价是正式界面接入前先维护可丢弃的最小测试入口。本批只定义这些工作，不实施尖刺。

### A1 隔离画布尖刺（原 P0B）

EntryCanvas 的隔离机制必须由发布 CSP 下的原生证据选定。现有宿主允许 IPC 与图片来源，实验的 opaque iframe 证据无法证明原生行为；比较 `sandbox="allow-scripts"` 的 opaque iframe（srcdoc/blob 载入方式分别验证）与独立受限 WebView/来源方案，先以最小可信 bridge 和不可信 HTML/CSS 样本验证，再选择支持三种 WebView 的最小方案。用户脚本、事件属性、任意网络、表单提交、自行导航与 Tauri 权限均不得进入作者内容，可信 bridge 代码和作者源码分离；代价是隔离层需独立资源策略和生命周期管理。

| 验证对象 | 做法 | 证据形式 | 退出条件 |
| --- | --- | --- | --- |
| 作用域与网络 | 在发布 CSP 下运行合法/恶意样本；尝试父 DOM/同源访问、IPC、顶层导航、表单、外部 img/font/CSS URL/import、脚本执行和覆盖外壳；宿主记录网络尝试和权限拒绝 | 自动拒绝矩阵、原生进程/资源请求记录、宿主 DOM 标记前后值；不能只看控制台 | 合法样本可渲染；无作用域逃逸，无作者触发的网络请求，资产仅经受管本地通道；AI 宿主请求与画布网络隔开 |
| bridge 三端可用 | WKWebView、WebView2、Android WebView 分别交换选择/输入/渲染回执；验证来源 Window 或原生身份、session token、协议版本、请求序号；伪造、过期、重放和超限消息拒绝 | 每种 WebView 的版本、原生构建及消息时序，自动协议测试和人工清单结果 | 真实应用内输入与回执可闭环，来源鉴别成立；仅检查 `origin == null` 不算鉴别；切页销毁后旧消息不生效 |
| 中文输入法组合期 | 在组合输入期间注入待渲染候选、切换选区与取消输入；组合期暂缓 DOM 协调，结束后按模型次序 flush | 输入意图日志、组合事件与最终 HTML/纯文本对照、原生录屏 | 拼音候选不丢、不重复，取消不留半次修改；WKWebView、WebView2、Android 分开记录 |
| contenteditable 自生成 DOM | 覆盖 beforeinput、换行、粘贴、撤销及浏览器产生的 b/font/div/span；受信输入适配器把允许输入转成模型 intent，不导入 DOM diff | 输入序列、候选源码、未知合法片段前后对照 | 归一化归属文档内核；临时 DOM 不成为真值，未知片段不因输入被整页重写；不可安全解释的输入被明确拒绝 |
| 跨 iframe 软键盘光标滚入可视区 | iframe 报送光标几何，宿主按原生 `--fc-kb` 遮挡协调滚动内部画布；测试长文末尾、选区、弹层、横竖屏和键盘收放 | 原生遮挡值/滚动位置时序及录屏，依照[键盘布局契约](../docs/mobile_keyboard_layout.md) | 原生适配器仍是唯一键盘 owner，主 WebView/外壳不缩放或整体平移；只有编辑滚动容器负责 caret reveal，不重复补偿 |

iOS 不可用时必须明确保留发布前门槛，不能用 macOS 的 WKWebView 结果替代。A1 可在 macOS、Windows 与 Android 证据齐全后记录受限退出，但 iOS 的 bridge、输入和软键盘清单须在发布前通过；失败时回到隔离/输入方案，不把移动端降为长期只读。证据缺失时标“未执行”并写原因。

### A2 存储最小切片

生产数据布局先写数据 ADR，再由词条与项目首页两条切片决定。当前 core 只有词条字符串与现有 SQL 事务，缺源码修订、CAS 和首页文档；先在 `app_main/docs/adr/` 记录生产语义及 core 落点，比较领域对象分别持源码、明确关联的页面记录等方案，在 `core_world_data` 建 HTML/CSS、revision、原子保存和派生索引最小模型。不预设 `owner_type/owner_id`、万能文档表、未来文档类型全集或空置未来表；代价是将来真实闭环推翻布局时仍须迁移并修订 ADR。

| 切片 | 做法 | 证据形式 | 退出条件 |
| --- | --- | --- | --- |
| 词条 | 创建词条与初始文档，读取 revision，修改 HTML/CSS/相关元数据后带 expected revision 保存，关闭重开；在事务内源码更新后、索引完成前人为注入失败 | core 集成测试、command 测试、原生最小入口操作记录、失败前后源码/revision/索引对照 | 成功时整批生效；失败时源码、revision、派生数据和引用均不前进，草稿可重试；并发旧 revision 被拒绝 |
| 项目首页 | 创建独立首页文档，复用同一保存/预览能力，保存并关闭重开，再注入一次同类保存失败 | 与词条独立的样例和记录 | 首页不占用词条默认模板身份，不修改项目短简介；同一事务/失败语义成立，无词条界面内部依赖 |
| 派生边界 | 从已校验 HTML 生成纯文本/链接并更新索引，提供重建操作；资料字段保持结构化 | 源码摘要、revision 与索引重建差分；保存失败及查询回归 | 派生重建不改源码/revision；预览 DOM 和搜索结果均不能反写正文 |

保存重试必须可区分“未提交”与“已提交但回执丢失”。ADR 定义请求幂等键、请求内容摘要和提交回执，同一请求重试返回原回执且不重复增加 revision，同键不同内容拒绝；以提交后模拟回执丢失的测试补充两条中途失败切片。代价是生产存储需要保存有界的幂等记录，不能由前端以按钮禁用代替。

同步准备只落在字段与边界，不实现同步系统。按工作区 `plans/0.5.0规划.md` §6，下面五项随 A2/A3 的模型落位；字段名为 ADR 候选，语义必须明确，不能只写“预留扩展”。

| 同步接缝 | 字段/边界落点 | 最小证明 |
| --- | --- | --- |
| 修订与 CAS | 页面记录 `revision` 单调增加，保存请求 `expected_revision`；联合保存为每个被写目标携带期望值 | 冲突整批拒绝，无最后写覆盖 |
| 修改者 | 修订记录 `modified_by` 指向本地用户主体 | UI/源码/AI 都记录本地主体，AI 来源可作修改来源但不冒充账号 |
| 删除墓碑 | 页面/相关对象删除记录的稳定 ID、删除 revision、`deleted_at`、修改者；级联删除同事务记录 | 删词条/项目后仍有可重放删除记录，不只硬删除 |
| 资产稳定 ID | 资产记录 `asset_id`，引用关系保存 ID；摘要、处理版本与原件/派生关系独立 | 重定位、重建预览不改变被引用资产身份 |
| 空间归属 | 项目记录 `space_id` 指向本地默认空间 | 创建、复制/导入时显式赋值，不引入成员或账号功能 |

### A3 资产逻辑 ID 往返

资产身份必须贯穿数据库、Tauri 协议、Android WebView 和离线导出。当前路径及文件名推导身份不能支撑重定位；建立最小资产记录和解析适配，导入一份原件后以逻辑 ID 写入 HTML/CSS，宿主按文档授权解析为临时显示资源，并通过离线导出相对资源引用重开。这里仅验证接口与身份，不展开 B 的图像处理队列；代价是需要把项目归属、资源准备和文档引用提交分开管理。

| 做法 | 证据形式 | 退出条件 |
| --- | --- | --- |
| 数据库记录稳定 ID、内容摘要、原件/派生关系和处理版本；准备资源成功后才允许文档引用提交；失败不产生已引用的缺失资产 | 资产和事务测试、失败注入对照 | 原件不被预览覆盖，未引用准备资源可清理，重建派生表示不改逻辑 ID |
| 桌面/Android 使用受管 Tauri 协议加载，检查不存在、错项目、遍历/编码绕过和越权 ID | 协议自动化测试、三种 WebView 的合法资源与拒绝记录 | 可显示合法图片，非法请求失败；HTML/CSS、导出包和 bridge 都不泄露本机路径 |
| 离线导出文档及资产，在新位置读取，再导回新项目 | 资源摘要、ID/引用映射表、断网原生查看记录 | 所有引用可解析；同项目重开 ID 稳定，跨项目复制如需新 ID 必须一致映射；源码不被运行 URL 污染 |

### A 的冻结范围

阶段 A 只冻结 0.2.0 §8.1 中“页面文档”和“资产”两行的不变量。现有实验字段不是生产契约；A1–A3 退出后将下面语义及其版本写入本仓契约/数据 ADR，修改不变量或已冻结字段语义必须升对应文档/资产契约版本，更新迁移、TS/Rust 同源 fixture 与读取方拒绝/迁移规则。内部表布局调整走 schema 迁移；不得静默改变同一 contract v1 的含义。

| 冻结对象 | 冻结内容 | 不在 A 冻结 |
| --- | --- | --- |
| 页面文档 | HTML/CSS 同草稿；稳定节点身份；revision 保存前置条件；原子保存；安全编译与派生索引边界 | 万能表/所有者多态字段、未来文档种类全集；块集合、HTML/CSS 能力策略、断点模型均在阶段 C 验收前可调 |
| 资产 | 稳定身份；原件不被预览覆盖；派生表示可重建；内容摘要与处理版本参与缓存 | 视频/音频字段全集、代理与时间轴、大文件打包策略 |

G0 的页面文档冻结发生在 `app_main` 阶段 A，非专业用户任务证据转到 C。A2 的五项同步接缝确定边界落点，具体表形不借此冻结；A1 选型只确定当前安全可行实现，后续更换实现仍须满足同一不变量。块集合、能力策略与断点变化须同步样例和原生矩阵，C 验收后再定版本，不能沿用旧 P4-A 四档浏览器验收宣称两档有效。

## 5. 阶段 C：生产词条编辑闭环

阶段 C 按单一草稿的完整生命周期接入，并以桌面及 Android 的真实词条任务退出。A 提供安全/保存基础，B 提供正文图片依赖；现有 Markdown 的搜索、AI、历史和移动入口仍有耦合，按下表顺序替换，避免一个入口完成就宣布生产接通。代价是每一步都须保留错误/取消状态，并在后续步骤接入后做闭环验收。

### 5.1 接入顺序与退出条件

接入顺序固定为内核会话、工作台、Dock、AI、检索链接、历史冲突、世界包和移动端。各步新增路径通过公开模块接口连接，不把领域行为塞入壳或通用控件。

| 步骤 | 做法与边界 | 退出条件 |
| --- | --- | --- |
| C1 内核与草稿会话移植 | 移植 §3 的纯 TS 依赖闭包和就近测试；会话统一 HTML/CSS、选区、候选队列、目标 revision 与未保存状态；词条和项目样式使用独立身份 | 未知合法源码往返不变；只改脏属性；稳定 ID 经拆分/合并/粘贴仍合法；过期候选拒绝；联合候选失败不留下半份草稿 |
| C2 可视/源码工作台 | EntryEditor 接入同会话；画布直接写作，工具按选区/对象切换；左栏仅图层与导航；源码错误可保留在草稿但阻止不安全预览/保存，提供可定位诊断 | 可视、源码互相回读，切换不丢内容/选区；输入与预览宽度、写入作用域独立；未知节点可识别且不误改；保存中/失败/重试持续可见 |
| C3 属性面板进入 Dock | 属性作为页面作用域 Dock 内容，与灵感、AI、快照、帮助互斥占同一槽位；AI 与属性可上下分栏，接预留主/副内容和比例；按内容设最小宽度，换页规整不可用属性槽 | 选区切换及时更新，AI/属性分栏与收起可用；不挤压正文到不可操作，页面关闭释放属性内容；键盘焦点和浮层返回正确，不恢复全屏 |
| C4 AI 改语义 intent 并经 Rust 重校验 | 读工具提供源 revision/文本投影/节点摘要；写工具提交 intent，由活动文档会话调用纯 TS 内核生成候选，再通过 `page_document_validate` 独立校验，用户应用后进入同草稿，保存再校验/CAS。无活动会话时先打开/建立会话，不旁路直接写正文；registry 与两端确认挂载同步更新 | 只读权限不能写；AI 预览、选择应用、取消和撤销可复现；草稿/目标变化使候选过期；前端被绕过仍被 Rust 拒绝；确认不自动变为落库，取消终止请求 |
| C5 搜索与内链/反链迁移 | Rust 从合法 HTML 链接生成出链；FTS/摘要/AI 纯文本使用确定性派生；保留 `fc://self/entry/...`、按标题待解析及明确跨项目边界，元数据关系独立；UI 锚点全量接管 | UUID/标题链接、改名、删链接、删除目标、跨项目拒绝/合法导航均有测试；旧新目标反链刷新；AI 保存也走同链路；索引重建不改源码/revision，搜索不命中样式代码 |
| C6 历史、撤销、冲突 | 区分会话操作历史与持久修订/项目快照；连续拖动合并一次操作；保存失败保留草稿；过期 revision 显示差异并允许重新载入/保留草稿后重新应用；恢复历史也按新修订保存 | 输入/拖动/源码/AI 均能撤销重做；关闭提供保存并关闭、放弃、取消；Tab dirty/保存失败显性；冲突不覆盖别处修改；关闭重开与故障恢复包含 HTML/CSS/引用，修订不倒退 |
| C7 `.fcworld` 往返 | 在现有容器上加入版本化页面载荷与资产清单，导出捕获同一源快照；导入解析引用并重映射，独立校验后原子提交并重建索引；静态 HTML 导出采用 §8 的链接降级决定 | 新位置/新项目导入后正文、样式、节点关系、资产、内链、反链与历史可读；畸形/缺资源/旧 revision 候选失败不覆盖现有项目；容器 E 变更后重复此回归，不提前冻结字节布局 |
| C8 移动端受控编辑边界 | MobileEntryDetail 的内联/沉浸入口共享 C1 会话；按 A1 输入 bridge 支持正文、基础行内格式、内链和基础图片操作；复杂布局先保留源码并受限编辑，范围由 §8 明确 | Android 真机完成创建至导出流程；中文组合输入、长文光标、键盘收放、返回取消、重开恢复均通过；不可编辑能力不损失原稿，不提供长期 Markdown 或只读替代；iOS 未验项目仍为发布前门槛 |

旧 Markdown 只允许一次性处理开发数据，不设双写或长期兼容。项目暂无真实用户，现有开发数据仍应保护；在首次生产数据切换前按 §8 决定备份后迁移或重置，并记录转换结果/恢复方法。选择迁移时需覆盖文本、图片及 UUID/标题内链的转换；选择重置时需显式执行且保留可恢复备份，不能让新启动逻辑悄悄清空数据。

### 5.2 能力准入分组

阶段 C 必须具备完成词条任务的基础能力，其余能力可在 C 之后独立准入。上游移交清单引用的登记表 §9 当前为有效 9、待浏览器验收 35、待复核 2、源码专属 1，共 47 行；C 必须为有效 9 + 待浏览器验收 25 + 待复核 2，共 36 行，C 之后为待浏览器验收 10 + 源码专属 1，共 11 行。下面按同一登记表的能力 ID 分组，候选表不冒充已登记能力。所有非“有效”能力必须在 `app_main` 原生 WebView 重新验收；“有效”只继承其语义/测试起点，仍要通过生产闭环，不能沿用实验浏览器证据替代原生证据。

| 分组与上游状态 | 能力范围 | 准入要求与代价 |
| --- | --- | --- |
| 阶段 C 必须：有效 9 行 | `text-node.typography.responsive`、`paragraph.indent.responsive`、`managed-node.logical-spacing.responsive`；`text-range.inline-source-preservation`、`font-weight`、`font-style`、`font-size`、`font-family`、`decoration-line`（后五项均为 `text-range.` 前缀） | 保全原源码及混合/继承语义；重新覆盖原生输入、焦点和两档保存重载，P4-A 旧四档证据不作为退出依据 |
| 阶段 C 必须：待浏览器验收中的基础布局 | `container.layout.responsive`、`container.gap.mobile/desktop`、`container.padding.fixed`、`container-child.layout.responsive`、`container.grid-tracks.responsive`、`container.grid-axis-gap.responsive`、`container.grid-alignment.responsive`、`container.grid-item-placement.responsive`、`editor.preview-grid-tracks.geometry`、`editor.preview-selection.geometry` | 自由数值、Grid 行列/比例/跨度/拖动、选框及父布局联合判定，在原生宽窄页面、滚动定位、恢复和指针取消中验证；复杂轨道保留，不猜值 |
| 阶段 C 必须：待复核 2 行 | `container.cross-align.mobile`、`container.cross-align.desktop` | 先复核父布局适用性及与 Grid/Flex 对齐的语义，再做原生验收，不能用有控件代替效果成立 |
| 阶段 C 必须：待浏览器验收中的基础样式/素材 | `managed-node.background.fixed`、`foreground.fixed`、`border.fixed`、`radius.fixed`、`width.fixed`（均为 `managed-node.` 前缀）、`managed-node.visibility.semantic`；`asset.media-box.fixed`、`asset.alt-text`、`asset.caption`、`text-range.color`；`project.theme-colors`、`project.content-width`、`entry.theme-colors`、`entry.content-width` | 基础颜色/边框/尺寸、图片焦点/替代文本/图注、可恢复隐藏与双作用域编辑；覆盖确认须保全无关声明，数值输入不能静默截断 |
| 阶段 C 之后可并行：待浏览器验收中的增强能力 | `managed-node.background-gradient.fixed`、`managed-node.opacity.fixed`、`managed-node.rotation.fixed`、`managed-node.shadow.fixed`、`managed-node.colors.interaction`、`asset.filter.fixed`、`asset.text-wrap.responsive`、`container.columns.responsive`、`container.grid-template-areas.responsive`、`container.grid-area-assignment.responsive` | 按属性族逐项扩展复杂值、函数顺序与适用性；原生验收前不开放可视入口。相关合法源码继续保全；不因推迟控件而放松安全策略 |
| 阶段 C 之后可并行：源码专属/候选 | 已登记 `container.grid-tracks.subgrid`；候选最小/最大尺寸、分边边框、固定排版/选区字距、主轴对齐及非 Grid 分轴 gap、表格垂直对齐/标题/表头、列表标记/起点/嵌套、节点复制、复杂文本流和增强样式 | 候选先补模型、能力卡和 fixture；重复覆盖已登记能力的旧候选合并到现行模型。源码专属只保全合法内容，不能把安全 guard 拒绝项放行；subgrid 须先建立父 Grid→子跨度→后代引用联合模型、漂移校验、原子写回及阅读顺序证明 |

基础结构和安全样例是阶段 C 退出前提，即使它们不在 47 行 CSS/选区登记表中。标题、段落、基础列表、合法链接、单图和矩形表格须完成语义、可视入口与回读/写回证明，未知合法结构仍逐字保留；附录 A 剩余恶意样例要补齐，资产样例不能仅用上游一张 1×1 PNG。按实际支持范围加入长图/缺图/透明/损坏/越界资源与复杂源码，确保 C 结束时冻结的块集合和能力策略有证据；新增增强控件不得阻断基础闭环。

### 5.3 非专业用户任务测试

非专业用户任务测试是阶段 C 的退出条件之一。实验仓未做 P0A，按钮存在和静态设计无法证明作者能完成任务；在原生应用以同一组任务观察操作，遇到无法完成的必须标失败并修正或明确调整 C 能力范围，不能只记录主观满意。代价是需要可复现输入样例和最终产物比对，不能用开发者代操作补齐结果。

| 任务 | 记录项 | 退出条件 |
| --- | --- | --- |
| 从空白创建百科人物词条：标题、段落、列表、图片/图注与一个 UUID 内链、一个待创建标题链接，保存关闭重开 | 实际耗时、每个卡点/求助、错误恢复、最终 HTML/CSS、资源与链接结果 | 不编辑源码也能完成，重开不丢数据；阻断任务的问题已关闭 |
| 将人物卡排成双列，调整字号/间距/比例，在窄宽预览间切换并撤销一次布局 | 操作次序、误改作用域、连续拖动和撤销结果、最终宽窄产物 | 作者能确认改动对象与范围，内容/阅读顺序保留；基础 Grid 无假生效 |
| 让 AI 保留内容调整排版，查看差异后应用一部分并撤销，再处理一次人为制造的保存冲突 | 候选理解卡点、取消/选择应用结果、耗时、失败/冲突后的最终草稿和保存版本 | 无静默覆盖，用户可辨草稿与已保存版本，能恢复继续写作 |
| 在 Android 编辑长中文正文、替换图片、修改内链，返回并选择保存；导出后在独立数据目录导入 | 输入法/设备/WebView 版本、键盘遮挡、返回卡点、最终包及重开产物 | 在 C8 的受控范围内完成；受限能力明确且原文保全 |

固定样例组同时包含百科词条、旧报纸、图片档案和接近资源预算的规模页面。记录源码字节数、节点/CSS 规模、设备、预览/输入耗时与卡点；性能阈值先写任务验收卡，再实测填写，本文不提供未经测试的性能承诺。旧报纸/图片档案中的增强效果可作为 C 之后能力样例，C 至少证明其合法源码可保全、查看与安全降级。

### 5.4 与现有计划的关系

已有计划按正文接入、保存状态和列表整理划分职责，避免两份计划分别维护同一保存链路。下表限定被取代的部分，其余独立事项保留原计划判断；Markdown 前提被替换的移动详情计划只加横幅，不改写历史正文。

| 现有计划 | 本计划取代/承接的部分 | 仍独立有效的部分 |
| --- | --- | --- |
| [MOBILE-ENTRY-DETAIL-REBUILD](MOBILE-ENTRY-DETAIL-REBUILD.md) | 步骤 A/C 中正文展示/编辑、Markdown 预览/工具栏及相关正文验收由 C2/C8 替换；保存状态与键盘输入按 C6/A1 | 元数据布局、主图/附件浏览器、属性和关系页、触控尺度；步骤 D 分类只读仍依赖剪贴替代入口，不能因 HTML 切换提前移除分类操作 |
| [UI-01](UI-01.md) P0-1 | 词条 dirty、保存中/失败/重试与保存并关闭由 C2/C6 实现，Tab/窗口消费同一会话状态，原建议作为验收要求 | 设置等非文档保存状态、全局导航、AI 上下文、通用浮层/拖拽/token 治理继续独立；不把 P0-1 单独实现成第二个文档保存状态机 |
| [ENTRY-CLIPBOARD](ENTRY-CLIPBOARD.md) | 若选择“复制正文副本”，其中正文载荷复制改为本计划的文档/资产/节点身份语义，不能复制旧 Markdown 字符串；跨项目重映射复用 C7 | 列表剪切/复制/多选、分类归属、引用还是副本的产品决定、剪贴板存续范围仍归该计划；未完成替代入口前保持现有分类变更能力 |

## 6. 验收方式

阶段退出必须同时有自动化门禁和原生人工记录，浏览器预览只能证明静态布局。实验 Chrome 交互不能替代 WKWebView、WebView2 或 Android WebView；以下命令是后续实现批次的门禁，本批只写文档，不运行 lint/build、技术尖刺或界面操作。缺平台/设备时保留未执行项及原因，不能写通过。

### 6.1 自动化门禁

阶段 A 和 C 均使用完整构建门禁与有行为意义的相关测试。当前 package.json 没有统一前端 test 命令，新增页面测试沿用本仓 Node 测试形式并在实现时提供明确文件清单；不能把“相关测试”留成无执行入口的占位。

| 阶段 | app_main 前端（本仓根） | app_main Rust（`src-tauri/`） | core_world_data（该仓根） |
| --- | --- | --- | --- |
| A1–A3 各切片退出 | `npm run lint && npm run build`；`node --test --experimental-strip-types <本切片测试文件列表>`，覆盖依赖边界、同源 fixture、bridge 拒绝、协议/CAS 适配；精确命令入审计包 | `cargo test`，含页面重校验、command/资产协议测试 | `cargo test` 和 `cargo test --no-default-features --features sqlite`，含创建/保存/重开/失败及引用完整性；不缩成 `--lib` |
| C1–C8 各步及 C 整体退出 | `npm run lint && npm run build`；同一 Node 入口运行对应内核/会话/覆盖/AI/链接/历史/包/移动状态测试；C3 加现有 `npm run test:side-panel-layout` | `cargo test`，覆盖绕过前端、AI 写入口、索引/反链、冲突与 `.fcworld` | `cargo test` 和 `cargo test --no-default-features --features sqlite`，覆盖迁移、FTS、snapshot/world_store 和往返 |

### 6.2 桌面原生应用人工清单

桌面验收在 macOS WKWebView 与 Windows WebView2 分开执行和记录，发布 CSP 必须真实生效。每份记录附 commit、构建方式、OS/WebView 版本、样例、结果和证据，不能合写“桌面已通过”；Linux 正式支持路径在相应平台产物上补同项回归。

| 项目 | 前置条件 | 操作步骤 | 预期结果 |
| --- | --- | --- | --- |
| A1 隔离/bridge | 发布 CSP 的原生最小入口，合法/恶意固定样例及资源请求观测已接入 | 逐项加载样例，触发越权/网络/导航；发送伪造、重放、过期消息，销毁再重建画布 | 合法内容显示；无作用域逃逸或网络请求；只有当前受信 bridge 生效 |
| A1 中文输入与 DOM | 中文输入法、长文/复杂行内样例 | 组合期连续输入并切候选，换行/粘贴，等待候选渲染，再取消和撤销 | 不吞字/重复；临时 DOM 不写回；选区/输入焦点和源码一致 |
| A2 两条存储切片 | 独立开发数据库、词条/首页最小入口、失败注入开关 | 分别创建、修改、保存、关闭重开，再各触发一次事务中途失败并重试 | 成功数据齐全；失败全回滚且草稿保留；首页与默认模板身份分开 |
| A3 资产 | 固定资产与受管协议、离线输出目录 | 插图、保存、重开、移动导出目录、离线查看，尝试越权/缺失 ID | 身份稳定，资源可读，越权拒绝，无路径泄露 |
| C2/C3 工作台与 Dock | C 必须能力已接入，双作用域样例 | 画布/图层切选、键盘导航、源码改节点类型后重选；切工具，打开 AI/属性分栏并收起；调整预览宽度及写入范围后保存重载 | 工具适用性、功能区密度、焦点和无障碍树正确；宽度不偷改作用域；双作用域重载一致 |
| C3 Grid/数值交互 | 宽窄 Grid、长图/长文、复杂值样例 | 连续拖动、滚动后定位、取消指针、恢复、改一个轴/边，撤销重做，完成整个人物卡 | 一次拖动一步历史，无假生效，原单位/未改字段/阅读顺序保留 |
| C4/C6 AI/冲突/关闭 | 可用 AI 配置、可制造旧 revision 的第二会话 | 预览/部分应用/取消 AI；候选期间继续输入；制造保存失败/冲突；分别保存并关闭、放弃、取消 | 旧候选拒绝；状态清晰；无丢稿、自动覆盖或取消后的后台写入 |
| C5/C7 搜索/链接/交换 | UUID 与标题内链、跨项目目标、独立导入目录 | 保存、搜索、改名/删链接查看反链，导出/导入并重开；再导入畸形包 | 搜索是文本投影；出链/反链刷新；源码、资产与历史往返；失败不覆盖既有数据 |
| C 用户任务 | §5.3 任务材料、非专业参与者 | 逐项执行并记录耗时、卡点、最终产物 | 必须任务可完成；阻断项关闭，证据与功能/能力版本对应 |

### 6.3 Android debug APK 人工清单

Android 验收使用加载真实 Tauri 后端与本地数据库的 debug APK，独立于桌面数据执行。A1 另需记录发布 CSP 等效配置的证明；开发服务器可用或桌面数据已保存都不能代替 Android 结果。

| 项目 | 前置条件 | 操作步骤 | 预期结果 |
| --- | --- | --- | --- |
| A1 隔离与 bridge | debug APK、发布 CSP 等效入口、已记录设备/WebView 版本 | 重做恶意资源/IPC/导航拒绝与 bridge 合法、伪造、过期消息流程 | 合法消息可用，越权/网络请求不发生，画布不触达宿主权限 |
| A1 组合输入/软键盘 | 中文输入法、长文、内部滚动和原生遮挡记录 | 文末拼音选词、换行、粘贴、选区；收放键盘、横竖屏、进入/退出沉浸入口 | 光标可见，内容无重复/丢失；外壳不二次缩小/平移；caret reveal 只由内部滚动承担 |
| A2 两条切片 | 设备本地测试库和失败注入入口 | 词条/首页各自创建、保存、关闭重开，再失败重试 | 两条切片独立通过；失败不前进 revision 或派生数据，不引用桌面记录证明 |
| A3 资产往返 | 设备本地合法/损坏资产、离线输出能力 | 插图重开、离线导出到新位置，重新导入；读取无权 ID | 正文只存逻辑 ID；协议正确解析、原件保全，非法资源拒绝 |
| C8 受控编辑 | C 必须移动入口已实现 | 内联/沉浸编辑文本、格式、内链、图片；触发返回/取消/保存；查看复杂 Grid/未知节点 | 同一草稿，保存态可辨；受限部分原样保留，手势不误删、返回不丢稿 |
| C 整体闭环 | 独立本地项目、可用 AI 配置、失败/冲突场景 | 走创建→编辑→AI 预览/应用→撤销→保存/冲突→搜索/反链→导出/导入→重开，并执行 §5.3 移动任务 | 完整链路有最终产物，任务耗时与卡点可追溯；缺凭据的 AI 项标未执行，不能算整体通过 |

证据统一提交到 `app_main/designs/audits/<主题>-<日期>/`，索引登记包内 README。证据包含操作清单结果、精确自动化命令、源快照、样例和必要的截图/录屏/请求日志；不能引用仓外临时文件，不能记录凭据或真实用户正文。实验自身自动截图空白的现象随实验结束不再追查、不移交；它既不作为生产缺陷，也不作为正常渲染证据。

## 7. 继承的遗留问题

移交清单第 5 节的七项遗留均进入 C 或 C 之后的独立能力项，不进入 A。实验未完成它们，基础闭环和增强交互的前置模型各不相同；下面保留缺口及前置设计，按能力卡补证后才开放，代价是 C 不承诺一次覆盖全部排版功能。

| 遗留问题 | 归属 | 前置设计与验收 |
| --- | --- | --- |
| 双线边框圆角只影响外线 | C3 基础边框/圆角收口 | 先确定内外线几何与源码表示；组合样例在原生验证。未修正前该组合不可作为完整支持，C 退出须修正或明确限制这一组合 |
| 图库子项管理 | C 之后并行 | 先定义子项稳定身份、增删/排序/替换的原子操作及资源引用生命周期，再做管理入口；不与移动端附件浏览器混为同一能力 |
| 表格中间插入行列 | C 之后并行 | 先定义 cell 身份、相邻轴定位、内容归位、CSS 引用迁移与一步撤销；C 可先提供矩形表格基础输入和已证实的末尾增删 |
| 画布拖拽裁切 | C 之后并行，依赖 B | 先定义裁切手势、取消/提交与一次手势一次历史；引用原件，裁切参数不覆盖原图；C 的图片焦点/比例控件不算已实现拖拽裁切 |
| 列表嵌套 | C 之后并行 | 先定义真实父子 list/list-item、有限层级、编号起点、最后一项约束及阅读/键盘顺序，不用 CSS 缩进伪装结构 |
| 常用样式库 | C 之后并行，衔接 D 接口 | 先定义样式来源与主题 token/节点固定覆盖的关系、应用/恢复和依赖保全；不能先存一段样式再补继承规则 |
| 旋转后挤开占位 | C 之后并行 | 只有外接框可行性结论，正式结构未实现；先定义占位包装、尺寸来源与 Block/Flex/Grid 关系、节点身份、写回和命中，再验证两档/负角/长文/撤销。不把普通 rotate 控件等同占位支持 |

## 8. 待决事项

以下事项只在对应步骤开始前需要决策，不阻塞本计划提交。已有方向提供了候选边界，但隔离、数据和操作范围还缺生产证据；按表中步骤关闭并记录理由，阶段 A 不提前冻结 C 的能力策略，代价是后续证据改变选择时要同步样例与版本。

| 待决项 | 阻塞哪一步 | 候选方案 | 建议 |
| --- | --- | --- | --- |
| 隔离机制 | A1 退出、C2 原生画布 | opaque sandbox iframe 的 srcdoc/blob 载入；独立受限 WebView/来源 | 优先验证最小 opaque iframe + 可信 bridge；发布 CSP、无网络、三端输入或权限边界任一不成立则比较独立 WebView，不以 Chrome 结果定案 |
| 生产数据布局与事务边界 | A2 建模 | 词条/首页各自持源码；明确领域关联的页面记录 | 先在 ADR 比较更新、联合保存、删除与快照需求，再用两条切片选择；只抽共享保存行为，不预设 owner 多态；保存失败/幂等键重试必须有确定语义 |
| HTML/CSS 能力策略 | A1 最小安全配置、C2/C3 源码与能力放开、C 最终冻结 | 有限允许集；能力分类与拒绝规则结合受限可视子集 | 按安全/能力/平台可移植性/资源四类诊断，先以可证明安全的子集启动；未知合法源码保全与可执行能力分开。作者预检始终不弱于 Rust，按原生证据逐项放开，不在 A 冻结全属性表 |
| 旧 Markdown 开发数据 | C1 数据切换前 | 一次性转换；备份后重置 | 默认建议备份后重置可再生开发数据；需要保留的样例做显式一次性转换并验证图片/链接，无双写或长期兼容 |
| 移动端可编辑范围 | C8 入口开放 | 文本/基础格式/内链/图片的受控编辑；逐步开放完整布局 | 建议 C 覆盖基本写作闭环，保留复杂源码与布局读取，复杂编排经独立能力验收扩展；不降为长期只读，也不保留 Markdown 编辑入口 |
| `fc://` 内链静态导出降级 | C7 静态导出退出 | 包内页面/锚点；纯文本 | 包内可解析目标生成相对页面/锚点，外部项目或未解析标题降为保留显示文字并附导出诊断；不伪造失效链接。该选择不改变数据库中的逻辑引用 |
| 通用控件进入 lib_ui 的边界 | C3 控件实现/公开 API | 整体迁控件；只抽输入展示原语；全部留本仓 | 按 §3.2 只抽数值与无业务颜色选择，单位复用 Select，四边及样式语义留领域；颜色 API 未证明可复用前先在本仓组合，不阻断整个 C |

块集合和断点模型在 C 验收前保持可调，不另设无依据的提前决策。建议从实验的移动基础/桌面覆盖两档及基础块开始，以非专业任务和原生样例验证；需要改变时同步能力卡、fixture、保存/导出版本规则。D 的完整模板升级/组件实例策略、阶段 E 容器字节布局和后续高级能力不阻塞本计划的 A/C，不列为本批待决事项。


## 实施进度

- M1 数据 ADR：完成（98e1fa3）。
- M2 core_world_data 存储切片：完成（0900e80、3d1b1ec、aba6338）。词条与项目首页均有独立记录、revision CAS、幂等回执、派生文本和出链事务；回归覆盖项目首页创建、保存、重开、过期 revision，同键异内容拒绝，中途失败全回滚、已有回执不能绕过词条归属检查及每目标 64 条回执上限。`cargo test` 为 122 项通过；SQLite 最小特性链为 103 项通过。
- M3 Rust 校验与 Tauri command：完成当前页面文档存取切片（ca78378、0c4d3a1、c4b13f4）。`app_main` 使用 HTML5 解析树和 CSS token 校验源码，生成派生文本与出链目标；词条命令打开所属世界的词条库，项目首页命令打开项目库，错误保持结构化。链接白名单和 HTML 元素、属性及资源规则已通过共享样例与前端内核统一。`src-tauri/cargo test` 为 159 项通过、1 项联网测试忽略，其中页面文档契约集成测试 9 项通过。
- M4 文档内核：移植完成（ca78378、aeee508）。`npm run test:page-document` 明确覆盖全部 35 个测试文件，共 259 项通过；领域导入闭包由测试约束为不依赖 React、Tauri、DOM 全局及反向业务模块。
- M5 草稿会话：部分完成（ca78378）。草稿、操作队列、冲突重试和历史模型已移植；生产 hooks 尚未移植，也未接入界面。
- M6 隔离画布：未开始。此前最小 iframe 画布壳已撤回，当前没有生产挂载或原生隔离证据。
- M7 桌面编辑页：未开始。此前工作区挂载、属性 Dock 注册和分栏配对已撤回，待真正的编辑页批次重新实现。
