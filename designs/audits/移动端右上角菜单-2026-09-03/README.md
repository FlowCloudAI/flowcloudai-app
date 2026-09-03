# 移动端右上角展开菜单 —— 现状截图

**状态**：归档（一次性证据，记录 2026-09-03 当时的实现）
**日期**：2026-09-03

## 捕获条件

- 小米 24129RT7CC / Android 16 / WebView 143，DPR 3.25，CSS 视口 375×834
- 主题：浅色；应用为 `npm run android:build:dev` 产出的 aarch64 debug APK
- 通过 `adb screencap` 全屏截图后，按浮层在视口里的 `getBoundingClientRect()` 裁剪，各留 14px 上下文
- 对应源码状态：`0fac8ad`

## 清单

| 文件 | 入口 | 组件 |
| --- | --- | --- |
| `01-首页-世界列表操作.png` | 首页顶栏右侧 | `MobileAnchoredMenu` + 自定义 children |
| `02-项目主页-项目管理.png` | 项目主页顶栏右侧 | `MobileAnchoredActionMenu` |
| `03-关系图谱-更多操作.png` | 关系图谱顶栏右侧 | `MobileAnchoredActionMenu`（无图标） |
| `04-词条详情-更多操作.png` | 词条详情顶栏右侧 | `MobileAnchoredActionMenu` |
| `05-灵感-灵感操作.png` | 灵感顶栏右侧 | `MobileAnchoredActionMenu` |
| `06-AI对话-对话操作.png` | AI 对话顶栏右侧 | `MobileAnchoredActionMenu` + `.mobile-ai-conversation-menu` |
| `07-共享ActionMenu-对话列表行.png` | AI 对话列表行的「⋯」 | `shared/ui/overlay/ActionMenu`（居中浮层） |

## 一处没能现场捕获

设定检测页顶栏右侧的「更多报告操作」也走 `shared/ui/overlay/ActionMenu`，但该按钮只在
**已打开某份报告**时出现，当前项目没有任何报告，生成一份需要真实消耗 AI 调用。
`07` 是同一个组件从 AI 对话列表行触发的形态，可作为它的视觉替身；
两者的差异只在 `title` 与条目文案，容器、行高、字号、危险色行为完全一致。
