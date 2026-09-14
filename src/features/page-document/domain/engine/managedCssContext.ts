// 本模块定义可视 CSS 读写共用的上下文边界；条件嵌套和后代规则不能被当成无条件的节点样式。
import type {AtRule, Rule} from 'postcss'

export interface ManagedCssRuleContext {
    layer: AtRule
    media: AtRule | null
}

export function managedCssRuleContext(rule: Rule): ManagedCssRuleContext | null {
    let parent = rule.parent
    let media: AtRule | null = null
    if (parent?.type === 'atrule' && parent.name.toLowerCase() === 'media') {
        media = parent
        parent = parent.parent
    }
    if (
        parent?.type !== 'atrule' ||
        parent.name.toLowerCase() !== 'layer' ||
        parent.parent?.type !== 'root'
    )
        return null
    return {layer: parent, media}
}

export function cssMediaMatches(candidate: string | null, target: string | null): boolean {
    if (candidate === null || target === null) return candidate === target
    return candidate.replace(/\s+/gu, '') === target.replace(/\s+/gu, '')
}

export function cssPropertyName(property: string): string {
    // 标准属性不区分大小写；自定义属性的大小写属于作者命名，不能折叠。
    return property.startsWith('--') ? property : property.toLowerCase()
}
