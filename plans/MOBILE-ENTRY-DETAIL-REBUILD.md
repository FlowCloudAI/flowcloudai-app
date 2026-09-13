# MOBILE-ENTRY-DETAIL-REBUILD 移动端词条详情改造落地计划

> **状态**：现行（待开工） ｜ **日期**：2026-08-25 ｜ **范围**：`app_main` 移动端词条展示态 + 编辑态 + 属性页 + 关系页
> **设计稿**：`designs/mobile-entry-detail.html`（14 个状态，已定稿，8 项决定记在稿子的「已确认的决定」一节）

---

## 0. 开工前必须先读（硬性）

**每次开始这项工作、以及中途扩展到新子项目时，都要重新读一遍下面这些，不能靠记忆或上次会话：**

| 文件 | 为什么 |
| --- | --- |
| 工作区根 `AGENTS.md` | 协作方式、验证（原生界面验证边界）、仓库与提交；文档规则见 `docs/文档规约.md` |
| `app_main/AGENTS.md` | 移动端界面红线、复用与数据安全（2026-09-13 前在根 `AGENTS.md` §5.1 / §5.2），尤其**「任何渲染 Markdown 的表面都要自己接管锚点点击」**与软键盘唯一高度来源 |
| `designs/mobile-ui-baseline.md` | 尺度与结构规范。**§9 规则 5（空状态必须含主操作）、规则 8（底部面板不承载滚动或输入）、§6.1 规则 2（扩热区不放大视觉）本轮直接相关** |
| `designs/mobile-entry-detail.html` | 布局与视觉参考，**不是实现蓝本**，见 §1 |
| `docs/devlog/README.md`（工作区根） | 移动端坑最密的地方，动手前扫一眼索引 |
| `plans/ENTRY-CLIPBOARD.md` | 分类只读依赖它，见 §3 步骤 D 的排期约束 |

---

## 1. ⚠️ 设计稿是参考，不是可以搬进程序的代码

**这一节是本计划最重要的一节。上一次按设计稿改界面时，出现过把设计稿整段搬进程序的情况，必须避免重演。**

设计稿 `designs/mobile-entry-detail.html` 是一份**独立的单文件 HTML**，它为了能 `file://` 直接打开而自带一整套模拟环境。这些东西**一个都不能进程序**：

### 1.1 绝对不能搬的东西

| 设计稿里的 | 为什么不能搬 | 程序里应该用什么 |
| --- | --- | --- |
| `<style>` 里的 `:root { --fc-color-primary: #378add; ... }` | 那是**模拟**的 token，硬编码色值。真实 token 由 `flowcloudai-ui` 与 `mobileTokens.css` 提供 | 直接 `var(--fc-color-primary)` / `var(--mobile-gap-item)`，业务 CSS **禁止出现任何色值字面量与裸数值**（基线 §0.1、§4 规则 1） |
| `.phone` / `.status-bar` / `.tabbar` / `.design-shell` / `.design-notes` / `.switcher` | 是设计稿的**画布与外壳**，不是产品界面。手机边框、状态栏、侧栏说明都是给人看稿用的 | 什么都不做。Tab 栏由 `MobileApp` 已有实现负责 |
| `.attr-chip` / `.rel-row` / `.viewer__bar` / `.section-head` 等类名 | 是**稿子本地的命名**，为了写稿方便 | 沿用本仓 BEM：`mobile-entry-detail__*`、`mobile-entry-properties__*`，写进已有的 `MobileEntryDetail.css` |
| 稿子里的 `<button>`、`<input>`、`<textarea>` 原生控件 | 稿子不引入组件库 | 用 `flowcloudai-ui` 的 `Button` / `Input` / `Select`（`app_main/AGENTS.md`「复用与数据安全」），已有的 `MobilePageTopBar` / `MobileTopActionPill` / `MobileAnchoredActionMenu` |
| `→ ← ↔ ↗ ↙` 文字箭头 | 稿子用字符省事；字符箭头在不同字体下字形、基线、粗细都不一致 | **画成 SVG**，放进 `MobileEntryDetailActionIcon` 或同目录的图标模块，与现有图标同一套描边风格（`stroke-width` 1.8–2，`stroke-linecap: round`） |
| 内联 `style="..."` | 稿子里为了少写 CSS 用了若干内联样式 | 全部落到 CSS 类 |
| 稿子的 `<script>` 状态切换 | 只用于在稿子里切换展示状态 | 程序里状态来自 React state 与页面栈 |

### 1.2 应该从稿子拿走的东西

只有四类：

1. **信息层级与顺序**（谁在上、谁在下、谁跟谁一组）。
2. **相对尺度**（哪块该紧凑、哪块该突出；例如区块标签 13px/三级色 vs 正文标题 22px/700）。
3. **交互形态**（正反链默认收起、属性只列有值项、图片浏览器有单图与画廊两态）。
4. **稿子里写在注释和「已确认的决定」里的判断依据**——那些注释解释的是「为什么这么排」，比像素更重要。

### 1.3 落地时必须服从程序自身的风格

**稿子是布局与视觉方案的参考，最终实现必须结合应用整体页面风格。** 具体是：

- 新界面要和 `MobileHome` / `MobileEntryList` / `MobileAiChat` / `MobileIdea` 放在一起看着是同一个应用——圆角、边框、留白密度、卡片层次、图标描边风格、按钮形状都以**这些现有页面为准**，稿子与它们冲突时以现有页面为准。
- 稿子未覆盖的状态（加载中、出错、权限缺失、AI 插件缺失）沿用现有做法：`mobile-page__loading` / `mobile-page__error-banner` / `AiPluginMissingOverlay`。
- 稿子里没画的动效、返回手势、页面转场，一律不新造，沿用 `MobilePageTransitionHost` 与现有 `--mobile-duration-*` / `--mobile-ease-*`。
- **有疑问时先看现有页面怎么做的，其次看基线文档，最后才是稿子。**

---

## 2. 已确认的决定（不要在实现时重新讨论）

以下 8 条已在 2026-08-25 定案，稿子的「已确认的决定」一节有完整措辞：

1. 元数据上移到正文之上，代价（390×844 正文 323px、360×740 正文 219px）可接受，不为小屏另做折叠规则。
2. 展示态无主图时**不占位**。
3. 时间用**绝对日期**（列表页 `MobileEntryList.formatDate` 本来就是绝对时间，一致）。
4. 展示态**不提供任何编辑能力**（不给添加关系、不给图片增删、属性不可就地编辑）。
5. 图片浏览器**移动端自写**，参考桌面 `EntryImageLightbox` 的能力集但不复用其实现。
6. 属性值**不截断**，长值占满整行并自然换行，允许多行。
7. 编辑态预览的双链**不跳转**，维持「保存后可在查看态打开」提示。
8. 关系放属性页**最下方**，与桌面端统一。

---

## 3. 实施步骤

**分 5 个提交，每步独立可验证、可停。** 根 AGENTS「仓库与提交」：一个独立改动一个 commit，提交信息中文。
**每一步做完都要跑 §4 的验证，不要攒到最后。**

### 步骤 A — 展示态重排（不含图片浏览器）

改 `MobileEntryDetailView.tsx` + `MobileEntryDetail.css`。

- 顺序改为：主图 → 标题 → `类型 · 分类 · 更新于` 一行 → 摘要 → 属性 → 正文 → 关联。
- **补上分类显示**：`MobileEntryDetail.tsx` 已有 `activeCategory`，透传即可；无分类时显示「无分类」还是不显示，跟着现有 `MobileEntryList` 的处理走。
- **补上更新时间**：复用 `MobileEntryList.tsx:35` 的 `formatDate` 思路；如果要共用，提到 `MobileEntryDetailUtils.ts` 或 `shared/`，**不要复制一份**。
- 属性区改流式排布，**只列有值的项**。
  - ⚠️ `entryTags.browseVisibleTagSchemas`（`src/features/entries/hooks/useEntryTags.ts:77`）的过滤条件是 `implanted || value !== null`，**会把未填写的植入标签算进来**，不能直接用。需要在移动端算一个「只含有值项」的集合，或给 `useEntryTags` 加一个新导出（加导出要同时确认桌面端不受影响）。
  - 植入区分**沿用 `HighLightTagItem` 的 `.is-show.is-implanted` 主色左条**（`HighLightTagItem.css:25`），它在真机上本来就生效。不要新造徽章、不要加分组标题。
  - 长值不截断，允许换行。
- 顶栏滚动后显示词条名：`MobilePageTopBar` 支持 `center`，用它，不要另写。
- 空正文给主操作（基线 §9 规则 5）：一个「开始写正文」主按钮 + 一个「让 AI 起草」次操作。用 `flowcloudai-ui` 的 `Button`。
- 关联：方向改箭头 SVG；正反链默认收起成一行计数，点开展开。
  - 收起态的计数取 `outgoingLinks.length` / `incomingLinks.length` 即可，**不必等 `ensureProjectEntries` 解析出标题**。
- 编辑按钮从 `kind: 'add'` 改成真正有视觉差异的形态（实心填充）。
  - ⚠️ 现状 `kind: 'add'` / `'more'` 只改 `font-size` / `font-weight`，而所有图标都是固定尺寸 SVG，**这两个变体在移动端 11 个调用点上全部无视觉效果**（2026-08-25 真机 CDP 实测）。改 `MobileTopControls.css` 会影响所有移动端页面的顶栏，改完要回归首页、词条列表、AI、灵感、设置。

### 步骤 B — 移动端图片浏览器

新建组件，例如 `src/app/mobile/components/MobileImageViewer.tsx` + `.css`。

- 两态：单图（捏合缩放 + 滑动翻页 + 底部缩略图条 + 设为主图 / 删除）、画廊（网格多选 + 批量删除）。
- **不复用桌面 `EntryImageLightbox`**（决定 5）。桌面那套是「预览/画廊切换 + 百分比缩放按钮 + 键盘方向键」，形态不适配触摸。
- ⚠️ **`MobileEntryProperties.tsx:208` 现在用的就是桌面 `EntryImageLightbox`，要一并换掉**，否则属性页和展示态会是两套图片浏览体验。
- 浮层外壳优先用 `src/shared/ui/overlay` 的 `Overlay` / `FloatingPanel`（`app_main/AGENTS.md`「复用与数据安全」），它已经处理了 portal、遮罩、Esc/背板关闭、滚动锁与返回栈。**不要手写 `createPortal` 和全局 `keydown`。**
- 缩略图条是横向滚动区 → 必须带 `data-mobile-horizontal-scroll`（`app_main/AGENTS.md`「移动端界面」）。
- ⚠️ 不要用 `translateZ(0)` 强制合成层，2026-07-13 已因 tile 内存超限暂停该做法（`app_main/AGENTS.md`「移动端界面」）。

### 步骤 C — 编辑态骨架重排

改 `MobileEntryDetailEditView.tsx` + `MobileEntryDetail.css`。

- 顺序：身份区（标题 · 类型 · 分类只读 · 摘要）→ 附件条（图片缩略图 + 标签/关系计数 + 属性入口）→ 正文面板。
- 附件条的图片缩略图**添加位固定在最前**（横滚时「+」不会被滚出可视范围）。
- 正文头部压到 40px：分段控件视觉 28px，**命中区用 `::after` 补到 `--mobile-tap-min`**。
  - ⚠️ 基线 §6.1 规则 2：「图标视觉尺寸可以小，命中区不可以。用 padding 或伪元素扩展热区，**不要放大图标**」。上一轮直接把 `min-height` 设成 48px 撑满整行，是反例。
- 保存改文字按钮；`saving` 时用文字态（「保存中…」），**不要再拿「⋯」图标冒充 loading**。
- 摘要保持 `rows={3}`（用户明确要求，`mobileEntryEditor.test.mjs` 有断言）。
- 身份区与附件条在正文聚焦时折叠——沿用现有 `data-body-focused` + grid `0fr/1fr` 的可过渡折叠，附件条也要有过渡，**不要 `display: none` 硬切**。

### 步骤 D — 分类改只读

- `MobileEntryProperties.tsx`：删掉分类 `Select`。
- `MobileEntryDetailEditView.tsx`：身份区分类显示为只读。
- `MobileEntryDetail.tsx`：`categoryId` 不再进入可变草稿字段。
- 桌面端 `EntryEditorMetaPanel.tsx` 的「所属分类」下拉同步处理。

> ⚠️ **排期约束：这一步必须与 `plans/ENTRY-CLIPBOARD.md` 的剪切/复制/多选一起排。**
> 只做只读、不做替代入口，用户将**完全没有办法**改词条归属。
> 如果 ENTRY-CLIPBOARD 还没开工，**步骤 D 就先不做**，其余四步不受影响。

### 步骤 E — 属性页与关系页重排

改 `MobileEntryProperties.tsx` / `MobileEntryRelationEditor.tsx` / CSS。

- 属性页改分组列表：行高约 52px，标签一行一条（名称左 / 值右）。
- 类型 chips **换行不横滚**（横滚在真机上把「物品」硬切在屏幕边缘，无渐隐无滚动条）。
- 取值范围提示只在**真有边界**时显示；`HighLightTagItem` 对默认范围会生成「建议范围 0 - 不限」这种零信息文案。
- 「清空」只在有值时出现。
- 数值标签的原生 `type="number"` spinner 在移动端既难点又占横向空间，考虑改 `inputMode="numeric"`（改动涉及 `HighLightTagItem`，是桌面共用组件，**要同时回归桌面端**）。
- 关系页保持在属性页最下方（决定 8）。

---

## 4. 每一步都要做的验证

```bash
cd app_main
npm run lint
npm run build
npm run test:mobile-shell
npm run test:mobile-edge-back
```

- `test:mobile-shell` 含 `mobileUiBaseline` / `mobileTypography` / `mobileAccessibility` / `mobileInputMode` / `mobileEntryEditor` 五个套件，会挡住裸数值、第 6 档字号、色值字面量、`visualViewport` 回归、锚点拦截缺失等。当前基线 **60/60 全过**，不允许带着失败提交。
- 断言需要更新时**改断言要有理由**，不要为了让测试过而删断言。2026-08-24 曾出现两条互相矛盾的断言长期挡住整个套件。
- ⚠️ 写 `assert.doesNotMatch` 时注意**自己写的注释也会被匹配到**（已踩过两次：`visualViewport`、`stopPropagation`），把正则收窄到实际代码形态。

### 真机验证（Android，设备已验证可用）

浏览器预览**不能**作为验收证据（根 AGENTS「验证」：词条页依赖 Tauri command 与本地数据库）。

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.0.12077973"
export ANDROID_NDK_ROOT="$ANDROID_NDK_HOME"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
npm run android:build:dev
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

截图（此机 `adb exec-out screencap` 会被 signal 3/36 杀掉，只能落盘再 pull；**每次先删旧文件**，否则会 pull 到陈图）：

```bash
adb shell rm -f /sdcard/__cap.png && adb shell screencap -p /sdcard/__cap.png && adb pull /sdcard/__cap.png ./out.png
```

需要读计算样式/DOM 时用 CDP：

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof cn.flowcloudai.www)
```

再用 Node 内置 `WebSocket` 连 `http://127.0.0.1:9222/json` 里的 `webSocketDebuggerUrl` 发 `Runtime.evaluate`。

**证据必须提交进仓库**：`designs/audits/<主题>-<日期>/`，附 `README.md` 说明设备、构建、抓取方式（根 `docs/文档规约.md` 第 4 节）。指向仓库外临时目录的证据等于没有证据。

### iOS

**目前零证据。** 本轮所有结论只适用于 Android 已验证状态。iOS 走 `data-mobile-keyboard-owner='ios'` 的另一条键盘分支，全屏专注与属性页的键盘行为必须单独验。

---

## 5. 动手时容易踩的坑

- ⚠️ **`MobileEntryDetail.css` 有 14 组完全相同的选择器块**（`__title` / `__markdown` / `__summary` / `__image-grid` / `__connection-card` 等各定义两次，一处在文件前段、一处在后段）。2026-08-24 的 padding 回归就是这个结构造成的：改了前一处，后一处在同等特异性下覆盖回去。**改样式前先确认自己改的是不是最后生效的那一处**，顺手合并重复块（可以单独一个提交）。
- ⚠️ **`.mobile-page:not(.mobile-nav-safe-fixed)` 特异性是 (0,2,0)**，会故意压掉页面级的 `padding` 简写。编辑态用了 `padding-inline` / `padding-top` / `padding-bottom` 分写就是为了绕开它。
- ⚠️ **Android 页面必须自己声明 `--mobile-keyboard-extra` 与 `--mobile-nav-reserved-height`**：外壳只在 `html[data-mobile-keyboard-owner='ios']` 下加键盘分量。参考 `MobileAiChat.css` / `MobileIdea.css` 的写法。
- ⚠️ **`visualViewport` 只能用于输入态判断，不得用于写根高度、平移外壳或预测键盘高度**（`app_main/AGENTS.md`「移动端界面」、`docs/devlog/2026-08-24-移动端软键盘-双端原生布局接管.md`）。
- ⚠️ **新增的 Markdown 预览表面必须接管锚点点击**（`app_main/AGENTS.md`「复用与数据安全」）。`AppShell` 的 `useTopLevelNavigationGuard` 是兜底，不是许可。
- ⚠️ **单个移动端页面文件原则上不超过 800 行**（`app_main/AGENTS.md`「移动端界面」）。`MobileEntryDetail.tsx` 现在 645 行，本轮会继续增长，**超过前先拆 hook 或子组件**。
- ⚠️ **页面层禁止直接 `import` `@tauri-apps/*`**，先收口到 `api/`。
- ⚠️ **新增跨页共享状态走 store**（`useSyncExternalStore` 模式），禁止新增 `CustomEvent`。
- ⚠️ **底部面板不承载滚动或输入内容**（基线 §9 规则 8）。本轮如果想用 `MobileBottomSheet` 装图片浏览器或属性编辑，**都不行**，用页面栈或全屏浮层。

---

## 6. 中途接手怎么恢复上下文

如果会话中断，按顺序做：

1. 读 §0 的文件清单。
2. `git log --oneline -15` 看已完成到哪一步（提交信息带步骤特征）。
3. 打开 `designs/mobile-entry-detail.html`，侧栏切状态对照。
4. `npm run test:mobile-shell` 确认起点是绿的。
5. 从 §3 未完成的第一步继续。

**每步完成后立刻提交**，不要攒着——本计划的每一步都设计成可独立回滚。

---

## 7. 关联文档

- 设计稿：`designs/mobile-entry-detail.html`
- 尺度规范：`designs/mobile-ui-baseline.md`
- iOS 细则：`designs/apple-ios-ui-ux-design-guidelines.md`、`designs/ios-mobile-hig-gap-audit.md`
- 分类归属替代入口：`plans/ENTRY-CLIPBOARD.md`
- 本轮已修的顶层导航问题：工作区根 `docs/devlog/2026-08-25-移动端预览链接把应用打没.md`
- 真机证据与抓取方式：`designs/audits/mobile-entry-link-navigation-2026-08-25/README.md`
