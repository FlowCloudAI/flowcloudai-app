# FlowCloudAI Apple iOS / iPadOS UI/UX 设计规范

> 文档类型：面向 `app_main` 的项目级设计基线与验收清单
> 官方资料核验日期：2026-08-17
> 当前 Apple 设计资源版本：iOS 27 / iPadOS 27
> FlowCloudAI 最低系统版本：iOS 16.2
> 适用范围：FlowCloudAI 的 iPhone、iPad、Tauri/WKWebView 移动端界面
> 不适用范围：macOS、Android、Windows 的视觉规范，以及 Apple Pay、CarPlay、
> HealthKit、visionOS、watchOS、tvOS、游戏控制等当前产品未使用的专项规范

## 0. 文档结论与使用方式

Apple 当前没有提供一份可下载、覆盖全部章节并持续更新的 Human Interface
Guidelines（HIG）PDF。HIG 是按主题拆分、持续更新的网页文档。Apple 可以下载的主要是：

- iOS / iPadOS UI Kit（Figma、Sketch）；
- App Icon 模板；
- SF Pro 等字体；
- SF Symbols 工具；
- Icon Composer；
- 部分具体技术的设计模板与专项 PDF。

官方入口见 [Apple Design Resources](https://developer.apple.com/design/resources/)。
该页面当前列出的移动端资源是 iOS 27 和 iPadOS 27。

因此，本文件不是 Apple 原文镜像，也不替代 HIG。它是对 Apple 官方资料的原创中文总结，
并把规范转化为 FlowCloudAI 可执行、可审计的项目规则。Apple 更新 HIG 后，应重新核验
相关链接，不能把本文件永久当成不会变化的标准。

### 0.1 规则标签

| 标签 | 含义 |
|---|---|
| **Apple 原则** | 来自 Apple HIG、Apple Developer 文档或 WWDC 官方内容的概括 |
| **项目必须** | FlowCloudAI iOS 端的发布验收硬要求 |
| **项目建议** | 推荐默认采用；有明确产品理由时可以偏离，但要在设计稿中说明 |
| **项目可选** | 只在业务确实需要时采用，不为了“像 iOS”而添加 |

### 0.2 “完整”的边界

本文件完整覆盖当前 FlowCloudAI iOS/iPadOS 产品需要的 UI/UX 主题：布局、导航、
字体、颜色、材质、控件、列表、输入、搜索、浮层、状态、手势、动效、无障碍、文案、
启动、权限、隐私、AI、文件工作流、iPad、自适应和发布验收。

它不逐字复制 Apple 全部平台、全部技术的 HIG，也不记录与当前产品无关的专项规则。
遇到新系统能力或新增产品范围时，先阅读对应 Apple 原始章节，再扩展本文件。

---

## 1. 设计目标与基本原则

Apple 在 2026 年把优秀设计概括为目的、用户主导权、责任、熟悉性、灵活性、简洁、
工艺和愉悦。FlowCloudAI 将其转化为以下规则。

### 1.1 目的

- **项目必须**：每个页面先有一个清楚的主要任务，再决定组件和视觉。
- **项目必须**：新增控件前回答“它帮助用户完成什么”，不能因为页面空或追求科技感而添加。
- **项目建议**：同屏只突出一个主要操作；次要操作进入菜单、行操作或下一层页面。
- **项目建议**：AI、世界观、词条和插件等复杂能力通过渐进披露呈现，避免首次进入就暴露全部参数。

### 1.2 用户主导权

- **项目必须**：用户可以退出、取消、返回，并能理解操作结果。
- **项目必须**：删除、覆盖、批量写入等高风险行为需要确认或可撤销能力。
- **项目必须**：AI 不得在没有清楚授权时静默修改项目数据。
- **项目建议**：尽量保留操作前状态、草稿、历史版本或撤销入口。

### 1.3 责任与信任

- **项目必须**：只在真正需要时请求权限，并在系统弹窗前解释用途。
- **项目必须**：清楚标注 AI 参与生成、转换或判断的内容。
- **项目必须**：错误、限制、数据去向、耗时和费用不能隐藏在模糊文案中。
- **项目必须**：不要以视觉强调诱导用户跳过风险说明或误触高风险操作。

### 1.4 熟悉、灵活、简洁

- **项目必须**：返回、搜索、更多、分享、删除、设置等常见动作遵循 iOS 位置和语义。
- **项目建议**：优先复用系统交互模式，而不是创造需要教学的新手势。
- **项目建议**：布局要适应横竖屏、不同宽度、深浅色、文字放大、键盘、指针和分屏。
- **项目建议**：品牌通过内容、色彩和细节表达，不靠反复展示 Logo 或重度装饰。

官方依据：[Principles of great design](https://developer.apple.com/videos/play/wwdc2026/250/)、
[Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios)。

---

## 2. 系统版本与渐进增强

### 2.1 目标版本

- **项目必须**：设计参考 iOS 27 / iPadOS 27 的当前 HIG 和 UI Kit。
- **项目必须**：功能和基础可用性继续兼容项目配置中的 iOS 16.2。
- **项目必须**：任何 iOS 27 专属材质、动效或原生 API 都必须有旧系统降级路径。
- **项目必须**：不能让 Liquid Glass、某个新 SF Symbol 或新系统控件成为核心任务的唯一入口。

### 2.2 降级原则

| 新系统表现 | iOS 16.2–26 降级 |
|---|---|
| Liquid Glass 导航层 | 稳定的不透明或普通模糊背景，保持相同信息层级 |
| 新 SF Symbol | 使用经过授权的旧版 Symbol 或项目自有图标 |
| 新式搜索入口 | 保留标准内联搜索框或工具栏搜索按钮 |
| 新动效 | 保留直接状态切换，不影响任务完成 |
| 新原生能力 | 隐藏不可用入口或提供等价 Web/Tauri 流程 |

### 2.3 HIG 不是固定像素法典

Apple 的系统组件会随系统版本、设备、辅助功能设置和输入方式变化。设计时应优先采用
语义角色和行为规则，而不是复制一张截图中的固定高度、圆角或模糊数值。

---

## 3. 平台架构与影响边界

FlowCloudAI 的 iOS 与 Android 当前共享 React 移动业务界面；iOS 外层由 Tauri、WKWebView
和 Xcode 工程承载。这决定了适配方式。

### 3.1 共享与专属职责

| 层级 | 应继续共享 | 应按 iOS 隔离 |
|---|---|---|
| 业务 | 项目、词条、分类、标签、关系、AI 会话、插件、设置数据 | 无需复制业务模型 |
| 状态 | Store、页面状态、路由意图、草稿与历史 | 系统生命周期适配 |
| 组件语义 | Button、Input、Select、Overlay、列表、编辑器 | iOS 外观变体和原生能力入口 |
| 系统能力 | Tauri API 的统一业务接口 | 分享、文件选择、触觉、系统菜单、系统材质等原生实现 |
| 视觉 | `--fc-*` 语义 Token | iOS 平台 Token、safe area、平台图标与导航壳层 |

### 3.2 构建与发布影响

- **项目必须**：iOS 专属 CSS 必须由明确的平台标记限定，不能改变 Android 默认表现。
- **项目必须**：Swift/UIKit/原生桥接只进入 Apple 目标条件，不进入 Windows/Android 构建。
- **项目必须**：不创建第二套完整的 iOS React 业务应用。
- **项目必须**：iOS 可以独立构建、签名、TestFlight 和发布，不要求 Android/Windows 同步发版。
- **项目建议**：先做共享语义修复，再做 iOS 壳层增强，减少长期分叉。

### 3.3 WebView 边界

- CSS 模糊可以表达层级，但不等于系统原生 Liquid Glass。
- HTML 自定义按钮可以遵循 HIG 行为，但不会自动获得 UIKit 的 Dynamic Type、触觉、
  VoiceOver 语义和系统状态；这些需要显式实现和真机测试。
- 浏览器预览只能检查静态布局，不能作为 Tauri 数据、系统权限、文件选择、数据库、
  AI 工作流或 iOS 原生交互的最终证据。

---

## 4. 自适应布局与安全区域

### 4.1 基本要求

- **项目必须**：所有页面尊重顶部、底部、左侧和右侧 safe area。
- **项目必须**：内容和控件不能被 Dynamic Island、摄像头区域、圆角、Home Indicator、
  Tab Bar、键盘或系统浮层遮挡。
- **项目必须**：背景可以延伸到屏幕边缘，关键内容和触控区域必须处于安全区域内。
- **项目必须**：使用动态视口高度，不能只依赖容易受地址栏或键盘影响的固定 `100vh`。
- **项目必须**：键盘出现后，正在编辑的字段、提交按钮和错误提示仍可见或可滚动到。
- **项目建议**：支持横竖屏；若某个创作视图只支持一种方向，必须有明确业务原因。

### 4.2 WebView 项目落地

- 保持正确的 viewport 配置并允许 `viewport-fit=cover`。
- 使用 `env(safe-area-inset-top/right/bottom/left)` 参与布局。
- 页面高度优先使用动态视口单位，并保留旧系统回退。
- 底部输入区、Tab Bar、Sheet 操作区要叠加底部 safe area，而不是覆盖它。
- 全屏关系图、时间线和编辑器要单独验证旋转、键盘和横向滚动。

### 4.3 项目宽度档位

以下是 FlowCloudAI 的测试档位，不是 Apple 官方断点：

| 档位 | 典型宽度 | 设计策略 |
|---|---:|---|
| 小型紧凑 | 320–374 pt | 单列；减少并排按钮；标题允许换行 |
| 标准 iPhone | 375–430 pt | 单列为主；底部导航；局部横向滚动 |
| 宽屏紧凑 | 431–767 pt | 增加内容宽度但避免无上限拉伸 |
| iPad / Regular | ≥768 pt | Sidebar、Split View、双栏或三栏；支持键盘和指针 |

### 4.4 页面边距

- **项目必须**：继续使用现有 `--mobile-page-x` / `--fc-space-*` 语义 Token。
- **项目建议**：iPhone 普通页面的水平内容边距不小于约 16 pt。
- **项目建议**：正文阅读区设置合理最大宽度；iPad 上不能让长文本横跨整个屏幕。
- **项目必须**：不得把某台 iPhone 的状态栏或 Home Indicator 高度硬编码为全设备常量。

官方依据：[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)。

---

## 5. 触控尺寸、密度与间距

### 5.1 触控目标

- **项目必须**：常规按钮、图标按钮、列表行操作和 Tab 项目的有效点击区域至少
  **44 × 44 pt**。
- Apple 的无障碍规格表把 44 × 44 pt 列为 iOS 默认控件尺寸，并列出 28 × 28 pt
  的最低控件尺寸；FlowCloudAI 为避免误触，仍把 44 × 44 pt 作为常规发布基线。
- 小图标可以只有 17–24 pt 的可见尺寸，但外层命中区域仍需达到 44 × 44 pt。
- **项目必须**：危险操作和相邻高频操作之间要有清楚间距，不能共享难以判断的点击边界。
- **项目必须**：自定义按钮具有按下、聚焦、禁用、加载和选中状态。

### 5.2 间距

Apple 没有要求所有应用采用一个固定的 8 pt 网格。FlowCloudAI 的规则是：

- 使用现有 `--fc-space-*` Token，禁止在业务页面散落无语义的魔法数字。
- 组件内部使用紧凑间距，组件组之间使用更大的分隔，形成可感知层级。
- 有边框/底色的控件周围通常需要约 12 pt 的可用空间；裸图标周围要提供更充足的
  命中空间。最终以 44 pt 命中区域和误触测试为准。
- 不因追求“信息密度”把次要说明压到不可读，或把行高压到手指难以选择。

官方依据：[Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)、
[Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)。

---

## 6. 字体、字号与文本布局

### 6.1 字体选择

- **项目必须**：系统界面优先使用 iOS 系统字体栈；中文由系统选择匹配字体。
- **项目建议**：创作正文可以提供用户可选字体，但导航、按钮、设置、警告和表单保持系统感。
- **项目必须**：避免 Ultralight、Thin、Light 等细字重承担小字号关键信息。
- **项目必须**：不要同时使用过多字体；层级优先通过字号、字重和语义色建立。

### 6.2 iOS 默认 Dynamic Type 起点

以下是 Apple 当前 iOS/iPadOS Large 默认档位，可用于设计稿起点；实现必须按文本角色缩放，
不能把它们当作永远固定的 CSS 像素：

| 文本角色 | 默认字重 | 字号 | 行高 | FlowCloudAI 用途 |
|---|---|---:|---:|---|
| Large Title | Regular | 34 pt | 41 pt | Tab 根页面大标题 |
| Title 1 | Regular | 28 pt | 34 pt | 重要页面标题 |
| Title 2 | Regular | 22 pt | 28 pt | 主分区标题 |
| Title 3 | Regular | 20 pt | 25 pt | 卡片或内容段标题 |
| Headline | Semibold | 17 pt | 22 pt | 重要行标题、强调文字 |
| Body | Regular | 17 pt | 22 pt | 正文、主要说明、输入内容 |
| Callout | Regular | 16 pt | 21 pt | 辅助操作、紧凑提示 |
| Subheadline | Regular | 15 pt | 20 pt | 次级说明、列表摘要 |
| Footnote | Regular | 13 pt | 18 pt | 元信息、非关键帮助 |
| Caption 1 | Regular | 12 pt | 16 pt | 次要标签 |
| Caption 2 | Regular | 11 pt | 13 pt | 最低级短标签，不承载长正文 |

### 6.3 Dynamic Type

- **项目必须**：关键文本支持至少 200% 放大并保持任务可完成。
- **项目必须**：文字放大后允许换行、增加行高、改为纵向排列和扩大容器。
- **项目必须**：不要通过隐藏关键文字、固定高度裁切或强制省略号来“维持布局”。
- **项目必须**：有语义的图标随文字层级适当放大。
- **项目必须**：按钮在大字模式下允许增高；不能固定为只容纳单行小字。
- **项目建议**：在最大无障碍字号下，把并排按钮改成纵向列表。

### 6.4 截断与长文本

- 标题优先保留开头；文件名或标识符可考虑保留头尾的中间截断。
- 项目名、词条名和模型名应允许合理换行或提供完整内容入口。
- 不把 placeholder 当作唯一字段标签，因为输入后它会消失。
- 用户创作内容不能因为 UI 视觉整齐而被不可逆截断。

官方依据：[Typography](https://developer.apple.com/design/human-interface-guidelines/typography)。

---

## 7. 色彩、深色模式与对比度

### 7.1 语义色

- **项目必须**：继续通过 `--fc-*` 语义 Token 表达背景、正文、次级文字、边框、强调、
  成功、警告和危险状态。
- **项目必须**：禁止按某一主题的外观硬编码颜色后复用到另一主题。
- **项目必须**：相同颜色在全应用保持相同语义；交互强调色不能同时大量用于普通装饰文字。
- **项目必须**：每个自定义颜色提供浅色、深色和更高对比度方案。

### 7.2 对比度

- **项目必须**：普通文本和背景至少达到 4.5:1。
- **项目必须**：大号或粗体文本至少达到 3:1。
- **项目建议**：小字号自定义前景/背景尽量达到 7:1。
- **项目必须**：边框不是信息的唯一载体；低对比边框消失后，组件仍能被理解。
- **项目必须**：选中、错误、成功、警告不能只用颜色区分，要同时使用文字、形状或图标。

### 7.3 深色模式

- 深色模式不是浅色模式的机械反色。
- 基础背景与浮层背景要有层级差；前景浮层通常比深色基础背景稍亮。
- 图片中的纯白底在深色界面里可能刺眼，应提供合适版本或边界处理。
- 图标和插图需要在浅色、深色和高对比设置下分别检查。
- 真机在室外亮光、室内暗光和 True Tone 条件下检查品牌色与灰阶。

官方依据：[Color](https://developer.apple.com/design/human-interface-guidelines/color)、
[Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)。

---

## 8. 材质、层级与 Liquid Glass

### 8.1 使用位置

- **项目建议**：Liquid Glass 或其 WebView 近似效果只用于导航与控制层，例如 Tab Bar、
  Toolbar、浮动操作、Sidebar、悬浮菜单。
- **项目必须**：词条正文、表单、项目卡片、长列表和主要阅读内容保持稳定内容背景。
- **项目必须**：不能把每张卡片、每个输入框和每个列表行都玻璃化。
- **项目建议**：材质表达层级和上下文连续性，不用于制造随机颜色。

### 8.2 可读性与降级

- 背景越复杂，材质越需要足够不透明度以维持文字对比。
- 开启 Reduce Transparency 或 Increase Contrast 时，应切换到更实、更清楚的表面。
- 模糊不可用、性能不足或旧系统上，界面仍须通过不透明表面正确表达层级。
- 动态背景上的透明控件要在最亮、最暗、最高细节区域分别验证。

### 8.3 FlowCloudAI 约束

- 统一从现有 `glassEffect.css` 和移动端材质 Token 管理模糊与透明度。
- 业务组件不得各自添加不同的 `backdrop-filter`。
- iOS 专属增强必须与 Android 当前性能策略隔离。
- CSS 近似效果不得对外宣称为系统原生 Liquid Glass。

官方依据：[Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、
[Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)。

---

## 9. 图标、SF Symbols、插图与 App Icon

### 9.1 界面图标

- **项目建议**：iOS 常见系统动作优先映射到 SF Symbols 的语义。
- **项目必须**：Android 和其他平台不得直接复用只适用于 Apple 平台的 SF Symbols 资产。
- **项目必须**：SF Symbols 不得作为 FlowCloudAI Logo、商标或 App Icon。
- **项目必须**：新 Symbol 在旧系统不可用时提供回退。
- **项目必须**：图标保持统一线宽、视觉重量、透视和尺寸体系。
- **项目必须**：每个纯图标按钮都有可访问名称；不能让 VoiceOver 只读出“按钮”。
- **项目建议**：常见动作使用熟悉图形，不为“独特”而重新发明返回、分享、删除和更多图标。

当前 `MobileNav.tsx` 使用项目内 SVG。若切换 SF Symbols，应做 iOS 专属资产或原生桥接，
保留 Android/旧系统图标路径，不能直接把 Apple 资产变成共享跨平台资源。

### 9.2 App Icon

- 图标表达单一、清楚、可辨识的产品身份，避免小字和复杂细节。
- 使用 Apple 当前 App Icon 模板和 Icon Composer 检查不同外观模式。
- 不手工预先裁成系统圆角；按模板和 Xcode Asset Catalog 提供资源。
- iOS 图标唯一持久来源继续是 `src-tauri/icons/ios/`。
- 发布前必须经过资源同步、Asset Catalog 编译和真机主屏幕检查。

### 9.3 官方资产许可

Apple Design Resources 和 SF Symbols 有使用限制。下载的 UI Kit、Symbol 或模板不应作为
通用设计资产随意再分发，也不能拿去制作非 Apple 平台的界面品牌。使用前核对
[Apple Design Resources License](https://developer.apple.com/support/downloads/terms/apple-design-resources/Apple-Design-Resources-License-20230621-English.pdf)。

官方依据：[SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols)、
[Icons](https://developer.apple.com/design/human-interface-guidelines/icons)、
[App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)。

---

## 10. 信息架构与导航

### 10.1 顶层结构

FlowCloudAI 当前四个主 Tab：

1. 首页；
2. AI；
3. 灵感；
4. 设置。

这四项语义清楚且数量适中，继续作为稳定顶层导航。

### 10.2 Tab Bar

- **项目必须**：Tab Bar 只切换顶层区域，不执行新建、发送、刷新或导入动作。
- **项目必须**：Tab 始终可访问，不能因为某个页面状态而随意隐藏或禁用。
- **项目必须**：切换 Tab 后保留各自的导航和滚动状态。
- **项目必须**：每项提供图标与短标签；标签避免在正常字号下截断。
- **项目必须**：选中状态不能只依赖颜色。
- **项目建议**：iPhone 保持四项，不引入 More 溢出 Tab。
- **项目建议**：若未来搜索成为跨项目、跨词条、跨会话的核心任务，再评估独立搜索 Tab。

### 10.3 层级导航

- 行尾 chevron 表示进入下一层；信息按钮只表示查看额外信息，不能混用。
- 顶部返回显示清楚的返回意图；保留系统左缘返回手势。
- Push 进入详情、Pop 返回上层；不把页面层级伪装成多个叠加 Modal。
- 从首页进入项目、分类、词条的路径应可预测，并在返回后恢复位置。
- 深链接或通知打开具体内容时，要让用户知道自己位于哪个项目和词条上下文。

### 10.4 Sidebar 与 Split View

- iPhone 紧凑宽度优先 Tab Bar 和 push 导航，不常驻 Sidebar。
- iPad 将项目/分类作为 Sidebar、词条作为内容列表、详情/编辑器作为主区。
- Sidebar 一般不超过两层；更深层级使用中间列表或详情区。
- 窗口缩窄时平滑退化为 Tab Bar 或单列，不丢失当前选择和草稿。

官方依据：[Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)、
[Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)、
[Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)。

---

## 11. 导航栏、标题与工具栏

### 11.1 标题

- Tab 根页面建议使用大标题，滚动后收缩为标准标题。
- 次级页面使用清楚的页面标题，不重复显示整个层级路径。
- 标题代表当前位置，不用“欢迎回来”等营销语取代页面名称。
- 长项目名或词条名允许合理换行或截断，并提供完整内容入口。

### 11.2 工具栏布局

- leading：返回、Sidebar 切换等导航动作；
- 中部：标题或必要的上下文；
- trailing：当前页面最重要的操作和 More；
- iPhone 空间有限，主工具栏只保留必要项，其他动作放入 More 菜单；
- 一个页面最多只设置一个视觉突出的主要操作；
- 工具栏与 Tab Bar 职责不能互换。

### 11.3 FlowCloudAI 示例

| 页面 | 主要操作 | 次要操作 |
|---|---|---|
| 项目列表 | 新建项目 | 导入、排序、帮助 |
| 词条列表 | 新建词条 | 筛选、排序、类型管理 |
| 词条详情 | 编辑 | AI 讨论、分享、移动、删除 |
| AI 会话 | 发送 | 模型、上下文、导出、归档 |
| 灵感 | 新建灵感或保存当前编辑 | 置顶、归档、删除 |
| 设置 | 通常无全局主操作 | 分区内即时保存或明确保存 |

官方依据：[Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)。

---

## 12. 搜索、筛选与排序

### 12.1 搜索入口

Apple 当前在 iOS 提供三类常见位置：Tab Bar、Toolbar、内容内联。

- 项目、词条、灵感、AI 会话的局部搜索优先放在对应列表内或工具栏。
- 搜索是页面高频任务且底部有空间时，可以放在底部工具栏以增强可达性。
- 只有真正跨多个顶层区域的全局搜索才使用独立搜索 Tab。
- 进入搜索后提供清除和取消；退出后恢复原列表位置和筛选上下文。

### 12.2 搜索行为

- placeholder 说明搜索范围，如“搜索当前项目的词条”。
- 输入后尽快反馈，但避免每个字符都触发昂贵后端任务。
- 无结果要显示搜索词、当前筛选和清除筛选入口。
- 搜索结果高亮不能只靠颜色；VoiceOver 要能读出结果数量和状态。
- 中英文、大小写、全半角、标点和拼音/别名匹配策略保持一致并可解释。

### 12.3 筛选与排序

- 少量互斥、密切相关的视图切换可使用 Segmented Control。
- iPhone Segmented Control 建议不超过约 5 项；更多条件进入 Sheet 或菜单。
- 筛选生效后显示可发现的状态和清除入口。
- 排序文案说明结果，例如“最近编辑”“名称 A–Z”，避免只写模糊的“默认”。

官方依据：[Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields)、
[Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls)。

---

## 13. 列表、集合、卡片与内容层级

### 13.1 列表

- 文字型项目、词条、设置和会话优先使用列表，而不是过度卡片化。
- 列表行标题简短，摘要不承担完整正文。
- 选择、进入详情、切换状态和展开信息要有不同反馈。
- 支持编辑时明确进入选择/编辑模式，避免普通点击与批量选择冲突。
- Swipe 操作不能是唯一入口；菜单或详情页要提供等价动作。
- 删除等危险 Swipe 动作使用危险色和清楚标签。

### 13.2 集合与网格

- 封面、图片和可视化内容适合 Collection/Grid。
- 纯文字内容优先 List。
- 网格在 iPad 上增加列数，在 iPhone 上不能因列数过多导致文字和命中区过小。
- 封面比例、裁切焦点和占位状态要一致。

### 13.3 卡片

- 卡片表示一组确实相关、可独立理解的内容，不是所有区块的默认容器。
- 整卡可点击时，内部不能再放含糊的重叠点击区域。
- 卡片阴影和边框只用于表达层级，不能在长列表里造成视觉噪声。
- Liquid Glass 不作为内容卡片默认背景。

### 13.4 空状态

- 说明当前为何为空；
- 提供一个与当前状态直接相关的下一步；
- 有筛选时优先建议清除筛选；
- 首次使用时可以简短教学，但不要放只会出现一次的重要信息。

官方依据：[Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)、
[Collections](https://developer.apple.com/design/human-interface-guidelines/collections)、
[Writing](https://developer.apple.com/design/human-interface-guidelines/writing)。

---

## 14. 按钮与选择控件

### 14.1 按钮层级

- Primary：页面最可能的主要动作；每个视图通常一个。
- Secondary：重要但非主要动作。
- Tertiary / Plain：低强调辅助动作。
- Destructive：删除、清空、覆盖等危险动作；不能用普通主色伪装。

按钮标签优先使用明确动词，如“创建项目”“保存更改”“发送”“删除词条”。
“确定”只在上下文已经完全明确时使用。

### 14.2 图标按钮

- 只在图标含义高度熟悉时省略可见文字。
- 仍需 `aria-label` / 可访问名称。
- 相邻图标的视觉重量、命中区和间距一致。
- More 只放次要命令，不能把当前页面唯一主操作藏进去。

### 14.3 Toggle / Switch

- Switch 只用于立即切换一个清楚的开/关状态。
- iOS Switch 优先位于列表行。
- 标签描述所控制的设置，不在标签里同时写“开启/关闭”。
- 状态差异不能只靠颜色。
- 需要保存按钮或会触发复杂任务的选择，不应伪装成立即生效的 Switch。

### 14.4 Segmented Control

- 用于一组密切相关的互斥状态或子视图。
- 同一组只使用文字或只使用图标，不混搭。
- 不把执行动作和选择状态混在同一组。
- iPhone 上建议不超过约 5 项。

### 14.5 Slider / Picker

- Slider 用于连续范围，并清楚表达最小值、最大值和当前值。
- 精确数值重要时，同时显示数值或提供文本输入。
- Picker 适合中长列表；短列表优先菜单或内联选择。
- 日期、时间使用符合地区设置的系统语义和格式。

官方依据：[Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)、
[Toggles](https://developer.apple.com/design/human-interface-guidelines/toggles)、
[Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls)、
[Sliders](https://developer.apple.com/design/human-interface-guidelines/sliders)、
[Pickers](https://developer.apple.com/design/human-interface-guidelines/pickers)。

---

## 15. 表单、输入与编辑

### 15.1 字段结构

- 字段有持久可见的标签；placeholder 只补充示例或格式。
- 短文本用 Text Field，长正文用 Text View/编辑器。
- 字段宽度与预期内容量相符，多个字段优先纵向排列。
- 使用正确的键盘类型、自动填充和输入语义。
- 密码和密钥使用安全输入，不把内容写入普通日志或帮助文案。

### 15.2 验证与错误

- 能提前防止的错误不要等提交后才显示。
- 在合适时机验证：格式类可在离开字段时检查，唯一性等可在提交前明确检查。
- 错误显示在问题附近，并说明如何修复；不用“无效输入”这种无帮助文案。
- 错误出现后保持用户已输入内容。
- 首个错误可获得焦点，但不能导致页面突然跳动或丢失上下文。

### 15.3 键盘

- Return 键标签匹配任务，如“下一项”“搜索”“发送”“完成”。
- 多字段表单支持合理的 Next/Previous 顺序。
- 输入区随键盘上移，并考虑候选栏、第三方键盘和横屏。
- 点击背景是否收起键盘要符合任务；不要让用户误触后丢失未保存输入。

### 15.4 Markdown 与词条编辑

- 编辑器默认把正文作为主内容，格式工具保持次要。
- 选择文本、复制、粘贴、撤销、重做遵循系统习惯。
- 自动保存要有可信状态，失败时明确说明并保留本地草稿。
- 离开存在未保存内容的编辑器时，要保存、确认或阻止数据丢失。
- 沉浸编辑器的横向工具区必须保留等价可访问入口。

官方依据：[Text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields)、
[Entering data](https://developer.apple.com/design/human-interface-guidelines/entering-data)、
[Undo and redo](https://developer.apple.com/design/human-interface-guidelines/undo-and-redo)。

---

## 16. 菜单、Action Sheet、Alert、Sheet 与 Popover

### 16.1 选择规则

| 组件 | 用途 | 不应承担 |
|---|---|---|
| Menu | 轻量、可重复的次要命令 | 需要详细解释的危险决策 |
| Action Sheet | 用户主动触发后的相关选项 | 普通信息通知 |
| Alert | 关键、需要立即处理或确认的情况 | 启动广告、普通成功提示、长表单 |
| Sheet | 与当前上下文相关的短任务 | 主导航和无限层级页面 |
| Popover | 宽屏中的少量临时内容 | iPhone 紧凑宽度的大型任务 |
| Full-screen modal | 沉浸或复杂的独立任务 | 每个普通详情页 |

### 16.2 Modal 通用要求

- 一个时间只显示一个主要 Modal；Alert 可以覆盖，但也不能连续堆叠多个。
- 有清楚的标题、任务边界和关闭方式。
- iOS 常见 Sheet 左侧为取消/关闭，右侧为完成；具体位置保持全应用一致。
- 用户生成内容可能丢失时，手势下拉关闭和关闭按钮都要走同一保护逻辑。
- 先关闭当前 Sheet，再打开下一层；避免 Sheet 上叠 Sheet。

### 16.3 Alert

- 只用于关键且可行动的信息。
- 不在应用启动时连续弹 Alert。
- 普通保存成功使用就地状态或非侵入反馈。
- 不可撤销删除要写清对象和后果；取消操作保持安全默认。
- 文案短，避免 Alert 内滚动。

### 16.4 Menu

- 高频、重要动作在前；危险动作独立分组并放后。
- 标签随状态变化，如“显示关系”/“隐藏关系”，不同时列出互斥命令。
- 避免过长和多层子菜单；复杂选择转为 Sheet 或页面。

官方依据：[Modality](https://developer.apple.com/design/human-interface-guidelines/modality)、
[Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)、
[Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)、
[Action sheets](https://developer.apple.com/design/human-interface-guidelines/action-sheets)、
[Menus](https://developer.apple.com/design/human-interface-guidelines/menus)、
[Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers)。

---

## 17. 加载、进度、成功、失败与离线状态

### 17.1 加载

- 页面骨架适合结构已知的内容；Spinner 适合短、未知进度任务。
- 不用无限 Spinner 掩盖错误或等待用户输入。
- 超过短暂等待后说明正在做什么；长任务提供后台继续或取消方案。
- 重新进入页面时避免重复清空已有内容再闪烁加载。

### 17.2 进度

- 能计算进度时使用确定进度条。
- 进度必须真实，避免快速到 90% 后长时间停住。
- 可以从不确定进度切到确定进度，但不要无故在 Spinner 和进度条之间跳变。
- 可以安全停止的导入、导出、备份、AI 生成提供取消。
- 停滞或失败时解释原因和恢复方式。

### 17.3 成功与失败

- 成功反馈尽量靠界面状态变化体现，如新词条出现、保存状态变为已保存。
- Toast/非侵入提示不能承载必须阅读的重要结果。
- 错误靠近问题，保留用户输入，并提供重试、修复或查看详情入口。
- 网络错误、本地数据库错误、插件缺失、模型不可用要区分，不能统一写“操作失败”。

### 17.4 离线与同步

- 清楚区分本地已保存、等待同步、同步中、同步失败。
- 离线时允许继续进行可安全本地完成的任务。
- 重试不能产生重复项目、重复消息或重复写入。

官方依据：[Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)、
[Writing](https://developer.apple.com/design/human-interface-guidelines/writing)。

---

## 18. 手势、返回、拖放、动效与触觉

### 18.1 手势

- 支持 Tap、Swipe、Drag、Pinch 等用户已经熟悉的标准语义。
- 自定义手势只用于高频、专门且标准手势无法覆盖的任务。
- 任何手势都提供按钮、菜单、键盘或其他等价入口。
- 系统返回优先级高于自定义左缘抽屉手势。
- 新增横向滚动区域继续标记 `data-mobile-horizontal-scroll`，避免与抽屉手势冲突。
- Pinch 只作用于明确允许缩放的内容，不缩放整个应用壳层。

### 18.2 拖放

- iPad 上支持项目内拖放时，明确是移动还是复制。
- 跨容器和跨应用默认更接近复制，避免意外数据丢失。
- 拖放有可见预览、合法目标反馈和失败回弹。
- 提供移动、复制、导入等非拖放替代路径。

### 18.3 动效

- 动效用于说明空间关系、状态变化和操作反馈，不作为装饰负担。
- 进入和退出方向保持一致；从下方出现的 Sheet 不应横向消失。
- 用户操作可以打断或继续，不能强迫等待非必要动画播放完。
- 重要信息不能只通过动画表达。
- 支持 Reduce Motion；减少大面积位移、视差、连续缩放和自动播放。

### 18.4 触觉

- 触觉用于关键确认、吸附、边界、成功/警告等有意义节点。
- 不为每次普通点击都振动。
- 触觉不是唯一反馈；始终配合视觉或必要的声音。
- WebView 中若需要稳定触觉，应收口为 iOS 专属原生桥接。

官方依据：[Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures)、
[Drag and drop](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop)、
[Motion](https://developer.apple.com/design/human-interface-guidelines/motion)、
[Playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics)。

---

## 19. 无障碍完整要求

无障碍不是发布前补丁，而是组件定义的一部分。

### 19.1 VoiceOver

- 每个交互元素有准确的名称、角色、状态和值。
- 阅读顺序与视觉和任务顺序一致。
- 图标按钮读出动作，不读出文件名或 SVG 路径。
- 装饰图片不进入无障碍树；内容图片提供有意义替代文本。
- 动态状态、错误、生成完成等必要变化通过合适的 live region 或原生公告告知。
- 自定义菜单、Sheet、Tabs、Segmented Control 使用正确语义，不只靠 `div` 和点击事件。

### 19.2 视觉

- 正文默认约 17 pt，最低文字不小于 11 pt。
- 支持至少 200% 放大。
- 普通文本对比度至少 4.5:1，大号/粗体至少 3:1。
- 颜色不是唯一信息通道。
- 深色、高对比、Reduce Transparency 下保持清楚层级。

### 19.3 运动与操作

- 触控目标 44 × 44 pt。
- 支持 Reduce Motion。
- 不要求精确、快速、多指或长时间按住才能完成核心任务。
- 拖放、Swipe、长按有替代入口。
- 倒计时任务允许延长、暂停或不依赖短时间窗口。

### 19.4 听觉与语言

- 声音提示同时有视觉提示。
- 语音或音频内容在需要时提供文字或字幕。
- 不自动播放突兀声音；音量和播放由用户控制。

### 19.5 iPad 输入

- 支持键盘 Tab/Shift+Tab 的合理顺序。
- 清楚显示键盘焦点。
- 支持指针 hover/聚焦，但不能把 hover 作为唯一信息入口。
- 常见命令可考虑标准键盘快捷键，并在菜单或帮助中可发现。

### 19.6 验收工具

- 真机 VoiceOver；
- Xcode Accessibility Inspector；
- 最大 Dynamic Type；
- Bold Text；
- Increase Contrast；
- Reduce Transparency；
- Reduce Motion；
- 深色模式；
- Switch Control 或 Full Keyboard Access 的关键路径抽查。

官方依据：[Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)、
[Focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection)、
[Pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices)。

---

## 20. 文案、命名、国际化与本地化

### 20.1 文案

- 先写用户目标，再写系统实现。
- 按钮使用明确动词：“导入项目”优于“继续”，“删除词条”优于“确定”。
- 标签用一致名词：“词条”“项目”“灵感”“会话”不能在相同概念上来回换名。
- 避免过度拟人、模糊承诺和技术黑话。
- 错误不责怪用户，说明发生了什么、数据是否安全、下一步怎么做。

### 20.2 AI 文案

- 明确“AI 生成”“AI 建议”“AI 将修改”等行为性质。
- 不把概率结果写成确定事实。
- 对可能的错误、幻觉、过时信息和外部模型限制给出适当提示。
- “读者模式 / 助手模式 / 作家模式”必须在首次使用和切换时说明数据权限差异。

### 20.3 本地化

- 不把文本拼成只适合中文语序的碎片。
- 预留比中文更长的拉丁语言文案空间。
- 支持从右到左布局时，leading/trailing 跟随阅读方向，不能硬编码 left/right 语义。
- 日期、时间、数字、货币、复数和排序遵循 Locale。
- SF Symbols 和自定义方向性图标要检查是否需要自动镜像。

官方依据：[Writing](https://developer.apple.com/design/human-interface-guidelines/writing)、
[Craft clear names for features and labels](https://developer.apple.com/videos/play/wwdc2026/290/)。

---

## 21. 启动、首屏、引导与状态恢复

### 21.1 Launch Screen

- Launch Screen 只用于让启动显得连续、快速，不是广告或品牌展示页。
- 外观尽量接近应用第一屏或使用相同基础背景，避免启动后闪烁。
- 不放会过时、无法本地化的静态文本。
- 不把 Logo 动画强制插在用户与内容之间。

### 21.2 首屏

- 尽快显示可理解的壳层和真实状态。
- 后端初始化较慢时，说明当前阶段；失败时提供恢复或诊断入口。
- 不用多个启动 Alert 依次询问权限、评分、通知和账户。

### 21.3 Onboarding

- 引导短、可跳过、可在设置或帮助中重播。
- 优先在真实任务中教学，而不是要求用户记住多页说明。
- 上下文提示靠近相关控件，并在完成后消失。
- 权限、评分和购买请求放到用户已经理解价值之后。

### 21.4 恢复

- 重新启动后尽量恢复之前的项目、Tab、页面、滚动位置和未完成草稿。
- 恢复失败时优先保护数据并解释，而不是静默重置到空首页。
- iOS 沙箱路径变化不能让 UI 错误显示为空数据或诱导用户重建项目。

官方依据：[Launching](https://developer.apple.com/design/human-interface-guidelines/launching)、
[Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding)。

---

## 22. 设置、权限、隐私、账户与通知

### 22.1 设置

- 应用应尽量合理默认工作，避免把产品设计问题推给大量设置项。
- 应用内设置只保留影响 FlowCloudAI 整体体验、AI、插件、数据或账户的选项。
- 系统权限跳转提供直接按钮，不用长文字描述用户去哪里点击。
- 即时生效和需要“保存”的设置必须清楚区分。
- 移动端不显示桌面自定义数据目录选择。

### 22.2 权限

- 在用户触发相关功能时请求，不在启动时集中索要。
- 系统弹窗前用短说明解释用途和用户收益。
- 只请求完成任务所需的最小范围。
- 拒绝后不死循环弹窗；提供受限体验和前往系统设置的方法。
- 权限文案必须具体，如“选择图片作为词条封面”，不能只写“需要访问照片”。

### 22.3 隐私和数据

- 清楚说明本地数据、云端数据、插件数据和 AI 服务数据的边界。
- API Key 继续存入系统安全存储，不在普通设置或日志中显示明文。
- 导出、分享或把内容发送给外部 AI 前，必要时说明范围和目的地。
- 默认最小化收集；没有功能目的的数据不请求。

### 22.4 账户

- 核心功能不需要账户时，不应强制先注册。
- 如果应用允许创建账户，必须提供可发现的账户删除流程或直接网页入口。
- 删除账户与删除本地项目、取消订阅是不同操作，必须分别说明。
- 生物认证按钮显示当前设备实际能力，如 Face ID 或 Touch ID。

### 22.5 通知

- 请求通知前先说明会发送什么。
- 只发送及时、相关、有用户价值的内容。
- 营销通知需要明确同意，不能使用 Time Sensitive 绕过 Focus。
- 应用内提供通知偏好管理，并尊重系统设置。
- AI 任务完成只有在任务确实在后台持续且用户需要时才考虑通知。

官方依据：[Settings](https://developer.apple.com/design/human-interface-guidelines/settings)、
[Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy)、
[Managing accounts](https://developer.apple.com/design/human-interface-guidelines/managing-accounts)、
[Managing notifications](https://developer.apple.com/design/human-interface-guidelines/managing-notifications)、
[Requesting access to protected resources](https://developer.apple.com/documentation/uikit/requesting-access-to-protected-resources)。

---

## 23. 生成式 AI 专项规范

FlowCloudAI 的 AI 是核心能力，本章属于发布硬要求。

### 23.1 透明

- **项目必须**：清楚标注何处使用 AI，不能让用户误以为内容由人类或确定性系统生成。
- **项目必须**：说明功能范围、已知限制、依赖的插件/模型和可能不可用的情况。
- **项目必须**：开放输入提供示例建议，帮助用户建立正确预期。
- **项目必须**：事实性内容可能出错时给出适度提示，并提供核验或来源入口（若有）。

### 23.2 用户控制

- 生成内容可以拒绝、重试、停止和复制。
- 转换现有内容前提供预览或清楚说明范围。
- 允许恢复变更前内容；至少保留草稿、历史或撤销机制。
- 重要操作由用户最终确认，模型不能代替用户做不可逆决定。
- AI 功能不可用或用户不愿使用时，非 AI 核心创作功能仍应工作。

### 23.3 权限模式

当前模式可继续作为权限心智模型，但必须一致执行：

| 模式 | UI 表达 | 行为要求 |
|---|---|---|
| 读者模式 | 只读取资料 | 不显示暗示可写入的主要操作 |
| 助手模式 | 写入前确认 | 每次明确展示对象、范围和结果预览 |
| 作家模式 | 常规写入可跳过确认 | 首次开启强提示；随时可退出；删除仍确认；保留历史 |

不能只改变 Chip 文案而让实际权限行为不一致。

### 23.4 生成状态

- 支持停止生成。
- 流式输出保持滚动可控；用户向上阅读时不能强制拉回底部。
- 长任务允许离开当前页面继续运行时，提供统一任务状态入口。
- 失败保留提示词、附件和上下文选择，方便修改后重试。
- 模型切换、插件切换和上下文变化要在发送前可见。

### 23.5 风险与内容

- 对歧义、敏感内容、危险操作和可能造成大量修改的请求主动缩小范围或确认。
- 避免自动执行删除、购买、对外发送、发布或难以撤销的行为。
- 不利用拟人化设计隐瞒模型身份或制造不当依赖。
- 反馈入口自愿、低打扰；说明是否会发送对话内容和发送到哪里。
- 设计与测试要覆盖偏见、刻板印象、版权相似、幻觉、超时、断网和模型拒绝。

官方依据：[Generative AI](https://developer.apple.com/design/human-interface-guidelines/generative-ai)、
[Principles of great design](https://developer.apple.com/videos/play/wwdc2026/250/)。

---

## 24. 文件、导入、导出与分享

- iOS/iPadOS 文件工作流优先使用系统文件选择和分享体验。
- 导入前显示支持格式、目标项目和冲突处理方式。
- 导入过程可取消时提供取消；失败时说明哪些内容已写入、哪些没有。
- 导出显示格式、保存位置或分享目标，并在完成后提供可理解结果。
- 文件覆盖必须确认或自动生成安全副本。
- 拖入/分享进来的 `.fcworld` / `.fcplug` 继续经过现有确认流程，不能绕过安全检查直接改数据。
- iPad 多窗口或跨应用拖放时，保持复制/移动语义清楚。
- 文件名过长时保留可辨识部分，并允许查看完整名称。

官方依据：[File management](https://developer.apple.com/design/human-interface-guidelines/file-management)、
[Drag and drop](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop)。

---

## 25. FlowCloudAI 页面级规范

### 25.1 首页 / 项目列表

- 大标题显示当前位置，主要操作为“新建项目”。
- 导入、排序、帮助进入次要操作区。
- 项目卡片或列表显示名称、必要摘要和最近状态，不塞入全部统计。
- 空状态直接引导创建或导入一个项目。
- 项目打开后恢复上次访问位置；加载失败不能伪装成“没有项目”。

### 25.2 项目主页

- 首屏表达项目身份和最近/常用入口。
- 分类、词条类型、标签、关系图、时间线、设定检测按任务分组。
- 不把所有管理能力做成同等强调的大卡片矩阵。
- 高频“继续编辑”和“新建词条”优先；管理项和低频工具次要。

### 25.3 词条列表与详情

- 列表优先文字扫描，筛选和类型横向区域不能抢占返回手势。
- 行选择进入详情，Swipe/菜单用于补充动作。
- 详情把正文作为主内容，元数据和标签使用可折叠或次级区域。
- 编辑、AI 讨论、分享、移动和删除有明确层级。
- 删除词条显示对象名称和影响；可恢复时优先可撤销。

### 25.4 词条编辑器

- 标题、正文和保存状态始终可理解。
- 工具栏不遮挡文本选择、键盘和正文。
- 自动保存、保存中、已保存、保存失败状态必须真实。
- 双链、标签和 AI 插入不能破坏系统撤销与选区行为。
- 大字、横屏、小屏和长文档下保持可编辑。

### 25.5 AI Tab

- 会话内容是主层；模型、插件、权限模式和上下文清楚但保持次要。
- 输入区位于可达区域并适配键盘、安全区和附件状态。
- 发送、停止、重试的状态互斥且可预测。
- AI 修改项目时显示范围、确认或可恢复状态。
- 会话抽屉、模型菜单和更多 Sheet 不相互叠加。

### 25.6 灵感 Tab

- 新建、编辑、保存的当前状态清楚。
- 灵感列表和编辑区在 iPad 可形成 Sidebar/Detail；iPhone 使用抽屉或 push。
- 置顶、归档、删除是次要管理动作；删除需要确认或撤销。
- 草稿在切换项目、Tab、后台和异常退出时尽量恢复。

### 25.7 设置 Tab

- 按账户/外观、AI、插件、数据与备份、用量、帮助、关于等语义分组。
- Switch 位于列表行并即时反映状态。
- API Key 使用安全输入并说明保存位置。
- 移动端不显示桌面自定义数据目录。
- 危险数据操作单独分区，不能与普通开关混排。

### 25.8 关系图与时间线

- 画布手势与页面返回、抽屉、系统手势隔离。
- 提供缩放复位、适应内容、选择对象和退出画布的可见按钮。
- 图形颜色不是关系类型的唯一表达，提供形状、标签或图例。
- VoiceOver 或非图形模式提供等价的关系列表/时间事件列表。
- 大图处理性能下降时显示状态，不能悄然丢失节点或交互。

### 25.9 设定检测与长任务

- 任务开始前说明范围、预计资源和可否离开页面。
- 运行中显示真实状态、可安全取消时提供取消。
- 结果区分错误、警告、建议和已解决状态，不能只用颜色。
- 历史报告保留时间、范围和模型/规则上下文。

---

## 26. iPadOS 专项

- 不把 iPhone 单列页面简单拉伸到全宽。
- 项目层级采用 Sidebar + 内容列表 + Detail 的响应式结构。
- 支持窗口缩放和 Split View；每个宽度都能完成核心任务。
- 支持外接键盘焦点、标准编辑快捷键和清楚的焦点状态。
- 支持指针命中和 hover 增强，但核心信息不依赖 hover。
- 支持拖放词条、文本、文件时，提供替代操作和数据保护。
- 大屏正文限制阅读宽度；关系图等画布可利用额外空间。
- Popover 只在宽屏用于少量内容；紧凑宽度转为 Sheet。
- Tab Bar 与 Sidebar 的适配不改变业务路由和当前选择。

官方依据：[Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)、
[Focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection)、
[Pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices)。

---

## 27. 设计 Token 与组件治理

### 27.1 Token

- 所有颜色、间距、圆角、阴影、字体和层级优先使用 `flowcloudai-ui` 的 `--fc-*` Token。
- iOS 专属语义通过平台 Token 覆盖，不在业务组件散落平台判断。
- safe area、Tab/Toolbar 层级、键盘避让和材质必须有统一壳层变量。
- 新 Token 要描述语义用途，不以某个页面或临时颜色命名。

### 27.2 组件优先级

1. `flowcloudai-ui` 基础组件；
2. `app_main/src/shared/ui` 中的 Overlay、ActionMenu、布局和领域组件；
3. 现有移动端共享组件；
4. 新增组件。

不得在业务页面重复手写 Modal 外壳、全局 Esc/返回处理、Alert、Toast、Context Menu、
按钮或输入框。

### 27.3 平台变体

- 组件 API 表达语义，不暴露“蓝色按钮”“玻璃 18px”等视觉细节。
- iOS/Android 变体共享内容和行为测试，各自有视觉与真机验收。
- 只有系统能力不同才进入原生桥接；普通业务 UI 不下沉为 SwiftUI 复制品。

---

## 28. 设计与发布验收清单

### 28.1 每个页面必须检查

- [ ] 主要任务和主要操作清楚；没有多个同等强调主按钮。
- [ ] 顶部和底部 safe area 正确。
- [ ] 键盘不会遮住当前输入和提交操作。
- [ ] 所有常规命中区至少 44 × 44 pt。
- [ ] 返回按钮和系统左缘返回可用。
- [ ] Swipe、长按、拖放有替代入口。
- [ ] 浅色、深色和 Increase Contrast 下信息清楚。
- [ ] Reduce Motion / Reduce Transparency 下可用。
- [ ] 最大 Dynamic Type 下不丢关键内容或操作。
- [ ] VoiceOver 名称、角色、状态、顺序正确。
- [ ] 加载、空、失败、离线、禁用和权限拒绝状态均已设计。
- [ ] 危险操作可确认或撤销，数据风险说明清楚。
- [ ] 用户输入、草稿和滚动状态在返回/切 Tab 后按预期保留。
- [ ] iOS 专属样式没有改变 Android 默认视觉。

### 28.2 设备与环境矩阵

- [ ] 小型 iPhone 紧凑宽度。
- [ ] 当前标准 iPhone。
- [ ] 带 Dynamic Island 和 Home Indicator 的 iPhone。
- [ ] 横屏。
- [ ] iPad 全屏。
- [ ] iPad Split View 的窄、中、宽窗口。
- [ ] 系统中文与至少一种长文本语言。
- [ ] 外接键盘/指针（iPad）。
- [ ] 弱网、断网、插件缺失、模型不可用。
- [ ] 冷启动、热启动、后台恢复、覆盖安装后的数据恢复。

### 28.3 验证层级

| 层级 | 可证明 | 不能证明 |
|---|---|---|
| HTML 设计稿 | 信息层级、布局、状态、响应式意图 | Tauri 数据、原生权限、真机手势、性能 |
| 浏览器静态预览 | 基础 CSS 与组件外观 | 原生 WebView 行为、数据库、文件系统 |
| iOS Simulator | 大部分布局、键盘、基础无障碍 | 完整真机触觉、性能、签名、部分权限 |
| iPhone/iPad 真机 | 最终触控、手势、WebView、性能、权限、数据 | App Store 审核结果 |
| TestFlight/Release | 签名、分发和接近生产的整体行为 | 所有用户环境 |

### 28.4 App Store 提交前

- [ ] 无占位文本、空链接和不可用入口。
- [ ] 真机启动、崩溃、权限和数据恢复验证完成。
- [ ] 需要账户时准备审核账号或合适的演示模式。
- [ ] 后端和插件服务在审核期间可用，非显然流程写入 Review Notes。
- [ ] 应用表现为完整、实用的 iOS 产品，而不是简单网页包装。
- [ ] 账户删除、隐私说明、AI 数据与外部服务边界可发现。
- [ ] App Icon、截图、元数据和应用内品牌一致。

官方依据：[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)、
[App Review](https://developer.apple.com/app-store/review/)。

---

## 29. 项目优先级

### P0：发布前硬要求

- safe area、键盘和系统返回；
- 44 pt 命中区；
- Dynamic Type 与 VoiceOver；
- 浅色/深色/高对比；
- 草稿和数据保护；
- 危险操作确认或撤销；
- AI 身份、权限和修改范围透明；
- 加载/空/错误/离线/权限拒绝状态；
- iOS 与 Android 样式隔离；
- 真机关键路径验证。

### P1：结构适配

- iOS 大标题与工具栏层级；
- 搜索位置统一；
- 列表、Sheet、Menu 和 Alert 语义统一；
- iPad Sidebar/Split View；
- Reduce Motion / Reduce Transparency；
- 键盘和指针体验；
- AI 长任务和统一进度状态。

### P2：平台打磨

- iOS 27 Liquid Glass 渐进增强；
- iOS 专属 SF Symbols 映射；
- 原生触觉；
- 连续转场和更细致的状态动效；
- Icon Composer 多外观适配；
- 系统分享、文件和快捷能力的深度集成。

---

## 30. 官方资料索引

### 30.1 总览与资源

- [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines)
- [Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios)
- [Apple Design Resources](https://developer.apple.com/design/resources/)
- [Principles of great design — WWDC26](https://developer.apple.com/videos/play/wwdc2026/250/)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

### 30.2 基础视觉与无障碍

- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
- [Color](https://developer.apple.com/design/human-interface-guidelines/color)
- [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols)
- [Icons](https://developer.apple.com/design/human-interface-guidelines/icons)
- [App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)

### 30.3 导航与布局组件

- [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)
- [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)
- [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)
- [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)
- [Collections](https://developer.apple.com/design/human-interface-guidelines/collections)
- [Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields)

### 30.4 控件与输入

- [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- [Text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields)
- [Toggles](https://developer.apple.com/design/human-interface-guidelines/toggles)
- [Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls)
- [Sliders](https://developer.apple.com/design/human-interface-guidelines/sliders)
- [Pickers](https://developer.apple.com/design/human-interface-guidelines/pickers)
- [Entering data](https://developer.apple.com/design/human-interface-guidelines/entering-data)

### 30.5 浮层与反馈

- [Modality](https://developer.apple.com/design/human-interface-guidelines/modality)
- [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)
- [Action sheets](https://developer.apple.com/design/human-interface-guidelines/action-sheets)
- [Menus](https://developer.apple.com/design/human-interface-guidelines/menus)
- [Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers)
- [Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)

### 30.6 交互与产品体验

- [Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures)
- [Drag and drop](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop)
- [Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
- [Playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics)
- [Writing](https://developer.apple.com/design/human-interface-guidelines/writing)
- [Launching](https://developer.apple.com/design/human-interface-guidelines/launching)
- [Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding)
- [Settings](https://developer.apple.com/design/human-interface-guidelines/settings)
- [Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy)
- [Managing accounts](https://developer.apple.com/design/human-interface-guidelines/managing-accounts)
- [Managing notifications](https://developer.apple.com/design/human-interface-guidelines/managing-notifications)
- [Undo and redo](https://developer.apple.com/design/human-interface-guidelines/undo-and-redo)
- [File management](https://developer.apple.com/design/human-interface-guidelines/file-management)
- [Generative AI](https://developer.apple.com/design/human-interface-guidelines/generative-ai)

---

## 31. 维护规则

- 每次 Apple 发布新 iOS HIG、UI Kit 或重大设计系统更新时重新核验。
- 每次新增系统能力、权限、账户、通知、AI 自动操作或 iPad 多栏结构时扩展对应章节。
- 每次项目实现偏离本文件时，在设计稿或 PR 中记录原因、平台影响和降级策略。
- 规范改动不等于实现完成；正式发布仍须按第 28 节真机验收。
- 本文件只总结公开官方资料，不复制 Apple 页面正文，不把 Apple 受限资产提交到仓库。

### 版本记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-08-17 | 1.0 | 基于 Apple 当前 HIG、iOS/iPadOS 27 Design Resources 和 FlowCloudAI iOS 架构建立首版 |
