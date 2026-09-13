import {
    type CSSProperties,
    type MouseEvent as ReactMouseEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react'
import './DockableSidePanel.css'
import {useDockSplitDrag} from './useDockSplitDrag'

const PANEL_COLLAPSE_THRESHOLD_RATIO = 1 / 5
const COLLAPSE_PREVIEW_CLASS = 'is-collapse-preview'
const COLLAPSE_RESTORE_CLASS = 'is-collapse-restoring'

interface DockableSidePanelProps {
    width: number
    minWidth: number
    maxWidthRatio?: number
    collapsed?: boolean
    onCollapsedChange?: (collapsed: boolean) => void
    onWidthChange: (width: number) => void
    className?: string
    handleTitle?: string
    mains: Record<string, ReactNode>
    activeKey: string
    secondaryKey?: string | null
    splitRatio: number
    onSplitRatioChange: (ratio: number) => void
    onSplitCollapse: (which: 'primary' | 'secondary') => void
}

export default function DockableSidePanel({
    width,
    minWidth,
    maxWidthRatio = 0.5,
    collapsed = false,
    onCollapsedChange,
    onWidthChange,
    className = '',
    handleTitle = '拖拽调整宽度',
    mains,
    activeKey,
    secondaryKey = null,
    splitRatio,
    onSplitRatioChange,
    onSplitCollapse,
}: DockableSidePanelProps) {
    const rootRef = useRef<HTMLElement | null>(null)
    const mainStackRef = useRef<HTMLDivElement | null>(null)
    // 仅用于控制 CSS class（mousedown/mouseup 各切一次）。
    const [isDraggingClass, setIsDraggingClass] = useState(false)
    const [dragHint, setDragHint] = useState('')

    const isDraggingRef = useRef(false)
    const isCollapsePreviewRef = useRef(false)
    const dragStartXRef = useRef(0)
    const dragStartWidthRef = useRef(0)
    const collapseRestoreTimerRef = useRef<number | null>(null)
    // mousedown 时已是 collapsed 状态，等待鼠标移动到展开后的手柄位置再激活拖拽。
    const pendingExpandRef = useRef(false)
    const pendingExpandHandleXRef = useRef(0)
    const hasSecondary = secondaryKey !== null
        && secondaryKey !== activeKey
        && Object.prototype.hasOwnProperty.call(mains, secondaryKey)
    const {dragHint: splitDragHint, handleSplitResizeStart} = useDockSplitDrag({
        containerRef: mainStackRef,
        splitRatio,
        onSplitRatioChange,
        onSplitCollapse,
    })

    const clearCollapseRestore = useCallback(() => {
        if (collapseRestoreTimerRef.current !== null) {
            window.clearTimeout(collapseRestoreTimerRef.current)
            collapseRestoreTimerRef.current = null
        }
        rootRef.current?.classList.remove(COLLAPSE_RESTORE_CLASS)
    }, [])

    // 非拖拽期间，props 变化时同步 CSS 变量到 DOM。
    useEffect(() => {
        if (isDraggingRef.current) return

        const el = rootRef.current
        if (!el) return
        el.style.setProperty('--dsp-width', collapsed ? '0px' : `${width}px`)
    }, [collapsed, width])

    useEffect(() => () => {
        clearCollapseRestore()
    }, [clearCollapseRestore])

    const handleResizeStart = useCallback((event: ReactMouseEvent) => {
        event.preventDefault()
        isDraggingRef.current = true
        isCollapsePreviewRef.current = false
        setDragHint('调整宽度')
        dragStartXRef.current = event.clientX
        dragStartWidthRef.current = collapsed ? minWidth : width

        const el = rootRef.current
        if (collapsed) {
            // 收起状态下点击手柄：先触发展开，等鼠标追上新手柄位置再激活拖拽。
            pendingExpandRef.current = true
            pendingExpandHandleXRef.current = event.clientX - dragStartWidthRef.current
            onCollapsedChange?.(false)
            el?.style.setProperty('--dsp-width', `${dragStartWidthRef.current}px`)
        } else {
            pendingExpandRef.current = false
            setIsDraggingClass(true)
        }
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }, [collapsed, minWidth, onCollapsedChange, width])

    useEffect(() => {
        const handleMouseMove = (event: MouseEvent) => {
            if (!isDraggingRef.current) return

            const el = rootRef.current
            if (!el) return

            if (pendingExpandRef.current) {
                if (event.clientX > pendingExpandHandleXRef.current) {
                    setDragHint('移到手柄位置后拖拽')
                    return
                }
                pendingExpandRef.current = false
                dragStartXRef.current = pendingExpandHandleXRef.current
                setIsDraggingClass(true)
            }

            const delta = dragStartXRef.current - event.clientX
            const rawWidth = dragStartWidthRef.current + delta
            const collapseThreshold = dragStartWidthRef.current * PANEL_COLLAPSE_THRESHOLD_RATIO
            const nextWidth = Math.min(
                window.innerWidth * maxWidthRatio,
                Math.max(minWidth, rawWidth),
            )
            const shouldCollapse = rawWidth <= collapseThreshold
            const wasCollapsePreview = isCollapsePreviewRef.current
            isCollapsePreviewRef.current = shouldCollapse

            if (wasCollapsePreview && !shouldCollapse) {
                el.classList.add(COLLAPSE_RESTORE_CLASS)
                if (collapseRestoreTimerRef.current !== null) {
                    window.clearTimeout(collapseRestoreTimerRef.current)
                }
                collapseRestoreTimerRef.current = window.setTimeout(() => {
                    el.classList.remove(COLLAPSE_RESTORE_CLASS)
                    collapseRestoreTimerRef.current = null
                }, 160)
            } else if (shouldCollapse) {
                clearCollapseRestore()
            }
            if (shouldCollapse !== wasCollapsePreview) {
                el.classList.toggle(COLLAPSE_PREVIEW_CLASS, shouldCollapse)
            }

            setDragHint(shouldCollapse ? '释放后折叠' : '调整宽度')
            // 调宽期间直接写 DOM，避免用 React 状态驱动每一帧。
            el.style.setProperty('--dsp-width', shouldCollapse ? '0px' : `${nextWidth}px`)
        }

        const handleMouseUp = () => {
            if (!isDraggingRef.current) return
            const el = rootRef.current

            isDraggingRef.current = false
            pendingExpandRef.current = false
            document.body.style.cursor = ''
            document.body.style.userSelect = ''

            const shouldCollapse = isCollapsePreviewRef.current
            isCollapsePreviewRef.current = false
            setIsDraggingClass(false)
            setDragHint('')
            clearCollapseRestore()
            el?.classList.remove(COLLAPSE_PREVIEW_CLASS)

            if (shouldCollapse) {
                onCollapsedChange?.(true)
                return
            }

            const currentWidthValue = el?.style.getPropertyValue('--dsp-width')
            const currentWidth = currentWidthValue ? parseFloat(currentWidthValue) : dragStartWidthRef.current
            const finalWidth = Math.min(
                window.innerWidth * maxWidthRatio,
                Math.max(minWidth, currentWidth),
            )
            onCollapsedChange?.(false)
            onWidthChange(finalWidth)
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
            if (isDraggingRef.current) {
                document.body.style.cursor = ''
                document.body.style.userSelect = ''
            }
            clearCollapseRestore()
        }
    }, [clearCollapseRestore, maxWidthRatio, minWidth, onCollapsedChange, onWidthChange])

    const rootClassName = [
        'dockable-side-panel',
        'dockable-side-panel--floating',
        isDraggingClass ? 'is-dragging' : '',
        collapsed ? 'is-collapsed' : '',
        className,
    ].filter(Boolean).join(' ')

    return (
        <section
            ref={rootRef}
            className={rootClassName}
            style={{
                '--dockable-side-panel-content-min-width': `${minWidth}px`,
            } as CSSProperties}
        >
            <div
                className={`dockable-side-panel__resize-handle${isDraggingClass ? ' is-dragging' : ''}`}
                onMouseDown={handleResizeStart}
                title={handleTitle}
            >
                {dragHint && (
                    <div className="dockable-side-panel__drag-hint">
                        {dragHint}
                    </div>
                )}
                <div className="dockable-side-panel__resize-grip" aria-hidden="true">
                    <span className="dockable-side-panel__resize-dot"/>
                    <span className="dockable-side-panel__resize-dot"/>
                    <span className="dockable-side-panel__resize-dot"/>
                </div>
            </div>
            <div className="dockable-side-panel__body">
                <div
                    ref={mainStackRef}
                    className={`dockable-side-panel__main-stack${hasSecondary ? ' is-split' : ''}`}
                    style={hasSecondary ? {
                        '--dsp-split-primary-size': `${Math.min(1, Math.max(0, splitRatio)) * 100}%`,
                    } as CSSProperties : undefined}
                >
                    {Object.entries(mains).map(([key, node]) => {
                        const isPrimary = key === activeKey
                        const isSecondary = hasSecondary && key === secondaryKey
                        const isActive = isPrimary || isSecondary
                        return (
                            <div
                                key={key}
                                className={[
                                    'dockable-side-panel__main-layer',
                                    isActive ? 'active' : '',
                                    hasSecondary && isPrimary ? 'is-primary' : '',
                                    isSecondary ? 'is-secondary' : '',
                                ].filter(Boolean).join(' ')}
                                aria-hidden={!isActive}
                            >
                                {node}
                            </div>
                        )
                    })}
                    {hasSecondary && (
                        <div
                            className="dockable-side-panel__split-handle"
                            onMouseDown={handleSplitResizeStart}
                            role="separator"
                            aria-orientation="horizontal"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(splitRatio * 100)}
                            title="拖拽调整上下分栏比例"
                        >
                            {splitDragHint && (
                                <div className="dockable-side-panel__split-drag-hint">
                                    {splitDragHint}
                                </div>
                            )}
                            <div className="dockable-side-panel__resize-grip" aria-hidden="true">
                                <span className="dockable-side-panel__resize-dot"/>
                                <span className="dockable-side-panel__resize-dot"/>
                                <span className="dockable-side-panel__resize-dot"/>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </section>
    )
}
