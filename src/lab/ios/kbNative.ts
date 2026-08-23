/*
 * 与 `src-tauri/ios/Sources/MobileUiBridge.m` 里"键盘实验桥"的通信层。
 *
 * 单向约定：页面用 WKScriptMessage 发命令，原生用 evaluateJavaScript 回调 window.__fcKbLab。
 * 这里只负责搬运和类型化，不做任何布局决策——布局在 useKeyboardInset.ts。
 *
 * 注意 t 的时钟：原生用 CACurrentMediaTime（开机起算），页面用 performance.now（页面起算），
 * 两者不同源。收到原生事件时记录本地 now，用 max(nativeT - localNow) 估计钟差，
 * 残差等于一次 IPC 的最小延迟（亚毫秒到一帧），足够把两侧的逐帧数据对齐看。
 */

export interface KbNativeEvent {
    name: string
    /** 键盘遮挡高度（window 坐标，收起为 0） */
    target: number
    /** 系统给的动画时长，秒 */
    duration: number
    /** UIViewAnimationCurve，键盘专用曲线是 7 */
    curve: number
    /** 是否本进程触发；外接/其他 App 的键盘为 false */
    isLocal: boolean
    endTop: number
    endHeight: number
    windowHeight: number
    t: number
}

export interface KbNativeState {
    windowHeight: number
    windowWidth: number
    screenScale: number
    webViewFrame: [number, number, number, number]
    webViewClass: string
    hostClass: string
    safeArea: [number, number]
    contentOffsetY: number
    contentInsetBottom: number
    adjustedInsetBottom: number
    contentSizeHeight: number
    insetBehavior: number
    bounces: boolean
    probeInstalled: boolean
    probeKeyboardHeight: number
    observersRemoved: boolean
    clampScrollView: boolean
    clampCorrections: number
    pushPerFrame: boolean
    resizeWebViewFrame: boolean
    frameCount: number
    systemVersion: string
    model: string
}

/** 原生逐帧采样：[t, kb动画中, kb模型值, wv.presY, wv.presH, wv.y, wv.h, offY, insB, adjInsB, contentH, boundsH] */
export type KbNativeFrame = readonly number[]

export interface KbNativeDump {
    frames: KbNativeFrame[]
    events: KbNativeEvent[]
    state: KbNativeState
}

export interface KbNativeConfig {
    pushPerFrame?: boolean
    /** 关掉原生侧的逐帧轨迹落盘；测手感时连它一起停，避免观测开销混进结论 */
    autoLog?: boolean
    clampScrollView?: boolean
    resizeWebViewFrame?: boolean
    insetAdjustmentNever?: boolean
    /** 摘掉 WKWebView 自带的键盘观察者。**不可逆**，恢复只能重启 App。 */
    removeWebKitObservers?: boolean
}

type FrameListener = (keyboardHeight: number, nativeTime: number) => void
type EventListener = (event: KbNativeEvent) => void

interface KbLabWindow {
    onFrame(keyboardHeight: number, nativeTime: number): void

    onEvent(event: KbNativeEvent): void

    onDump(dump: KbNativeDump): void

    onState(state: KbNativeState): void

    onNativeReady(): void
}

declare global {
    interface Window {
        __fcKbLab?: KbLabWindow
        __fcKbLabNativeReady?: boolean
        webkit?: {
            messageHandlers?: Record<string, { postMessage(body: unknown): void }>
        }
    }
}

const frameListeners = new Set<FrameListener>()
const eventListeners = new Set<EventListener>()
const readyListeners = new Set<() => void>()
let dumpResolver: ((dump: KbNativeDump) => void) | null = null
let stateResolver: ((state: KbNativeState) => void) | null = null

/** 原生时钟 - 页面时钟，见文件头说明 */
let clockOffset = Number.NEGATIVE_INFINITY

function noteClock(nativeTime: number): void {
    const delta = nativeTime - performance.now()
    if (delta > clockOffset) clockOffset = delta
}

export function nativeToPageTime(nativeTime: number): number {
    return clockOffset === Number.NEGATIVE_INFINITY ? nativeTime : nativeTime - clockOffset
}

export function hasClockOffset(): boolean {
    return clockOffset !== Number.NEGATIVE_INFINITY
}

window.__fcKbLab = {
    onFrame(keyboardHeight, nativeTime) {
        noteClock(nativeTime)
        for (const listener of frameListeners) listener(keyboardHeight, nativeTime)
    },
    onEvent(event) {
        noteClock(event.t)
        for (const listener of eventListeners) listener(event)
    },
    onDump(dump) {
        dumpResolver?.(dump)
        dumpResolver = null
    },
    onState(state) {
        stateResolver?.(state)
        stateResolver = null
    },
    onNativeReady() {
        for (const listener of readyListeners) listener()
    },
}

function post(body: Record<string, unknown>): boolean {
    const handler = window.webkit?.messageHandlers?.flowcloudaiKeyboardLab
    if (!handler) return false
    handler.postMessage(body)
    return true
}

export function nativeAvailable(): boolean {
    return Boolean(window.webkit?.messageHandlers?.flowcloudaiKeyboardLab)
}

export function configureNative(config: KbNativeConfig): boolean {
    const {autoLog, ...rest} = config
    if (autoLog !== undefined) post({cmd: 'autoLog', enabled: autoLog})
    return Object.keys(rest).length > 0 ? post({cmd: 'configure', ...rest}) : true
}

/**
 * 把页面侧的数据推到原生 stderr，和原生逐帧轨迹汇到同一条 syslog 上。
 * 真机 syslog 由 `tauri ios dev` 挂的 idevicesyslog 转发，可以直接在 Mac 上读，
 * 不必依赖手动复制——页面上的复制按钮仍然保留，它是不依赖 dev 通道的兜底。
 */
export function logToNative(text: string): boolean {
    return post({cmd: 'log', text})
}

export function pageToNativeTime(pageTime: number): number {
    return clockOffset === Number.NEGATIVE_INFINITY ? pageTime : pageTime + clockOffset
}

export function clearNativeTrace(): boolean {
    return post({cmd: 'clear'})
}

export function requestNativeSampling(seconds: number): boolean {
    return post({cmd: 'sample', seconds})
}

export function requestNativeDump(): Promise<KbNativeDump | null> {
    if (!nativeAvailable()) return Promise.resolve(null)
    return new Promise(resolve => {
        dumpResolver = resolve
        post({cmd: 'dump'})
        setTimeout(() => {
            if (dumpResolver) {
                dumpResolver = null
                resolve(null)
            }
        }, 3000)
    })
}

export function requestNativeState(): Promise<KbNativeState | null> {
    if (!nativeAvailable()) return Promise.resolve(null)
    return new Promise(resolve => {
        stateResolver = resolve
        post({cmd: 'state'})
        setTimeout(() => {
            if (stateResolver) {
                stateResolver = null
                resolve(null)
            }
        }, 3000)
    })
}

export function onNativeFrame(listener: FrameListener): () => void {
    frameListeners.add(listener)
    return () => frameListeners.delete(listener)
}

export function onNativeEvent(listener: EventListener): () => void {
    eventListeners.add(listener)
    return () => eventListeners.delete(listener)
}

export function onNativeReady(listener: () => void): () => void {
    readyListeners.add(listener)
    if (window.__fcKbLabNativeReady) listener()
    return () => readyListeners.delete(listener)
}

/*
 * 这些模块持有测量状态（采样数组、事件监听、标定基准）。
 * Vite 的就地热替换会留下新旧两份实例：旧实例仍挂着 DOM 监听、继续往它自己的数组里写，
 * 而报告读的是新实例的空数组——2026-08-23 真机上就这样拿到过一份"键盘明明起来了却全 0"的报告，
 * 差点被当成设备行为。宁可丢一次现场，也不能读到假数据，所以强制整页刷新。
 */
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload())
