// 本模块冻结 fc-node 的精确节点选择器语义；只识别节点身份属性，不接管组合器或任意作者选择器。

export interface ManagedNodeSelectorIdentity {
    nodeId: string
    nodeKind: string | null
    specificity: number
}

const MANAGED_ATTRIBUTE_PATTERN =
    /\[\s*(data-fc-node-id|data-fc-node-kind)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\]\s]+))\s*\]/giu

export function parseManagedNodeSelector(selector: string): ManagedNodeSelectorIdentity | null {
    selector = selector.trim()
    const attributes = new Map<string, string>()
    let cursor = 0
    let specificity = 0
    for (const match of selector.matchAll(MANAGED_ATTRIBUTE_PATTERN)) {
        const index = match.index ?? 0
        // 属性之间的空格是后代组合器，不是复合选择器的可忽略格式。
        if (index !== cursor) return null
        const name = match[1].toLowerCase()
        const value = match[2] ?? match[3] ?? match[4]
        if (attributes.has(name) && attributes.get(name) !== value) return null
        attributes.set(name, value)
        specificity += 1
        cursor = index + match[0].length
    }
    if (selector.slice(cursor).trim()) return null

    const nodeId = attributes.get('data-fc-node-id')?.toLowerCase()
    const nodeKind = attributes.get('data-fc-node-kind')?.toLowerCase() ?? null
    if (!nodeId || attributes.size !== (nodeKind ? 2 : 1)) return null
    return {nodeId, nodeKind, specificity}
}

export function managedContainerSelector(nodeId: string): string {
    return `[data-fc-node-id="${nodeId.toLowerCase()}"][data-fc-node-kind="container"]`
}
