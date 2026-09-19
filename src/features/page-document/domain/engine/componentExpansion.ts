// 本模块只在预览编译的派生树上展开公共组件；作者源码保持实例引用，定义静态文本不进入页面索引。
import {defaultTreeAdapter, html, parseFragment, type DefaultTreeAdapterTypes} from 'parse5'
import type {DocumentDiagnostic} from '../contract.ts'
import {
    childNodes,
    getAttribute,
    isElement,
    setAttribute,
    type HtmlElement,
    type HtmlNode,
} from './htmlParser.ts'
import type {PublicComponentDefinitionContract} from '../kernel/contracts/publicComponent.ts'
import {parseCssSource} from './cssParser.ts'
import {guardDocumentSources} from './guard.ts'
import {parseHtmlSource} from './htmlParser.ts'

const STATIC_MARKER = 'data-fc-component-static'
const INSTANCE_CONTENT_MARKER = 'data-fc-component-instance-content'

function cloneNode(node: DefaultTreeAdapterTypes.ChildNode): DefaultTreeAdapterTypes.ChildNode {
    if (isElement(node)) {
        const copy = defaultTreeAdapter.createElement(
            node.tagName,
            node.namespaceURI,
            node.attrs.map(item => ({...item})),
        )
        for (const child of childNodes(node)) defaultTreeAdapter.appendChild(copy, cloneNode(child))
        return copy
    }
    if ('value' in node && typeof node.value === 'string') {
        return defaultTreeAdapter.createTextNode(node.value)
    }
    return defaultTreeAdapter.createCommentNode('组件内部节点')
}

function replaceTextAndAttributes(
    node: HtmlNode,
    properties: Readonly<Record<string, string>>,
): void {
    if (!isElement(node)) return
    for (const attr of node.attrs) {
        for (const [name, value] of Object.entries(properties)) {
            attr.value = attr.value.split('{{' + name + '}}').join(value)
        }
    }
    const replacedChildren: DefaultTreeAdapterTypes.ChildNode[] = []
    for (const child of childNodes(node)) {
        if ('value' in child && typeof child.value === 'string') {
            replacedChildren.push(...replacePropertyText(child.value, properties))
        } else {
            replaceTextAndAttributes(child, properties)
            replacedChildren.push(child)
        }
    }
    replaceChildren(node, replacedChildren)
}

function replacePropertyText(
    text: string,
    properties: Readonly<Record<string, string>>,
): readonly DefaultTreeAdapterTypes.ChildNode[] {
    const tokens = /\{\{([a-z][a-z0-9-]{0,63})\}\}/gu
    const result: DefaultTreeAdapterTypes.ChildNode[] = []
    let cursor = 0
    for (const match of text.matchAll(tokens)) {
        const name = match[1]
        const value = properties[name]
        if (value === undefined || match.index === undefined) continue
        if (match.index > cursor) {
            result.push(defaultTreeAdapter.createTextNode(text.slice(cursor, match.index)))
        }
        const dynamic = defaultTreeAdapter.createElement('span', html.NS.HTML, [
            {name: INSTANCE_CONTENT_MARKER, value: ''},
        ])
        defaultTreeAdapter.appendChild(dynamic, defaultTreeAdapter.createTextNode(value))
        result.push(dynamic)
        cursor = match.index + match[0].length
    }
    if (result.length === 0) return [defaultTreeAdapter.createTextNode(text)]
    if (cursor < text.length) result.push(defaultTreeAdapter.createTextNode(text.slice(cursor)))
    return result
}

function findPart(root: HtmlElement, name: string): HtmlElement | null {
    let found: HtmlElement | null = null
    const visit = (node: HtmlNode): void => {
        if (found || !isElement(node)) return
        if (getAttribute(node, 'data-fc-part') === name) {
            found = node
            return
        }
        for (const child of childNodes(node)) visit(child)
    }
    visit(root)
    return found
}

function markStatic(node: HtmlNode): void {
    if (!isElement(node)) return
    setAttribute(node, STATIC_MARKER, '')
    for (const child of childNodes(node)) markStatic(child)
}

function clearStatic(node: HtmlNode): void {
    if (!isElement(node)) return
    node.attrs = node.attrs.filter(attr => attr.name !== STATIC_MARKER)
    for (const child of childNodes(node)) clearStatic(child)
}

function replaceChildren(target: HtmlElement, children: readonly DefaultTreeAdapterTypes.ChildNode[]): void {
    target.childNodes = []
    for (const child of children) defaultTreeAdapter.appendChild(target, child)
}

function componentCss(definition: PublicComponentDefinitionContract): string {
    return definition.css.replace(
        /\[data-fc-component\s*=\s*(?:(['"])[^'"]+\1|[^\]\s]+)\]/giu,
        '[data-fc-component="' + definition.componentId.toLowerCase() + '"]',
    )
}

function missingDiagnostic(
    instance: HtmlElement,
    componentId: string,
    revision: string,
): DocumentDiagnostic {
    return {
        severity: 'warning',
        category: 'capability',
        code: 'missing_component_definition',
        message:
            '公共组件 ' +
            componentId +
            ' 的修订 ' +
            revision +
            ' 不存在，已保留组件实例并显示缺失状态。',
        file: 'article.html',
        nodeId: getAttribute(instance, 'data-fc-node-id'),
    }
}

function invalidDiagnostic(
    instance: HtmlElement,
    definition: PublicComponentDefinitionContract,
): DocumentDiagnostic {
    return {
        severity: 'warning',
        category: 'security',
        code: 'invalid_component_definition',
        message: `公共组件 ${definition.name} 的修订 ${definition.revision} 未通过安全校验，已保留实例并显示无效状态。`,
        file: 'article.html',
        nodeId: getAttribute(instance, 'data-fc-node-id'),
    }
}

interface ValidatedDefinition {
    readonly valid: boolean
    readonly assetIds: readonly string[]
}

function validateDefinition(
    definition: PublicComponentDefinitionContract,
    knownAssetIds: ReadonlySet<string>,
): ValidatedDefinition {
    const html = parseHtmlSource(definition.html, {mode: 'fragment', scope: 'component'})
    const css = parseCssSource(definition.css, 'component')
    const guard = guardDocumentSources([html], [css], {knownAssetIds})
    const identityNodes: HtmlElement[] = []
    walkDefinitionElements(parseFragment(definition.html, {scriptingEnabled: false}), identityNodes)
    const containsPageIdentity = identityNodes.some(node =>
        getAttribute(node, 'data-fc-node-id') !== undefined ||
        getAttribute(node, 'data-fc-node-kind') !== undefined,
    )
    return Object.freeze({
        valid:
            !containsPageIdentity &&
            html.diagnostics.length === 0 &&
            css.diagnostics.length === 0 &&
            guard.diagnostics.length === 0,
        assetIds: Object.freeze([
            ...new Set([
                ...guard.referencedAssetIds,
                ...definition.assetDependencies.map(id => id.toLowerCase()),
            ]),
        ]),
    })
}

export interface ComponentExpansionResult {
    readonly diagnostics: readonly DocumentDiagnostic[]
    readonly styles: readonly string[]
    readonly referencedAssetIds: readonly string[]
}

export function expandPublicComponentInstances(
    root: HtmlNode,
    definitions: readonly PublicComponentDefinitionContract[],
    knownAssetIds: ReadonlySet<string> = new Set(),
): ComponentExpansionResult {
    const byId = new Map<string, PublicComponentDefinitionContract>()
    const byRevision = new Map<string, PublicComponentDefinitionContract>()
    for (const definition of definitions) {
        const id = definition.componentId.toLowerCase()
        byRevision.set(`${id}:${definition.revision}`, definition)
        const current = byId.get(id)
        if (!current || definition.revision > current.revision) byId.set(id, definition)
    }
    const styles = new Map<string, string>()
    const assetIds = new Set<string>()
    const diagnostics: DocumentDiagnostic[] = []
    const validationCache = new Map<string, ValidatedDefinition>()
    const visit = (node: HtmlNode): void => {
        if (isElement(node) && getAttribute(node, 'data-fc-node-kind') === 'component') {
            const componentId = getAttribute(node, 'data-fc-component')?.toLowerCase()
            const requestedRevision = getAttribute(node, 'data-fc-component-revision') ?? 'latest'
            const definition = componentId
                ? requestedRevision === 'latest'
                    ? byId.get(componentId)
                    : byRevision.get(`${componentId}:${Number(requestedRevision)}`)
                : undefined
            if (!definition) {
                setAttribute(node, 'data-fc-component-state', 'missing')
                if (componentId) diagnostics.push(missingDiagnostic(node, componentId, requestedRevision))
                return
            }
            const definitionKey = `${definition.componentId.toLowerCase()}:${definition.revision}`
            const validation = validationCache.get(definitionKey) ??
                validateDefinition(definition, knownAssetIds)
            validationCache.set(definitionKey, validation)
            if (!validation.valid) {
                setAttribute(node, 'data-fc-component-state', 'invalid')
                diagnostics.push(invalidDiagnostic(node, definition))
                return
            }
            setAttribute(node, 'data-fc-component-state', 'resolved')
            for (const assetId of validation.assetIds) {
                assetIds.add(assetId)
            }
            const fragment = parseFragment(definition.html, {scriptingEnabled: false})
            const roots = fragment.childNodes.map(cloneNode).map(rootNode => {
                if (isElement(rootNode)) {
                    markStatic(rootNode)
                    return rootNode
                }
                const wrapper = defaultTreeAdapter.createElement('span', html.NS.HTML, [
                    {name: STATIC_MARKER, value: ''},
                ])
                defaultTreeAdapter.appendChild(wrapper, rootNode)
                return wrapper
            })
            const properties: Record<string, string> = {}
            for (const attr of node.attrs) {
                if (attr.name.startsWith('data-fc-prop-')) {
                    properties[attr.name.slice('data-fc-prop-'.length)] = attr.value
                }
            }
            for (const rootNode of roots) replaceTextAndAttributes(rootNode, properties)
            for (const part of definition.partSchema) {
                const supplied = childNodes(node).find(
                    child => isElement(child) && getAttribute(child, 'data-fc-part') === part.name,
                )
                const firstRoot = roots.find(isElement)
                const target = firstRoot ? findPart(firstRoot, part.name) : null
                if (!target) continue
                clearStatic(target)
                setAttribute(target, INSTANCE_CONTENT_MARKER, '')
                replaceChildren(
                    target,
                    supplied && isElement(supplied)
                        ? childNodes(supplied).map(cloneNode)
                        : [],
                )
            }
            replaceChildren(node, roots)
            if (definition.css.trim()) {
                styles.set(`${definition.componentId}:${definition.revision}`, componentCss(definition))
            }
        }
        for (const child of childNodes(node)) visit(child)
    }
    visit(root)
    return Object.freeze({
        diagnostics: Object.freeze(diagnostics),
        styles: Object.freeze([...styles.values()]),
        referencedAssetIds: Object.freeze([...assetIds].sort()),
    })
}

function walkDefinitionElements(fragment: HtmlNode, result: HtmlElement[]): void {
    if (isElement(fragment)) result.push(fragment)
    for (const child of childNodes(fragment)) walkDefinitionElements(child, result)
}

export const COMPONENT_STATIC_MARKER = STATIC_MARKER
