// 本模块统一证明新组件可插入的父子类型、锚点与作者子列表来源；不生成 HTML 或分配身份。

import {canComponentContain, type ComponentIndex} from '../components/index.ts'
import type {ComponentHandle} from '../contracts/identity.ts'
import type {DocumentNodeKind} from '../contracts/primitives.ts'
import type {SourceScope} from '../contracts/source.ts'
import {
    inspectComponentChildListPolicy,
    type ComponentChildListPolicyResult,
} from './componentMovePolicy.ts'

type ComponentInsertionPolicyRejection = {
    readonly status: 'rejected'
    readonly code: string
    readonly message: string
}

export type ComponentInsertionPolicyResult =
    | {
          readonly status: 'allowed'
          readonly childList: ComponentChildListPolicyResult & {readonly status: 'allowed'}
      }
    | ComponentInsertionPolicyRejection

export function checkComponentInsertionPolicy(
    components: ComponentIndex,
    parentHandle: ComponentHandle,
    afterHandle: ComponentHandle | null,
    componentKind: DocumentNodeKind,
    destinationScope: SourceScope,
): ComponentInsertionPolicyResult {
    const parent = components.components.find(
        component => component.handle.handleId === parentHandle.handleId,
    )
    if (!parent || !components.resolveElement(parentHandle)) {
        return rejected('stale-component-handle', '插入目标父组件已经失效。')
    }
    if (!canComponentContain(parentHandle.kind, componentKind)) {
        return rejected(
            'component-parent-kind-mismatch',
            componentKind === 'list-item' ? '列表项只能插入列表。' : '普通组件只能插入布局容器。',
        )
    }
    const childList = inspectComponentChildListPolicy(
        components,
        parentHandle,
        afterHandle,
        destinationScope,
    )
    if (childList.status === 'rejected') return childList
    return Object.freeze({status: 'allowed', childList})
}

function rejected(code: string, message: string): ComponentInsertionPolicyRejection {
    return Object.freeze({status: 'rejected', code, message})
}
