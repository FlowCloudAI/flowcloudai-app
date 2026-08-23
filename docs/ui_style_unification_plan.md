# FlowCloudAI UI 风格统一改造计划

## 1. 文档目的

本文档用于指导 `FlowCloudAI App` 前端界面的长期视觉统一改造。目标不是“把所有页面做成完全一样”，而是基于 UI
库既有语义令牌建立同一套视觉语言，使不同页面在以下层面保持一致：

- 颜色来源一致
- 明暗主题切换一致
- 页面骨架一致
- 组件状态表达一致
- 尺度系统一致
- 品牌气质一致

本计划的唯一主题基线来自 UI 库语义令牌文件：

- `lib_ui/ui/src/style/index.css`

应用层不得再自行定义第二套主题系统；如需补充视觉能力，应优先扩展 UI 库语义令牌，而不是在应用内局部发明新变量。

---

## 2. 语义令牌基线

### 2.1 令牌分层

UI 库当前已经给出完整的三层结构：

1. 基础色板
    - `--fc-blue-*`
    - `--fc-gray-*`
    - `--fc-red-*`
    - `--fc-green-*`
    - `--fc-yellow-*`
    - `--fc-purple-*`
    - `--fc-orange-*`
    - `--fc-teal-*`
    - `--fc-pink-*`

2. 语义颜色
    - 主色：`--fc-color-primary`、`--fc-color-primary-hover`、`--fc-color-primary-active`、`--fc-color-primary-subtle`
    - 背景：`--fc-color-bg`、`--fc-color-bg-secondary`、`--fc-color-bg-tertiary`、`--fc-color-bg-elevated`、
      `--fc-color-bg-overlay`
    - 文字：`--fc-color-text`、`--fc-color-text-secondary`、`--fc-color-text-tertiary`、`--fc-color-text-disabled`
    - 边框：`--fc-color-border`、`--fc-color-border-light`、`--fc-color-border-hover`、`--fc-color-border-focus`
    - 状态：`--fc-color-danger-*`、`--fc-color-success-*`、`--fc-color-warning-*`、`--fc-color-info-*`
    - 辅助强调：`--fc-color-purple*`、`--fc-color-orange*`、`--fc-color-teal*`、`--fc-color-pink*`

3. 尺度与行为
    - 间距：`--fc-space-xs` ~ `--fc-space-3xl`
    - 圆角：`--fc-radius-xs` ~ `--fc-radius-full`
    - 字体：`--fc-font-family`、`--fc-font-size-*`、`--fc-font-weight-*`、`--fc-line-height-*`
    - 阴影：`--fc-shadow-xs` ~ `--fc-shadow-lg`
    - 过渡：`--fc-transition*`
    - 层级：`--fc-z-*`

### 2.2 应用层使用原则

应用层只允许直接使用以下两类 token：

- 语义颜色 token
- 尺度与行为 token

应用层默认禁止直接使用以下内容：

- `--fc-blue-*`、`--fc-gray-*` 等基础色板
- 业务页面自定义 `--bg-*`、`--text-*`、`--accent-*`
- 未沉淀到语义 token 的裸 `#hex` / `rgb()` / `rgba()`

例外只有两类：

1. 临时过渡期，为兼容旧页面而保留的 fallback
2. 需要透明叠加时的少量 `rgba()`，且无法用现有语义 token 表达

---

## 3. 目标视觉方向

### 3.1 整体气质

FlowCloudAI 应统一为“桌面创作工具”视觉，而不是“营销页 + 系统设置页 + 独立工具页”的混合体。

建议采用以下总体方向：

- 主基调：中性、克制、稳定，强调可读性与长时间使用舒适度
- 主强调色：蓝色系主色 `--fc-color-primary`
- 功能状态色：成功 / 警告 / 错误 / 信息严格走语义状态色
- 辅助强调色：紫 / 橙 / 青 / 粉只用于标签、类型、状态映射，不用于页面主结构
- 明暗主题：完全依赖 UI 库 token，页面层不额外维护一套暗色写法

### 3.2 页面差异边界

允许不同页面有信息密度差异，但以下内容必须统一：

- 页面外层留白体系
- 标题层级
- 顶部工具栏结构
- 卡片容器语言
- 空状态语言
- 错误 / 成功 / 警告反馈语言
- 分栏拖拽手柄样式
- 交互 hover / active / focus 反馈

不允许出现“同级页面使用完全不同的按钮、边框、背景层级和选中态表达”。

---

## 4. 当前问题总结

基于当前应用前端审查，现状问题主要分为五类。

### 4.1 存在多套主题来源

当前项目同时存在：

- UI 库 `--fc-*` 语义令牌体系
- 应用壳层自定义旧变量体系
- 若干组件内部旧式 fallback 体系

典型问题：

- `src/App.css` 已完成改造，旧变量已基本清理
- 个别弹窗和历史页面仍使用 `--bg-primary`、`--border-color`、`--text-secondary` 等历史变量

这会造成主题切换与统一改色成本持续上升。

### 4.2 颜色语义未收口

当前页面大量已接入 `--fc-color-*`，但仍混入较多裸色值、渐变和局部硬编码。结果是：

- 同样是错误提示，不同页面底色和边框表达不同
- 同样是选中态，不同页面有的用边框，有的用底色，有的用渐变
- 同样是高亮卡片，不同页面有不同风格的 overlay 与阴影

### 4.3 尺度系统接入不完整

部分页面已经使用 `--fc-radius-*`、`--fc-font-size-*`、`--fc-space-*`、`--fc-shadow-*`，但仍有不少页面继续直接写：

- `10px / 12px / 14px / 18px`
- `0.75rem / 0.9rem / 1.2rem`
- 自定义 box-shadow

结果是不同页面的密度、圆角和层次感不一致。

### 4.4 页面骨架语言不统一

当前主要页面分成三种风格来源：

- `ProjectList`：品牌化展示页
- `ProjectEditor`、`Idea`、`AIChatContent`：工具型工作台
- `Settings`：传统系统设置页

这些差异部分合理，但缺少统一的壳层规则，导致它们看起来像不同子产品。

### 4.5 重复样式与局部特例较多

当前已经能看到：

- 插件管理样式被合并进设置页，同时历史插件页样式仍然存在
- 某些窗口按钮和面板状态使用 inline style 局部覆盖
- 某些功能面板自行定义错误 banner、状态标签和 Mono 风格标签

这类局部特例会不断破坏整体一致性。

---

## 5. 统一规范

## 5.1 颜色规范

### 页面结构颜色

| 场景            | 允许 token                  | 说明            |
|:--------------|:--------------------------|:--------------|
| 应用最外层背景       | `--fc-color-bg`           | 主工作区背景        |
| 二级面板 / 工具栏    | `--fc-color-bg-secondary` | 侧栏、顶部工具条、次级区域 |
| 更深一层容器        | `--fc-color-bg-tertiary`  | 选项组、分段背景、滚动轨道 |
| 浮层 / 卡片 / 对话框 | `--fc-color-bg-elevated`  | Modal、浮层、独立卡片 |
| 遮罩            | `--fc-color-bg-overlay`   | Backdrop、覆盖层  |

### 文字颜色

| 场景            | 允许 token                                              |
|:--------------|:------------------------------------------------------|
| 主标题 / 正文      | `--fc-color-text`                                     |
| 次要说明 / 元数据    | `--fc-color-text-secondary`                           |
| 更弱提示 / 禁用辅助信息 | `--fc-color-text-tertiary`                            |
| 禁用态控件文字       | `--fc-color-text-disabled`                            |
| 主按钮文字         | `--fc-color-text-on-primary`                          |
| 链接            | `--fc-color-text-link` / `--fc-color-text-link-hover` |

### 状态颜色

| 状态 | 主文字 / 图标             | 背景                      | 边框                          |
|:---|:---------------------|:------------------------|:----------------------------|
| 错误 | `--fc-color-danger`  | `--fc-color-danger-bg`  | `--fc-color-danger-border`  |
| 成功 | `--fc-color-success` | `--fc-color-success-bg` | `--fc-color-success-border` |
| 警告 | `--fc-color-warning` | `--fc-color-warning-bg` | `--fc-color-warning-border` |
| 信息 | `--fc-color-info`    | `--fc-color-info-bg`    | `--fc-color-info-border`    |

### 强调色使用边界

主结构只允许使用：

- `--fc-color-primary`
- `--fc-color-primary-hover`
- `--fc-color-primary-active`
- `--fc-color-primary-subtle`

辅助强调色只允许用于：

- 标签类型映射
- 分类或状态点缀
- 图例、徽标、类型 chip

辅助强调色禁止直接用于：

- 全页背景
- 页面主按钮
- 主导航选中态
- 结构性边框主色

## 5.2 尺度规范

### 间距

统一按 UI 库空间体系使用：

- 极小间距：`--fc-space-xs`
- 小间距：`--fc-space-sm`
- 默认控件间距：`--fc-space-md`
- 默认区块内边距：`--fc-space-lg`
- 大块内容区：`--fc-space-xl`
- 空状态 / 大型容器：`--fc-space-2xl` ~ `--fc-space-3xl`

应用层禁止再直接写“视觉上差不多”的随机数值作为常规间距。

### 圆角

统一建议：

- 小控件：`--fc-radius-sm`
- 常规输入框 / 卡片 / 列表项：`--fc-radius-md`
- 大卡片 / 大型面板 / modal：`--fc-radius-lg` 或 `--fc-radius-xl`
- 标签 / pill：`--fc-radius-full`

### 字体

统一建议：

- 辅助标记 / meta：`--fc-font-size-xs`
- 次级控件文本：`--fc-font-size-sm`
- 默认正文：建议新增并统一为 `--fc-font-size-md`
- 区块标题：`--fc-font-size-lg`
- 页面主标题：`--fc-font-size-xl`

应用层正文应优先使用 `--fc-font-family`，不应再在普通页面强行切成代码字体。Mono 字体只用于：

- commit id
- diff
- 技术标识
- 机器生成编号

### 阴影

统一建议：

- 普通卡片：`--fc-shadow-xs` 或 `--fc-shadow-sm`
- 悬浮卡片 / hover 提升：`--fc-shadow-md`
- modal / 大型浮层：`--fc-shadow-lg`

禁止在各页面继续散落自定义阴影值，除非视觉需求无法由现有 token 表达，且需先回补到 UI 库。

## 5.3 交互规范

### Hover

- 普通 hover：优先通过 `background` 或 `border-color` 的轻微变化表达
- 不允许 hover 态在不同页面出现完全不同的运动强度和高亮逻辑
- 悬浮提升仅用于卡片、可点击面板，不应用于所有按钮

### Active / Selected

统一规则：

- 选中态优先使用 `--fc-color-primary-subtle` 作为底色
- 必要时叠加 `--fc-color-primary` 或 `--fc-color-info-border` 作为边框
- 不再允许每个页面自己定义选中态底色体系

### Focus

统一依赖 UI 库全局 `:focus-visible` 样式，不额外手写多套 focus ring。

---

## 6. 页面与组件统一策略

## 6.1 应用壳层

范围：

- `app/index/AppRoot`
- `App.css`
- 顶栏
- 标签栏容器
- 左侧导航
- 右侧可停靠面板外壳

要求：

- 删除应用壳层旧主题变量，只保留 UI 库语义 token
- 窗口按钮 hover / danger 态改为语义色，不使用局部硬编码
- 顶栏、标签栏、侧栏背景层级统一到 `bg / bg-secondary / border`
- 拖拽手柄视觉统一复用同一模式

## 6.2 一级页面

### ProjectList

定位：品牌化首页，但必须服从工作台视觉。

要求：

- 保留一定品牌感，但品牌表达只集中在空状态、封面占位和少数 hero 区域
- 常规工具栏、筛选、反馈条、卡片边框、卡片 hover 必须回归语义 token
- 不能让首页成为独立视觉体系

### ProjectEditor / Idea / Settings / AIChatContent

定位：主工作台样式基准页。

要求：

- 作为“桌面创作工作区”标准模板
- 其分栏、概览卡片、工具页容器应成为其他工作页的参考骨架
- 页面内所有字号、边框、状态卡、统计卡必须进一步 token 化

### Idea

定位：侧面板中的次级工作台。

要求：

- 视觉语言与 `ProjectEditor` 保持同系，只降低密度，不另起风格
- 左栏列表、编辑器头部、状态提示、分段按钮与主工作台共享结构规则

### Settings

定位：应用配置页。

要求：

- 从“传统设置页”调整为“工作台内配置页”
- 保持层级简单，不使用与主产品割裂的表单布局
- 插件管理区块与设置区块共享相同的 `SectionCard` 语言

### AIChatContent

定位：沉浸式辅助创作面板。

要求：

- 允许比普通页面更强的场景感，但壳层和基础控件仍必须统一
- 人设会话、报告会话等差异仅通过语义色和局部背景层表达
- 不允许形成独立色彩宇宙

## 6.3 共用组件层

应沉淀为统一基元的组件包括：

- 页面头部 `WorkspaceHeader`
- 区块容器 `SectionCard`
- 筛选与搜索条 `FilterBar`
- 空状态 `EmptyState`
- 反馈条 `StatusBanner`
- 分栏拖拽 `SplitHandle`
- 标签 / 徽章 `Badge` / `Chip`
- 列表项选中态模式

如果同类结构已在 3 个以上页面重复出现，必须优先抽象，不再复制 CSS。

---

## 7. 改造分期

## 7.1 Phase 0：建立基线

目标：

- 明确应用层只能消费 UI 库语义 token
- 冻结新增旧变量和裸色值
- 产出迁移规范与审查清单

交付物：

- 本文档
- 样式审查 checklist
- 旧变量清单
- 需要复用的页面骨架清单

完成标准：

- 新增样式不得继续引入 `--bg-*` / `--text-*` / `--accent-*`
- 新增页面不得自行定义主色体系

## 7.2 Phase 1：壳层统一

范围：

- `App.css`
- `App.tsx`
- 全局滚动条、焦点、body、页面容器
- 右侧停靠面板外壳

目标：

- 先统一“应用像不像一个产品”

重点事项：

- 移除旧 `root` 变量
- 统一顶部条、主内容区、侧栏、右侧面板的背景层级
- 统一窗口控制按钮和高频 hover 逻辑

## 7.3 Phase 2：高频页面统一

范围：

- `ProjectList`
- `ProjectEditor`
- `Idea`
- `Settings`
- `AIChatContent`

目标：

- 统一高频主路径的视觉骨架和状态表达

重点事项：

- 抽离共用 header / section / filter / empty state 模式
- 明确首页品牌区与工作区的分界
- 收敛选中态、工具栏、筛选 tab、反馈条

## 7.4 Phase 3：功能面板和弹窗统一

范围：

- 地图面板
- 矛盾检查
- 时间线
- 快照面板
- 词条相关弹窗
- 图片相关弹窗

目标：

- 消除“功能页各做各的控件皮肤”

重点事项：

- 统一 modal、drawer、banner、badge、列表卡、统计卡
- 删除历史 fallback 变量
- 统一错误 / 警告 / 成功反馈样式

## 7.5 Phase 4：重复样式清理与治理

范围：

- 历史页面残留
- 已废弃样式
- 重复插件管理样式
- inline style 局部覆写
- demo 页面与正式页面的样式分流

目标：

- 把“统一”从一次性改造变成长期可维持状态

重点事项：

- 合并重复 CSS
- 删除死样式
- 把仍在复用的局部特例提升为公共组件或公共 token

---

## 8. 实施规则

### 8.1 允许做的事

- 使用 `--fc-color-*`、`--fc-space-*`、`--fc-radius-*`、`--fc-font-*`、`--fc-shadow-*`
- 使用 `color-mix()` 基于语义 token 做轻量态差异
- 在业务组件中按语义 token 组合出 hover / active / selected
- 将重复样式抽成公共类、公共组件或 UI 库能力

### 8.2 禁止做的事

- 在应用层继续新增 `--bg-*`、`--text-*`、`--accent-*`
- 在结构样式里直接引用基础色板 token
- 在常规页面继续使用大量裸 `#hex` / `rgba()`
- 某个页面为了“更好看”独立发明一套背景和状态体系
- 为单个页面复制一份几乎相同的设置 / 插件 / 卡片样式

### 8.3 特例流程

如果现有语义 token 无法表达所需视觉，应按以下顺序处理：

1. 先确认是否真的是新语义，而不是实现方式问题
2. 若是新语义，应先补到 UI 库 token
3. 应用层等 UI 库 token 可用后再接入

不允许跳过 UI 库，直接在应用层补一套局部 token。

---

## 9. 验收标准

完成统一改造后，应满足以下标准。

### 9.1 令牌层

- 应用层不再依赖旧 `--bg-*` / `--text-*` / `--accent-*`
- 应用层不再新增基础色板直接引用
- 高频页面不再依赖大面积裸色值

### 9.2 视觉层

- 顶栏、侧栏、主工作区、停靠面板来自同一套壳层语言
- 一级页面在标题、工具栏、反馈、空状态上表达一致
- 弹窗、卡片、列表项、统计卡的圆角、边框、阴影有统一规则
- 明暗主题切换时，页面无明显“漏切换”区域

### 9.3 代码层

- 重复样式明显减少
- 相同视觉结构优先复用公共组件
- 页面 CSS 更偏业务布局，基础视觉规则下沉到公共层

### 9.4 协作层

- 新增页面默认接入统一骨架
- 代码评审可以明确指出是否违反 token 约束
- 长周期开发不会再次把界面拉回多体系并存状态

---

## 10. 首批落地建议

建议第一轮不追求“大而全”，而是先做最能改变整体观感的一批：

1. 清理 `App.css` 旧变量，完成应用壳层统一
2. 以 `ProjectEditor` 为基准抽出 `WorkspaceHeader`、`SectionCard`、`StatusBanner`
3. 同步改造 `ProjectList`、`Idea`、`Settings`
4. 清理 `EntryEditModal` 这类仍依赖旧变量的弹窗
5. 合并插件管理重复样式，避免设置页和旧插件页继续漂移

完成这一步后，再推进 AI 面板、地图、矛盾检查、快照等复杂区域，会更稳，也更容易评审。

---

## 11. 结论

本次统一改造的核心不是重新设计一套新皮肤，而是让应用层彻底服从 UI 库已经存在的语义 token，并把“品牌表达”和“工具可用性”收敛到同一产品语言里。

后续所有页面和组件的判断标准都应回到一句话：

> 这个样式是否是在消费 UI 库语义令牌，还是又在应用层发明了一套新的视觉规则？

只要这个边界守住，风格统一就能从一次性工程，变成可持续维护的工程。