# 移动端词条编辑器设计 QA

状态：**现行**  
日期：**2026-08-24**

## 最终结果

**Android 通过；iOS 仍缺证据，整体不判定为双端验收通过。**

2026-08-24 第二轮：首轮实现虽然静态检查全绿，但 Android 真机核对发现 6 类问题（键盘遮挡、
字号回归、两套键盘机制、属性页拼接感、顶栏穿透、触控尺寸），已全部修复并以真机截图复核。
`adb exec-out screencap` 在本机型会被信号 3/36 终止，改用 `screencap -p /sdcard/x.png` + `adb pull`
即可取图，首轮"系统截图不可用"的结论不成立。

## 已核对（第一轮设计目标 → 第二轮真机确认）

| 设计目标 | 代码落点 | 证据 |
| --- | --- | --- |
| 固定编辑骨架、内联正文独立滚动 | `MobileEntryDetailEditView.tsx`、`MobileEntryDetail.css` | `android-fixed-edit.png` |
| 编辑层级沿用应用公共顶栏 | 三页均用 `MobilePageTopBar` / `MobileTopActionPill` | `android-fixed-*.png`；标题色第二轮修正 |
| 三行摘要保留 | `MobileEntryDetailEditView.tsx` `rows={3}` | `android-fixed-edit.png` |
| 属性与关系使用完整页面 | `MobileEntryProperties.tsx`、`MobileEntryRelationEditor.tsx`、`usePageStack.ts` | `android-fixed-properties.png`、`android-fixed-relation.png` |
| 三层页面共享草稿 | `stores/mobileEntryEditDraftStore.ts` | 真机三层往返未丢草稿 |
| 新建占位清理 | `mobileEntryPlaceholder.ts` | 构建与单测通过；真机路径未逐项走完 |
| 相机入口保持 | `useMobileEntryImages.ts`、`EntryImageAddModal.tsx` | 未在本轮真机验证 |
| 键盘只压缩页面内部空间 | `MobileEntryDetail.css` | 第一轮此项陈述不准确（沉浸层仍在 visualViewport 上），第二轮已改正并复核 |

## 第二轮修复与真机复核（2026-08-24）

| 问题 | 根因 | 修复 | 复核证据 |
| --- | --- | --- | --- |
| **属性页/关系页底部输入被软键盘切断，且无可滚空间**（Android） | 页面自写 `padding` 简写被 `MobileApp.css` 的 `.mobile-page:not(.mobile-nav-safe-fixed)`（更高特异度）整条盖掉；`--mobile-nav-reserved-height` 的键盘分量只在 `html[data-mobile-keyboard-owner='ios']` 下追加，Android 拿不到 | 改为只声明 `--mobile-keyboard-extra` / `--mobile-nav-reserved-height`，底部 padding 交还外壳 | `android-fixed-properties-keyboard.png`；CDP 实测 `--fc-kb=312.92px`、`padding-bottom=336.92px`、底部余量 411px（修复前固定 118px 且无键盘分量） |
| 正文与摘要字号 15px | 直接写 `--mobile-text-body-sm`，绕过 `--fc-font-size-control` | 统一 `--mobile-text-body`（17px），与沉浸编辑器一致 | 回归 IOS-003 的已验收结论；`android-fixed-edit.png` |
| 内联 15px / 全屏 17px 两套字号 | 两处各写各的 | 同上 | 同上 |
| 沉浸编辑器仍用 `visualViewport` 写高度并平移整层 | 2026-08-23 键盘接管未覆盖该层 | 删除 visualViewport 逻辑，改 `padding-bottom: max(var(--fc-kb), var(--mobile-safe-bottom))` | `mobileInputMode.test.mjs` 断言改为禁止 `window.visualViewport` 并要求消费 `--fc-kb` |
| 属性页五个分组三种视觉语言、图片组三行三种对齐 | `MobileEntryImagesSection` / `MobileEntryTagsSection` 原为 `<details>` 内部编写，作用域覆盖随 `<details>` 删除而失效 | 两个 section 去掉自带 header，分组标题统一由属性页提供；图片改为「+」瓦片常驻行尾；标签压成行式 | `android-fixed-properties.png`、`android-fixed-properties-bottom.png` |
| sticky 顶栏遮不住滚过的内容，正文与返回键/标题叠字 | 渐变在栏体内部 0%→100% 衰减，而操作行占栏体 31%~100%，正落在最透明段 | 栏体整片实色，渐隐移到栏体下方的 `::after` | `android-fixed-properties-bottom.png`（同位置对比 `android-properties-bottom.png`） |
| 属性页/关系页标题是蓝色 | `.mobile-entry-detail__edit-heading span` 基线色为 primary，只有编辑页单独覆盖回深色 | 基线改为正文色，删除编辑页的重复覆盖 | `android-fixed-properties.png` |
| 「编辑\|预览」分段 36px | 设计稿本身就写了 36px，低于 `--mobile-tap-min` | 改 48px，设计稿同步修正 | `android-fixed-edit.png` |
| 编辑页属性入口行被 Tab 栏盖住（第二轮引入后当场修复） | 同文件存在两处 `.mobile-entry-detail` 基类定义，靠后那处的 `padding` 简写压过 `--edit` | 合并为单一基类定义，`--edit` 显式声明 `padding-bottom` | `android-fixed-edit.png` |
| Markdown 工具栏为一排 48px 描边圆钮、右侧硬切 | — | 去描边、方角、右侧 mask 渐隐 | `android-fixed-body-keyboard.png` |
| 新建未选目标的关系底部却是红色「删除这条关系」 | — | 空白新关系改为「放弃这条关系」中性样式 | `android-fixed-relation.png` |
| 关系搜索静默截断 12 条 | — | 超出时提示「还有 N 条匹配」 | 代码 `SEARCH_RESULT_LIMIT` |

### 顺带清理

- `MobileEntryDetail.css` 1521 → 1288 行；死类由 15 个降为 0；`.mobile-entry-detail` 与 `.mobile-entry-detail--edit` 的重复定义合并。
- 删除 `MobileEntryRelationsSection.tsx`（已无引用，移动端不再依赖桌面 `EntryRelationCreator` 组件）。
- **解开 `test:mobile-shell` 的长期阻塞**：`mobileAccessibility.test.mjs` 要求 AI 工具模式菜单自带
  `0.875rem`/`0.71875rem` 两个局部字号变量，而 `mobileUiBaseline.test.mjs` 断言字号只有 5 档——
  两条断言互相矛盾。以基线为准，菜单字号改用 `--mobile-text-body-sm` / `--mobile-text-meta`，
  菜单宽度 9.75rem → 11rem，并同步断言。composer 的底部断言放宽为允许在
  `--mobile-nav-reserved-height` 上叠加键盘上沿间距。

## 自动验证（第二轮）

- `npm run lint`：通过。
- `npm run build`：通过。
- `npm run test:mobile-shell`：**59/59 通过**（第一轮为 54/59，其中 2 项是上述矛盾断言）。
- `npm run test:mobile-edge-back`：9/9 通过。
- `npm run android:build:dev` + `adb install -r -d`：通过，Android 16 真机覆盖安装并保留数据。

## 尚缺证据

**iOS 一端没有任何原生证据**，以下矩阵仍需在 iPhone 上独立完成，不能用 Android 结果替代：

1. 编辑主页键盘收起：标题、三行摘要、正文、属性入口和底栏同时可见。
2. 正文聚焦：键盘动画期间 WebView 不平移，正文内部单调压缩，工具栏位于键盘上方。
3. 摘要聚焦：摘要仍可内部滚动，不出现双重避让。
4. 属性页与关系页：长内容连续滚动、底部输入不被键盘遮挡。
5. 全屏专注：改用 `--fc-kb` 后 iOS 的落位与动画（本轮改动直接影响该层，iOS 未验证）。
6. 新建词条：首次保存后保留；未保存返回或切 Tab 后预创建数据被清理。
7. 系统拍照：取消、拍照导入、临时文件清理和图片草稿保留。

Android 侧未覆盖：最大辅助字号、横屏、深色主题、第三方输入法。

## 来源快照

设计来源截图见 `source-*.png`；第一轮问题截图见 `android-*.png`；第二轮修复后截图见 `android-fixed-*.png`。
