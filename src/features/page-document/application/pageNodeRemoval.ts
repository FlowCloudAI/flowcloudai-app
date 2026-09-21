// 本模块把页面节点删除绑定到现有 remove-component 意图，并在修改前决定删除后的稳定选中落点。

import type {LayerProjectionNode} from '../domain/layerProjection.ts'
import {
    documentFingerprint,
    idempotencyKey,
    interactionId,
    nodeId,
    type EditIntent,
} from '../domain/kernel/index.ts'
import {
    requireKernelComponentHandle,
    type KernelComponentBindings,
    type KernelDraftEditRequest,
} from './documentKernelDraftRuntime.ts'

export interface PageNodeRemoval {
    readonly request: KernelDraftEditRequest
    readonly selectionAfterRemoval: string
}

interface LocatedNode {
    readonly node: LayerProjectionNode
    readonly parent: LayerProjectionNode
    readonly siblings: readonly LayerProjectionNode[]
    readonly index: number
}

function locateRemovableNode(
    nodes: readonly LayerProjectionNode[],
    targetNodeId: string,
    parent: LayerProjectionNode | null = null,
): LocatedNode | null {
    for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]
        if (node.id === targetNodeId) {
            return parent ? Object.freeze({node, parent, siblings: nodes, index}) : null
        }
        const nested = locateRemovableNode(node.children, targetNodeId, node)
        if (nested) return nested
    }
    return null
}

export function createPageNodeRemoval(
    nodes: readonly LayerProjectionNode[],
    targetNodeId: string,
    requestId: string = crypto.randomUUID(),
): PageNodeRemoval | null {
    const targetId = targetNodeId.toLowerCase()
    const located = locateRemovableNode(nodes, targetId)
    if (
        !located?.node.managed
        || !located.parent.managed
        || located.node.attributes['data-fc-editor-root'] !== undefined
    ) return null

    const adjacent = located.siblings[located.index + 1] ?? located.siblings[located.index - 1]
    const selectionAfterRemoval = adjacent?.id ?? located.parent.id
    const parentNodeId = nodeId(located.parent.id)
    const request: KernelDraftEditRequest = Object.freeze({
        nodeIds: Object.freeze([targetId]),
        idempotencyKey: idempotencyKey(`page-node-remove:${requestId}`),
        interactionId: interactionId(`page-node-remove:${documentFingerprint(requestId)}`),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents(handles: KernelComponentBindings) {
            const target = requireKernelComponentHandle(handles, targetId)
            return Object.freeze([Object.freeze({
                kind: 'remove-component' as const,
                target: Object.freeze({kind: 'component-root' as const, component: target}),
                expectedParentNodeId: parentNodeId,
                destinationScope: 'entry' as const,
            } satisfies EditIntent)])
        },
    })
    return Object.freeze({request, selectionAfterRemoval})
}
