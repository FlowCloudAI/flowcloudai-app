import {type CSSProperties, type ReactNode, useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {pushOverlay, removeOverlay} from './overlayStack'
import './Overlay.css'

/** 退场动画时长，需与传给 Overlay.css 的浮层过渡时长一致。 */
const FLOATING_TRANSITION_MS = 100
const SHEET_TRANSITION_MS = 280

type OverlayStyle = CSSProperties & {'--fc-overlay-transition-duration': string}

type OverlayVariant = 'floating' | 'sheet' | 'fullscreen'

interface OverlayProps {
    open: boolean
    onClose?: () => void
    /** 背板点击 / Esc / 返回键是否关闭，默认 true。需强制用户做选择时传 false。 */
    dismissible?: boolean
    variant?: OverlayVariant
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
    variant = 'floating',
    layerClassName,
    className,
    ariaLabel,
    labelledBy,
    dataTourId,
    children,
}: OverlayProps) {
    const transitionDurationMs = variant === 'sheet' ? SHEET_TRANSITION_MS : FLOATING_TRANSITION_MS
    const [mounted, setMounted] = useState(open)
    const [active, setActive] = useState(false)
    const [overlayTop, setOverlayTop] = useState(0)
    const panelRef = useRef<HTMLDivElement>(null)
    // 用 ref 持有最新回调与可关闭标志，使下方副作用只依赖 open，避免 dismissible 抖动重跑。
    // 在 effect 中同步（不在渲染期写 ref，遵循 react-hooks/refs）。
    const onCloseRef = useRef(onClose)
    const dismissibleRef = useRef(dismissible)
    useEffect(() => {
        onCloseRef.current = onClose
        dismissibleRef.current = dismissible
    })

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

    // 开启期间：注册返回栈、捕获阶段 Esc（优先于页面返回）、锁定滚动、聚焦面板。
    useEffect(() => {
        if (!open) return
        const id = pushOverlay(() => {
            if (dismissibleRef.current) onCloseRef.current?.()
        })

        // 捕获阶段拦截 Esc：先于 window 冒泡监听（如移动端返回处理）执行并阻断，避免连带回退页面。
        const onKeyDownCapture = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && dismissibleRef.current) {
                e.preventDefault()
                e.stopPropagation()
                onCloseRef.current?.()
            }
        }
        window.addEventListener('keydown', onKeyDownCapture, true)

        const bodyOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        const prevFocus = document.activeElement as HTMLElement | null
        const focusRaf = requestAnimationFrame(() => {
            if (document.activeElement && panelRef.current?.contains(document.activeElement)) return
            panelRef.current?.focus()
        })

        return () => {
            removeOverlay(id)
            window.removeEventListener('keydown', onKeyDownCapture, true)
            document.body.style.overflow = bodyOverflow
            cancelAnimationFrame(focusRaf)
            prevFocus?.focus?.()
        }
    }, [open])

    if (!mounted) return null

    const overlayStyle: OverlayStyle = {
        '--fc-overlay-transition-duration': `${transitionDurationMs}ms`,
        ...(variant === 'floating' ? {top: overlayTop} : {}),
    }

    return createPortal(
        <div
            className={`fc-overlay fc-overlay--${variant}${layerClassName ? ` ${layerClassName}` : ''}`}
            data-state={active ? 'open' : 'closed'}
            style={overlayStyle}
            onMouseDown={(e) => {
                // 仅背板（自身）被按下时关闭，面板内部按下不触发。
                if (e.target === e.currentTarget && dismissibleRef.current) onCloseRef.current?.()
            }}
        >
            <div
                ref={panelRef}
                className={`fc-overlay__panel fc-overlay__panel--${variant}${className ? ` ${className}` : ''}`}
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
                aria-labelledby={labelledBy}
                data-tour-id={dataTourId}
                tabIndex={-1}
                onMouseDown={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>,
        document.body,
    )
}

function getOverlayTop(): number {
    const titleBar = document.querySelector('.top-bar')
    if (!titleBar) return 0

    return Math.max(0, titleBar.getBoundingClientRect().bottom)
}
