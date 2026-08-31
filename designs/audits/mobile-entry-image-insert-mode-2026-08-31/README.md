# 移动端正文工具栏「图片」恢复插入语义 —— 真机验收（2026-08-31）

> **状态**：现行 ｜ **日期**：2026-08-31
> 开发记录：`docs/devlog/2026-08-31-移动端-props-桥漏传-mode.md`（工作区根仓库）

修复前：正文工具栏的「图片」和图片区的「+ 添加」共用同一个 `openImageAdd`，
移动端从不给共享表单传 `mode`，插入模式整套行为（设定集起始页、添加并插入、回插正文）在手机上不存在。

## 设备与构建

| 项 | 值 |
| --- | --- |
| 设备 | Xiaomi 24129RT7CC，Android 16，WebView Chrome/143.0.7499.192 |
| 构建 | `npm run android:dev`（Vite HMR，真实 Tauri 后端与本地数据库） |
| 视口 | 375 × 834 CSS px，devicePixelRatio 3.25 |

## 截图取法（这台机器上 `adb screencap` 不可用）

MIUI 对本应用的 WebView Surface 返回**陈旧帧**：设备时钟已到 14:51，连续多张 `adb screencap`
仍是 14:46 的同一份字节（132122 / 1428260 完全一致），DOM 早已换页而截图纹丝不动。
本目录截图改用 CDP `Page.captureScreenshot` 抓 WebView 自己的渲染结果：

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
# 再对 http://127.0.0.1:9222/json 里的 page 目标发 Page.enable + Page.captureScreenshot
```

**这不是应用卡死**——同一时刻用 CDP `Runtime.evaluate` 读 DOM，页面是活的、点击照常生效。
下次在这台机器上验收移动端界面，不要因为 `screencap` 不动就判定白屏或冻结。

## 验收项

| # | 入口 | 期望 | 实测 |
| --- | --- | --- | --- |
| 1 | 正文工具栏「图片」 | 标题「插入图片」，起始标签页「设定集」 | 见 `01`，`heroTitle` 与顶栏 `aria-label` 均为「插入图片」，设定集 active |
| 2 | 同上 | 多出已有图片选择区 | 见 `01`，`.entry-image-add-existing__item` 1 项（该词条 1 张图） |
| 3 | 点设定集里的图片 | 引用写回正文光标处并返回 | 正文 95 → 196 字；光标置于 12，插入落在 14（前置 `\n\n`）；写入 `![…jpg](fc://self/image/01a03d22-…)`，见 `03` |
| 4 | 同上 | 跨页返回不抢焦点 | `document.activeElement` 为 `BODY`，软键盘未弹出 |
| 5 | 图片区「+ 添加」 | 仍是纯添加语义 | 见 `02`，标题「添加图片」，仅「本地上传 / AI 生成」两页，无设定集区 |

验收后已在真机上通过「未保存的更改将丢失」确认框丢弃测试草稿，词条正文回到原始 95 字。

## 未覆盖

- **本地上传 / 拍照 / AI 生成后的自动插入没有真机走通**：这三条要动系统文件选择器、相机和图像插件配额，
  本轮只验证了同类回调共用的取图路径（按图片对象取、不按下标回查旧数组）。
  这正是修复前必然落空的分支，复验时优先补这三条。
- iOS 未验证。
