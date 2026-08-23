/*
 * 移动端原生软键盘遮挡量的唯一 CSS 落地点。
 *
 * Android 继续直接消费 WindowInsetsAnimationCompat 的实际帧；iOS 消费
 * UIKeyboardWillChangeFrame 的目标/时长/曲线，并只在零时长收起时使用
 * keyboardLayoutGuide 逐帧兜底。两个平台互斥安装，页面只读取 `--fc-kb`。
 */

import {
    installAndroidKeyboardInsetListener,
    installIosKeyboardInsetListener,
    type IosKeyboardInsetUpdate,
    type MobileKeyboardInsetSnapshot,
} from '../../api/mobileUi'

/** 小于这个变化量不触发样式失效，过滤原生点数换算噪声。 */
const WRITE_EPSILON = 0.5
const IOS_KEYBOARD_CURVE = 'cubic-bezier(0.3, 0.8, 0.225, 1)'
const IOS_STANDARD_CURVES: Record<number, string> = {
    0: 'cubic-bezier(0.42, 0, 0.58, 1)',
    1: 'cubic-bezier(0.42, 0, 1, 1)',
    2: 'cubic-bezier(0, 0, 0.58, 1)',
    3: 'linear',
}
const IOS_CEILING_STABLE_MS = 220
const IOS_CEILING_BOOTSTRAP_MS = 150

export type MobileKeyboardInsetPlatform = 'android' | 'ios' | null
export type MobileKeyboardInsetState = MobileKeyboardInsetSnapshot

let platform: MobileKeyboardInsetPlatform = null
let currentState: MobileKeyboardInsetState = {
    available: false,
    inset: 0,
    visible: false,
}
let disposeNativeListener: (() => void) | null = null
const listeners = new Set<() => void>()

let iosFollowPerFrame = false
let iosClockOffset = Number.NEGATIVE_INFINITY
let iosStartupOffsetMs = 10
let iosStartupProbe: {eventTime: number; target: number; durationMs: number; floor: number} | null = null
const iosStartupSamples: number[] = []
let iosCeiling = Number.POSITIVE_INFINITY
let iosCeilingLoaded = false
let iosCeilingCommitTimer = 0
const iosRecentTargets: Array<{time: number; value: number}> = []

function notify(): void {
    for (const listener of listeners) listener()
}

function publish(snapshot: MobileKeyboardInsetSnapshot, transition = '0s'): void {
    if (!platform) return

    const inset = Number.isFinite(snapshot.inset) ? Math.max(0, snapshot.inset) : 0
    const next: MobileKeyboardInsetState = {
        available: snapshot.available,
        inset,
        visible: snapshot.available && snapshot.visible && inset > 0,
    }
    const stateChanged = next.available !== currentState.available
        || next.visible !== currentState.visible
        || Math.abs(next.inset - currentState.inset) >= WRITE_EPSILON

    if (snapshot.available && (
        !currentState.available
        || next.visible !== currentState.visible
        || Math.abs(inset - currentState.inset) >= WRITE_EPSILON
    )) {
        const root = document.documentElement
        if (platform === 'ios') root.style.setProperty('--fc-kb-transition', transition)
        root.style.setProperty('--fc-kb', `${inset.toFixed(2)}px`)
    }

    currentState = next
    if (stateChanged) notify()
}

function clear(): void {
    const root = document.documentElement
    root.style.removeProperty('--fc-kb')
    root.style.removeProperty('--fc-kb-transition')

    // 清掉 2026-08-23 旧方案可能由 HMR 留下的预测/平移补偿，不再允许第二个布局 owner。
    root.style.removeProperty('--fc-kb-pan')
    delete root.dataset.mobileKbPan
    delete root.dataset.mobileKeyboardOwner

    const stateChanged = currentState.available || currentState.inset > 0 || currentState.visible
    currentState = {available: false, inset: 0, visible: false}
    if (stateChanged) notify()
}

function iosCeilingKey(): string {
    return `fc-kb-ceiling:${window.innerHeight}`
}

function loadIosCeiling(): void {
    if (iosCeilingLoaded) return
    iosCeilingLoaded = true
    try {
        const stored = window.localStorage.getItem(iosCeilingKey())
        const value = stored === null ? Number.NaN : Number.parseFloat(stored)
        if (Number.isFinite(value) && value > 0) iosCeiling = value
    } catch {
        // localStorage 不可用只影响跨启动复用；本次会话仍会重新学习稳定上限。
    }
}

function commitIosCeiling(value: number): void {
    const next = iosCeiling === Number.POSITIVE_INFINITY ? value : Math.max(iosCeiling, value)
    if (next === iosCeiling) return
    iosCeiling = next
    try {
        window.localStorage.setItem(iosCeilingKey(), String(next))
    } catch {
        // 不把性能优化的持久化失败升级为输入故障。
    }
}

function noteIosTarget(target: number): void {
    if (!(target > 0)) return
    const now = performance.now()
    iosRecentTargets.push({time: now, value: target})
    while (iosRecentTargets.length > 0 && now - iosRecentTargets[0].time > IOS_CEILING_BOOTSTRAP_MS) {
        iosRecentTargets.shift()
    }
    window.clearTimeout(iosCeilingCommitTimer)
    iosCeilingCommitTimer = window.setTimeout(() => commitIosCeiling(target), IOS_CEILING_STABLE_MS)
}

function effectiveIosCeiling(): number {
    loadIosCeiling()
    if (iosCeiling !== Number.POSITIVE_INFINITY) return iosCeiling
    if (iosRecentTargets.length === 0) return Number.POSITIVE_INFINITY
    return Math.min(...iosRecentTargets.map(item => item.value))
}

function noteIosClock(nativeTime: number): void {
    if (!(nativeTime > 0)) return
    const delta = nativeTime - performance.now()
    if (delta > iosClockOffset) iosClockOffset = delta
}

function iosNativeToPageTime(nativeTime: number): number {
    return iosClockOffset === Number.NEGATIVE_INFINITY ? nativeTime : nativeTime - iosClockOffset
}

/** 反解 iOS 键盘专用 cubic-bezier：给定动画进度，求时间比例。 */
function iosCurveTimeAtProgress(progress: number): number {
    const [p1x, p1y, p2x, p2y] = [0.3, 0.8, 0.225, 1]
    let low = 0
    let high = 1
    for (let index = 0; index < 40; index += 1) {
        const value = (low + high) / 2
        const y = 3 * (1 - value) ** 2 * value * p1y
            + 3 * (1 - value) * value * value * p2y
            + value ** 3
        if (y < progress) low = value
        else high = value
    }
    const value = (low + high) / 2
    return 3 * (1 - value) ** 2 * value * p1x
        + 3 * (1 - value) * value * value * p2x
        + value ** 3
}

function observeIosStartup(update: IosKeyboardInsetUpdate): void {
    const probe = iosStartupProbe
    if (!probe || update.inset <= 0) return
    iosStartupProbe = null
    const hiddenFraction = Math.min(0.9, probe.floor / probe.target)
    const hiddenMs = iosCurveTimeAtProgress(hiddenFraction) * probe.durationMs
    const observed = iosNativeToPageTime(update.nativeTime) - probe.eventTime - hiddenMs
    if (observed < -50 || observed > 200) return
    iosStartupSamples.push(observed)
    if (iosStartupSamples.length > 9) iosStartupSamples.shift()
    const sorted = [...iosStartupSamples].sort((left, right) => left - right)
    iosStartupOffsetMs = sorted[Math.floor(sorted.length / 2)]
}

function handleIosUpdate(update: IosKeyboardInsetUpdate): void {
    noteIosClock(update.nativeTime)

    if (update.kind === 'ready') {
        publish({available: true, inset: update.inset, visible: update.inset > 0})
        return
    }
    if (update.kind === 'didHide') {
        iosFollowPerFrame = false
        iosStartupProbe = null
        publish({available: true, inset: 0, visible: false})
        return
    }
    if (update.kind === 'frame') {
        observeIosStartup(update)
        if (iosFollowPerFrame) {
            const inset = Math.min(update.inset, effectiveIosCeiling())
            publish({available: true, inset, visible: inset > 0})
        }
        return
    }

    noteIosTarget(update.inset)
    if (update.duration <= 0) {
        // iOS 收起方向通常不给可用时长，直接目标跳变会先于键盘落底。
        iosFollowPerFrame = true
        return
    }

    iosFollowPerFrame = false
    const easing = update.curve === 7
        ? IOS_KEYBOARD_CURVE
        : (IOS_STANDARD_CURVES[update.curve] ?? IOS_KEYBOARD_CURVE)
    const arrivalOffset = performance.now() - iosNativeToPageTime(update.nativeTime)
    const durationMs = update.duration * 1000
    const delay = Math.max(-(durationMs - 16), iosStartupOffsetMs - arrivalOffset)
    const inset = Math.min(update.inset, effectiveIosCeiling())
    publish(
        {available: true, inset, visible: inset > 0},
        `${update.duration.toFixed(3)}s ${easing} ${delay.toFixed(0)}ms`,
    )
    if (inset > 0) {
        iosStartupProbe = {
            eventTime: iosNativeToPageTime(update.nativeTime),
            target: inset,
            durationMs,
            floor: update.probeFloor,
        }
    }
}

function resetIosTransaction(): void {
    iosFollowPerFrame = false
    iosStartupProbe = null
    iosClockOffset = Number.NEGATIVE_INFINITY
    iosRecentTargets.length = 0
    window.clearTimeout(iosCeilingCommitTimer)
    iosCeilingCommitTimer = 0
}

/** 移动壳层按平台安装唯一原生来源；页面组件不得自行切换。 */
export function setMobileKeyboardInsetPlatform(next: MobileKeyboardInsetPlatform): void {
    if (platform === next) return

    disposeNativeListener?.()
    disposeNativeListener = null
    resetIosTransaction()
    platform = null
    clear()
    if (!next) return

    platform = next
    document.documentElement.dataset.mobileKeyboardOwner = next
    disposeNativeListener = next === 'android'
        ? installAndroidKeyboardInsetListener(snapshot => publish(snapshot))
        : installIosKeyboardInsetListener(handleIosUpdate)
}

/** 给输入态协调器订阅原生可见性；布局本身不经过此订阅或 React state。 */
export function subscribeMobileKeyboardInset(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function mobileKeyboardInsetState(): MobileKeyboardInsetState {
    return currentState
}

/* 模块持有原生订阅和事务状态；HMR 时整页刷新，避免新旧实例同时接收键盘帧。 */
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload())
