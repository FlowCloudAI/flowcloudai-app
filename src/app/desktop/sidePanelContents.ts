/**
 * 桌面 Dock 内容注册表集中声明稳定 key、宽度下限和生命周期作用域。
 * 布局规整与渲染只消费这些描述，不在业务组件里复制内容能力判断。
 */

export type SidePanelContentScope = 'global' | 'page'

export interface SidePanelContentDescriptor<Key extends string = string> {
    key: Key
    minWidth: number
    scope: SidePanelContentScope
}

export const SIDE_PANEL_CONTENTS = [
    {key: 'idea', minWidth: 500, scope: 'global'},
    {key: 'ai-chat', minWidth: 500, scope: 'global'},
    {key: 'snapshot', minWidth: 500, scope: 'global'},
    {key: 'help', minWidth: 500, scope: 'global'},
] as const satisfies readonly SidePanelContentDescriptor[]

export type SidePanelContentKey = typeof SIDE_PANEL_CONTENTS[number]['key']

export const SIDE_PANEL_SPLIT_PAIRS: readonly (
    readonly [SidePanelContentKey, SidePanelContentKey]
)[] = []
