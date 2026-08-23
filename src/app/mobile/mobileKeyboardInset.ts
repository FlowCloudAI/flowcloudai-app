/*
 * Android 原生软键盘遮挡量的 CSS 落地点。
 *
 * 原生层保持 WebView 全屏，只把 WindowInsetsAnimationCompat 的实际 IME 帧传进页面；本模块
 * 直接写 documentElement 上唯一的 `--fc-kb`，不经过 React state，也不预测、不补过渡、
 * 不移动整个应用壳层。页面只通过 `--mobile-nav-reserved-height` 消费该变量。
 */

import {
    installAndroidKeyboardInsetListener,
    type AndroidKeyboardInsetSnapshot,
} from '../../api/mobileUi'

/** 小于这个变化量不触发样式失效，过滤浮点换算噪声。 */
const WRITE_EPSILON = 0.5

export type MobileKeyboardInsetState = AndroidKeyboardInsetSnapshot

let enabled = false
let currentState: MobileKeyboardInsetState = {
    available: false,
    inset: 0,
    visible: false,
}
let disposeAndroidListener: (() => void) | null = null
const listeners = new Set<() => void>()

function notify(): void {
    for (const listener of listeners) listener()
}

function publish(snapshot: AndroidKeyboardInsetSnapshot): void {
    if (!enabled) return

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
        document.documentElement.style.setProperty('--fc-kb', `${inset.toFixed(2)}px`)
    }

    currentState = next
    if (stateChanged) notify()
}

function clear(): void {
    const root = document.documentElement
    root.style.removeProperty('--fc-kb')

    // 清掉 2026-08-23 旧方案可能由 HMR 留下的预测/平移补偿，不再允许第二个布局 owner。
    root.style.removeProperty('--fc-kb-transition')
    root.style.removeProperty('--fc-kb-pan')
    delete root.dataset.mobileKbPan

    const stateChanged = currentState.available || currentState.inset > 0 || currentState.visible
    currentState = {available: false, inset: 0, visible: false}
    if (stateChanged) notify()
}

/** 仅 Android 调用方显式打开；iOS 继续完全沿用 WebKit 自身的键盘布局。 */
export function setMobileKeyboardInsetEnabled(next: boolean): void {
    if (enabled === next) return
    enabled = next

    disposeAndroidListener?.()
    disposeAndroidListener = null
    if (!enabled) {
        clear()
        return
    }

    disposeAndroidListener = installAndroidKeyboardInsetListener(publish)
}

/** 给输入态协调器订阅原生可见性；布局本身不经过此订阅或 React state。 */
export function subscribeMobileKeyboardInset(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function mobileKeyboardInsetState(): MobileKeyboardInsetState {
    return currentState
}

/* 模块持有桥接订阅和当前快照；HMR 时整页刷新，避免新旧实例同时接收原生帧。 */
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload())
