/**
 * Dock 布局规则把内容作用域和允许配对规整为稳定的单栏或上下分栏状态。
 * 本模块不持有界面状态，组件与测试可注入不同的描述表和页面激活判定。
 */

import type {SidePanelContentDescriptor} from './sidePanelContents'

export interface SidePanelLayout<Key extends string = string> {
    primary: Key
    secondary: Key | null
}

function isAvailable<Key extends string>(
    descriptor: SidePanelContentDescriptor<Key> | undefined,
    isPageScopeActive: (key: Key) => boolean,
) {
    if (!descriptor) return false
    return descriptor.scope === 'global' || isPageScopeActive(descriptor.key)
}

export function normalizeSidePanelLayout<Key extends string>(
    layout: SidePanelLayout<Key>,
    contents: readonly SidePanelContentDescriptor<Key>[],
    splitPairs: readonly (readonly [Key, Key])[],
    isPageScopeActive: (key: Key) => boolean,
): SidePanelLayout<Key> {
    const descriptors = new Map(contents.map((content) => [content.key, content]))
    const pairAllowed = layout.secondary !== null
        && layout.secondary !== layout.primary
        && splitPairs.some(([primary, secondary]) => (
            primary === layout.primary && secondary === layout.secondary
        ))

    const secondary = pairAllowed
        && isAvailable(descriptors.get(layout.secondary as Key), isPageScopeActive)
        ? layout.secondary
        : null

    if (isAvailable(descriptors.get(layout.primary), isPageScopeActive)) {
        return {primary: layout.primary, secondary}
    }

    if (secondary !== null) {
        return {primary: secondary, secondary: null}
    }

    return {primary: 'ai-chat' as Key, secondary: null}
}

export function getSidePanelMinWidth<Key extends string>(
    layout: SidePanelLayout<Key>,
    contents: readonly SidePanelContentDescriptor<Key>[],
) {
    const descriptors = new Map(contents.map((content) => [content.key, content]))
    const primaryMinWidth = descriptors.get(layout.primary)?.minWidth ?? 0
    const secondaryMinWidth = layout.secondary === null
        ? 0
        : descriptors.get(layout.secondary)?.minWidth ?? 0
    return Math.max(primaryMinWidth, secondaryMinWidth)
}
