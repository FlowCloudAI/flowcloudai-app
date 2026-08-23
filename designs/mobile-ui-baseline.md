# FlowCloudAI 移动端 UI 基线规范 v1

> 适用范围：`app_main` 移动端壳层（`src/app/mobile/**`）及被其消费的共享组件。iOS 与 Android 共用同一套 React/CSS，本规范同时对两端生效。
> 文档定位：**这是「尺度与结构」的规范，不是视觉风格指南。** 它只回答「用哪个值、值放在哪」，不回答「好不好看」。风格另开文档，且必须建立在本规范之上。
> 建立日期：2026-08-18
> 键盘平台契约更新：2026-08-24
> 配套文档：`designs/apple-ios-ui-ux-design-guidelines.md`（Apple 平台细则）、`designs/ios-mobile-hig-gap-audit.md`（历史差距审计）

---

## 0. 这份文档要解决的问题

建立本规范时的实测数据（`src/app/mobile/**` 静态统计 + iPhone 17 Pro / iOS 26.5 模拟器实机截图）：

| 问题 | 实测 |
|---|---|
| 硬编码尺寸值 | **120 个**不同取值，其中约 113 个不在任何网格上（`0.42rem` / `1.22rem` / `19.65rem`） |
| 字号分布 | 约 **3/4** 的 `font-size` 落在 13px 或 15px；全 App 仅 12 处 ≥ 20px |
| 字重 token | **8 个**，但中文字形（PingFang SC 最粗 600 / Noto Sans CJK 通常仅 400·500·700）下实际只渲染出 1～2 档 |
| 阴影 token | **16 个** |
| 边框 token | **6 个**，透明度相差 2%，肉眼不可分辨 |
| z-index | **14 个**裸数值，无语义层 |
| 安全区 | **19 个文件、39 处**直接书写 `env(safe-area-inset-*)` |
| 动态字号 | 系统 content size 调至 `extra-extra-extra-large` 后，界面**逐像素无变化** |
| 颜色硬编码 | **0 处**（本项已达标，继续保持） |
| 圆角 | 已基本收口到 token（本项已达标，继续保持） |

结论：项目缺的不是「更多规则」，而是**一层语义 token**。规则写在文档里会被忘记，写成 token 才会被强制执行。

### 0.1 唯一核心原则

> **业务 CSS 只允许消费语义 token，不允许出现裸数值。**

「裸数值」指未经 token 包装的 `rem` / `px` / 颜色 / 时长 / z-index。唯一豁免见 §13.2。

这条原则带来的直接收益：**后续调整只改 token 定义处一行，不需要逐文件替换。** 例如把区块间距从 24px 改成 32px，只改 `--mobile-gap-section` 一处。

---

## 1. 三层 Token 模型

```text
L0 基础标尺 (primitive)     lib_ui/ui/src/style/index.css
   --fc-space-* / --fc-radius-* / --fc-color-*          由 flowcloudai-ui 维护，跨端共享
        ↓ 被引用
L1 语义 token (semantic)    app_main/src/app/mobile/mobileTokens.css   ← 本规范新增
   --mobile-gap-section / --mobile-text-title / ...     移动端专用，声明「用途」而非「数值」
        ↓ 被引用
L2 业务样式                 各页面 .css
   只写 var(--mobile-*)，不写数值
```

### 1.1 落点文件与修改权限

| 层 | 文件 | 谁可以改 | 改动影响面 |
|---|---|---|---|
| L0 | `lib_ui/ui/src/style/index.css` | 需同步回归 `app_main` + `site_flowcloudai` | 桌面端 + 移动端 + 网站 |
| L1 | `app_main/src/app/mobile/mobileTokens.css` | 移动端负责人，改动需过本规范 | 仅移动端（`data-fc-density="touch"` 作用域） |
| L1 补充 | `mobileTypography.css`（字号标尺）、`mobileAccessibility.css`（触控/对比度兜底） | 同上 | 同上 |
| L2 | `pages/*.css`、`components/*.css` | 任何人 | 单页面 |

**L1 是本规范的物理载体。** 所有下文出现的数值，最终都必须在 `mobileTokens.css` 里有一个名字。

### 1.2 作用域约定

L1 token 一律挂在 `:root[data-fc-density="touch"]` 上，**不挂在 `.mobile-app` 上**。原因：`Overlay`、`BottomSheet`、`ActionMenu` 等通过 portal 挂到 `body`，挂在 `.mobile-app` 上会导致浮层继承不到 token，出现页面与浮层两套标尺。桌面端 `comfortable` density 不写该属性，因此完全不受影响。

---

## 2. 间距

### 2.1 基础标尺（L0，不新增）

沿用 `--fc-space-*`，即 **4 / 8 / 12 / 16 / 24 / 32 / 48**。

```
--fc-space-xs   4px      --fc-space-lg   16px     --fc-space-3xl  48px
--fc-space-sm   8px      --fc-space-xl   24px
--fc-space-md   12px     --fc-space-2xl  32px
```

**禁止在此标尺之外出现新的间距值。** 需要 20px 时，判断它更接近 16 还是 24，选一个；不要新增。

### 2.2 语义 token（L1）

| Token | 值 | 用途 |
|---|---|---|
| `--mobile-gap-text` | `--fc-space-xs` (4) | 紧邻文字之间：标题↔副标题、数值↔单位 |
| `--mobile-gap-inline` | `--fc-space-sm` (8) | 行内元素之间：图标↔文字、标签↔标签 |
| `--mobile-gap-item` | `--fc-space-md` (12) | 列表项之间、卡片内部块之间 |
| `--mobile-gap-group` | `--fc-space-lg` (16) | 同类卡片/控件组之间 |
| `--mobile-gap-section` | `--fc-space-xl` (24) | 页面主区块之间 |
| `--mobile-pad-card` | `--fc-space-lg` (16) | 卡片、面板内边距 |
| `--mobile-pad-card-compact` | `--fc-space-md` (12) | 密集列表项内边距 |
| `--mobile-pad-control` | `--fc-space-md` (12) | 控件内边距（横向另见 §6.3） |
| `--mobile-pad-sheet` | `--fc-space-lg` (16) | BottomSheet / 抽屉内边距 |
| `--mobile-page-x` | `max(16px, 安全区)` | 页面左右边距（已存在，见 §7） |
| `--mobile-page-top` | `--fc-space-lg` (16) | 页面内容区顶部留白 |
| `--mobile-page-bottom` | `--fc-space-xl` (24) | 页面内容区底部留白（不含安全区） |

### 2.3 规则

1. **纵向间距只允许出现上表 5 个 `gap` token 之一。** 出现第 6 种间距 = 违规。
2. **禁止负边距。** `margin: -0.1rem` / `margin-top: -0.35rem` 这类写法说明上游行高或 gap 选错了，去修上游。
3. **间距只由父容器的 `gap` 提供，不由子元素的 `margin` 提供。** 优先 `display: flex/grid` + `gap`。
4. 页面左右边距全局唯一，页面自己不得再定义横向 padding。
5. 层级关系必须成立：`gap-text < gap-inline < gap-item < gap-group < gap-section`。任何一处让小层级大于大层级，视为结构错误。

---

## 3. 排版

### 3.1 字号：5 档（L1）

| Token | 值 | 角色 | 典型使用 |
|---|---|---|---|
| `--mobile-text-meta` | 13px | 元信息 | 时间戳、计数、辅助说明、标签 |
| `--mobile-text-body-sm` | 15px | 次要正文 | 列表摘要、卡片描述 |
| `--mobile-text-body` | 17px | 正文 / 控件 | 正文、按钮、**输入框（iOS 防自动缩放下限）** |
| `--mobile-text-title` | 22px | 区块标题 | section 标题、页面次级标题 |
| `--mobile-text-display` | 28px | 页面主标题 | 顶栏大标题 |

**不允许第 6 档。** 需要「比正文大一点」时用 `title`，不要新造 20px。

### 3.2 与 `--fc-font-size-*` 的关系

`flowcloudai-ui` 组件内部消费 `--fc-font-size-*`，因此 touch density 下必须把这些别名重新指向上述 5 档，保证组件与页面同标尺：

| `--fc-font-size-*` | 指向 |
|---|---|
| `2xs` / `xs` / `caption` | `--mobile-text-meta` |
| `sm` | `--mobile-text-body-sm` |
| `control` / `reading` / `md` / `body` | `--mobile-text-body` |
| `lg` / `title-sm` | `--mobile-text-title` |
| `xl` | `--mobile-text-display` |

### 3.3 字重：3 档（L1）

| Token | 值 | 用途 |
|---|---|---|
| `--mobile-weight-normal` | 400 | 正文、描述 |
| `--mobile-weight-medium` | 500 | 元信息强调、Tab 标签、选中态 |
| `--mobile-weight-strong` | 600 | 标题、按钮文字 |

**废止 `--mobile-font-weight-label/strong/heading/display`（650/680/720/760）。** 理由：中文字形不存在这些字重档位，四个 token 在真机上渲染结果相同，属于无效抽象。同时不要使用 `--fc-font-weight-bold`——它的值与 `semibold` 同为 600，是重复定义。

### 3.4 行高：3 档（L1）

| Token | 值 | 用途 |
|---|---|---|
| `--mobile-leading-tight` | 1.25 | 标题、单行文本 |
| `--mobile-leading-snug` | 1.4 | 卡片摘要、元信息、多行截断文本 |
| `--mobile-leading-normal` | 1.6 | 连续阅读正文（词条正文、AI 消息） |

### 3.5 规则

1. **每屏至少跨 3 档字号，且必须存在一个 ≥ `--mobile-text-title`。** 一屏只有 13/15px 视为层级缺失。
2. **层级优先用字号表达，其次字重，最后才是颜色。** 禁止仅靠 `text-secondary` / `text-tertiary` 的灰度差建立层级——移动端强光环境下灰度差不可读。
3. 同一屏内，同一角色的文字必须用同一个 token。卡片标题不能这张 17px 那张 15px。
4. 可编辑控件（`input` / `textarea` / `contenteditable`）字号**不得低于** `--mobile-text-body`（17px）。低于 16px 会触发 iOS 聚焦自动缩放且无法恢复。
5. 单行截断（`text-overflow: ellipsis` / `-webkit-line-clamp`）必须配 `--mobile-leading-snug` 或更紧的行高，否则截断位置会跳。

---

## 4. 颜色与对比度

**本层已达标，规则以「保持」为主。**

1. **业务 CSS 禁止出现任何颜色字面量**（`#hex` / `rgb()` / `hsl()` / 具名色）。当前为 0 处，保持 0。
2. 只使用 `--fc-color-*` 语义色与 `--mobile-surface-*` 面色，不直接使用 `--fc-blue-500` 这类基础色板。
3. **仍需阅读的文字对比度 ≥ 4.5:1**（浅色、深色、玻璃开/关四种组合下均需成立）。占位符、计数、辅助说明属于「仍需阅读」，不得使用 `--fc-color-text-tertiary` 的原始值；移动端已在 `mobileAccessibility.css` 将其抬到 secondary 基线，保持该覆盖。
4. **纯装饰性弱化**（分隔线、禁用态图标）与「仍需阅读的三级文字」必须使用不同 token，不得混用。
5. 状态不得仅用颜色表达（§9.4）。

---

## 5. 形状与层次

### 5.1 圆角（已达标，保持）

沿用 `--mobile-radius-card` / `--mobile-radius-field` / `--mobile-radius-sheet` / `--mobile-radius-floating` / `--fc-radius-full`。禁止新增裸数值圆角。

### 5.2 边框与分隔线：各 1 档（L1）

| Token | 用途 |
|---|---|
| `--mobile-border` | 容器边框（卡片、面板、输入框） |
| `--mobile-divider` | 列表分隔线、区块分隔线 |

**废止 `--mobile-border-soft/medium/strong/emphasis/bold`（58/66/68/70/72/78%）。** 六档透明度相差 2%，不构成可感知的层次，只增加决策成本。玻璃材质边框 `--mobile-glass-border` 保留，因为它服务于不同的合成场景。

### 5.3 阴影：2 档 + 默认无（L1）

| Token | 用途 |
|---|---|
| （不设阴影） | **默认。** 页面内的卡片、列表项、区块一律无阴影，用 `--mobile-border` 或面色区分 |
| `--mobile-elevation-raised` | 需要与页面明确分离的内容卡片 |
| `--mobile-elevation-floating` | 脱离文档流的浮层：抽屉、BottomSheet、锚点菜单、对话框 |

**废止其余 14 个 `--mobile-shadow-*`。** 理由：16 档阴影的实际效果是「所有元素都在浮起」，等价于没有层次。原生平台的层次感主要来自「材质 + 位置」，阴影只区分「贴在页面上」和「浮在页面上方」两种状态。

### 5.4 z-index：语义层（L1）

当前 14 个裸数值（8/9/20/30/60/80/90/100/…）无法推理先后关系。改为固定语义层：

| Token | 值 | 用途 |
|---|---|---|
| `--mobile-z-base` | 0 | 页面内容 |
| `--mobile-z-sticky` | 10 | 页内吸顶栏、吸底工具条 |
| `--mobile-z-nav` | 20 | 底部 Tab 栏 |
| `--mobile-z-drawer` | 30 | 侧抽屉及其遮罩 |
| `--mobile-z-sheet` | 40 | BottomSheet、锚点菜单 |
| `--mobile-z-overlay` | 50 | 模态对话框、图片查看器 |
| `--mobile-z-toast` | 60 | 全局提示、alert |

规则：**业务 CSS 不得书写裸 z-index。** 局部堆叠（同一容器内的图层排序，如封面 `-1` / 内容 `1`）允许使用 `0/1/2`，但必须配 `isolation: isolate` 限定在本容器内。

---

## 6. 触控与控件

### 6.1 触控目标

| Token | 值 | 说明 |
|---|---|---|
| `--mobile-tap-min` | **48px** | 最小命中区（宽和高） |
| `--mobile-tap-expand` | 8px | 图标按钮向外扩展的透明热区 |

**取 48 而非 44。** iOS HIG 要求 44pt，Material 要求 48dp；取大值一次满足两端，避免维护两套。`--fc-control-tap-min` 在 touch density 下应指向 `--mobile-tap-min`。

规则：
1. 所有 `button` / `[role="button"]` / `summary` / 可点击卡片的命中区 ≥ `--mobile-tap-min`。
2. **图标视觉尺寸可以小，命中区不可以。** 用 padding 或伪元素扩展热区，不要放大图标。
3. 例外：`Input` 内部的组合式清除/步进按钮，它们属于父控件的一部分，父控件满足即可。
4. 相邻可点元素之间至少留 `--mobile-gap-inline`（8px），避免误触。

### 6.2 控件高度

沿用 `--fc-control-height-*`（touch density：xs 32 / sm 40 / md 44 / lg 48 / xl 56）。业务 CSS 不得直接写控件高度。

### 6.3 按钮内边距

沿用 `lib_ui` 的 capsule 规范：**横向内边距 ≥ 纵向内边距 × 2**。移动端普通按钮默认 `--fc-radius-full`（已在 `MobileApp.css` 实现，保持）。

---

## 7. 安全区与页面骨架

### 7.1 安全区 token（L1）

| Token | 用途 |
|---|---|
| `--mobile-safe-top` | 状态栏 / 刘海 |
| `--mobile-safe-bottom` | Home Indicator / Android 导航栏 |
| `--mobile-safe-left` / `--mobile-safe-right` | 横屏挖孔、圆角 |

**规则：业务 CSS 一律禁止直接书写 `env(safe-area-inset-*)`。**

理由不是洁癖，是正确性：`env()` 在 iOS WKWebView 反映完整安全区，但在 Android WebView 只反映 display cutout，**不含系统导航栏**。Android 的 `MainActivity` 已调用 `enableEdgeToEdge()`，若页面直接读 `env(safe-area-inset-bottom)`，底部 Tab / BottomSheet / 输入区会压在导航栏下方。因此 Android 侧必须由原生把 `WindowInsets` 桥接进 CSS 变量，两端统一从 `--mobile-safe-*` 消费。

迁移前有 19 个文件、39 处直接使用 `env()`；当前业务移动 CSS 已全部改读 `--mobile-safe-*`，并由静态测试防止回归。

### 7.2 页面骨架

每个移动端页面统一为三段：

```text
┌─ 顶栏  MobilePageTopBar        消费 --mobile-safe-top
├─ 内容  padding: --mobile-page-top --mobile-page-x --mobile-page-bottom
│        区块之间 gap: --mobile-gap-section
└─ 底栏  MobileNav / 输入区      消费 --mobile-safe-bottom
```

规则：
1. 页面不得自定义左右 padding，只能用 `--mobile-page-x`。
2. 滚动容器必须 `overscroll-behavior: contain`。
3. 横向滚动区必须标记 `data-mobile-horizontal-scroll`（侧滑抽屉手势据此豁免）。

---

## 8. 动效

| Token | 值 | 用途 |
|---|---|---|
| `--mobile-duration-fast` | 120ms | 状态反馈：按压、选中、展开小面板 |
| `--mobile-duration-base` | 220ms | 页面转场、抽屉、BottomSheet |
| `--mobile-duration-slow` | 320ms | 大面积材质变化 |
| `--mobile-ease-standard` | `cubic-bezier(0.22, 1, 0.36, 1)` | 进场、位移（默认） |
| `--mobile-ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | 退场 |

规则：
1. 业务 CSS 不得书写裸时长与裸缓动曲线。
2. **所有动效必须提供 `prefers-reduced-motion: reduce` 降级**，降级为无位移的即时切换或纯透明度变化。
3. 手势驱动的动画（边缘返回、抽屉拖拽）必须跟手，不得只在阈值达成后播放固定动画。

---

## 9. 容器与信息结构

这一节是「防止页面变成卡片汤」的结构约束。

1. **一屏最多 2 种容器样式。** 出现第 3 种之前，先确认能否用留白 + 字号分组代替。
2. **不同语义的内容不得使用相同容器样式。** 「空状态」和「操作提示」长得一样，会让用户无法区分「我没有数据」和「这是条说明」。
3. **虚线边框禁止用于常态 UI。** 虚线在 iOS 与 Material 的语义均为「占位 / 拖放目标 / 未完成」，用作输入框或容器会让界面显得未完工。
4. **状态不得仅用颜色表达。** 选中态必须同时具备下列之一：填充图标、字重变化、指示条、形状变化。同时必须提供 `aria-current` / `aria-selected` / `aria-pressed`。
5. **空状态必须包含主操作本身，而不是描述主操作的位置。** 不要写「使用右上角＋新建」，直接给一个「新建」按钮。
6. **分页控件（上一页/下一页）不用于移动端列表**，改用连续滚动或分段加载。
7. **不设常驻的、不可关闭的提示条。** 提示要么随上下文出现，要么可永久关闭。

---

## 10. 文案

1. **副标题只承载标题给不出的信息**（数量、状态、时间、限制条件）。若副标题只是把标题换个说法重述一遍，删掉它。
   - 反例：`标签管理 / 管理词条标签定义`、`词条类型 / 管理自定义词条类型`、`全部词条 / 浏览项目中所有词条`
   - 正例：`自动更新 / 仅在发现新版本时提示`、`备份保留 / 最近 5 组`
2. 未开放功能使用真正的 `disabled` 态，原因常驻可见并写入可访问名称；不得点击后才弹「暂未开放」。
3. 占位符只放示例，不作为唯一标签；所有输入必须有持久标签或稳定的 `aria-label`。
4. 错误文案说明「发生了什么 + 下一步能做什么」，并提供重试入口。

---

## 11. 平台契约（iOS / Android）

两端共用同一套 React/CSS，但以下主题在两端语义不同，**每一行两列都必须有明确结论**，不得只写一端。

| 主题 | iOS | Android | 本项目裁决 |
|---|---|---|---|
| 触控下限 | 44pt | 48dp | **统一 48**（`--mobile-tap-min`） |
| 正文/控件字号 | ≥16px 防自动缩放 | body-large 16sp | **统一 17px**（`--mobile-text-body`），理由是 iOS 下限 |
| 安全区来源 | `env()` 直接可用 | 需 `WindowInsets` → CSS 桥接 | 业务只读 `--mobile-safe-*`（§7.1） |
| 系统返回 | 左边缘跟手返回 | 系统 back + 预测式返回 | Android 交还系统并实现 `handleOnBackProgressed`；自绘边缘手势仅 iOS 启用 |
| 屏幕方向 | iPhone 竖+横 | 大屏强制可旋转（targetSdk 36） | 两端统一支持横屏，取消 Android manifest 的 portrait 锁 |
| 系统栏外观 | `UIStatusBarStyle` | `isAppearanceLightStatusBars` | 两端跟随**应用内主题**，不跟随系统深浅色 |
| 字号缩放 | Dynamic Type | `Configuration.fontScale` | 共用根变量 `--mobile-font-scale`，两端各自原生桥接 |
| 按压反馈 | 变暗 / 轻微缩放 | Material state layer | 统一 `:active` token；Android 额外允许 ripple |
| 触觉反馈 | Haptic Engine | `VibrationEffect` | 统一语义层（成功 / 警告 / 选择），各自映射 |
| 软键盘 | 原生 `UIKeyboard` frame 事件发布实际遮挡量，`keyboardLayoutGuide` 处理零时长事务；目标真机已验收 | 原生 `WindowInsetsCompat.Type.ime()` 发布实际遮挡量，WebView 保持全屏且不再消费 IME；目标真机已验收 | 2026-08-20 被回退的「双端共享一套原生接管」仍属历史方案；现行两端原生来源互斥，只共享 `--fc-kb` 内部布局契约。WebView/应用外壳不改几何，Tab 保持机器底部并被键盘覆盖，AI/灵感各自分配内部空间；详见 `docs/mobile_keyboard_layout.md` |
| 材质降级 | Reduce Transparency | 高对比度设置 | 触发时强制实色高对比 surface |

**规则：新增任何平台相关行为，必须先在本表加一行，两列都填写后再实现。**

---

## 12. 迁移映射表

一次性机械替换，替换后 §0.1 原则即可长期生效。

### 12.1 字重（8 → 3）

| 旧 | 新 |
|---|---|
| `--mobile-font-weight-label` (650) | `--mobile-weight-medium` |
| `--mobile-font-weight-strong` (680) | `--mobile-weight-strong` |
| `--mobile-font-weight-heading` (720) | `--mobile-weight-strong` |
| `--mobile-font-weight-display` (760) | `--mobile-weight-strong` |
| `--fc-font-weight-normal` | `--mobile-weight-normal` |
| `--fc-font-weight-medium` | `--mobile-weight-medium` |
| `--fc-font-weight-semibold` / `--fc-font-weight-bold` | `--mobile-weight-strong` |

### 12.2 阴影（16 → 2）

| 旧 | 新 |
|---|---|
| `subtle` / `control-soft` / `chip` / `primary-soft` | **删除**（改用 `--mobile-border`） |
| `card` / `card-hover` / `cover` / `control` | `--mobile-elevation-raised` |
| `floating` / `floating-soft` / `floating-compact` / `dialog` / `bottom-sheet` / `anchored-menu` / `primary-action` | `--mobile-elevation-floating` |
| `drawer-surface` (none) | 保持无阴影 |

### 12.3 边框（6 → 1）

`--mobile-border-soft` / `-medium` / `-strong` / `-emphasis` / `-bold` → 全部替换为 `--mobile-border`。

### 12.4 安全区（39 处）

`env(safe-area-inset-top)` → `var(--mobile-safe-top)`，其余方向同理。仅 `mobileTokens.css` 内允许出现 `env()`。

### 12.5 间距（120 个裸值）

无法完全机械替换，按就近原则归档到 §2.2 的 5 个 `gap` token 与 4 个 `pad` token。归档时优先保证**层级关系正确**，而不是保证像素不变——本次迁移允许并预期出现视觉变化。

### 12.6 迁移风险

- `--fc-font-size-lg` 由 20px 变为 22px（`--mobile-text-title`），使用处共 7 个，需逐个确认不产生换行或截断。
- 区块间距由 16px 提升到 24px，首屏可见内容会减少，需重新评估各页首屏信息量。
- 阴影大量删除后，浅色主题下卡片与背景的分离度下降，需确认 `--mobile-border` 在浅色主题的可见性。

---

## 13. 检查与验收

### 13.1 可机器检查的红线

以下均可用 `grep` 在 CI / 提交前扫描 `src/app/mobile/**`：

| 红线 | 检查方式 |
|---|---|
| 无颜色字面量 | 匹配 `#[0-9a-fA-F]{3,8}` / `rgba?\(` |
| 无裸 `env(safe-area-inset` | 排除 `mobileTokens.css` |
| 无裸 z-index | 匹配 `z-index:\s*[0-9]{2,}` |
| 无废止 token | 匹配 §12 左列全部名称 |
| 无裸时长 | 匹配 `transition:.*[0-9]+ms` |
| 间距值在标尺内 | 匹配 `(padding|margin|gap)` 中的裸 `px`/小数 `rem`，并禁止业务 CSS 直接消费 `--fc-space-*` |
| 单文件行数 | 页面 `.tsx` ≤ 800 行 |

### 13.2 允许的例外

以下情况允许裸数值，但**必须就近写注释说明原因**：

- `1px` 的边框宽度与分隔线高度。
- 媒体查询断点。
- 与外部约束绑定的尺寸（图标 viewBox、图片固有比例、第三方组件要求的尺寸）。
- 局部堆叠上下文内的 `0/1/2`（需配 `isolation: isolate`）。

### 13.3 每个页面必须检查

1. 浅色 / 深色两种主题。
2. 默认字号 / 系统最大辅助字号。
3. 竖屏 / 横屏。
4. 键盘弹出 / 收起。
5. 空状态 / 加载中 / 错误 / 有数据四种状态。
6. 所有可点元素命中区 ≥ 48。
7. 正文对比度 ≥ 4.5:1。

### 13.4 取证要求

**代码共用 ≠ 两端已验证。** 涉及共享移动壳层的改动，iOS 与 Android 必须各自提供截图证据：

- iOS：模拟器或真机原生启动（非浏览器预览）。
- Android：debug APK + ADB（非浏览器预览、非 Vite 空壳）。
- 缺失一端时，结论必须明确标注为「仅代码分析，未验证」。

命令：`npm run lint && npm run build`，另加两端原生回归。

---

## 14. 维护规则

1. **新增数值前先问：它有名字吗？** 没有就先在 `mobileTokens.css` 加 token，再使用。
2. **新增 token 前先问：现有 token 能不能覆盖？** 能覆盖就不要新增。token 数量增长本身就是规范失效的信号。
3. **删除比新增重要。** 本规范 v1 的主要工作是把 8 个字重删成 3 个、16 个阴影删成 2 个。后续迭代同样应优先考虑删除。
4. 规范与实现冲突时，先改实现；确需改规范的，在本文件记录变更理由与影响面。
5. 平台相关行为一律先更新 §11 的两列表，再写代码。
6. 本规范只管尺度与结构。视觉风格（配色性格、字体选择、封面生成、图标语言）另开文档，且必须建立在本规范之上。

---

## 附录 A：语义 Token 完整定义

本附录是**全文所有数值的唯一定义处**。落地时整体复制到 `app_main/src/app/mobile/mobileTokens.css`，并在 `MobileApp.tsx` 中与 `mobileTypography.css`、`mobileAccessibility.css` 并列引入（`mobileTokens.css` 引入顺序需在两者之前）。

后续迭代只改这里，不改业务 CSS。

```css
/*
 * 移动端语义 token —— iOS 与 Android 共用。
 *
 * 挂在 :root[data-fc-density="touch"] 而不是 .mobile-app：Overlay / BottomSheet /
 * ActionMenu 通过 portal 挂到 body，挂在 .mobile-app 上会让浮层继承不到 token，
 * 出现页面与浮层两套标尺。桌面端 comfortable density 不写该属性，不受影响。
 *
 * 修改规则见 designs/mobile-ui-baseline.md：业务 CSS 只消费本文件的 token，
 * 不得出现裸数值；本文件是全部数值的唯一定义处。
 */
:root[data-fc-density="touch"] {
    /* ========== 间距 ========== */
    /* 层级必须成立：text < inline < item < group < section */
    --mobile-gap-text: var(--fc-space-xs);        /* 4px  紧邻文字：标题↔副标题 */
    --mobile-gap-inline: var(--fc-space-sm);      /* 8px  行内：图标↔文字、标签↔标签 */
    --mobile-gap-item: var(--fc-space-md);        /* 12px 列表项之间、卡片内块之间 */
    --mobile-gap-group: var(--fc-space-lg);       /* 16px 同类卡片/控件组之间 */
    --mobile-gap-section: var(--fc-space-xl);     /* 24px 页面主区块之间 */

    --mobile-pad-card: var(--fc-space-lg);        /* 16px 卡片、面板内边距 */
    --mobile-pad-card-compact: var(--fc-space-md);/* 12px 密集列表项 */
    --mobile-pad-control: var(--fc-space-md);     /* 12px 控件内边距 */
    --mobile-pad-sheet: var(--fc-space-lg);       /* 16px BottomSheet / 抽屉 */

    --mobile-page-top: var(--fc-space-lg);        /* 16px 内容区顶部留白 */
    --mobile-page-bottom: var(--fc-space-xl);     /* 24px 内容区底部留白（不含安全区） */
    /* --mobile-page-x 已在 MobileApp.css 定义，保持不变 */

    /* ========== 字号：5 档，不得新增第 6 档 ========== */
    --mobile-text-meta: 0.8125rem;                /* 13px 时间、计数、辅助说明 */
    --mobile-text-body-sm: 0.9375rem;             /* 15px 列表摘要、卡片描述 */
    --mobile-text-body: 1.0625rem;                /* 17px 正文、控件、输入（iOS 防缩放下限） */
    --mobile-text-title: 1.375rem;                /* 22px 区块标题 */
    --mobile-text-display: 1.75rem;               /* 28px 页面主标题 */

    /* flowcloudai-ui 组件内部消费 --fc-font-size-*，重新指向同一套标尺，
       保证库组件与页面不会出现两种字号系统。 */
    --fc-font-size-2xs: var(--mobile-text-meta);
    --fc-font-size-xs: var(--mobile-text-meta);
    --fc-font-size-caption: var(--mobile-text-meta);
    --fc-font-size-sm: var(--mobile-text-body-sm);
    --fc-font-size-control: var(--mobile-text-body);
    --fc-font-size-reading: var(--mobile-text-body);
    --fc-font-size-md: var(--mobile-text-body);
    --fc-font-size-body: var(--mobile-text-body);
    --fc-font-size-lg: var(--mobile-text-title);
    --fc-font-size-title-sm: var(--mobile-text-title);
    --fc-font-size-xl: var(--mobile-text-display);

    /* ========== 字重：3 档 ==========
       中文字形（PingFang SC 最粗 600、Noto Sans CJK 通常仅 400/500/700）
       不存在 650/680/720/760 档位，多余的 token 在真机上渲染结果相同。 */
    --mobile-weight-normal: 400;
    --mobile-weight-medium: 500;
    --mobile-weight-strong: 600;

    /* ========== 行高 ========== */
    --mobile-leading-tight: 1.25;                 /* 标题、单行 */
    --mobile-leading-snug: 1.4;                   /* 摘要、截断文本 */
    --mobile-leading-normal: 1.6;                 /* 连续阅读正文 */

    /* ========== 边框与分隔线：各 1 档 ========== */
    --mobile-border-color: color-mix(in srgb, var(--fc-color-border) 70%, transparent);
    --mobile-border: 1px solid var(--mobile-border-color);
    --mobile-divider-color: color-mix(in srgb, var(--fc-color-border) 50%, transparent);
    --mobile-divider: 1px solid var(--mobile-divider-color);

    /* ========== 阴影：默认无，只保留 2 档 ==========
       页面内的卡片/列表项一律无阴影，用 border 或面色区分层次。 */
    --mobile-elevation-raised:
        0 1px 2px color-mix(in srgb, var(--fc-color-text) 5%, transparent),
        0 2px 8px color-mix(in srgb, var(--fc-color-text) 6%, transparent);
    --mobile-elevation-floating:
        0 8px 32px color-mix(in srgb, var(--fc-color-text) 18%, transparent);

    /* ========== z-index：语义层，业务不得写裸值 ========== */
    --mobile-z-base: 0;
    --mobile-z-sticky: 10;                        /* 页内吸顶/吸底 */
    --mobile-z-nav: 20;                           /* 底部 Tab */
    --mobile-z-drawer: 30;                        /* 侧抽屉及遮罩 */
    --mobile-z-sheet: 40;                         /* BottomSheet、锚点菜单 */
    --mobile-z-overlay: 50;                       /* 模态对话框、图片查看器 */
    --mobile-z-toast: 60;                         /* 全局提示 */

    /* ========== 触控 ==========
       48 = max(iOS 44pt, Material 48dp)，一次满足两端。 */
    --mobile-tap-min: 3rem;
    --mobile-tap-expand: var(--fc-space-sm);
    --fc-control-tap-min: var(--mobile-tap-min);

    /* ========== 安全区 ==========
       iOS：env() 反映完整安全区，--mobile-native-inset-* 未定义时回退 0。
       Android：enableEdgeToEdge() 下 env() 只反映 display cutout，不含系统导航栏，
                必须由原生把 WindowInsets 写入 --mobile-native-inset-*，由 max() 取到正确值。
       业务 CSS 一律不得直接书写 env(safe-area-inset-*)。 */
    --mobile-safe-top: max(env(safe-area-inset-top, 0px), var(--mobile-native-inset-top, 0px));
    --mobile-safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--mobile-native-inset-bottom, 0px));
    --mobile-safe-left: max(env(safe-area-inset-left, 0px), var(--mobile-native-inset-left, 0px));
    --mobile-safe-right: max(env(safe-area-inset-right, 0px), var(--mobile-native-inset-right, 0px));

    /* ========== 动效 ========== */
    --mobile-duration-fast: 120ms;                /* 按压、选中 */
    --mobile-duration-base: 220ms;                /* 页面转场、抽屉 */
    --mobile-duration-slow: 320ms;                /* 大面积材质变化 */
    --mobile-ease-standard: cubic-bezier(0.22, 1, 0.36, 1);
    --mobile-ease-exit: cubic-bezier(0.4, 0, 1, 1);
}

@media (prefers-reduced-motion: reduce) {
    :root[data-fc-density="touch"] {
        --mobile-duration-fast: 0ms;
        --mobile-duration-base: 0ms;
        --mobile-duration-slow: 0ms;
    }
}
```

### A.1 与现有文件的关系

| 文件 | 处理方式 |
|---|---|
| `mobileTypography.css` | 字号定义并入本附录后删除该文件，或保留文件但只留注释指向 `mobileTokens.css`。两处同时定义 `--fc-font-size-*` 会造成来源不明。 |
| `mobileAccessibility.css` | 保留。其中 `--fc-control-tap-min` 的消费改为指向 `--mobile-tap-min`；对比度覆盖规则不变。 |
| `MobileApp.css` | `--mobile-page-x` / `--mobile-page-x-base` 已与其余 L1 token 一并收口到 `mobileTokens.css`；其中 6 个 border token、16 个 shadow token 按 §12 删除。 |

### A.2 Android 原生桥接（配合 §7.1）

Android 侧已在 `MainActivity` 中读取 `WindowInsets` 并写入上述 `--mobile-native-inset-*`，避免 `--mobile-safe-bottom` 在 edge-to-edge 模式下遗漏系统导航栏。当前主机尚未取得 debug APK + ADB 运行证据，因此 Android 安全区仍按「代码已实现，运行未验证」记录。

---

## 版本记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.1 | 2026-08-18 | 同步落地状态：业务间距、安全区与页面 gutter 已完成语义 token 迁移，并加入静态回归 |
| v1 | 2026-08-18 | 建立基线：三层 token 模型、间距/排版/形状/触控/安全区/动效 token 化、平台契约表、迁移映射表 |
