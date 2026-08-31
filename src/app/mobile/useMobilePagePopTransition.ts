/*
 * 无手势返回的页面滑出转场。
 *
 * 边缘手势和 Android 预测式返回都会让栈顶页跟着手指右移（`is-edge-back-foreground` +
 * `--mobile-edge-back-shift`），松手后把剩下的路程走完再提交 pop。顶栏返回按钮、三键导航的
 * 返回键没有这段手势输入，此前是直接 pop：旧页原地消失，只有新栈顶播一段 16px 的淡入，
 * 同一个「返回」在两条路径上是两种观感。
 *
 * 这里把同一套位移用「两帧起手 + 定时器收尾」跑完整程。不复用 useMobileSideDrawerGesture
 * 的结算：那套以指针采样为输入，要拿它跑无手势的返回就得伪造一串 pointer 事件。
 */

import {useCallback, useEffect, useRef, useState} from 'react'
import type {MobileEdgeBackPhase} from './useMobileSideDrawerGesture'

/** 取一个时间 token 的毫秒值；读不到或读不动就用兜底值。 */
function readTimeTokenMs(name: string, fallback: number): number {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (!value) return fallback
    const amount = Number.parseFloat(value)
    if (!Number.isFinite(amount)) return fallback
    return value.endsWith('s') && !value.endsWith('ms') ? amount * 1000 : amount
}

/**
 * 返回结算时长：`--mobile-duration-base` 与下限 `--mobile-duration-back-floor` 取大。
 * 系统开启减少动态效果时直接为 0，调用方据此跳过转场立即提交。
 *
 * 这里的 max 必须与 `--mobile-duration-back`（MobileApp.css 的过渡时长）算同一个数：
 * 定时器比 CSS 短会在动画没走完时就出栈，比 CSS 长会让旧页停在屏幕右缘干等。
 * 两边都只依赖那两个 token，所以不会各自漂。
 */
export function getMobileBackSettleDurationMs(): number {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0
    return Math.max(
        readTimeTokenMs('--mobile-duration-back-floor', 50),
        readTimeTokenMs('--mobile-duration-base', 220),
    )
}

interface UseMobilePagePopTransitionOptions {
    /** 标记本次滑出的前景页；与边缘返回共用 edgeBackOrigin。 */
    onStart: () => void
    onFinish: () => void
}

export interface MobilePagePopTransitionState {
    phase: MobileEdgeBackPhase
    progress: number
    offset: number
    /** 播完滑出再执行 commit；正在播、或系统要求减少动态效果时立即 commit。 */
    runPop: (commit: () => void) => void
}

export function useMobilePagePopTransition({
    onStart,
    onFinish,
}: UseMobilePagePopTransitionOptions): MobilePagePopTransitionState {
    const [phase, setPhase] = useState<MobileEdgeBackPhase>('idle')
    const [progress, setProgress] = useState(0)
    const runningRef = useRef(false)
    const frameRef = useRef<number | null>(null)
    const timerRef = useRef<number | null>(null)

    const clearPending = useCallback(() => {
        if (frameRef.current !== null) {
            window.cancelAnimationFrame(frameRef.current)
            frameRef.current = null
        }
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current)
            timerRef.current = null
        }
    }, [])

    useEffect(() => clearPending, [clearPending])

    const runPop = useCallback((commit: () => void) => {
        // 动画途中再点一次不排队：页面栈只允许提交一次，多出来的返回直接丢掉。
        if (runningRef.current) return
        const duration = getMobileBackSettleDurationMs()
        if (duration <= 0) {
            commit()
            return
        }
        runningRef.current = true
        onStart()
        setPhase('committing')
        setProgress(0)
        /*
         * 必须空转两帧再给终点：is-edge-back-foreground 和终点位移落在同一次 commit 里时，
         * 元素的起始值就是终点值，transform 过渡根本不会启动，表现为旧页直接消失。
         */
        frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = window.requestAnimationFrame(() => {
                frameRef.current = null
                setProgress(1)
                timerRef.current = window.setTimeout(() => {
                    timerRef.current = null
                    runningRef.current = false
                    /*
                     * 提交与复位放在同一批：旧层在这次 commit 里卸载，
                     * 位移变量随之失去作用对象，不会有「弹回原位」的中间帧。
                     */
                    commit()
                    setProgress(0)
                    setPhase('idle')
                    onFinish()
                }, duration)
            })
        })
    }, [onFinish, onStart])

    return {
        phase,
        progress,
        offset: typeof window === 'undefined' ? 0 : window.innerWidth * progress,
        runPop,
    }
}
