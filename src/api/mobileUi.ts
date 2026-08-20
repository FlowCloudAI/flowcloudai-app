/**
 * 移动端原生 UI 反馈适配层。
 *
 * Android 通过 JavascriptInterface，iOS 通过 WKScriptMessageHandler；业务组件只使用
 * success / warning / selection 三种语义，不感知原生 API，也不会影响桌面浏览器。
 */

export type MobileHapticKind = 'success' | 'warning' | 'selection'
export type AndroidNavigationMode = 'buttons' | 'gesture' | 'unknown'

interface AndroidMobileUiBridge {
    haptic: (kind: MobileHapticKind) => void
    getNavigationMode?: () => AndroidNavigationMode
}

interface IosMessageHandler {
    postMessage: (payload: {type: 'haptic'; value: MobileHapticKind}) => void
}

type MobileBridgeWindow = Window & {
    flowcloudaiMobileUi?: AndroidMobileUiBridge
    webkit?: {
        messageHandlers?: {
            flowcloudaiMobileUi?: IosMessageHandler
        }
    }
}

/**
 * 读取 Android 当前系统导航模式。
 *
 * 三键/两键导航不会从屏幕边缘产生系统返回事件，移动壳层必须补上应用内手势；手势导航
 * 则继续交给原生预测式返回。桥尚未就绪时返回 unknown，避免同时启用两套返回手势。
 */
export function getAndroidNavigationMode(): AndroidNavigationMode {
    const bridgeWindow = window as MobileBridgeWindow
    try {
        return bridgeWindow.flowcloudaiMobileUi?.getNavigationMode?.() ?? 'unknown'
    } catch {
        return 'unknown'
    }
}

/** 请求一次原生触觉反馈；桌面端与不支持的 WebView 安静降级为无操作。 */
export function mobile_haptic(kind: MobileHapticKind): void {
    const bridgeWindow = window as MobileBridgeWindow
    try {
        if (bridgeWindow.flowcloudaiMobileUi?.haptic) {
            bridgeWindow.flowcloudaiMobileUi.haptic(kind)
            return
        }
        bridgeWindow.webkit?.messageHandlers?.flowcloudaiMobileUi?.postMessage({
            type: 'haptic',
            value: kind,
        })
    } catch {
        // 原生桥未就绪或页面正在卸载时，触觉反馈不应阻断主操作。
    }
}
