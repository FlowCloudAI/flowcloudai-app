// 本模块冻结页面节点在编辑、粘贴、组件本地化与删除中的身份变换；它只规划身份和引用，不修改源码或持久层。

import {nodeId, type NodeId} from './identity.ts'
import type {DocumentNodeKind} from './primitives.ts'

const MAX_ALLOCATION_ATTEMPTS = 128

export type NodeIdentityAllocator = () => string

export interface NodeIdentityDescriptor {
    readonly id: NodeId
    readonly kind: DocumentNodeKind
}

export interface NodeIdentityReference {
    readonly targetObjectId: string
    readonly targetNodeId: NodeId | null
    readonly degraded: boolean
}

export interface NodeIdentityRemapPlan {
    readonly keptNodeId: NodeId
    readonly retiredNodeIds: readonly NodeId[]
    readonly references: readonly NodeIdentityReference[]
}

export function allocateFreshNodeId(
    allocate: NodeIdentityAllocator,
    unavailable: Iterable<string>,
): NodeId {
    const reserved = new Set([...unavailable].map(value => value.toLowerCase()))
    for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
        const candidate = nodeId(allocate())
        if (!reserved.has(candidate)) return candidate
    }
    throw new Error('节点身份生成器连续返回已占用的 UUID。')
}

/** 内容编辑、保存和历史快照只能沿用原身份；改变 kind 必须走显式结构操作。 */
export function preserveNodeIdentity(
    current: NodeIdentityDescriptor,
    editedKind: DocumentNodeKind,
): NodeIdentityDescriptor {
    if (current.kind !== editedKind) throw new Error('内容编辑不能改变既有节点种类。')
    return Object.freeze({...current})
}

export function planTextBlockSplit(
    originalNodeId: string,
    newNodeId: string,
): {readonly leftNodeId: NodeId; readonly rightNodeId: NodeId} {
    const leftNodeId = nodeId(originalNodeId)
    const rightNodeId = nodeId(newNodeId)
    if (leftNodeId === rightNodeId) throw new Error('文本块分裂后的节点必须使用新身份。')
    return Object.freeze({leftNodeId, rightNodeId})
}

export function planTextBlockMerge(
    firstNodeId: string,
    mergedNodeId: string,
    references: readonly NodeIdentityReference[],
): NodeIdentityRemapPlan {
    const keptNodeId = nodeId(firstNodeId)
    const retiredNodeId = nodeId(mergedNodeId)
    if (keptNodeId === retiredNodeId) throw new Error('合并前的两个文本块必须具有不同身份。')
    return Object.freeze({
        keptNodeId,
        retiredNodeIds: Object.freeze([retiredNodeId]),
        references: remapTargetReferences(references, retiredNodeId, keptNodeId, false),
    })
}

export function mapPastedNodeIdentities(
    sourceNodeIds: readonly string[],
    options: {
        readonly sameDocument: boolean
        readonly operation: 'copy' | 'move'
        readonly allocate: NodeIdentityAllocator
        readonly unavailable: Iterable<string>
    },
): ReadonlyMap<NodeId, NodeId> {
    const sourceIds = sourceNodeIds.map(nodeId)
    if (new Set(sourceIds).size !== sourceIds.length) {
        throw new Error('粘贴来源中不能出现重复节点身份。')
    }
    const unavailable = new Set([...options.unavailable, ...sourceIds])
    const mapped = new Map<NodeId, NodeId>()
    for (const sourceId of sourceIds) {
        const targetId =
            options.sameDocument && options.operation === 'move'
                ? sourceId
                : allocateFreshNodeId(options.allocate, unavailable)
        mapped.set(sourceId, targetId)
        unavailable.add(targetId)
    }
    return mapped
}

export type AiNodeIdentityValidation =
    | {readonly status: 'accepted'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export function validateAiCandidateNodeIdentities(
    current: readonly NodeIdentityDescriptor[],
    candidate: readonly NodeIdentityDescriptor[],
    hostAllocatedNodeIds: Iterable<string>,
): AiNodeIdentityValidation {
    const existing = new Map(current.map(item => [item.id, item.kind]))
    const allocated = new Set([...hostAllocatedNodeIds].map(value => nodeId(value)))
    const seen = new Set<NodeId>()
    for (const item of candidate) {
        if (seen.has(item.id)) {
            return rejected('ai-candidate-duplicate-node-id', 'AI 候选包含重复节点身份。')
        }
        seen.add(item.id)
        const existingKind = existing.get(item.id)
        if (existingKind && existingKind !== item.kind) {
            return rejected(
                'ai-candidate-node-kind-mismatch',
                'AI 候选把既有节点身份用于不同节点种类。',
            )
        }
        if (!existingKind && !allocated.has(item.id)) {
            return rejected(
                'ai-candidate-node-id-not-host-allocated',
                'AI 候选中的新节点身份必须由宿主分配。',
            )
        }
    }
    return Object.freeze({status: 'accepted'})
}

export function componentInstanceIdentity(
    rawNodeId: string,
    rawInstanceId: string,
): {readonly nodeId: NodeId; readonly instanceId: NodeId} {
    const componentNodeId = nodeId(rawNodeId)
    const instanceId = nodeId(rawInstanceId)
    if (componentNodeId === instanceId) {
        throw new Error('组件页面节点身份与组件实例身份必须彼此独立。')
    }
    return Object.freeze({nodeId: componentNodeId, instanceId})
}

export function planComponentLocalization(
    instance: {readonly nodeId: string; readonly instanceId: string},
    expandedNodeCount: number,
    references: readonly NodeIdentityReference[],
    allocate: NodeIdentityAllocator,
    unavailable: Iterable<string>,
): NodeIdentityRemapPlan & {
    readonly expandedNodeIds: readonly NodeId[]
    readonly retiredInstanceId: NodeId
} {
    if (!Number.isSafeInteger(expandedNodeCount) || expandedNodeCount < 1) {
        throw new TypeError('本地化后的页面节点数量必须是正整数。')
    }
    const identity = componentInstanceIdentity(instance.nodeId, instance.instanceId)
    const reserved = new Set([...unavailable, identity.nodeId, identity.instanceId])
    const expandedNodeIds: NodeId[] = []
    for (let index = 0; index < expandedNodeCount; index += 1) {
        const allocated = allocateFreshNodeId(allocate, reserved)
        expandedNodeIds.push(allocated)
        reserved.add(allocated)
    }
    const keptNodeId = expandedNodeIds[0]
    return Object.freeze({
        keptNodeId,
        expandedNodeIds: Object.freeze(expandedNodeIds),
        retiredNodeIds: Object.freeze([identity.nodeId]),
        retiredInstanceId: identity.instanceId,
        references: remapTargetReferences(references, identity.nodeId, keptNodeId, false),
    })
}

export function planNodeDeletion(
    rawNodeId: string,
    references: readonly NodeIdentityReference[],
): NodeIdentityRemapPlan {
    const retiredNodeId = nodeId(rawNodeId)
    return Object.freeze({
        keptNodeId: retiredNodeId,
        retiredNodeIds: Object.freeze([retiredNodeId]),
        references: remapTargetReferences(references, retiredNodeId, null, true),
    })
}

function remapTargetReferences(
    references: readonly NodeIdentityReference[],
    from: NodeId,
    to: NodeId | null,
    degraded: boolean,
): readonly NodeIdentityReference[] {
    return Object.freeze(
        references.map(reference =>
            reference.targetNodeId === from
                ? Object.freeze({...reference, targetNodeId: to, degraded})
                : Object.freeze({...reference}),
        ),
    )
}

function rejected(code: string, message: string): AiNodeIdentityValidation {
    return Object.freeze({status: 'rejected', code, message})
}
