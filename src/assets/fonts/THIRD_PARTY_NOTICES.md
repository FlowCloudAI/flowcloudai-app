# 字体第三方声明

本目录中的字体仅用于 FlowCloudAI 应用内的文字渲染。字体版权归各自权利人所有，项目自身的许可证不覆盖这些第三方字体。

## Noto Sans CJK

- 文件：`noto-sans-cjk/NotoSansSC-VF.ttf`、`NotoSansTC-VF.ttf`、`NotoSansJP-VF.ttf` 及对应 `.woff2`
- 版权：© 2014–2021 Adobe；保留字体名称 `Source`
- 来源：https://github.com/notofonts/noto-cjk
- 许可：SIL Open Font License 1.1，完整文本见 `noto-sans-cjk/OFL.txt`

## Noto Serif CJK

- 文件：`noto-serif-cjk/NotoSerifSC-VF.ttf`、`NotoSerifTC-VF.ttf`、`NotoSerifJP-VF.ttf` 及对应 `.woff2`
- 版权：© 2017–2024 Adobe；`Noto` 是 Google Inc. 的商标
- 来源：https://github.com/notofonts/noto-cjk
- 许可：SIL Open Font License 1.1，完整文本见 `noto-serif-cjk/OFL.txt`

## LXGW WenKai / 霞鹜文楷

- 文件：`lxgw-wenkai/LXGWWenKai-Regular.ttf`、`LXGWWenKai-Regular.woff2`
- 版权：© 2021–2026 LXGW；© 2020 The Klee Project Authors
- 来源：https://github.com/lxgw/LxgwWenKai
- 许可：SIL Open Font License 1.1，完整文本及保留名称、网页字体格式转换附加许可见 `lxgw-wenkai/OFL.txt`

## XuanZongTi / 玄宗体（子集）

- 文件：`xuanzongti/XuanZongTi-ThemeNames.woff2`
- 版权：© 2026 Yuchen Tian（发行方 OFL 未声明保留字体名称）
- 版权（字体二进制内嵌声明）：© 2017–2024 Adobe，保留字体名称 `Source`；
  设计者字段列有 Ryoko NISHIZUKA、Frank Grießhammer、Wenlong ZHANG、Sandoll Communications
- 来源：https://github.com/kaonashi-tyc/Zi-XuanZongTi
- 许可：SIL Open Font License 1.1，完整文本见 `xuanzongti/OFL.txt`
- 说明：本仓库内嵌的不是完整字体，而是只含颜色主题六个配方名所需 12 个字
  （流云紫藤青松晚霞墨蓝绛梅）的子集，由原始 `XuanZongTi-v0.1.otf`（38.6 MB）
  经 fontTools 转换为 woff2 得到（27 KB）。子集版本的主要字体名仍为 `XuanZongTi`，
  不含保留名称 `Source`，符合 OFL 第 3 条。

## 分发要求

- 字体可以嵌入并随商业软件分发，但不得作为独立商品出售。
- 发布包含字体文件的安装包时，必须同时保留本声明及相应的 `OFL.txt`。
- 修改、合并、子集化或转换字体格式时，必须继续遵守对应 OFL 文本中的保留名称和衍生字体条款。
- 玄宗体的二进制内嵌声明来自 Adobe Source Han 的构建配置（版本号 `2.003;hotconv;makeotfexe`
  与设计者字段均为 Source Han 原值），发行方自己的 OFL.txt 只署 Yuchen Tian。
  两处署名不一致，因此上面同时列出；若上游澄清了衍生关系，应据实收敛为一处。
