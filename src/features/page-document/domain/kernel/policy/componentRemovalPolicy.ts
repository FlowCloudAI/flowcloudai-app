// 本模块统一判断托管组件是否可删除；界面可用性与规划器共用相同的结构安全规则。

import type {HtmlCompositionElement} from '../composition/index.ts'
import type {ComponentIndex} from '../components/index.ts'
import type {ComponentHandle, NodeId} from '../contracts/identity.ts'
import {checkComponentVisibilityPolicy} from './componentVisibilityPolicy.ts'

export type ComponentRemovalPolicyResult =
    | {readonly status: 'allowed'; readonly parentNodeId: NodeId}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export function checkComponentRemovalPolicy(
    components: ComponentIndex,
    handle: ComponentHandle,
): ComponentRemovalPolicyResult {
    const target = components.resolveElement(handle)
    const descriptor = components
        .query()
        .find(candidate => candidate.handle.handleId === handle.handleId)
    if (!target || !descriptor) {
        return rejected('stale-component-handle', '目标组件已经失效。')
    }
    if (hasAttribute(target, 'data-fc-editor-root') || descriptor.parentNodeId === null) {
        return rejected('editor-root-remove-forbidden', '页面根容器不能删除。')
    }
    if (handle.kind === 'table-cell') {
        return rejected('table-structure-operation-required', '单元格只能通过表格行列工具增删。')
    }
    if (handle.kind === 'list-item') {
        const siblings = components.query({
            parentNodeId: descriptor.parentNodeId,
            kinds: ['list-item'],
        })
        if (siblings.length <= 1) {
            return rejected('last-list-item-required', '列表必须至少保留一个列表项。')
        }
    }
    const visibility = checkComponentVisibilityPolicy(components, handle, true)
    if (visibility.status === 'rejected') return visibility
    return Object.freeze({status: 'allowed', parentNodeId: descriptor.parentNodeId})
}

function hasAttribute(element: HtmlCompositionElement, name: string): boolean {
    return element.attrs.some(attribute => attribute.name === name)
}

function rejected(code: string, message: string): ComponentRemovalPolicyResult {
    return Object.freeze({status: 'rejected', code, message})
}
