import assert from 'node:assert/strict'
import test from 'node:test'
import {
    applyPendingCanvasInputRender,
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

test('带可信落点的接受回执重挂一次待渲染预览，无落点的普通输入保留乐观 DOM', () => {
    const render = {type: 'render', requestId: 'render:1'} as CanvasRenderCommand
    const applied: Array<{render: CanvasRenderCommand; selection: CanvasResolvedSelection | null}> = []
    const applyRender = (
        nextRender: CanvasRenderCommand,
        nextSelection: CanvasResolvedSelection | null,
    ) => applied.push({render: nextRender, selection: nextSelection})

    assert.equal(applyPendingCanvasInputRender(render, false, selection, applyRender), true)
    assert.deepEqual(applied, [{render, selection}])

    applied.length = 0
    assert.equal(applyPendingCanvasInputRender(render, false, null, applyRender), false)
    assert.deepEqual(applied, [])
})
