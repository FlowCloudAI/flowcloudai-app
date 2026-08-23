# 词条默认封面层级调整视觉 QA

> **状态：结论记录（视觉证据已丢失）** ｜ QA 日期：2026-08-08
>
> 原始截图存放在当时 Windows 工作机的 `C:\Users\...\.codex\` 下，不在本仓库内，现已不可复核。
> 本文只保留结论与判据描述；**结论无法再被证据反驳，引用时按“当时的判断”看待，不要当作现状**。
> 后续设计 QA 一律按 `designs/audits/<主题>-<日期>/` 的做法把截图提交进仓库。

- source reference image: 同上；用户明确要求移除重复类型方框，并把首字移出下部信息区
- implementation screenshot path: unavailable
- viewport: unavailable
- source pixel dimensions: unavailable for the final revised HTML state
- implementation pixel dimensions: unavailable
- CSS size / density normalization: not performed
- state: 深色主题、桌面与移动端词条卡片无封面状态

## Full-view comparison evidence

未执行。词条卡片依赖 Tauri 本地数据；项目规范禁止把浏览器 mock 当作原生真实状态证据。本次未取得修改后的桌面原生应用与 Android 真机截图。

## Focused region comparison evidence

未执行。缺少修改后截图，无法确认右上首字在真实卡片比例、悬停展开和目标设备字体回退下的最终位置。

## Findings

- [P2] 修改后的首字安全区尚未取证
  - Location: 桌面与移动端词条卡片默认封面。
  - Evidence: 已移除重复类型方框，并把首字移到右上，但没有修改后的原生截图可与来源截图并排比较。
  - Impact: 编译通过不能证明不同卡片宽度与悬停展开时都没有遮挡。
  - Fix: 在桌面原生应用与 Android 真机打开同一批无封面词条并截图比较。

## Required fidelity surfaces

- Fonts and typography: 首字继续使用行楷字体栈并回退到 `--fc-font-family`；目标设备效果待截图确认。
- Spacing and layout rhythm: 左上角只保留类型标签，首字固定在右上安全区；实际比例待截图确认。
- Colors and visual tokens: 首字颜色继续由词条类型色与 `--fc-color-text-on-primary` 混合，透明度为 0.34。
- Image quality and asset fidelity: 本次没有新增或替换图片资源。
- Copy and content: 首字仍跳过书名号和标点；类型名称只显示一次。

## Comparison history

来源截图已确认重复方框和下部遮挡问题；代码修正已完成，尚缺修改后的原生截图完成第二轮比较。

## Implementation checklist

1. 桌面原生词条网格截取修改后的相同四张卡片。
2. Android 真机截取一组无封面词条卡片。
3. 核对首字是否避开左上标签与下部信息区。

final result: blocked
