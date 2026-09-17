// 本模块把项目已鉴权资产映射到现有内核图片插入/替换意图；不持有文件路径或另一份草稿。

import {documentFingerprint, idempotencyKey, interactionId, nodeId, type EditIntent} from '../domain/kernel/index.ts'
import type {LayerProjectionNode} from '../domain/layerProjection.ts'
import {RFC_9562_UUID_PATTERN} from '../domain/uuidPolicy.ts'
import {requireKernelComponentHandle, type KernelDraftEditRequest} from './documentKernelDraftRuntime.ts'
import type {ManagedImageDescription} from './imageSemanticEditing.ts'

export interface ImageInsertionTarget {
    parentId: string
    afterId: string | null
}

export function isCurrentImageAssetSelection(
    openedContext: string,
    currentContext: string,
    assetProjectId: string,
    currentProjectId: string,
    openedPickerId: string,
    activePickerId: string | null,
): boolean {
    return openedContext === currentContext && assetProjectId === currentProjectId &&
        openedPickerId === activePickerId
}

function firstEditorContainer(nodes: readonly LayerProjectionNode[]): LayerProjectionNode | null {
    for (const node of nodes) {
        if (node.managed && node.kind === 'container' && 'data-fc-editor-root' in node.attributes) return node
        const nested = firstEditorContainer(node.children)
        if (nested) return nested
    }
    return null
}

export function resolveImageInsertionTarget(
    nodes: readonly LayerProjectionNode[],
    selectedNodeId: string | null,
): ImageInsertionTarget | null {
    const visit = (items: readonly LayerProjectionNode[], parent: LayerProjectionNode | null): ImageInsertionTarget | null => {
        for (const node of items) {
            if (node.id === selectedNodeId) {
                if (!node.managed) return null
                if (node.kind === 'container') {
                    const last = [...node.children].reverse().find(child => child.managed)
                    return {parentId: node.id, afterId: last?.id ?? null}
                }
                return parent?.managed && parent.kind === 'container'
                    ? {parentId: parent.id, afterId: node.id}
                    : null
            }
            const found = visit(node.children, node)
            if (found) return found
        }
        return null
    }
    if (selectedNodeId) return visit(nodes, null)
    const root = firstEditorContainer(nodes)
    if (!root) return null
    const last = [...root.children].reverse().find(child => child.managed)
    return {parentId: root.id, afterId: last?.id ?? null}
}

function requireAssetId(value: string): string {
    if (!RFC_9562_UUID_PATTERN.test(value)) throw new TypeError('图片资产 ID 无效。')
    return value.toLowerCase()
}

export function createImageInsertionRequest(
    target: ImageInsertionTarget,
    assetId: string,
    newNodeId: string,
    requestId: string = crypto.randomUUID(),
): KernelDraftEditRequest {
    const normalizedAsset = requireAssetId(assetId)
    if (!RFC_9562_UUID_PATTERN.test(newNodeId)) throw new TypeError('新图片节点 ID 无效。')
    return {
        nodeIds: target.afterId ? [target.parentId, target.afterId] : [target.parentId],
        idempotencyKey: idempotencyKey(`image-insert:${requestId}`),
        interactionId: interactionId(`image-insert:${documentFingerprint(requestId)}`),
        authorizedScopes: ['entry'],
        createIntents(handles) {
            const parent = requireKernelComponentHandle(handles, target.parentId)
            const after = target.afterId ? requireKernelComponentHandle(handles, target.afterId) : null
            const intent: EditIntent = {
                kind: 'insert-component',
                target: {kind: 'component-root', component: parent},
                after,
                componentKind: 'asset',
                newNodeId: nodeId(newNodeId),
                newChildNodeIds: [],
                assetId: nodeId(normalizedAsset),
                destinationScope: 'entry',
            }
            return [intent]
        },
    }
}

export function createImageReplacementRequest(
    image: ManagedImageDescription,
    assetId: string,
    requestId: string = crypto.randomUUID(),
): KernelDraftEditRequest {
    const normalizedAsset = requireAssetId(assetId)
    return {
        nodeIds: [image.nodeId],
        idempotencyKey: idempotencyKey(`image-replace:${requestId}`),
        interactionId: interactionId(`image-replace:${documentFingerprint(requestId)}`),
        authorizedScopes: ['entry'],
        createIntents(handles) {
            const component = requireKernelComponentHandle(handles, image.nodeId)
            const intent: EditIntent = {
                kind: 'set-asset-reference',
                target: {kind: 'component-root', component},
                expected: image.sourceReference,
                assetId: nodeId(normalizedAsset),
                destinationScope: 'entry',
            }
            return [intent]
        },
    }
}
