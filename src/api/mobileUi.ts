/**
 * 移动端原生 UI 反馈适配层。
 *
 * Android 通过 JavascriptInterface，iOS 通过 WKScriptMessageHandler；业务组件只使用
 * 语义化触觉反馈与键盘遮挡快照，不感知原生 API，也不会影响桌面浏览器。
 */

export type MobileHapticKind = 'success' | 'warning' | 'selection'
export type AndroidNavigationMode = 'buttons' | 'gesture' | 'unknown'

export interface MobileKeyboardInsetSnapshot {
    /** 当前宿主是否提供原生键盘桥；false 时调用方应保留 visualViewport 降级路径 */
    available: boolean
    /** 软键盘从窗口底部遮挡的 CSS 像素（原生 point 与 viewport CSS px 在本应用中一一对应） */
    inset: number
    visible: boolean
}

export type AndroidKeyboardInsetSnapshot = MobileKeyboardInsetSnapshot

export type IosKeyboardInsetUpdateKind = 'ready' | 'willChange' | 'frame' | 'didHide'

/** iOS 原生键盘事务；willChange 驱动 CSS 过渡，frame 只用于零时长收起和启动标定。 */
export interface IosKeyboardInsetUpdate {
    kind: IosKeyboardInsetUpdateKind
    inset: number
    duration: number
    curve: number
    nativeTime: number
    probeFloor: number
}

interface AndroidMobileUiBridge {
    haptic: (kind: MobileHapticKind) => void
    getNavigationMode?: () => AndroidNavigationMode
    getKeyboardInset?: () => number
    isKeyboardVisible?: () => boolean
}

interface IosMessageHandler {
    postMessage: (payload:
        | {type: 'haptic'; value: MobileHapticKind}
        | {type: 'keyboard'; value: 'enable'}) => void
}

type MobileBridgeWindow = Window & {
    flowcloudaiMobileUi?: AndroidMobileUiBridge
    __flowcloudaiApplyAndroidKeyboardInset?: (inset: number, visible: boolean) => void
    __flowcloudaiApplyIosKeyboardInset?: (payload: unknown) => void
    webkit?: {
        messageHandlers?: {
            flowcloudaiMobileUi?: IosMessageHandler
        }
    }
}

const IOS_KEYBOARD_UPDATE_KINDS = new Set<IosKeyboardInsetUpdateKind>([
    'ready',
    'willChange',
    'frame',
    'didHide',
])

function finiteNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
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
 * 订阅 iOS 原生键盘事务并启用本次 WKWebView 会话的单一布局 owner。
 *
 * `enable` 会让原生层停止 WKWebView 自带的整页避让；该操作在当前 WebView 会话不可逆，
 * 因此只允许移动壳层按平台在应用级安装，业务页面不得自行开关。
 */
export function installIosKeyboardInsetListener(
    listener: (update: IosKeyboardInsetUpdate) => void,
): () => void {
    const bridgeWindow = window as MobileBridgeWindow
    const receive = (payload: unknown) => {
        if (!payload || typeof payload !== 'object') return
        const raw = payload as Record<string, unknown>
        if (typeof raw.kind !== 'string'
            || !IOS_KEYBOARD_UPDATE_KINDS.has(raw.kind as IosKeyboardInsetUpdateKind)) return

        listener({
            kind: raw.kind as IosKeyboardInsetUpdateKind,
            inset: Math.max(0, finiteNumber(raw.inset)),
            duration: Math.max(0, finiteNumber(raw.duration)),
            curve: Math.trunc(finiteNumber(raw.curve, 7)),
            nativeTime: finiteNumber(raw.nativeTime),
            probeFloor: Math.max(0, finiteNumber(raw.probeFloor)),
        })
    }

    bridgeWindow.__flowcloudaiApplyIosKeyboardInset = receive
    try {
        bridgeWindow.webkit?.messageHandlers?.flowcloudaiMobileUi?.postMessage({
            type: 'keyboard',
            value: 'enable',
        })
    } catch {
        // 桥尚未安装时保持 unavailable；visualViewport 继续承担输入态检测，不参与布局。
    }

    return () => {
        if (bridgeWindow.__flowcloudaiApplyIosKeyboardInset === receive) {
            delete bridgeWindow.__flowcloudaiApplyIosKeyboardInset
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
