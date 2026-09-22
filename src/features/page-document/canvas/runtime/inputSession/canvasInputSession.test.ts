// 本测试以语义文本事件序列固定 ADR 0007 的画布侧契约，不使用浏览器 DOM 或运行时入口。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {CanvasStoredMarks} from '../../protocol/index.ts'
import {
    beginCanvasComposition,
    cancelCanvasComposition,
    cancelCanvasUndoWait,
    commitCanvasComposition,
    createCanvasInputSessionState,
    receiveCanvasSnapshot,
    recordCanvasEdit,
    recordCanvasSelectionAction,
    restartCanvasInputSession,
    supplyCanvasReservedNodeIds,
    updateCanvasStoredMarks,
    type CanvasInputSessionState,
    type CanvasSemanticDocument,
    type CanvasSessionSnapshot,
} from './canvasInputSession.ts'

const identity = Object.freeze({sessionToken: 'session-a', runtimeInstanceId: 'runtime-a'})
const paragraphId = '11111111-1111-7111-8111-111111111111'
const secondId = '22222222-2222-7222-8222-222222222222'
const splitId = '33333333-3333-7333-8333-333333333333'

const redMarks: CanvasStoredMarks = Object.freeze({
    styleContext: 'mobile',
    values: Object.freeze({color: '#ff0000'}),
})

function document(nodes: Readonly<Record<string, string>> = {[paragraphId]: 'ab'}): CanvasSemanticDocument {
    return Object.freeze({order: Object.freeze(Object.keys(nodes)), nodes: Object.freeze({...nodes})})
}

function snapshot(input: Partial<CanvasSessionSnapshot> = {}): CanvasSessionSnapshot {
    return Object.freeze({
        identity,
        epoch: 1,
        version: 1,
        watermark: 0,
        lastForeignVersion: 0,
        outcomes: Object.freeze([]),
        html: '<p>ab</p>',
        css: '',
        landing: null,
        ...input,
    })
}

function state(input: {text?: string; reserved?: readonly string[]} = {}): CanvasInputSessionState {
    const text = input.text ?? 'ab'
    return createCanvasInputSessionState({
        documentId: 'entry-a',
        snapshot: snapshot({html: `<p>${text}</p>`}),
        document: document({[paragraphId]: text}),
        selection: {nodeId: paragraphId, from: 1, to: 1},
        reservedNodeIds: input.reserved,
    })
}

describe('ADR 0007 画布输入会话', () => {
    it('§2 组合提交锁定组合开始时的依赖基线、范围和格式', () => {
        let current = updateCanvasStoredMarks(state(), redMarks)
        current = beginCanvasComposition(current).state
        current = updateCanvasStoredMarks(current, {
            styleContext: 'desktop',
            values: {color: '#0000ff'},
        })
        const committed = commitCanvasComposition(current, '中')
        const action = committed.emittedActions[0]

        assert.equal(action?.kind, 'composition')
        assert.deepEqual(action?.base, {epoch: 1, version: 1, watermark: 0, lastForeignVersion: 0})
        assert.deepEqual(action?.storedMarks, redMarks)
        assert.deepEqual([action?.targetNodeId, action?.from, action?.to, action?.expected], [paragraphId, 1, 1, ''])
        assert.equal(committed.state.visibleDocument.nodes[paragraphId], 'a中b')
    })

    it('§4 终态按 seq 连续接收并对重复交付去重，同版本快照仍推进水位线', () => {
        const typed = recordCanvasEdit(state(), {kind: 'insert-text', text: 'X'}).state
        const accepted = Object.freeze({seq: 1, batchId: 'canvas-batch:1', status: 'accepted' as const, reason: null})
        const delayed = receiveCanvasSnapshot(typed, snapshot({
            watermark: 1,
            outcomes: [accepted, accepted],
        }), document({[paragraphId]: 'aXb'}))
        const duplicate = receiveCanvasSnapshot(delayed.state, snapshot({
            watermark: 1,
            outcomes: [accepted],
        }), document({[paragraphId]: 'aXb'}))

        assert.equal(delayed.acknowledgeThrough, 1)
        assert.equal(delayed.state.receivedOutcomes.length, 1)
        assert.equal(delayed.state.mounted.watermark, 1)
        assert.equal(delayed.state.pendingActions.length, 0)
        assert.equal(duplicate.mounted, false)
        assert.equal(duplicate.state.receivedOutcomes.length, 1)
    })

    it('§3/§5 ab / X / Y 反例在前序拒绝后撤下后续动作并生成恢复记录', () => {
        let current = recordCanvasEdit(state(), {kind: 'insert-text', text: 'X'}).state
        current = recordCanvasEdit(current, {kind: 'insert-text', text: 'Y'}).state
        assert.equal(current.visibleDocument.nodes[paragraphId], 'aXYb')

        const result = receiveCanvasSnapshot(current, snapshot({
            watermark: 1,
            outcomes: [{seq: 1, batchId: 'canvas-batch:1', status: 'rejected', reason: 'kernel-rejected'}],
        }), document())

        assert.equal(result.state.visibleDocument.nodes[paragraphId], 'ab')
        assert.equal(result.state.pendingActions.length, 0)
        assert.equal(result.recoveries.length, 2)
        assert.equal(result.recoveries[0]?.actions[0]?.seq, 1)
        assert.equal(result.recoveries[1]?.actions[0]?.seq, 2)
    })

    it('§5 宿主变更后的快照不重放旧底稿动作', () => {
        const typed = recordCanvasEdit(state(), {kind: 'insert-text', text: 'X'}).state
        const result = receiveCanvasSnapshot(typed, snapshot({
            version: 2,
            lastForeignVersion: 2,
            html: '<p>host</p>',
        }), document({[paragraphId]: 'host'}))

        assert.equal(result.state.visibleDocument.nodes[paragraphId], 'host')
        assert.equal(result.replayedSeqs.length, 0)
        assert.equal(result.recoveries[0]?.reason, 'replay-dependency-failed')
    })

    it('§7 拆块消费保留 ID，后续输入立即指向新块，池耗尽时明确阻止', () => {
        let current = state({reserved: [splitId]})
        const split = recordCanvasEdit(current, {kind: 'split-block'})
        current = split.state
        const typed = recordCanvasEdit(current, {kind: 'insert-text', text: 'X'})
        const exhausted = recordCanvasEdit(typed.state, {kind: 'split-block'})

        assert.equal(split.emittedActions[0]?.newNodeId, splitId)
        assert.deepEqual(split.state.visibleDocument.order, [paragraphId, splitId])
        assert.equal(typed.emittedActions[0]?.targetNodeId, splitId)
        assert.equal(typed.state.visibleDocument.nodes[splitId], 'Xb')
        assert.equal(exhausted.blockedReason, 'reserved-node-id-exhausted')
        assert.deepEqual(split.state.consumedNodeIds, {[splitId]: 1})
    })

    it('§7 连续拆块只消费各自 ID，补充池不重新加入已消费 ID', () => {
        const thirdId = '44444444-4444-7444-8444-444444444444'
        let current = state({reserved: [splitId, thirdId]})
        current = recordCanvasEdit(current, {kind: 'split-block'}).state
        current = recordCanvasEdit(current, {kind: 'split-block'}).state
        current = supplyCanvasReservedNodeIds(current, [splitId, secondId])

        assert.deepEqual(Object.keys(current.consumedNodeIds), [splitId, thirdId])
        assert.deepEqual(current.reservedNodeIds, [secondId])
    })

    it('§4 组合期间只收终态并保留最新快照，提交后挂载再重放组合动作', () => {
        let current = recordCanvasEdit(state(), {kind: 'insert-text', text: 'X'}).state
        current = beginCanvasComposition(current).state
        const accepted = {seq: 1, batchId: 'canvas-batch:1', status: 'accepted' as const, reason: null}
        const held = receiveCanvasSnapshot(current, snapshot({
            version: 2,
            watermark: 1,
            outcomes: [accepted],
            html: '<p>aXb</p>',
        }), document({[paragraphId]: 'aXb'}))

        assert.equal(held.state.mounted.version, 1)
        assert.equal(held.acknowledgeThrough, 1)
        assert.equal(held.state.deferredSnapshot?.snapshot.version, 2)

        const committed = commitCanvasComposition(held.state, '中')
        assert.equal(committed.state.mounted.version, 2)
        assert.equal(committed.state.visibleDocument.nodes[paragraphId], 'aX中b')
        assert.deepEqual(committed.replayedSeqs, [2])
        assert.equal(committed.emittedActions[0]?.kind, 'composition')
    })

    it('§2 取消组合不产生编辑动作，随后接纳组合期间暂存的快照', () => {
        const composing = beginCanvasComposition(state()).state
        const held = receiveCanvasSnapshot(composing, snapshot({version: 2, html: '<p>host</p>'}), document({[paragraphId]: 'host'})).state
        const cancelled = cancelCanvasComposition(held)

        assert.equal(cancelled.emittedActions.length, 0)
        assert.equal(cancelled.state.mounted.version, 2)
        assert.equal(cancelled.state.visibleDocument.nodes[paragraphId], 'host')
    })

    it('§9 最后重放动作之后的作者选区动作优先恢复，方向键同时清除格式', () => {
        let current = updateCanvasStoredMarks(state(), redMarks)
        current = recordCanvasEdit(current, {kind: 'insert-text', text: 'X'}).state
        current = recordCanvasSelectionAction(current, 'direction', {nodeId: paragraphId, from: 0, to: 0}).state
        const result = receiveCanvasSnapshot(current, snapshot({version: 2, html: '<p>ab</p>'}), document())

        assert.deepEqual(result.state.selection, {nodeId: paragraphId, from: 0, to: 0})
        assert.equal(result.state.storedMarks, null)
    })

    it('§8 撤销等待缓冲规范化输入、忽略旧视图选区动作，并在快照落点生成正式动作', () => {
        let current = recordCanvasEdit(state(), {kind: 'undo'}).state
        const buffered = recordCanvasEdit(current, {kind: 'insert-text', text: 'Z'})
        current = buffered.state
        const moved = recordCanvasSelectionAction(current, 'pointer', {nodeId: paragraphId, from: 0, to: 0})
        const settled = receiveCanvasSnapshot(moved.state, snapshot({
            watermark: 1,
            outcomes: [{seq: 1, batchId: 'canvas-batch:1', status: 'accepted', reason: null}],
            landing: {nodeId: paragraphId, offset: 2},
        }), document())

        assert.equal(buffered.emittedActions.length, 0)
        assert.equal(moved.blockedReason, 'undo-wait-selection-ignored')
        assert.equal(settled.emittedActions[0]?.seq, 2)
        assert.deepEqual([settled.emittedActions[0]?.from, settled.emittedActions[0]?.text], [2, 'Z'])
        assert.equal(settled.state.visibleDocument.nodes[paragraphId], 'abZ')
    })

    it('§8 撤销栈为空的同版本快照仍解除等待，取消等待不自动改投', () => {
        let current = recordCanvasEdit(state(), {kind: 'undo'}).state
        current = recordCanvasEdit(current, {kind: 'insert-text', text: 'Z'}).state
        const cancelled = cancelCanvasUndoWait(current)
        const settled = receiveCanvasSnapshot(cancelled.state, snapshot({
            watermark: 1,
            outcomes: [{seq: 1, batchId: 'canvas-batch:1', status: 'accepted', reason: null}],
            landing: {nodeId: paragraphId, offset: 1},
        }), document())

        assert.equal(cancelled.recoveries.length, 1)
        assert.equal(settled.emittedActions.length, 0)
        assert.equal(settled.state.visibleDocument.nodes[paragraphId], 'ab')
        assert.equal(settled.state.undoWait, null)
    })

    it('§6 输入一个字再删除的失败组不提供可插入文字', () => {
        let current = recordCanvasEdit(state(), {
            kind: 'insert-text',
            text: 'X',
            recoveryGroupId: 'failed-pair',
        }).state
        current = recordCanvasEdit(current, {
            kind: 'delete',
            from: 1,
            to: 2,
            expected: 'X',
            recoveryGroupId: 'failed-pair',
        }).state
        const result = receiveCanvasSnapshot(current, snapshot({epoch: 2, version: 1}), document())

        assert.equal(result.recoveries.length, 1)
        assert.equal(result.recoveries[0]?.actions.length, 2)
        assert.equal(result.recoveries[0]?.insertableText, null)
    })

    it('§4/§8 切换文档提升纪元，撤下旧动作并清空标记和保留 ID 池', () => {
        let current = updateCanvasStoredMarks(state({reserved: [splitId]}), redMarks)
        current = recordCanvasEdit(current, {kind: 'insert-text', text: 'X'}).state
        const result = receiveCanvasSnapshot(current, snapshot({
            epoch: 2,
            version: 1,
            html: '<p>next</p>',
            landing: {nodeId: secondId, offset: 0},
        }), document({[secondId]: 'next'}))

        assert.equal(result.recoveries.length, 1)
        assert.equal(result.state.visibleDocument.nodes[secondId], 'next')
        assert.equal(result.state.storedMarks, null)
        assert.deepEqual(result.state.reservedNodeIds, [])
    })

    it('§1 运行时重启建立新桥会话，旧动作进入恢复记录', () => {
        const typed = recordCanvasEdit(state(), {kind: 'insert-text', text: 'X'}).state
        const nextIdentity = {sessionToken: 'session-a', runtimeInstanceId: 'runtime-b'}
        const restarted = restartCanvasInputSession(
            typed,
            nextIdentity,
            snapshot({identity: nextIdentity}),
            document(),
        )
        const late = receiveCanvasSnapshot(restarted.state, snapshot({
            outcomes: [{seq: 1, batchId: 'canvas-batch:1', status: 'accepted', reason: null}],
        }), document())

        assert.equal(restarted.recoveries.length, 1)
        assert.equal(restarted.state.nextSeq, 1)
        assert.equal(late.blockedReason, 'snapshot-bridge-session-mismatch')
        assert.equal(late.state.receivedOutcomes.length, 0)
    })
})
