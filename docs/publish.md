# FlowCloudAI 发布流程

> 本文档记录桌面端 Windows 发布与 Tauri 自动更新包上传流程。发布前先确认私钥、版本号、构建产物和站点后台权限都准备完整。

## 一、首次准备

1. 生成 Tauri updater 签名密钥：

```powershell
cd <工作区根>/app_main
npm run tauri signer generate -- -w "$env:USERPROFILE\.tauri\flowcloudai.key"
```

2. 将生成的公钥文件内容写入 `app_main/src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。

3. 妥善保存私钥文件和密码：

- 私钥文件：`%USERPROFILE%\.tauri\flowcloudai.key`
- 公钥文件：`%USERPROFILE%\.tauri\flowcloudai.key.pub`
- 私钥和密码不得提交仓库、不得发给他人。
- 如果私钥或密码丢失，旧客户端将无法继续通过 updater 接收新版本。

## 二、每次发布前检查

1. 递增版本号，并保持以下文件一致：

- `app_main/src-tauri/Cargo.toml`
- `app_main/src-tauri/tauri.conf.json`

2. 确认当前工作区没有无关改动：

```powershell
cd <工作区根>/app_main
git status --short
```

3. 建议先运行基础检查：

```powershell
npm run lint
npm run build

cd src-tauri
cargo check
```

## 三、构建 Windows 发布包

每次新开 PowerShell 后，都需要重新设置签名环境变量：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH="$env:USERPROFILE\.tauri\flowcloudai.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD="你的私钥密码"

cd <工作区根>/app_main
npm run tauri:build:windows
```

构建完成后，在 `app_main/src-tauri/target/release/bundle/` 下查找产物：

- 普通安装包：上传到官网后台“上传安装包”，供下载页使用。
- Tauri updater artifact：上传到官网后台“上传自动更新包”，供应用内自动更新使用。
- 对应 `.sig` 文件：在“上传自动更新包”表单中选择 `.sig` 文件，或粘贴 `.sig` 文件内容。

注意：自动更新表单里的签名必须是 `.sig` 文件内容，不是 `.sig` 文件地址。

## 四、上传到站点后台

1. 进入 `site_flowcloudai` 管理后台。

2. 如只需要官网/公开测试下载，不需要应用内自动更新，在“安装包”区域上传普通安装包：

- 版本号填写 SemVer，例如 `0.1.2`。
- 上传普通 Windows 安装包。
- 需要作为官网默认下载时，设为默认。

3. 如需要应用内自动更新，在“自动更新包”区域上传 updater artifact：

- 版本号填写同一个 SemVer。
- 平台使用 `windows / x86_64`。
- 上传 updater artifact。
- 选择对应 `.sig` 文件，或手动粘贴签名内容。
- 勾选默认，使客户端检查更新时使用该版本。
- 当 updater artifact 是 `.exe` 或 `.msi` 时，后台会自动同步为公开下载版本；勾选默认时也会同步为官网默认下载版本。

## 五、发布后验证

假设旧版本为 `0.1.1`，新版本为 `0.1.2`：

```powershell
curl https://www.flowcloudai.cn/api/v1/app-updates/windows/x86_64/0.1.1
```

应返回包含 `version`、`url`、`signature` 的 JSON。

```powershell
curl -i https://www.flowcloudai.cn/api/v1/app-updates/windows/x86_64/0.1.2
```

应返回 `204 No Content`。

最后使用旧版已安装客户端手工验证：

1. 打开“设置 -> 关于”。
2. 点击“检查更新”。
3. 确认显示新版本。
4. 点击“安装并重启”。
5. 更新完成后确认应用版本号已变为新版本。

## 六、常见问题

- 没有生成 `.sig`：通常是没有设置 `TAURI_SIGNING_PRIVATE_KEY_PATH` 或私钥密码。
- 客户端显示无更新：通常是版本号未递增、后台未设为默认，或接口返回了 `204`。
- 签名校验失败：确认后台保存的是 `.sig` 文件内容，且 artifact 与 `.sig` 来自同一次构建。
- Windows 安装失败：确认安装包类型正确，应用安装目录权限正常；当前 updater 使用 `passive` 安装模式。
