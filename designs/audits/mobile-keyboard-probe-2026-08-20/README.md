# 移动端键盘行为探针 · 2026-08-20

> 状态：归档 ｜ 日期：2026-08-20 ｜ 设备：iPhone 15 Pro / iOS 26.6（23G71）/ 应用自身 WKWebView

本目录是 2026-08-20 重新裁定「iOS 上键盘遮挡由谁消费」时的实测材料。
测量在应用真实的 WKWebView 内进行（临时把探针页换成 `index.html`），不是 Safari，也不是模拟器。

## 文件

- `mobile-keyboard-shell.html` — 移动端外壳的最小复现，只有布局、没有任何键盘逻辑，
  用作从零复现该需求的基线。它由完整探针页精简而来；带测量与补偿档位的完整探针
  保留在提交 `1c70b21` 的 `keyboard-probe.html` 中。
- `01-simulator-before-double-shrink.png` 等截图属于 `ios-inspiration-keyboard-2026-08-20`，不在本目录

## 实测结论（iOS 26.6）

1. `interactive-widget` 的 `resizes-content` / `resizes-visual` / `overlays-content` **三个值全部被忽略**：三种模式下 `clientHeight`、`vh`、`svh`、`lvh`、`dvh`、fixed 元素高度六个量零变化，`overlays` 下视觉视口仍缩短。
2. WebKit 的避让方式是**布局视口不变、视觉视口缩短、整页（含 `position: fixed`）平移**。平移量等于 `visualViewport.offsetTop`，也等于 `window.scrollY`，逐帧成立——**Web 层完全可观测，不需要原生桥**。
3. 平移不是「最小滚动到可见」，而是**把聚焦元素居中到未遮挡区，位移上限为键盘高度**；元素不被遮挡时位移为 0。
4. `env(keyboard-inset-height)` 不被识别，`navigator.virtualKeyboard` 不存在。
5. `env(safe-area-inset-bottom)` 在键盘升起时**不归零**，是「键盘上方有缝」的来源之一。
6. WKWebView 的 UA 被冻结为 `iPhone OS 18_7`，与真实系统版本无关，**不可用于判断 iOS 版本**。
7. 原生在 `keyboardWillChangeFrame` 里把 WKWebView 的 frame 收缩到键盘上方后，`offsetTop` 恒为 0、顶栏零位移、`safe-area-inset-bottom` 归零、`dvh` 跟随布局视口。

## 与历史提交的关系

结论 7 的做法在 `857464d`（2026-08-19 16:50）就已存在，`52148fc`（18:04）将其删除，随后 08-20 一整天的修复都在对付由此产生的 focus reveal。详见开发记录。
