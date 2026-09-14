// 本模块统一判断托管组件的可移动性和目标位置；界面导航与规划器不得各自猜测父子顺序。

import type {HtmlChildListSource, HtmlCompositionElement} from '../composition/index.ts'
import {
    canComponentContain,
    type ComponentDescriptor,
    type ComponentIndex,
} from '../components/index.ts'
import type {ComponentHandle, NodeId} from '../contracts/identity.ts'
import {sourceKeyString, type SourceKey, type SourceScope} from '../contracts/source.ts'
import {elementInnerRange} from '../syntax/index.ts'

type ComponentMovePolicyRejection = {
    readonly status: 'rejected'
    readonly code: string
    readonly message: string
}

export type ComponentMovementPolicyResult =
    | {
          readonly status: 'allowed'
          readonly parentNodeId: NodeId
          readonly siblingNodeIds: readonly NodeId[]
          readonly currentIndex: number
          readonly source: SourceKey
          readonly sourceContainer: HtmlCompositionElement
      }
    | ComponentMovePolicyRejection

export type ComponentMovePolicyResult =
    | {
          readonly status: 'allowed'
          readonly current: Extract<ComponentMovementPolicyResult, {readonly status: 'allowed'}>
          readonly destination: ComponentChildListPolicyResult & {readonly status: 'allowed'}
      }
    | ComponentMovePolicyRejection

export type ComponentChildListPolicyResult =
    | {
          readonly status: 'allowed'
          readonly source: SourceKey
          readonly sourceContainer: HtmlCompositionElement
          readonly siblingNodeIds: readonly NodeId[]
      }
    | ComponentMovePolicyRejection

export function inspectComponentMovementPolicy(
    components: ComponentIndex,
    handle: ComponentHandle,
): ComponentMovementPolicyResult {
    const target = descriptorForHandle(components, handle)
    const targetElement = components.resolveElement(handle)
    if (!target || !targetElement) return rejected('stale-component-handle', '目标组件已经失效。')
    if (hasAttribute(targetElement, 'data-fc-editor-root') || target.parentNodeId === null) {
        return rejected('editor-root-move-forbidden', '页面根容器不能移动。')
    }
    if (handle.kind === 'table-cell') {
        return rejected(
            'table-structure-operation-required',
            '单元格位置只能通过表格行列工具调整。',
        )
    }
    const parent = descriptorForNodeId(components, target.parentNodeId)
    const parentElement = parent ? components.resolveElement(parent.handle) : null
    if (!parent || !parentElement) return rejected('stale-component-handle', '父组件已经失效。')
    if (!canComponentContain(parent.handle.kind, handle.kind)) {
        return rejected('component-parent-kind-mismatch', '当前父组件不能承载此类组件。')
    }
    const childList = inspectComponentChildListPolicy(
        components,
        parent.handle,
        handle,
        handle.origin.source?.scope ?? null,
    )
    if (childList.status === 'rejected') return childList
    const siblingNodeIds = childList.siblingNodeIds
    const currentIndex = siblingNodeIds.indexOf(handle.nodeId)
    if (currentIndex < 0) {
        return rejected('component-order-unavailable', '无法确定组件在父级中的顺序。')
    }
    return Object.freeze({
        status: 'allowed',
        parentNodeId: parent.handle.nodeId,
        siblingNodeIds: Object.freeze(siblingNodeIds),
        currentIndex,
        source: childList.source,
        sourceContainer: childList.sourceContainer,
    })
}

export function checkComponentMovePolicy(
    components: ComponentIndex,
    targetHandle: ComponentHandle,
    parentHandle: ComponentHandle,
    afterHandle: ComponentHandle | null,
): ComponentMovePolicyResult {
    const current = inspectComponentMovementPolicy(components, targetHandle)
    if (current.status === 'rejected') return current
    const target = descriptorForHandle(components, targetHandle)
    const parent = descriptorForHandle(components, parentHandle)
    const targetElement = components.resolveElement(targetHandle)
    const parentElement = components.resolveElement(parentHandle)
    if (!target || !parent || !targetElement || !parentElement) {
        return rejected('stale-component-handle', '移动目标或目标父组件已经失效。')
    }
    if (targetHandle.handleId === parentHandle.handleId) {
        return rejected('component-cannot-parent-itself', '组件不能移动到自身内部。')
    }
    if (!canComponentContain(parentHandle.kind, targetHandle.kind)) {
        return rejected(
            'component-parent-kind-mismatch',
            targetHandle.kind === 'list-item'
                ? '列表项只能移动到列表中。'
                : '普通组件只能移动到布局容器中。',
        )
    }
    if (isDescendantOf(parentElement, targetElement)) {
        return rejected('component-cannot-move-into-descendant', '容器不能移动到自己的后代内部。')
    }
    if (afterHandle) {
        if (afterHandle.handleId === targetHandle.handleId) {
            return rejected('component-after-cannot-equal-target', '组件不能移动到自身之后。')
        }
        const after = descriptorForHandle(components, afterHandle)
        const afterElement = components.resolveElement(afterHandle)
        if (!after || !afterElement || after.parentNodeId !== parentHandle.nodeId) {
            return rejected(
                'component-after-not-direct-child',
                '目标前项必须是父组件的直接子组件。',
            )
        }
    }
    const destination = inspectComponentChildListPolicy(
        components,
        parentHandle,
        afterHandle ?? (parentHandle.nodeId === current.parentNodeId ? targetHandle : null),
        targetHandle.origin.source?.scope ?? null,
    )
    if (destination.status === 'rejected') return destination
    if (sourceKeyString(destination.source) !== sourceKeyString(current.source)) {
        return rejected(
            'component-move-source-mismatch',
            '移动目标与目标子列表必须位于同一份可写作者 HTML 中。',
        )
    }
    return Object.freeze({status: 'allowed', current, destination})
}

export function inspectComponentChildListPolicy(
    components: ComponentIndex,
    parentHandle: ComponentHandle,
    anchorHandle: ComponentHandle | null,
    scope: SourceScope | null,
): ComponentChildListPolicyResult {
    const parent = descriptorForHandle(components, parentHandle)
    const parentElement = components.resolveElement(parentHandle)
    if (!parent || !parentElement) return rejected('stale-component-handle', '目标父组件已经失效。')
    const candidates = (components.childListSources(parentHandle) ?? []).filter(
        item =>
            item.source.file === 'article.html' && (scope === null || item.source.scope === scope),
    )
    const anchorElement = anchorHandle ? components.resolveElement(anchorHandle) : null
    const anchor = anchorHandle ? descriptorForHandle(components, anchorHandle) : null
    if (
        anchorHandle &&
        (!anchorElement || !anchor || anchor.parentNodeId !== parentHandle.nodeId)
    ) {
        return rejected('component-after-not-direct-child', '目标前项必须是父组件的直接子组件。')
    }
    const anchorOrigin = anchorElement ? components.originOfNode(anchorElement) : null
    const matching = anchorOrigin?.source
        ? candidates.filter(candidate => sourceContainsOrigin(candidate, anchorOrigin))
        : candidates
    if (matching.length !== 1) {
        return rejected(
            matching.length === 0
                ? 'component-child-list-source-unavailable'
                : 'component-child-list-source-ambiguous',
            matching.length === 0
                ? '父组件没有可写的作者子列表来源。'
                : '父组件在当前作用域存在多个子列表来源，必须先指定其中的相邻组件。',
        )
    }
    const selected = matching[0]
    if (
        anchorElement &&
        !hasSafeStructuralPath(components, anchorElement, parentElement, selected)
    ) {
        return rejected(
            'component-direct-parent-unavailable',
            '组件位于自定义源码包装中，不能通过快捷命令安全重排。',
        )
    }
    const siblingNodeIds = directManagedChildIds(parent).filter(id => {
        const child = descriptorForNodeId(components, id)
        const element = child ? components.resolveElement(child.handle) : null
        const origin = element ? components.originOfNode(element) : null
        return Boolean(
            element &&
            origin &&
            sourceContainsOrigin(selected, origin) &&
            hasSafeStructuralPath(components, element, parentElement, selected),
        )
    })
    return Object.freeze({
        status: 'allowed',
        source: selected.source,
        sourceContainer: selected.container,
        siblingNodeIds: Object.freeze(siblingNodeIds),
    })
}

function directManagedChildIds(parent: ComponentDescriptor): NodeId[] {
    return [...parent.childNodeIds]
}

function hasSafeStructuralPath(
    components: ComponentIndex,
    child: HtmlCompositionElement,
    managedParent: HtmlCompositionElement,
    source: HtmlChildListSource,
): boolean {
    let current = directParentElement(child)
    while (current && current !== managedParent) {
        const origin = components.originOfNode(current)
        if (
            origin?.kind === 'author' &&
            origin.source &&
            sourceKeyString(origin.source) === sourceKeyString(source.source)
        ) {
            return false
        }
        current = directParentElement(current)
    }
    return current === managedParent
}

function sourceContainsOrigin(
    source: HtmlChildListSource,
    origin: ReturnType<ComponentIndex['originOfNode']>,
): boolean {
    if (
        origin?.kind !== 'author' ||
        !origin.source ||
        !origin.range ||
        sourceKeyString(origin.source) !== sourceKeyString(source.source)
    ) {
        return false
    }
    const range = elementInnerRange(source.container)
    return Boolean(range && origin.range.from >= range.from && origin.range.to <= range.to)
}

function descriptorForHandle(
    components: ComponentIndex,
    handle: ComponentHandle,
): ComponentDescriptor | null {
    return (
        components.components.find(component => component.handle.handleId === handle.handleId) ??
        null
    )
}

function descriptorForNodeId(components: ComponentIndex, id: NodeId): ComponentDescriptor | null {
    return components.components.find(component => component.handle.nodeId === id) ?? null
}

function directParentElement(element: HtmlCompositionElement): HtmlCompositionElement | null {
    const parent = element.parentNode
    return parent && 'tagName' in parent ? parent : null
}

function isDescendantOf(
    candidate: HtmlCompositionElement,
    ancestor: HtmlCompositionElement,
): boolean {
    let parent = directParentElement(candidate)
    while (parent) {
        if (parent === ancestor) return true
        parent = directParentElement(parent)
    }
    return false
}

function hasAttribute(element: HtmlCompositionElement, name: string): boolean {
    return element.attrs.some(attribute => attribute.name === name)
}

function rejected(code: string, message: string): ComponentMovePolicyRejection {
    return Object.freeze({status: 'rejected', code, message})
}
