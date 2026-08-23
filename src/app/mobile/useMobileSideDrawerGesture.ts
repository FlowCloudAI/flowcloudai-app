import {useDrag} from '@use-gesture/react'
import {
    type HTMLAttributes,
    type MouseEvent as ReactMouseEvent,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react'
import {logger} from '../../shared/logger'
import {
    getMobileEdgeBackCommitDistance,
    getMobileEdgeBackCompletionDistance,
    getMobileEdgeBackProgress,
    MOBILE_EDGE_BACK_GESTURE_TUNING,
    shouldCommitMobileEdgeBack,
} from './mobileEdgeBackGesture'

export type MobileEdgeBackPhase = 'idle' | 'tracking' | 'cancelling' | 'committing'

interface UseMobileSideDrawerGestureOptions {
    /**
     * 本页是否有侧边抽屉。只控制抽屉部分的横滑；
     * 左边缘返回手势独立于它，由 onEdgeBackGesture 决定（见下）。
     */
    enabled: boolean
    width: number
    logLabel?: string
    /**
     * 是否允许从 input / textarea / contenteditable 等文本编辑区域开始识别抽屉手势。
     * 默认关闭，避免普通表单页误触；灵感便签这种编辑器优先页面可以开启，让右划更容易呼出抽屉。
     */
    allowTextEditingTargetGestures?: boolean
    /**
     * 从屏幕左边缘向右滑时触发返回，而不是打开侧边抽屉。
     * 传了就一直生效，**不受 enabled 影响**——「边缘右划 = 返回」是全局手势语法，
     * 不能因为本页恰好没有抽屉就消失。不传则保留纯抽屉行为，
     * 适合没有页面返回语义的嵌入场景。
     */
    onEdgeBackGesture?: () => boolean | void | Promise<boolean | void>
    /**
     * 进入完整滑出动画前的统一闸门。未保存内容或根页退出确认在这里处理；
     * 返回 false 时当前页回弹，不会先滑走再弹回。
     */
    beforeEdgeBackGesture?: () => boolean | void | Promise<boolean | void>
    /** 首次确认边缘右划时通知外层锁定当前页身份，避免 pop 后新栈顶继承旧页位移。 */
    onEdgeBackStart?: () => void
    /** 动画和无过渡归零完成时，与 idle 状态同批清理外层锁定的页面身份。 */
    onEdgeBackFinish?: () => void
    /**
     * 每帧求值的让路谓词：返回 true 时本手势立即放弃当前这一划。
     *
     * 与 `data-mobile-side-drawer-gesture-ignore` 的区别是**时机**：那个标记只在 touchstart
     * 时看一眼，而抽屉里的分类树是「长按 430ms 才进入拖拽」的，按下那一刻还看不出来。
     * 实测（2026-07-27 真机）不逐帧检查的话，节点拖拽中手指往左飘就会把抽屉一起关掉，
     * 树跟着卸载、拖拽中断。
     */
    shouldSuppress?: () => boolean
}

interface MobileSideDrawerDragRuntime {
    edgeBackCandidate: boolean
    openBefore: boolean
    started: boolean
}

export interface MobileSideDrawerGesture {
    open: boolean
    drawerDragging: boolean
    edgeBackTransitionDisabled: boolean
    offset: number | null
    surfaceOffset: number
    edgeBackOffset: number
    edgeBackProgress: number
    edgeBackPhase: MobileEdgeBackPhase
    completeEdgeBackTransition: () => void
    openDrawer: () => void
    closeDrawer: () => void
    pointerHandlers: HTMLAttributes<HTMLElement>
}

export const MOBILE_SIDE_DRAWER_GESTURE_TUNING = {
    /**
     * 浏览器/预览环境拿不到真实窗口宽度时使用的默认抽屉宽度。
     * 调大后预览里的抽屉会更宽；真机/模拟器通常会走 viewport 计算，不受它影响。
     */
    fallbackWidth: 320,

    /**
     * 抽屉展开后右侧保留的主页面露出宽度。
     * 调大后主页面剩余可见区域更宽，抽屉更窄；调小后抽屉更接近全屏。
     */
    viewportRightPeek: 54,

    /**
     * 抽屉宽度下限。
     * 调大后窄屏设备上的抽屉不会过窄，但右侧主页面露出区域会被压缩。
     */
    minWidth: 260,

    /**
     * 抽屉宽度上限。
     * 调大后宽屏设备上的抽屉可以更宽；调小后平板/横屏时抽屉更克制。
     */
    maxWidth: 360,

    /**
     * 开始横滑识别前，手指至少要横向移动的距离。
     * 调小后更容易触发抽屉，误触概率会上升；调大后需要更明确的横滑动作。
     */
    horizontalStartDistance: 8,

    /**
     * 关闭状态下，结算为打开所需的最小右滑距离。
     * 调小后短促右滑就能打开；调大后必须拖得更远才会吸附展开。
     */
    openSettleDistance: 6,

    /**
     * 打开状态下，结算为关闭所需的最小左滑距离。
     * 调小后轻微左滑就会关闭；调大后需要更明确的左滑才会收起。
     */
    closeSettleDistance: 12,

    /**
     * 横滑结束后屏蔽 click 事件的时间。
     * 调大后更能避免“滑完误点按钮”；调小后滑动结束后的点击响应恢复更快。
     */
    suppressClickMs: 180,

    /**
     * 快速滑动直接结算为打开/关闭的速度阈值，单位约为 px/ms。
     * 调小后轻扫更容易生效；调大后主要依赖拖动距离结算。
     */
    flingVelocity: 0.25,
} as const

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

export function getMobileSideDrawerWidth(): number {
    if (typeof window === 'undefined') return MOBILE_SIDE_DRAWER_GESTURE_TUNING.fallbackWidth
    const width = window.innerWidth || MOBILE_SIDE_DRAWER_GESTURE_TUNING.fallbackWidth
    return clamp(
        width - MOBILE_SIDE_DRAWER_GESTURE_TUNING.viewportRightPeek,
        MOBILE_SIDE_DRAWER_GESTURE_TUNING.minWidth,
        MOBILE_SIDE_DRAWER_GESTURE_TUNING.maxWidth,
    )
}

function isTextEditingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function isHorizontalScrollGestureTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return Boolean(target.closest('[data-mobile-horizontal-scroll="true"]'))
}

function isInternalGestureTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return Boolean(target.closest('[data-mobile-side-drawer-gesture-ignore="true"]'))
}

function getElementClassName(target: EventTarget): string {
    if (!(target instanceof HTMLElement)) return 'unknown'
    return typeof target.className === 'string' ? target.className : String(target.className)
}

function getPointerId(event: Event): number | string {
    return 'pointerId' in event && typeof event.pointerId === 'number' ? event.pointerId : 'gesture'
}

function getPointerType(event: Event): string {
    return 'pointerType' in event && typeof event.pointerType === 'string' ? event.pointerType : event.type
}

function getTagName(target: EventTarget | null): string {
    return target instanceof HTMLElement ? target.tagName : 'unknown'
}

function getEdgeBackTransitionDurationMs(): number {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0
    const value = getComputedStyle(document.documentElement)
        .getPropertyValue('--mobile-duration-base')
        .trim()
    if (!value) return 220
    const amount = Number.parseFloat(value)
    if (!Number.isFinite(amount)) return 220
    return value.endsWith('s') && !value.endsWith('ms') ? amount * 1000 : amount
}

export function useMobileSideDrawerGesture({
    enabled,
    width,
    logLabel = '[移动端侧边抽屉手势]',
    allowTextEditingTargetGestures = false,
    onEdgeBackGesture,
    beforeEdgeBackGesture,
    onEdgeBackStart,
    onEdgeBackFinish,
    shouldSuppress,
}: UseMobileSideDrawerGestureOptions): MobileSideDrawerGesture {
    // 抽屉不在的页面（词条详情、世界观列表、各管理页、设置…）仍然要能边缘右划返回，
    // 所以整个手势的开关是「有抽屉」或「有返回」，不能只看 enabled。
    const edgeBackEnabled = Boolean(onEdgeBackGesture)
    const gestureEnabled = enabled || edgeBackEnabled

    const [open, setOpen] = useState(false)
    const [offset, setOffset] = useState<number | null>(null)
    const [drawerDragging, setDrawerDragging] = useState(false)
    const [edgeBackTransitionDisabled, setEdgeBackTransitionDisabled] = useState(false)
    const [edgeBackOffset, setEdgeBackOffset] = useState(0)
    const [edgeBackProgress, setEdgeBackProgress] = useState(0)
    const [edgeBackPhase, setEdgeBackPhase] = useState<MobileEdgeBackPhase>('idle')
    const dragRuntimeRef = useRef<MobileSideDrawerDragRuntime | null>(null)
    // ref 包一层，避免调用方为谓词套 useCallback，也让它在手势回调里始终读到最新实现。
    // 同步放在 effect 里而不是渲染期：渲染期写 ref 会被 react-hooks 规则拦下，
    // 而这个谓词只在手势回调（渲染之后）里读，晚一拍赋值没有影响。
    const shouldSuppressRef = useRef(shouldSuppress)
    useEffect(() => {
        shouldSuppressRef.current = shouldSuppress
    }, [shouldSuppress])
    const suppressClickRef = useRef(false)
    const suppressClickTimerRef = useRef<number | null>(null)
    const edgeBackSettleTimerRef = useRef<number | null>(null)
    const edgeBackResetFrameRef = useRef<number | null>(null)
    const edgeBackSettlePhaseRef = useRef<'cancelling' | 'committing' | null>(null)
    const edgeBackAttemptRef = useRef(0)

    const clearSuppressClickTimer = useCallback(() => {
        if (suppressClickTimerRef.current === null) return
        window.clearTimeout(suppressClickTimerRef.current)
        suppressClickTimerRef.current = null
    }, [])

    const suppressNextClick = useCallback(() => {
        suppressClickRef.current = true
        clearSuppressClickTimer()
        suppressClickTimerRef.current = window.setTimeout(() => {
            suppressClickRef.current = false
            suppressClickTimerRef.current = null
        }, MOBILE_SIDE_DRAWER_GESTURE_TUNING.suppressClickMs)
    }, [clearSuppressClickTimer])

    const clearEdgeBackSettle = useCallback(() => {
        if (edgeBackSettleTimerRef.current !== null) {
            window.clearTimeout(edgeBackSettleTimerRef.current)
            edgeBackSettleTimerRef.current = null
        }
        if (edgeBackResetFrameRef.current !== null) {
            window.cancelAnimationFrame(edgeBackResetFrameRef.current)
            edgeBackResetFrameRef.current = null
        }
    }, [])

    const finishEdgeBackVisual = useCallback(() => {
        edgeBackAttemptRef.current += 1
        clearEdgeBackSettle()
        edgeBackSettlePhaseRef.current = null
        // 清理页面身份与 phase 前先禁用一帧过渡，避免 transform 层回收时闪回旧页。
        setEdgeBackTransitionDisabled(true)
        edgeBackResetFrameRef.current = window.requestAnimationFrame(() => {
            onEdgeBackFinish?.()
            setEdgeBackOffset(0)
            setEdgeBackProgress(0)
            setEdgeBackPhase('idle')
            edgeBackResetFrameRef.current = window.requestAnimationFrame(() => {
                edgeBackResetFrameRef.current = null
                setEdgeBackTransitionDisabled(false)
            })
        })
    }, [clearEdgeBackSettle, onEdgeBackFinish])

    const cancelEdgeBack = useCallback(() => {
        edgeBackAttemptRef.current += 1
        clearEdgeBackSettle()
        edgeBackSettlePhaseRef.current = 'cancelling'
        setEdgeBackTransitionDisabled(false)
        setEdgeBackOffset(0)
        setEdgeBackProgress(0)
        setEdgeBackPhase('cancelling')
        // transitionend 是主路径；兜底防止 WebView 丢事件或系统启用减少动态效果。
        const fallbackDuration = getEdgeBackTransitionDurationMs() + 80
        edgeBackSettleTimerRef.current = window.setTimeout(() => {
            edgeBackSettleTimerRef.current = null
            if (edgeBackSettlePhaseRef.current !== 'cancelling') return
            finishEdgeBackVisual()
        }, fallbackDuration)
    }, [clearEdgeBackSettle, finishEdgeBackVisual])

    const completeEdgeBackTransition = useCallback(() => {
        const settlePhase = edgeBackSettlePhaseRef.current
        if (!settlePhase) return
        edgeBackSettlePhaseRef.current = null
        if (edgeBackSettleTimerRef.current !== null) {
            window.clearTimeout(edgeBackSettleTimerRef.current)
            edgeBackSettleTimerRef.current = null
        }
        if (settlePhase === 'cancelling') {
            finishEdgeBackVisual()
            return
        }

        const attemptId = edgeBackAttemptRef.current
        void Promise.resolve(onEdgeBackGesture?.()).then(didNavigate => {
            if (attemptId !== edgeBackAttemptRef.current) return
            if (didNavigate === false) {
                cancelEdgeBack()
                return
            }
            finishEdgeBackVisual()
        }).catch(error => {
            if (attemptId !== edgeBackAttemptRef.current) return
            logger.error(`${logLabel} 左边缘返回失败`, error)
            cancelEdgeBack()
        })
    }, [cancelEdgeBack, finishEdgeBackVisual, logLabel, onEdgeBackGesture])

    const resetDrag = useCallback(() => {
        dragRuntimeRef.current = null
        setOffset(null)
        setDrawerDragging(false)
    }, [])

    const closeDrawer = useCallback(() => {
        setOpen(false)
        resetDrag()
    }, [resetDrag])

    const openDrawer = useCallback(() => {
        if (!enabled) return
        resetDrag()
        setOpen(true)
    }, [enabled, resetDrag])

    useEffect(() => {
        if (!enabled) closeDrawer()
    }, [closeDrawer, enabled])

    useEffect(() => {
        return () => {
            edgeBackAttemptRef.current += 1
            clearSuppressClickTimer()
            clearEdgeBackSettle()
        }
    }, [clearEdgeBackSettle, clearSuppressClickTimer])

    const bindDrag = useDrag(({
        cancel,
        currentTarget,
        direction: [directionX],
        event,
        first,
        initial: [startX, startY],
        last,
        movement: [moveX, moveY],
        offset: [nextOffset],
        velocity: [velocityX],
    }) => {
        if (!gestureEnabled) return

        const pointerId = getPointerId(event)

        // 逐帧让路：分类树的长按拖拽在按下 430ms 后才成立，光靠 first 阶段的判定拦不住。
        if (shouldSuppressRef.current?.()) {
            const suppressedRuntime = dragRuntimeRef.current
            if (suppressedRuntime) {
                logger.info(`${logLabel} 让路`, {pointerId, reason: '上层手势已接管（如分类树拖拽）'})
                if (suppressedRuntime.edgeBackCandidate && suppressedRuntime.started) cancelEdgeBack()
                else resetDrag()
            }
            dragRuntimeRef.current = null
            cancel()
            return
        }

        if (first) {
            edgeBackAttemptRef.current += 1
            clearEdgeBackSettle()
            edgeBackSettlePhaseRef.current = null
            setEdgeBackOffset(0)
            setEdgeBackProgress(0)
            setEdgeBackPhase('idle')
            const edgeBackCandidate = Boolean(
                !open
                && onEdgeBackGesture
                && startX <= MOBILE_EDGE_BACK_GESTURE_TUNING.startWidth,
            )

            // 本页没有抽屉、这一划又不是边缘返回：不归我们管，静默放过。
            // 这在词条详情等无抽屉页面是常态，记日志只会淹掉真正有用的手势日志。
            if (!enabled && !edgeBackCandidate) {
                dragRuntimeRef.current = null
                cancel()
                return
            }

            const ignoredReason = !allowTextEditingTargetGestures && isTextEditingTarget(event.target)
                ? '文本编辑区域'
                : isInternalGestureTarget(event.target)
                    ? '内部手势区域'
                    : !edgeBackCandidate && isHorizontalScrollGestureTarget(event.target)
                        ? '横向滚动区域'
                        : ''

            if (ignoredReason) {
                logger.info(`${logLabel} 忽略`, {
                    pointerId,
                    reason: ignoredReason,
                    target: getTagName(event.target),
                })
                dragRuntimeRef.current = null
                cancel()
                return
            }

            dragRuntimeRef.current = {
                edgeBackCandidate,
                openBefore: open,
                started: false,
            }
            logger.info(`${logLabel} 按下`, {
                pointerId,
                pointerType: getPointerType(event),
                open,
                drawerWidth: width,
                startX: Math.round(startX),
                startY: Math.round(startY),
                edgeBackCandidate,
                target: getTagName(event.target),
                area: getElementClassName(currentTarget),
            })
        }

        const runtime = dragRuntimeRef.current
        if (!runtime) return

        if (runtime.edgeBackCandidate) {
            if (moveX < 0) {
                logger.info(`${logLabel} 取消`, {
                    pointerId,
                    reason: '左边缘区域左滑',
                    dx: Math.round(moveX),
                    dy: Math.round(moveY),
                })
                dragRuntimeRef.current = null
                if (runtime.started) cancelEdgeBack()
                else resetDrag()
                cancel()
                return
            }

                if (!runtime.started) {
                    runtime.started = true
                    onEdgeBackStart?.()
                    setEdgeBackTransitionDisabled(true)
                    setEdgeBackPhase('tracking')
            }

            if (event.cancelable) event.preventDefault()
            const currentEdgeOffset = clamp(moveX, 0, width)
            const edgeBackViewportWidth = currentTarget instanceof HTMLElement
                ? currentTarget.getBoundingClientRect().width
                : window.innerWidth
            const edgeBackCommitDistance = getMobileEdgeBackCommitDistance(edgeBackViewportWidth)
            setEdgeBackOffset(currentEdgeOffset)
            setEdgeBackProgress(getMobileEdgeBackProgress(currentEdgeOffset, edgeBackViewportWidth))

            if (!last) return

            const shouldCommit = shouldCommitMobileEdgeBack({
                distance: currentEdgeOffset,
                directionX,
                velocityX,
                viewportWidth: edgeBackViewportWidth,
            })
            suppressNextClick()
            dragRuntimeRef.current = null

            logger.info(`${logLabel} 左边缘返回结算`, {
                pointerId,
                shouldCommit,
                dx: Math.round(moveX),
                dy: Math.round(moveY),
                velocityX: Number(velocityX.toFixed(3)),
                commitDistance: Math.round(edgeBackCommitDistance),
            })

            if (!shouldCommit) {
                cancelEdgeBack()
                return
            }

            const attemptId = edgeBackAttemptRef.current + 1
            edgeBackAttemptRef.current = attemptId
            setEdgeBackTransitionDisabled(false)
            void Promise.resolve(beforeEdgeBackGesture?.()).then(canNavigate => {
                if (attemptId !== edgeBackAttemptRef.current) return
                if (canNavigate === false) {
                    cancelEdgeBack()
                    return
                }

                const completionDuration = getEdgeBackTransitionDurationMs()
                edgeBackSettlePhaseRef.current = 'committing'
                setEdgeBackPhase('committing')
                setEdgeBackProgress(1)
                // 必须用 viewport 宽度而不是抽屉宽度，确保旧页完全离开右边界。
                setEdgeBackOffset(getMobileEdgeBackCompletionDistance(edgeBackViewportWidth))

                logger.info(`${logLabel} 左边缘返回完整滑出`, {
                    pointerId,
                    completionDistance: Math.round(edgeBackViewportWidth),
                    completionDuration,
                })

                edgeBackSettleTimerRef.current = window.setTimeout(() => {
                    edgeBackSettleTimerRef.current = null
                    if (attemptId !== edgeBackAttemptRef.current) return
                    completeEdgeBackTransition()
                }, completionDuration + 80)
            }).catch(error => {
                if (attemptId !== edgeBackAttemptRef.current) return
                logger.error(`${logLabel} 左边缘返回失败`, error)
                cancelEdgeBack()
            })
            return
        }

        if (!runtime.openBefore && moveX < 0) {
            logger.info(`${logLabel} 取消`, {
                pointerId,
                reason: '关闭状态下左滑',
                dx: Math.round(moveX),
                dy: Math.round(moveY),
            })
            resetDrag()
            cancel()
            return
        }

        if (!runtime.started) {
            runtime.started = true
            setDrawerDragging(true)
            logger.info(`${logLabel} 开始识别`, {
                pointerId,
                open: runtime.openBefore,
                dx: Math.round(moveX),
                dy: Math.round(moveY),
                baseOffset: runtime.openBefore ? Math.round(width) : 0,
                drawerWidth: Math.round(width),
            })
        }

        if (event.cancelable) event.preventDefault()
        const currentOffset = clamp(nextOffset, 0, width)
        setOffset(currentOffset)

        if (!last) return

        const dragDistance = currentOffset - (runtime.openBefore ? width : 0)
        const fastOpen = directionX > 0 && velocityX >= MOBILE_SIDE_DRAWER_GESTURE_TUNING.flingVelocity
        const fastClose = directionX < 0 && velocityX >= MOBILE_SIDE_DRAWER_GESTURE_TUNING.flingVelocity
        const shouldOpen = runtime.openBefore
            ? !fastClose && dragDistance > -MOBILE_SIDE_DRAWER_GESTURE_TUNING.closeSettleDistance
            : fastOpen || dragDistance >= MOBILE_SIDE_DRAWER_GESTURE_TUNING.openSettleDistance

        logger.info(`${logLabel} 结算`, {
            pointerId,
            tracking: runtime.started,
            openBefore: runtime.openBefore,
            shouldOpen,
            currentOffset: Math.round(currentOffset),
            dragDistance: Math.round(dragDistance),
            openDistance: MOBILE_SIDE_DRAWER_GESTURE_TUNING.openSettleDistance,
            closeDistance: MOBILE_SIDE_DRAWER_GESTURE_TUNING.closeSettleDistance,
            velocityX: Number(velocityX.toFixed(3)),
            drawerWidth: Math.round(width),
        })

        if (runtime.started) suppressNextClick()
        resetDrag()
        setOpen(shouldOpen)
    }, {
        axis: 'x',
        bounds: {left: 0, right: width},
        enabled: gestureEnabled,
        filterTaps: true,
        from: () => [open ? width : 0, 0],
        pointer: {capture: false, keys: false, touch: true},
        rubberband: false,
        threshold: MOBILE_SIDE_DRAWER_GESTURE_TUNING.horizontalStartDistance,
    })

    const handleClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
        if (!suppressClickRef.current) return
        event.preventDefault()
        event.stopPropagation()
    }, [])

    return {
        open,
        drawerDragging,
        edgeBackTransitionDisabled,
        offset,
        surfaceOffset: offset ?? (open ? width : 0),
        edgeBackOffset,
        edgeBackProgress,
        edgeBackPhase,
        completeEdgeBackTransition,
        openDrawer,
        closeDrawer,
        pointerHandlers: {
            ...bindDrag(),
            onClickCapture: handleClickCapture,
        },
    }
}
