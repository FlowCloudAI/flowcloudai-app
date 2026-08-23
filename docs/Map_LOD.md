# 地图 Pixi LOD 实现报告

> 状态：归档 ｜ 记录日期：2026-05-26
>
> 「旧问题」与「为什么这次能解决」两节已抽成开发记录 `docs/devlog/2026-05-26-地图-lod-固定容差失效.md`（在工作区根仓库，不在本仓）。本文保留完整实现细节。

## 背景

`app_main/src/features/maps/components/MapShapeEditor/MapPixiPreview.tsx` 是当前地图预览的主渲染路径。Deck 已降为回退预览，SVG 主要承担编辑层交互。

本轮 LOD 工作的目标是降低 PixiJS 在大规模多边形预览下的绘制压力，尤其是海岸线生成后单个区域包含数千点时，缩放、平移和 hover 过程中不应始终按原始点数重绘。

当前 Pixi 预览已经完成以下基础优化：

- 预编译 shape，提前生成 `flatPolygon`、bbox、颜色等派生数据。
- fill / stroke 分层，避免 hover 或描边宽度变化拖着填充层一起重绘。
- viewport culling，只绘制可见区域内的 shape。
- 统一命中检测，hover 仍用原始 polygon 做精确判断。
- 性能统计输出 `visibleVertexCount`、`lodVertexCount`、`redrawVertexCount`、`hitTestMs` 等指标。

LOD 是在这些基础上继续减少实际绘制点数。

## 旧问题

### 1. 固定 tolerance 不可靠

最初的 LOD 方案使用固定几何容差：

```ts
overview: tolerance 18
low: tolerance 10
medium: tolerance 5
high: tolerance 2
```

后来调成更保守的多个版本，但实际表现仍不稳定。

用户在 7547 点数据上反馈过几组结果：

```text
原始: 7547
高:   1112
中:    625
低:    416
概览: 222
```

这说明高档位已经过度简化，不适合作为“接近原始”的近景预览。

随后放缓 tolerance 后，又出现另一种问题：

```text
原始: 7547
高:   7547
中:   7290
低:   4718
概览: 564
```

这说明高、中几乎没有收益，低和概览之间又存在断层。

根因是 Douglas-Peucker 对不同曲线的响应不是线性的。某些海岸线在某个容差区间内会保留大量点，一旦超过临界值又会突然丢失大量细节。固定 tolerance 很难同时保证不同地图、不同 shape、不同点密度下的档位稳定。

### 2. `minPointCount` 只能兜底，不能定义档位

早期实现中，每档有 `minPointCount`，当简化结果点数低于最低点数时，会改用均匀抽样兜底。

这个机制能避免过度简化到几乎不可识别，但不能稳定控制最终点数。它只在结果低于下限时介入；如果 Douglas-Peucker 返回 7290 点，而目标其实希望是 3000 到 4000 点，`minPointCount` 不会产生任何作用。

所以 `minPointCount` 适合作为安全阈值，不适合作为档位目标。

### 3. 旧自动选档使用 `transform.scale`，语义不对

早期自动档使用 Pixi transform scale：

```ts
scale < 0.5 -> low
scale < 1.5 -> medium
else -> high
```

这个 scale 是屏幕像素和当前 viewBox 的换算结果，受容器宽度影响，不等价于用户直觉上的“地图缩放倍率”。实际反馈中，即使画面缩小，也可能触发不到低档。

后来自动档改为基于 viewBox 相对 canvas 的 zoom ratio：

```ts
zoomRatio = transform.scale * scene.canvas.width / viewportWidth
```

这个值更接近“当前视图相对全图放大了多少倍”。全图视角约为 1，局部放大逐渐增大。

## 当前解决方案

### 1. 五档 LOD

当前 LOD 档位为：

```ts
export type MapPixiLodLevel =
  | 'overview'
  | 'low'
  | 'medium'
  | 'high'
  | 'original';

export type MapPixiLodSetting = 'auto' | MapPixiLodLevel;
```

含义如下：

```text
overview: 极简概览，用于全图/缩略视角
low:      低细节浏览
medium:   常规浏览
high:     高细节预览
original: 原始点，完全保真
auto:     根据 zoom ratio 自动选择
```

前端工具栏在 Pixi 引擎下提供手动入口：

```text
自动 / 概览 / 低 / 中 / 高 / 原始
```

### 2. 按目标点数比例生成 LOD

当前不再通过固定 tolerance 直接定义档位，而是通过目标点数比例定义档位：

```ts
overview: targetRatio 0.075
low:      targetRatio 0.25
medium:   targetRatio 0.5
high:     targetRatio 0.82
original: targetRatio 1
```

生成流程：

```text
原始 polygon
  -> 根据档位计算目标点数
  -> 使用 Douglas-Peucker
  -> 通过 tolerance 二分搜索逼近目标点数
  -> flatten 成 Pixi Graphics 可直接消费的 number[]
```

对于用户提供的 7547 点样例，当前实测结果为：

```text
original: 7547  100%
high:     6229  82.5%
medium:   3769  49.9%
low:      1888  25.0%
overview:  566   7.5%
```

这符合当前目标分布，说明点数控制已经稳定。

### 3. Douglas-Peucker 仍负责保形

实现没有改成简单均匀抽点。均匀抽点只作为异常兜底使用。

正式路径仍用 Douglas-Peucker，根据轮廓偏移量保留关键拐点，因此比纯点数抽样更能保持海岸线形状。

当前简化函数结构：

```text
simplifyPolygonDouglasPeucker
  -> 将闭合 polygon 拆成两条折线
  -> 分别做 Douglas-Peucker
  -> 拼回闭合轮廓

simplifyPolygonToTargetPointCount
  -> 二分搜索 tolerance
  -> 选择最接近目标点数的简化结果
```

### 4. 命中检测保持原始精度

LOD 只影响 fill / stroke 的视觉绘制点数。

hover / click 命中检测仍使用：

```ts
shape.source.polygon
```

这样可以避免低档位视觉简化后，交互命中出现明显误判。当前性能日志中 `hitTestMs` 仍处于较低水平，因此暂时没有必要牺牲命中精度。

## 为什么这次能解决

这次解决的核心不是“换了更合适的 tolerance”，而是换了控制变量。

旧方案控制的是：

```text
几何偏差容差
```

问题是容差和最终点数之间不是线性关系，且强依赖具体曲线形状。

新方案控制的是：

```text
目标点数比例
```

点数是性能成本的直接代理指标。Pixi Graphics 的 `poly/fill/stroke` 重绘成本和点数高度相关，因此用点数比例定义档位更符合性能优化目标。

这也让调参从“猜 tolerance”变成了“设定每档预算”：

```text
overview: 约 7.5% 点数
low:      约 25% 点数
medium:   约 50% 点数
high:     约 82% 点数
original: 100% 点数
```

在用户样例中，`redrawVertexCount` 约等于 `lodVertexCount * 2`，对应 fill 和 stroke 两层绘制。这说明统计口径和实际绘制路径已经对齐。

## 当前自动档逻辑

当前自动档根据 zoom ratio 选择：

```ts
zoomRatio <= 1.05 -> overview
zoomRatio <= 1.75 -> low
zoomRatio <= 3    -> medium
zoomRatio <= 6    -> high
else              -> original
```

其中：

```ts
zoomRatio = transform.scale * scene.canvas.width / viewportWidth
```

这个逻辑已经比旧的 `transform.scale` 更合理，但产品层面仍可能需要继续调整。

根据目前视觉反馈，后续可以考虑让自动档更保守：

```text
全图视角默认 low，而不是 overview
overview 仅用于手动极限概览、缩略图、小地图
```

这属于产品体验策略，不影响当前 LOD 生成模型。

## 性能与视觉验证口径

手动切换 LOD 时重点看：

```text
visibleVertexCount: 当前可见原始点数
lodVertexCount:     当前实际用于绘制的 LOD 点数
redrawVertexCount:  本轮实际重绘点数，通常接近 lodVertexCount * 2
drawMs:             Graphics 重绘耗时
hitTestMs:          命中检测耗时
lodLevel:           当前实际档位
```

一个健康样例：

```text
visibleVertexCount: 7547
original lodVertexCount: 7547
high     lodVertexCount: 6229
medium   lodVertexCount: 3769
low      lodVertexCount: 1888
overview lodVertexCount: 566
```

判断标准：

- `original` 用于完全保真对照。
- `high` 应接近原始，但有一定点数收益。
- `medium` 应明显降低点数，同时保留主要细节。
- `low` 应适合普通远景浏览。
- `overview` 应适合全图概览，允许明显简化。

## 风险与后续优化

### 1. 编译阶段成本上升

每个 shape 现在需要为 5 个档位生成 LOD，其中 4 个档位会运行 Douglas-Peucker 多次二分搜索。

这会增加 scene 编译成本，但发生在 scene/shape 数据变化时，不发生在每次 pan/zoom 中。相比缩放时反复重建复杂 Graphics，这是更可控的成本转移。

后续如数据继续增大，可以考虑：

- 缓存 shape LOD，按 shape id + polygon 版本复用。
- 将 LOD 编译移到 worker。
- 后端生成海岸线时直接附带多级 LOD。

### 2. 自动档仍需产品调参

当前自动阈值是工程合理值，不一定是最佳视觉体验值。建议继续用手动档收集反馈，再决定自动档是否改为：

```text
全图 -> low
远景 -> low / medium
普通浏览 -> medium
局部放大 -> high
近距离 -> original
```

### 3. 命中检测未来可能也要分级

当前 hover/click 使用原始 polygon，精度高，成本在现有样例中可接受。

如果未来 shape 数量和点数继续上升，命中检测可按以下顺序优化：

```text
bbox
-> 当前 LOD polygon 粗判
-> 原始 polygon 精确判定
```

### 4. 更长期的渲染路线

当前仍基于 Pixi Graphics。LOD 能显著降低 CPU 几何重建压力，但如果数据规模继续上升，可继续推进：

- 按 layer imperative 管理 Graphics，减少 React 组件数量。
- 更细的 viewport culling / tile culling。
- MeshGeometry 预三角化 fill。
- 屏幕空间 stroke mesh。

这些属于下一阶段，不应和当前 LOD 调参混在一起。

## 当前结论

当前 LOD 方案已经从“固定容差经验值”升级为“目标点数预算”模型。

这解决了此前两个关键问题：

```text
1. 档位点数不可预测
2. high/medium/low 不是稳定阶梯
```

当前样例已经形成稳定分布：

```text
100% / 82% / 50% / 25% / 7.5%
```

后续主要工作不再是 LOD 生成机制，而是：

```text
1. 自动档阈值的产品化调参
2. 更大数据集下的编译成本评估
3. 必要时引入 LOD 缓存或 worker
```
