// 桌面词条页只为当前项目的受管内链打开悬停浮窗；点击导航仍走独立的意图处理。

import {validateAuthorHref} from '../../page-document/domain/kernel/policy/hrefPolicy.ts'
import {RFC_9562_UUID_SOURCE} from '../../page-document/domain/uuidPolicy.ts'
import {parseInternalEntryHref, type InternalEntryLink} from './entryLinkHref.ts'

const SELF_LINK = new RegExp(`^fc://self/entry/${RFC_9562_UUID_SOURCE}$`, 'iu')
const LEGACY_LINK = new RegExp(`^entry://${RFC_9562_UUID_SOURCE}$`, 'iu')

export function parseCanvasHoverEntryTarget(href: string | null): InternalEntryLink | null {
    if (!href || !validateAuthorHref(href).allowed) return null
    if (!(SELF_LINK.test(href) || LEGACY_LINK.test(href) || href.startsWith('entry-title://'))) return null
    return parseInternalEntryHref(href)
}
