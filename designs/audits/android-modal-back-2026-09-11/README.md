# Android 模态与返回链路真机回归

> **状态**：归档 ｜ **日期**：2026-09-11

本记录只固定 `app_main` 提交 `afeedc0fd51f08d0de51cc65b0fbc3a59582f226` 的 Android
真机回归结果，不修改产品代码。2026-09-11 15:31（+08:00）后，项目负责人要求停止继续真机核验，
因此未执行项保留为未执行，不能据此宣称整张矩阵通过。

## 设备、构建与数据安全

- 设备：Xiaomi 24129RT7CC（rodin），序列号 `MJI7E69PORW4RGZH`，Android 16 / API 36，
  arm64-v8a。三键组读取到 `settings secure navigation_mode = 0`；经项目负责人手动切换后，
  全面屏组读取到 `navigation_mode = 2`。
- 安装前使用 `run-as cn.flowcloudai.www tar -cf - .` 备份应用数据。备份存放于仓库外的私有临时目录，
  大小为 14,936,576 字节，权限为 `0600`；未放入仓库。
- APK 从独立、干净 worktree 的上述提交构建。命令为
  `ANDROID_HOME=<本机 SDK> ANDROID_NDK_HOME=<本机 NDK 27.0.12077973> npm run android:build:dev`。
  产物为 `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`，
  177,459,047 字节，SHA-256 为
  `b345c05a5e018dfff817cd6fd874cf40468eca488657bd97c10f895c3629cce8`。
- 只执行 `adb install -r` 覆盖安装，没有卸载或清除数据。安装前后均为
  `versionName=0.1.4`、`versionCode=1004`；`firstInstallTime` 保持
  `2026-08-19 11:49:20`，`lastUpdateTime` 更新为 `2026-09-11 14:02:47`。
- 所有删除确认只作用于专用项目 `P4T20260911` 及其内容。验收结束后已删除该项目；删除后项目数由
  2 回到 1。设备端 `screenrecord` 临时文件已拉回后删除。

## 操作与结果

“人手”表示项目负责人直接操作触摸手势；“ADB”表示使用 `adb shell input` 注入点按或返回键。
慢拖、跟手和取消回弹不使用 ADB 伪造。

### 三键导航

| 编号 | 操作来源 | 结果 | 证据 |
| --- | --- | --- | --- |
| K1 | 代码路径核对 + 真机入口核对 | **当前场景不适用**。移动端 `MobileTagEditor` 以独立页面渲染 `TagCreatorForm`；`TagCreator` 的 `FloatingPanel` 只由桌面接入。现有移动端 `FloatingPanel` 删除路径不在面板内再弹确认框，因此没有构造“底层 FloatingPanel + 上层确认框”的真实入口 | `src/features/entries/components/TagCreator.tsx`、`src/app/mobile/pages/MobileTagEditor.tsx`、`src/app/mobile/pages/MobileCategoryManager.tsx` |
| K2 | ADB 返回键 | **通过**。专用词条删除确认打开时注入返回键，确认框与页面均保持，删除未执行 | [k2-confirm-back-stays.png](k2-confirm-back-stays.png) |
| K3 | 人手左边缘右划 | **通过**。专用词条确认框打开时，应用内边缘手势未启动，确认框保持、页面未返回 | 与 K2 使用同一专用确认场景；现场观察由项目负责人确认 |
| K4 | ADB 点按 | **通过**。分别对“删除默认测试标签”和“删除专用项目”确认框点击背板，两次都按取消处理，目标未删除 | [k4-tag-backdrop-cancel.png](k4-tag-backdrop-cancel.png)、[k4-project-confirm.png](k4-project-confirm.png)、[k4-project-backdrop-cancel.png](k4-project-backdrop-cancel.png) |
| K5 | — | **未执行**。切换全面屏前未完成未保存词条的应用内边缘慢拖/取消；项目负责人随后要求停止继续真机核验 | — |
| K6 | ADB 返回键与点按 | **通过**。未保存词条第一次返回只收起键盘，第二次弹离开确认；“取消”留在编辑页，“确定”返回项目页且只询问一次 | [k6-leave-confirm.png](k6-leave-confirm.png) |
| K7 | ADB 返回键 | **部分通过**。已保存词条返回无确认；根页面返回弹退出确认。应用内左边缘右划分支未执行 | [k7-saved-entry-return.png](k7-saved-entry-return.png) |
| K8 | ADB 返回键 | **通过**。标签输入和未保存词条输入场景中，键盘打开时第一次返回只收起键盘，页面保持 | [k8-keyboard-dismissed.png](k8-keyboard-dismissed.png) |

### 全面屏手势

| 编号 | 操作来源 | 结果 | 证据 |
| --- | --- | --- | --- |
| G1 | 人手慢拖、松手与点按 | **通过**。未保存词条慢拖松手后出现离开确认；点“确定”回到项目页，只询问一次 | [g1-g3-unsaved-ready.png](g1-g3-unsaved-ready.png)；现场观察由项目负责人确认 |
| G2 | 人手慢拖、取消与点按 | **通过**。离开确认点“取消”后留在编辑页；另一次手势中途拖回取消，页面回弹干净且未弹确认 | [g2-unsaved-ready.png](g2-unsaved-ready.png)；现场观察由项目负责人确认 |
| G3 | 人手系统返回手势 | **通过**。离开确认打开期间再次做系统返回手势，未启动预测动画，确认框保持且底层未导航；随后点“确定”才返回 | 与 G1 同一连续流程；现场观察由项目负责人确认 |
| G4 | — | **未执行**。项目负责人要求停止继续真机核验 | — |
| G5 | — | **未执行**。项目负责人要求停止继续真机核验 | — |

普通 `alert` 模式在当前移动端没有调用点，因此记为不适用；没有用确认框返回值替代普通提示验证。

## 证据边界与遗留

- 所有已提交 PNG 均由 `adb exec-out screencap -p` 取得，再按固定像素裁去系统状态栏和系统导航栏；
  逐张复核后只保留专用测试内容，不含私人项目、账号或通知。
- 两段 `screenrecord` 曾用于现场复核 G1/G2/G3，但录屏包含系统栏，未提交到公开仓；证据结论以
  项目负责人的人手操作确认和上表静态截图为界。
- 未执行的 K5、K7 左划分支、G4、G5 仍是 Android 发布前的原生回归缺口。
- 项目负责人要求停止时设备处于全面屏手势模式；导航方式必须由人手在系统设置中恢复为三键，
  不得由 ADB 修改系统设置。
