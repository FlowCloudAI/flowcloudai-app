// 本模块把一个受管页面节点子树复制为公共组件定义源码；原页面源码只读，身份与节点样式在副本中重写。

import postcss, {type ChildNode, type Rule} from 'postcss'
import {parseFragment, serialize, type DefaultTreeAdapterTypes} from 'parse5'
import type {PublicComponentDefinitionFormValue} from './publicComponentDefinitionForm.ts'
import {elementRange, findElementsByAttribute, parseHtmlSource} from '../domain/kernel/syntax/index.ts'

type HtmlElement = DefaultTreeAdapterTypes.Element
type HtmlNode = DefaultTreeAdapterTypes.Node

const NODE_SELECTOR = /\[data-fc-node-id\s*=\s*(?:(["'])([0-9a-f-]+)\1|([0-9a-f-]+))\]/giu

export interface CapturedPublicComponentDefinition {
    readonly componentId: string
    readonly form: PublicComponentDefinitionFormValue
    readonly originalArticleHtml: string
}

function isElement(node: HtmlNode): node is HtmlElement {
    return 'tagName' in node
}

function children(node: HtmlNode): DefaultTreeAdapterTypes.ChildNode[] {
    return 'childNodes' in node ? node.childNodes : []
}

function attribute(element: HtmlElement, name: string): string | undefined {
    return element.attrs.find(item => item.name === name)?.value
}

function visitElements(node: HtmlNode, visit: (element: HtmlElement) => void): void {
    if (isElement(node)) visit(node)
    for (const child of children(node)) visitElements(child, visit)
}

function selectedSource(articleHtml: string, nodeId: string): string {
    const parsed = parseHtmlSource(articleHtml, {mode: 'fragment', scope: 'entry'})
    const matches = findElementsByAttribute(parsed, 'data-fc-node-id')
        .filter(element => attribute(element, 'data-fc-node-id')?.toLowerCase() === nodeId.toLowerCase())
    const range = matches.length === 1 ? elementRange(matches[0]) : undefined
    if (!range) throw new TypeError('选中节点在页面源码中不唯一或无法定位。')
    return articleHtml.slice(range.from, range.to)
}

function rewriteSelectedHtml(source: string, componentId: string): {
    readonly html: string
    readonly hookByNodeId: ReadonlyMap<string, string>
} {
    const fragment = parseFragment(source)
    const hookByNodeId = new Map<string, string>()
    let index = 0
    visitElements(fragment, element => {
        if (attribute(element, 'data-fc-component')) {
            throw new TypeError('公共组件实例不能嵌套保存为另一公共组件；请先转为本地组件。')
        }
        const rawId = attribute(element, 'data-fc-node-id')
        if (rawId) {
            const hook = `fc-saved-${componentId.replaceAll('-', '').slice(0, 8)}-${index += 1}`
            hookByNodeId.set(rawId.toLowerCase(), hook)
            const currentClass = attribute(element, 'class')?.trim()
            element.attrs = element.attrs.filter(
                item => item.name !== 'data-fc-node-id' && item.name !== 'data-fc-node-kind',
            )
            const classAttribute = element.attrs.find(item => item.name === 'class')
            if (classAttribute) classAttribute.value = currentClass ? `${currentClass} ${hook}` : hook
            else element.attrs.push({name: 'class', value: hook})
        }
    })
    return {html: serialize(fragment), hookByNodeId}
}

function rewrittenSelector(
    selector: string,
    componentId: string,
    hookByNodeId: ReadonlyMap<string, string>,
): string | null {
    const ids = [...selector.matchAll(NODE_SELECTOR)].map(match => (match[2] ?? match[3]).toLowerCase())
    if (ids.length === 0 || ids.some(id => !hookByNodeId.has(id))) return null
    const rewritten = selector.replace(NODE_SELECTOR, (_match, _quote, quoted, bare) => {
        const id = String(quoted ?? bare ?? '').toLowerCase()
        return `.${hookByNodeId.get(id) ?? ''}`
    })
    NODE_SELECTOR.lastIndex = 0
    return `[data-fc-component="${componentId}"] ${rewritten.trim()}`
}

function wrapRuleInConditions(source: Rule, rewritten: Rule): ChildNode {
    let wrapped: ChildNode = rewritten
    let parent = source.parent
    while (parent && parent.type !== 'root') {
        if (parent.type === 'atrule' && parent.name.toLowerCase() !== 'layer') {
            const condition = postcss.atRule({name: parent.name, params: parent.params})
            condition.append(wrapped)
            wrapped = condition
        }
        parent = parent.parent
    }
    return wrapped
}

function rewriteSelectedCss(
    styleCss: string,
    componentId: string,
    hookByNodeId: ReadonlyMap<string, string>,
): string {
    if (!styleCss.trim() || hookByNodeId.size === 0) return ''
    const root = postcss.parse(styleCss)
    const rules: ChildNode[] = []
    root.walkRules(rule => {
        const selectors = postcss.list.comma(rule.selector).flatMap(selector => {
            const rewritten = rewrittenSelector(selector, componentId, hookByNodeId)
            return rewritten ? [rewritten] : []
        })
        if (selectors.length === 0) return
        const clone = rule.clone({selector: selectors.join(', ')})
        rules.push(wrapRuleInConditions(rule, clone))
    })
    if (rules.length === 0) return ''
    const layer = postcss.atRule({name: 'layer', params: 'fc-component'})
    layer.append(rules)
    return layer.toString()
}

export function captureSelectedNodeAsPublicComponent(
    articleHtml: string,
    styleCss: string,
    nodeId: string,
    componentId: string,
): CapturedPublicComponentDefinition {
    const source = selectedSource(articleHtml, nodeId)
    const rewritten = rewriteSelectedHtml(source, componentId)
    return Object.freeze({
        componentId,
        originalArticleHtml: articleHtml,
        form: Object.freeze({
            name: '',
            category: '基础',
            html: rewritten.html,
            css: rewriteSelectedCss(styleCss, componentId, rewritten.hookByNodeId),
            propertyLines: '',
            partLines: '',
            styleVariableLines: '',
        }),
    })
}
