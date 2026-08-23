/*
 * 移动端 AI 消息区的底部跟随协调器。
 *
 * 普通消息增长与软键盘抬升共用同一个滚动容器，但键盘只负责改变可用高度；
 * 本 hook 只在用户原本跟随底部时校正 scrollTop，不参与键盘高度计算或页面几何。
 */

import {type RefObject, useEffect, useLayoutEffect, useRef} from 'react'
import {subscribeMobileKeyboardInset} from '../mobileKeyboardInset'
import {shouldFollowMobileAiKeyboardRise} from './mobileAiMessageScroll'

interface MobileAiMessageScrollOptions {
    active: boolean
    activeConversationId: string | null
    autoScroll: boolean
    keyboardVisible: boolean
    messageCount: number
    messageListEmpty: boolean
    messagesEndRef: RefObject<HTMLDivElement | null>
    setAutoScroll: (value: boolean) => void
    streamingBlocks: unknown
}

export function useMobileAiMessageScroll({
    active,
    activeConversationId,
    autoScroll,
    keyboardVisible,
    messageCount,
    messageListEmpty,
    messagesEndRef,
    setAutoScroll,
    streamingBlocks,
}: MobileAiMessageScrollOptions): void {
    const lastScrollTopRef = useRef(0)
    const contentScrollFrameRef = useRef<number | null>(null)
    const keyboardScrollFrameRef = useRef<number | null>(null)
    const keyboardWasVisibleRef = useRef(false)
    const followKeyboardRiseRef = useRef(false)

    useEffect(() => {
        if (!active || contentScrollFrameRef.current !== null || (!messageListEmpty && !autoScroll)) return
        contentScrollFrameRef.current = window.requestAnimationFrame(() => {
            contentScrollFrameRef.current = null
            const container = messagesEndRef.current?.parentElement
            if (container) container.scrollTop = messageListEmpty ? 0 : container.scrollHeight
            if (messageListEmpty) {
                lastScrollTopRef.current = 0
                setAutoScroll(true)
            }
        })
    }, [
        active,
        activeConversationId,
        autoScroll,
        messageCount,
        messageListEmpty,
        messagesEndRef,
        setAutoScroll,
        streamingBlocks,
    ])

    useEffect(() => {
        const container = messagesEndRef.current?.parentElement
        if (!container) return
        const handleScroll = () => {
            const {scrollTop, scrollHeight, clientHeight} = container
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight
            if (scrollTop < lastScrollTopRef.current && distanceFromBottom > 50) {
                setAutoScroll(false)
            } else if (distanceFromBottom <= 50) {
                setAutoScroll(true)
            }
            lastScrollTopRef.current = scrollTop
        }
        container.addEventListener('scroll', handleScroll, {passive: true})
        return () => container.removeEventListener('scroll', handleScroll)
    }, [messagesEndRef, setAutoScroll])

    useLayoutEffect(() => {
        const keyboardRising = keyboardVisible && !keyboardWasVisibleRef.current
        keyboardWasVisibleRef.current = keyboardVisible
        if (!keyboardVisible) {
            followKeyboardRiseRef.current = false
            return
        }
        if (keyboardRising) {
            followKeyboardRiseRef.current = shouldFollowMobileAiKeyboardRise({
                active,
                autoScroll,
                keyboardRising,
                messageListEmpty,
            })
        }
        if (!followKeyboardRiseRef.current || !active || !autoScroll || messageListEmpty) return

        const container = messagesEndRef.current?.parentElement
        if (!container) return
        const page = container.closest<HTMLElement>('.mobile-ai-chat')
        const scrollToBottom = () => {
            keyboardScrollFrameRef.current = null
            container.scrollTop = container.scrollHeight
            lastScrollTopRef.current = container.scrollTop
        }
        const scheduleScrollToBottom = () => {
            if (keyboardScrollFrameRef.current !== null) return
            keyboardScrollFrameRef.current = window.requestAnimationFrame(scrollToBottom)
        }
        const handleTransitionEnd = (event: TransitionEvent) => {
            if (event.propertyName === 'padding-bottom') scheduleScrollToBottom()
        }

        scheduleScrollToBottom()
        const disposeKeyboardInset = subscribeMobileKeyboardInset(scheduleScrollToBottom)
        const resizeObserver = typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(scheduleScrollToBottom)
        resizeObserver?.observe(container)
        page?.addEventListener('transitionend', handleTransitionEnd)

        return () => {
            disposeKeyboardInset()
            resizeObserver?.disconnect()
            page?.removeEventListener('transitionend', handleTransitionEnd)
            if (keyboardScrollFrameRef.current !== null) {
                window.cancelAnimationFrame(keyboardScrollFrameRef.current)
                keyboardScrollFrameRef.current = null
            }
        }
    }, [active, autoScroll, keyboardVisible, messageListEmpty, messagesEndRef])

    useEffect(() => () => {
        if (contentScrollFrameRef.current !== null) {
            window.cancelAnimationFrame(contentScrollFrameRef.current)
        }
    }, [])
}
