/**
 * 桌面原生背景材质的平台门控。
 *
 * 原生窗口效果由 Tauri/Rust 应用；这里仅决定 WebView 是否打开透明着色链路，以及为调试暴露
 * 当前材质类型。移动端、浏览器预览与没有系统材质实现的平台必须保持实色背景。
 */

import type {PlatformInfo} from '../api/platform'

export type NativeShellBackdrop = 'acrylic' | 'vibrancy'

export function resolveNativeShellBackdrop(
    platformInfo: Pick<PlatformInfo, 'os' | 'formFactor'>,
    tauriRuntime: boolean,
    enabled: boolean,
): NativeShellBackdrop | null {
    if (!tauriRuntime || !enabled || platformInfo.formFactor !== 'desktop') return null
    if (platformInfo.os === 'windows') return 'acrylic'
    if (platformInfo.os === 'macos') return 'vibrancy'
    return null
}
