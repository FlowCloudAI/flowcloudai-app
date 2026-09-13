# DockPanel 子页面开发规范

本文档记录后续新增 `DockableSidePanel` 子页面时应遵守的结构、样式和验证约定。目标是让右侧 Dock 面板里的不同工具切换时保持同一套工作区体验，并允许登记过的两种内容上下分栏。

## 适用范围

适用于挂载到 `DockableSidePanel` 的子页面，例如：

- 灵感便签
- AI 对话
- 快照 / 版本管理
- 帮助
- 后续新增的右侧工具页

不适用于主工作区页面、弹窗、设置页或独立页面。

## 基本原则

1. 新子页面必须使用共享骨架组件，不要重新手写侧栏、主体、顶栏和图标按钮的基础布局。
2. 子页面可以有自己的业务内容样式，但不能复制共享骨架已负责的宽度、高度、背景、边框、圆角、顶栏高度和图标按钮基础样式。
3. 每个 hook 统一返回 `{main}`。需要内部侧栏时，由 `main` 自己组合侧栏和主区。
4. `Snapshot` 的上下布局是已确认的业务例外，允许保持“顶部主栏 → 中间控制区 → 底部图谱区”的结构。
5. Dock 内容默认单栏。只有 `sidePanelContents.ts` 明确允许的有序配对才能上下分栏。

## 必用组件

从 `src/shared/ui/layout/DockPanelScaffold.tsx` 引入基础骨架：

```tsx
import {
    DockPanelIconButton,
    DockPanelMain,
    DockPanelSide,
    DockPanelTitle,
    DockPanelTopbar,
} from '../../shared/ui/layout/DockPanelScaffold'
```

按实际相对路径调整 import。

共享组件职责：

- `DockPanelSide`：业务内容内部的侧栏基础容器，负责宽度、背景、边框和纵向布局。
- `DockPanelMain`：内容主体基础容器，负责 flex 布局、背景和滚动裁剪。
- `DockPanelTopbar`：统一顶栏高度、间距、背景和底部分隔线。
- `DockPanelTopbar variant="side"`：侧栏顶栏，默认透明且无底部分隔线。
- `DockPanelTitle`：统一标题字号、字重和颜色。
- `DockPanelIconButton`：统一图标按钮尺寸、圆角、hover 和 disabled 状态。

侧栏筛选、搜索和分段控件优先使用：

```tsx
import {
    DockPanelSearchInput,
    DockPanelSegmentedControl,
} from '../../shared/ui/layout/DockPanelSidebarControls'
```

## 推荐文件形态

新增 Dock 子页面的 hook 只返回主体：

```tsx
export interface XxxPanelSlots {
    main: ReactNode
}

export function useXxxPanel(options: UseXxxPanelOptions): XxxPanelSlots {
    return {
        main: (
            <div className="xxx-panel">
                <DockPanelSide className="xxx-side">
                    {/* 可选的业务侧栏 */}
                </DockPanelSide>
                <DockPanelMain className="xxx-main">
                    <DockPanelTopbar className="xxx-main__topbar">
                        <DockPanelTitle className="xxx-main__title">标题</DockPanelTitle>
                        <div className="xxx-main__topbar-actions">
                            <DockPanelIconButton title="最小化">
                                {/* 图标 */}
                            </DockPanelIconButton>
                        </div>
                    </DockPanelTopbar>
                    {/* 主区内容 */}
                </DockPanelMain>
            </div>
        ),
    }
}
```

如果子页面没有侧栏，`main` 仍使用 `DockPanelMain`。复杂页面的状态应留在业务组件内部，切换 Dock 内容时依靠 `DockableSidePanel` 保持挂载。

## 内容登记与分栏

所有 Dock 内容都登记在 `src/app/desktop/sidePanelContents.ts`。描述项包含稳定的 `key`、最小宽度 `minWidth` 和作用域 `scope`：

- `global` 内容不依赖当前主页面。
- `page` 内容只在所属页面激活时保留；调用方必须向 `normalizeSidePanelLayout` 提供准确的激活判定。
- 新增内容时同时在 `DesktopApp` 注册其 `main`，并接入右侧 `SideBar`。

允许分栏的配对表是有方向的 `[上格 key, 下格 key]`。未登记、上下相同或页面作用域失活的组合会由 `normalizeSidePanelLayout` 规整为单栏。

`DockableSidePanel` 只负责渲染已经规整的布局。单栏时不渲染分栏容器或分隔条；分栏时上下两层保持挂载，中间分隔条只在松手时提交比例或收起动作。

本组件不提供分栏入口。业务入口需要另行评审；不要通过临时按钮或隐藏手势绕过配对表。

## CSS 规范

业务 CSS 只写业务差异：

- 可以写：列表项、图谱、编辑器、输入区、业务状态和响应式排列。
- 不要写：Dock 外壳宽度、拖拽手柄、分栏轨道、主体基础结构、顶栏高度、基础背景和基础边框。

推荐保留的业务 class：

```css
.xxx-panel {}
.xxx-side {}
.xxx-main {}
.xxx-main__topbar-actions {}
.xxx-list {}
.xxx-list-item {}
```

禁止为了覆盖共享样式使用 `!important`。如果共享骨架能力不足，应先扩展 `DockPanelScaffold.css` 或骨架组件，再让业务页使用。

颜色、间距、圆角必须使用 `--fc-*` 或 `--dock-panel-*` token，不新增硬编码主题值。

## 接入 DesktopApp

新增子页面需要在 `src/app/desktop/DesktopApp.tsx` 完成以下接入：

1. 在 `sidePanelContents.ts` 登记 key、最小宽度和作用域。
2. 调用新 hook，拿到 `{main}`。
3. 在 `sidePanelMains` 中按 key 注册，并保证 `mountedSidePanelKeys` 能覆盖它。
4. 在 `SideBar` 的 `menuItems` 或 `bottomItems` 中增加稳定的 key、中文 label 和图标。
5. 在 `handleSideBarSelect` 中处理该 key，保证点击入口能打开、切换或折叠对应 Dock 子页面。
6. 如果允许与另一内容分栏，在配对表中按上下顺序增加一项。
7. 页面作用域内容必须接入当前页面激活判定，并验证离开页面后的逐出与下格升级。

没有 `SideBar` 入口的 Dock 子页面不算完整接入。内部调试页除外。

不要绕过 `DockableSidePanel` 自己挂载右侧页面，也不要修改 `flowcloudai-ui` 的 `SideBar` 来表达分栏多选。

## 验证清单

新增或改动 Dock 子页面后至少检查：

- 单栏布局正确，切换内容后草稿和滚动位置没有明显丢失。
- 面板调宽、拖到 1/5 以下折叠、收起后按住手柄展开并跟手均正常。
- 拖到最左只受 `maxWidthRatio` 限制，不会接管主工作区。
- 顶栏高度和按钮位置与已有 Dock 子页面一致。
- `Snapshot` 类上下布局页面没有被强制改成左右布局。
- 分栏配对测试中两格同时显示，分隔条拖拽、边缘收起和窗口变高后的比例均正确。
- 分栏状态下左右调宽可用，面板整体收起再展开后分栏状态不丢。
- 点击右侧图标栏会先退出分栏，再执行既有单栏行为。
- `npm run lint` 通过。
- 涉及 TypeScript 或组件结构变更时运行 `npm run build`。

提交前检查：

```bash
git diff --check
npm run lint
npm run build
```

如果只是纯文档更新，可以用 `git diff --check` 作为最低检查。

## 常见错误

- 在业务 CSS 中复制 `.dock-panel-main` 或 `.dock-panel-side` 的基础声明。
- 业务组件直接维护第二份分栏状态或拖拽算法。
- 页面作用域内容失活后仍留在 Dock。
- 把未登记的组合直接传给 `DockableSidePanel`。
- 侧栏筛选不用 `DockPanelSidebarControls`，导致控件密度和 hover 状态不一致。
- 为了局部修正使用 `!important`。
- 只测试单栏，没有用临时配对验证分栏。
