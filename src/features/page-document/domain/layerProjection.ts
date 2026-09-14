// 本模块从词条 patch 源码派生只读图层；它不补节点 ID，也不把投影序列化回作者文件。
import {parseFragment, type DefaultTreeAdapterTypes} from 'parse5'
import {DOCUMENT_NODE_KINDS, type DocumentNodeKind, type SourceRange} from './contract.ts'
import {projectsManagedChildren} from './nodeSemantics.ts'

type HtmlElement = DefaultTreeAdapterTypes.Element
type HtmlNode = DefaultTreeAdapterTypes.Node
type HtmlRoot = DefaultTreeAdapterTypes.DocumentFragment

const TRANSPARENT_TABLE_STRUCTURE_TAGS = new Set(['thead', 'tbody', 'tr'])

export type LayerProjectionKind = DocumentNodeKind | 'source' | 'operation'

export interface LayerProjectionNode {
    id: string
    kind: LayerProjectionKind
    label: string
    tagName: string | null
    attributes: Readonly<Record<string, string>>
    textContent: string
    managed: boolean
    range: SourceRange | null
    children: LayerProjectionNode[]
}

export interface LayerProjection {
    nodes: LayerProjectionNode[]
    managedNodeCount: number
    sourceNodeCount: number
}

function isElement(node: HtmlNode): node is HtmlElement {
    return 'tagName' in node
}

function attribute(element: HtmlElement, name: string): string | undefined {
    return element.attrs.find(candidate => candidate.name === name)?.value
}

function children(node: HtmlNode | HtmlRoot): DefaultTreeAdapterTypes.ChildNode[] {
    if (isElement(node) && node.tagName === 'template' && 'content' in node)
        return node.content.childNodes
    return 'childNodes' in node ? node.childNodes : []
}

function rangeOf(element: HtmlElement): SourceRange | null {
    const location = element.sourceCodeLocation
    return location ? {from: location.startOffset, to: location.endOffset} : null
}

function textContent(node: HtmlNode | HtmlRoot): string {
    if ('value' in node && typeof node.value === 'string') return node.value
    if (isElement(node) && node.tagName === 'br') return '\n'
    return children(node).map(textContent).join('')
}

function compactText(value: string): string {
    const compact = value.replace(/\s+/gu, ' ').trim()
    return compact.length > 28 ? `${compact.slice(0, 28)}…` : compact
}

function operationDescriptor(element: HtmlElement): {verb: string; slot: string} | null {
    for (const verb of ['fill', 'append', 'replace', 'remove'] as const) {
        const slot = attribute(element, `data-fc-${verb}`)
        if (slot !== undefined) return {verb, slot}
    }
    return null
}

function attributesOf(element: HtmlElement): Record<string, string> {
    return Object.fromEntries(element.attrs.map(item => [item.name, item.value]))
}

function projectedChildren(node: HtmlNode | HtmlRoot): LayerProjectionNode[] {
    return children(node).flatMap(child => (isElement(child) ? projectElement(child) : []))
}

function projectElement(element: HtmlElement): LayerProjectionNode[] {
    const nodeId = attribute(element, 'data-fc-node-id')
    const rawKind = attribute(element, 'data-fc-node-kind')
    const managedKind = DOCUMENT_NODE_KINDS.includes(rawKind as DocumentNodeKind)
        ? (rawKind as DocumentNodeKind)
        : null
    const range = rangeOf(element)
    const operation = element.tagName === 'template' ? operationDescriptor(element) : null

    if (operation) {
        return [
            {
                id: `operation:${operation.verb}:${operation.slot}:${range?.from ?? 0}`,
                kind: 'operation',
                label: `${operation.verb} · ${operation.slot}`,
                tagName: 'template',
                attributes: attributesOf(element),
                textContent: textContent(element),
                managed: false,
                range,
                children: projectedChildren(element),
            },
        ]
    }

    if (nodeId && managedKind) {
        const summary = compactText(textContent(element))
        return [
            {
                id: nodeId.toLowerCase(),
                kind: managedKind,
                label: summary ? `${managedKind} · ${summary}` : managedKind,
                tagName: element.tagName,
                attributes: attributesOf(element),
                textContent: textContent(element),
                managed: true,
                range,
                children: projectsManagedChildren(managedKind) ? projectedChildren(element) : [],
            },
        ]
    }

    if (TRANSPARENT_TABLE_STRUCTURE_TAGS.has(element.tagName)) return projectedChildren(element)

    const nested = projectedChildren(element)
    const structural = element.tagName !== 'span' || nested.length > 0
    if (!structural) return []
    return [
        {
            id: `source:${element.tagName}:${range?.from ?? 0}:${range?.to ?? 0}`,
            kind: 'source',
            label: `<${element.tagName}> 源码节点`,
            tagName: element.tagName,
            attributes: attributesOf(element),
            textContent: textContent(element),
            managed: false,
            range,
            children: nested,
        },
    ]
}

export function createLayerProjection(articleHtml: string): LayerProjection {
    const root = parseFragment(articleHtml, {sourceCodeLocationInfo: true})
    const patchRoot = root.childNodes.find(
        node =>
            isElement(node) &&
            node.tagName === 'template' &&
            attribute(node, 'data-fc-entry-patch') !== undefined,
    )
    const nodes =
        patchRoot && isElement(patchRoot) ? projectedChildren(patchRoot) : projectedChildren(root)

    let managedNodeCount = 0
    let sourceNodeCount = 0
    const count = (items: readonly LayerProjectionNode[]): void => {
        for (const item of items) {
            if (item.managed) managedNodeCount += 1
            else if (item.kind === 'source') sourceNodeCount += 1
            count(item.children)
        }
    }
    count(nodes)
    return {nodes, managedNodeCount, sourceNodeCount}
}
