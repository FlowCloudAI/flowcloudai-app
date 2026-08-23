# 移动端 AI 模式菜单实现 QA

- 日期：2026-08-19
- 设计基准：`selected-marker-only-menu.design.svg`
- 实机：Redmi 24129RT7CC（Android，1220 × 2712 截图）
- 实现范围：`app_main` 共用移动端 React/CSS，iOS 与 Android 生效；本轮仅完成 Android 原生运行验证

## 对比证据

- 设计稿与实机并排：`implementation-comparison.png`
- Android 完整实机截图：`implementation-android-real-device.png`

## 视觉核对

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| 容器 | 通过 | 根据真机反馈由 172px 收紧为 156px 语义宽度；保留 14px 语义圆角和 1px 边界，浮层玻璃效果沿用既有移动端菜单实现 |
| 行高与命中区 | 通过 | 三行均为 52px 可视/命中高度，高于 48px 移动端基线 |
| 选中态 | 通过 | 无整行填色；仅左侧 2px 主色标记、主色图标/标题、普通 SVG 对钩 |
| 对钩位置 | 通过 | 对钩直接位于标题后，间距使用 `--mobile-gap-text`，无独立尾部网格列或容器 |
| 图标 | 通过 | 根据首轮真机反馈由 18px 调整为 22px；模式菜单单独使用 1.7px 描边，不改变输入区胶囊图标的既有描边 |
| 字体层级 | 通过 | 标题 14px/500、说明 11.5px/400，并随 `--mobile-font-scale` 缩放 |
| 文案 | 通过 | 读者模式/只读取资料；助手模式/写入前确认；作家模式/写入免确认 |

## 交互核对

- 点击“读者模式”后菜单关闭，输入区模式胶囊更新为“读者”。
- 再次打开菜单并选择“助手模式”后，状态恢复为验证前的助手模式。
- 菜单使用 `role="menuitemradio"`、`aria-checked`，选中态不只依赖颜色。

## 自动验证

- `node --test --experimental-strip-types ./src/app/mobile/mobileAccessibility.test.mjs`：16/16 通过
- `npm run lint`：通过
- `npm run build`：通过（保留项目既有大 chunk 警告）
- `git diff --check`：通过

## 缺陷分级

- P0：无
- P1：无
- P2：无

## 未覆盖项

- iOS 由相同 touch-density 移动端组件与样式覆盖，但本轮未在 iPhone 上进行运行时截图验收。
