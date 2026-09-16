// 画布链接悬停的纯策略：只把合法作者 href 与有界几何送入只读 bridge，并合并同锚点事件。

import {validateAuthorHref} from '../../domain/kernel/policy/hrefPolicy.ts'
import {CANVAS_HREF_MAX_CODE_UNITS, isCanvasLinkHoverRect, type CanvasLinkHoverRect} from '../protocol/index.ts'

export type CanvasLinkHoverPayload = {
    type: 'link-hover'
    href: string | null
    nodeId: string | null
    rect: CanvasLinkHoverRect | null
}

const LEAVE: CanvasLinkHoverPayload = {type: 'link-hover', href: null, nodeId: null, rect: null}

export function createCanvasLinkHoverTracker() {
    let activeAnchor: object | null = null
    return {
        enter(anchor: object, href: string, nodeId: string | null, rect: CanvasLinkHoverRect, isComposing: boolean): CanvasLinkHoverPayload | null {
            if (isComposing || href.length > CANVAS_HREF_MAX_CODE_UNITS
                || !validateAuthorHref(href).allowed || !isCanvasLinkHoverRect(rect)) {
                return this.clear()
            }
            if (activeAnchor === anchor) return null
            activeAnchor = anchor
            return {type: 'link-hover', href, nodeId, rect}
        },
        leave(anchor: object): CanvasLinkHoverPayload | null {
            if (activeAnchor !== anchor) return null
            activeAnchor = null
            return LEAVE
        },
        clear(): CanvasLinkHoverPayload | null {
            if (!activeAnchor) return null
            activeAnchor = null
            return LEAVE
        },
    }
}
