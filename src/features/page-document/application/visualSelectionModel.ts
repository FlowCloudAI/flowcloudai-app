// 本模块统一图层与画布的节点选择边界；组件树可选未纳入节点，画布消息仍只信任托管身份。

import type {LayerProjectionNode} from '../domain/layerProjection.ts'

export type VisualSelectionSource = 'canvas' | 'layer'

export function findLayerNode(
    nodes: readonly LayerProjectionNode[],
    nodeId: string,
): LayerProjectionNode | null {
    for (const node of nodes) {
        if (node.id === nodeId) return node
        const nested = findLayerNode(node.children, nodeId)
        if (nested) return nested
    }
    return null
}

export function findManagedLayerNode(
    nodes: readonly LayerProjectionNode[],
    nodeId: string,
): LayerProjectionNode | null {
    const node = findLayerNode(nodes, nodeId)
    return node?.managed ? node : null
}

export function resolveVisualSelection(
    nodes: readonly LayerProjectionNode[],
    nodeId: string | null,
    source: VisualSelectionSource,
): string | null {
    void source
    if (nodeId === null) return null
    const normalized = nodeId.toLowerCase()
    const node = findLayerNode(nodes, normalized)
    if (!node) return null
    return source === 'layer' || node.managed ? normalized : null
}
