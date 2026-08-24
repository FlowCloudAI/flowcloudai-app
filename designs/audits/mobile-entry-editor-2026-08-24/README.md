# 移动端词条编辑器重构证据包

状态：**现行**  
日期：**2026-08-24**

本目录保存 `designs/mobile-entry-editor.html` 本轮设计状态的固定像素快照，以及代码落地后的设计 QA 边界。设计稿是方向来源，不代表原生应用已经通过交互验收。

## 设计来源

- `source-edit.png`：编辑主页，固定身份区、三行摘要、内联正文和属性摘要入口。
- `source-body-keyboard.png`：正文聚焦与键盘高度预算。
- `source-properties.png`：独立词条属性页。
- `source-relation.png`：独立关系编辑页。

以上截图来自 2026-08-24 工作区中的 `designs/mobile-entry-editor.html`，画布为 390 × 844 浅色状态。

## Android 真机实现截图（2026-08-24）

设备：Xiaomi `24129RT7CC` / Android 16 / 1220 × 2712 @520dpi（= 375 × 834dp）。
经 `adb shell screencap -p /sdcard/<name>.png` 写入设备文件后 `adb pull` 取回——该机型的 `adb exec-out screencap`
与 raw 模式会被信号 3 / 36 终止，写文件方式正常。

- `android-edit.png`：编辑主页，键盘收起。
- `android-body-keyboard.png`：正文聚焦，身份区收起、工具栏停在键盘上方、WebView 未平移。
- `android-properties.png`：属性页顶部（类型 / 分类 / 图片 / 标签起始）。
- `android-properties-bottom.png`：属性页滚到底，可见 sticky 顶栏渐变遮不住滚过的正文。
- `android-properties-keyboard-occluded.png`：**属性页最底部标签输入框被软键盘切断，且页面已无可滚空间**。
- `android-relation.png`：关系编辑页。

这批截图用于第一轮问题定位（修复前状态）。

## Android 修复后截图（2026-08-24 第二轮）

- `android-fixed-edit.png`：编辑主页，正文有容器、17px 字号、属性入口行可见。
- `android-fixed-body-keyboard.png`：正文聚焦，身份区平滑折叠、工具栏减重并右侧渐隐。
- `android-fixed-properties.png`：属性页，五个分组统一标题语言，图片为「+」瓦片。
- `android-fixed-properties-bottom.png`：属性页滚到底，顶栏不再被内容穿透。
- `android-fixed-properties-keyboard.png`：**底部标签输入框在键盘上方完整可见**（对比 `android-properties-keyboard-occluded.png`）。
- `android-fixed-relation.png`：关系编辑页，空白新关系为「放弃这条关系」。

修复清单与实测数值见 `design-qa.md`。iOS 一端仍无证据。

## 实现范围

- 编辑主页改为固定骨架，正文区域独立滚动，保留编辑/预览与全屏专注入口。
- 设计稿只用于信息层级与交互方向；编辑主页、属性页和关系页继续复用应用公共 `MobilePageTopBar` / `MobileTopActionPill` 顶栏语言。
- 类型、分类、图片、标签和关系移入页面栈中的完整属性页；关系编辑再进入独立完整页面。
- 编辑主页、属性页和关系页通过共享草稿 store 保留同一份未保存状态。
- 新建词条使用显式占位标记；首次成功保存后解除标记，未保存离开时清理预创建数据。
- 既有本地图片、AI 图片、系统拍照、双链和沉浸编辑能力继续复用。

## 验证边界

自动化与构建结果、尚缺的原生截图矩阵见 `design-qa.md`。依赖 Tauri command 和本地数据库的词条页面不能用浏览器预览作为实现证据，因此当前证据包不包含伪造的浏览器实现截图。
