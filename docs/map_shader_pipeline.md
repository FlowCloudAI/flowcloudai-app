# 地图 Shader 渲染管线

> 状态：`现行`（Phase 1–3 与 4.1 已落地，Phase 4.2/4.3 未实施）
> 实施日期：2026-07-09 ｜ 合并日期：2026-08-19
> 范围：`app_main` 世界地图的 Pixi 风格化渲染（`src/features/maps/styles/pixi/`）
>
> 本文由 `todo/` 下 12 篇同日产出的 shader / 水墨文档合并而成，原件已删除（见 git 历史）。
> **合并时发现的关键事实：性能基准测试从未执行**，详见 §6。

## 1. 为什么做

原实现把特效放在 Canvas 2D overlay：CPU 端生成完整纹理 → `toDataURL()` → 上传 GPU 作 Sprite。
实现简单、易调试，但 CPU 密集，且任何 scene 变化都要重绘整张纹理。

托尔金风格 1920×1080 场景的耗时分解（迁移前）：

| 操作 | 耗时 | 占比 |
| --- | ---: | ---: |
| `drawSeaDepthBands()` | ~180ms | 35% |
| `drawCoastlineHatching()` | ~120ms | 23% |
| `drawPixiEffectAsset('paper-grain')` | ~80ms | 16% |
| `drawSeaWaves()` | ~60ms | 12% |
| 其他效果 | ~40ms | 8% |
| `toDataURL()` + 纹理上传 | ~35ms | 7% |
| **总计** | **~515ms** | 100% |

三个核心瓶颈：

1. **形态学膨胀多 pass**——托尔金风格 4 层晕线 × 6 层海洋深度 = 10+ 次完整 canvas 遍历，每次都要 `clearRect` + `drawImage` + 合成。
2. **随机点生成**——纸张颗粒在 1920×1080 上约 33 万次随机数；海浪 48px 网格约 1000 个波段，每段 50+ 次 `lineTo`。
3. **无法缓存**——任何编辑操作都触发完整重绘。

## 2. 架构

插件化，每个效果提供 **shader 与 canvas 双实现**，运行时按 WebGL 支持情况自动选择：

```typescript
interface PixiPluginImplementation {
    id: string
    pluginType: 'decoration' | 'effect'
    defaultImplementation: 'shader' | 'canvas'
    createRenderer: (params, impl) => PluginRenderer
}

type PluginRenderer =
    | { type: 'shader', filter: Filter, update: (ctx) => void }
    | { type: 'canvas', render: (ctx, context) => void }
```

降级判定：

```typescript
const useShader = detectWebGLSupport() && style.useShaderOptimization !== false
```

距离场用 **Jump Flooding Algorithm** 生成，`O(log N)` passes，一次计算供多个 shader 共享——这是把多 pass 形态学膨胀替换掉的关键。

配置入口仍是 `PixiMapStyle` 的 `decorations[]` / `effects[]`，即调用方接口未变，只是实现从 Canvas 2D 换成 GLSL。

## 3. 已实现的插件

**通用效果（8 个）**

| 插件 ID | 类型 | 功能 |
| --- | --- | --- |
| `paper-grain` | effect | 纸张颗粒纹理 |
| `vignette` | effect | 边缘晕影 |
| `edge-darken` | effect | 边缘加深 |
| `chromatic-ageing` | effect | 色度老化 |
| `ink-bleed` | effect | 墨水晕染 |
| `sea` | decoration | 海洋深浅 + 海浪 |
| `coastline-outline` | decoration | 海岸线晕线 |
| `land-depth` | decoration | 陆地纵深 |

**水墨专属（2 个，Phase 4.1）**

| 插件 ID | 类型 | 功能 |
| --- | --- | --- |
| `brush-stroke` | decoration | 毛笔笔触 + 飞白 |
| `ink-wash` | decoration | 淡墨浓淡渐变 |

共 10 个插件 / 20 个实现（每个含 shader + canvas fallback），12 个 GLSL shader，约 3400 行。

## 4. 水墨核心技术

毛笔笔触——边缘曲率驱动提按顿挫，随机噪声制造飞白，距离衰减控制墨色浓淡：

```glsl
float curvature = getEdgeCurvature(...);
float pressure = mix(0.7, 1.4, smoothstep(0.0, 0.3, curvature));

if (edgeNoise < u_dryBrushThreshold) discard;   // 飞白

float inkDensity = mix(1.0, 0.3, distToCoast / strokeWidth);
```

淡墨渐变——三层叠加模拟「墨分五色」：

```glsl
float layer1 = smoothstep(width * 0.3, 0.0, dist) * 0.4;  // 浓
float layer2 = smoothstep(width * 0.6, 0.0, dist) * 0.3;  // 中
float layer3 = smoothstep(width, 0.0, dist) * 0.2;        // 淡
```

## 5. 推荐配置

三档配置的插件组合与预估耗时：

| 配置 | 插件数 | 预估耗时 | 适用 |
| --- | ---: | ---: | --- |
| 轻量级 | 3 | ~6ms | 移动端、低端设备 |
| **基础（推荐）** | 5 | ~11ms | 平衡 |
| 增强 | 6 | ~15ms | 桌面端、高端设备 |

基础配置：`decorations` 用 `brush-stroke` + `ink-wash`，`effects` 用 `paper-grain` + `ink-bleed` + `chromatic-ageing`。各插件的参数取值见 `src/features/maps/styles/pixi/presets/ink.ts`——**参数以源码为准，不以本文为准**。

## 6. 性能数据的可信度（重要）

原 12 篇文档给出的加速倍数（单插件 8×–90×、整体「20–65× 平均加速」、托尔金缩放平移 490ms → 13ms 等）**全部是预估或理论推算，不是实测**。

依据：`性能基准测试` 在 Phase 1、Phase 3、Phase 4.1 的完成报告以及项目总结里都被列为**未完成项**；`phase4_partial_complete.md` 的水墨性能章节标题即为「性能预估」。

已实际验证的只有：`npm run build` 通过、TypeScript 类型检查通过、shader 编译成功。

**引用这些倍数前必须先做基准测试。** §1 的迁移前 profiling 数据来源同样未在文档中注明测量方法，同等对待。

## 7. 未完成

**功能**

- Phase 4.2 朱红闲章 + 落款（Canvas 2D 绘制，右上角朱红方印 + 右侧竖排题名）
- Phase 4.3 多层墨韵增强（增强现有 `ink-bleed`，焦墨核心 + 多层外晕）
- 项目 D 稀疏水纹（新 shader `water-ripple`）
- 项目 E 皴法山峦（新 shader `mountain-texture`，工作量大）

**工程债务**

- **性能基准测试**——见 §6，最高优先级
- 距离场每次重新生成，未做缓存复用
- Pixi `Application` 临时创建，应复用单例
- 距离场算法缺自动化测试
- `distanceFieldTest.ts` 的可视化调试函数未完成

**已识别风险（原方案记录，未复核）**

- 距离场精度不足可能导致晕线断裂或自交
- GLSL 调试成本高，维护门槛高于 Canvas 2D
- 迁移前后视觉一致性未做逐像素对比

## 8. 相关文档

- `Ink.md` — 水墨（宣纸）预设的视觉优化分析，只谈视觉
- `Tolkien.md` — 托尔金（羊皮纸）预设的视觉优化分析，只谈视觉
- `coastline_algorithm_redesign.md` — 海岸线自然化算法，`coastline_v2.rs`
- `semantic_map_generation_design.md` — 语义化控制与确定性渲染引擎设计
