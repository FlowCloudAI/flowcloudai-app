// 本模块描述功能区打开既有属性 Dock 的只读导航意图；它不携带任何文档编辑请求。

export type PropertyDockTab = 'content' | 'layout' | 'appearance'
export type PropertyDockSection =
    | 'content'
    | 'text'
    | 'responsive-layout'
    | 'container-layout-preset'
    | 'container-layout-spacing'
    | 'grid-layout'
    | 'appearance'

export interface PropertyDockNavigationRequest {
    readonly requestId: string
    readonly tab: PropertyDockTab
    readonly section: PropertyDockSection
}

const SECTIONS = {
    content: ['content', 'text'],
    layout: [
        'responsive-layout',
        'container-layout-preset',
        'container-layout-spacing',
        'grid-layout',
    ],
    appearance: ['appearance'],
} as const satisfies Readonly<Record<PropertyDockTab, readonly PropertyDockSection[]>>

export function createPropertyDockNavigationRequest(
    tab: PropertyDockTab,
    section: string,
    requestId: string = crypto.randomUUID(),
): PropertyDockNavigationRequest {
    const matched = (SECTIONS[tab] as readonly string[]).find(candidate => candidate === section)
    if (!matched) throw new TypeError('属性 Dock 页签与目标段不匹配。')
    return Object.freeze({requestId, tab, section: matched as PropertyDockSection})
}

export function propertyDockVisualTab(tab: PropertyDockTab): 'text' | 'layout' | 'appearance' {
    return tab === 'content' ? 'text' : tab
}
