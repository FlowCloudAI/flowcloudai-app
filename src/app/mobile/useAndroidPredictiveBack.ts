/*
 * Android 预测式返回桥。
 *
 * 原生 OnBackPressedCallback 提供 0..1 进度；本 hook 把它转换成现有双层页面的
 * 跟手位移。输入、浮层和抽屉不启动页面预览，最终返回交给原有优先级处理。
 */

import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import type {MobileEdgeBackPhase} from './useMobileSideDrawerGesture'
import {getMobileBackSettleDurationMs} from './useMobilePagePopTransition'
import {resolveAndroidPredictiveBackInvoke} from './androidPredictiveBackModel'

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
    const callbacksRef = useRef({canAnimate, beforeBack, commitBack, onStart, onFinish})

    /*
     * 原生手势监听跨越异步确认框；回调更新不能拆掉监听并把进行中的 attempt 判旧。
     * layout effect 先于确认框 Provider 完成关闭后的 Promise，同一手势提交时可读到最新闭包。
     */
    useLayoutEffect(() => {
        callbacksRef.current = {canAnimate, beforeBack, commitBack, onStart, onFinish}
    }, [beforeBack, canAnimate, commitBack, onFinish, onStart])

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
            if (notifyFinish) callbacksRef.current.onFinish()
        }
        const settleToIdle = (nextPhase: MobileEdgeBackPhase, nextProgress: number, done?: () => void) => {
            clearSettle()
            setPhase(nextPhase)
            setProgress(nextProgress)
            settleTimerRef.current = window.setTimeout(() => {
                settleTimerRef.current = null
                done?.()
                reset(true)
            }, getMobileBackSettleDurationMs())
        }
        const handleStart = (event: Event) => {
            const attempt = ++attemptRef.current
            clearSettle()
            latestProgressRef.current = clampProgress(
                (event as CustomEvent<AndroidBackProgressDetail>).detail?.progress,
            )
            eligibleRef.current = callbacksRef.current.canAnimate()
            activeRef.current = false
            setProgress(0)
            setPhase('idle')
            if (!eligibleRef.current) {
                preparationRef.current = null
                return
            }

            preparationRef.current = Promise.resolve(callbacksRef.current.beforeBack()).then(result => {
                const allowed = result !== false
                if (attempt !== attemptRef.current || !allowed) return allowed
                activeRef.current = true
                callbacksRef.current.onStart()
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
                const resolution = resolveAndroidPredictiveBackInvoke({
                    startedAttempt: attempt,
                    currentAttempt: attemptRef.current,
                    preparationAllowed: allowed,
                })
                if (resolution === 'stale') return
                if (resolution === 'cancel') {
                    reset()
                    return
                }
                if (!activeRef.current) {
                    activeRef.current = true
                    callbacksRef.current.onStart()
                }
                settleToIdle('committing', 1, () => {
                    void Promise.resolve(callbacksRef.current.commitBack())
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
    }, [enabled])

    return {
        phase,
        progress,
        offset: typeof window === 'undefined' ? 0 : window.innerWidth * progress,
    }
}
