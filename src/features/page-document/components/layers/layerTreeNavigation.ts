// 本模块计算组件树的可见顺序与标准树键盘动作；组件只负责焦点和折叠状态。

import type {LayerProjectionNode} from '../../domain/layerProjection.ts'

export interface VisibleLayerTreeItem {
    readonly id: string
    readonly parentId: string | null
    readonly hasChildren: boolean
    readonly expanded: boolean
}

export interface LayerTreeKeyboardAction {
    readonly focusId: string
    readonly toggleId: string | null
    readonly selectId: string | null
}

export function visibleLayerTreeItems(
    nodes: readonly LayerProjectionNode[],
    collapsedIds: ReadonlySet<string>,
): readonly VisibleLayerTreeItem[] {
    const items: VisibleLayerTreeItem[] = []
    const visit = (siblings: readonly LayerProjectionNode[], parentId: string | null): void => {
        for (const node of siblings) {
            const hasChildren = node.children.length > 0
            const expanded = hasChildren && !collapsedIds.has(node.id)
            items.push({id: node.id, parentId, hasChildren, expanded})
            if (expanded) visit(node.children, node.id)
        }
    }
    visit(nodes, null)
    return items
}

export function resolveLayerTreeKeyboardAction(
    items: readonly VisibleLayerTreeItem[],
    currentId: string,
    key: string,
): LayerTreeKeyboardAction | null {
    const index = items.findIndex(item => item.id === currentId)
    if (index < 0) return null
    const current = items[index]
    const focus = (focusId: string): LayerTreeKeyboardAction => ({focusId, toggleId: null, selectId: null})
    if (key === 'ArrowUp') return focus(items[Math.max(0, index - 1)].id)
    if (key === 'ArrowDown') return focus(items[Math.min(items.length - 1, index + 1)].id)
    if (key === 'Home') return focus(items[0].id)
    if (key === 'End') return focus(items.at(-1)?.id ?? current.id)
    if (key === 'ArrowRight') {
        if (current.hasChildren && !current.expanded) return {focusId: current.id, toggleId: current.id, selectId: null}
        const firstChild = items[index + 1]
        return current.expanded && firstChild?.parentId === current.id ? focus(firstChild.id) : focus(current.id)
    }
    if (key === 'ArrowLeft') {
        if (current.expanded) return {focusId: current.id, toggleId: current.id, selectId: null}
        return focus(current.parentId ?? current.id)
    }
    if (key === 'Enter' || key === ' ') return {focusId: current.id, toggleId: null, selectId: current.id}
    return null
}
