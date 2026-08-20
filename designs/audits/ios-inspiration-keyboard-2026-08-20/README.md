# iOS 灵感页键盘终态与视口所有权验证

> 问题、根因与修复过程见工作区根仓库 `docs/devlog/2026-08-20-ios-灵感页键盘终态与视口所有权.md`。本目录只保存可复核的界面证据与验收边界。

## 验证对象

- 应用：FlowCloudAI 移动端（`cn.flowcloudai.www`）
- 模拟器：iPhone 17 Pro / iOS 26.5
- 真机：FSZ 的iPhone（iPhone16,1）/ iOS 26.6
- 目标：灵感页固定外壳、正文 textarea 单一滚动所有权、有效停靠键盘隐藏 Tab、键盘收起但焦点保留时恢复 Tab

## 根因判据

修复前，键盘展开时 iOS 已经缩短 Web 布局视口，但原生指标仍声明 `viewportAdjusted:false`。共享 `.mobile-app` 再次预留同一份 `occludedBottom`，导致正文被压成顶部窄条，并在正文与键盘之间留下大块空白。去掉重复预留后，WebKit 的焦点滚动仍会平移 WKWebView 外层 document，把顶栏与元数据推出屏幕；最终版只在键盘稳定边界归零外层 offset，不改 textarea 内部滚动。

第三方键盘收起时还可能只产生 Hide 终态，或在 ChangeFrame 后留下很小的残余交集。旧桥接没有把 Hide 当作强制终态，延迟环境刷新可能重放旧 frame，Tab 因而保持隐藏。

## 截图证据

1. `01-simulator-before-double-shrink.png`：2026-08-20 修复前的模拟器复现；正文被压成顶部窄条，大块空间未被正文使用。
2. `02-simulator-after-keyboard-visible.png`：修复后系统键盘展开；顶栏与元数据固定，正文填满剩余空间，Tab 隐藏。由 XCUITest 通过可访问名称进入真实灵感页并聚焦正文后截取。
3. `03-simulator-after-keyboard-dismissed.png`：同一次焦点会话连接模拟器硬件键盘，使软件键盘收起但 textarea 焦点保留；Tab 恢复且正文回填，底部仅保留外接键盘附件栏。
4. `04-device-system-keyboard-visible.png`：待补；真机系统键盘展开状态。
5. `05-device-system-keyboard-dismissed.png`：待补；真机系统键盘收起但焦点保留状态。
6. `06-device-third-party-keyboard-cycle.png`：待补；真机第三方键盘完整展开—收起—再展开循环。

## 已完成的自动验证

- 键盘 store 与 iOS 原生桥契约：30/30 通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- `npm run ios:doctor`：必需项通过。
- `npm run ios:build:sim:debug`：通过。
- 灵感页 XCUITest：通过，能够定位“灵感”Tab、正文 TextView 和系统键盘；修复后截图确认顶栏与元数据未离屏。
- `npm run test:mobile-shell`：49/50；唯一失败是既有 AI 模式菜单两个局部字号 Token，本次未新增失败。
- 修复版已覆盖安装并启动到真机，未清除应用数据。

## 验收边界

当前代码、原生构建、模拟器安装和真机覆盖安装均完成；系统键盘、第三方键盘、前后台切换、横屏、外接键盘以及 AI/keyboard-aware Bottom Sheet 的人工交互结果，必须由目标设备实际操作后补录，不能由共享代码或构建成功代替。
