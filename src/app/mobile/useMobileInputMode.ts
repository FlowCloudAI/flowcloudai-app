/*
 * 移动端输入/编辑模式协调器。
 *
 * 统一监听文本焦点、原生 Android IME、visualViewport 与页面声明的整页编辑态；壳层据此
 * 安排返回键和预测式返回手势。底部 Tab 不再随键盘隐藏。
 *
 * 关于「回写布局」：这里曾经**完全不**把键盘高度写回布局，因为 WKWebView 会自行避让键盘，
 * 再手动缩短根节点就是二次收缩（见 `docs/devlog/2026-08-18-ios-输入视口-二次缩短.md`）。
 * 该禁令对 iOS 仍然成立。但 2026-08-23 真机实测确认 Android/Chromium **不做**这套自动避让——
 * IME 弹出时 `contentOffset`、`scrollTop` 全程为 0，窗口也不被 resize——所以那里不存在可二次补偿的对象。
 * Android 的布局高度改由原生 WindowInsets 桥直接写入 `--fc-kb`；visualViewport 只保留为
 * iOS 与旧桥环境的输入态检测兜底，不再参与 Android 布局。方案见 `docs/mobile_keyboard_layout.md`。
 */

import {type RefObject, useCallback, useEffect, useState} from 'react'
import {
    getMobileFocusReferenceHeight,
    getMobileViewportState,
    isMobileTextEditingElement,
    isMobileInputModeActive,
} from './mobileInputMode'
import {
    mobileKeyboardInsetState,
    setMobileKeyboardInsetEnabled,
    subscribeMobileKeyboardInset,
} from './mobileKeyboardInset'

function isActiveEditingRegion(element: Element): boolean {
    if (element.closest('[hidden]')) return false

    const transitionLayer = element.closest('.mobile-page-transition-host__layer')
    if (transitionLayer && !transitionLayer.classList.contains('is-top')) return false

    const tabView = element.closest('.mobile-app__tab-view')
    return !tabView || tabView.classList.contains('is-active')
}

function hasActiveEditingRegion(root: HTMLElement): boolean {
    return Array.from(root.querySelectorAll('[data-mobile-editing="true"]'))
        .some(isActiveEditingRegion)
}

export interface MobileInputModeController {
    active: boolean
    dismissFocusedInput: () => boolean
}

export interface MobileInputModeOptions {
    /** 是否把键盘遮挡高度写进 `--fc-kb`。仅 Android 打开，原因见文件头注释 */
    writeKeyboardInset?: boolean
}

export function useMobileInputMode(
    rootRef: RefObject<HTMLDivElement | null>,
    {writeKeyboardInset = false}: MobileInputModeOptions = {},
): MobileInputModeController {
    const [active, setActive] = useState(false)

    const dismissFocusedInput = useCallback(() => {
        const focused = document.activeElement
        if (!isMobileTextEditingElement(focused)) return false
        focused.blur()
        return true
    }, [])

    useEffect(() => {
        setMobileKeyboardInsetEnabled(writeKeyboardInset)
        return () => setMobileKeyboardInsetEnabled(false)
    }, [writeKeyboardInset])

    useEffect(() => {
        let frame = 0
        let restoreTimer = 0
        let viewportPollTimer = 0
        let focusedInput: HTMLElement | null = null
        let focusViewportHeight = 0
        let keyboardSeenForFocus = false
        let stableViewportHeight = Math.max(
            window.innerHeight,
            window.visualViewport?.height ?? 0,
        )
        let stableViewportWidth = window.innerWidth

        const getVisibleViewportHeight = () => Math.max(
            0,
            window.visualViewport?.height ?? window.innerHeight,
        )
        const beginFocusSession = (element: Element | null) => {
            if (!isMobileTextEditingElement(element) || element === focusedInput) return

            // 键盘已打开时在多个输入框之间切换仍属于同一会话，保留聚焦前的完整高度。
            // Android 可能先 resize 再派发 focus，因此还要合并最近一次无键盘的稳定高度。
            if (!focusedInput || !keyboardSeenForFocus) {
                focusViewportHeight = getMobileFocusReferenceHeight(
                    stableViewportHeight,
                    window.innerHeight,
                    window.visualViewport,
                )
                keyboardSeenForFocus = false
            }
            focusedInput = element
            setActive(true)
        }
        const update = () => {
            frame = 0
            const root = rootRef.current
            if (!root) return

            const activeElement = document.activeElement
            const textInputFocused = isMobileTextEditingElement(activeElement)
            if (textInputFocused) beginFocusSession(activeElement)

            const viewport = getMobileViewportState(
                window.innerHeight,
                window.visualViewport,
                focusViewportHeight || stableViewportHeight || window.innerHeight,
            )
            const nativeKeyboard = mobileKeyboardInsetState()
            const keyboardVisible = writeKeyboardInset && nativeKeyboard.available
                ? nativeKeyboard.visible
                : viewport.keyboardVisible
            if (textInputFocused && keyboardVisible) keyboardSeenForFocus = true

            const nextActive = isMobileInputModeActive({
                textInputFocused,
                keyboardVisible,
                keyboardSeenForFocus,
                editingRegionActive: hasActiveEditingRegion(root),
            })
            if (nextActive) {
                if (restoreTimer) {
                    window.clearTimeout(restoreTimer)
                    restoreTimer = 0
                }
                setActive(true)
            } else if (!restoreTimer) {
                // 软键盘收起会连续改变 visualViewport；最后一次变化稳定后再退出输入态，
                // 避免 Android resize-content 或 iOS 动画尾帧误启用预测式返回。
                restoreTimer = window.setTimeout(() => {
                    restoreTimer = 0
                    setActive(false)
                }, 180)
            }

            if (!textInputFocused && !keyboardVisible) {
                focusedInput = null
                focusViewportHeight = 0
                keyboardSeenForFocus = false

                const currentViewportHeight = Math.max(window.innerHeight, getVisibleViewportHeight())
                const currentViewportWidth = window.innerWidth
                // 软键盘通常不改变宽度；宽度显著变化视为旋转/分屏，允许完整高度向下更新。
                stableViewportHeight = Math.abs(currentViewportWidth - stableViewportWidth) >= 48
                    ? currentViewportHeight
                    : Math.max(stableViewportHeight, currentViewportHeight)
                stableViewportWidth = currentViewportWidth
            }
        }
        const scheduleUpdate = () => {
            if (frame) cancelAnimationFrame(frame)
            frame = requestAnimationFrame(update)
        }
        const handleFocusIn = (event: FocusEvent) => {
            beginFocusSession(event.target as Element | null)
            // 某些 WebView 收起系统键盘时不可靠地派发 resize；聚焦期间低频补采样兜底。
            if (!viewportPollTimer) viewportPollTimer = window.setInterval(scheduleUpdate, 250)
            scheduleUpdate()
        }
        const handleFocusOut = () => {
            scheduleUpdate()
            window.setTimeout(() => {
                if (isMobileTextEditingElement(document.activeElement)) return
                if (viewportPollTimer) window.clearInterval(viewportPollTimer)
                viewportPollTimer = 0
            }, 0)
        }

        const observer = new MutationObserver(scheduleUpdate)
        observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'hidden', 'data-mobile-editing'],
        })

        document.addEventListener('focusin', handleFocusIn, true)
        document.addEventListener('focusout', handleFocusOut, true)
        window.addEventListener('resize', scheduleUpdate)
        window.visualViewport?.addEventListener('resize', scheduleUpdate)
        window.visualViewport?.addEventListener('scroll', scheduleUpdate)
        const disposeKeyboardInset = subscribeMobileKeyboardInset(scheduleUpdate)
        update()

        return () => {
            if (frame) cancelAnimationFrame(frame)
            if (restoreTimer) window.clearTimeout(restoreTimer)
            if (viewportPollTimer) window.clearInterval(viewportPollTimer)
            disposeKeyboardInset()
            observer.disconnect()
            document.removeEventListener('focusin', handleFocusIn, true)
            document.removeEventListener('focusout', handleFocusOut, true)
            window.removeEventListener('resize', scheduleUpdate)
            window.visualViewport?.removeEventListener('resize', scheduleUpdate)
            window.visualViewport?.removeEventListener('scroll', scheduleUpdate)
        }
    }, [rootRef, writeKeyboardInset])

    return {active, dismissFocusedInput}
}
