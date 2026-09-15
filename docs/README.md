# app_main 文档索引

> 更新日期：2026-09-15
>
> 本索引覆盖 `app_main` 全部项目文档：`docs/`、`plans/`、`designs/`。
> 平台构建手册（iOS / macOS / Android）是 `AGENTS.md` 明确要求先读的前置文档，见 §1。
> **问题排查记录不在本仓**，统一在工作区 `docs/devlog/`，见 §8。

## 状态含义

| 状态 | 含义 |
| --- | --- |
| `现行` | 当前有效，可直接作为判断依据 |
| `提议；macOS、Android 已原生验收，Windows 待验证` | 已选定代码方案并通过 macOS 与 Android 原生验收，但 Windows WebView2 和发布 CSP 结论仍待验证 |
| `待评审` | 可交互设计提案，尚未授权生产实现；只用于评审布局、入口和产品取舍 |
| `归档` | 已完成工作的过程记录，只用于追溯 |
| `结论记录` | 设计 QA，但视觉证据已丢失，只剩当时的判断 |

## 1. 平台构建、调试与发布（改构建链路前必读）

| 文档 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| [tauri_macos_debug_and_release.md](tauri_macos_debug_and_release.md) | 现行 | 2026-09-13 | macOS 原生窗口、`underWindowBackground` 材质、透明 WKWebView 私有 API、文件打开队列、启动显示死锁、调试、DMG、Developer ID 签名与公证边界。`AGENTS.md` 指定的 macOS 权威手册 |
| [tauri_ios_debug_and_release.md](tauri_ios_debug_and_release.md) | 现行 | 2026-08-17 | iOS 环境自检、真机调试、Archive 与 IPA 导出。`AGENTS.md` 指定的 iOS 权威手册。最低支持 iOS 16.2 |
| [Android.md](Android.md) | 现行 | 2026-09-13 | Android 测试流程与 ADB 约定，包名 `cn.flowcloudai.www`；含 APK 构建脚本与 release keystore 签名约束 |
| [publish.md](publish.md) | 现行 | 2026-05-27 | 桌面端 Windows 发布与 Tauri updater 签名、上传流程 |

> Android 模拟器加载不到 Vite 的排查过程见 `docs/devlog/2026-08-16-android-模拟器-vite-不可达.md`；日常统一用 `npm run android:dev`。

## 2. 架构决策与开发规范

| 文档 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| [adr/0001-frontend-feature-modular-monolith.md](adr/0001-frontend-feature-modular-monolith.md) | 现行 | 2026-07-21 | ADR：前端功能模块化单体。`app` / `features` / `api` / `shared` 的边界与禁止跨模块复用界面内部实现 |
| [adr/0002-page-document-storage.md](adr/0002-page-document-storage.md) | 现行 | 2026-09-14 | 页面文档独立存储、revision CAS、幂等回执与派生投影语义 |
| [adr/0003-page-document-canvas-isolation.md](adr/0003-page-document-canvas-isolation.md) | 提议；macOS、Android 已原生验收，Windows 待验证 | 2026-09-15 | 页面文档采用独立打包页面、opaque sandbox、严格画布 CSP 与带会话鉴权 bridge；macOS 与 Android 已确认隔离、样式、网络拦截、导航、尺寸及生命周期，Windows 待验 |
| [dock_panel_child_page_guide.md](dock_panel_child_page_guide.md) | 现行 | 2026-09-13 | 新增 `DockableSidePanel` 子页面的结构、样式与验证约定 |
| [ui_style_unification_plan.md](ui_style_unification_plan.md) | 现行 | 2026-05-20 | 长期视觉统一改造计划，基于 UI 库语义令牌建立统一视觉语言 |
| [plugin_system_guide.md](plugin_system_guide.md) | 现行 | 2026-05-07 | 插件系统两层架构与联调指南 |
| [prompt_README.md](prompt_README.md) | 现行 | 2026-05-07 | Prompt & Tools 模块结构：`context_builders` / Tera 模板 / `senses` |
| [agent-runtime-hardening.md](agent-runtime-hardening.md) | 现行 | 2026-08-01 | AI Agent 运行时加固：自动精简对话记忆，阈值 75% → 65% |
| [mobile_desktop_shared_audit.md](mobile_desktop_shared_audit.md) | 现行 | 2026-08-30 | **移动端与桌面端的复用/解耦审计**：8 项问题，每项先答「该不该做」。建议现在动的只有前三项（时间解析器四份拷贝、灵感域文案已分叉、插件安装错误处理不等价）；设置自动保存、Markdown 命令、错误横幅明确建议暂不合并并写明理由。附「已经做对、别改」清单与复核触发条件 |

## 3. 地图与渲染

| 文档 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| [map_shader_pipeline.md](map_shader_pipeline.md) | 现行 | 2026-07-09 | **地图 Shader 渲染管线**：迁移动机、插件化双实现架构、10 个插件、水墨核心 GLSL、推荐配置与未完成项。由 `plans/` 下 12 篇同日文档合并。**注意 §6：所有加速倍数均为预估，基准测试从未执行** |
| [semantic_map_generation_design.md](semantic_map_generation_design.md) | 现行 | 2026-08-04 | 「用户调结果，后端管公式」的语义化控制与确定性渲染引擎设计。含 4 处未落地项 |
| [map_shape_editor_backend_mvp.md](map_shape_editor_backend_mvp.md) | 现行 | 2026-08-04 | MapShapeEditor Rust 后端 MVP。**顶部明确标注 3 个特性仍在设计阶段、MVP 未实现** |
| [coastline_algorithm_redesign.md](coastline_algorithm_redesign.md) | 现行 | 2026-06-13 | 海岸线自然化算法重构。方案 A 已落地为独立模块 `coastline_v2.rs`，v1 仍是默认。**参数细节以本文为准；v1 根因与 v2.1~v2.8 的问题演化链另见 `docs/devlog/2026-06-10-海岸线-八轮实测修正.md`** |
| [tauri_deterministic_layout_engine.md](tauri_deterministic_layout_engine.md) | 现行 | 2026-05-07 | 词条关系图确定性布局引擎的输入协议与算法 |
| [Ink.md](Ink.md) | 现行 | 2026-07-08 | 水墨（宣纸）预设的视觉优化分析。只谈视觉 |
| [Tolkien.md](Tolkien.md) | 现行 | 2026-07-08 | 托尔金（羊皮纸）预设的视觉优化分析。只谈视觉 |
| [Map_LOD.md](Map_LOD.md) | 归档 | 2026-05-26 | 地图 Pixi LOD 实现报告，降低大规模多边形预览的绘制压力。**固定 tolerance 为何不可靠见 `docs/devlog/2026-05-26-地图-lod-固定容差失效.md`** |

## 4. 移动端

| 文档 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| [Mobile_world.md](Mobile_world.md) | 现行 | 2026-08-02 | 移动端世界观/词条能力缺口与方案。§7 持续记录实现进展，含 10 处未完成项。总计划见 `../plans/ANDROID-01.md` |
| [mobile_keyboard_layout.md](mobile_keyboard_layout.md) | 现行 | 2026-08-24 | **移动端软键盘布局接管方案与完整复盘**：Android 用 `WindowInsetsCompat`，iOS 用 `UIKeyboard` 事件与 `keyboardLayoutGuide` 兜底；两端共享 `--fc-kb` 内部布局契约但保持原生来源互斥。记录预测/整壳移动等失败方案、旧 WebView 边界、系统输入附件栏的构造期移除、AI/灵感差异化间距及目标真机验收。跨系统版本、第三方输入法与 iPad 矩阵仍是发布闸门 |
| [mobile_ai_capability_scope.md](mobile_ai_capability_scope.md) | 现行 | 2026-08-30 | **移动端 AI 能力范围与已知取舍**：哪些能力有意不做、为什么。含指令能力（应用感知指令 / 指令模板 / 对话级提示词）移动端不提供入口、分支切换两端一并压后、工具面板与权限模式重叠故不做、相机图库保留占位。附已补齐清单与复核触发条件 |
| [mobile_keyboard_platform_diff.html](mobile_keyboard_platform_diff.html) | 历史教学模型 | 2026-08-23 | 并排演示旧纯前端方案中的视觉视口平移与“预让修复”。只用于理解被替换方案为何失败；现行 Android 已改用原生实际 Insets，不能用该模型验收当前实现 |

> 移动端的问题排查记录（返回手势、键盘布局、WebView 光栅化、TLS、图标安全区等 7 篇）已迁至 `docs/devlog/`，见 §8。

## 5. 归档

| 文档 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| [主窗口亚克力毛玻璃实现纪要.md](主窗口亚克力毛玻璃实现纪要.md) | 归档 | 2026-05-31 | 桌面端主窗口毛玻璃效果的讨论与落地记录。**能力边界结论（CSS 做不到透出桌面）另见 `docs/devlog/2026-05-31-主窗口毛玻璃-能力边界.md`** |
| [app_main_fcui_token_audit_memory.md](app_main_fcui_token_audit_memory.md) | 归档 | 2026-06-01 | `--fc-*` 语义令牌审计结论固化，防止口径漂移。组件复用现行口径见 `AGENTS.md`「复用与数据安全」 |
| [0.2.3_change.md](0.2.3_change.md) | 归档 | 2026-05-14 | 0.2.3 改动的按文件影响排查清单 |
| [windows_font_package_size_comparison.md](windows_font_package_size_comparison.md) | 归档 | 2026-08-08 | 加入字体前后 Windows 安装包体积对比：10.7 MiB → 59.2 MiB |

## 6. 待办与计划（`../plans/`）

`plans/` 只放开放中的计划。完成后的过程记录应合并进 `docs/` 或删除，不要在此堆积。

| 文档 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| [../plans/ANDROID-01.md](../plans/ANDROID-01.md) | 现行 | 2026-08-02 | **Android 端唯一权威计划**，自述取代原 `MOBILE-01.md`。核心闭环 + 安装升级构建链路 |
| [../plans/MOBILE-ENTRY-DETAIL-REBUILD.md](../plans/MOBILE-ENTRY-DETAIL-REBUILD.md) | 现行 | 2026-08-25 | **移动端词条详情改造落地计划**（待开工）。5 个步骤、每步的验证与真机流程、8 条已确认决定、7 类易踩坑。§1 明确设计稿只是布局与视觉参考，列出「绝对不能搬进程序的东西」对照表 |
| [../plans/ENTRY-CLIPBOARD.md](../plans/ENTRY-CLIPBOARD.md) | 现行 | 2026-08-25 | **词条剪切 / 复制 / 多选**（待开工）。把分类归属变更从词条编辑页内部移出，改由列表与分类树上的剪贴操作完成；复制语义、多选触发方式、剪贴板存续范围等 6 项待定 |
| [../plans/UI-01.md](../plans/UI-01.md) | 现行 | 2026-09-13 | 桌面端工作台交互问题核对：位置感、编辑对象、保存态、AI 引用对象 |
| [../plans/PAGE-DOCUMENT-01.md](../plans/PAGE-DOCUMENT-01.md) | 现行 | 2026-09-14 | 页面文档编辑接入计划：移植式重写、代码现状、阶段 A 原生隔离/存储/资产切片、阶段 C 词条闭环、能力准入与验收；衔接移动详情、保存状态和词条剪贴计划 |
| [../plans/ENTRY-RELATION-WORKBENCH.md](../plans/ENTRY-RELATION-WORKBENCH.md) | 现行 | 2026-07-31 | 词条关系工作台布局。**自述「暂缓实现，日后重新评审」**，两栏方案前提已被宽度验证否决 |

## 7. 设计基线与设计稿（`../designs/`）

`AGENTS.md`「设计稿」规定何时需要先出单文件 HTML 设计稿（`designs/<主题名>.html`），制作规则见 [`设计稿约定.md`](../designs/设计稿约定.md)。

| 文档 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| [../designs/设计稿约定.md](../designs/设计稿约定.md) | 现行 | 2026-09-13 | 设计稿的交付形式、单文件约束、状态拆分、反馈迭代、证据留存与确认流程；由 `AGENTS.md` 迁入 |
| [../designs/entry-page-editor-chrome.html](../designs/entry-page-editor-chrome.html) | 待评审 | 2026-09-13 | **词条页面编辑器界面设计稿**：只改外壳与密度，不动功能语义。属性面板不新增第三列，改为住进桌面壳右侧既有的 Dock 槽位（与灵感 / AI / 快照 / 帮助 同一槽位，互斥切换），左栏只留图层与项目导航；AI 与属性可上下分屏，中间分隔条可拖、拖到端点松手即收起一格。Dock 列宽按内容给下限（属性 17–22rem、AI 20–32rem），Dock 吃到 AI 下限时左栏收成 44px 图标条，正文在四种状态下都保住 760px。槽位由 `grid-template-areas` 定位，与 `.workspace-content` 现行实现一致；右侧图标栏按真实实现画在最右（`SideBar placement="right"`）。另取消编辑器标题栏改工作条，画布 bg-secondary 底 + 760px 页面卡片，底部状态条。整屏自适应，不设固定场景宽度与断点：全部用 clamp / minmax / fr，首屏不出现滚动条；右上角实时显示画布与正文余量。含 6 项待确认决定 |
| [../designs/desktop-entry-workspace.html](../designs/desktop-entry-workspace.html) | 待评审 | 2026-09-11 | **词条页面编辑落位设计稿**：词条 Tab 内统一“阅读 / 编辑页面”，可视、展示校对和代码共享一份草稿，AI 只保留全局入口；给出 1440 / 1024 / 低于 988px 的三栏与浮层预算、390px 移动端受控编辑、项目首页关系和 Markdown 回退边界。四个场景互斥展示，仅本地交互，未接入生产数据或原生窗口 |
| [../designs/desktop-project-home.html](../designs/desktop-project-home.html) | 现行 | 2026-09-07 | **待评审项目首页设计稿**：项目 Tab 内的阅读/编辑、介绍、动态词条卡片、筛选、排版和手机预览；管理、类型模板与组件库保留独立入口说明。模拟来源更新不改变首页草稿；仅内存交互，未连接数据库或 AI，未做视觉验收。完整对象边界见工作区 `docs/词条主题换装系统规划.md` §0.11 |
| [../designs/apple-ios-ui-ux-design-guidelines.md](../designs/apple-ios-ui-ux-design-guidelines.md) | 现行 | 2026-08-17 | 项目级 iOS/iPadOS 设计基线与验收清单。官方资料核验于 2026-08-17，对标 iOS 27，项目最低 iOS 16.2 |
| [../designs/mobile-ui-baseline.md](../designs/mobile-ui-baseline.md) | 现行 | 2026-08-26 | 移动端 UI 基线规范 v1。**只管「尺度与结构」，不管视觉风格**；平台契约已同步 Android/iOS 独立原生键盘来源与共享 `--fc-kb` 内部布局边界；§5.3 登记公共顶栏固定材质阴影的唯一例外，§9 规则 8 规定底部面板不承载滚动或输入内容 |
| [../designs/ios-mobile-hig-gap-audit.md](../designs/ios-mobile-hig-gap-audit.md) | 现行 | 2026-08-24 | 移动端对 iOS 规范的差距审计；IOS-005 已用独立 iOS 原生适配器在目标 iPhone 核心页面关闭，仍保留 iOS 16.2、第三方输入法与 iPad 验收边界 |
| [../designs/mobile-ui-baseline-implementation.md](../designs/mobile-ui-baseline-implementation.md) | 现行 | 2026-08-18 | 基线落地记录。作用域 `data-fc-density="touch"`，桌面 `comfortable` 不消费本批覆盖 |
| [../designs/mobile-topbar-material-spec.md](../designs/mobile-topbar-material-spec.md) | 现行 | 2026-08-26 | 移动端公共顶栏亮暗材质参数与生产映射。固化五段背景渐变、独立顶栏/胶囊 blur、胶囊渐变、细边框、内高光、外阴影，以及安全区和触控命中区的映射边界 |
| [../designs/mobile-topbar-material-lab.html](../designs/mobile-topbar-material-lab.html) | 现行 | 2026-08-26 | 移动端公共顶栏材质实验室。右侧用真实词条信息层级模拟滚动背景；左侧实时调节顶栏五段渐变、顶栏与胶囊各自独立的模糊层、胶囊线性渐变、细边框、内高光与柔和外阴影。亮色与暗色保存独立参数，支持预设、重置、粘贴 JSON 快速应用以及 CSS / JSON 导出 |
| [../designs/mobile-entry-detail.html](../designs/mobile-entry-detail.html) | 现行 | 2026-08-25 | 移动端词条详情排版稿，**展示态与编辑态合并在一份**（同属 `MobileEntryDetail.tsx`）。展示态：图片升为主视觉、类型与分类上移到标题下、属性改定义列表、未填写折叠、空正文给主操作。编辑态：元数据整体移到正文之上、类型与分类在身份区可改、正文头压到 40px、保存改文字按钮、属性页改 iOS 分组列表。14 个状态，含 390/360 与深浅色。展示态属性改流式 chip 且不显示未填写、关联用箭头表方向、正反链默认收起、新增图片浏览器（单图 / 画廊多选）；编辑页不再能改所属分类（见 `plans/ENTRY-CLIPBOARD.md`）。原 `mobile-entry-editor.html` 已并入本文件 |
| [../designs/mobile-entry-editor-design-qa.md](../designs/mobile-entry-editor-design-qa.md) | 结论记录 | 2026-08-03 | 移动端词条编辑设计 QA。视觉证据已丢失 |
| [../designs/mobile-entry-editor-ai-review-design-qa.md](../designs/mobile-entry-editor-ai-review-design-qa.md) | 结论记录 | 2026-08-02 | 移动端词条编辑与 AI 差异审阅 QA |
| [../designs/mobile-world-check-design-qa.md](../designs/mobile-world-check-design-qa.md) | 结论记录 | 2026-08-06 | 移动端设定检测设计 QA。视觉证据已丢失 |
| [../designs/mobile-world-check-implementation-qa.md](../designs/mobile-world-check-implementation-qa.md) | 结论记录 | 2026-08-06 | 移动端设定检测实现 QA。视觉证据已丢失 |
| [../designs/entry-default-cover-design-qa.md](../designs/entry-default-cover-design-qa.md) | 结论记录 | 2026-08-08 | 词条默认封面层级调整 QA。视觉证据已丢失 |

### 审计包（`../designs/audits/`）

**这是正确的证据留存方式**——截图与矢量源文件都提交进仓库，结论可复核。新增设计 QA 一律照此办理。

下表按审计包索引，包内的实现 QA、交付清单等附属文档以各包 `README.md` 为入口。

| 审计包 | 日期 | 结论 |
| --- | --- | --- |
| [android-modal-back-2026-09-11](../designs/audits/android-modal-back-2026-09-11/README.md) | 2026-09-11 | Xiaomi 24129RT7CC / Android 16 真机核对确认框、三键返回与预测性返回；K2/K3/K4/K6/K8、G1/G2/G3 通过，K7 部分通过，K1 当前移动入口不适用，K5/G4/G5 未执行 |
| [mobile-topbar-material-lab-2026-08-26](../designs/audits/mobile-topbar-material-lab-2026-08-26/README.md) | 2026-08-26 | 公共顶栏材质实验室初始版本的亮暗渲染、实时参数、三种滚动背景、导出与窄屏验证；含真实 Android 顶栏与模拟实现的同画面对照。后续默认参数、独立滤镜层与 JSON 导入按用户要求仅做静态检查 |
| [mobile-entry-editor-followup-2026-08-26](../designs/audits/mobile-entry-editor-followup-2026-08-26/README.md) | 2026-08-26 | Android 真机复现并闭环词条正文工具栏间距、键盘收起占屏、长文光标错位、预览态蓝底、标准图片顶栏、取消按钮位置与长正文挤压主图；含前后截图、CSS 尺寸和临时草稿恢复证据 |
| [mobile-entry-ui-2026-08-26](../designs/audits/mobile-entry-ui-2026-08-26/README.md) | 2026-08-26 | 词条查看、编辑、键盘、属性与关系流程的 Android 真机 UI/UX 审计与优化闭环；字段名称、关系无候选空态、属性层级、保存语言和顶栏重量已落地并经最终 APK 复测，图片浏览器仍缺真实图片手势证据 |
| [mobile-entry-detail-rebuild-2026-08-26](../designs/audits/mobile-entry-detail-rebuild-2026-08-26/README.md) | 2026-08-26 | 词条详情改造首轮实现与设计稿的 16 项偏差修正，含修复前后真机对比。记录了 `mobileAccessibility.css` 公共触控兜底 (0,1,2) 压过业务 `.class button` (0,1,1) 的特异性坑 |
| [mobile-entry-link-navigation-2026-08-25](../designs/audits/mobile-entry-link-navigation-2026-08-25/README.md) | 2026-08-25 | 编辑态预览的双链把应用导航成 Chrome 错误页的真机前后对比，附首张词条查看态真机截图。问题→方案见 `docs/devlog/2026-08-25-移动端预览链接把应用打没.md`（工作区根仓库） |
| [mobile-ai-mode-menu-redesign-2026-08-19](../designs/audits/mobile-ai-mode-menu-redesign-2026-08-19/README.md) | 2026-08-19 | AI 模式菜单轻量化，选定 Marker-Only 方案。含实现 QA 与交付清单，Android 真机核对通过 |
| [mobile-ai-svg-icons-2026-08-19](../designs/audits/mobile-ai-svg-icons-2026-08-19/README.md) | 2026-08-19 | 五枚 AI 操作图标。审计通过，已接入代码并完成 Android 真机视觉核对 |
| [mobile-entry-editor-2026-08-24](../designs/audits/mobile-entry-editor-2026-08-24/README.md) | 2026-08-24 | 移动端词条编辑主页、属性页与关系页重构。代码与构建已通过，Android/iOS 原生视觉和触摸验收仍待补证 |
| [android-键盘布局-2026-08-23](../designs/audits/android-键盘布局-2026-08-23/README.md) | 2026-08-23 | 被替换的纯前端键盘方案录屏与新原生 Insets 路径的目标真机验收说明；现行机制以键盘权威文档为准 |
| [mobile-keyboard-probe-2026-08-20](../designs/audits/mobile-keyboard-probe-2026-08-20/README.md) | 2026-08-20 | iPhone 15 Pro / iOS 26.6 的 WKWebView 键盘行为探针，固定了 `interactive-widget`、视觉视口平移和安全区事实 |
| [ios-input-viewport-2026-08-18](../designs/audits/ios-input-viewport-2026-08-18/README.md) | 2026-08-18 | iOS 输入视口回归验证，iPhone 17 Pro / iOS 26.5 模拟器，8 张过程截图。问题→方案摘要见 `docs/devlog/2026-08-18-ios-输入视口-二次缩短.md` |
| [mobile-entry-immersive-keyboard-2026-08-18](../designs/audits/mobile-entry-immersive-keyboard-2026-08-18/README.md) | 2026-08-18 | 沉浸编辑键盘上方窄缝透出下层页面的修复，前后对比截图。问题→方案摘要见 `docs/devlog/2026-08-18-移动端沉浸编辑-键盘窄缝.md` |
| [mobile-platform-contract-2026-08-18](../designs/audits/mobile-platform-contract-2026-08-18/README.md) | 2026-08-18 | 主题与系统栏同步。**iOS 已验证；Android 仅代码实现，缺 debug APK + ADB 运行证据** |

## 8. 开发记录（已迁至工作区 `docs/devlog/`）

问题排查记录统一收在工作区根仓库的 `docs/devlog/`，索引是 `docs/devlog/README.md`。
**这些文件不在 `app_main` 仓库内**——单独 clone `app_main` 看不到，需要工作区。

以下 10 篇由本仓 `docs/` 迁出（2026-08-19），原文件已删除，git 历史仍可追溯：

| 原文件 | 现位置 |
| --- | --- |
| `tauri_android_dev_debugging.md` | `docs/devlog/2026-08-16-android-模拟器-vite-不可达.md` |
| `mobile-native-ui-retrospective-2026-08-19.md` | `docs/devlog/2026-08-19-移动端原生交互-复盘.md` |
| `mobile_android_webview_paint_bug.md` | `docs/devlog/2026-06-12-android-webview-光栅化压扁.md`（状态：**已推翻**） |
| `android_adaptive_icon_safe_zone_fix.md` | `docs/devlog/2026-07-18-android-自适应图标-安全区.md` |
| `android_plugin_market_tls_verifier.md` | `docs/devlog/2026-07-04-android-插件库-tls-校验.md` |
| `mobile_markdown_cursor_offset_fix.md` | `docs/devlog/2026-06-20-移动端-markdown-光标偏移.md` |
| `test_issue.md` | `docs/devlog/2026-06-02-cargo-test-入口点缺失.md` |
| `Map-Resize.md` | `docs/devlog/2026-05-27-地图预览-resize-拉伸.md` |
| `ColorThemeRisk.md` | `docs/devlog/2026-05-26-颜色主题-csp-拦截.md` |
| `Settings保存重绘.md` | `docs/devlog/2026-05-20-settings-保存提示重绘.md` |

另有 4 篇从本仓文档中**抽取**的记录（源文档仍在本仓，见 §3 / §5 / §7 的备注）：海岸线八轮修正、地图 LOD 固定容差、主窗口毛玻璃能力边界、iOS 输入视口与沉浸编辑键盘。

## 9. 相关的跨仓文档（在根 `docs/`）

- `docs/devlog/2026-06-04-移动端插件-页对齐-sigabrt.md` — 移动端插件 `SIGABRT` 根因在 `core_ai_client`。**结论是硬约束：移动端必须用 Pulley 解释器**
- `docs/前端风格指南.md` — 前端硬红线与 review 检查表，适用范围含 `app_main/src/`
- `docs/VVD_FlowCloudAI_Worldbuilding_UX_Analysis.md` — 与 vvd 的创作体验对照，待产品决策
- `docs/archive/architecture-2026-05/` — 2026-05/06 架构评审战役，含桌面 UI 与双端 UI 审计
