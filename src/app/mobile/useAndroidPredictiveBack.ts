/*
 * Android 预测式返回桥。
 *
 * 原生 OnBackPressedCallback 提供 0..1 进度；本 hook 把它转换成现有双层页面的
 * 跟手位移。输入、浮层和抽屉不启动页面预览，最终返回交给原有优先级处理。
 */

import {useEffect, useRef, useState} from 'react'
import type {MobileEdgeBackPhase} from './useMobileSideDrawerGesture'

const FALLBACK_EVENT = 'flowcloudai:android-back-fallback'

interface AndroidBackProgressDetail {
    progress?: number
}

interface UseAndroidPredictiveBackOptions {
    enabled: boolean
    canAnimate: () => boolean
    beforeBack: () => boolean | void | Promise<boolean | void>
    commitBack: () => boolean | void | Promise<boolean | void>
    onStart: () => void
    onFinish: () => void
}

export interface AndroidPredictiveBackState {
    phase: MobileEdgeBackPhase
    progress: number
    offset: number
}

function clampProgress(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(1, Math.max(0, value))
        : 0
}

function getSettleDuration(): number {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0
    const value = getComputedStyle(document.documentElement)
        .getPropertyValue('--mobile-duration-base')
        .trim()
    if (!value) return 220
    const amount = Number.parseFloat(value)
    if (!Number.isFinite(amount)) return 220
    return value.endsWith('s') && !value.endsWith('ms') ? amount * 1000 : amount
}

export function useAndroidPredictiveBack({
    enabled,
    canAnimate,
    beforeBack,
    commitBack,
    onStart,
    onFinish,
}: UseAndroidPredictiveBackOptions): AndroidPredictiveBackState {
    const [phase, setPhase] = useState<MobileEdgeBackPhase>('idle')
    const [progress, setProgress] = useState(0)
    const attemptRef = useRef(0)
    const eligibleRef = useRef(false)
    const activeRef = useRef(false)
    const latestProgressRef = useRef(0)
    const preparationRef = useRef<Promise<boolean> | null>(null)
    const settleTimerRef = useRef<number | null>(null)

    useEffect(() => {
        if (!enabled) return

        const clearSettle = () => {
            if (settleTimerRef.current === null) return
            window.clearTimeout(settleTimerRef.current)
            settleTimerRef.current = null
        }
        const reset = (notifyFinish = false) => {
            clearSettle()
            eligibleRef.current = false
            activeRef.current = false
            preparationRef.current = null
            latestProgressRef.current = 0
            setProgress(0)
            setPhase('idle')
            if (notifyFinish) onFinish()
        }
        const settleToIdle = (nextPhase: MobileEdgeBackPhase, nextProgress: number, done?: () => void) => {
            clearSettle()
            setPhase(nextPhase)
            setProgress(nextProgress)
            settleTimerRef.current = window.setTimeout(() => {
                settleTimerRef.current = null
                done?.()
                reset(true)
            }, getSettleDuration())
        }
        const handleStart = (event: Event) => {
            const attempt = ++attemptRef.current
            clearSettle()
            latestProgressRef.current = clampProgress(
                (event as CustomEvent<AndroidBackProgressDetail>).detail?.progress,
            )
            eligibleRef.current = canAnimate()
            activeRef.current = false
            setProgress(0)
            setPhase('idle')
            if (!eligibleRef.current) {
                preparationRef.current = null
                return
            }

            preparationRef.current = Promise.resolve(beforeBack()).then(result => {
                const allowed = result !== false
                if (attempt !== attemptRef.current || !allowed) return allowed
                activeRef.current = true
                onStart()
                setPhase('tracking')
                setProgress(latestProgressRef.current)
                return true
            }).catch(() => false)
        }
        const handleProgress = (event: Event) => {
            latestProgressRef.current = clampProgress(
                (event as CustomEvent<AndroidBackProgressDetail>).detail?.progress,
            )
            if (activeRef.current) setProgress(latestProgressRef.current)
        }
        const handleCancel = () => {
            attemptRef.current += 1
            if (activeRef.current) settleToIdle('cancelling', 0)
            else reset()
        }
        const handleInvoke = () => {
            const attempt = attemptRef.current
            if (!eligibleRef.current) {
                reset()
                window.dispatchEvent(new Event(FALLBACK_EVENT))
                return
            }

            void (async () => {
                const allowed = await (preparationRef.current ?? Promise.resolve(false))
                if (attempt !== attemptRef.current) return
                if (!allowed) {
                    reset()
                    return
                }
                if (!activeRef.current) {
                    activeRef.current = true
                    onStart()
                }
                settleToIdle('committing', 1, () => {
                    void Promise.resolve(commitBack())
                })
            })()
        }

        window.addEventListener('flowcloudai:android-back-start', handleStart)
        window.addEventListener('flowcloudai:android-back-progress', handleProgress)
        window.addEventListener('flowcloudai:android-back-cancel', handleCancel)
        window.addEventListener('flowcloudai:android-back-invoked', handleInvoke)
        return () => {
            attemptRef.current += 1
            clearSettle()
            window.removeEventListener('flowcloudai:android-back-start', handleStart)
            window.removeEventListener('flowcloudai:android-back-progress', handleProgress)
            window.removeEventListener('flowcloudai:android-back-cancel', handleCancel)
            window.removeEventListener('flowcloudai:android-back-invoked', handleInvoke)
        }
    }, [beforeBack, canAnimate, commitBack, enabled, onFinish, onStart])

    return {
        phase,
        progress,
        offset: typeof window === 'undefined' ? 0 : window.innerWidth * progress,
    }
}
