# 移动端词条链接导航 —— 真机证据（2026-08-25）

> **状态**：现行 ｜ **日期**：2026-08-25
> 排障过程与结论见 `docs/devlog/2026-08-25-移动端预览链接把应用打没.md`（工作区根仓库）。

## 设备与构建

| 项 | 值 |
| --- | --- |
| 设备 | Xiaomi 24129RT7CC（rodin），Android 16 |
| 构建 | `npm run android:build:dev` 的 universal debug APK，versionName 0.1.4 |
| 前端 | `mobile-entry-editor-refactor` 分支，修复前为 `6d77fa5`，修复后为本轮改动 |
| 视口 | 375 × 834 CSS px，devicePixelRatio 3.25 |

## 截图

| 文件 | 内容 |
| --- | --- |
| `android-查看态.png` | 词条查看态首张真机截图。此前的 `mobile-entry-editor-2026-08-24/` 只覆盖编辑链路，查看态零证据。 |
| `android-修复前-双链点击错误页.png` | 编辑态预览里点一次双链后的结果：整个应用被替换成 `net::ERR_UNKNOWN_URL_SCHEME` 错误页。 |
| `android-修复后-双链点击应用仍在.png` | 同一操作在修复后的构建上：应用仍停在编辑页，正文与未保存状态都在。 |

## 抓取方式

此机 `adb exec-out screencap` 与 raw 模式会被 signal 3/36 杀掉，只能落盘再 `pull`：

```bash
adb shell rm -f /sdcard/__cap.png && adb shell screencap -p /sdcard/__cap.png && adb pull /sdcard/__cap.png ./out.png
```

`screencap` 偶发返回 164（同样是被信号杀掉），重试即可。**每次务必先 `rm` 旧文件**，否则 `pull` 会拿到上一轮的陈图。

页面状态与计算样式通过 CDP 读取：

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof cn.flowcloudai.www)
```

再用 Node 内置 `WebSocket` 连 `/json` 里的 `webSocketDebuggerUrl` 发 `Runtime.evaluate`。

## 非截图证据

修复后三种链接的实际落点（CDP 依次派发 click 后读取 toast 与 `location.href`）：

```json
{"url":"http://tauri.localhost/",
 "pages":["mobile-home","mobile-entry-detail--edit"],
 "results":[
   {"href":"fc://self/entry/deadbeef",      "提示":"预览态不跳转词条，保存后可在查看态打开。"},
   {"href":"entry-title://Hello%E5%95%8A",  "提示":"预览态不跳转词条，保存后可在查看态打开。"},
   {"href":"https://example.com",           "提示":"(无)"}]}
```

外链无应用内提示是预期行为——它走 `api/opener` 交给系统浏览器。同一时刻的前台 Activity 确认了这一点：

```text
topResumedActivity=ActivityRecord{... com.android.browser/.BrowserActivity ...}
```

## 未覆盖

- **iOS 全部未验证。** 自定义协议在 WKWebView 下的失败形态与 Android 不同（不一定是错误页），修复本身是纯前端拦截、与平台无关，但失败形态需要单独确认。
- 深色主题、横屏、最大辅助字号下未复测。
