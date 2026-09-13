/**
 * Dock 上下分栏拖拽只在指针移动期间写 CSS 变量，并在松手时提交一次状态。
 * 它不负责内容配对或生命周期，边缘收起的结果由调用方更新布局状态。
 */

import {
    type MouseEvent as ReactMouseEvent,
    type RefObject,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react'

const SPLIT_RATIO_VAR = '--dsp-split-primary-size'
const PRIMARY_COLLAPSE_PREVIEW_CLASS = 'is-primary-collapse-preview'
const SECONDARY_COLLAPSE_PREVIEW_CLASS = 'is-secondary-collapse-preview'
const DEFAULT_MIN_PANE_HEIGHT = 160
const DEFAULT_COLLAPSE_DISTANCE = 48

type SplitPane = 'primary' | 'secondary'

interface UseDockSplitDragOptions {
    containerRef: RefObject<HTMLDivElement | null>
    splitRatio: number
    onSplitRatioChange: (ratio: number) => void
    onSplitCollapse: (which: SplitPane) => void
    minPaneHeight?: number
    collapseDistance?: number
}

function clampRatio(ratio: number) {
    return Math.min(1, Math.max(0, ratio))
}

export function useDockSplitDrag({
    containerRef,
    splitRatio,
    onSplitRatioChange,
    onSplitCollapse,
    minPaneHeight = DEFAULT_MIN_PANE_HEIGHT,
    collapseDistance = DEFAULT_COLLAPSE_DISTANCE,
}: UseDockSplitDragOptions) {
    const isDraggingRef = useRef(false)
    const collapsePreviewRef = useRef<SplitPane | null>(null)
    const currentRatioRef = useRef(clampRatio(splitRatio))
    const [dragHint, setDragHint] = useState('')

    const writeRatio = useCallback((ratio: number) => {
        containerRef.current?.style.setProperty(SPLIT_RATIO_VAR, `${clampRatio(ratio) * 100}%`)
    }, [containerRef])

    const clearDragClasses = useCallback(() => {
        const container = containerRef.current
        container?.classList.remove('is-split-dragging')
        container?.classList.remove(PRIMARY_COLLAPSE_PREVIEW_CLASS)
        container?.classList.remove(SECONDARY_COLLAPSE_PREVIEW_CLASS)
    }, [containerRef])

    useEffect(() => {
        if (isDraggingRef.current) return
        currentRatioRef.current = clampRatio(splitRatio)
        writeRatio(splitRatio)
    }, [splitRatio, writeRatio])

    const handleSplitResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        isDraggingRef.current = true
        collapsePreviewRef.current = null
        currentRatioRef.current = clampRatio(splitRatio)
        clearDragClasses()
        containerRef.current?.classList.add('is-split-dragging')
        setDragHint('调整上下比例')
        document.body.style.cursor = 'row-resize'
        document.body.style.userSelect = 'none'
    }, [clearDragClasses, containerRef, splitRatio])

    useEffect(() => {
        const handleMouseMove = (event: MouseEvent) => {
            if (!isDraggingRef.current) return
            const container = containerRef.current
            if (!container) return

            const rect = container.getBoundingClientRect()
            if (rect.height <= 0) return

            const distanceFromTop = event.clientY - rect.top
            const distanceFromBottom = rect.bottom - event.clientY
            const collapsePreview: SplitPane | null = distanceFromTop < collapseDistance
                ? 'primary'
                : distanceFromBottom < collapseDistance
                    ? 'secondary'
                    : null
            const minimumRatio = Math.min(0.5, minPaneHeight / rect.height)
            const rawRatio = distanceFromTop / rect.height
            const nextRatio = Math.min(1 - minimumRatio, Math.max(minimumRatio, rawRatio))

            currentRatioRef.current = nextRatio
            writeRatio(nextRatio)
            if (collapsePreviewRef.current !== collapsePreview) {
                collapsePreviewRef.current = collapsePreview
                container.classList.toggle(PRIMARY_COLLAPSE_PREVIEW_CLASS, collapsePreview === 'primary')
                container.classList.toggle(SECONDARY_COLLAPSE_PREVIEW_CLASS, collapsePreview === 'secondary')
                setDragHint(
                    collapsePreview === 'primary'
                        ? '释放后收起上格'
                        : collapsePreview === 'secondary'
                            ? '释放后收起下格'
                            : '调整上下比例',
                )
            }
        }

        const handleMouseUp = () => {
            if (!isDraggingRef.current) return
            isDraggingRef.current = false
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
            clearDragClasses()
            setDragHint('')

            const collapsePreview = collapsePreviewRef.current
            collapsePreviewRef.current = null
            if (collapsePreview) {
                onSplitCollapse(collapsePreview)
                return
            }
            onSplitRatioChange(currentRatioRef.current)
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
            isDraggingRef.current = false
            collapsePreviewRef.current = null
            clearDragClasses()
        }
    }, [
        clearDragClasses,
        collapseDistance,
        containerRef,
        minPaneHeight,
        onSplitCollapse,
        onSplitRatioChange,
        writeRatio,
    ])

    return {dragHint, handleSplitResizeStart}
}
