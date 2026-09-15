// 本模块统一图层与画布的节点选择边界；只有当前投影中的托管节点能够成为选中项。

import type {LayerProjectionNode} from '../domain/layerProjection.ts'

export type VisualSelectionSource = 'canvas' | 'layer'

export function findManagedLayerNode(
    nodes: readonly LayerProjectionNode[],
    nodeId: string,
): LayerProjectionNode | null {
    for (const node of nodes) {
        if (node.managed && node.id === nodeId) return node
        const nested = findManagedLayerNode(node.children, nodeId)
        if (nested) return nested
    }
    return null
}

export function resolveVisualSelection(
    nodes: readonly LayerProjectionNode[],
    nodeId: string | null,
    source: VisualSelectionSource,
): string | null {
    void source
    if (nodeId === null) return null
    const normalized = nodeId.toLowerCase()
    return findManagedLayerNode(nodes, normalized) ? normalized : null
}
