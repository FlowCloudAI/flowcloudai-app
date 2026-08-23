# FlowCloudAI iOS 调试与打包

本文只描述 `app_main` 的 iOS 流程。客户端最低支持 iOS 16.2；Windows、Android 与桌面端命令不受这些脚本影响。iOS 生成工程仍位于已忽略的 `src-tauri/gen/apple`，可随时重建。

## 1. 首次准备

以下操作在 macOS 的 `app_main` 根目录执行。

1. 安装完整 Xcode，并在 Xcode 登录 Apple 账户。
2. 安装前端依赖：`npm install`。
3. 将签名 Team 只配置到本机终端，不写入仓库：

   ```zsh
   export APPLE_DEVELOPMENT_TEAM="你的 Team ID"
   ```

   如需长期生效，可把这一行写入本机 `~/.zshrc`。Team ID 可在 Xcode 的账户或 Signing & Capabilities 页面查看。

4. 检查环境：

   ```zsh
   npm run ios:doctor
   ```

5. 仅在 `src-tauri/gen/apple` 不存在，或 iOS 模板/原生配置改变后初始化工程：

   ```zsh
   npm run ios:init
   ```

`ios:init` 使用仓库内的 [`src-tauri/ios/project.yml`](../src-tauri/ios/project.yml)。Xcode 构建 Rust 时会进入 [`scripts/ios-xcode-build.sh`](../scripts/ios-xcode-build.sh)，因此重新生成工程后无需再手工修改 `PATH`。

### AppIcon 来源与同步

受 Git 跟踪的 [`src-tauri/icons/ios`](../src-tauri/icons/ios) 是 iOS AppIcon 的唯一来源。仓库工作流会在 `ios:init`、`ios:dev`、`ios:run`、Archive 与 IPA 构建前，把这些图标同步到生成工程的 `Assets.xcassets/AppIcon.appiconset`；`ios:doctor` 会把生成图标过期视为失败。

如果只从 Xcode 打开既有生成工程、没有先运行上述工作流，执行一次：

```zsh
npm run ios:sync-icons
```

Xcode 工程的 Pre-build 阶段也会再次同步。不要直接把 `src-tauri/gen/apple` 中的默认 Tauri 图标当成长期来源或提交生成目录。

## 2. 日常调试

### 真机热更新

Mac 和 iPhone 连接同一局域网，iPhone 已启用开发者模式并信任 Mac，然后执行：

```zsh
npm run ios:dev -- "iPhone 在 Xcode 中显示的名称"
```

需要在 Xcode 中查看完整运行日志时：

```zsh
npm run ios:dev -- "iPhone 在 Xcode 中显示的名称" --open
```

热更新模式会让 iPhone 访问 Mac 上的 Vite 服务。首次运行应允许“本地网络”权限；若页面一直停在“正在启动”，先确认两台设备同网、macOS 防火墙未拦截 5175 端口，并检查终端/Xcode 是否出现开发服务器连接错误。

### 使用打包后的前端回归

这条链路不依赖局域网开发服务器，更接近安装包实际行为：

```zsh
npm run ios:run -- "iPhone 在 Xcode 中显示的名称"
```

功能修复不能只以编译成功为准。至少在真机验证启动、项目/聊天数据恢复、文件访问、后端日志和双指缩放。

### 模拟器 Debug 构建

```zsh
npm run ios:build:sim:debug
```

模拟器适合基础界面检查，不替代真机权限、签名、沙箱与 WebView 手势验证。

## 3. IPA 与 Archive

iOS 的 `Version` 来自 `src-tauri/tauri.conf.json`；正式构建的 `Build Number` 必须由命令显式提供。Build Number 只能为 1 至 3 段整数，第一段最多 4 位，第二、三段最多 2 位，并且上传 App Store Connect 时应递增。日常直接使用 `1`、`2`、`3` 这类整数最简单。

工作流直接设置 `CFBundleVersion`，不使用 Tauri 的原生 `--build-number` 拼接行为；因此传入 `42`，最终 Build Number 就是 `42`。

### 开发签名 IPA

```zsh
npm run ios:build:debug
```

### 注册设备测试 IPA

用于已登记设备的测试分发，不是 TestFlight：

```zsh
IOS_BUILD_NUMBER=42 npm run ios:build:release-test
```

### TestFlight / App Store Connect IPA

TestFlight 与 App Store 都走 App Store Connect 导出：

```zsh
IOS_BUILD_NUMBER=42 npm run ios:build:appstore
```

脚本只生成并校验本地文件，不会自动上传。上传前仍需在 App Store Connect 创建应用记录并准备有效的分发证书/描述文件；可使用 Xcode Organizer 或 Apple Transporter 上传。

### 仅生成 Xcode Archive

需要在 Xcode Organizer 中人工检查或导出时：

```zsh
IOS_BUILD_NUMBER=42 npm run ios:archive
```

## 4. 产物位置

原始 Tauri/Xcode 输出位于：

```text
src-tauri/gen/apple/build/arm64/
```

完成 IPA 构建后，工作流会复制出命名稳定的文件与 SHA-256 校验文件：

```text
artifacts/ios/flowcloudai-ios-v<Version>-b<Build Number>-<导出方式>.ipa
artifacts/ios/flowcloudai-ios-v<Version>-b<Build Number>-<导出方式>.ipa.sha256
```

`src-tauri/gen/apple` 和 `artifacts/ios` 均不提交 Git。正式发布应保存对应 IPA、Archive、dSYM、版本号和上传记录。

## 5. 签名账户边界

- 免费 Personal Team 可用于自己的真机开发，但不承担 TestFlight/App Store 正式分发流程，且开发签名安装具有较短有效期。
- TestFlight、App Store 或面向测试人员的长期分发需要加入 Apple Developer Program，并配置 App Store Connect。
- `APPLE_DEVELOPMENT_TEAM`、Apple ID、设备 ID、证书和描述文件都是本机/发布环境配置，禁止写入仓库。

## 6. 常见错误

### `PhaseScriptExecution failed with a nonzero exit code`

先看其上方第一条具体错误。本仓库的 Xcode 阶段通过 `scripts/ios-xcode-build.sh` 寻找 Node、Cargo 和本地 Tauri CLI。Tauri 构建脚本需要读取仓库内的 `src-tauri`、`target` 与前端产物，因此跟踪模板对 iOS Target 固定关闭了 Xcode 的 User Script Sandboxing。若仍提示找不到命令或无法识别 Tauri 项目，先执行 `npm run ios:doctor` 并重新运行 `npm run ios:init`，不要直接编辑 `src-tauri/gen/apple` 中的生成文件。

### `Blocking waiting for file lock on iOS`

旧的 `ios:dev` / Xcode 调试会话仍在持有 Rust 输出目录。先在旧终端按 `Ctrl+C`，或结束由 `ios:dev --open` 启动的调试会话，再重新打包。仓库工作流会在打包前检查这把锁并直接给出占用进程 PID，避免无期限等待。

### iPhone 无法访问 `http://<Mac IP>:5175`

这是热更新链路的局域网问题：在 iPhone 的“设置 > 隐私与安全性 > 本地网络”允许流云AI，确认同网后重启 App。也可用 `npm run ios:run` 判断业务本身是否正常。

### Signing / Provisioning Profile 失败

确认当前终端存在 `APPLE_DEVELOPMENT_TEAM`，Xcode 已登录正确账户，Bundle Identifier 可用，并在 Signing & Capabilities 使用 Automatically manage signing。个人账户能真机调试，不代表具备 App Store 分发资格。

### `Operation not permitted (os error 1)`

若路径包含旧的 `/Containers/Data/Application/<UUID>`，说明应用仍在读取上一次安装的绝对沙箱路径。移动端必须使用当前系统分配的应用数据目录，不能把绝对沙箱路径持久化为自定义数据目录。

## 7. 发布前最小检查表

- `npm run lint`
- `npm run build`
- `npm run ios:doctor`
- `npm run ios:run -- "设备名称"` 完成真机回归
- 递增 `IOS_BUILD_NUMBER`
- 生成 `app-store-connect` IPA
- 核对 IPA 的 `.sha256`
- 在 App Store Connect/TestFlight 再做一次安装与数据回归

参考资料：

- [Tauri iOS 前置环境](https://v2.tauri.app/start/prerequisites/)
- [Tauri 环境变量](https://v2.tauri.app/reference/environment-variables/)
- [Tauri App Store 分发](https://v2.tauri.app/distribute/app-store/)
- [Apple：准备 App 分发](https://developer.apple.com/documentation/xcode/preparing-your-app-for-distribution)
