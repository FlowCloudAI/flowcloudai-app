/*
 * 移动端输入/编辑模式协调器。
 *
 * 统一监听文本焦点、visualViewport 与页面声明的整页编辑态；壳层据此安排返回键和
 * 预测式返回手势。底部 Tab 不再随键盘隐藏。
 *
 * 关于「回写布局」：这里曾经**完全不**把键盘高度写回布局，因为 WKWebView 会自行避让键盘，
 * 再手动缩短根节点就是二次收缩（见 `docs/devlog/2026-08-18-ios-输入视口-二次缩短.md`）。
 * 该禁令对 iOS 仍然成立。但 2026-08-23 真机实测确认 Android/Chromium **不做**这套自动避让——
 * IME 弹出时 `contentOffset`、`scrollTop` 全程为 0，窗口也不被 resize——所以那里不存在可二次补偿的对象。
 * 因此本 hook 支持按平台把 `keyboardInset` 写进 `--fc-kb`，由 `writeKeyboardInset` 显式打开，
 * 默认关闭。方案见 `docs/mobile_keyboard_layout.md`。
 */

import {type RefObject, useCallback, useEffect, useState} from 'react'
import {
    getMobileFocusReferenceHeight,
    getMobileViewportState,
    isMobileTextEditingElement,
    isMobileInputModeActive,
} from './mobileInputMode'
import {
    applyMobileKeyboardInset,
    installKeyboardPanCompensation,
    predictMobileKeyboardInset,
    resetMobileKeyboardInset,
    setMobileKeyboardInsetEnabled,
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
        if (!writeKeyboardInset) return () => setMobileKeyboardInsetEnabled(false)
        const disposePan = installKeyboardPanCompensation()
        return () => {
            disposePan()
            setMobileKeyboardInsetEnabled(false)
        }
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
            if (textInputFocused && viewport.keyboardVisible) keyboardSeenForFocus = true

            /*
             * 只在 keyboardVisible（既有的 80px 阈值）为真时才认这个高度。
             * 直接写 keyboardInset 会让系统栏的微小伸缩也推动布局——那 80px 阈值
             * 本来就是为排除这类抖动而存在的，这里复用它而不是另立一个。
             * 键盘未可见时是否要归零，交给 applyMobileKeyboardInset 按乐观让位的宽限期决定。
             */
            applyMobileKeyboardInset(viewport.keyboardInset, viewport.keyboardVisible)

            const nextActive = isMobileInputModeActive({
                textInputFocused,
                keyboardVisible: viewport.keyboardVisible,
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

            if (!textInputFocused && !viewport.keyboardVisible) {
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
            /*
             * 在键盘真正弹出之前先按学到的高度让位，让输入区落进「键盘弹出后的可视区」。
             * 否则 Chromium 会平移视觉视口去露出它，把固定顶栏推出屏幕——那次平移收不回来。
             * 这里只改 CSS 变量，不碰 focus/preventDefault，不影响唤起链路。
             */
            if (isMobileTextEditingElement(event.target as Element | null)) predictMobileKeyboardInset()
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
        update()

        return () => {
            resetMobileKeyboardInset()
            if (frame) cancelAnimationFrame(frame)
            if (restoreTimer) window.clearTimeout(restoreTimer)
            if (viewportPollTimer) window.clearInterval(viewportPollTimer)
            observer.disconnect()
            document.removeEventListener('focusin', handleFocusIn, true)
            document.removeEventListener('focusout', handleFocusOut, true)
            window.removeEventListener('resize', scheduleUpdate)
            window.visualViewport?.removeEventListener('resize', scheduleUpdate)
            window.visualViewport?.removeEventListener('scroll', scheduleUpdate)
        }
    }, [rootRef])

    return {active, dismissFocusedInput}
}
