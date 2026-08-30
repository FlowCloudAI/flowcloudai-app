/*
 * 输入卡占位高度上报。
 *
 * 消息列表的底部留白、滚动落点和底部渐隐都要按输入卡的实际高度让位，而输入卡会因
 * 已引用文档栏、编辑横幅和多行输入长高：真机实测空输入卡 116px，挂上文档栏后 182px，
 * 写死的 8.25rem（132px）会让最后一条消息压在输入卡后面。
 *
 * 做法与桌面端 AIChatContent 的 --ai-messages-bottom-space 一致：实测后写成 CSS 变量，
 * 由 CSS 统一决定留白与渐隐位置。
 */
import {useLayoutEffect} from 'react'
import type {RefObject} from 'react'

export function useMobileAiComposerClearance(
    pageRef: RefObject<HTMLDivElement | null>,
    composerRef: RefObject<HTMLElement | null>,
): void {
    useLayoutEffect(() => {
        const page = pageRef.current
        const composer = composerRef.current
        if (!page || !composer) return

        const sync = () => {
            const height = composer.offsetHeight
            // Tab 未激活时整页 display:none，量到的是 0；此时保留上一次的有效值。
            if (height > 0) page.style.setProperty('--mobile-ai-composer-height', `${height}px`)
        }

        sync()
        const observer = new ResizeObserver(sync)
        observer.observe(composer)
        return () => observer.disconnect()
    }, [composerRef, pageRef])
}
