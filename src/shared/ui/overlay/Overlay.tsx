/**
 * 通用浮层外壳：统一 portal、动效、焦点恢复、滚动锁与关闭入口。
 * Alert 模态拥有更高关闭优先级，具体判定由同目录纯逻辑模块提供。
 */
import {
    type CSSProperties,
    type ReactNode,
    type RefObject,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react'
import {createPortal} from 'react-dom'
import {useAlertModalState} from 'flowcloudai-ui'
import {resolveAnchoredOverlayPosition, type AnchoredOverlayPosition} from './anchoredOverlayPosition'
import {shouldDismissOverlay} from './overlayDismissalModel'
import {pushOverlay, removeOverlay} from './overlayStack'
import './Overlay.css'

/** 退场动画时长，需与传给 Overlay.css 的浮层过渡时长一致。 */
const FLOATING_TRANSITION_MS = 100
const SHEET_TRANSITION_MS = 250

type OverlayStyle = CSSProperties & {
    '--fc-overlay-transition-duration': string
    '--fc-overlay-anchor-top'?: string
    '--fc-overlay-anchor-left'?: string
    '--fc-overlay-anchor-max-width'?: string
    '--fc-overlay-anchor-max-height'?: string
}

type OverlayVariant = 'floating' | 'anchored' | 'sheet' | 'fullscreen'

interface OverlayProps {
    open: boolean
    onClose?: () => void
    /** 背板点击 / Esc / 返回键是否关闭，默认 true。需强制用户做选择时传 false。 */
    dismissible?: boolean
    /** 非模态建议浮层保留原输入焦点，不遮挡背景交互。 */
    passive?: boolean
    variant?: OverlayVariant
    /** anchored 变体的触发器；面板会跟随它定位并在视口边缘自动翻转。 */
    anchorRef?: RefObject<HTMLElement | null>
    /** 浮层外壳附加类名，用于变体组件调整背板或安全区。 */
    layerClassName?: string
    /** 浮层面板附加类名，用于承载自定义卡片样式。 */
    className?: string
    ariaLabel?: string
    labelledBy?: string
    dataTourId?: string
    children?: ReactNode
}

/**
 * 浮层基座：背板 + 定位 + 进出动画 + 焦点/滚动管理 + 返回栈接入。
 * 不规定卡片外观，卡片由子内容自带（或由变体组件 / className 提供）。
 */
export default function Overlay({
    open,
    onClose,
    dismissible = true,
    passive = false,
    variant = 'floating',
    anchorRef,
    layerClassName,
    className,
    ariaLabel,
    labelledBy,
    dataTourId,
    children,
}: OverlayProps) {
    const isAlertModalOpen = useAlertModalState()
    const transitionDurationMs = variant === 'sheet' ? SHEET_TRANSITION_MS : FLOATING_TRANSITION_MS
    const [mounted, setMounted] = useState(open)
    const [active, setActive] = useState(false)
    const [overlayTop, setOverlayTop] = useState(0)
    const [anchorPosition, setAnchorPosition] = useState<AnchoredOverlayPosition | null>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    // 用 ref 持有最新回调与可关闭标志，使下方副作用只依赖 open，避免 dismissible 抖动重跑。
    // 在 effect 中同步（不在渲染期写 ref，遵循 react-hooks/refs）。
    const onCloseRef = useRef(onClose)
    const dismissibleRef = useRef(dismissible)
    const isAlertModalOpenRef = useRef(isAlertModalOpen)
    useEffect(() => {
        onCloseRef.current = onClose
        dismissibleRef.current = dismissible
    }, [dismissible, onClose])
    useEffect(() => {
        isAlertModalOpenRef.current = isAlertModalOpen
    }, [isAlertModalOpen])

    /*
     * Sheet 开启时先挂载 closed 态，完整绘制一帧后再进入 open 态。只排一个 rAF 时，
     * React 的 mounted 重渲染和 active 更新可能落进同一绘制帧，移动 WebView 就会
     * 直接显示最终位置。关闭同理：过渡结束后再保留一个完整 closed 帧才卸载。
     * Floating 沿用原时序，避免移动端修复改变桌面弹窗手感。
     */
    useEffect(() => {
        let mountedFrame = 0
        let activeFrame = 0
        let closedFrame = 0
        let unmountFrame = 0
        let timer = 0

        if (open) {
            setMounted(true)
            setActive(false)
            mountedFrame = window.requestAnimationFrame(() => {
                if (variant === 'sheet') {
                    activeFrame = window.requestAnimationFrame(() => setActive(true))
                } else {
                    setActive(true)
                }
            })
        } else {
            setActive(false)
            timer = window.setTimeout(() => {
                if (variant === 'sheet') {
                    closedFrame = window.requestAnimationFrame(() => {
                        unmountFrame = window.requestAnimationFrame(() => setMounted(false))
                    })
                } else {
                    setMounted(false)
                }
            }, transitionDurationMs)
        }

        return () => {
            window.clearTimeout(timer)
            window.cancelAnimationFrame(mountedFrame)
            window.cancelAnimationFrame(activeFrame)
            window.cancelAnimationFrame(closedFrame)
            window.cancelAnimationFrame(unmountFrame)
        }
    }, [open, transitionDurationMs, variant])

    useEffect(() => {
        if (variant !== 'floating') {
            setOverlayTop(0)
            return
        }
        if (!open) return

        const updateOverlayTop = () => setOverlayTop(getOverlayTop())
        updateOverlayTop()
        const raf = requestAnimationFrame(updateOverlayTop)
        window.addEventListener('resize', updateOverlayTop)
        return () => {
            cancelAnimationFrame(raf)
            window.removeEventListener('resize', updateOverlayTop)
        }
    }, [open, variant])

    const updateAnchorPosition = useCallback(() => {
        if (variant !== 'anchored' || !open || !anchorRef?.current || !panelRef.current) return
        const anchorRect = anchorRef.current.getBoundingClientRect()
        const panelRect = panelRef.current.getBoundingClientRect()
        const panelStyle = getComputedStyle(panelRef.current)
        const next = resolveAnchoredOverlayPosition({
            anchor: anchorRect,
            panelWidth: panelRect.width,
            panelHeight: panelRect.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            gap: readCssPixel(panelStyle, '--fc-overlay-anchor-gap', 4),
            edge: readCssPixel(panelStyle, '--fc-overlay-anchor-edge', 8),
        })
        setAnchorPosition(current => positionsEqual(current, next) ? current : next)
    }, [anchorRef, open, variant])

    // 每次内容重绘后先在布局阶段校正，避免面板扩展“更多颜色”时闪到旧位置。
    useLayoutEffect(() => {
        if (mounted) updateAnchorPosition()
    }, [mounted, updateAnchorPosition])

    useEffect(() => {
        if (variant !== 'anchored' || !open || !anchorRef?.current || !panelRef.current) return
        const anchor = anchorRef.current
        const panel = panelRef.current
        let frame = requestAnimationFrame(updateAnchorPosition)
        const scheduleUpdate = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(updateAnchorPosition)
        }
        const observer = new ResizeObserver(scheduleUpdate)
        observer.observe(anchor)
        observer.observe(panel)
        window.addEventListener('resize', scheduleUpdate)
        window.addEventListener('scroll', scheduleUpdate, true)
        return () => {
            cancelAnimationFrame(frame)
            observer.disconnect()
            window.removeEventListener('resize', scheduleUpdate)
            window.removeEventListener('scroll', scheduleUpdate, true)
        }
    }, [anchorRef, open, updateAnchorPosition, variant])

    // 开启期间：注册返回栈、捕获阶段 Esc（优先于页面返回）、锁定滚动、聚焦面板。
    useEffect(() => {
        if (!open) return
        const id = pushOverlay(() => {
            if (shouldDismissOverlay(dismissibleRef.current, isAlertModalOpenRef.current)) {
                onCloseRef.current?.()
            }
        })

        const bodyOverflow = document.body.style.overflow
        if (!passive) document.body.style.overflow = 'hidden'

        const prevFocus = passive ? null : document.activeElement as HTMLElement | null
        const focusRaf = passive ? 0 : requestAnimationFrame(() => {
            if (document.activeElement && panelRef.current?.contains(document.activeElement)) return
            panelRef.current?.focus()
        })
        const onOutsidePointerDown = (event: PointerEvent) => {
            if (!passive || !shouldDismissOverlay(dismissibleRef.current, isAlertModalOpenRef.current)) return
            if (event.target instanceof Node && !panelRef.current?.contains(event.target)) onCloseRef.current?.()
        }
        if (passive) document.addEventListener('pointerdown', onOutsidePointerDown, true)

        return () => {
            if (passive) document.removeEventListener('pointerdown', onOutsidePointerDown, true)
            removeOverlay(id)
            if (!passive) document.body.style.overflow = bodyOverflow
            cancelAnimationFrame(focusRaf)
            prevFocus?.focus?.()
        }
    }, [open, passive])

    useEffect(() => {
        if (!open) return
        // AlertProvider 的捕获监听位于 document；这里若先阻断，Esc 会关闭底层面板而留下确认框。
        const onKeyDownCapture = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || !shouldDismissOverlay(dismissibleRef.current, isAlertModalOpen)) return
            e.preventDefault()
            e.stopPropagation()
            onCloseRef.current?.()
        }
        window.addEventListener('keydown', onKeyDownCapture, true)
        return () => window.removeEventListener('keydown', onKeyDownCapture, true)
    }, [isAlertModalOpen, open])

    if (!mounted) return null

    const overlayStyle: OverlayStyle = {
        '--fc-overlay-transition-duration': `${transitionDurationMs}ms`,
        ...(variant === 'floating' ? {top: overlayTop} : {}),
        ...(variant === 'anchored' && anchorPosition ? {
            '--fc-overlay-anchor-top': `${anchorPosition.top}px`,
            '--fc-overlay-anchor-left': `${anchorPosition.left}px`,
            '--fc-overlay-anchor-max-width': `${anchorPosition.maxWidth}px`,
            '--fc-overlay-anchor-max-height': `${anchorPosition.maxHeight}px`,
        } : {}),
    }

    return createPortal(
        <div
            className={`fc-overlay fc-overlay--${variant}${passive ? ' fc-overlay--passive' : ''}${layerClassName ? ` ${layerClassName}` : ''}`}
            data-state={active ? 'open' : 'closed'}
            style={overlayStyle}
            onMouseDown={(e) => {
                // 仅背板（自身）被按下时关闭，面板内部按下不触发。
                if (
                    e.target === e.currentTarget &&
                    shouldDismissOverlay(dismissibleRef.current, isAlertModalOpen)
                ) onCloseRef.current?.()
            }}
        >
            <div
                ref={panelRef}
                className={`fc-overlay__panel fc-overlay__panel--${variant}${className ? ` ${className}` : ''}`}
                role="dialog"
                aria-modal={passive ? undefined : 'true'}
                aria-label={ariaLabel}
                aria-labelledby={labelledBy}
                data-tour-id={dataTourId}
                data-anchor-side={anchorPosition?.side}
                data-positioned={variant !== 'anchored' || anchorPosition ? 'true' : 'false'}
                tabIndex={-1}
                onMouseDown={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>,
        document.body,
    )
}

function readCssPixel(style: CSSStyleDeclaration, property: string, fallback: number): number {
    const value = Number.parseFloat(style.getPropertyValue(property))
    return Number.isFinite(value) ? value : fallback
}

function positionsEqual(
    current: AnchoredOverlayPosition | null,
    next: AnchoredOverlayPosition,
): boolean {
    return current !== null &&
        current.top === next.top &&
        current.left === next.left &&
        current.maxWidth === next.maxWidth &&
        current.maxHeight === next.maxHeight &&
        current.side === next.side
}

function getOverlayTop(): number {
    const titleBar = document.querySelector('.top-bar')
    if (!titleBar) return 0

    return Math.max(0, titleBar.getBoundingClientRect().bottom)
}
