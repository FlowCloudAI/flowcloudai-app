# 移动端软键盘布局接管方案

> 状态：现行 ｜ 日期：2026-08-23 ｜ 适用：`app_main` 移动端
>
> 本文是**方案说明**（该怎么写、边界在哪）。「当初踩了什么坑、怎么测出来的」是开发记录，
> 见工作区根 [`docs/devlog/2026-08-23-android-软键盘布局接管.md`](../../docs/devlog/2026-08-23-android-软键盘布局接管.md)。
> 真机证据在 [`designs/audits/android-键盘布局-2026-08-23/`](../designs/audits/android-键盘布局-2026-08-23/)。

## 1. 目标形态

移动端外壳是「固定顶栏 + 内部滚动区 + 常驻输入区 + 底部 Tab」。软键盘弹出时要求：

1. 固定顶栏**绝不**离开屏幕；
2. 键盘只压缩内部区域，外壳本身不移动、不缩放；
3. 常驻输入区贴在键盘上沿；
4. 底部 Tab **被键盘盖住**，不占用键盘上方任何空间；
5. 键盘上方不露出下层；
6. 跟随系统键盘，不出现「先错误抬升再回弹」；
7. 真手指点击必须可靠唤起键盘——**最高优先级，任何降低唤起率的做法一律否决**；
8. 长输入框与底部输入框都要满足以上各条。

## 2. 当前落地范围

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| Android | **已启用** | 纯前端，无原生代码 |
| iOS | **未启用，留接缝** | `--fc-kb` 恒为 `0px`，布局退化成启用前的行为，零回归 |

页面范围：**AI 聊天页**（`MobileAiChat`）与**灵感页**（`MobileIdea`）。其余移动端页面未接入。

**已在真机验收**（Xiaomi 24129RT7CC / Android 16 / WebView 143，2026-08-23）。两页实测：

| | AI 聊天页 | 灵感页 |
| --- | --- | --- |
| `visualViewport.offsetTop` | 0 | 0 |
| 需求1 顶栏（屏幕坐标） | `[40, 100]` 可见 | `[40, 100]` 可见 |
| 需求2 内区被压缩 | — | 编辑区底 `521.5` = 键盘顶 |
| 需求3 输入区缝隙 | **0**（贴合） | 无常驻输入区 |
| 需求4 Tab顶 − 键盘顶 | **+205**（被盖住） | **+205**（被盖住） |

键盘高 312.92，键盘顶在 521.5。

## 3. 实现结构

### 3.1 唯一入口是一个 CSS 变量

键盘遮挡高度写在 `documentElement` 的 `--fc-kb` 上，布局只吃这一个变量。

**不走 React state。** 逐帧 `setState` 会把布局更新压进 React 调度，这正是「跟不上键盘」最常见的自制原因。
写 CSS 变量则由样式系统直接驱动合成。

### 3.2 复用已有的保留高度变量，不新建一套

外壳早已具备本方案需要的两个前提：

- `.mobile-nav` 是 `position: absolute; bottom: 0`——它本来就在屏幕底部，能被键盘盖住（需求 4）；
- 所有需要避让 Tab 的地方都读同一个 `--mobile-nav-reserved-height`。

因此**接入方式是在页面根上重定义这个变量**，而不是给每个元素加键盘偏移：

```css
.mobile-ai-chat,
.mobile-idea {
    --mobile-keyboard-extra: max(var(--fc-kb, 0px) - var(--mobile-nav-height), 0px);
    --mobile-nav-reserved-height: calc(var(--mobile-nav-height) + var(--mobile-keyboard-extra));
}
```

`--mobile-keyboard-extra` 是「键盘比 Tab 保留高度多出来的部分」。键盘收起时它是 `0`，
`--mobile-nav-reserved-height` 退化成 `--mobile-nav-height`，与接入前逐字等价。

这样做的收益：`.mobile-ai-chat__composer { bottom: var(--mobile-nav-reserved-height) }`、
`.mobile-nav-safe-fixed { padding-bottom: var(--mobile-nav-reserved-height) }` 等**既有声明一行都不用改**，
现有断言这些声明的测试也继续通过。

### 3.3 只有绝对定位的滚动区需要额外补 `--mobile-keyboard-extra`

普通流内容被父级 padding 缩短即可；**绝对定位元素不会停在 padding 上方**，
用固定 rem 预留空间的滚动区也不会自动跟着变。AI 聊天页的消息列表两者都占，所以要显式加：

```css
.mobile-ai-chat__messages {
    padding-bottom: calc(var(--mobile-ai-composer-space) + var(--mobile-keyboard-extra));
    scroll-padding-bottom: calc(var(--mobile-ai-composer-space) + var(--mobile-keyboard-extra));
}
```

灵感页不需要：`.mobile-idea` 带 `mobile-nav-safe-fixed`，正文 `textarea` 是 `flex: 1 1 auto`，
父级 padding 变大它自然缩短。

### 3.4 聚焦时必须先让位，否则视觉视口会被平移（**最关键的一条**）

真机实测：聚焦一个位于「键盘弹出后可视区」之下的输入框时，Chromium 会**平移视觉视口**去露出它——
`visualViewport.offsetTop` 从 `0` 跳到 `312.9`，而页面里**所有元素的 `getBoundingClientRect()` 一动不动**。
后果是固定顶栏被推出屏幕上方（布局 `y=40` − `312.9` < 0）、底部 Tab 被抬到键盘正上方，
正是需求 1 和 4 的失败形态。**它与本方案是否写 inset 无关**，关掉整个特性照样发生，是应用的既有行为。

这次平移**收不回来**。以下均实测无效，`offsetTop` 恒为 `312.9`：

- `window.scrollTo(0, 0)`
- `document.scrollingElement.scrollTop = 0`
- 给 `html, body` 加 `overflow: hidden`（实验页有这条，一度以为是它免疫的原因，实测证否）

**唯一可行的是让它压根不发生**：预先把 `--fc-kb` 置成键盘高度、让输入区落进将来的可视区，
再真手指点击，`offsetTop` 全程为 0。所以 `focusin` 时就按**上次学到的**键盘高度乐观让位
（`predictMobileKeyboardInset()`），等真实高度到达再校正。

两条约束：

- **没学到高度就不让位**——宁可这一次被平移，也不猜一个值。所以一台设备**首次**聚焦仍会平移一次，
  之后按视口高度分键持久化（`fc-mobile-kb:<innerHeight>`），转屏/分屏各学各的。
- **必须有宽限期回退**（`PREDICTION_GRACE_MS`）：只聚焦不弹键盘（接了硬件键盘等）时，
  超时后退回 `0`，否则布局会一直空让一块。

### 3.5 高度来源与平滑

`--fc-kb` 由 `mobileKeyboardInset.ts` 写入，数值来自 `useMobileInputMode` 已有的
`getMobileViewportState().keyboardInset`——**不新写一套测量**，那套已有 Node 测试覆盖。

两个方向的处理**不对称**，这是实测结论不是偏好：

| 方向 | 处理 | 依据 |
| --- | --- | --- |
| 升起 | CSS 过渡（默认 250ms ease-out） | `focusin → visualViewport.resize` 实测 60~75ms，而 IME 滑入约 200~300ms，拿到终值时键盘还在动，过渡有对齐余地 |
| 收起 | **直接吸附，无过渡** | 拿到 `0` 时键盘早已消失，过渡纯粹是滞后 |

「变矮但没到 0」（候选栏收掉、换小键盘）同样吸附：滞后会让布局比真实键盘高，读起来像输入区莫名变厚。

### 3.6 iOS 的接缝在哪

`mobileKeyboardInset.ts` 的 `setMobileKeyboardInsetEnabled(os === 'android')` 是唯一的平台开关。
iOS 转正时**只需把这个判断放开并提供 iOS 的高度来源**，页面 CSS 一行都不用动。

## 4. 平台差异（改之前必读）

### 4.1 为什么 Android 能这么简单

- WebKit 的自动键盘避让（`_adjustForAutomaticKeyboardInfo`）会把外层 scrollView 的
  `adjustedContentInset.bottom` 与 `contentOffset.y` 一起设成键盘高度，`position: fixed` 不跟随 → 顶栏离屏。
  **Chromium 没有这段代码**，实测滚动量全程为 0。
- `targetSdk 35+` 强制 edge-to-edge 后 IME **不 resize 窗口**，布局视口恒为全屏高，
  所以「Tab 在屏幕底部被盖住」天然成立。

### 4.2 为什么 iOS 不能直接照抄

同一份 CSS 在 iOS 上会**复现顶栏离屏**：WebKit 已经把整页顶上去了，页面再让出一个键盘高度就是双重补偿。
iOS 要启用，前置条件是先摘掉 WKWebView 的键盘观察者（实验代码在 `src-tauri/ios/Sources/MobileUiBridge.m`，尚未转正）。

### 4.3 不要再动的东西

- **`interactive-widget`**：两端真机实测三个取值都不产生差异，iOS 上 WebKit 根本没实现。不要为键盘问题改它。
- **VirtualKeyboard API**：`navigator.virtualKeyboard` 在 Tauri 的 Android WebView 里**存在但失效**——
  `overlaysContent = true` 写入被接受，但 `env(keyboard-inset-height)` 与 `boundingRect` 恒为 0、`geometrychange` 不触发。
- **逐帧跟随**：Chromium 只在 IME 落位后上报一次高度，Web API 层面做不到逐帧。要逐帧只能接原生
  `WindowInsetsAnimationCallback`。

## 5. 红线

- **禁止**在 touch 路径（`touchstart` / `pointerdown` / `mousedown`）里调用 `focus()`、`focus({preventScroll})`
  或 `preventDefault()`。这会打断「可信手势 → 聚焦 → 唤起输入法」，直接损害需求 7。
- **焦点存在 ≠ 键盘可见**：键盘被收起时焦点仍在，接硬件键盘则有焦点无键盘。
  **不要用焦点状态代理键盘状态**，唤起率统计也必须按点击计数而不是按 `focus` 计数。
- 新增页面接入时**只重定义 `--mobile-nav-reserved-height`**，不要给具体元素散写键盘偏移。

## 6. 验证

```bash
cd app_main
npm run lint && npm run build
npm run test:mobile-shell
```

真机（Android）：`npm run android:dev:device`，然后在 AI 聊天页与灵感页分别确认——
顶栏不动、输入区贴键盘上沿、Tab 被盖住、长正文可滚到底、收起无滞后。

判据要看**屏幕坐标**而不是布局坐标：`rect.top − visualViewport.offsetTop`。
只看 `getBoundingClientRect()` 会得到「一切正常」的假象——视觉视口被平移时元素布局坐标根本不变。

> 原生侧未改动时，可以跳过 `cargo`：起 `TAURI_ENV_PLATFORM=android npx vite`、
> `adb reverse tcp:5176 tcp:5176` 与 `tcp:1422`，让设备上已装的 dev APK 直接加载新前端。
> `chrome://inspect` 或 `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` 可拿到完整 DevTools。

## 7. 未覆盖项

- **需求 6 只做到「一步到位 + 升起平滑」**，不是真正的逐帧跟随（见 §4.3）。
- **需求 7 未做真手指压测**：既有数据全部来自 `adb shell input tap` 注入，不能作为唤起率证据。
- **首次聚焦仍会被平移一次**（还没学到键盘高度），第二次起正常。
- 灵感页正文与键盘之间仍留有约 48px：`.mobile-idea__editor` 的 `--mobile-safe-bottom` 在键盘遮住导航栏时
  其实不必再预留。属于观感打磨，不违反需求。
- 输入法只验证过讯飞（MIUI 版），搜狗未测；只验证过三键导航，全面屏手势未测。
- 只接入了 AI 聊天页与灵感页；含输入的 Bottom Sheet、词条沉浸编辑等未接入。
