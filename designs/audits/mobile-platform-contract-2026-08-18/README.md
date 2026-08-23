# 移动端平台契约验证（2026-08-18）

## 结论

- iOS：应用内主题切换到深色后，原生窗口同步采用深色外观，状态栏图标变为浅色；iPhone 17 Pro / iOS 26.5 模拟器验证通过。
- Android：`MainActivity` 已同步应用主题到状态栏与导航栏图标，尚未获得 debug APK + ADB 运行证据，因此只标记为代码实现、未验证。
- iOS/Android：均已接入 `success`、`warning`、`selection` 三种触觉语义；模拟器不具备可靠触觉证据，需真机验收。
- Android：预测式返回使用系统回调的开始、进度、取消和提交事件；当前主机缺少 Android SDK/NDK，尚未原生编译与运行。

## 截图

1. `01-ios-dark-system-bars.png`：应用“外观”页面选择深色主题后，页面、底部 Tab 与原生状态栏同时进入深色外观，状态栏图标为浅色。

## 验证边界

- 已验证：iOS 模拟器原生包、深色主题、状态栏图标同步。
- 仅编译验证：iOS 原生桥中的 Dynamic Type、降低透明度/提高对比度和触觉映射。
- 仅代码分析：Android WindowInsets、系统字号、高对比度、系统栏主题、触觉映射与预测式返回。
- 未验证：iPhone 真机触觉与辅助功能切换；Android debug APK、模拟器/真机系统栏、触觉、预测式返回和软键盘。
