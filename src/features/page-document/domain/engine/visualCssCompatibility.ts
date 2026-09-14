// 本模块标记固定视口与旧版两档布局不能无损表达的 CSS；警告不改源码，覆盖必须由宿主列明影响后取得人工确认。
import postcss, {type Rule} from 'postcss'
import {ENTRY_DESKTOP_MEDIA_QUERY, type DocumentDiagnostic} from '../contract.ts'
import {cssNodeRange} from './cssParser.ts'
import {cssMediaMatches, cssPropertyName, managedCssRuleContext} from './managedCssContext.ts'
import {parseManagedNodeSelector} from './managedNodeSelector.ts'

const LAYOUT_PROPERTIES = new Set([
    'display',
    'grid',
    'grid-template',
    'grid-template-columns',
    'grid-template-rows',
    'grid-template-areas',
    'grid-auto-flow',
    'flex-flow',
    'flex-direction',
    'flex-wrap',
    'gap',
    'row-gap',
    'column-gap',
    'align-items',
])

const VISUAL_LAYOUT_MEDIA_QUERIES = [ENTRY_DESKTOP_MEDIA_QUERY] as const

function isVisualLayoutMediaQuery(params: string): boolean {
    return VISUAL_LAYOUT_MEDIA_QUERIES.some(query => cssMediaMatches(params, query))
}

export function visualCssCompatibilityDiagnostics(
    rule: Rule,
    layer: string | undefined,
): DocumentDiagnostic[] {
    if (
        layer !== 'fc-node' ||
        !rule.nodes.some(
            node => node.type === 'decl' && LAYOUT_PROPERTIES.has(cssPropertyName(node.prop)),
        )
    )
        return []
    const selectors = postcss.list.comma(rule.selector)
    const nodes = selectors
        .map(parseManagedNodeSelector)
        .filter(node => node && (node.nodeKind === null || node.nodeKind === 'container'))
    if (nodes.length === 0) return []
    const context = managedCssRuleContext(rule)
    if (
        selectors.length === 1 &&
        context &&
        (!context.media || isVisualLayoutMediaQuery(context.media.params))
    )
        return []
    return [
        {
            severity: 'warning',
            category: 'capability',
            code: 'visual_layout_source_only',
            message:
                '该布局规则使用选择器列表、交互状态、嵌套条件或自定义断点，不能直接还原为移动基础与桌面覆盖两档。静态受控值可直接为目标节点分离；只有无法复现的条件或语义会在修改前提示损失。',
            file: 'style.css',
            range: cssNodeRange(rule),
        },
    ]
}
