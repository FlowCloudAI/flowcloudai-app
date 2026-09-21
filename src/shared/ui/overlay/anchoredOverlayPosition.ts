/**
 * 锚定浮层定位只处理视口几何：优先放在触发器下方，空间不足时翻到上方，并始终留在视口内。
 */

export interface OverlayAnchorRect {
    readonly top: number
    readonly right: number
    readonly bottom: number
    readonly left: number
}

export interface AnchoredOverlayPosition {
    readonly top: number
    readonly left: number
    readonly maxWidth: number
    readonly maxHeight: number
    readonly side: 'top' | 'bottom'
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

export function resolveAnchoredOverlayPosition({
    anchor,
    panelWidth,
    panelHeight,
    viewportWidth,
    viewportHeight,
    gap,
    edge,
}: {
    readonly anchor: OverlayAnchorRect
    readonly panelWidth: number
    readonly panelHeight: number
    readonly viewportWidth: number
    readonly viewportHeight: number
    readonly gap: number
    readonly edge: number
}): AnchoredOverlayPosition {
    const maxWidth = Math.max(0, viewportWidth - edge * 2)
    const effectivePanelWidth = Math.min(panelWidth, maxWidth)
    const roomBelow = Math.max(0, viewportHeight - edge - anchor.bottom - gap)
    const roomAbove = Math.max(0, anchor.top - edge - gap)
    const side = roomBelow >= panelHeight || roomBelow >= roomAbove ? 'bottom' : 'top'
    const maxHeight = side === 'bottom' ? roomBelow : roomAbove
    const visiblePanelHeight = Math.min(panelHeight, maxHeight)

    return {
        top: side === 'bottom'
            ? anchor.bottom + gap
            : Math.max(edge, anchor.top - gap - visiblePanelHeight),
        left: clamp(anchor.left, edge, viewportWidth - edge - effectivePanelWidth),
        maxWidth,
        maxHeight,
        side,
    }
}
