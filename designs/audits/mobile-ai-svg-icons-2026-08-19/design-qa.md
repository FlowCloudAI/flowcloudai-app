# 移动端 AI 操作图标落实视觉 QA

- source visual truth: `review-board.png` 与同目录五枚 SVG
- implementation screenshots: `android-actual-main.png`、`android-actual-model-menu.png`、`android-actual-tool-mode-menu.png`
- device: Android 真机 24129RT7CC，1220 × 2712 截图
- state: 亮色主题、空 AI 会话、模型菜单展开、权限模式菜单展开

## 对照结论

- 切换插件：使用审定后的加宽插头轮廓；18px 菜单尺寸下插脚、主体和尾线均清晰，没有裁切。
- 深度思考：保留内部填充与外部描边；输入区 capsule 内轮廓完整，没有再次呈现为两个三角形。
- 读者模式：开书轮廓与中轴在菜单大尺寸和输入区小尺寸下均可辨识。
- 助手模式：盾牌与对钩保持居中，激活色正确继承 `currentColor`。
- 作家模式：铅笔轮廓、笔尖和分段线清晰，视觉重量与其余两种模式一致。
- 五枚图标均使用 24 × 24 viewBox 与 2.1 描边；没有新增硬编码颜色。

## Findings

未发现 P0、P1、P2 视觉偏差。权限菜单中作家模式说明文字的末尾截断属于既有菜单宽度行为，不在本次图标落实范围内。

## 验证

- `node --test --experimental-strip-types ./src/app/mobile/mobileAccessibility.test.mjs`
- `npm run lint`
- `npm run build`
- Android 真机 HMR 运行态截图核对

final result: passed
