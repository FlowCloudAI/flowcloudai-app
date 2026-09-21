import assert from 'node:assert/strict'
import test from 'node:test'
import {
    restoreCanvasResolvedSelection,
    type CanvasResolvedSelection,
} from './resolvedSelection.ts'

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
