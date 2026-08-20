/*
 * iOS WKWebView 聚焦滚动守卫。
 *
 * WebKit 会在软键盘出现前主动 reveal 新聚焦的编辑控件，而应用键盘布局只能在随后
 * 收到原生指标后收缩内容区。这里仅对业务显式标记的区域提前使用 preventScroll 聚焦，
 * 阻止两套布局所有者先后移动页面；不阻止指针默认行为，以保留光标定位与文本选择。
 */

import {useEffect} from 'react'
import {isMobileTextEditingElement} from './mobileInputMode'

const FOCUS_REVEAL_GUARD_SELECTOR = '[data-mobile-prevent-webview-focus-reveal="true"]'
const TEXT_EDITING_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"])'

function resolveGuardedTextEditor(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null
    const editor = target.closest(TEXT_EDITING_SELECTOR)
    if (!isMobileTextEditingElement(editor)) return null
    return editor.closest(FOCUS_REVEAL_GUARD_SELECTOR) ? editor : null
}

/** 以与 React autoFocus 相同的挂载时机聚焦，但在 iOS 上禁止 WebKit 自动移动页面。 */
export function focusMobileTextEditor(element: HTMLElement | null, preventWebViewReveal: boolean): void {
    if (!element) return
    if (preventWebViewReveal) {
        element.focus({preventScroll: true})
        return
    }
    element.focus()
}

/**
 * 在指针默认聚焦前抢先聚焦受保护控件。已聚焦控件不接管，让用户仍能点击移动光标。
 * Portal 浮层不属于 `.mobile-app` 的 DOM 子树，因此监听 document，而不是应用根节点。
 */
export function useIosWebViewFocusRevealGuard(enabled: boolean): void {
    useEffect(() => {
        if (!enabled) return

        const handlePointerDown = (event: PointerEvent) => {
            const editor = resolveGuardedTextEditor(event.target)
            if (!editor || document.activeElement === editor) return
            editor.focus({preventScroll: true})
        }

        document.addEventListener('pointerdown', handlePointerDown, {capture: true, passive: true})
        return () => document.removeEventListener('pointerdown', handlePointerDown, true)
    }, [enabled])
}
