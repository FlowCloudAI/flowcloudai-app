// 本模块把组件树中的单个不透明源码元素转换为内核接管请求；它只增加身份属性，不改内部结构。

import type {DocumentNodeKind} from '../domain/contract.ts'
import type {LayerProjectionNode} from '../domain/layerProjection.ts'
import {inferManagedNodeKindFromTag} from '../domain/nodeSemantics.ts'
import {
    documentFingerprint,
    idempotencyKey,
    interactionId,
    nodeId,
    sourceKey,
    utf16Range,
    type EditIntent,
} from '../domain/kernel/index.ts'
import type {KernelDraftEditRequest} from './documentKernelDraftRuntime.ts'

export function inferOpaqueAdoptionKind(node: LayerProjectionNode): DocumentNodeKind | null {
    if (node.managed || node.kind !== 'source' || node.range === null) return null
    return inferManagedNodeKindFromTag(node.tagName)
}

export function createOpaqueElementAdoptionKernelRequest({
    node,
    articleHtml,
    newNodeId,
    allocateRequestId = () => crypto.randomUUID(),
}: {
    node: LayerProjectionNode
    articleHtml: string
    newNodeId: string
    allocateRequestId?: () => string
}): KernelDraftEditRequest {
    const componentKind = inferOpaqueAdoptionKind(node)
    const range = node.range
    if (!componentKind || !range) throw new TypeError('该源码元素无法安全推断为可视组件。')
    const expected = articleHtml.slice(range.from, range.to)
    if (!expected) throw new TypeError('该源码元素的定位范围已失效。')
    const requestId = allocateRequestId()
    const adoptedNodeId = nodeId(newNodeId)
    return Object.freeze({
        nodeIds: Object.freeze([]),
        idempotencyKey: idempotencyKey(`opaque-adoption:${requestId}`),
        interactionId: interactionId(`opaque-adoption:${documentFingerprint(requestId)}`),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents: () => Object.freeze([
            Object.freeze({
                kind: 'adopt-opaque-element' as const,
                source: sourceKey('entry', 'article.html'),
                range: utf16Range(range.from, range.to),
                expected,
                newNodeId: adoptedNodeId,
                componentKind,
            }) satisfies EditIntent,
        ]),
    })
}
