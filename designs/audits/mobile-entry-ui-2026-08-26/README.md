# 移动端词条展示与编辑 UI/UX 真机审计（2026-08-26）

> **状态**：现行 ｜ **日期**：2026-08-26 ｜ **平台**：Android 真机
> **范围**：词条查看态、操作菜单、编辑/预览、内联与沉浸输入、属性页、关系页；图片浏览器仅代码审查

## 结论

当前实现已经形成稳定的「阅读 → 编辑 → 属性/关系」主链路，不该整体推倒重做。本轮已完成审计中 P1/P2 项：补齐字段名称与布尔状态、重做无候选关系空态、收口属性值字号与区块层级、统一沉浸保存语言、降低顶栏主编辑按钮重量，并压缩单项操作菜单。最终 debug APK 已在 Android 真机重装并完成第二轮像素验收。

## 设备与证据边界

| 项 | 本轮证据 |
| --- | --- |
| 设备 | Xiaomi 24129RT7CC（rodin），Android 16 / API 36 |
| 应用 | `cn.flowcloudai.www`，0.1.4 debug；最终 APK 由本轮当前工作树重新构建，并使用 `adb install -r -d -t` 保留数据安装 |
| 屏幕 | 1220 × 2712 px；WebView 视口约 375 × 834 CSS px |
| 抓取 | ADB 设备落盘 `screencap` 后 pull；每张截图均在本轮重新抓取并人工检查 |
| 代码对应 | 当前分支 `mobile-entry-editor-refactor`，HEAD `5ececf2` 加本报告列出的未提交优化；最终 APK 路径为 `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk` |
| 键盘终点 | 内联与沉浸编辑均实测 `--fc-kb = 312.92px`、`visualViewport.offsetTop = 0`、`scrollY = 0`、根节点 top = 0；未录制动画单调性，因此仍不是完整键盘动画验收 |

本目录根部原有的 `00-current.png` 至 `11-properties-scrolled.png` 在本轮开始前已经存在，来源未重新确认，故不作为本报告证据。`current-run/` 是优化前基线；`after/01-current.png` 至 `after/05-immersive.png` 是第一次构建后的中间检查，暴露了全局 48px 最小命中区覆盖按钮尺寸、桌面横向 `flex-basis` 使移动端标签选择器异常增高两个问题，不作为最终验收。最终证据只取 `after/06-*` 至 `after/13-*`。

## 本轮落地与回归结果

| 审计项 | 落地结果 | 真机证据 |
| --- | --- | --- |
| 字段名称与状态 | 标题、摘要、正文、标签值、关系搜索/说明均有稳定名称；摘要增加常驻可见标签；布尔标签补齐 `aria-pressed` | [08-edit-final.png](after/08-edit-final.png)；真机 DOM 检查 |
| 无候选关系 | 区分加载失败、项目无其他词条和搜索无结果；无候选时隐藏方向、说明和保存，只保留明确返回操作 | [11-relation-final.png](after/11-relation-final.png) |
| 属性信息层级 | 输入值降到 17px；类型与图片改为轻分组，标签与关系保留容器；修复标签选择器 160px 异常高度 | [09-properties-final.png](after/09-properties-final.png)、[10-properties-bottom-final.png](after/10-properties-bottom-final.png) |
| 保存与顶栏层级 | 沉浸页改用“保存 / 保存中…”；编辑按钮保持 48px 命中区，内部视觉圆为 32px；单项菜单按内容收窄 | [06-detail-final.png](after/06-detail-final.png)、[07-menu-final.png](after/07-menu-final.png)、[12-immersive-final.png](after/12-immersive-final.png) |
| 键盘布局 | 内联与沉浸编辑均由正文内部缩放可用空间，WebView、根页面和滚动位置不移动 | [12-immersive-final.png](after/12-immersive-final.png)、[13-edit-keyboard-final.png](after/13-edit-keyboard-final.png) |

真机计算样式复核：主编辑按钮命中区 `48 × 48px`，伪元素 `inset: 8px`，即视觉圆 `32 × 32px`；标签选择器最终 `height ≈ 53.04px`、`flex: 0 0 auto`、`min-width: 0`。验收过程中没有输入或保存内容；临时关系草稿已通过返回流程清理，最终停留在只读词条页。

## 流程步骤与健康度

| 步骤 | 状态 | 截图 | 观察 |
| --- | --- | --- | --- |
| 1. 查看词条 | 健康 | [06-detail-final.png](after/06-detail-final.png) | 标题、类型/时间、摘要、属性、正文顺序清楚；无图片时未占位；主操作不再与胶囊外框相切 |
| 2. 更多操作 | 健康 | [07-menu-final.png](after/07-menu-final.png) | 单项危险操作菜单按内容收窄，不再保留空选择列 |
| 3. 编辑主页 | 健康 | [08-edit-final.png](after/08-edit-final.png) | 正文是主体，摘要保留三行并有常驻标签，属性保持单一入口 |
| 4. 编辑预览 | 健康 | [07-edit-preview.png](current-run/07-edit-preview.png) | 编辑/预览切换稳定，Markdown 层级与查看态接近 |
| 5. 内联键盘输入 | 健康（终点） | [13-edit-keyboard-final.png](after/13-edit-keyboard-final.png) | 身份/附件折叠后正文获得完整可用空间，焦点名称稳定，页面与 WebView 未平移；未验证动画帧 |
| 6. 沉浸编辑 | 健康（终点） | [12-immersive-final.png](after/12-immersive-final.png) | 空间充足，文字保存和保存中语言已与普通编辑统一 |
| 7. 属性页 | 健康 | [09-properties-final.png](after/09-properties-final.png)、[10-properties-bottom-final.png](after/10-properties-bottom-final.png) | 完整页面选择正确；轻分组与重点容器层级清楚，标签选择器高度正常 |
| 8. 关系页 | 空态已闭环 | [11-relation-final.png](after/11-relation-final.png) | 项目无其他词条时解释前置条件，不暴露不可完成的方向、说明或保存操作 |
| 9. 图片浏览器 | 未取得真机视觉证据 | — | 当前词条 0 张图片；捏合、平移、翻页、管理态只做了代码审查 |

## 已经做对的部分

- 查看态保持只读，无图不占空间，摘要与正文层级可辨，属性短值用流式 chip，不截断长值。
- 编辑态只把标题、摘要、正文留在主页面；类型、标签、关系收口到属性页，入口不重复。
- 属性与关系含滚动/输入，使用页面栈里的完整页面，没有退回底部面板。
- 顶栏和底栏主要按钮真机命中区为 48px 或更大；28/36px 的正文模式与展开按钮由伪元素扩热区，没有为触控放大视觉。
- 键盘终点下 WebView/页面 frame 未被平移，Tab 由键盘覆盖，正文内部获得可用空间，符合单一布局 owner 的约束。

## 审计问题及闭环

### P1（已闭环）— 表单字段只有占位文字，没有稳定名称

编辑主页的标题、摘要、正文，属性页的标签值，以及关系页的搜索与关系说明，真机 DOM 中均没有关联的 `label`、`aria-label` 或 `aria-labelledby`。摘要已有值时，截图上也看不出这块内容到底是“摘要”还是正文引言。

代码位置：

- `src/app/mobile/pages/MobileEntryDetailEditView.tsx`：标题与摘要输入、正文 `MarkdownEditor`。
- `src/features/entries/components/HighLightTagItem.tsx`：标签值输入只给了 placeholder。
- `src/app/mobile/pages/MobileEntryRelationEditor.tsx`：搜索与关系说明输入只给了 placeholder。

落地：摘要使用紧凑常驻标签，其余输入补稳定 `aria-label` / `aria-labelledby` / `aria-describedby`；布尔标签组补 `role="group"`，三个选项均补 `aria-pressed`，清空和删除操作名称包含具体标签名。

### P1（已闭环）— 无候选关系仍把用户送进不可完成的编辑器

本轮项目没有其他词条，页面却把“无候选”写成“没有匹配词条”，并继续允许填写方向与说明。返回前会创建一个临时关系草稿，最终保存才因缺目标而拒绝，错误出现得太晚。

落地：页面现在区分加载、加载失败、项目无其他词条和搜索无结果。无候选时隐藏方向、说明与保存，解释“关系至少需要两条词条”，并提供返回属性页的单一操作；返回后关系计数仍为 `0 条`。

### P1（已闭环）— 属性值字号压过字段名和页面层级

真机计算样式显示标签输入值为 22px，字段名为 15px；截图中的 `16` / `88` 比页面标题之外的大多数信息都更抢眼。来源是 `HighLightTagItem` 使用 `Input size="lg"`，移动端 CSS只处理布局，未收口 field 字号。

落地：保留 48px 控件与命中高度，输入文字单独收口到 `--mobile-text-body`（17px），字段名继续使用 15px strong。数值重新回到内容层级，不再与页面标题竞争。

### P2（已闭环）— 普通编辑与沉浸编辑的保存语言不一致

普通编辑使用文字“保存 / 保存中…”，沉浸编辑却使用软盘图标，保存中又切成“更多”省略号图标。视觉与状态含义都不一致。

落地：沉浸页改用与普通编辑一致的“保存 / 保存中…”文字动作，不再用软盘和省略号表达不同状态。

### P2（已闭环）— 顶栏主编辑按钮视觉重量过高

查看态把编辑按钮做成与胶囊等高的纯色圆，圆与外框相切，像一个浮在胶囊上的独立 FAB；它同时压过词条标题和相邻的 AI / 更多动作。

落地：保留全局要求的 48px 点击区，按钮背景改为透明，再用 `::before` 的 8px 内缩绘制 32px 实心圆。视觉圆与 40px 胶囊外框之间保留 4px 空隙，AI 与更多仍为同组辅助动作。

### P2（已闭环）— 属性页所有区块同为大边框卡片

类型、图片、标签、关系都使用同一块大卡片，层级安全但同权重，长页会显得厚重。图片为 0 张时，添加瓦片有必要，但外层仍可更轻。

落地：继续使用完整页面，类型 chips 与图片条改为留白 + 分隔线的轻区块，仅标签编辑和关系列表保留重点容器，一屏维持两种容器语言。

### P3 — CSS 已成为视觉回归风险

`MobileEntryDetail.css` 已有 1813 行，查看、编辑、属性、关系、沉浸样式共处，历史选择器与末尾覆盖段并存；例如类型 options 同时写了两次 `row-gap`。继续微调很容易改到未生效的旧块。

建议：在下一轮视觉改动前先无行为拆分为查看、编辑、属性/关系、沉浸四个样式文件，并保留现有移动端静态测试与真机对照，避免借拆分顺便重做设计。

## 图片浏览器的代码审查风险

当前代码已有捏合、拖动、横滑翻页和画廊多选，但未看到平移边界收敛、双击回到适配、缩放后快速找回图片等恢复手段。该项必须用至少两张横竖比例不同的真实图片做手势验证后再定结论，不能从代码直接判定体验通过。

## 后续顺序

1. 在下一轮继续改动词条视觉前，无行为拆分 `MobileEntryDetail.css`，避免历史覆盖段继续放大回归风险。
2. 准备至少两张横竖比例不同的真实图片，完成图片浏览器的缩放、平移、翻页和恢复手势验收。
3. 分别补齐 iOS、深色主题、横屏、最大辅助字号和键盘动画逐帧回归。

## 未覆盖

- iOS、深色主题、横屏、最大辅助字号。
- 图片浏览器真实图片与手势。
- 有多条关系、正反链展开、长属性值的真机状态。
- 键盘动画逐帧单调性；本轮只确认开/关终点和页面 frame。
