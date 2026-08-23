# 移动端 UI 基线落地记录

> 日期：2026-08-18
>
> 规范：`designs/mobile-ui-baseline.md`
>
> 作用域：`data-fc-density="touch"` 与 iOS/Android 原生桥；桌面 `comfortable` density 不消费本批移动覆盖。

## 1. 结论

无需产品取舍、可以机械判断正确性的规范化项目已经落地。涉及信息优先级、文案删减、加载模型和容器取舍的项目没有擅自决定，集中列在第 5 节。

共享 React/CSS 改动同时作用于 iOS 与 Android；平台差异收口到各自原生桥。没有迁移、删除或重建用户数据，也没有把平台逻辑写入桌面壳层。

## 2. 已完成的纯规范化

### 2.1 Token 与尺度

- 新建 `src/app/mobile/mobileTokens.css`，在 touch 根节点集中定义间距、5 档字号、3 档字重/行高、边框、两档阴影、语义 z-index、安全区、动效和 48px 命中区。
- `mobileTypography.css` 只保留迁移说明，避免同一字号别名存在两个定义来源。
- 业务移动 CSS 已清除颜色字面量、原始色板、废止 token、裸安全区、裸大 z-index、裸时长、网格外间距、负边距和常态虚线边框；原有 339 处 `--fc-space-*` 直接引用已按等值映射收口到五档移动语义间距。
- 底部 Tab、公共列表卡、搜索框与分段控件的尺寸/间距改用语义 token；普通移动按钮继续使用胶囊形状。
- 页面 `.tsx` 均不超过 800 行；AI 页面已拆出类型、视图转场和 API Key 可用性 hook。

### 2.2 可读性、触控与语义

- iOS/Android 默认移动正文与输入统一为 17px，桌面字号不变。
- 所有移动 `button`、`role="button"`、`summary` 统一获得至少 48×48 的命中区；Input 内部组合按钮保留例外。
- 仍需阅读的三级文字与 placeholder 提升到可读文本基线。
- app_main 自有的搜索、编辑与 AI 输入补齐持久 `aria-label`；移动编辑器的用户字号设置在输入控件上以 17px 为下限。
- 当前 Tab、AI 思考开关、插件筛选、AI 会话、词条候选等选中状态补齐 `aria-current`、`aria-pressed` 或 `aria-selected`；当前 Tab 额外用字重变化，不再只靠颜色。
- 未开放的相机、图库和世界地图入口为真实 `disabled` 状态，原因持续可见并进入可访问名称。

### 2.3 安全区、系统设置与平台差异

- 业务 CSS 只读取 `--mobile-safe-*`；iOS 使用 `env()`，Android 由 `WindowInsets` 写入原生 inset，再由同一 token 取最大值。
- Android 已取消竖屏锁；两端共享横竖屏布局规则。
- iOS 原生桥把 Dynamic Type 缩放和“降低透明度/加深系统颜色”映射到共享 CSS 环境；Android 使用 `Configuration.fontScale` 与高对比度设置完成对应映射。
- iOS 和 Android 系统栏均跟随应用内 `data-theme`，不单独跟随系统主题。
- 两端原生桥统一提供成功、警告、选择三种触觉语义；移动 Tab 切换已接入选择反馈。
- iOS 保留自绘、跟手的左边缘返回；Android 改用系统预测式返回的开始/进度/取消/提交回调，并复用同一双层页面转场呈现。
- 所有动效使用统一时长/曲线并提供 Reduced Motion 降级。

### 2.4 软键盘与底部 Tab

- 输入/编辑期间，Tab 同时退出视觉、点击与辅助技术树；普通输入在系统收起键盘后恢复，整页编辑仍需先退出编辑态。
- 壳层不再把 `visualViewport.height` 写回根节点，避免 WebView 已避让键盘后再二次压缩页面。
- 针对部分 WebView“先缩短 viewport、后派发 focus”的顺序，输入会话使用最近一次无键盘完整高度作为基准；聚焦期间低频补采样，覆盖系统收起键盘却漏发 `resize` 的情况。
- iOS 模拟器中已验证：键盘打开时 Tab 隐藏；通过系统菜单收起键盘、输入框仍保持焦点时，四个 Tab 在稳定期后恢复。证据见 `designs/audits/ios-input-viewport-2026-08-18/07-home-keyboard-visible-final.png` 与 `08-home-keyboard-dismissed-tab-restored-final.png`。

## 3. 自动检查

`src/app/mobile/mobileUiBaseline.test.mjs` 与移动壳层专项测试固定以下红线：

- 业务 CSS 无颜色字面量、原始色板、裸安全区、废止 token、裸大 z-index、第三档阴影、裸动效、裸像素/小数 rem 间距、负边距和常态虚线边框。
- 字号、字重、行高与动效只消费移动语义 token。
- 每个带动效的移动 CSS 文件提供 Reduced Motion 降级。
- 横向滚动区具备手势豁免属性。
- 输入模式、双端系统环境桥、系统栏主题、触觉语义和 Android 预测式返回均有静态回归。

## 4. 验证矩阵

| 项目 | 结果 | 边界 |
|---|---|---|
| `npm run test:mobile-shell` | 34/34 通过 | 纯状态、静态契约与移动壳层 |
| `npm run lint` | 通过 | app_main 前端 |
| `npm run build` | 通过 | TypeScript + Vite 生产构建 |
| iOS simulator debug 原生构建 | 通过 | 最低链接目标 iOS 16.2；运行设备 iPhone 17 Pro / iOS 26.5 |
| iOS 键盘打开/系统收起截图 | 通过 | 输入焦点保留时 Tab 恢复 |
| iOS 深色系统栏截图 | 通过 | `designs/audits/mobile-platform-contract-2026-08-18/01-ios-dark-system-bars.png` |
| Android debug APK + ADB | 未验证 | 当前主机未安装/配置 Android SDK、NDK 与 Java 环境；不能用代码共用代替运行证据 |
| 桌面原生回归 | 未执行 | 移动样式限定 touch density；仍需发布前做一次桌面冒烟 |

## 5. 留给产品负责人的决策

以下项目不存在唯一机械答案，继续修改会改变信息架构或产品行为：

1. **每屏最多两种容器样式**：逐屏决定哪些卡片保留 raised 容器，哪些改为留白 + 分隔线；不能只按选择器批量删阴影。
2. **重复副标题删减**：确认哪些说明属于必须保留的限制/状态，哪些只是标题复述。
3. **空状态主操作**：决定“新建世界/词条/对话”等操作放在空状态内部、顶栏，还是两处同时保留。
4. **移动端分页策略**：主页世界列表和插件列表改为连续滚动、显式“加载更多”还是分段加载；这会影响数据请求、位置恢复和失败重试。
5. **常驻提示条策略**：哪些提示随上下文消失，哪些允许永久关闭，以及关闭状态保存到哪里。
6. **首屏信息密度**：统一区块间距和更大字号后，决定各页首屏优先展示什么；不能为追求“多露一点内容”重新引入小字号和网格外间距。

上述决策之外，iPad regular-width 自适应壳层已有独立的 IOS-017 方向决策，但它是后续功能布局工程，不属于本次尺度/结构基线的机械迁移。

## 6. 尚需人工/设备验收，但不需要重新做产品决策

- Android：debug APK + ADB 验证 WindowInsets、键盘开合、系统栏、系统字号/高对比度、触觉和预测式返回。
- iPhone 真机：第三方键盘、横屏、触觉、最大辅助字号、降低透明度与 VoiceOver 全流程。
- iPad：全屏、Split View、Stage Manager 和外接键盘；IOS-017 实现完成后执行。
- 逐页视觉矩阵：浅/深色、默认/最大辅助字号、竖/横屏、空/加载/错误/有数据。
