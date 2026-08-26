# 公共顶栏材质实验室审计包

**状态**：归档
**日期**：2026-08-26

本包记录 `designs/mobile-topbar-material-lab.html` 的浏览器渲染、亮暗主题与真实 Android 顶栏截图对照。它验证的是实验室本身是否能可靠辅助材质调参，不替代应用真机验收。

> 后续边界：同日追加的新默认参数、顶栏/胶囊独立滤镜层与 JSON 粘贴导入没有重做视觉截图；按用户要求仅完成脚本语法、参数映射和校验逻辑检查。下方 `passed` 只对应本包截图所记录的初始版本。

## 证据

- [`design-qa.md`](design-qa.md)：设计 QA、交互验证与结论。
- [`topbar-comparison.png`](topbar-comparison.png)：真实 Android 顶栏与实验室亮色「当前实现」的同画面对照。
- [`implementation-light-full.png`](implementation-light-full.png)：亮色实验室全视图。
- [`implementation-dark-full.png`](implementation-dark-full.png)：暗色实验室全视图。
- [`implementation-light-phone.png`](implementation-light-phone.png)：亮色 390 × 844 模拟设备。
- [`implementation-dark-phone.png`](implementation-dark-phone.png)：暗色 390 × 844 模拟设备。
- [`comparison.html`](comparison.html)：生成同画面对照的可复核静态页面。

真实来源截图沿用 [`../mobile-entry-detail-rebuild-2026-08-26/android-恢复公共顶栏五段渐变-滚动态.png`](../mobile-entry-detail-rebuild-2026-08-26/android-恢复公共顶栏五段渐变-滚动态.png)。

## 结论

实验室的亮暗参数隔离、实时更新、三种滚动背景、预设、重置与 CSS / JSON 导出均通过浏览器验证；窄屏无横向溢出。设计 QA 最终结论为 `passed`。
