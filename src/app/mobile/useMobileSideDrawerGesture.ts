import {useDrag} from '@use-gesture/react'
import {
    type HTMLAttributes,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type RefObject,
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
    /** 拖动帧只改三个直接绘制节点，禁止把高频 CSS 变量写在会向整页继承的祖先上。 */
    drawerVisualRef: RefObject<HTMLElement | null>
    surfaceVisualRef: RefObject<HTMLElement | null>
    scrimVisualRef: RefObject<HTMLElement | null>
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
    /**
     * 指针在返回边缘按下时先通知外层锁定当前页身份并预绘制前驱页；原生预测返回则在
     * 系统 start 回调进入同一入口。这样前驱页只为返回服务，不参与普通抽屉拖动。
     */
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
    /**
     * surface 的 transform 正在变化。比 drawerSettling 早一步结束（transitionend 当帧），
     * 让「恢复毛玻璃」和「拆运动几何」落在两个不同的静止帧上。
     */
    drawerMoving: boolean
    /** 吸附动画进行中：surface 已停止跟手，但运动几何还不能拆。 */
    drawerSettling: boolean
    completeDrawerSettle: () => void
    edgeBackTransitionDisabled: boolean
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

function getMobileShellTransitionDurationMs(): number {
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
    drawerVisualRef,
    surfaceVisualRef,
    scrimVisualRef,
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
    const [drawerDragging, setDrawerDragging] = useState(false)
    const [drawerMoving, setDrawerMoving] = useState(false)
    const [drawerSettling, setDrawerSettling] = useState(false)
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
    const edgeBackPreparedRef = useRef(false)
    const edgeBackGestureActiveRef = useRef(false)
    const drawerVisualFrameRef = useRef<number | null>(null)
    // 逻辑 open 立刻提交，运动几何（左边框 + 圆角裁剪）却要活到 surface 真正停稳之后，
    // 因此吸附阶段需要一组独立于 open/dragging 的计时器与代次号。
    const drawerSettleAttemptRef = useRef(0)
    const drawerSettleTimerRef = useRef<number | null>(null)
    const drawerSettleFrameRef = useRef<number | null>(null)
    const drawerSettlePendingRef = useRef(false)
    // setOpen 只在 settleDrawer 里发生，用 ref 同步一份即时值，判断这一次结算是否真的有位移。
    const openRef = useRef(false)
    const pendingDrawerVisualRef = useRef<{
        drawerOffset: number
        surfaceOffset: number
        progress: number
    } | null>(null)

    const flushDrawerVisual = useCallback(() => {
        drawerVisualFrameRef.current = null
        const pending = pendingDrawerVisualRef.current
        if (!pending) return
        const drawer = drawerVisualRef.current
        const surface = surfaceVisualRef.current
        const scrim = scrimVisualRef.current
        if (drawer) drawer.style.transform = `translate3d(${pending.drawerOffset}px, 0, 0)`
        if (surface) surface.style.transform = `translate3d(${pending.surfaceOffset}px, 0, 0)`
        if (scrim) scrim.style.opacity = String(pending.progress)
    }, [drawerVisualRef, scrimVisualRef, surfaceVisualRef])

    const scheduleDrawerVisual = useCallback((nextOffset: number) => {
        const clampedOffset = clamp(nextOffset, 0, width)
        pendingDrawerVisualRef.current = {
            drawerOffset: clampedOffset - width,
            surfaceOffset: clampedOffset,
            progress: width > 0 ? clampedOffset / width : 0,
        }
        if (drawerVisualFrameRef.current !== null || typeof window === 'undefined') return
        drawerVisualFrameRef.current = window.requestAnimationFrame(flushDrawerVisual)
    }, [flushDrawerVisual, width])

    const clearDrawerVisualFrame = useCallback(() => {
        if (drawerVisualFrameRef.current !== null) {
            window.cancelAnimationFrame(drawerVisualFrameRef.current)
            drawerVisualFrameRef.current = null
        }
        pendingDrawerVisualRef.current = null
    }, [])

    const clearDrawerSettleTimers = useCallback(() => {
        if (drawerSettleTimerRef.current !== null) {
            window.clearTimeout(drawerSettleTimerRef.current)
            drawerSettleTimerRef.current = null
        }
        if (drawerSettleFrameRef.current !== null) {
            window.cancelAnimationFrame(drawerSettleFrameRef.current)
            drawerSettleFrameRef.current = null
        }
    }, [])

    /*
     * 拆掉运动几何前先空转两帧。transitionend 派发的那一帧合成器还在收尾 transform 动画，
     * 圆角裁剪节点若在同帧塌成直角，整个 surface 的渲染通道会连同内部 backdrop-filter
     * 一起重建——那正是关闭到位瞬间整页闪一帧主题底色的成因。等到至少一帧静止画面画完再拆。
     */
    const finishDrawerSettle = useCallback((attemptId: number) => {
        clearDrawerSettleTimers()
        drawerSettlePendingRef.current = false
        // 先放开玻璃：此刻 surface 已静止、圆角还在，重建离屏通道有一整帧可用。
        setDrawerMoving(false)
        drawerSettleFrameRef.current = window.requestAnimationFrame(() => {
            drawerSettleFrameRef.current = window.requestAnimationFrame(() => {
                drawerSettleFrameRef.current = null
                if (attemptId !== drawerSettleAttemptRef.current) return
                setDrawerSettling(false)
            })
        })
    }, [clearDrawerSettleTimers])

    const beginDrawerSettle = useCallback(() => {
        clearDrawerSettleTimers()
        const attemptId = drawerSettleAttemptRef.current + 1
        drawerSettleAttemptRef.current = attemptId
        drawerSettlePendingRef.current = true
        setDrawerMoving(true)
        setDrawerSettling(true)
        // transitionend 是主路径；transform 终点与起点相同、WebView 丢事件、
        // 或减少动态效果把 --mobile-duration-base 压成 0ms 时都收不到，必须有定时兜底。
        // 余量比边缘返回大：终点 transform 要等一次 rAF 才写下去，动画起点本就晚一帧，
        // 兜底早于 transitionend 触发反而会把几何拆在动画尾帧上，正是本次要修的那一帧。
        drawerSettleTimerRef.current = window.setTimeout(() => {
            drawerSettleTimerRef.current = null
            if (attemptId !== drawerSettleAttemptRef.current) return
            finishDrawerSettle(attemptId)
        }, getMobileShellTransitionDurationMs() + 120)
    }, [clearDrawerSettleTimers, finishDrawerSettle])

    const completeDrawerSettle = useCallback(() => {
        if (!drawerSettlePendingRef.current) return
        finishDrawerSettle(drawerSettleAttemptRef.current)
    }, [finishDrawerSettle])

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
            edgeBackPreparedRef.current = false
            edgeBackGestureActiveRef.current = false
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
        const fallbackDuration = getMobileShellTransitionDurationMs() + 80
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

    const resetPointerTracking = useCallback(() => {
        dragRuntimeRef.current = null
        setDrawerDragging(false)
    }, [])

    const settleDrawer = useCallback((nextOpen: boolean) => {
        // 关闭页面时的空结算（本来就是关的、也没拖过）不该进吸附阶段，否则每次挂载都白排一次定时器。
        const hadMotion = openRef.current || nextOpen || dragRuntimeRef.current?.started === true
        openRef.current = nextOpen
        resetPointerTracking()
        if (hadMotion) beginDrawerSettle()
        setOpen(nextOpen)
        // 等 React 移除拖动态后再写终点，让现有 CSS transition 接管吸附动画。
        scheduleDrawerVisual(nextOpen ? width : 0)
    }, [beginDrawerSettle, resetPointerTracking, scheduleDrawerVisual, width])

    const closeDrawer = useCallback(() => {
        settleDrawer(false)
    }, [settleDrawer])

    const openDrawer = useCallback(() => {
        if (!enabled) return
        settleDrawer(true)
    }, [enabled, settleDrawer])

    const preparePointerEdgeBack = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (
            edgeBackPreparedRef.current
            || open
            || !edgeBackEnabled
            || event.clientX > MOBILE_EDGE_BACK_GESTURE_TUNING.startWidth
        ) return
        if (!allowTextEditingTargetGestures && isTextEditingTarget(event.target)) return
        if (isInternalGestureTarget(event.target)) return
        edgeBackPreparedRef.current = true
        onEdgeBackStart?.()
    }, [allowTextEditingTargetGestures, edgeBackEnabled, onEdgeBackStart, open])

    const cancelPreparedEdgeBack = useCallback(() => {
        if (!edgeBackPreparedRef.current || edgeBackGestureActiveRef.current) return
        edgeBackPreparedRef.current = false
        onEdgeBackFinish?.()
    }, [onEdgeBackFinish])

    const finishPointerPreparation = useCallback(() => {
        cancelPreparedEdgeBack()
    }, [cancelPreparedEdgeBack])

    useEffect(() => {
        if (!enabled) closeDrawer()
    }, [closeDrawer, enabled])

    useEffect(() => {
        if (dragRuntimeRef.current?.started) return
        scheduleDrawerVisual(open ? width : 0)
    }, [open, scheduleDrawerVisual, width])

    useEffect(() => {
        return () => {
            edgeBackAttemptRef.current += 1
            clearSuppressClickTimer()
            clearEdgeBackSettle()
            clearDrawerVisualFrame()
            drawerSettleAttemptRef.current += 1
            clearDrawerSettleTimers()
        }
    }, [clearDrawerSettleTimers, clearDrawerVisualFrame, clearEdgeBackSettle, clearSuppressClickTimer])

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
                if (suppressedRuntime.edgeBackCandidate && suppressedRuntime.started) {
                    cancelEdgeBack()
                } else {
                    cancelPreparedEdgeBack()
                    settleDrawer(suppressedRuntime.openBefore)
                }
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
                cancelPreparedEdgeBack()
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
                cancelPreparedEdgeBack()
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
                if (runtime.started) {
                    cancelEdgeBack()
                } else {
                    cancelPreparedEdgeBack()
                    resetPointerTracking()
                }
                cancel()
                return
            }

                if (!runtime.started) {
                    runtime.started = true
                    edgeBackGestureActiveRef.current = true
                    if (!edgeBackPreparedRef.current) {
                        edgeBackPreparedRef.current = true
                        onEdgeBackStart?.()
                    }
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

                const completionDuration = getMobileShellTransitionDurationMs()
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
            settleDrawer(false)
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
        scheduleDrawerVisual(currentOffset)

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
        settleDrawer(shouldOpen)
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
        drawerMoving,
        drawerSettling,
        completeDrawerSettle,
        edgeBackTransitionDisabled,
        edgeBackOffset,
        edgeBackProgress,
        edgeBackPhase,
        completeEdgeBackTransition,
        openDrawer,
        closeDrawer,
        pointerHandlers: {
            ...bindDrag(),
            onClickCapture: handleClickCapture,
            onPointerDownCapture: preparePointerEdgeBack,
            onPointerUpCapture: finishPointerPreparation,
            onPointerCancelCapture: finishPointerPreparation,
        },
    }
}
