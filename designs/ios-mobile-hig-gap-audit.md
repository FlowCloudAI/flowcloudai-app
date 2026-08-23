# app_main 移动端 iOS UI/UX 规范差距审计

> 审计日期：2026-08-17
> 审计对象：`app_main/src/app/mobile`、共享 UI 组件、iOS 最低版本配置
> 规范基线：`designs/apple-ios-ui-ux-design-guidelines.md`、Apple HIG、项目 `AGENTS.md`
> 证据类型：iPhone 17 / iOS 26.5 模拟器运行截图 + 源码静态核查 + 4 个 Kimi CLI 与 3 个 Claude CLI 审计线程的候选项交叉复核
> 状态补充：IOS-005 的原生键盘指标方案已于 2026-08-20 由 `a781f94` 回退；标签 `mobile-keyboard-native-v1-2026-08-20` 保留回退前代码和证据。本文其余审计结论不受影响。
> 2026-08-23 Android 单端重新引入了更窄的原生 IME 测量路径：固定 WebView，只发布实际遮挡给
> AI/灵感内部布局，不恢复 iOS frame 调整、共享 Tab 显隐或 Portal 键盘架构；该路径已在目标 Android
> 真机完成实际触控验收。iOS 仅复用单一布局 owner 等架构约束，不能直接复用 Android Insets 接管机制，
> IOS-005 仍未解决。完整分析见 [`docs/mobile_keyboard_layout.md`](../docs/mobile_keyboard_layout.md#71-ios-适用性结论)。

## 1. 结论

当前移动端已经具备稳定的四 Tab 信息架构、统一 token、深色模式、基础安全区和减弱动画处理，但还不能视为达到项目定义的 iOS 交付基线。

对多个 CLI 审计线程提出的候选项去重，并剔除缺少证据、仅属偏好或与当前产品目标无关的内容后，共确认 **23 个根因级问题**：

| 严重度 | 数量 | 含义 |
|---|---:|---|
| P0 | 14 | 会破坏最低系统兼容、核心操作、可访问性或项目硬性规则，应在 iOS 验收前处理 |
| P1 | 9 | 不阻断基本使用，但明显偏离 iOS 体验或键盘/辅助功能预期 |
| P2 | 0 | 本报告未把单纯风格偏好计为“不符合规范” |
| **合计** | **23** | 统计单位是根因，不是每一个受影响选择器 |

按领域归类：兼容与启动 2、布局/安全区/键盘 3、字体与对比度 3、触控与状态 2、语义与 VoiceOver 7、焦点与键盘交互 1、宽屏/手势/材质 3、功能完整性 2。

## 2. 审计范围与证据边界

- 运行态只覆盖了真实 iOS 模拟器中的“首页”基准态、输入聚焦、横屏键盘、深色模式和最大辅助字号。
- 项目、词条、AI、灵感、设置等依赖 Tauri/数据库的页面没有用浏览器空壳代替；这些页面的结论均标注为源码证据。
- 没有清除、迁移或重建模拟器数据；测试后已恢复竖屏、浅色模式和标准大号字体。
- 4 个 Kimi CLI 线程分别检查视觉布局、交互导航、无障碍、平台适配。3 个线程在生成完整结论时遇到 403 用量限制；其阶段性输出只用于定位候选点，不直接计数。视觉线程给出的 58 条原始候选经过人工合并后收敛为初版 20 个根因。
- Kimi 失败的交互导航、无障碍、平台适配方向随后由 3 个 Claude CLI 只读线程重新执行，均完整结束。Claude 输出经本地源码二次核查后新增 3 个根因、扩充 4 个既有问题的证据，并修正 1 处手势描述；未经复核的代理结论仍未计数。
- 本报告不是 VoiceOver 人工走查、真实 iPhone 性能测试或完整 App Store 审核的替代品。

### 2.1 运行截图

本次会话的原始截图位于 `/tmp/flowcloudai-ios-audit-20260817/`：

- `03-home-restarted.png`：竖屏浅色基准态。
- `01-home-keyboard-cycle.png`：15px 输入框聚焦后页面被 iOS 自动放大，退出键盘后仍保持放大。
- `02b-home-landscape-ui.jpg`：横屏聚焦输入，键盘附件栏遮挡底部导航。
- `04-home-dark.png`：深色模式对比度采样。
- `05-home-accessibility-xxxl.png`：系统字号设为最大辅助字号后的页面；与基准态几乎完全相同。

### 2.2 已确认的产品决策

以下取舍由项目负责人于 2026-08-17 确认，后续实现不再重复询问方向：

| 问题 | 已选方案 | 实现边界 |
|---|---|---|
| IOS-001 | 最低支持版本提升到 iOS 16.2+ | 不再为 iOS 14/15 维护 `color-mix()` 双套 fallback |
| IOS-002 | 使用小型 iOS 原生桥接支持 Dynamic Type | 原生层只暴露系统字号等级；业务 UI 继续通过共享字体 token 消费 |
| IOS-005 | 停靠软键盘展开时隐藏底部 Tab | 该产品目标保留，但原生指标实现已回退；重新设计前，现行版本不隐藏 Tab，也不声明页面/Portal 的自定义键盘空间所有权 |
| IOS-017 | 正式实现 iPad 自适应布局 | 复用现有 store、API 和领域组件，只新增 regular-width 壳层 |
| IOS-018 | 保留 React 手势并补跟手进度 | 不改造为原生页面栈；iOS/Android 共用进度、取消区间和专项测试 |
| IOS-019 | 使用 iOS 原生桥接读取降低透明度/提高对比度 | 与 Dynamic Type 共用轻量辅助功能桥接层，Windows/Android 不依赖该实现 |
| IOS-020 | 保留入口但使用明确禁用态 | 相机/图库标注“即将支持”，世界地图标注“仅桌面端” |

### 2.3 当前实现进度

截至 2026-08-18，独立分支 `codex/ios-hig-first-pass` 的实现状态如下：

| 问题 | 实现状态 | 验证边界 |
|---|---|---|
| IOS-001 | 已实现 | Tauri 配置、README、iOS 工作流均统一到 16.2；重新生成 Xcode 工程后，模拟器包以 `arm64-apple-ios16.2-simulator` 成功链接。工作流会拒绝继续使用版本过期的生成工程 |
| IOS-002 | 已实现，待最大辅助字号逐页视觉验收 | `MobileApp` 加载 touch-density 的 13/15/17/22/28px 五档移动语义字号；iOS 原生桥通过 `UIFontMetrics` 写入缩放倍率，Android 使用 `Configuration.fontScale`，变量挂在 touch 根节点，因此页面和 portal 浮层一致，桌面 comfortable density 不受影响 |
| IOS-003 | 已实现并通过 iPhone 真机验收 | iOS/Android 共用的 touch-density 输入字号已提升到 17px；iPhone 聚焦、失焦后的页面比例与导航由项目负责人确认通过 |
| IOS-004 | 已实现，待双端横屏验收 | 页面、顶栏、AI 输入区、底栏与三类侧抽屉统一消费左右安全区；主内容取基础 gutter 与两侧安全区的最大值，兼容 iOS 横屏及 Android edge-to-edge |
| IOS-005 | iOS 原生指标方案已回退，待重新设计 | iOS 仍保持回退基线：`visualViewport` 只参与输入态判断，不改应用根高度；底部 Tab 不因输入而隐藏。Android-only `WindowInsetsCompat` 路径已通过目标真机验收，但 iOS 没有对应的公开 Insets 清零入口，不能直接启用 `--fc-kb`，也不代表 IOS-005 已解决 |
| IOS-006 | 已实现，待双主题视觉验收 | touch density 将仍需阅读的三级文字与 placeholder 提升到 secondary 文本基线；浅色主背景约 6.29:1，深色抬升面约 5.23:1，桌面主题 token 不变 |
| IOS-008 | 已实现，待页面巡检 | touch density 为原生按钮、`role="button"` 和 `summary` 统一设置 48×48 最小命中区，一次满足 iOS 44pt 与 Material 48dp，并排除 Input 内部组合式清除/步进按钮；共享 MessageBox 操作也随移动根作用域放大，桌面不受影响 |
| IOS-014 | 已实现 | 移动端在后端 ready 后直接调用 `showWindow()`，不再依赖可能被隐藏 WKWebView 暂停的 `requestAnimationFrame`；iOS 16.2 simulator debug 原生构建通过 |
| IOS-018 | 已升级为双层原生式过渡，真机调优中 | iOS 保留左边缘自绘手势与距离/速度组合阈值；Android 接入系统预测式返回的开始、进度、取消和提交回调。两端复用相邻双层页面与 Reduced Motion 降级，提交后由已挂载下层直接接管。纯计算测试、lint、前端构建和 iOS 模拟器构建通过；iPhone 真机手感与 Android APK 仍待复验 |
| IOS-019 | 已实现，待辅助功能真机验收 | iOS 原生桥监听降低透明度和加深系统颜色；Android 读取高对比度设置。两端统一写入 `data-mobile-high-contrast`，强制玻璃和半透明 surface 降级为不透明高对比面 |
| IOS-020 | 已实现，待目标页视觉验收 | 相机、图库和世界地图均为原生 `disabled` 控件，原因持续可见且进入可访问名称；不再绑定失败提示操作。前端构建和 iOS 模拟器原生启动通过，目标页仍需人工进入确认最终排版 |
| IOS-021 | 已实现，待外接键盘验收 | 移动壳层的 Esc 处理不再限定 Android；iOS/iPadOS 与 Android 均先结束文本输入，再按浮层、抽屉、页面栈顺序返回 |

2026-08-18 本批次的 34 项移动壳层专项测试、完整 lint、TypeScript/Vite 生产构建与 iOS 16.2 simulator debug 原生构建均通过。输入视口又在 iPhone 17 Pro（iOS 26.5）模拟器上进入输入流程并截图；修复后的输入区没有二次收缩，系统收起软键盘且输入焦点仍保留时，底部 Tab 已在模拟器画面中恢复。应用深色主题下的 iOS 原生状态栏图标同步也已截图确认。该段 Android 环境缺失结论只对应 2026-08-18 的历史审计现场；2026-08-23 已在 Xiaomi / Android 16 / WebView 143 构建安装当前包，并由项目负责人完成实际触控验收。Android 通过不改变本报告的 iOS 真机证据边界。

2026-08-19 历史实现（已回退）：物理缩短 WebView 与 WebView 自身键盘补偿会在动画期间竞争，因此两端曾改为固定原生 WebView，由原生只发布稳定的最终键盘遮挡，Web 根只消费一次 `occludedBottom`。Android 使用 `adjustNothing`，不在 insets animation 的 `onProgress` 中改尺寸或执行 JavaScript；iOS 不再动画或改写 `WKWebView.frame`，只监听 `UIKeyboardWillChangeFrame`。底栏改为一次性显隐，不再动画 `max-height` / `padding`；`visualViewport` 只在原生桥不可用时兜底。该实现后来整体回退，本段只用于说明失败方案演进。

2026-08-20 历史实现（已回退）：iPhone 与模拟器暴露了上段 iOS 假设仍不完整。后续曾加入 `viewportAdjusted:true`、Will/Did Hide 终态、80pt 有效遮挡阈值及稳定边界外层 offset 复位；虽然静态测试和模拟器终态截图通过，真机点击聚焦仍出现键盘开始升起后自行落下，核心输入流程不可用，因此这些改动连同原生指标架构由 `a781f94` 整体撤销。截图与诊断仍是后续重新设计的反例证据，不代表现行能力。

同日历史实现（已回退）还曾补齐 Portal 浮层的键盘所有权：含输入控件的 AI 更多菜单显式消费键盘遮挡，背景页面在浮层存续期间保持原布局。Android 真机曾验证菜单升起、系统返回收起键盘及菜单回落；该证据只说明当时终态，不足以覆盖后来出现的 iOS 键盘呼出中断。当天完整的问题链与失败方案见工作区 `docs/devlog/2026-08-19-移动端原生交互-复盘.md`（该文件在根仓库，不在本仓）。

同日较早的 Android 真机数据仍用于说明问题来源：MIUI edge-to-edge 曾把 `adjustResize` 退化为 visual viewport 平移，首轮为 `innerHeight=834`、`visualViewport.height=521.54`、`offsetTop=312.92`。随后“直接约束 WebView 物理高度”的方案虽一度让 composer 与键盘边界对齐，却在键盘动画中引入最终 insets、中间帧和 WebView 自身补偿的竞争，现已撤销；当时的复验数据不能作为当前固定 WebView 方案的验收结果。

## 3. 已确认的 P0 问题

### IOS-001：最低 iOS 14 与 `color-mix()` 大量使用不兼容

- **证据**：`src-tauri/tauri.conf.json:48` 声明 `minimumSystemVersion: 14.0`；`src/app/mobile/MobileApp.css:3-46`、`src/glassEffect.css:14-26` 等处共有 143 个 `color-mix()` 用法，关键 token 没有等价的前置 fallback。
- **判定**：WebKit 官方记录显示 Safari 16.2 才加入 `color-mix()`。因此 iOS 14/15 的 WKWebView 会忽略这些声明，边框、背景、阴影与状态色可能退化或缺失。
- **已决策方案**：最低支持版本提升到 iOS 16.2+，同步更新 Tauri/Xcode 配置、构建说明与验收设备矩阵；不再为 iOS 14/15 维护 `color-mix()` fallback。
- **实现状态**：已完成。`tauri.conf.json`、README 与 iOS 工作流已统一为 16.2；`ios:doctor`、dev/run、模拟器构建和 IPA/Archive 会检查生成工程版本，避免旧 Xcode 工程继续按 14.0 链接。
- **来源**：[WebKit Features in Safari 16.4](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)

### IOS-002：最大 Dynamic Type 对应用文字没有产生可见缩放

- **证据**：`../lib_ui/ui/src/style/index.css:143-152` 使用固定 `rem` 字号；系统从 `large` 切到 `accessibility-extra-extra-extra-large` 后，首页内容区截图仅 6 个像素发生不超过 3 级的噪声变化，排版、字高和换行完全不变。
- **影响**：低视力用户无法通过系统字号获得更大文本；固定高度、`nowrap` 与行截断还会在未来补上缩放后产生裁切风险。
- **已决策方案**：增加小型 iOS 原生桥接，读取 Dynamic Type category 并写入根级缩放 token；正文、标题、控件文字分别设上限，并以最大辅助字号逐页验证换行、滚动和控件高度。
- **实现状态**：已完成。touch density 使用 13/15/17/22/28px 五档移动字号；iOS 原生桥用 `UIFontMetrics` 读取 Dynamic Type 并把倍率限制在 1～2 倍后写入 `--mobile-font-scale`，监听 Content Size Category 变化。Android 使用 `Configuration.fontScale` 写入同一变量；桌面 comfortable density 继续使用共享组件库原值。仍需以最大辅助字号逐页检查换行、截断和控件可达性。

### IOS-003：15px 输入触发 iOS 自动缩放并留下“粘住的放大态”

- **证据**：`../lib_ui/ui/src/style/index.css:148` 的 `--fc-font-size-md` 为 `0.9375rem`（15px），`Input.css:27,70` 直接用于输入框；`MobileAiChat.css:487` 的 AI 主 `<textarea>` 也使用同一 15px token。首页灵感输入聚焦后模拟器自动放大，关闭键盘后右侧内容仍被裁掉，底部 Tab 文字消失。
- **影响**：核心输入流程破坏页面比例与可导航性。
- **建议**：iOS 可编辑控件的实际字体不得低于 16px；不要用禁用页面缩放来掩盖问题。
- **实现状态**：已完成并通过 iPhone 真机验收。touch density 将输入与操作控件字号统一为 17px，iOS 与 Android 共用，桌面不受影响。

### IOS-004：横屏未统一处理左右安全区

- **证据**：`MobileApp.css:207-216` 只加顶部安全区；`MobileHome.css:3-5` 使用固定水平 padding；`MobileNav.css:5-6` 只处理底部安全区。横屏截图中内容进入 Dynamic Island 一侧的危险区域。
- **影响**：横屏、带刘海设备以及 iPad 多任务窗口可能出现内容贴边或被遮挡。
- **建议**：在移动壳层集中定义 `max(page-padding, env(safe-area-inset-left/right))`，页面与底栏都消费同一组逻辑方向 token。
- **实现状态**：已完成代码实现。页面、顶栏、AI composer、底栏及侧抽屉均消费共享安全区 token；待 iPhone/Android 横屏和 edge-to-edge 实机验收。

### IOS-005：键盘布局曾依赖 WebView 推断，页面与 Tab 无法稳定分配空间

- **证据**：`MobileApp.css:78-90` 使用固定 `100vh/100dvh` 壳层；普通页面没有全局 `visualViewport` 键盘避让。横屏聚焦首页输入时，键盘附件栏覆盖中间 Tab，只剩首页与设置部分可见。
- **影响**：输入时仍可切换 Tab，可能意外离开当前上下文；横屏下底栏还会被键盘附件栏部分遮挡，既不可读也不可可靠操作。
- **目标方案**：停靠软键盘出现时隐藏并禁用底部 Tab；浮动键盘与外接键盘不隐藏。页面外壳不整体移动，AI 只压缩 Messages，灵感正文内部滚动，前景 Bottom Sheet 优先于背景页。该目标需要重新设计，不能直接恢复归档实现。
- **实现状态**：iOS 原生 frame/insets、共享 `occludedBottom` store、Tab 原生显隐、页面/Portal 键盘专用布局及 iOS focus reveal guard 已由 `a781f94` 回退。现行 iOS 仍沿用 `visualViewport` 输入态检测且不隐藏 Tab；Android 后续新增的固定 WebView + 原生 IME 测量只服务 Android AI/灵感布局，不在 iOS 写 `--fc-kb`。IOS-005 继续标记为未解决。回退前代码可从标签 `mobile-keyboard-native-v1-2026-08-20` 检出比较。
- **2026-08-23 复核**：Android 的“读取 IME 后向 WebView 清零”依赖 `WindowInsetsCompat` 分发链，WKWebView 没有公开的直接等价入口。`UIKeyboardLayoutGuide` 与键盘通知能测量遮挡，但不能同时关闭 WebKit 的自动 focus reveal；WebKit 的 `interactive-widget` / VirtualKeyboard API 仍未实现，iOS 26 的 `obscuredContentInsets` 又不兼容本项目 iOS 16.2 下限且不是键盘 opt-out。故 iOS 只能复用单一 owner、固定外壳和内部消费原则，不能复制 Android 接线。当前禁止恢复 frame resize、移除 WebKit 通知观察者或直接打开 `--fc-kb`；详见[权威键盘文档](../docs/mobile_keyboard_layout.md#71-ios-适用性结论)。

### IOS-006：浅色与深色的占位/三级文字对比度不足

- **证据**：`../lib_ui/ui/src/style/index.css:79,246` 将三级文字设为 `#B3B3B3` / `#636158`。截图像素采样结果：浅色占位文字约 **2.10:1**，浅色数量文字约 **2.07:1**；深色占位文字约 **2.37:1**，深色数量文字约 **3.06:1**。
- **影响**：均低于普通文本常用的 4.5:1 基线，低视力、强光和降低屏幕亮度场景下难以辨认。
- **建议**：拆分“装饰性弱化”和“仍需阅读的三级文本”token；占位、计数、辅助说明至少达到普通文本对比度要求。
- **实现状态**：已完成移动端覆盖。仍需阅读的三级文字与 placeholder 使用 secondary 文本基线，浅色/深色主要 surface 的计算对比度均高于 4.5:1；桌面 comfortable density 不变。

### IOS-007：底部 Tab 选中态只靠颜色，缺少可访问状态

- **证据**：`MobileNav.tsx:54-67` 的按钮没有 `aria-current`、`aria-selected` 或 Tab 语义；`MobileNav.css:32-34` 的 active 状态只改变颜色。运行截图也只显示颜色差异。
- **影响**：色觉障碍用户和 VoiceOver 用户不能可靠判断当前 Tab。
- **建议**：为当前项加 `aria-current="page"` 或完整 `tablist/tab` 语义，并增加形状、字重、指示条或填充图标中的至少一种非颜色提示。
- **同根因补充**：`MobileEntryList.tsx:319-343` 的词条类型筛选也没有 `aria-pressed/aria-selected`；`MobileAiConversationDrawer.tsx:43-50` 的当前会话只靠 `active` class，而相邻实现 `MobileIdeaDrawer.tsx:128-136` 已正确使用 `aria-current`。

### IOS-008：多个交互控件低于 44×44 pt

- **证据**：共享 token 已有 `--fc-control-tap-min: 2.75rem`，但移动端多处绕过它，例如 `MobileHome.css:163-166`（37.6px）、`MobileEntryList.css:56-72`（39.2px）、`MobileAiChat.css:132-146`（42.88px）、`MobileEntryDetail.css:513-525`（32px）、`MobileApp.css:560-573`（32.8px）；`MessageBox.css:1082-1095` 的消息操作仅 26×26px。Claude 复核还定位到 `MobileHome.css:284-300,364-372` 的最近词条与帮助入口缺少最小点击区。
- **影响**：常用保存、筛选、对话、详情操作在单手和运动场景下误触率高，也不满足项目 44pt 基线。
- **建议**：图标可以保持小，但交互盒统一 `min-inline-size/min-block-size: var(--fc-control-tap-min)`；用自动化扫描覆盖所有移动端 `button`、可点击 Card 和自定义控件。
- **实现状态**：已完成公共 touch-density 基线。移动端 `button`、`role="button"` 与 `summary` 使用 48×48 最小命中区，Input 内部组合按钮例外；专项静态测试覆盖作用域与 token，仍需逐页视觉巡检是否出现紧凑布局重排。

### IOS-009：项目卡片和词条卡片是只有点击行为的 `<div>`

- **证据**：`MobileProjectList.tsx:292-324`、`MobileEntryList.tsx:375-405` 给 `Card` 传 `onClick`；共享 `Card.tsx:180-215` 固定渲染 `<div>`，没有自动补 `role`、`tabIndex` 或 Enter/Space 处理。首页同类卡片在 `MobileHome.tsx:466-509` 已手工补齐，证明当前行为并非组件自带。
- **影响**：键盘和部分辅助技术无法操作两个核心列表入口。
- **建议**：优先让 Card 支持 `as="button"`/`interactive` 语义；短期至少复用首页的 role、焦点与键盘处理。

### IOS-010：核心搜索/输入仅使用 placeholder 作为标签

- **证据**：`MobileHome.tsx:612-623`、`MobileProjectList.tsx:251-260`、`MobileEntryList.tsx:305-314` 的搜索框没有显式 label 或 `aria-label`；`MobileAiComposer.tsx:34-38` 的主输入同类处理。首页灵感速记 `MobileHome.tsx:585-603` 已正确提供 `aria-label`，说明可以沿用现有做法。
- **影响**：placeholder 输入后消失，VoiceOver 表单导航也可能得到不稳定的字段名称。
- **建议**：所有输入都提供持久可见标签，或至少提供稳定的 `aria-label/aria-labelledby`；placeholder 只放示例或提示。

### IOS-011：关闭的侧抽屉仍留在辅助技术树中，打开时主内容也未隔离

- **证据**：`MobileApp.tsx:441-473` 为手势动画持续保留抽屉 DOM，但关闭态没有 `aria-hidden`/`inert`；打开态也没有把主内容设为 inert。抽屉仅用 `aside aria-label`，不是模态导航语义。
- **影响**：VoiceOver 和外接键盘可能访问屏幕外控件，焦点穿过抽屉进入背景页面。
- **建议**：关闭态设 `inert` + `aria-hidden`；打开态隔离主内容，移动焦点到抽屉首个可操作项，关闭后恢复触发器焦点。

### IOS-012：AI 消息流没有 `log`/live-region 语义，也没有明确作者语义

- **证据**：`MobileAiMessageList.tsx:45-150` 使用普通 `<main>` 和一组 `MessageBox`；流式消息没有 `aria-live`。传入的 `role={message.role}` 是领域属性，共享 `MessageBox.tsx:810-825` 最终仍渲染普通 `<div>`。
- **影响**：VoiceOver 不会可靠播报新消息或区分用户/助手，AI 核心任务无法独立完成。
- **建议**：消息容器使用 `role="log"` 与合适的 live 策略；每条消息提供作者可访问名称，流式输出节流播报并在完成时给出稳定通知。

### IOS-013：AI 消息操作按钮无可访问名称且只有 26×26px

- **证据**：`MessageBox.tsx:724-805` 的复制/重试/播放等图标按钮只用 `data-tooltip`，没有 `aria-label`；`MessageBox.css:1082-1095` 固定 26×26px。
- **影响**：触控难点按，VoiceOver 只会读成无名称按钮或读出内部图形。
- **建议**：补齐动作名称、状态和结果反馈，并扩大透明点击区到 44pt。

### IOS-014：移动壳层把 `showWindow()` 放进 `requestAnimationFrame`

- **证据**：`MobileApp.tsx:226-235` 在 rAF 中调用 `showWindow()`；项目 `AGENTS.md:47,191` 明确禁止这种写法，因为隐藏 WKWebView 在 macOS 可能暂停帧回调并形成窗口启动死锁。
- **影响**：这是共享移动壳层对桌面小窗口/调试场景的跨平台回归风险，违反项目硬规则；虽然不是纯 HIG 问题，仍属于首屏可用性阻断项。
- **建议**：ready/failed 后直接调用 `showWindow()`；分别验证 iOS 启动、macOS 冷启动白屏和 Windows 窗口初始化。
- **实现状态**：已完成。`backendReady` 后直接调用 `showWindow()`；前端 lint、类型检查、生产构建与 iOS 16.2 simulator debug 原生构建通过，实际冷启动仍按平台验收清单执行。

## 4. 已确认的 P1 问题

### IOS-015：通用 Overlay 有焦点进入/恢复，但没有焦点圈闭

- **证据**：`src/shared/ui/overlay/Overlay.tsx:89-122` 支持 Esc、滚动锁、初始焦点和恢复焦点，`141-149` 有 dialog 语义；但没有 Tab 循环，也没有让背景 inert。
- **影响**：外接键盘可从模态框跳到背景控件。
- **建议**：给共享 Overlay 增加 focus trap 与背景 inert，一次修复所有移动/桌面浮层消费者。

### IOS-016：锚点菜单缺少标准键盘焦点模型

- **证据**：`MobileTopControls.tsx:259-318` 只处理返回栈和位置更新；`285-316` 声明 `role="menu"`，但打开时不聚焦首项，也没有方向键、Home/End、Esc 与触发器焦点恢复；菜单项见 `343-364`。
- **影响**：iPad 外接键盘和 Switch Control 用户操作菜单不稳定。
- **建议**：实现 roving tab index 和标准 menu 键盘模型，或改用已有、已验证的共享 `ActionMenu`。

### IOS-017：iPad/宽屏仍是拉伸后的 iPhone 壳层

- **证据**：`MobileApp.tsx:483-559` 始终采用单页 + 底部四 Tab + 抽屉；移动 CSS 只有 `MobileHome.css:392` 与 `MobileEntryList.css:243` 两个 42rem 内容网格断点，没有 regular-width 的 Sidebar/Split View 壳层。
- **影响**：iPad、Stage Manager 和 Split View 下空间利用率低，列表—详情上下文频繁丢失。
- **已决策方案**：正式支持 iPad，在 regular width 切换为 Sidebar/列表/详情自适应壳层；继续复用共享 React 领域层，不新建独立 `IosApp`。首轮只对 iOS/iPadOS 启用该壳层，避免未经验证地改变 Android 平板导航。

### IOS-018：自定义边缘返回手势依赖库级方向锁，且缺少交互进度

- **证据**：`useMobileSideDrawerGesture.ts:269-349` 的业务分支没有显式 `dx/dy` 比值判断，但 `410-418` 已通过 `@use-gesture/react` 的 `axis: 'x'` 提供库级方向锁，因此“完全没有方向判断”的原表述不准确。边缘返回在达到阈值前仍不更新任何可视进度，触发后直接执行返回。
- **影响**：方向判断依赖第三方库的隐式行为且缺专项测试；更明确的问题是返回没有交互式进度和取消反馈，不像 iOS 可预测的跟手返回。
- **已决策方案**：保留 React 手势与现有库级轴锁，不改造为原生页面栈；补充速度/距离组合阈值测试，并为返回提供跟手进度、取消区间和回弹反馈。
- **实现状态**：已完成公共双层原生式实现。页面栈向公共 `MobilePageTransitionHost` 暴露带稳定 key 的相邻两层；iOS 手势开始时锁定原前景页，前景页随手指滑动，下层页同步视差显露；抬手后按距离/速度组合结算并回弹或完整滑出。Android 不再注册自绘左边缘指针手势，而由 `OnBackPressedCallback` 的预测式返回开始、进度、取消和提交事件驱动同一双层转场。通过后以无入场动画的 pop 提交，使已挂载下层原位接管；底部 Tab 不参与位移，动画期间导航互斥，业务页无需逐页适配。两端均支持 Reduced Motion；iPhone 真机手感、复杂页面副作用和 Android 原生合成表现仍需人工验收。

### IOS-019：玻璃效果缺少“降低透明度/提高对比度”降级策略

- **证据**：`src/glassEffect.css:17-26,110-150` 集中管理透明材质和 blur，这是正确收口；但没有 `prefers-contrast` 或原生 Reduce Transparency 映射。当前只有用户手动开关和部分 `prefers-reduced-motion`。
- **影响**：开启玻璃后，低视力或系统已要求降低透明度的用户仍可能得到透明、低对比背景。
- **已决策方案**：通过 iOS 原生桥接读取降低透明度/提高对比度状态，写入根属性；触发时强制使用实色、高对比 surface。该能力与 Dynamic Type 共用轻量 iOS 辅助功能桥接层，Windows/Android 保持独立。
- **实现状态**：已完成代码实现。iOS 监听 `UIAccessibilityReduceTransparencyStatusDidChangeNotification` 与 `UIAccessibilityDarkerSystemColorsStatusDidChangeNotification`，Android 读取高对比度设置；两端统一写入 `data-mobile-high-contrast`，移动 surface token 在该状态下全部降级为不透明背景。iOS 原生构建通过，仍待真机/模拟器切换辅助功能逐页验收；Android 仍为代码分析、未运行。

### IOS-020：未开放功能以正常可用操作呈现，但实际总是失败提示

- **证据**：`MobileAiComposer.tsx:63-65` 把相机、图库与文件、联网搜索并列成可点击入口；`MobileAiChat.tsx:611-613,850-852` 对相机和图库只显示“暂未开放/不支持”的提示。相同问题还出现在项目主页：`MobileProjectHome.tsx:308-312` 把“世界地图”与三个可用高级工具并列，`174-188` 点击地图只显示暂未开放提示，`MobileProjectHomeSections.tsx:170-187` 没有 disabled 或平台说明。
- **影响**：用户在核心 AI 输入流和项目工具网格中看到无法完成的承诺，降低可预期性，也不利于商店审核时解释功能完整度。
- **已决策方案**：保留入口，但使用真正的 disabled 状态与持续可见说明；相机、图库标注“即将支持”，世界地图标注“仅桌面端”。禁用项不得继续响应点击后才弹提示，VoiceOver 名称中也要包含不可用原因。
- **实现状态**：已完成。三个入口均使用 `disabled`，原因在界面持续可见并写入可访问名称，原失败提示回调已移除。

### IOS-021：iOS/iPad 外接键盘无法用 Esc 关闭锚点菜单和侧抽屉

- **证据**：`MobileApp.tsx:389-401` 的 Esc 监听在 `platformInfo.os !== 'android'` 时直接返回；而 `MobileTopControls.tsx:259-263` 的锚点菜单和侧抽屉只注册到返回栈，没有自己的键盘监听。对照 `Overlay.tsx:89-104` 已实现不限平台的捕获阶段 Esc 处理。
- **影响**：iPad 妙控键盘/外接键盘用户不能用 Esc 关闭分类、AI 会话、灵感抽屉及锚点菜单，同一应用内不同浮层行为不一致。
- **建议**：让移动壳层在所有平台处理 Esc，并保留输入框编辑时不拦截的保护；更稳妥的长期方案是让菜单和抽屉复用 Overlay 的退出与焦点策略。
- **实现状态**：已完成公共壳层处理。Esc 在 iOS/iPadOS 与 Android 上先结束文本输入，再复用现有返回层级关闭浮层、抽屉或页面；待外接键盘人工验收。

### IOS-022：设定检测长任务的动态状态不会主动播报

- **证据**：`MobileWorldCheck.tsx:438-460` 的任务面板持续更新阶段和 `currentActivity`，但状态容器没有 `role="status"` 或 `aria-live`。项目内 `FcworldProgressDialog` 与 `AiResponsePendingIndicator` 已有可复用的正确模式。
- **影响**：VoiceOver 用户启动长时间设定检测后，除非不断手动重新导航，否则无法获知阶段推进、停止中、失败或完成状态。
- **建议**：给状态摘要使用 `role="status" aria-live="polite"`，对高频活动文本节流；失败使用 alert，完成只播报一次。

### IOS-023：关系图谱缺少“适应内容/缩放复位”的可见入口

- **证据**：`MobileRelationGraph.tsx:23-64` 顶栏只有返回和关系列表；共享 `RelationGraph.tsx:498-514` 设置 `fitView={false}`，只渲染 `<Background>`，没有 `<Controls>`，也没有公开 `fitView/zoomIn/zoomOut` 操作。`MobileRelationGraph.css:92-95` 仍保留未被渲染的 `.react-flow__controls button` 样式。
- **影响**：用户捏合或拖拽后迷失在大型关系图中，只能靠反复手势尝试找回内容。
- **建议**：至少提供一个 44pt 的“适应全部节点”按钮并调用 `fitView()`；如恢复完整 Controls，需同时提供可访问名称并验证移动端命中区。

## 5. 已符合或值得保留的设计

- `MobileNav.css:19` 的底部主导航高度满足 44pt，四个核心入口数量也稳定。
- `Overlay.tsx` 已有 dialog、Esc、滚动锁、初始焦点和焦点恢复；只需在共享层补焦点圈闭。
- `Overlay.css:110-114` 和页面转场已处理 `prefers-reduced-motion`。
- 首页灵感输入已有明确 `aria-label`；首页 Card 也实现了 Enter/Space，可作为其他页面的迁移样板。
- 错误状态多处使用 `role="alert"` 并提供重试，不是只有静态文案。
- 毛玻璃被收口到 `glassEffect.css`，关闭时有实色路径，没有让各业务页自行堆 `backdrop-filter`。
- 视觉样式大体使用 `--fc-*` 与移动端语义 token，后续可以通过少量根 token 修复大量页面。

## 6. 修复顺序与平台影响

### 第一批：阻断 iOS 验收

1. 将最低支持版本统一提升到 iOS 16.2，并同步配置与文档。
2. 修复 16px 输入、Dynamic Type、左右安全区；重新设计停靠键盘下的 Tab、页面和前景浮层空间所有权，禁止直接恢复已回退的原生指标实现。
3. 提升三级文字对比度，统一 44pt 点击区。

### 第二批：完成 VoiceOver/键盘基线

1. 修复 Card、输入标签、Tab 状态、抽屉隔离。
2. 给 AI 消息流与操作按钮补语义。
3. 在共享 Overlay/菜单层补焦点管理与全平台 Esc 退出，避免逐页面重复实现。
4. 给设定检测等长任务补节流后的 live-region 状态播报。

### 第三批：iPad 与体验完整性

1. 在同一 React 领域层上增加 iPad regular-width 自适应壳层。
2. 保留 React 返回手势并补跟手进度，同时接入玻璃材质辅助功能降级。
3. 将尚未实现的 AI 相机、图库、世界地图改为明确禁用态并显示原因。
4. 给关系图谱提供“适应内容/缩放复位”控件。

### 构建、耦合与发布边界

- 大部分修改位于共享 React/CSS 层，会同时影响 iOS、Android 和桌面窄窗口；需要三端回归，不能把它们当作纯 iOS 皮肤调整。
- iOS 最低版本、Dynamic Type 与 Reduce Transparency 原生桥接放在 iOS 专属配置/插件层，Windows 与 Android 保持独立发布。
- iPad 自适应应复用现有 store、API 和领域组件，只切换壳层与导航呈现，避免形成第二套长期分叉的 `IosApp`。
- 当前第一批实现修改了共享移动端 React/CSS、iOS 构建配置与工作流；没有迁移或清理用户数据。重新生成的 `src-tauri/gen/apple` 仍是忽略目录，不作为长期修改来源。

## 7. 验收清单

- iOS 16.2 作为最老支持版本能完成冷启动、核心导航、输入和样式渲染，所有构建配置与发布文档版本一致。
- iPhone/Android 竖屏与横屏：输入聚焦不缩放；停靠键盘不遮挡输入和提交操作，Tab 隐藏且不可交互；系统收起后 Tab 恢复；浮动键盘与外接键盘不误隐藏 Tab；AI 只滚动消息区，灵感页只滚动正文；左右安全区正确。
- Dynamic Type：从默认字号到最大辅助字号，核心任务可完成，无裁切、重叠和不可达操作。
- VoiceOver：可识别当前 Tab/筛选/会话、项目/词条卡片、搜索框、抽屉、AI 消息作者与消息操作，并能获知设定检测进度。
- 外接键盘：Esc 能按层级关闭锚点菜单、抽屉和对话框，关闭后焦点返回触发器。
- 触控：所有交互命中区至少 48×48，一次满足 iOS 44pt 与 Material 48dp。
- 对比度：浅色/深色及玻璃开关两种状态下，普通文本达到 4.5:1。
- iPad：全屏、1/2 Split View、1/3 Split View 与 Stage Manager 窗口可用。
- 未开放功能：相机/图库以禁用态显示“即将支持”，世界地图以禁用态显示“仅桌面端”，均不会响应点击后才提示失败。
- 关系图谱：用户可通过可见按钮适应全部节点或复位视图，且该按钮具备可访问名称和 44pt 命中区。
- 共享壳层变更后：运行 `npm run lint && npm run build`，并分别执行 iOS 原生启动、Android debug APK 和桌面原生回归。
