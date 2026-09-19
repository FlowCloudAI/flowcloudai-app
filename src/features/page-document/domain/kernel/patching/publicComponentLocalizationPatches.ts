// 本模块把一个公共组件实例物化为页面本地结构；身份规划、HTML 替换与组件 CSS 降级在同一内核补丁中完成。

import postcss from 'postcss'
import {defaultTreeAdapter, html, parseFragment, serializeOuter, type DefaultTreeAdapterTypes} from 'parse5'
import {canComponentContain, inferComponentKindFromTag} from '../components/index.ts'
import type {HtmlCompositionElement} from '../composition/index.ts'
import {
    planComponentLocalization,
    type NodeIdentityReference,
    type NodeIdentityRemapPlan,
} from '../contracts/nodeIdentityPolicy.ts'
import type {NodeId} from '../contracts/identity.ts'
import type {DocumentNodeKind} from '../contracts/primitives.ts'
import {utf16Range, type SourceDocument} from '../contracts/source.ts'
import type {PublicComponentDefinitionContract} from '../contracts/publicComponent.ts'
import {elementRange} from '../syntax/index.ts'
import type {SourcePatch} from './sourcePatches.ts'

type HtmlElement = DefaultTreeAdapterTypes.Element
type HtmlNode = DefaultTreeAdapterTypes.Node
type HtmlChild = DefaultTreeAdapterTypes.ChildNode

interface MaterializedTree {
    readonly root: HtmlElement
    readonly managed: readonly {element: HtmlElement; kind: DocumentNodeKind}[]
}

export interface PublicComponentLocalizationPatchResult {
    readonly status: 'ready'
    readonly patches: readonly SourcePatch[]
    readonly identity: NodeIdentityRemapPlan & {
        readonly expandedNodeIds: readonly NodeId[]
        readonly retiredInstanceId: NodeId
    }
}

function isElement(node: HtmlNode): node is HtmlElement {
    return 'tagName' in node
}

function children(node: HtmlNode): HtmlChild[] {
    return 'childNodes' in node ? node.childNodes : []
}

function attribute(element: HtmlElement, name: string): string | undefined {
    return element.attrs.find(item => item.name === name)?.value
}

function setAttribute(element: HtmlElement, name: string, value: string): void {
    const current = element.attrs.find(item => item.name === name)
    if (current) current.value = value
    else element.attrs.push({name, value})
}

function replaceChildren(element: HtmlElement, next: readonly HtmlChild[]): void {
    element.childNodes = []
    for (const child of next) defaultTreeAdapter.appendChild(element, child)
}

function cloneNode(node: HtmlChild): HtmlChild {
    if (isElement(node)) {
        const clone = defaultTreeAdapter.createElement(
            node.tagName,
            node.namespaceURI,
            node.attrs.map(item => ({...item})),
        )
        for (const child of children(node)) defaultTreeAdapter.appendChild(clone, cloneNode(child))
        return clone
    }
    if ('value' in node && typeof node.value === 'string') {
        return defaultTreeAdapter.createTextNode(node.value)
    }
    return defaultTreeAdapter.createCommentNode('公共组件注释')
}

function replaceProperties(node: HtmlNode, properties: Readonly<Record<string, string>>): void {
    if ('value' in node && typeof node.value === 'string') {
        for (const [name, value] of Object.entries(properties)) {
            node.value = node.value.split(`{{${name}}}`).join(value)
        }
        return
    }
    if (!isElement(node)) return
    for (const attr of node.attrs) {
        for (const [name, value] of Object.entries(properties)) {
            attr.value = attr.value.split(`{{${name}}}`).join(value)
        }
    }
    for (const child of children(node)) replaceProperties(child, properties)
}

function findPart(root: HtmlNode, name: string): HtmlElement | null {
    if (isElement(root) && attribute(root, 'data-fc-part') === name) return root
    for (const child of children(root)) {
        const found = findPart(child, name)
        if (found) return found
    }
    return null
}

function stripPartMarkers(node: HtmlNode): void {
    if (isElement(node)) {
        node.attrs = node.attrs.filter(item => item.name !== 'data-fc-part')
    }
    for (const child of children(node)) stripPartMarkers(child)
}

function mergeInstancePresentation(root: HtmlElement, instance: HtmlElement): void {
    for (const name of ['style', 'class'] as const) {
        const value = attribute(instance, name)?.trim()
        if (!value) continue
        const current = attribute(root, name)?.trim()
        setAttribute(root, name, current ? `${current}${name === 'style' ? '; ' : ' '}${value}` : value)
    }
    if (attribute(instance, 'hidden') !== undefined) setAttribute(root, 'hidden', '')
}

function materialize(instanceSource: string, definition: PublicComponentDefinitionContract): MaterializedTree {
    const instanceFragment = parseFragment(instanceSource)
    const instance = instanceFragment.childNodes.find(isElement)
    if (!instance) throw new TypeError('公共组件实例源码无法解析。')
    const definitionFragment = parseFragment(definition.html)
    const properties = Object.fromEntries(instance.attrs.flatMap(item =>
        item.name.startsWith('data-fc-prop-')
            ? [[item.name.slice('data-fc-prop-'.length), item.value] as const]
            : [],
    ))
    const roots = definitionFragment.childNodes.map(cloneNode)
    for (const root of roots) replaceProperties(root, properties)
    for (const part of definition.partSchema) {
        const target = roots.map(root => findPart(root, part.name)).find(Boolean)
        const supplied = children(instance).find(
            child => isElement(child) && attribute(child, 'data-fc-part') === part.name,
        )
        if (target) replaceChildren(target, supplied && isElement(supplied) ? children(supplied).map(cloneNode) : [])
    }
    for (const root of roots) stripPartMarkers(root)

    const onlyRoot = roots.length === 1 && isElement(roots[0]) ? roots[0] : null
    const rootKind = onlyRoot ? inferComponentKindFromTag(onlyRoot.tagName) : null
    const root = onlyRoot && rootKind
        ? onlyRoot
        : defaultTreeAdapter.createElement('div', html.NS.HTML, [])
    if (root !== onlyRoot) {
        for (const child of roots) defaultTreeAdapter.appendChild(root, child)
    }
    mergeInstancePresentation(root, instance)

    const managed: Array<{element: HtmlElement; kind: DocumentNodeKind}> = []
    const visit = (element: HtmlElement, parentKind: DocumentNodeKind | null, isRoot: boolean): void => {
        const inferred = isRoot
            ? (rootKind ?? 'container')
            : inferComponentKindFromTag(element.tagName)
        const adopted = inferred && (parentKind === null || canComponentContain(parentKind, inferred))
            ? inferred
            : null
        if (adopted) managed.push({element, kind: adopted})
        for (const child of children(element)) {
            if (isElement(child)) visit(child, adopted ?? parentKind, false)
        }
    }
    visit(root, null, true)
    return {root, managed}
}

export function countPublicComponentLocalizationNodes(
    instanceSource: string,
    definition: PublicComponentDefinitionContract,
): number {
    return materialize(instanceSource, definition).managed.length
}

function localizedCss(css: string, rootNodeId: NodeId): string {
    if (!css.trim()) return ''
    const root = postcss.parse(css)
    root.walkAtRules('layer', layer => {
        if (layer.params.trim() === 'fc-component') layer.params = 'fc-node'
    })
    root.walkRules(rule => {
        rule.selector = rule.selector.replace(
            /\[data-fc-component\s*=\s*(?:(['"])[^'"]+\1|[^\]\s]+)\]/giu,
            `[data-fc-node-id="${rootNodeId}"]`,
        )
    })
    return root.toString()
}

export function createPublicComponentLocalizationPatches(
    article: SourceDocument,
    style: SourceDocument,
    instanceElement: HtmlCompositionElement,
    definition: PublicComponentDefinitionContract,
    allocatedNodeIds: readonly NodeId[],
    references: readonly NodeIdentityReference[],
    unavailable: Iterable<string>,
): PublicComponentLocalizationPatchResult | {readonly status: 'rejected'; readonly code: string; readonly message: string} {
    if (article.key.file !== 'article.html' || style.key.file !== 'style.css') {
        return {status: 'rejected', code: 'component-localization-source-invalid', message: '组件本地化需要完整的词条 HTML 与 CSS。'}
    }
    const range = elementRange(instanceElement)
    const nodeId = attribute(instanceElement, 'data-fc-node-id')
    const instanceId = attribute(instanceElement, 'data-fc-instance')
    if (!range || !nodeId || !instanceId) {
        return {status: 'rejected', code: 'component-localization-target-invalid', message: '公共组件实例身份或源码位置不完整。'}
    }
    const expected = article.content.slice(range.from, range.to)
    const tree = materialize(expected, definition)
    if (tree.managed.length !== allocatedNodeIds.length) {
        return {status: 'rejected', code: 'component-localization-allocation-mismatch', message: '宿主分配的本地节点身份数量与展开结构不一致。'}
    }
    let allocationIndex = 0
    const identity = planComponentLocalization(
        {nodeId, instanceId},
        tree.managed.length,
        references,
        () => allocatedNodeIds[allocationIndex++] ?? '',
        unavailable,
    )
    tree.managed.forEach((item, index) => {
        setAttribute(item.element, 'data-fc-node-id', identity.expandedNodeIds[index])
        setAttribute(item.element, 'data-fc-node-kind', item.kind)
    })
    const patches: SourcePatch[] = [{
        source: article.key,
        range: utf16Range(range.from, range.to),
        expected,
        insert: serializeOuter(tree.root),
    }]
    const css = localizedCss(definition.css, identity.keptNodeId)
    if (css) {
        patches.push({
            source: style.key,
            range: utf16Range(style.content.length, style.content.length),
            expected: '',
            insert: `${style.content.endsWith('\n') || style.content.length === 0 ? '' : '\n'}${css}\n`,
        })
    }
    return Object.freeze({status: 'ready', patches: Object.freeze(patches), identity})
}
