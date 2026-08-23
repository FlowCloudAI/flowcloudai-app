/**
 * 移动端页面栈的双层取样规则。
 * 这里只决定保留哪些稳定 key/页面；React 挂载和 CSS 转场由 MobilePageTransitionHost 负责。
 */

import type {MobilePage, MobilePageStackEntry} from './usePageStack'

export interface MobilePageTransitionLayer {
    key: string
    page: MobilePage | null
}

/** 始终保留当前页和它的直接前驱；根页作为栈的虚拟第一项。 */
export function getMobilePageTransitionLayers(
    entries: readonly MobilePageStackEntry[],
    rootKey: string,
): MobilePageTransitionLayer[] {
    const allLayers: MobilePageTransitionLayer[] = [
        {key: rootKey, page: null},
        ...entries.map(entry => ({key: entry.key, page: entry.page})),
    ]
    return allLayers.slice(-2)
}
