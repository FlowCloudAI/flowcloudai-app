/**
 * 移动端原生 UI 反馈适配层。
 *
 * Android 通过 JavascriptInterface，iOS 通过 WKScriptMessageHandler；业务组件只使用
 * success / warning / selection 三种语义，不感知原生 API，也不会影响桌面浏览器。
 */

export type MobileHapticKind = 'success' | 'warning' | 'selection'
export type AndroidNavigationMode = 'buttons' | 'gesture' | 'unknown'

export interface AndroidKeyboardInsetSnapshot {
    /** 当前 APK 是否提供原生 IME Insets 桥；false 时调用方应保留旧 WebView 降级路径 */
    available: boolean
    /** 软键盘从窗口底部遮挡的 CSS 像素 */
    inset: number
    visible: boolean
}

interface AndroidMobileUiBridge {
    haptic: (kind: MobileHapticKind) => void
    getNavigationMode?: () => AndroidNavigationMode
    getKeyboardInset?: () => number
    isKeyboardVisible?: () => boolean
}

interface IosMessageHandler {
    postMessage: (payload: {type: 'haptic'; value: MobileHapticKind}) => void
}

type MobileBridgeWindow = Window & {
    flowcloudaiMobileUi?: AndroidMobileUiBridge
    __flowcloudaiApplyAndroidKeyboardInset?: (inset: number, visible: boolean) => void
    webkit?: {
        messageHandlers?: {
            flowcloudaiMobileUi?: IosMessageHandler
        }
    }
}

/**
 * 订阅 Android 原生 IME 遮挡量。
 *
 * 固定的全局接收函数负责接实时帧，JavascriptInterface getter 负责补初始快照；两者组合后，
 * 无论 React 先挂载还是原生 Insets 先到达，都不会丢失当前键盘状态。旧 APK 没有 getter 时
 * 不伪造 0，而是保持 available=false，让输入态检测继续使用 visualViewport 降级。
 */
export function installAndroidKeyboardInsetListener(
    listener: (snapshot: AndroidKeyboardInsetSnapshot) => void,
): () => void {
    const bridgeWindow = window as MobileBridgeWindow
    const receive = (inset: number, visible: boolean) => {
        const normalizedInset = Number.isFinite(inset) ? Math.max(0, inset) : 0
        listener({
            available: true,
            inset: normalizedInset,
            visible: Boolean(visible) && normalizedInset > 0,
        })
    }

    bridgeWindow.__flowcloudaiApplyAndroidKeyboardInset = receive
    try {
        const bridge = bridgeWindow.flowcloudaiMobileUi
        const inset = bridge?.getKeyboardInset?.()
        const visible = bridge?.isKeyboardVisible?.()
        if (typeof inset === 'number' && typeof visible === 'boolean') receive(inset, visible)
    } catch {
        // 页面可能正处于 WebView 重载边界；实时回调到达后会自然补齐状态。
    }

    return () => {
        if (bridgeWindow.__flowcloudaiApplyAndroidKeyboardInset === receive) {
            delete bridgeWindow.__flowcloudaiApplyAndroidKeyboardInset
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
