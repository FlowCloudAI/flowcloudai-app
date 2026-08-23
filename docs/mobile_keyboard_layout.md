# 移动端软键盘布局接管方案

> 状态：Android 已验收；iOS 已正式接入、待业务页真机验收 ｜ 日期：2026-08-24 ｜ 适用：`app_main` 移动端
>
> 本文描述当前架构、兼容边界与验收标准。2026-08-23 纯前端预测方案的真机录屏保留在
> [`designs/audits/android-键盘布局-2026-08-23/`](../designs/audits/android-键盘布局-2026-08-23/)，
> 仅用于说明历史问题，不再代表现行实现。

## 1. 结论

Android 软键盘高度由原生 `WindowInsetsCompat.Type.ime()` 提供；iOS 由
`UIKeyboardWillChangeFrameNotification` 提供目标、时长与曲线，零时长收起再临时读取
`keyboardLayoutGuide`。前端统一只消费原生发布的遮挡高度 `--fc-kb`，不改变 WebView/应用根几何。

这条路径同时解决两个问题：

- 旧 WebView 不需要 `visualViewport`、VirtualKeyboard API 或 Chromium 的后续修复；
- 新 WebView 收到的 IME inset 被归零，不会再自行缩短、滚动或平移视觉视口，与旧版本保持同一语义。

键盘布局只有一个 owner：**Android 原生负责测量和时序，页面内部布局负责消费。**
禁止再叠加 WebView 自动避让、前端高度预测、根节点 transform 或第二套键盘动画。

键盘布局仍只有一个 owner，但原生来源按平台互斥：Android 安装 Insets 适配器，iOS 安装 UIKeyboard
适配器，浏览器/旧桥只用 `visualViewport` 判断输入态而不写布局。iOS 不能复用 Android 的 Insets
拦截代码，因此两端的原生实现与验收状态仍必须分开记录；详见 §7。

## 2. 产品目标

移动端外壳是「固定顶栏 + 内部滚动区 + 常驻输入区 + 底部 Tab」。停靠软键盘展开时要求：

1. 固定顶栏不离开屏幕；
2. WebView 与应用外壳保持全屏，不整体移动或缩短；
3. AI 消息区缩短，composer 贴在键盘上沿；
4. 灵感正文缩短并由 textarea 内部滚动；
5. 底部 Tab 保持在机器底部并被键盘覆盖，不出现在键盘上方；
6. 空消息态没有伪滚动，用户拖动时页面不抖；
7. 输入区只随系统报告的实际 inset 变化，不出现预测造成的先上跳再回落；
8. touch/pointer 路径不改写焦点，真手指点击必须可靠唤起输入法。

## 3. 现成方案调研

### 3.1 CatGo 与 HuLa 证明了原生 Insets 路径

[CatGo Android 说明](https://github.com/Hello-QM/catgo-LRG/blob/main/deploy/android/README.md) 与
[HuLa MainActivity](https://github.com/HuLaSpark/HuLa/blob/master/src-tauri/gen/android/app/src/main/java/com/hula/app/MainActivity.kt)
都使用：

- Manifest 设置 `android:windowSoftInputMode="adjustResize"`；
- `WindowInsetsCompat.Type.ime()` 读取系统实际键盘高度；
- 原生根视图根据 IME 高度调整布局。

这证明 Tauri Android 可以绕开 WebView 版本差异，由系统 Insets 提供键盘高度。CatGo 还把原生
`MainActivity.kt` 保存为 canonical override，避免 `tauri android init` 覆盖修改。

但两者都把 IME 高度作为 `android.R.id.content` 的 bottom padding，等于缩短整个 WebView。
这会把 app_main 的底部 Tab 一起抬到键盘上方，违反 §2；它们也只处理终点式 Insets，没有覆盖
app_main 要求的内部区域所有权，因此不能原样复制。

### 3.2 Tauri 没有统一默认值

[Tauri PR #13277](https://github.com/tauri-apps/tauri/pull/13277) 仍未合并。维护者明确指出，缩小整个
WebView 是否合适必须由应用自行决定，因为并非所有页面都能承受键盘展开后的窄 WebView。

因此 app_main 不等待 Tauri 默认行为，也不把 `adjustResize` 当作完整解决方案；它只用于保证旧 Android
能够可靠派发 IME Insets，实际 WebView 几何仍由 app_main 明确控制。

### 3.3 rust-expo-example 不属于同一运行模型

[rust-expo-example](https://github.com/RohitLuthra19/rust-expo-example) 的 Android/iOS 由 Expo/React Native
运行，Tauri 只包装桌面 Web 构建。它不经过 Tauri Android WebView，不能作为本问题的实现依据。

## 4. Android 实现结构

### 4.1 原生读取实际 IME Insets

`MainActivity.configureMobileWindowInsets()` 在 `window.decorView` 上安装两条互补路径：

- `OnApplyWindowInsetsListener`：提供初始值和配置变化后的稳定值；IME 动画期间，它提前送达的终点只用于
  拦截下发，不发布给页面；
- `WindowInsetsAnimationCompat.Callback.onProgress()`：发布键盘动画的实际中间帧。

动画结束后再从 root Insets 确认终值。这样不会把 `onApplyWindowInsets` 的终点与 `onProgress` 的中间帧
交错成“终点 → 中间帧 → 终点”，也就是本轮概率性先跳后回的直接时序原因。

原生保留系统栏与刘海 Insets 的既有处理，只把 IME 高度转换为 CSS 像素。相同数值不重复发布，
同一帧内多次变化会合并到下一次 `postOnAnimation`，避免把 JavaScript 调用堆进 UI 线程队列。

Manifest 保留 `adjustResize`。AndroidX 官方说明，在 API 29 及以下，如果窗口不是
`SOFT_INPUT_ADJUST_RESIZE`，IME 变化可能不会触发 Insets listener；因此该声明是 API 26 最低版本的
兼容条件，不代表允许系统缩短 WebView。

### 4.2 WebView 不再接收 IME Insets

原生读取 IME 后，通过 `WindowInsetsCompat.Builder` 把传给子层的 `Type.ime()` 设为 `Insets.NONE`。
系统栏和刘海仍正常下发。

这一步统一 WebView 行为：

- M139 以前的 WebView 本来不会用 IME 改 visual viewport；
- M139+ 新增的 visual viewport resize 被显式关闭；
- M144 的 `focus({preventScroll:true})` 修复不再是前置条件；
- WebView 认为自身仍是完整全屏视口，焦点元素不会因为“键盘后的窄可视区”触发二次平移。

Android 官方说明：原生消费某类 Insets 后应把该类型归零再传给 WebView，避免双重 padding；若要退出
现代 WebView viewport resize，也必须在 Insets 进入 WebView 前拦截。参见
[Understand window insets in WebView](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets)。

### 4.3 原生桥只发布状态，不改 WebView 尺寸

Android 注入的 `flowcloudaiMobileUi` 暴露当前 IME 高度与可见性，动画期间调用固定的全局接收函数。
前端桥未安装时，原生仍保留最新快照；React 挂载后会立即读取，不依赖某个事件是否碰巧发生。

原生禁止：

- 给 `android.R.id.content` 或 WebView 增加 IME padding；
- 修改 `layoutParams.height`、`translationY` 或 WebView frame；
- 同时让 WebView resize 再给前端发布同一高度。

历史上“先应用最终高度、再按动画帧改 WebView 尺寸”会让原生布局、WebView viewport 和网页重排竞争，
即使终点正确，动画仍会剧烈抖动。

## 5. 前端消费规则

### 5.1 唯一布局输入是 `--fc-kb`

`mobileKeyboardInset.ts` 接收原生快照并直接写：

```ts
document.documentElement.style.setProperty('--fc-kb', '<actual inset>px');
```

不走 React state；React 只订阅“键盘是否可见”以维护返回键/输入模式状态。布局变化由 CSS 变量直接完成。

若运行在旧 APK、浏览器预览或桥尚未就绪，输入模式判断可以继续用 `visualViewport` 兜底；**兜底值不得写入
`--fc-kb`**，避免旧问题重新成为布局路径。

### 5.2 页面只重定义已有保留高度

AI 聊天页与灵感页继续复用现有 `--mobile-nav-reserved-height`：

```css
.mobile-ai-chat,
.mobile-idea {
    --mobile-keyboard-extra: max(var(--fc-kb, 0px) - var(--mobile-nav-height), 0px);
    --mobile-nav-reserved-height: calc(var(--mobile-nav-height) + var(--mobile-keyboard-extra));
}
```

键盘收起时 `--fc-kb = 0px`，布局退化到正常 Tab 保留高度。键盘展开时：

- `.mobile-nav` 仍绝对定位在机器底部，被系统键盘覆盖；
- AI composer 的 `bottom` 变为实际键盘高度；
- `mobile-nav-safe-fixed` 的内部可用空间按相同高度缩短；
- 灵感 textarea 在 flex 容器中缩短并保持内部滚动。

### 5.3 消息列表不能重复消费键盘高度

AI 页父级 padding 已经按 `--mobile-nav-reserved-height` 缩短，composer 也按同一变量定位。因此消息列表只
预留 composer 自身高度：

```css
.mobile-ai-chat__messages {
    padding-bottom: var(--mobile-ai-composer-space);
    scroll-padding-bottom: var(--mobile-ai-composer-space);
}
```

空消息态关闭纵向滚动并在消息区域使用 `touch-action: none`，但不得覆盖 composer/textarea 的可信聚焦路径。

非空消息区在键盘从关闭变为展开时读取既有 `autoScroll` 状态：只有用户原本位于底部跟随状态，才在
键盘动画缩短消息区的过程中继续把容器校正到 `scrollHeight`；用户已经上滑查看历史时不得抢回底部。
实现同时监听原生 Insets 帧、容器尺寸变化和 iOS CSS 过渡结束，旧 WebView 缺少 `ResizeObserver` 时仍可由
原生帧与过渡结束事件完成校正。禁止改用 `scrollIntoView`，避免滚动链把页面或视觉视口一起带动。

### 5.4 输入模式与布局测量分离

`useMobileInputMode` 仍负责：

- 文本焦点与整页编辑状态；
- 键盘出现后系统收起但焦点保留的状态转换；
- 返回键先退出输入模式；
- iOS 与旧 APK 的 `visualViewport` 兜底检测。

它不再负责：

- 从 viewport 计算 Android 布局高度；
- 在 `focusin` 预测键盘高度；
- 写入 `--fc-kb`；
- 根据 `visualViewport.offsetTop` 移动 `.mobile-app`。

## 6. 已移除的历史方案

以下代码不得恢复：

- `fc-mobile-kb:<innerHeight>` 的 localStorage 高度学习；
- `predictMobileKeyboardInset()` 与 900ms 宽限期；
- 自演的 250ms `--fc-kb-transition`；
- `--fc-kb-pan`、`data-mobile-kb-pan` 与整壳 `translateY()`；
- 通过 `window.scrollTo()`、`scrollTop`、`overflow:hidden` 强拉 visual viewport；
- touch/pointer 事件里的 `focus()`、`focus({preventScroll:true})` 或 `preventDefault()`。

预测值先于真实键盘到达，命中时看似平滑，未命中时就会表现为输入框先跳到错误位置再回归；整壳 transform
则把页面滚动、视觉视口平移与 CSS 合成混在一起，是空消息态拖动抖动的直接放大器。

## 7. 平台边界

| 平台 | 布局高度来源 | WebView 行为 | 当前范围 |
| --- | --- | --- | --- |
| Android API 26+ / 任意 WebView | 原生 `WindowInsetsCompat.Type.ime()` | IME Insets 在进入 WebView 前归零，WebView 保持全屏 | AI 聊天、灵感 |
| iOS 16.2+ | `UIKeyboardWillChangeFrame`；零时长收起用 `keyboardLayoutGuide` | 摘掉 WKWebView frame 观察者，WebView 保持全屏 | 全移动壳层；AI/灵感为主验收页 |
| 浏览器预览/旧 APK/桥未就绪 | `visualViewport` 只用于输入模式兜底 | 不写 `--fc-kb`，不作为布局验收依据 | 静态测试 |

iOS 没有启用 Android 路径。`MobileApp` 把 `platformInfo.os` 映射为 `android | ios | null`，
`mobileKeyboardInset.ts` 每次只安装一个原生监听器；Android 回调不会写 iOS 的过渡变量，iOS 代码也不引用
`MainActivity.kt`。共享的只有 `--fc-kb` 与页面保留高度契约。

### 7.1 iOS 适用性结论

**结论：当前 Android 方案不能原样用于 iOS；能复用的是布局契约，不能复用的是平台接管机制。**

Android 能在 Insets 下发链路中读取 `Type.ime()`，随后把这一类 Insets 归零再交给 WebView。iOS 的公开
UIKit/WebKit API 可以测量键盘，但截至 2026-08-23，没有公开文档提供“在 WKWebView 接收键盘影响前，
只消费并清零键盘 inset”的直接等价接口：

- [`UIKeyboardLayoutGuide`](https://developer.apple.com/documentation/uikit/adjusting-your-layout-with-keyboard-layout-guide)
  能表示键盘占据的原生布局空间，并可用
  [`followsUndockedKeyboard`](https://developer.apple.com/documentation/uikit/uikeyboardlayoutguide/followsundockedkeyboard)
  跟随浮动键盘；它适合约束 UIKit 视图，却不会自动关闭 WKWebView 内部的聚焦元素 reveal / 视觉视口平移；
- [`UIKeyboardWillChangeFrameNotification`](https://developer.apple.com/documentation/uikit/uiresponder/keyboardwillchangeframenotification)
  提供起止 frame、时长和曲线，属于动画前通知，不是与键盘像素逐帧同步的 frame 流；
- WebKit 的 [`interactive-widget`](https://bugs.webkit.org/show_bug.cgi?id=259770) 与
  [`VirtualKeyboard API`](https://bugs.webkit.org/show_bug.cgi?id=230225) 仍未实现；WebKit 还记录了 iOS 26
  WKWebView 在根节点不可滚动时仍平移视觉视口的
  [未解决问题](https://bugs.webkit.org/show_bug.cgi?id=311821)；
- iOS 26 新增的
  [`WKWebView.obscuredContentInsets`](https://developer.apple.com/documentation/webkit/wkwebview/obscuredcontentinsets)
  用于声明被客户端工具栏等 UI 遮住的区域并缩短 layout viewport。它不覆盖本项目 iOS 16.2 最低版本，
  官方语义也不是关闭系统键盘的自动 focus reveal，因此不能作为旧系统兼容方案；
- `setMinimumViewportInset:maximumViewportInset:` 从 iOS 15.5 可用，但它描述外围 UI 的最小/最大状态，
  为 `sv*` / `lv*` 提供范围，不是动态键盘接管接口。

本仓 iPhone 15 Pro / iOS 26.6 的真实 WKWebView 探针也验证了差异：布局视口不变，视觉视口缩短，WebKit
会为聚焦元素平移整页；`interactive-widget` 三种取值均被忽略，`navigator.virtualKeyboard` 不存在。
直接缩短 `WKWebView.frame` 虽可阻止平移，却会移动整套 WebView 几何，并已在后续真机实现中出现双重消费、
键盘呼出中断等回归后被撤销。详见
[`designs/audits/mobile-keyboard-probe-2026-08-20/`](../designs/audits/mobile-keyboard-probe-2026-08-20/)
与 [`designs/ios-mobile-hig-gap-audit.md`](../designs/ios-mobile-hig-gap-audit.md#ios-005键盘布局曾依赖-webview-推断页面与-tab-无法稳定分配空间)。

仓库仍保留 `src/lab/ios` 专用探针，用于对照逐帧推送、夹紧 scroll view、缩短 WKWebView frame 等失败或
诊断方案。它与正式 `FCAKeyboardInsetCoordinator` 分离；正式业务页不会启动实验采样，也不会刷 `FCKB`
轨迹。实验处理器只有收到实验页命令后才置为 active，保留真机复盘能力而不占用生产键盘事务。

正式接入仍有明确风险：移除 WebKit 观察者依赖 WKWebView 当前通过 `NSNotificationCenter` 注册这组通知的
实现事实，运行期不可逆，并不是 Apple 提供的“关闭键盘避让”开关。因此代码可覆盖 iOS 16.2，不等于已经
证明所有 16.2 WebKit 构建都一致；最低系统真机仍是发布闸门。

### 7.2 2026-08-24 iOS 真机实验结果

设备为 iPhone 15 Pro（`iPhone16,1`）/ iOS 26.6，入口为 `VITE_LAB` 专用测试页。最终候选维持全屏
`WKWebView`，不缩短 `webView.frame`，并采用以下单一布局 owner：

1. 从 viewport meta 删除未被 WKWebView 识别的 `interactive-widget`，旧 WebView 不再以它作为前提；
2. 移除 WKWebView 自带的键盘 frame 观察者，并把外层 scroll view 的 inset 行为设为 `never`，阻止顶栏、
   Tab 和整个页面一起被平移；
3. 展开阶段消费 `UIKeyboardWillChangeFrame` 的实际目标高度、系统时长与曲线，由页面只写一个 `--fc-kb`；
4. 交互式收起等 `duration=0` 场景临时使用 `keyboardLayoutGuide` 逐帧兜底；
5. 收到 `UIKeyboardDidHideNotification` 后无条件把 `--fc-kb` 归零并重新标定探针，避免底部遮挡填充块残留。

项目负责人在同一真机上比较“不处理”、`visualViewport`、原生事件和原生逐帧后，确认**原生事件效果最好**。
当前实验轮次还实际暴露并修复了三类问题：默认未启用候选导致顶栏和 Tab 随 WKWebView 平移；
`interactive-widget` 被忽略的控制台警告；键盘收起后最后一个非零探针帧导致遮挡块不消失。

这项结果只验收了实验页候选和当前系统键盘，不自动等同于正式业务页、iOS 16.2、第三方输入法、外接键盘或
iPad 浮动键盘已经通过。

### 7.3 iOS 正式接入结构

2026-08-24 已按“全应用共享 WKWebView 接管”接入正式移动壳层，而不是进入 AI/灵感时才临时打开：

1. `FCAMobileUiMessageHandler` 接收 `{type:'keyboard', value:'enable'}`，把当前 `message.webView` 交给
   `FCAKeyboardInsetCoordinator`；
2. coordinator 把外层 `contentInsetAdjustmentBehavior` 设为 `never`，并只移除 WKWebView 的
   WillShow/WillHide/WillChange/DidChange frame 观察者；保留 DidShow，让 WebKit 继续兑现焦点元素 reveal；
3. 展开阶段发布 `UIKeyboardWillChangeFrame` 的目标、duration 与 curve。页面使用真机拟合过的 curve 7，
   并把实际事务时长写入 `--fc-kb-transition`；
4. duration 为 0 时不把目标瞬间写到底，而由 `keyboardLayoutGuide` 的 presentation frame 临时跟随；
   DidHide 永远强制归零，随后重新标定 iOS 16 上可能不为 0 的 guide floor；
5. `mobileKeyboardInset.ts` 维护单一快照供输入模式订阅，CSS 变量仍直接写 document root，不经 React state。

UIKit 在真机上曾短暂报告 `143 → 587 → 401.7`、`401.7 → 629.7 → 401.7` 的瞬时目标。iOS 分支沿用实验页
验证过的“稳定目标上限”：只把连续 220ms 未被新目标替换的系统实测值记为可信上限，并按窗口高度保存；
这不是 Android 的焦点前预测，也不会在键盘通知前抬升页面。Android 分支既不读取该值，也不写
`--fc-kb-transition`。

页面分配如下：

- AI/灵感继续复用原有 `--mobile-nav-reserved-height`，composer、消息区和 textarea 不新增平台分支；
- iOS 普通 `.mobile-page` 在同一个变量下获得可滚到键盘上方的尾部空间；
- Portal 的 floating/sheet 浮层在 iOS 下缩到键盘上方，覆盖 AI 更多设置与项目表单；
- 沉浸正文编辑器保留自己已有的 `visualViewport` 内层工作区 owner，外层 Overlay 不再叠加 `--fc-kb`，
  避免二次缩短；
- Android 不命中 iOS 数据属性选择器，`MainActivity.kt`、Insets 拦截和已验收的 AI/灵感范围均未修改。

### 7.4 iOS 当前验证边界

正式代码已经通过 18 项键盘专项测试、ESLint、TypeScript/Vite 生产构建，以及以最低部署目标
`arm64-apple-ios16.2-simulator` 进行的 Xcode debug 编译。该结果证明接口、前端布局和 Objective-C 可构建，
**不等于 iOS 业务页交互已经验收。**

当前必须保留的发布闸门：

1. iPhone 15 Pro / iOS 26.6 上分别验收 AI 空/长消息、灵感短/长正文、AI 更多设置和至少一个普通设置输入；
2. 连续 20 次首次/重复展开与系统收起，确认顶栏坐标不动、输入区不先跳、DidHide 后 `--fc-kb=0`；
3. iOS 16.2 真机单独验证 observer removal 仍能压住 WKWebView 自动平移，不能用当前系统代替；
4. 覆盖第三方输入法、候选栏变化、交互式收起、转屏、iPad 浮动/分离键盘和外接键盘；
5. Android 后续再做一次真机非回归；当前只能确认 Android 原生文件零改动、专项测试仍覆盖原 Insets 链路。

若某个旧 WebKit 不再通过这组通知实现自动避让，必须让 iOS 接管整体回退到 WebKit owner；不能在同一会话
同时保留 WebKit 平移和 `--fc-kb`。禁止用 frame resize、根 transform、预测聚焦高度或强拉 scroll 兜底。

## 8. 验证

静态与构建：

```bash
npm run test:mobile-shell
npm run lint
npm run build
```

Android 原生构建使用 `package.json` 中现行的 debug APK 脚本；最终必须安装到目标真机，不能用浏览器/Vite
空壳替代。至少覆盖：

1. Xiaomi / Android 16 / WebView 143 的首次聚焦与连续 20 次展开/收起；
2. AI 空消息、长消息、流式消息和切换会话；
3. 灵感短正文、长正文、光标在末尾和输入法候选栏高度变化；
4. 三键导航与全面屏手势导航；
5. 讯飞与至少一种第三方输入法；
6. 转屏、分屏、硬件键盘；
7. 键盘动画期间顶栏屏幕坐标稳定、composer 与键盘上沿无缝；
8. Tab 不出现在键盘上方，键盘收起后布局恢复；
9. 空消息态 `scrollHeight === clientHeight`、`scrollTop === 0`，连续拖动不抖；
10. 真手指点击可靠唤起键盘，不能只用 `adb shell input tap`。

通过前端测试或 APK 编译只证明代码可构建，不代表键盘动画已经验收。Android 官方也明确指出 API 29 默认
可能出现终点正确但动画不同步的跳变；逐帧行为必须看真实设备。参见
[Control and animate the software keyboard](https://developer.android.com/develop/ui/views/layout/sw-keyboard)。

### 8.1 2026-08-23 Android 真机诊断与验收结果

设备：Xiaomi 24129RT7CC / Android 16 / Android System WebView 143.0.7499.192 / ARM debug。

- 完整 Tauri debug 包已构建、安装并启动；Activity 为当前前台窗口，近期日志未出现 native/Chromium fatal；
- 原生快照终值为 `--fc-kb: 312.92px`，`visualViewport.height` 全程保持 `834.46px`、
  `offsetTop=0`、`scrollY=0`，说明 WebView 没有成为第二个键盘布局 owner；
- 展开终态 composer bottom 为 `521.54px`，恰好等于 `834.46 - 312.92`，与键盘上沿无缝；
- 单次独立展开采到 41 个变化点，`--fc-kb` 从 `0` 单调增加到 `312.92`；composer top 从
  `610.46px` 单调移动到 `405.54px`，没有反向回跳；
- 单次独立收起采到 40 个变化点，`--fc-kb` 从 `312.92` 单调减少到 `0`；composer top 单调回到
  `610.46px`，没有反向回跳；
- 空消息区在键盘展开后执行一次 ADB 上滑，顶栏、空状态与 composer 的终态位置未变化。

随后项目负责人在目标真机上完成实际触控验收，确认当前方案通过：键盘展开后的空消息态不再可滚动抖动，
输入框不再概率性先向上跳后回落。至此，本轮 Android 核心阻断问题在 Xiaomi / Android 16 / WebView 143
目标环境关闭；前述逐帧数据保留为验收结论的机制证据。

该验收不自动外推到第三方输入法、API 26～29 或真正的旧版 WebView。旧 WebView 的兼容性依据是“系统
Insets + JavascriptInterface，不依赖 WebView 键盘 API”的架构，仍需在可控旧设备补运行证据；§8 的完整
矩阵继续作为跨设备回归要求，而不是否定本次目标设备验收。

## 9. 当前未覆盖项

- iOS 的停靠键盘、浮动键盘与外接键盘空间所有权尚未重新设计；
- 含输入控件的 Bottom Sheet、词条沉浸编辑等 Portal 尚未接入 Android `--fc-kb`；
- API 26～29 的 Insets 动画由 AndroidX 兼容层提供，仍需低版本设备或模拟器验证；
- 原生逐帧 JavaScript 发布是否在低端设备掉帧，只能通过真机录屏/帧时间确认；
- 新原生路径已有 ADB/CDP 逐帧诊断和目标真机实际触控验收；尚未单独归档新版真机录屏。
