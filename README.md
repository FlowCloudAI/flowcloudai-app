# app_main

## 项目简介

`app_main` 是 FlowCloudAI 的桌面端核心工程，基于 Tauri 与 React 提供世界观编辑、关系图与插件协作入口。
它通过 `src-tauri` 提供本地持久化、系统能力和插件能力桥接，支持在桌面上完成创作闭环。

## 快速开始

```bash
cd app_main
npm install
npm run tauri -- dev
```

### 基础校验

```bash
npm run lint
npm run build
cd src-tauri
cargo check
cargo test
```

### iOS

iOS 客户端最低支持 iOS 16.2。

iOS 环境检查、真机调试、Archive 与 IPA 导出统一见
[`docs/tauri_ios_debug_and_release.md`](docs/tauri_ios_debug_and_release.md)。首次在 Mac 上进入仓库后先执行：

```bash
npm run ios:doctor
```

### macOS

macOS 原生窗口、日常调试、DMG、Developer ID 签名与公证流程见
[`docs/tauri_macos_debug_and_release.md`](docs/tauri_macos_debug_and_release.md)。首次准备执行：

```bash
npm run macos:doctor
npm run macos:dev
```

### 最小示例

1. 启动桌面端并创建一个世界观项目。  
2. 新增 2 个实体并建立 1 条关系。  
3. 触发一次 AI 会话，确认结果回写到编辑器。  

## 主要功能 / 使用方式

- 世界观项目、实体与关系编辑。  
- 地图与关系可视化预览。  
- AI 会话、插件加载、会话结果回写。  
- 桌面端签名与多平台构建（Windows/macOS/Linux/Android/iOS）。

## 技术栈

- Tauri 2、Rust 2024、React 19、TypeScript、Vite  
- `flowcloudai-ui`、`pixi.js`

## 目录结构（仅顶层）

```text
app_main/
├── src/
├── src-tauri/
├── public/
├── scripts/
└── docs/
```

## 许可证与贡献方式

- 许可证：`app_main/LICENSE`。  
- PR 需补充 `npm run lint`、`npm run build`、`cd src-tauri && cargo test` 结果与关键复现步骤。  
- 提交信息默认中文，描述风险与回退策略。  

文档同步时间：2026-08-16 21:20:00 +08:00
