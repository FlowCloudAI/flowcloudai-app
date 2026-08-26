# 移动端词条编辑与图片布局复查（2026-08-26）

> **状态**：现行 ｜ **日期**：2026-08-26 ｜ **平台**：Android 真机
> **范围**：正文工具栏、键盘收起、长文光标跟随、编辑/预览状态、图片浏览器顶栏、编辑页主图高度

## 证据说明

本报告只使用本轮重新抓取并人工检查的真机截图。`before-*` 为修改前基线，`after-*` 为同路径复测。

## 修改前流程

| 步骤 | 健康度 | 证据 | 结论 |
| --- | --- | --- | --- |
| 1. 长正文查看 | 严重问题 | [before-01-detail-long.png](before-01-detail-long.png) | 页面是固定高 flex 滚动容器，但主图允许收缩；真机主图从预期比例压到约 `46.15 CSS px` 高 |
| 2. 打开图片浏览器 | 结构不一致 | [before-02-image-viewer.png](before-02-image-viewer.png) | 关闭、标题、计数和画廊组成独立顶栏，没有复用页面标准胶囊顶栏 |
| 3. 进入普通编辑 | 需调整 | [before-03-edit-closed.png](before-03-edit-closed.png) | “取消”占据标准返回位；键盘未打开时正文卡片仍以 `flex: 1` 占满剩余高度 |
| 4. 聚焦内联正文 | 健康参照 | [before-04-inline-keyboard.png](before-04-inline-keyboard.png) | 内联格式工具栏底边与键盘顶端贴合，说明原生 `--fc-kb` 终点正确 |
| 5. 系统收起键盘 | 部分健康 | [before-05-inline-dismissed.png](before-05-inline-dismissed.png) | 格式工具栏已经隐藏，但正文卡片仍约 `347.69 CSS px` 高，继续占满余下空间 |
| 6. 切换预览 | 用户报告需防回归 | [before-06-preview.png](before-06-preview.png) | 本轮终点计算样式里未选中的“编辑”为透明背景；仍需检查触控/焦点样式，明确禁止蓝色圆底 |
| 7. 全屏编辑 | 明确间距问题 | [before-07-immersive-gap.png](before-07-immersive-gap.png) | 工具栏容器底边实际贴住键盘，但底部有 `56 CSS px` 内边距，造成可见按钮离键盘约 182 物理像素 |
| 8. 在正文末尾换行 | 明确错位 | [before-08-caret-scroll.png](before-08-caret-scroll.png)、[before-09-caret-desync.png](before-09-caret-desync.png) | 连续换行后 textarea `scrollTop = 272`，高亮层仍为 `0`；光标与可见 Markdown 文本来自两套滚动位置 |

## 修改前判断

- 单纯调整键盘高度不该做：`--fc-kb = 312.92px`、`visualViewport.offsetTop = 0`、`scrollY = 0` 均正常，问题发生在编辑器内部布局。
- 长正文挤图和普通编辑占屏是两个独立 flex 约束：前者需要禁止展示页内容块被压缩，后者需要在键盘关闭时取消正文卡片的剩余空间占有。
- 光标错位不是“没有滚到底”这么简单：输入层确实滚动了，但语法高亮层没有同步，必须统一两层的滚动位置。
- 截图只能确认视觉和当前触控终点，不能单独证明读屏、键盘动画或所有输入法均通过。

## 已落地修正

- 键盘高度仍只由原生 `--fc-kb` 驱动；React 只订阅“键盘是否可见”这一离散语义，并与正文焦点组合后控制元数据折叠和内联工具栏显示。标题或摘要唤起键盘不会误收起自身，也不新增 WebView/根页面位移。
- 键盘收起后，正文卡片不再 `flex: 1` 吞掉全部剩余高度，恢复为最多 5 个移动触控高度的阅读窗口；页面本身允许在小屏或大字号下滚动。
- 全屏 Markdown 工具栏移除重复的底部安全区内边距。安全区和键盘遮挡继续由全屏外层唯一消费。
- 恢复 UIW Markdown 编辑器原本的单滚动容器结构：高亮 `pre` 撑开内容，输入层覆盖同一高度，只有外层 `.w-md-editor-area` 纵向滚动。
- 编辑主页左侧恢复标准返回键；“取消”与“保存”并列放入右侧操作胶囊。
- 正文模式切换显式禁止非选中项的主色背景与系统点按蓝底。
- 图片浏览器改用 `MobilePageTopBar + MobileTopActionPill`，不再维护独立顶栏骨架。
- 展示态主图设为不可收缩，长正文只让页面滚动，不再拿主图高度补偿内容溢出。

## 修改后流程

| 步骤 | 健康度 | 证据 | 结果 |
| --- | --- | --- | --- |
| 1. 长正文查看 | 已修复 | [after-02-detail-long.png](after-02-detail-long.png) | 主图恢复 `16 / 10`；实测容器 `342.46 × 214.04 CSS px`、图片 `340.62 × 212.19 CSS px`，不再停在 48px 触控兜底高度 |
| 2. 打开图片浏览器 | 已统一 | [after-03-image-viewer.png](after-03-image-viewer.png) | 返回、标题/计数与画廊操作均使用标准顶栏和操作胶囊 |
| 3. 进入普通编辑 | 已修复 | [after-04-edit-closed.png](after-04-edit-closed.png) | 左侧为标准返回键；取消移至右侧；正文卡片不再填满屏幕下半部 |
| 4. 聚焦标题 | 边界健康 | [after-10-title-keyboard.png](after-10-title-keyboard.png) | 标题唤起键盘时身份、摘要和附件保持可见，正文工具栏不误出现；证明折叠条件不是全局键盘状态 |
| 5. 聚焦内联正文 | 健康 | [after-11-final-body-keyboard.png](after-11-final-body-keyboard.png) | 最终 APK 中只有正文焦点与键盘同时成立时才折叠元数据并显示格式工具栏 |
| 6. 系统收起键盘 | 已修复 | [after-12-final-dismissed.png](after-12-final-dismissed.png) | 即使正文仍保留焦点，原生可见性变为 false 后工具栏立即隐藏，正文恢复有限高度 |
| 7. 切换预览 | 已修复 | [after-07-preview.png](after-07-preview.png) | 非选中的“编辑”只显示普通灰色文字，没有蓝色圆形底色 |
| 8. 全屏编辑 | 已修复 | [after-08-immersive-toolbar.png](after-08-immersive-toolbar.png) | 工具栏底边 `521.54 CSS px`，键盘顶端 `834 - 312.92 = 521.08 CSS px`，终点差约 `0.46 CSS px` |
| 9. 连续换行超过一屏 | 已修复 | [after-09-caret-scroll.png](after-09-caret-scroll.png) | 7 个临时换行后 textarea 不再内部滚动（`scrollTop = 0`），统一的 area 滚到 `224`；输入层与高亮层保持同一内容高度与滚动坐标系 |

## 数据保护与验证

- 临时换行只存在于未保存草稿；截图与尺寸采集完成后通过右侧“取消”确认放弃。详情页重新读取仍为 `正文 95 字`。
- `node --test src/app/mobile/mobileEntryEditor.test.mjs`：15 / 15 通过。
- `npm run test:mobile-shell`：69 / 69 通过。
- `npm run test:mobile-edge-back`：9 / 9 通过。
- `npm run lint`、`npm run build` 通过。
- `cd src-tauri && cargo check` 通过；仅有仓库既存的 unused / dead-code 警告。
- `npm run android:build:dev` 通过，产出 universal debug APK；`adb install -r -d` 覆盖安装成功并保留应用数据。

## 验证边界

- 本轮完成 Android 真机终点、实际触控、键盘显示/收起、连续换行和像素复查。
- iOS 未在本轮重新安装与截图；双端共用的前端结构已通过测试与构建，但不能据此宣称 iOS 真机视觉和输入法行为已验收。
