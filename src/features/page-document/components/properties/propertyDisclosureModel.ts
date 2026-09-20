// 本模块只把当前属性状态投影成折叠段摘要；折叠状态属于界面，不进入页面草稿。

import type {VisualPropertyName, VisualPropertyState} from '../../application/visualPropertyEditing.ts'

export interface PropertyDisclosurePresentation {
    readonly authorValueCount: number
    readonly defaultOpen: boolean
    readonly summary: string
}

export function propertyDisclosurePresentation(
    fields: readonly VisualPropertyState[],
    properties: readonly VisualPropertyName[],
): PropertyDisclosurePresentation {
    const selected = fields.filter(field => properties.includes(field.property))
    const authorValueCount = selected.filter(field =>
        field.localValue !== null || field.sourceState === 'mixed' || field.sourceState === 'custom-source',
    ).length
    return Object.freeze({
        authorValueCount,
        defaultOpen: authorValueCount > 0,
        summary: authorValueCount > 0 ? `已设置 ${authorValueCount} 项` : '使用继承或默认设置',
    })
}
