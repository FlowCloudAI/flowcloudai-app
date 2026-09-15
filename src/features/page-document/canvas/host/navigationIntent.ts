// 本模块只把仍符合作者链接白名单的画布导航意图交给业务宿主，非法地址保持无动作。

import {validateAuthorHref} from '../../domain/engine/hrefPolicy.ts'

export function canForwardCanvasNavigationIntent(href: string): boolean {
    return validateAuthorHref(href).allowed
}
