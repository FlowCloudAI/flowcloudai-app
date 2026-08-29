# 移动端公共顶栏材质规范

> 状态：现行
> 日期：2026-08-26
> 适用范围：`MobilePageTopBar`、`MobileTopActionPill` 及其生产样式映射

## 1. 已确认参数

以下 JSON 是公共顶栏材质实验室在 2026-08-26 确认的亮暗模式基线，也是后续调整与回归对比的权威参数。交互实验入口为 `designs/mobile-topbar-material-lab.html`。

```json
{
  "light": {
    "pageBg": "#fffdfa",
    "pageSecondary": "#f5f4f3",
    "pageElevated": "#ffffff",
    "primary": "#378add",
    "text": "#1a1a1a",
    "textSecondary": "#646464",
    "barHeight": 110,
    "barPaddingX": 20,
    "barAngle": 180,
    "barBlur": 1,
    "barSaturation": 100,
    "barShadowY": 0,
    "barShadowBlur": 0,
    "barShadowOpacity": 0,
    "stops": [
      {"pos": 0, "alpha": 1},
      {"pos": 20, "alpha": 0.9},
      {"pos": 30, "alpha": 0.8},
      {"pos": 60, "alpha": 0.5},
      {"pos": 100, "alpha": 0}
    ],
    "pillHeight": 40,
    "pillRadius": 24,
    "pillPaddingX": 2,
    "pillGap": 0,
    "buttonSize": 38,
    "glassTint": "#ffffff",
    "pillGradientAngle": 180,
    "pillStartOpacity": 0.6,
    "pillEndOpacity": 0.25,
    "pillBlur": 2,
    "pillSaturation": 100,
    "borderColor": "#919191",
    "borderWidth": 0.6,
    "borderOpacity": 0.25,
    "highlightOpacity": 0.12,
    "shadowColor": "#1a1a1a",
    "shadowX": 0,
    "shadowY": 2,
    "shadowBlur": 15,
    "shadowSpread": 0,
    "shadowOpacity": 0.15,
    "preset": "custom"
  },
  "dark": {
    "pageBg": "#101010",
    "pageSecondary": "#1a1a1a",
    "pageElevated": "#222222",
    "primary": "#5da4e8",
    "text": "#ededeb",
    "textSecondary": "#aaa9a4",
    "barHeight": 112,
    "barPaddingX": 20,
    "barAngle": 180,
    "barBlur": 2,
    "barSaturation": 100,
    "barShadowY": 0,
    "barShadowBlur": 0,
    "barShadowOpacity": 0,
    "stops": [
      {"pos": 0, "alpha": 1},
      {"pos": 20, "alpha": 0.9},
      {"pos": 30, "alpha": 0.8},
      {"pos": 60, "alpha": 0.5},
      {"pos": 100, "alpha": 0}
    ],
    "pillHeight": 40,
    "pillRadius": 24,
    "pillPaddingX": 2,
    "pillGap": 0,
    "buttonSize": 38,
    "glassTint": "#2a2a2a",
    "pillGradientAngle": 0,
    "pillStartOpacity": 0.8,
    "pillEndOpacity": 0.25,
    "pillBlur": 2,
    "pillSaturation": 100,
    "borderColor": "#ffffff",
    "borderWidth": 0.6,
    "borderOpacity": 0.14,
    "highlightOpacity": 0.05,
    "shadowColor": "#000000",
    "shadowX": 0,
    "shadowY": 4,
    "shadowBlur": 15,
    "shadowSpread": 1,
    "shadowOpacity": 0.5,
    "preset": "custom"
  }
}
```

## 2. 生产映射

| 实验参数 | 生产实现 | 说明 |
| --- | --- | --- |
| 页面色、主色、文字色 | `flowcloudai-ui` 的 `--fc-*` 主题 token | 不在移动端重复硬编码主题；当前主题值与确认稿一致或由其推导 |
| `barPaddingX: 20` | `--mobile-page-topbar-x: var(--mobile-page-x)` | 实验里的 20px 没有整体落地：`--edge-to-edge` 的页面外扩与内边距相抵，内容列一直落在页面正文列上，只有 AI、灵感、时间线、关系图这几个不带页面内边距的顶栏真的缩进 20px。2026-08-29 统一取 `--mobile-page-x`（375px 视口 = 16px），横向安全区由该 token 自身兜住 |
| 屏幕顶部距离 | `--mobile-topbar-edge-gap` + `--mobile-topbar-safe-offset` | 按钮固定从安全区下沿再留 `group + text`；全屏 Portal 由公共顶栏自行补入顶部安全区 |
| 顶栏五段渐变 | `.mobile-page-topbar::before` | 五个位置与不透明度逐项对应 JSON |
| `barBlur` | `--mobile-topbar-bg-filter` | 亮色 1px、暗色 2px；独占顶栏背景伪元素 |
| 胶囊渐变、blur、边框、高光、阴影 | `--mobile-topbar-pill-*` + `.mobile-top-action-pill::before` | 胶囊有独立背景采样层，不与顶栏 blur 合并 |
| `pillHeight: 40` | `--mobile-top-surface-size: 2.5rem` | 公共胶囊视觉高度保持 40px |
| `buttonSize: 38` | `--mobile-topbar-primary-visual-size: 2.375rem` | 只控制主动作实心视觉圆，不缩小交互命中区 |

词条展示页的三按钮胶囊使用三个 `--mobile-top-surface-size`（40px）视觉轨道；按钮命中盒仍保持公共 48px 下限，在胶囊内部轻微交叠。这样图标中心距与 40px 材质高度一致，同时不把可点击区域缩成 40px。
展示页的编辑图标与 AI、更多动作保持同一透明按钮底，不使用主色实心圆；胶囊材质本身负责承载三个动作。

生产文件：

- `src/app/mobile/mobileTokens.css`：亮暗参数 token、高对比度回退。
- `src/app/mobile/components/MobileTopControls.css`：顶栏与胶囊的结构层、五段渐变、38px 主动作视觉圆。
- `src/glassEffect.css`：顶栏与胶囊各自独立的 `backdrop-filter`，以及关闭毛玻璃时的不透明回退。

## 3. 不直接照搬的实验尺寸

- `barHeight: 110 / 112` 包含实验手机画布里的模拟状态区。生产顶栏继续使用 `--mobile-topbar-edge-gap`、`--mobile-topbar-safe-offset` 和 `--mobile-top-surface-size` 计算，不能让主题切换改变页面几何。
- 普通移动页面的外壳已经位于安全区下沿，公共顶栏的 `--mobile-topbar-safe-offset` 为零；全屏 Portal 从物理屏幕顶端开始，公共顶栏会把它切换为 `--mobile-safe-top`。图片浏览器、沉浸编辑器不得再自行添加顶部安全区。
- `buttonSize: 38` 是视觉直径。生产按钮继续保留至少 44px 的实际交互区域，并由移动端可访问性规则扩展到平台要求的最小命中区。
- `pillRadius: 24` 在生产中使用 `--fc-radius-full`，避免胶囊长度变化后失去完整圆角。

## 4. 降级约束

- 关闭全局毛玻璃时，胶囊改为不透明 `--fc-color-bg-elevated`，顶栏与胶囊滤镜均为 `none`。
- 系统高对比度或 Reduce Transparency 生效时采用同样的不透明回退，并去掉装饰性高光与外阴影。
- 视觉验收应分别覆盖亮色与暗色；代码检查或浏览器模拟不等于 Android/iOS 真机像素验收。
