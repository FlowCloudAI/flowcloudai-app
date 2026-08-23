# app_main flowcloudai-ui CSS 语义令牌审计记忆

> 目的：固化 2026-06-01 对 `app_main` 中“应使用但未使用 `flowcloudai-ui` CSS 语义令牌”的核验结论，避免后续因上下文压缩或口径漂移重复误判。

## 核验范围

- 源码范围：`app_main/index.html` 与 `app_main/src/**/*.{css,ts,tsx,html}`。
- 不纳入范围：`app_main/dist`、`app_main/node_modules`、依赖包源码、构建产物。
- 令牌来源：`lib_ui/ui/src/style/index.css`，但本次实际核验重点是颜色、背景、边框、阴影、遮罩与 SVG/内联样式里的视觉色值。
- 未系统覆盖：字体、字号、字重、行高、间距、圆角、z-index、transition 等非色彩类令牌。若目标包含这些令牌，需要另开专项审计；字号问题可优先参考 `docs/font-size-without-fc-font-token.md`。
- 扫描限制：本项目约束禁止使用 `rg`，核验使用 PowerShell 原生命令与显式 UTF-8 严格读取。

## 关键结论

上一轮“主清单 87 处”没有发现多报删除项，但存在漏项。独立复核后：

- 旧主清单：87 处。
- 更宽口径候选：108 处。
- 旧主清单漏掉：21 处。
- 其中建议补入主修复清单的高置信漏项：10 处。
- 其余漏项多属于内容颜色、地图图形数据色、SVG fallback 图像、CSS mask 或导出默认色，不建议直接按 UI 语义令牌强改。

另外，`RelationGraph.css` 中本地 `--fc-rg-*` overlay 变量虽然是“自定义 CSS 变量定义”，但变量值本身仍是 UI overlay 背景，应纳入语义令牌修复，而不是简单排除。

## 修正后的主修复清单

以下清单是建议优先处理的 UI 语义令牌问题。它等于旧 87 处主清单，加上核验确认应补入的 10 处高置信漏项。

```text
app_main\index.html: 30, 31, 36, 37, 69, 70
app_main\src\App.css: 165
app_main\src\app\desktop\DesktopApp.tsx: 1192, 1193, 1300
app_main\src\app\mobile\MobileApp.css: 192, 198
app_main\src\features\about\AboutSection.css: 143
app_main\src\features\ai-chat\components\AIChatContent.css: 253, 254, 451, 487, 507, 508, 1009, 1016, 1645, 1706, 1824
app_main\src\features\entries\components\EntryEditor.css: 146, 327, 330, 341, 342, 343, 678, 687, 692, 712
app_main\src\features\entries\components\EntryImageLightbox.css: 8
app_main\src\features\entries\components\HighLightTagItem.css: 64, 65, 69, 70
app_main\src\features\help\components\HelpPanel.css: 36
app_main\src\features\maps\components\MapShapeEditor\MapShapeEditor.css: 385, 386, 391, 441, 465, 484
app_main\src\features\maps\components\WorldMapPanel.css: 222
app_main\src\features\maps\components\WorldMapPanel.tsx: 1936, 1945, 1976, 1985
app_main\src\features\project-editor\components\ProjectContradictionPanel.css: 524, 704
app_main\src\features\relation-graph\components\ProjectRelationGraph.css: 34, 40, 78, 79, 133
app_main\src\features\relation-graph\components\ProjectRelationGraph.tsx: 241
app_main\src\features\relation-graph\components\RelationGraph\RelationGraph.css: 19, 20, 29, 30, 133
app_main\src\pages\Idea.css: 59
app_main\src\pages\ProjectEditor.css: 1745, 1824, 2037, 2044, 2052, 2059, 2071, 2072, 2073, 2074, 2091, 2115, 2116, 2117, 2119, 2133, 2142
app_main\src\pages\ProjectList.css: 550, 557, 565, 572, 581, 590, 591, 602, 603, 611, 624, 625, 626
app_main\src\pages\Settings.css: 906
app_main\src\shared\ui\layout\WorkspaceScaffold.css: 479
```

注意：`DesktopApp.tsx:1192,1193` 是 logo 渐变色。若产品要求品牌标识固定色，可在实施时降级为“品牌色例外”，但不要因上下文遗失而误删这两个候选。

## 旧清单漏项明细

旧主清单漏掉的 21 处如下：

```text
app_main\src\app\desktop\DesktopApp.tsx: 1300
app_main\src\features\ai-chat\components\AIChatContent.css: 508, 668, 669
app_main\src\features\entries\components\EntryTypeCreator.tsx: 7
app_main\src\features\maps\components\MapShapeEditor\mapShapeEditorSvgUtils.ts: 109, 110
app_main\src\features\maps\components\MapShapeEditor\MapShapeSvgEditor.tsx: 707, 708, 768, 769
app_main\src\features\maps\components\WorldMapPanel.tsx: 1937, 1946, 1977, 1986
app_main\src\features\relation-graph\components\ProjectRelationGraph.css: 40
app_main\src\features\relation-graph\components\ProjectRelationGraph.tsx: 240
app_main\src\features\relation-graph\components\RelationGraph\RelationGraph.tsx: 64
app_main\src\pages\ProjectList.css: 602, 603, 611
```

其中补入主修复清单的高置信漏项：

```text
app_main\src\app\desktop\DesktopApp.tsx: 1300
app_main\src\features\ai-chat\components\AIChatContent.css: 508
app_main\src\features\relation-graph\components\ProjectRelationGraph.css: 40
app_main\src\features\relation-graph\components\RelationGraph\RelationGraph.css: 19, 20, 29, 30
app_main\src\pages\ProjectList.css: 602, 603, 611
```

其余漏项暂不建议直接令牌化：

```text
app_main\src\features\ai-chat\components\AIChatContent.css: 668, 669
app_main\src\features\entries\components\EntryTypeCreator.tsx: 7
app_main\src\features\maps\components\MapShapeEditor\mapShapeEditorSvgUtils.ts: 109, 110
app_main\src\features\maps\components\MapShapeEditor\MapShapeSvgEditor.tsx: 707, 708, 768, 769
app_main\src\features\maps\components\WorldMapPanel.tsx: 1937, 1946, 1977, 1986
app_main\src\features\relation-graph\components\ProjectRelationGraph.tsx: 240
app_main\src\features\relation-graph\components\RelationGraph\RelationGraph.tsx: 64
```

原因：

- `AIChatContent.css:668,669` 是 CSS mask 渐隐遮罩，不是界面配色语义。
- `EntryTypeCreator.tsx:7` 是用户可配置词条类型颜色的默认值，不一定应绑定主题。
- 地图编辑器相关漏项是地图形状的内容色、默认形状色或颜色输入占位值，不等同于 UI 外观色。
- `ProjectRelationGraph.tsx:240` 是 fallback SVG 图像内的动态 HSL 内容色。
- `RelationGraph.tsx:64` 是导出图片默认背景，不一定应跟随当前 UI 主题。

## 排除口径

以下类别不要混入主修复清单，除非后续明确要求统一内容色或主题算法：

- `app_main/src/features/maps/styles/**`：地图风格配置与预设，不是通用 UI 语义色。
- `app_main/src/features/relation-graph/fixtures/**`：测试或示例数据。
- 主题配方与颜色算法：
  - `app_main\src\pages\settings\fcThemeRecipe.ts`
  - `app_main\src\pages\settings\materialThemePreview.ts`
  - `app_main\src\pages\settings\ThemeTokenColorEditor.tsx`
  - `app_main\src\pages\settings\ThemeColorPreview.tsx`
- 用户内容色、品牌图形色、导出文件默认背景、CSS mask 的黑白遮罩色。

## 实施建议

- 背景、文本、边框、阴影、overlay 优先替换为 `--fc-color-*` 与 `--fc-shadow-*`。
- 白色前景优先考虑 `var(--fc-color-text-on-primary)`，不要机械替换所有 `#fff`。
- 半透明遮罩优先考虑已有 `var(--fc-color-bg-overlay)`；如果透明度语义不同，可先定义局部变量并从 `--fc-color-*` 派生。
- `box-shadow` 优先映射到 `var(--fc-shadow-xs|sm|md|lg)`；若视觉确实需要特殊阴影，使用局部变量并说明原因。
- 修复后至少运行 `cd app_main; npm run lint`。涉及构建期 CSS 或 TSX 内联样式时，再运行 `npm run build`。
