/**
 * 移动端词条图片浏览器：全屏预览支持捏合缩放、拖动与横滑翻页，画廊支持管理态多选。
 * 图片数据与删除确认仍由调用方/store 持有；组件只管理浏览手势和局部选择状态。
 */
import {
    type PointerEvent as ReactPointerEvent,
    useEffect,
    useRef,
    useState,
} from 'react'
import {Button, useAlert} from 'flowcloudai-ui'
import {type EntryImage, toEntryImageSrc} from '../../../features/entries/lib/entryImage'
import {Overlay} from '../../../shared/ui/overlay'
import {getImageLabel} from '../pages/MobileEntryDetailUtils'
import {
    MobileAddIcon,
    MobileBackIcon,
    MobilePageTopBar,
    MobileTopActionPill,
} from './MobileTopControls'
import './MobileImageViewer.css'

const MIN_SCALE = 1
const MAX_SCALE = 4
const SWIPE_THRESHOLD_PX = 52

interface Point {
    x: number
    y: number
}

interface MobileImageViewerProps {
    open: boolean
    images: EntryImage[]
    currentIndex: number
    title: string
    mode?: 'browse' | 'manage'
    onClose: () => void
    onIndexChange: (index: number) => void
    onSetCover?: (index: number) => void
    onRemove?: (index: number) => void
    onRemoveMany?: (indices: number[]) => void
    onAddImage?: () => void
    onInsertMarkdown?: (index: number) => void
}

function clampScale(value: number) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

function distance(left: Point, right: Point) {
    return Math.hypot(right.x - left.x, right.y - left.y)
}

function center(left: Point, right: Point): Point {
    return {x: (left.x + right.x) / 2, y: (left.y + right.y) / 2}
}

export default function MobileImageViewer({
    open,
    images,
    currentIndex,
    title,
    mode = 'browse',
    onClose,
    onIndexChange,
    onSetCover,
    onRemove,
    onRemoveMany,
    onAddImage,
    onInsertMarkdown,
}: MobileImageViewerProps) {
    const {showAlert} = useAlert()
    const [viewMode, setViewMode] = useState<'preview' | 'gallery'>('preview')
    const [selectionMode, setSelectionMode] = useState(false)
    const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => new Set())
    const [scale, setScale] = useState(MIN_SCALE)
    const [offset, setOffset] = useState<Point>({x: 0, y: 0})
    const pointersRef = useRef(new Map<number, Point>())
    const gestureRef = useRef({
        startPoint: {x: 0, y: 0},
        startOffset: {x: 0, y: 0},
        startDistance: 0,
        startScale: MIN_SCALE,
        startCenter: {x: 0, y: 0},
    })

    const safeIndex = Math.min(Math.max(currentIndex, 0), Math.max(0, images.length - 1))
    const currentImage = images[safeIndex]
    const currentSrc = currentImage ? toEntryImageSrc(currentImage) : null
    const canManage = mode === 'manage'

    useEffect(() => {
        if (!open) return
        if (images.length === 0) {
            queueMicrotask(onClose)
            return
        }
        if (safeIndex !== currentIndex) queueMicrotask(() => onIndexChange(safeIndex))
    }, [currentIndex, images.length, onClose, onIndexChange, open, safeIndex])

    useEffect(() => {
        if (!open) return
        queueMicrotask(() => {
            setViewMode('preview')
            setSelectionMode(false)
            setSelectedIndices(new Set())
        })
    }, [open])

    useEffect(() => {
        if (!open) return
        queueMicrotask(() => {
            setScale(MIN_SCALE)
            setOffset({x: 0, y: 0})
            pointersRef.current.clear()
        })
    }, [open, safeIndex, viewMode])

    const selectImage = (index: number) => {
        onIndexChange((index + images.length) % images.length)
        setViewMode('preview')
    }

    const toggleSelected = (index: number) => {
        setSelectedIndices(current => {
            const next = new Set(current)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
        })
    }

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        const point = {x: event.clientX, y: event.clientY}
        pointersRef.current.set(event.pointerId, point)
        event.currentTarget.setPointerCapture(event.pointerId)
        const points = [...pointersRef.current.values()]
        if (points.length === 1) {
            gestureRef.current.startPoint = point
            gestureRef.current.startOffset = offset
            return
        }
        if (points.length === 2) {
            gestureRef.current.startDistance = distance(points[0], points[1])
            gestureRef.current.startScale = scale
            gestureRef.current.startCenter = center(points[0], points[1])
            gestureRef.current.startOffset = offset
        }
    }

    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!pointersRef.current.has(event.pointerId)) return
        pointersRef.current.set(event.pointerId, {x: event.clientX, y: event.clientY})
        const points = [...pointersRef.current.values()]
        if (points.length === 2) {
            const startDistance = gestureRef.current.startDistance
            if (startDistance <= 0) return
            const nextCenter = center(points[0], points[1])
            setScale(clampScale(gestureRef.current.startScale * (distance(points[0], points[1]) / startDistance)))
            setOffset({
                x: gestureRef.current.startOffset.x + nextCenter.x - gestureRef.current.startCenter.x,
                y: gestureRef.current.startOffset.y + nextCenter.y - gestureRef.current.startCenter.y,
            })
            return
        }
        if (points.length === 1 && scale > MIN_SCALE) {
            setOffset({
                x: gestureRef.current.startOffset.x + event.clientX - gestureRef.current.startPoint.x,
                y: gestureRef.current.startOffset.y + event.clientY - gestureRef.current.startPoint.y,
            })
        }
    }

    const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
        const wasSinglePointer = pointersRef.current.size === 1
        const startPoint = gestureRef.current.startPoint
        const deltaX = event.clientX - startPoint.x
        const deltaY = event.clientY - startPoint.y
        pointersRef.current.delete(event.pointerId)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)

        if (wasSinglePointer && scale === MIN_SCALE && Math.abs(deltaX) >= SWIPE_THRESHOLD_PX && Math.abs(deltaX) > Math.abs(deltaY) && images.length > 1) {
            onIndexChange((safeIndex + images.length + (deltaX < 0 ? 1 : -1)) % images.length)
            return
        }
        if (pointersRef.current.size === 0 && scale <= MIN_SCALE) {
            setScale(MIN_SCALE)
            setOffset({x: 0, y: 0})
        }
    }

    const handleRemove = async () => {
        if (!onRemove) return
        const confirmed = await showAlert('确认移除这张图片？', 'warning', 'confirm')
        if (confirmed !== 'yes') return
        onRemove(safeIndex)
    }

    const handleRemoveSelected = async () => {
        if (!onRemoveMany || selectedIndices.size === 0) return
        const indices = [...selectedIndices].sort((left, right) => left - right)
        const confirmed = await showAlert(`确认移除选中的 ${indices.length} 张图片？`, 'warning', 'confirm')
        if (confirmed !== 'yes') return
        onRemoveMany(indices)
        setSelectedIndices(new Set())
        setSelectionMode(false)
    }

    return (
        <Overlay open={open} onClose={onClose} variant="fullscreen" className="mobile-image-viewer" ariaLabel={`${title} 图片浏览器`}>
            <MobilePageTopBar
                className="mobile-image-viewer__topbar"
                ariaLabel="图片浏览操作"
                left={<MobileTopActionPill actions={[{
                    key: 'back',
                    label: '关闭图片浏览器',
                    icon: <MobileBackIcon/>,
                    onClick: onClose,
                }]}/>}
                center={<div className="mobile-image-viewer__heading">
                    <strong>{title}</strong>
                    <small>{viewMode === 'preview' ? `${safeIndex + 1} / ${images.length}` : `${images.length} 张图片`}</small>
                </div>}
                right={<MobileTopActionPill actions={[{
                    key: 'mode',
                    label: viewMode === 'preview' ? '切换到画廊' : '切换到单图预览',
                    icon: <span className="mobile-top-action-pill__text">{viewMode === 'preview' ? '画廊' : '预览'}</span>,
                    kind: 'text',
                    onClick: () => {
                        setViewMode(current => current === 'preview' ? 'gallery' : 'preview')
                        setSelectionMode(false)
                        setSelectedIndices(new Set())
                    },
                }]}/>}
            />

            {viewMode === 'preview' ? (
                <>
                    <div
                        className="mobile-image-viewer__stage"
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerEnd}
                        onPointerCancel={handlePointerEnd}
                    >
                        {currentSrc ? (
                            <img
                                src={currentSrc}
                                alt={getImageLabel(currentImage, safeIndex)}
                                draggable={false}
                                style={{transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`}}
                            />
                        ) : <span className="mobile-image-viewer__unavailable">图片不可预览</span>}
                    </div>

                    <div className="mobile-image-viewer__thumbs" data-mobile-horizontal-scroll="true">
                        {images.map((image, index) => {
                            const src = toEntryImageSrc(image)
                            return (
                                <button type="button" key={`${image.path ?? image.url ?? index}-${index}`} aria-pressed={index === safeIndex} onClick={() => onIndexChange(index)}>
                                    {src ? <img src={src} alt={getImageLabel(image, index)}/> : <span>无预览</span>}
                                </button>
                            )
                        })}
                    </div>

                    {canManage && (
                        <div className="mobile-image-viewer__actions">
                            {onSetCover && !currentImage?.is_cover && <Button type="button" variant="primary" size="sm" onClick={() => onSetCover(safeIndex)}>设为主图</Button>}
                            {currentImage?.is_cover && <span className="mobile-image-viewer__cover-label">当前主图</span>}
                            {onInsertMarkdown && <Button type="button" variant="outline" size="sm" onClick={() => onInsertMarkdown(safeIndex)}>插入正文</Button>}
                            {onRemove && <Button type="button" variant="ghost" size="sm" className="mobile-image-viewer__danger" onClick={() => void handleRemove()}>移除</Button>}
                        </div>
                    )}
                </>
            ) : (
                <>
                    {canManage && (
                        <div className="mobile-image-viewer__gallery-tools">
                            <button type="button" onClick={() => { setSelectionMode(active => !active); setSelectedIndices(new Set()) }}>{selectionMode ? '完成' : '选择多张'}</button>
                            {selectionMode && <span>已选 {selectedIndices.size} 张</span>}
                        </div>
                    )}
                    <div className="mobile-image-viewer__gallery">
                        {images.map((image, index) => {
                            const src = toEntryImageSrc(image)
                            const selected = selectedIndices.has(index)
                            return (
                                <button
                                    type="button"
                                    key={`${image.path ?? image.url ?? index}-${index}`}
                                    className={selected ? 'is-selected' : undefined}
                                    aria-pressed={selectionMode ? selected : undefined}
                                    onClick={() => selectionMode ? toggleSelected(index) : selectImage(index)}
                                >
                                    {src ? <img src={src} alt={getImageLabel(image, index)}/> : <span>无预览</span>}
                                    {image.is_cover && <span className="mobile-image-viewer__badge">主图</span>}
                                    {selectionMode && <span className="mobile-image-viewer__selection-mark">{selected ? '已选' : '选择'}</span>}
                                </button>
                            )
                        })}
                        {canManage && onAddImage && !selectionMode && (
                            <button type="button" className="mobile-image-viewer__add" onClick={onAddImage}>
                                <MobileAddIcon/>
                                <span>添加图片</span>
                            </button>
                        )}
                    </div>
                    {selectionMode && selectedIndices.size > 0 && (
                        <div className="mobile-image-viewer__selection-actions">
                            <Button type="button" variant="ghost" className="mobile-image-viewer__danger" onClick={() => void handleRemoveSelected()}>移除所选</Button>
                        </div>
                    )}
                </>
            )}
        </Overlay>
    )
}
