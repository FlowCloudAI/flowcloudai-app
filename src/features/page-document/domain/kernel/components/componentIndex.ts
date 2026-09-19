// 本模块从来源映射后的组合树建立版本绑定组件索引；UI、AI 与写入器通过句柄定位，不再猜测 DOM 位置。

import type {DefaultTreeAdapterTypes} from 'parse5'
import type {
    HtmlChildListSource,
    HtmlComposition,
    HtmlCompositionElement,
} from '../composition/index.ts'
import {
    componentHandleId,
    isDocumentNodeKind,
    nodeId,
    type AnalysisStampId,
    type ComponentHandle,
    type NodeId,
} from '../contracts/identity.ts'
import {componentInstanceIdentity} from '../contracts/nodeIdentityPolicy.ts'
import type {DocumentNodeKind} from '../contracts/primitives.ts'
import type {SourceOrigin} from '../contracts/source.ts'
import {
    componentDefinition,
    type ComponentCapabilityId,
    type ComponentSemanticPartDefinition,
    type ComponentSemanticPartId,
} from './definitions.ts'

export type SemanticPartResolutionStatus = 'resolved' | 'absent' | 'ambiguous'

export interface SemanticPartResolution {
    readonly id: ComponentSemanticPartId
    readonly status: SemanticPartResolutionStatus
    readonly nodeCount: number
    readonly reason: string | null
}

export interface ComponentDescriptor {
    readonly handle: ComponentHandle
    readonly tagName: string
    readonly parentNodeId: NodeId | null
    readonly childNodeIds: readonly NodeId[]
    /** 直接布局层中无法归属于托管子组件的元素或非空文本；布局安全校验不得跨过它猜测。 */
    readonly unmanagedDirectContentCount: number
    readonly semanticParts: readonly SemanticPartResolution[]
    readonly capabilityCandidates: readonly ComponentCapabilityId[]
}

export interface ComponentQuery {
    readonly kinds?: readonly DocumentNodeKind[]
    readonly sourceScope?: 'project' | 'entry' | 'component'
    readonly parentNodeId?: NodeId | null
}

export interface ComponentBindingFailure {
    readonly nodeId: string
    readonly code: 'component-not-found' | 'component-identity-ambiguous'
}

export interface ComponentBindingResult {
    readonly handles: readonly ComponentHandle[]
    readonly failures: readonly ComponentBindingFailure[]
}

export interface ComponentIndexIssue {
    readonly code: 'component-identity-ambiguous'
    readonly nodeId: NodeId
    readonly count: number
}

export interface ComponentIndex {
    readonly analysisStamp: AnalysisStampId
    readonly components: readonly ComponentDescriptor[]
    readonly issues: readonly ComponentIndexIssue[]
    query(query?: ComponentQuery): readonly ComponentDescriptor[]
    bind(rawNodeIds: readonly string[]): ComponentBindingResult
    resolveElement(handle: ComponentHandle): HtmlCompositionElement | null
    originOfNode(node: HtmlComposition['root'] | DefaultTreeAdapterTypes.Node): SourceOrigin | null
    childListSources(handle: ComponentHandle): readonly HtmlChildListSource[] | null
    resolveSemanticPart(
        handle: ComponentHandle,
        part: ComponentSemanticPartId,
    ): readonly HtmlCompositionElement[] | null
}

interface IndexedComponent {
    readonly descriptor: ComponentDescriptor
    readonly element: HtmlCompositionElement
    readonly semanticElements: ReadonlyMap<
        ComponentSemanticPartId,
        readonly HtmlCompositionElement[]
    >
}

export function createComponentIndex(
    composition: HtmlComposition,
    options: {readonly analysisStamp: AnalysisStampId; readonly instanceNamespace: string},
): ComponentIndex {
    if (!options.instanceNamespace.trim()) throw new TypeError('组件实例命名空间不能为空。')
    const candidates = collectManagedCandidates(composition.root)
    const byId = new Map<NodeId, HtmlCompositionElement[]>()
    for (const candidate of candidates) {
        const id = readNodeId(candidate)
        if (!id) continue
        const matches = byId.get(id) ?? []
        matches.push(candidate)
        byId.set(id, matches)
    }

    const issues: ComponentIndexIssue[] = []
    const uniqueElements = new Map<NodeId, HtmlCompositionElement>()
    for (const [id, matches] of byId) {
        if (matches.length === 1) uniqueElements.set(id, matches[0])
        else
            issues.push(
                Object.freeze({
                    code: 'component-identity-ambiguous',
                    nodeId: id,
                    count: matches.length,
                }),
            )
    }

    const idByElement = new Map([...uniqueElements].map(([id, element]) => [element, id]))
    const parentIds = new Map<NodeId, NodeId | null>()
    for (const [id, element] of uniqueElements) {
        parentIds.set(id, nearestManagedParentId(element, idByElement))
    }
    const childIds = new Map<NodeId, NodeId[]>()
    for (const [id, parentId] of parentIds) {
        if (!parentId) continue
        const children = childIds.get(parentId) ?? []
        children.push(id)
        childIds.set(parentId, children)
    }

    const indexed = [...uniqueElements].map(([id, element], ordinal): IndexedComponent => {
        const kind = readKnownKind(element)!
        const origin = composition.sourceMap.originOfNode(element) ?? generatedOrigin()
        const handle: ComponentHandle = Object.freeze({
            handleId: componentHandleId(`component:${ordinal}:${id}`),
            nodeId: id,
            instanceId: instanceIdentity(element, kind, id, options.instanceNamespace),
            kind,
            origin,
            analysisStamp: options.analysisStamp,
        })
        const semanticElements = resolveSemanticElements(element, kind, uniqueElements)
        const descriptor: ComponentDescriptor = Object.freeze({
            handle,
            tagName: element.tagName,
            parentNodeId: parentIds.get(id) ?? null,
            childNodeIds: Object.freeze([...(childIds.get(id) ?? [])]),
            unmanagedDirectContentCount: countUnmanagedDirectContent(element, idByElement),
            semanticParts: Object.freeze(
                componentDefinition(kind).semanticParts.map(part =>
                    describeSemanticPart(part, semanticElements.get(part.id) ?? []),
                ),
            ),
            capabilityCandidates: componentDefinition(kind).capabilityCandidates,
        })
        return {descriptor, element, semanticElements}
    })

    const byNodeId = new Map(indexed.map(item => [item.descriptor.handle.nodeId, item]))
    const byHandleId = new Map(indexed.map(item => [item.descriptor.handle.handleId, item]))
    const components = Object.freeze(indexed.map(item => item.descriptor))
    const frozenIssues = Object.freeze(issues)

    const index: ComponentIndex = {
        analysisStamp: options.analysisStamp,
        components,
        issues: frozenIssues,
        query: (query = {}) =>
            Object.freeze(
                components.filter(component => {
                    if (query.kinds && !query.kinds.includes(component.handle.kind)) return false
                    if (
                        query.sourceScope &&
                        component.handle.origin.source?.scope !== query.sourceScope
                    ) {
                        return false
                    }
                    return (
                        query.parentNodeId === undefined ||
                        component.parentNodeId === query.parentNodeId
                    )
                }),
            ),
        bind: rawNodeIds => bindComponents(rawNodeIds, byNodeId, byId),
        resolveElement: handle =>
            resolveIndexedHandle(handle, options.analysisStamp, byHandleId)?.element ?? null,
        originOfNode: node => composition.sourceMap.originOfNode(node),
        childListSources: handle => {
            const element = resolveIndexedHandle(handle, options.analysisStamp, byHandleId)?.element
            return element ? composition.sourceMap.childListSources(element) : null
        },
        resolveSemanticPart: (handle, part) =>
            resolveIndexedHandle(handle, options.analysisStamp, byHandleId)?.semanticElements.get(
                part,
            ) ?? null,
    }
    return Object.freeze(index)
}

function instanceIdentity(
    element: HtmlCompositionElement,
    kind: DocumentNodeKind,
    nodeIdValue: NodeId,
    instanceNamespace: string,
): string {
    if (kind === 'component') {
        const rawInstanceId = attribute(element, 'data-fc-instance')
        if (rawInstanceId) {
            try {
                return componentInstanceIdentity(nodeIdValue, rawInstanceId).instanceId
            } catch {
                // HTML 契约会先拒绝非法实例；索引仍须能为诊断构造稳定句柄。
            }
        }
    }
    return `${instanceNamespace}:${nodeIdValue}`
}

function countUnmanagedDirectContent(
    element: HtmlCompositionElement,
    idByElement: ReadonlyMap<HtmlCompositionElement, NodeId>,
): number {
    return childrenOf(element).filter(child => {
        if (isElement(child)) return !idByElement.has(child)
        return child.nodeName === '#text' && child.value.trim().length > 0
    }).length
}

function bindComponents(
    rawNodeIds: readonly string[],
    byNodeId: ReadonlyMap<NodeId, IndexedComponent>,
    allCandidates: ReadonlyMap<NodeId, readonly HtmlCompositionElement[]>,
): ComponentBindingResult {
    const handles: ComponentHandle[] = []
    const failures: ComponentBindingFailure[] = []
    for (const rawId of rawNodeIds) {
        let id: NodeId
        try {
            id = nodeId(rawId)
        } catch {
            failures.push({nodeId: rawId, code: 'component-not-found'})
            continue
        }
        const component = byNodeId.get(id)
        if (component) handles.push(component.descriptor.handle)
        else {
            failures.push({
                nodeId: rawId,
                code:
                    (allCandidates.get(id)?.length ?? 0) > 1
                        ? 'component-identity-ambiguous'
                        : 'component-not-found',
            })
        }
    }
    return Object.freeze({handles: Object.freeze(handles), failures: Object.freeze(failures)})
}

function resolveIndexedHandle(
    handle: ComponentHandle,
    analysisStamp: AnalysisStampId,
    byHandleId: ReadonlyMap<ComponentHandle['handleId'], IndexedComponent>,
): IndexedComponent | null {
    if (handle.analysisStamp !== analysisStamp) return null
    const indexed = byHandleId.get(handle.handleId)
    if (
        !indexed ||
        indexed.descriptor.handle.nodeId !== handle.nodeId ||
        indexed.descriptor.handle.kind !== handle.kind ||
        indexed.descriptor.handle.instanceId !== handle.instanceId
    ) {
        return null
    }
    return indexed
}

function collectManagedCandidates(root: HtmlComposition['root']): HtmlCompositionElement[] {
    const result: HtmlCompositionElement[] = []
    visitElements(root, element => {
        if (readNodeId(element) && readKnownKind(element)) result.push(element)
    })
    return result
}

function readNodeId(element: HtmlCompositionElement): NodeId | null {
    const value = attribute(element, 'data-fc-node-id')
    if (!value) return null
    try {
        return nodeId(value)
    } catch {
        return null
    }
}

function readKnownKind(element: HtmlCompositionElement): DocumentNodeKind | null {
    const value = attribute(element, 'data-fc-node-kind')
    return isDocumentNodeKind(value) ? value : null
}

function nearestManagedParentId(
    element: HtmlCompositionElement,
    idByElement: ReadonlyMap<HtmlCompositionElement, NodeId>,
): NodeId | null {
    let parent = parentElement(element)
    while (parent) {
        const id = idByElement.get(parent)
        if (id) return id
        parent = parentElement(parent)
    }
    return null
}

function resolveSemanticElements(
    element: HtmlCompositionElement,
    kind: DocumentNodeKind,
    uniqueElements: ReadonlyMap<NodeId, HtmlCompositionElement>,
): ReadonlyMap<ComponentSemanticPartId, readonly HtmlCompositionElement[]> {
    const result = new Map<ComponentSemanticPartId, readonly HtmlCompositionElement[]>()
    for (const part of componentDefinition(kind).semanticParts) {
        const target = part.target
        if (target.kind === 'self') {
            result.set(part.id, Object.freeze([element]))
        } else if (target.kind === 'self-or-unique-descendant') {
            const matches: HtmlCompositionElement[] = []
            if (element.tagName === target.tag) matches.push(element)
            visitElements(element, candidate => {
                if (candidate !== element && candidate.tagName === target.tag)
                    matches.push(candidate)
            })
            result.set(part.id, Object.freeze(matches))
        } else if (target.kind === 'optional-direct-child') {
            result.set(
                part.id,
                Object.freeze(
                    childrenOf(element)
                        .filter(isElement)
                        .filter(child => child.tagName === target.tag),
                ),
            )
        } else {
            const matches = [...uniqueElements]
                .filter(
                    ([, candidate]) =>
                        readKnownKind(candidate) === target.childKind &&
                        nearestManagedElement(candidate) === element,
                )
                .map(([, candidate]) => candidate)
            result.set(part.id, Object.freeze(matches))
        }
    }
    return result
}

function describeSemanticPart(
    definition: ComponentSemanticPartDefinition,
    elements: readonly HtmlCompositionElement[],
): SemanticPartResolution {
    const collection = definition.target.kind === 'managed-children'
    const optional = definition.target.kind === 'optional-direct-child'
    const status: SemanticPartResolutionStatus = collection
        ? 'resolved'
        : elements.length === 1
          ? 'resolved'
          : elements.length === 0 && optional
            ? 'absent'
            : elements.length === 0
              ? 'absent'
              : 'ambiguous'
    const reason =
        status === 'ambiguous'
            ? `语义部位 ${definition.id} 匹配到 ${elements.length} 个元素。`
            : status === 'absent' && !optional
              ? `语义部位 ${definition.id} 缺失。`
              : null
    return Object.freeze({id: definition.id, status, nodeCount: elements.length, reason})
}

function nearestManagedElement(element: HtmlCompositionElement): HtmlCompositionElement | null {
    let parent = parentElement(element)
    while (parent) {
        if (readNodeId(parent) && readKnownKind(parent)) return parent
        parent = parentElement(parent)
    }
    return null
}

function parentElement(node: HtmlCompositionElement): HtmlCompositionElement | null {
    const parent = node.parentNode
    return parent && isElement(parent) ? parent : null
}

function attribute(element: HtmlCompositionElement, name: string): string | undefined {
    return element.attrs.find(item => item.name === name)?.value
}

function isElement(node: DefaultTreeAdapterTypes.Node): node is HtmlCompositionElement {
    return 'tagName' in node
}

function childrenOf(
    node: DefaultTreeAdapterTypes.Node,
): readonly DefaultTreeAdapterTypes.ChildNode[] {
    if (isElement(node) && node.tagName === 'template' && 'content' in node) {
        return node.content.childNodes
    }
    return 'childNodes' in node ? node.childNodes : []
}

function visitElements(
    root: DefaultTreeAdapterTypes.Node,
    visitor: (element: HtmlCompositionElement) => void,
): void {
    const visit = (node: DefaultTreeAdapterTypes.Node): void => {
        if (isElement(node)) visitor(node)
        for (const child of childrenOf(node)) visit(child)
    }
    visit(root)
}

function generatedOrigin(): SourceOrigin {
    return Object.freeze({kind: 'renderer-generated', source: null, range: null})
}
