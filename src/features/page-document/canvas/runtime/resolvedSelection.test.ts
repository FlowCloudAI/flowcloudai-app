import assert from 'node:assert/strict'
import test from 'node:test'
import {
    settleCanvasInputRender,
    restoreCanvasResolvedSelection,
    type CanvasResolvedSelection,
} from './resolvedSelection.ts'
import type {CanvasRenderCommand} from '../protocol/index.ts'

const selection: CanvasResolvedSelection = {
    nodeId: '11111111-1111-7111-8111-111111111111',
    offset: 0,
}

test('拆块回执先于新节点 DOM 到达时保留落点，后续渲染确实聚焦新块', () => {
    let focused = 0
    const staleRender = restoreCanvasResolvedSelection(selection, () => null, () => false)
    assert.deepEqual(staleRender, {restoredSelection: null, pendingSelection: selection})
    assert.equal(focused, 0)

    const currentRender = restoreCanvasResolvedSelection(
        staleRender.pendingSelection,
        () => ({focus: () => { focused += 1 }}),
        snapshot => snapshot.nodeId === selection.nodeId && snapshot.from === 0,
    )
    assert.equal(focused, 1)
    assert.deepEqual(currentRender, {
        restoredSelection: {
            nodeId: selection.nodeId,
            from: 0,
            to: 0,
            expected: '',
            collapsed: true,
        },
        pendingSelection: null,
    })
})

test('新节点已挂载但偏移尚不可恢复时仍保留落点', () => {
    const result = restoreCanvasResolvedSelection(
        selection,
        () => ({focus: () => undefined}),
        () => false,
    )
    assert.deepEqual(result, {restoredSelection: null, pendingSelection: selection})
})

test('成功回执丢弃暂存预览：它早于这次提交，挂载会撤回刚输入的文字并让落点越界', () => {
    const render = {type: 'render', requestId: 'render:1'} as CanvasRenderCommand
    const applied: Array<{render: CanvasRenderCommand; selection: CanvasResolvedSelection | null}> = []
    const applyRender = (
        nextRender: CanvasRenderCommand,
        nextSelection: CanvasResolvedSelection | null,
    ) => applied.push({render: nextRender, selection: nextSelection})

    assert.equal(settleCanvasInputRender(render, false, null, applyRender), 'discarded')
    assert.deepEqual(applied, [])
    assert.equal(settleCanvasInputRender(null, false, null, applyRender), 'none')
    assert.deepEqual(applied, [])
})

test('拒绝回执挂载宿主补发的回滚预览，并把光标放回最早被拒输入的起点', () => {
    const render = {type: 'render', requestId: 'render:rollback'} as CanvasRenderCommand
    const rollback: CanvasResolvedSelection = {nodeId: selection.nodeId, offset: 99}
    const applied: Array<{render: CanvasRenderCommand; selection: CanvasResolvedSelection | null}> = []
    const applyRender = (
        nextRender: CanvasRenderCommand,
        nextSelection: CanvasResolvedSelection | null,
    ) => applied.push({render: nextRender, selection: nextSelection})

    assert.equal(settleCanvasInputRender(render, true, rollback, applyRender), 'applied')
    assert.deepEqual(applied, [{render, selection: rollback}])
})
