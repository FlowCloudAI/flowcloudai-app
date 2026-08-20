import {
    type CSSProperties,
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react'
import {useDrag} from '@use-gesture/react'
import Overlay from '../../../shared/ui/overlay/Overlay'
import './MobileBottomSheet.css'

interface BottomSheetDragRuntime {
    startScrollTop: number
    started: boolean
}

type MobileBottomSheetStyle = CSSProperties & {'--mobile-bottom-sheet-drag-offset'?: string}

function shouldSkipBottomSheetDrag(target: EventTarget | null, sheet: HTMLElement): boolean {
    if (!(target instanceof HTMLElement)) return false
    if (target.closest('input, textarea, select, [contenteditable="true"], [data-mobile-bottom-sheet-drag-lock="true"]')) {
        return true
    }

    let element: HTMLElement | null = target
    while (element && element !== sheet) {
        const style = window.getComputedStyle(element)
        const scrollableY = style.overflowY === 'auto' || style.overflowY === 'scroll'
        if (scrollableY && element.scrollHeight > element.clientHeight) return true
        element = element.parentElement
    }
    return false
}

export interface MobileBottomSheetProps {
    open: boolean
    onClose: () => void
    ariaLabel?: string
    dismissible?: boolean
    className?: string
    children?: ReactNode
}

export default function MobileBottomSheet({
    open,
    onClose,
    ariaLabel = '底部操作面板',
    dismissible = true,
    className,
    children,
}: MobileBottomSheetProps) {
    const [dragging, setDragging] = useState(false)
    const [dragOffset, setDragOffset] = useState(0)
    const sheetRef = useRef<HTMLElement | null>(null)
    const dragRef = useRef<BottomSheetDragRuntime | null>(null)

    const resetDrag = useCallback(() => {
        dragRef.current = null
        setDragging(false)
        setDragOffset(0)
    }, [])

    useEffect(() => {
        if (open) resetDrag()
    }, [open, resetDrag])

    const bindSheetDrag = useDrag(({
        cancel,
        event,
        first,
        last,
        movement: [moveX, moveY],
        velocity: [, velocityY],
    }) => {
        if (!open || !dismissible) return
        const sheet = sheetRef.current
        if (!sheet) return

        if (first) {
            if (shouldSkipBottomSheetDrag(event.target, sheet)) {
                dragRef.current = null
                cancel()
                return
            }
            dragRef.current = {
                startScrollTop: sheet.scrollTop,
                started: false,
            }
        }

        const dragState = dragRef.current
        if (!dragState) return
        const horizontal = Math.abs(moveX)
        const vertical = Math.abs(moveY)

        if (!dragState.started) {
            if (horizontal < 6 && vertical < 6) return
            if (moveY <= 0 || horizontal > vertical * 1.1) {
                resetDrag()
                cancel()
                return
            }
            if (dragState.startScrollTop > 0 || sheet.scrollTop > 0) {
                if (last) dragRef.current = null
                return
            }
            dragState.started = true
            setDragging(true)
        }

        if (event.cancelable) event.preventDefault()
        const nextOffset = Math.max(0, Math.min(moveY, window.innerHeight * 0.45))
        setDragOffset(nextOffset)

        if (!last) return
        dragRef.current = null
        setDragging(false)
        if (dragState.started && (nextOffset > 68 || velocityY > 0.45)) {
            onClose()
            return
        }
        setDragOffset(0)
    }, {
        axis: 'y',
        enabled: open && dismissible,
        filterTaps: true,
        pointer: {capture: false, keys: false, touch: true},
        threshold: 6,
    })

    const sheetStyle: CSSProperties | undefined = dragOffset > 0
        ? ({'--mobile-bottom-sheet-drag-offset': `${dragOffset}px`} as MobileBottomSheetStyle)
        : undefined

    return (
        <Overlay
            open={open}
            onClose={onClose}
            dismissible={dismissible}
            variant="sheet"
            layerClassName="mobile-bottom-sheet-layer"
            className="mobile-bottom-sheet-host"
            ariaLabel={ariaLabel}
        >
            <section
                ref={sheetRef}
                className={`mobile-bottom-sheet${dragging ? ' is-dragging' : ''}${className ? ` ${className}` : ''}`}
                style={sheetStyle}
                {...bindSheetDrag()}
            >
                <div className="mobile-bottom-sheet__handle" aria-hidden="true"/>
                {children}
            </section>
        </Overlay>
    )
}
