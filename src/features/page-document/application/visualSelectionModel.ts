// 本模块统一图层与画布的节点选择边界；只有当前投影中的托管节点能够成为选中项。

import type {LayerProjectionNode} from '../domain/layerProjection.ts'

export type VisualSelectionSource = 'canvas' | 'layer'

function containsManagedNode(nodes: readonly LayerProjectionNode[], nodeId: string): boolean {
    return nodes.some(node =>
        (node.managed && node.id === nodeId) || containsManagedNode(node.children, nodeId),
    )
}

export function resolveVisualSelection(
    nodes: readonly LayerProjectionNode[],
    nodeId: string | null,
    source: VisualSelectionSource,
): string | null {
    void source
    if (nodeId === null) return null
    const normalized = nodeId.toLowerCase()
    return containsManagedNode(nodes, normalized) ? normalized : null
}
