# 移动端与桌面端的复用/解耦审计

> 状态：现行
> 日期：2026-08-30
> 范围：`app_main/src`（前端）。证据为本次审计当时的代码结构，路径稳定、不写行号。

## 0. 先说结论：值不值得做

这份审计列出 8 项。按「不改会不会继续出事」排序，**只有前三项建议现在动**：

| # | 问题 | 是否建议做 | 理由 |
| --- | --- | --- | --- |
| 1 | 时间解析器四份拷贝 | **做** | 纯下沉，无行为风险，且它是「无时区字符串」这种容易出偏差的逻辑 |
| 2 | 灵感域文案两端已经不一致 | **做** | 已经产生了用户可见的分歧（`已归档` / `归档`） |
| 3 | 插件安装/卸载的错误处理两端不一致 | **做** | 桌面端用字符串拼接吞掉了结构化错误信息 |
| 4 | 设置自动保存两端各写一遍 | 先不做 | 两端触发时机确实不同，强行合并会把差异藏进参数 |
| 5 | Markdown 编辑命令两套语义 | 先不做 | 底层编辑器不同（桌面用第三方 md 编辑器，移动端手写 textarea 变换），共享点在「语义表」而不是实现 |
| 6 | `EntryRelationDraft` 定义在组件文件里 | 做，但顺手做 | 纯移动，改动面小，但不紧急 |
| 7 | 移动端错误横幅/空态重复 | 先不做 | 重复的是 6 行 JSX，抽象收益低于阅读成本 |
| 8 | AI 角色语音只有桌面有 | 不是重复，是缺口 | 已在计划内，见 §8 |

## 1. 时间解析器：同一段逻辑四份拷贝

「后端返回的无时区字符串 → 时间戳」这段逻辑写了四遍，四处字符完全一致：

- `features/entries/lib/entryCommon.ts` → `parseDateValue`
- `features/projects/projectDisplay.ts` → `parseProjectDateMs`
- `features/project-editor/components/ProjectOverview/CategoryView.tsx` → `parseDateMs`
- `app/mobile/pages/MobileEntryDate.ts` → `parseEntryDate`

它做的事情是：没有 `T` 就把空格换成 `T`，结尾没有时区就补 `Z`。这正是**改一处、漏三处就会在不同 WebView 里差 8 小时**的那类逻辑。

**建议**：下沉到 `shared/lib` 一个 `parseBackendDate` / `parseBackendDateMs`，四处改为引用。格式化函数不必合并——各处的 `Intl` 选项本来就不同，那是有意的。

## 2. 灵感域：两端各写一套展示逻辑，文案已经分叉

`pages/useIdeaPanel.tsx`（桌面）与 `app/mobile/hooks/useMobileIdeaController.ts`（移动端）都从共享的 `features/ideas/ideaStore` 取数据——**数据层是共用的，展示层各写了一份**，并且已经不一致：

| 语义 | 桌面 | 移动端 |
| --- | --- | --- |
| 归档状态标签 | `已归档` | `归档` |
| 无标题时的兜底 | `未命名便签` | `未命名灵感` |
| 预览截断长度 | 28 | 标题 28 / 正文 54 |
| 时间格式 | 月日时分 | 月日时分（同参数，另写一遍） |

同一条灵感在两端显示成不同的东西，这不是「平台适配」，是漂移。

**建议**：把状态标签表、标题/预览推导、时间格式下沉到 `features/ideas/ideaDisplay.ts`，两端引用。截断长度可以留成参数，但**默认值和文案必须只有一份**。

## 3. 插件安装/卸载：包裹层重复，且错误处理不等价

`installLocalPlugin` / `installMarketPlugin` / `uninstallPlugin` 都在 `features/settings/pluginCatalogStore.ts`，这层是共用的。重复的是外面那一圈：

- 文件选择器的过滤器（`流云AI 插件包` / `fcplug`）两端各写一份；
- 成功提示文案两端各写一份；
- **错误处理不一致**：移动端用 `formatApiError(toApiError(error))`，桌面端是 `'本地插件安装失败: ' + e` —— 直接字符串拼接一个 error 对象，结构化错误信息全部丢失。

**建议**：在 `features/settings/` 加一层 `usePluginInstallActions()`，把选择器过滤器、提示文案与错误格式化收进去，两端只提供 `showAlert`。桌面端那条字符串拼接顺手改掉。

## 4. 设置自动保存：两端各实现一遍防抖落盘（暂不合并）

两端都基于共享的 `saveAppSettings`，但各自实现了「脏值标记 + 500ms 防抖 + 落盘」。移动端 `MobileSettings.tsx` 的注释甚至写明「与桌面端 `pages/Settings.tsx` 取同一个值」——重复是被意识到的。

**不建议现在合并**：桌面端的 `persistSettings` 还夹着迁移摘要提示、成功提示开关、大量日志；移动端只有防抖。强行抽公共 hook 会把这些差异变成一串布尔参数，比现在难读。**真要动，先把桌面端那些副作用拆出去**，否则不是重构是搬家。

## 5. Markdown 编辑：同一套命令语义，两套实现（暂不合并）

- 桌面：`features/entries/components/EntryMarkdownToolbar.tsx`，基于第三方 md 编辑器的 `commands`。
- 移动端：`app/mobile/pages/MobileEntryMarkdownTransforms.ts`，手写选区变换。

两边都定义了「加粗 / 斜体 / 引用 / 列表 / 链接」，但底层编辑器不是一个东西，实现无法直接共用。真正可以共用的是**命令表**（有哪些工具、叫什么、图标是什么），不是变换实现。

**建议**：暂不动。若日后移动端也换成同一个编辑器内核，再一起收。

## 6. `EntryRelationDraft` 定义在组件文件里（方向反了）

`EntryRelationDraft` 是词条关系的**领域类型**，却定义在
`features/project-editor/components/EntryRelations/EntryRelationCreator.tsx` 里。目前有 8 处 import 它，其中包括：

- `features/entries/lib/entryRelation.ts`
- `features/entries/lib/entryDraftRecovery.ts`
- `features/entries/hooks/useEntryRelationState.ts`
- `app/mobile/stores/mobileEntryEditDraftStore.ts`

即 `lib` / `hooks` / `store` 依赖 `components`，与 ADR-0001 的分层方向相反。同类问题还有 `features/entries/hooks/useEntryTags.ts` 依赖 `../components/entryTagUtils`。

**建议**：把 `EntryRelationDraft` 及其方向枚举移到 `features/entries/lib/entryRelation.ts`（或 `features/project-editor/model/`），组件反过来引用。这是纯类型移动，无运行时风险。

## 7. 移动端的错误横幅与空态（暂不抽象）

`mobile-page__error-banner`（消息 + 重试按钮）在 7 个页面各写了一遍，`mobile-page__error` / `mobile-page__empty` 分布在 14 个文件。

**不建议抽象**：每处的重试动作、文案前缀、是否带按钮都不同，抽成组件后调用方要传 4~5 个 props，比现在的 6 行 JSX 更难读。**样式已经共用**（同一套 class），这一层的复用已经到位了。

## 8. AI 角色语音只有桌面有（缺口，不是重复）

`features/ai-chat/hooks/useAiController` 是双端共用的，这一层没问题。但角色语音朗读与自动播放（`ai_play_tts`、`resolvePreferredTtsPlugin`、按对话的自动播放）目前只写在桌面的 `AIChatContent.tsx` 里，约 120 行。

移动端补这块时**不要照抄**——应先把那 120 行抽成 `features/ai-chat/hooks/useRoleplayTts`，否则会立刻变成本文档第 2 节那种两端分叉。

## 已经做对的地方（别改）

审计过程中确认，以下边界是干净的，不要因为「统一」去动它们：

- 移动端页面**没有**任何 `@tauri-apps/*` 直接依赖，全部经过 `api/`。
- `features/` 与 `pages/` **没有**反向依赖 `app/mobile`。
- 数据层基本共用：`projectDetailStore`、`projectListStore`、`projectContextStore`、`ideaStore`、`appSettingsStore`、`aiPluginStore`、`worldCheckTaskStore`、`useAiController`、`useWorldCheckController`、`useEntryTags` 都是双端同一份。
- 词条卡片、类型图标、关系编辑器、标签/类型表单、封面选择、图片添加均为双端同一实现，移动端只换外壳。

## 复核触发条件

出现下列任一情况时应重读本文：

- 移动端接入角色语音（§8 的前置重构是否做了）；
- 桌面端 `Settings.tsx` 的 `persistSettings` 被拆分（§4 的前提是否成立）；
- 移动端更换 Markdown 编辑器内核（§5 是否可以合并）。
