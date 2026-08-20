/**
 * 移动端原生 UI 反馈适配层。
 *
 * Android 通过 JavascriptInterface，iOS 通过 WKScriptMessageHandler；业务组件只使用
 * success / warning / selection 三种语义，不感知原生 API，也不会影响桌面浏览器。
 */

export type MobileHapticKind = 'success' | 'warning' | 'selection'
export type AndroidNavigationMode = 'buttons' | 'gesture' | 'unknown'
export type MobileKeyboardAnimationCurve = 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'linear'
export type MobileKeyboardMetricsSource = 'unavailable' | 'native'

/** 小于该高度的贴底区域视为键盘附件/残余条，不接管页面和 Tab 的底部布局。 */
export const MOBILE_KEYBOARD_DOCKED_MIN_OCCLUSION = 80

export interface MobileKeyboardFrame {
    x: number
    y: number
    width: number
    height: number
}

/**
 * 原生键盘对 WebView 的遮挡状态，全部尺寸均使用 CSS 像素。
 *
 * `occludedBottom` 只表示 Web 页面仍需预留的底部遮挡；iPad 浮动键盘即使 visible，
 * 该值也应为 0。若原生已经调整视口，`viewportAdjusted` 必须为 true，Web 不再重复预留。
 */
export interface MobileKeyboardMetrics {
    source: MobileKeyboardMetricsSource
    visible: boolean
    docked: boolean
    viewportAdjusted: boolean
    occludedBottom: number
    frame: MobileKeyboardFrame | null
    animationDurationMs: number
    animationCurve: MobileKeyboardAnimationCurve
}

type NativeMobileKeyboardMetrics = Partial<Omit<MobileKeyboardMetrics, 'source'>>

export const DEFAULT_MOBILE_KEYBOARD_METRICS: MobileKeyboardMetrics = Object.freeze({
    source: 'unavailable',
    visible: false,
    docked: false,
    viewportAdjusted: false,
    occludedBottom: 0,
    frame: null,
    animationDurationMs: 0,
    animationCurve: 'ease-in-out',
})

interface AndroidMobileUiBridge {
    haptic: (kind: MobileHapticKind) => void
    getNavigationMode?: () => AndroidNavigationMode
}

interface IosMessageHandler {
    postMessage: (payload: {type: 'haptic'; value: MobileHapticKind}) => void
}

type MobileBridgeWindow = Window & {
    flowcloudaiMobileUi?: AndroidMobileUiBridge
    __flowcloudaiPendingMobileKeyboardMetrics?: NativeMobileKeyboardMetrics
    __flowcloudaiReceiveMobileKeyboardMetrics?: (payload: NativeMobileKeyboardMetrics) => void
    webkit?: {
        messageHandlers?: {
            flowcloudaiMobileUi?: IosMessageHandler
        }
    }
}

const keyboardListeners = new Set<() => void>()
let keyboardMetricsSnapshot = DEFAULT_MOBILE_KEYBOARD_METRICS

function finiteNonNegative(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function normalizeKeyboardFrame(value: unknown): MobileKeyboardFrame | null {
    if (!value || typeof value !== 'object') return null
    const frame = value as Partial<MobileKeyboardFrame>
    return {
        x: finiteNonNegative(frame.x),
        y: finiteNonNegative(frame.y),
        width: finiteNonNegative(frame.width),
        height: finiteNonNegative(frame.height),
    }
}

/** 把不可信的原生桥 payload 收敛成稳定、可比较的移动端键盘状态。 */
export function normalizeMobileKeyboardMetrics(payload: NativeMobileKeyboardMetrics): MobileKeyboardMetrics {
    const visible = payload.visible === true
    const rawOccludedBottom = finiteNonNegative(payload.occludedBottom)
    const docked = visible
        && payload.docked === true
        && rawOccludedBottom >= MOBILE_KEYBOARD_DOCKED_MIN_OCCLUSION
    const viewportAdjusted = payload.viewportAdjusted === true
    const supportedCurves: MobileKeyboardAnimationCurve[] = ['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear']
    const animationCurve = supportedCurves.includes(payload.animationCurve as MobileKeyboardAnimationCurve)
        ? payload.animationCurve as MobileKeyboardAnimationCurve
        : 'ease-in-out'

    return {
        source: 'native',
        visible,
        docked,
        viewportAdjusted,
        occludedBottom: docked && !viewportAdjusted ? rawOccludedBottom : 0,
        frame: visible ? normalizeKeyboardFrame(payload.frame) : null,
        animationDurationMs: finiteNonNegative(payload.animationDurationMs),
        animationCurve,
    }
}

function sameKeyboardMetrics(first: MobileKeyboardMetrics, second: MobileKeyboardMetrics): boolean {
    return first.source === second.source
        && first.visible === second.visible
        && first.docked === second.docked
        && first.viewportAdjusted === second.viewportAdjusted
        && first.occludedBottom === second.occludedBottom
        && first.animationDurationMs === second.animationDurationMs
        && first.animationCurve === second.animationCurve
        && JSON.stringify(first.frame) === JSON.stringify(second.frame)
}

function receiveMobileKeyboardMetrics(payload: NativeMobileKeyboardMetrics): void {
    const nextSnapshot = normalizeMobileKeyboardMetrics(payload)
    if (sameKeyboardMetrics(keyboardMetricsSnapshot, nextSnapshot)) return
    keyboardMetricsSnapshot = nextSnapshot
    keyboardListeners.forEach(listener => listener())
}

/** 订阅原生键盘指标；供 React 的 useSyncExternalStore 使用。 */
export function subscribeMobileKeyboardMetrics(listener: () => void): () => void {
    keyboardListeners.add(listener)
    return () => keyboardListeners.delete(listener)
}

export function getMobileKeyboardMetricsSnapshot(): MobileKeyboardMetrics {
    return keyboardMetricsSnapshot
}

function installMobileKeyboardMetricsReceiver(): void {
    if (typeof window === 'undefined') return
    const bridgeWindow = window as MobileBridgeWindow
    bridgeWindow.__flowcloudaiReceiveMobileKeyboardMetrics = receiveMobileKeyboardMetrics
    if (bridgeWindow.__flowcloudaiPendingMobileKeyboardMetrics) {
        receiveMobileKeyboardMetrics(bridgeWindow.__flowcloudaiPendingMobileKeyboardMetrics)
    }
}

installMobileKeyboardMetricsReceiver()

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
