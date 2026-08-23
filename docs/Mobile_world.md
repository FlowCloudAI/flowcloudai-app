# 移动端世界观能力补齐 · 缺口与方案分析

> 范围：`app_main` 移动端「世界观 / 词条」相关能力；对照桌面端功能面找缺口、定方案与优先级。
> 关联：当前总计划见 `app_main/plans/ANDROID-01.md`；本文是世界观/词条切片的历史审计，不覆盖 AI 对话、灵感、设置等其它切片。
> 现状口径来源：后端命令面 `app_main/src/api/worldflow.ts` + 各移动页（`src/app/mobile/pages/*`）**实际调用**的命令。
> 性质：原始缺口分析创建于 2026-06-05；后续实现进展持续记录在 §7，矩阵中的移动端状态已按最新首版落地情况更新。

---

## 0. 目标与边界

- **目标**：把移动端「世界观 / 词条」能力补齐到与核心创作闭环匹配——设定党用手机也能**建结构、写词条、组织资料**，而不只是浏览。
- **不是**：桌面全功能搬运。重/可视化功能（关系图谱、世界地图、时间线、快照版本、矛盾检测、角色对话）仍属 backlog。
- **关键认知（现由 ANDROID-01 保留）**：能力对齐 ≠ 布局对齐；手机上手填结构化字段反人性，**AI 是没键盘学生的「键盘替身」**——这条会直接影响 P2/P3 的做法（见 §4）。

---

## 1. 移动端现状（世界观/词条已有能力）

| 域 | 移动端已有 | 实现方式 |
|---|---|---|
| 项目 | 列表、查看、**新建**、**导入 `.fcworld`**（带冲突/进度） | `MobileProjectList` 复用桌面 `ProjectCreator` + `ProjectImportConflictDialog` + `FcworldProgressDialog` |
| 项目概览 | 部分统计 | `MobileProjectHome` 调 `db_get_project_stats` |
| 词条 | 列表、搜索、**新建**、查看、编辑（标题/类型/分类/摘要/正文 MD） | `MobileEntryList` / `MobileEntryDetail`（查看↔编辑同屏切换） |
| 分类 / 类型 | **只读**（编辑时作为下拉项） | `db_list_categories` / `db_list_all_entry_types` |
| AI | 对词条/项目发起 AI 讨论 | `setAiFocus` + 切到 AI Tab |

> 重要事实：移动端**已经在复用桌面的模态组件**（`ProjectCreator` 等）。这是后面「复用判断」的基石。

---

## 2. 缺口矩阵（桌面有 / 移动首版状态）

### 2.1 词条本身（编辑 / 字段）

| 能力 | 桌面 | 移动 | 后端命令 / 组件 |
|---|---|---|---|
| 标题/类型/分类/摘要/正文(MD) | ✓ | ✓ | 已有 |
| **删除词条** | ✓ | ✓ 首版 | `db_delete_entry` |
| **标签 Tags**（schema 化属性/数值） | ✓ 完整 | ✓ 首版 | `TagSchema` + `EntryTag`；`TagCreator` / `TagItem` |
| **图片 / 封面**（含远程导入、灯箱） | ✓ | ✓ 首版 | `FCImage` + `import_entry_images`；`EntryImageAddModal` / `EntryImageLightbox` |
| **正文 `[[wiki]]` 链接**（补全+预览+跳转） | ✓ | ✓ 首版 | `EntryLink` + `db_*_links`；移动端自建输入框下方候选面板 |

### 2.2 世界观结构

| 能力 | 桌面 | 移动 | 后端命令 / 组件 |
|---|---|---|---|
| **分类树** 建/改/删/移动 | ✓ | ✓ 首版 | `db_create/update/delete_category`；移动端轻量缩进列表 + 选择父分类 |
| **自定义词条类型** 建/改/删（图标·色） | ✓ | ✓ 首版 | `db_create/update/delete_entry_type`；`EntryTypeCreator` |
| 项目 新建 / 导入 `.fcworld` | ✓ | ✓ | 已有 |
| **项目 重命名 / 编辑(封面·描述) / 删除** | ✓ | ✓ 首版 | `db_update_project` / `db_delete_project`；`ProjectCoverPickerModal` |
| 项目 导出 `.fcworld` | ✓ | ✓ 首版 | `db_export_project_fcworld` + `FcworldProgressDialog` |

### 2.3 关联（世界观「经络」）

| 能力 | 桌面 | 移动 | 后端命令 / 组件 |
|---|---|---|---|
| **词条关系** Relations（A↔B + 说明） | ✓ 编辑 | ✓ 首版 | `db_*_relation`；`EntryRelationCreator` |
| 词条互链 EntryLink | ✓ | ✓ 首版 | `db_*_links` |

### 2.4 Backlog（不算核心词条，重/可视化，押后）

关系图谱（`db_get_relation_graph_data`）、世界地图、时间线（`db_list_timeline_events`）、快照/版本、设定矛盾检测、角色对话。
（项目统计/治理 `db_get_project_stats` 已在 `MobileProjectHome` 展示了一部分。）

---

## 3. 复用可行性（成本的关键变量）

把候选桌面组件按**形态**分两类——这决定了"白嫖"还是"重做"：

- **模态式（`open` / `onClose`）→ 能像 `ProjectCreator` 一样直接塞进移动浮层，几乎白嫖**：
  `EntryTypeCreator`（新建类型）、`TagCreator`（建标签 schema）、`EntryImageAddModal`（加图）、`ProjectCoverPickerModal`（项目封面）。
- **桌面面板 / 视图 → 不能直接复用，移动需另做**：
  `CategoryView`（分类树+虚拟网格，是项目页主视图）、`EntryEditorMetaPanel`（给词条**赋**标签值）、`EntryRelationCreator`（内嵌面板）、`useWikiLink`（绑死桌面输入框 + 弹出定位）。

> **Caveat**：早期移动端计划已记录这些可复用模态各自手搓 `.acm-overlay` 式背板，在手机上是桌面尺寸的弹窗——**能用但非移动优化**（宽度/触达）。先用后修，长远并入统一 `Overlay` 基座（`src/shared/ui/overlay/`）。

---

## 4. 优先级建议

| 批次 | 内容 | 复用 / 成本 |
|---|---|---|
| **P1 · 闭环硬缺口** | 删词条 · 自定义类型新建 · 项目重命名/删除/封面 · **分类树增删改移** | 除分类树外都廉价（白嫖模态 + 直接接 db）；分类树最费工（见 §5） |
| **P2 · 世界观「血肉」** | 标签 Tags · 封面/图片 | schema 创建/加图复用模态（低）；**赋值/展示**需移动 UI（中） |
| **P3 · 世界观「经络」** | `[[wiki]]` 链接 · 词条关系编辑 | wiki 链接成本高（绑编辑器）；关系编辑中等 |

### 两条贯穿性结论

1. **复用决定成本曲线**：P1 真正的重头**只有「分类树管理」**一项（唯一不能复用桌面模态的）；其余 P1 项几乎是顺手的事。
2. **AI 当键盘替身——可能改写 P2/P3 的做法**：标签赋值、关系、wiki 链接这类「填结构化字段/连线」在手机上最反人性，恰是 ANDROID-01 保留的 AI 主场。**值得评估的方向**：这些字段移动端**先只做「展示 + 让 AI 写」**（"给这角色加 阵营=帝国"、"把 A 和 B 设成盟友"），把手动编辑 UI 降级为后置/可选。这能大幅砍掉 P2/P3 的移动原生 UI 工作量，更贴手机心智；代价是把 backlog 的「AI 浮动面板」提前到关键路径（但那本就在规划中）。

---

## 5. 专题：分类树管理（P1 最费工项）

### 5.1 桌面怎么做

- 前端（`pages/ProjectEditor.tsx`）：用 `flowcloudai-ui` 的 **`Tree`**（`flatToTree` / `CategoryTreeNode` / `DropPosition` / `DeleteDialog`）——一棵 **可拖拽树**（lib_ui 的 Tree 走 @dnd-kit），放在**可调宽的左侧分栏**里（`treeWidth` / `treeCollapsed` / 分隔条拖动）。
- 后端（`core_world_data`）领域复杂度：`would_create_cycle`（移动时防止把节点拖到自身子孙下）、`sort_order`（同级手动排序）、递归 CTE（树可任意深），以及**三种删除语义**（见 §6）。

### 5.2 难点重估（含已修正的结论）

- **手势冲突——此前判断已收回。** 早前认为"横向拖改嵌套"会和 ANDROID-01 的"横划=抽屉/边缘返回"语义重载，是**错的**。**长按拖拽**即可化解：长按是「闸门」，在任何位移之前就把手势判给拖拽；横划开抽屉/边缘返回都要求"落手即移动、无前置长按"，二者靠"有没有先长按"在**时间上**分得干净。连"树住在横划抽屉里"也不冲突（关抽屉=落手即横划，拖节点=长按后再横移，不是同一个动作）。长按激活**同时**也解决了"纵向拖 vs 列表滚动"。这是出货级成熟范式——参考 **Workflowy / Notion 移动端大纲**的"长按拎起、横拖 indent/outdent 改父级"。
- **真正的成本（常规活 + 打磨，非死结）**：
  1. **移植**：lib_ui 的 `Tree` 是 @dnd-kit **鼠标向**，需接触屏 sensor、拖拽预览、落点指示线；非开箱即用。
  2. **落点精度**：`DropPosition` 的 before / after / **inside** 在十几像素高的小行上，需清晰视觉反馈（插入线 vs 整行高亮=放进去）让手指点准。
  3. **实时挡环**：拖动中即时判 `would_create_cycle` 等价逻辑，把"放进自身子孙"标为禁止放置并反馈。
  4. **低端机**：拖动 + 边缘自动滚的流畅度要测（性能约束）。
  5. **三态删除**：仍要一个移动确认浮层（见 §6）。
- **轻量替代**（若不想先做拖拽）：缩进列表 + 每项菜单（重命名/删除/**选父分类**）；reparent 用"选父"下拉（候选**排除自身整棵子树**）、不做拖放；排序先按名称/时间、手排后置。能把成本从"中"再压一档。

### 5.3 结论

分类树是 **P1 里最费工的一项**——因为它是**唯一不能复用桌面模态、必须把树移植到触屏**的；但**交互范式是走通且成熟的，不存在手势层面的硬冲突**。可拖拽树 / 轻量"选父"列表二选一，按工期定。

---

## 6. 删除分类的三种语义（领域复杂度备忘）

后端提供三个删除函数，对应一个真实用户问题——**"删这个分类时，里面的子分类和词条怎么办？"**：

| 函数 | 行为 |
|---|---|
| `delete_category` | 普通删除 |
| `cascade_delete_category` | 连子树 + 词条一起删（返回删了哪些，需向用户展示影响量） |
| `delete_category_move_to_parent` | 删自己、把子节点**上提到父级保留** |

桌面用 `DeleteDialog` 承载这个三选一；移动端**任何分类删除入口**都必须重做一个带后果选择的移动确认浮层（"一起删 / 子项上移保留"），不能只接一个 `db_delete_category`。

---

## 7. 当前状态与下一步

- **进展（2026-06-05）**：P1「除分类树外」已落地于 `app_main`——**删词条 · 新建自定义类型 · 项目重命名/换封面/删除**；沉淀两个可复用浮层原语 `ActionMenu` / `RenameDialog`（`src/shared/ui/overlay/`）。删词条、新建类型、换封面均复用既有桌面模态/确认（`EntryTypeCreator` / `ProjectCoverPickerModal` / `Alert`）。`tsc -b` + `eslint` 通过，**待真机/预览验证交互**。commit `71cb2c0` / `bd0b889` / `1918485`。
- **进展（2026-06-07）**：项目级 **类型 / 标签 schema 管理**已落地，移动端项目页新增「类型与标签」入口，复用 `EntryTypeCreator` / `TagCreator` 做新建、编辑、删除；词条编辑页已支持标签值编辑，查看页支持标签展示，复用 `TagItem`。移动端新建项目沿用桌面同一 `ProjectCreator` → `db_create_project` → `create_project_with_default_timeline_tags` 链路，默认标签初始化不需要额外前端分支；内置类型由 `db_list_all_entry_types` 统一提供。`npm exec tsc -- --noEmit`、`npm run lint`、`npm run build` 通过，**待真机/预览验证交互**。commit `7f98c5d` / `7922417`。
- **进展（2026-06-07）**：**分类管理（P1 最后一块）**已落地首版，采用 §5 的轻量「缩进列表 + 每项菜单 + 选择父分类」方案：支持新建根分类/子分类、重命名、移动父级、浏览分类词条、删除分类三态（仅删空分类 / 子项上移保留 / 连同子分类和词条删除）。同时新增 Tauri 命令 `db_cascade_delete_category` / `db_delete_category_move_to_parent`，移动端删除不再只靠前端递归普通删除。`npm exec tsc -- --noEmit`、`cargo check`、`npm run lint`、`npm run build` 通过，**待真机/预览验证交互**。commit `ac643ac`。
- **进展（2026-06-07）**：**词条图片 / 封面（P2）**已落地首版：查看态展示词条图片与主图标记；编辑态支持本地导入、AI 生成导入、设为主图、移除、插入正文 `fcimg:` 引用并随词条保存 `images`；正文预览改用桌面同源 `buildMarkdownPreviewSource` 解析图片引用。复用 `EntryImageAddModal` / `EntryImageLightbox` / `entryImage` helper。`npm exec tsc -- --noEmit`、`npm run lint`、`npm run build` 通过，**待真机/预览验证交互**。commit `eaa5ce2`。
- **进展（2026-06-07）**：**P3 互链 / 关系只读展示**已落地首版：移动词条详情加载 `db_list_outgoing_links` / `db_list_incoming_links` / `db_list_relations_for_entry`，查看态新增「关联」区，展示结构化关系、正文提到、反链，并支持点开目标词条。`npm exec tsc -- --noEmit`、`npm run lint`、`npm run build` 通过，**待真机/预览验证交互**。commit `2440e06`。
- **进展（2026-06-07）**：**P3 关系编辑**已落地首版：移动编辑态复用桌面 `EntryRelationCreator`，支持新增/删除关系、选择目标词条、选择方向、填写关系说明；保存流程切到 `db_save_entry_bundle`，词条字段、标签、图片与关系草稿一次提交。`npm exec tsc -- --noEmit`、`npm run lint`、`npm run build` 通过，**待真机/预览验证交互**。commit `ecdbf3d`。
- **进展（2026-06-07）**：**P3 wiki / 内部链接跳转**已落地首版：移动正文预览拦截 `entry://` 与 `entry-title://`，支持点击已解析 markdown 内链和 `[[标题]]` legacy 链接跳转目标词条；安全外链走系统打开，非法链接阻止。`npm exec tsc -- --noEmit`、`npm run lint`、`npm run build` 通过，**待真机/预览验证交互**。commit `c3ee86f`。
- **进展（2026-06-08）**：**P3 wiki 链接输入体验**已落地首版：移动编辑态正文 textarea 识别未闭合 `[[`，展示词条候选；支持点选、方向键/回车/Tab 选中，插入桌面同源 `entry://id` markdown 内链；无精确同分类匹配时可创建新词条并插入链接。移动端未复刻桌面光标绝对定位 popover，而采用输入框下方候选面板以降低软键盘遮挡与定位抖动。`npm exec tsc -- --noEmit`、`npm run lint`、`npm run build` 通过，当前文件范围 `git diff --check` 通过；全仓 `diff --check` 仍受已有 `AGENTS.md` / `README.md` 尾随空格影响。**待真机/预览验证交互**。commit `feed902`。
- **进展（2026-06-08）**：**P3 AI 写入路径**已落地首版：移动 AI 页暴露读者 / 助手 / 作家三态，直接复用 `useAiController` 的 `toolAccessMode` 与后端 task context（读者禁写，助手写入需确认，作家可自动写）；切换模式会重建后端 session，保证下一轮发送使用新权限。移动词条详情补齐 `ENTRY_UPDATED` / `ENTRY_DELETED` 监听：查看态自动刷新，编辑态存在未保存修改时跳过覆盖并提示。`npm exec tsc -- --noEmit`、`npm run lint`、`npm run build` 通过，当前文件范围 `git diff --check` 通过。**待真机/预览验证 AI 写入与刷新链路**。commit `6d3d8fd`。
- **进展（2026-06-08）**：**项目描述编辑 / `.fcworld` 导出**已落地首版：项目 ⋯ 菜单新增「编辑描述」与「导出 .fcworld」；描述编辑复用 `FloatingPanel`，导出复用桌面同源 `saveFileDialog`、`db_export_project_fcworld`、`useFcworldProgress`、`FcworldProgressDialog`。`npm exec tsc -- --noEmit`、`npm run lint`、`npm run build` 通过，当前文件范围 `git diff --check` 通过。**待真机/预览验证保存对话框与导出进度**。commit `bc8c89d`。
- **下一步**：集中真机/预览验收上述 P1-P3 能力；若 AI 写入不能覆盖高频场景，再补标签/关系/链接的手动加速器。
- **流程**（承 ANDROID-01 的可验证任务口径）：选定一批 → 明确真机判据 → 再编码与验收。
- **后续顺序**：真机验收 → 修交互问题 → 完成 Android 分发与导入导出；地图、矛盾检测等高级功能维持不做，除非产品范围重新决策。
