// 本模块把桌面“插入”命令绑定到现有 insert-component 意图；插入位置与持久身份均由宿主明确提供。

import {
    DEFAULT_TABLE_CELL_COUNT,
    documentFingerprint,
    idempotencyKey,
    interactionId,
    nodeId,
    type DocumentNodeKind,
    type EditIntent,
} from '../domain/kernel/index.ts'
import type {ImageInsertionTarget} from './imageAssetEditing.ts'
import {
    requireKernelComponentHandle,
    type KernelComponentBindings,
    type KernelDraftEditRequest,
} from './documentKernelDraftRuntime.ts'

export const BUILT_IN_STRUCTURE_KINDS = [
    'paragraph',
    'heading',
    'list',
    'table',
    'divider',
    'container',
] as const satisfies readonly DocumentNodeKind[]

export type BuiltInStructureKind = (typeof BUILT_IN_STRUCTURE_KINDS)[number]

export interface BuiltInStructureInsertion {
    readonly newNodeId: string
    readonly newChildNodeIds: readonly string[]
    readonly request: KernelDraftEditRequest
}

export function createBuiltInStructureInsertion(
    target: ImageInsertionTarget,
    componentKind: BuiltInStructureKind,
    allocateId: () => string = () => crypto.randomUUID(),
    requestId: string = allocateId(),
): BuiltInStructureInsertion {
    if (!BUILT_IN_STRUCTURE_KINDS.includes(componentKind)) {
        throw new TypeError('该结构不能从桌面插入页签创建。')
    }
    const newNodeId = nodeId(allocateId())
    const childCount = componentKind === 'list'
        ? 1
        : componentKind === 'table'
          ? DEFAULT_TABLE_CELL_COUNT
          : 0
    const newChildNodeIds = Object.freeze(
        Array.from({length: childCount}, () => nodeId(allocateId())),
    )
    const request: KernelDraftEditRequest = Object.freeze({
        nodeIds: Object.freeze(
            target.afterId ? [target.parentId.toLowerCase(), target.afterId.toLowerCase()] : [target.parentId.toLowerCase()],
        ),
        idempotencyKey: idempotencyKey(`built-in-structure-insert:${requestId}`),
        interactionId: interactionId(`built-in-structure-insert:${documentFingerprint(requestId)}`),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents(handles: KernelComponentBindings) {
            const parent = requireKernelComponentHandle(handles, target.parentId)
            const after = target.afterId
                ? requireKernelComponentHandle(handles, target.afterId)
                : null
            return Object.freeze([Object.freeze({
                kind: 'insert-component' as const,
                target: Object.freeze({kind: 'component-root' as const, component: parent}),
                after,
                componentKind,
                newNodeId,
                newChildNodeIds,
                assetId: null,
                destinationScope: 'entry' as const,
            } satisfies EditIntent)])
        },
    })
    return Object.freeze({newNodeId, newChildNodeIds, request})
}
