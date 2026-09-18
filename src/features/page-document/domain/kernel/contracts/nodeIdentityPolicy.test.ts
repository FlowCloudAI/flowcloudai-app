// 本测试逐条冻结页面文档契约 v1 的九类节点身份保持、重映射与引用降级规则。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    componentInstanceIdentity,
    mapPastedNodeIdentities,
    nodeId,
    planComponentLocalization,
    planNodeDeletion,
    planTextBlockMerge,
    planTextBlockSplit,
    preserveNodeIdentity,
    validateAiCandidateNodeIdentities,
    type NodeIdentityReference,
} from './index.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const D = '44444444-4444-4444-8444-444444444444'
const E = '55555555-5555-4555-8555-555555555555'

const reference = (targetNodeId: string): NodeIdentityReference => ({
    targetObjectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    targetNodeId: nodeId(targetNodeId),
    degraded: false,
})

function allocator(...ids: string[]): () => string {
    let index = 0
    return () => ids[index++] ?? ids.at(-1) ?? ''
}

describe('page document v1 node identity policy', () => {
    it('保存、撤销与重做保留未改节点身份，内容编辑不能偷换节点种类', () => {
        const current = {id: nodeId(A), kind: 'paragraph' as const}
        assert.deepEqual(preserveNodeIdentity(current, 'paragraph'), current)
        assert.throws(() => preserveNodeIdentity(current, 'heading'), /不能改变/u)
    })

    it('可视编辑保留身份，源码新增节点身份由归一化链分配', () => {
        const current = {id: nodeId(A), kind: 'heading' as const}
        assert.equal(preserveNodeIdentity(current, 'heading').id, A)
    })

    it('拆分保留前半身份并给后半新身份，合并保留前节点并重指引用', () => {
        assert.deepEqual(planTextBlockSplit(A, B), {leftNodeId: A, rightNodeId: B})
        const merged = planTextBlockMerge(A, B, [reference(B), reference(C)])
        assert.equal(merged.keptNodeId, A)
        assert.deepEqual(merged.retiredNodeIds, [B])
        assert.deepEqual(merged.references.map(item => item.targetNodeId), [A, C])
        assert.deepEqual(merged.references.map(item => item.degraded), [false, false])
    })

    it('同文档复制分配新身份而剪切移动保留身份', () => {
        const copied = mapPastedNodeIdentities([A, B], {
            sameDocument: true,
            operation: 'copy',
            allocate: allocator(C, D),
            unavailable: [A, B],
        })
        assert.deepEqual([...copied], [[A, C], [B, D]])
        const moved = mapPastedNodeIdentities([A, B], {
            sameDocument: true,
            operation: 'move',
            allocate: allocator(C),
            unavailable: [A, B],
        })
        assert.deepEqual([...moved], [[A, A], [B, B]])
    })

    it('跨文档粘贴即使来自剪切也为全部节点分配新身份', () => {
        const mapped = mapPastedNodeIdentities([A, B], {
            sameDocument: false,
            operation: 'move',
            allocate: allocator(C, D),
            unavailable: [A, B],
        })
        assert.deepEqual([...mapped], [[A, C], [B, D]])
    })

    it('AI 候选保留既有同种节点，新节点只接受宿主分配的身份', () => {
        const current = [{id: nodeId(A), kind: 'paragraph' as const}]
        assert.deepEqual(
            validateAiCandidateNodeIdentities(
                current,
                [current[0], {id: nodeId(B), kind: 'heading'}],
                [B],
            ),
            {status: 'accepted'},
        )
        assert.equal(
            validateAiCandidateNodeIdentities(
                current,
                [{id: nodeId(A), kind: 'heading'}],
                [],
            ).status,
            'rejected',
        )
        assert.equal(
            validateAiCandidateNodeIdentities(
                current,
                [{id: nodeId(B), kind: 'heading'}],
                [],
            ).status,
            'rejected',
        )
    })

    it('组件实例的页面节点身份与实例身份彼此独立', () => {
        assert.deepEqual(componentInstanceIdentity(A, B), {nodeId: A, instanceId: B})
        assert.throws(() => componentInstanceIdentity(A, A), /彼此独立/u)
    })

    it('转为本地组件时内部节点全新分配、实例身份退役并重指实例引用', () => {
        const localized = planComponentLocalization(
            {nodeId: A, instanceId: B},
            2,
            [reference(A), reference(E)],
            allocator(C, D),
            [A, B, E],
        )
        assert.deepEqual(localized.expandedNodeIds, [C, D])
        assert.equal(localized.retiredInstanceId, B)
        assert.deepEqual(localized.retiredNodeIds, [A])
        assert.deepEqual(localized.references.map(item => item.targetNodeId), [C, E])
    })

    it('删除节点后身份进入退休集合，节点引用降为对象级并标记 degraded', () => {
        const deleted = planNodeDeletion(A, [reference(A), reference(B)])
        assert.deepEqual(deleted.retiredNodeIds, [A])
        assert.deepEqual(deleted.references[0], {
            targetObjectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            targetNodeId: null,
            degraded: true,
        })
        assert.deepEqual(deleted.references[1], reference(B))
        const remapped = mapPastedNodeIdentities([B], {
            sameDocument: true,
            operation: 'copy',
            allocate: allocator(A, C),
            unavailable: deleted.retiredNodeIds,
        })
        assert.equal(remapped.get(nodeId(B)), C)
    })
})
