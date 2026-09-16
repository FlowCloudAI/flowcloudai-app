// 宿主只换算可信画布的视口几何；浮窗仍按主窗口的 fixed 坐标定位。

import type {CanvasLinkHoverRect} from '../protocol/index.ts'

export function canvasRectToHostViewport(
    frame: Pick<DOMRectReadOnly, 'top' | 'left'>,
    rect: CanvasLinkHoverRect,
): CanvasLinkHoverRect {
    return {
        top: frame.top + rect.top,
        left: frame.left + rect.left,
        width: rect.width,
        height: rect.height,
    }
}
