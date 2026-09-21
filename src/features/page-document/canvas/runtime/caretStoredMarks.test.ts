import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {createCanvasCaretStoredMarksState} from './caretStoredMarks.ts'

const FIRST_NODE = '018f47a2-3b4c-7d5e-8f90-123456789abc'
const SECOND_NODE = '028f47a2-3b4c-7d5e-8f90-123456789abc'

function caret(nodeId = FIRST_NODE, offset = 2) {
    return {nodeId, from: offset, to: offset, expected: '', collapsed: true}
}

function stateWithColor() {
    const state = createCanvasCaretStoredMarksState()
    state.observeSelection(caret())
    assert.equal(state.updateStoredMarks('merge', {
        styleContext: 'mobile',
        values: {color: '#c43c35'},
    }), true)
    return state
}

describe('画布权威光标与待输入标记集', () => {
    it('输入、连续按键与预览重挂恢复光标时持续保留标记', () => {
        const state = stateWithColor()
        state.restoreSelection(caret(FIRST_NODE, 3))
        state.restoreSelection(caret(FIRST_NODE, 4))
        state.restoreSelection(caret(FIRST_NODE, 5))
        assert.deepEqual(state.storedMarks, {
            styleContext: 'mobile',
            values: {color: '#c43c35'},
        })
    })

    it('中文组合在同一节点开始并提交后保留标记供下一个字符使用', () => {
        const state = stateWithColor()
        state.beginComposition(FIRST_NODE)
        state.restoreSelection(caret(FIRST_NODE, 4))
        assert.equal(state.storedMarks?.values.color, '#c43c35')
        state.restoreSelection(caret(FIRST_NODE, 5))
        assert.equal(state.storedMarks?.values.color, '#c43c35')
    })

    it('目标节点变化会清除标记', () => {
        const state = stateWithColor()
        state.observeSelection(caret(SECOND_NODE))
        assert.equal(state.storedMarks, null)
    })

    it('非折叠选区会清除标记', () => {
        const state = stateWithColor()
        state.observeSelection({...caret(), from: 1, to: 3, expected: '文字', collapsed: false})
        assert.equal(state.storedMarks, null)
    })

    it('指针落点会清除标记', () => {
        const state = stateWithColor()
        state.authorPointer()
        assert.equal(state.storedMarks, null)
    })

    it('方向键移动会清除标记', () => {
        const state = stateWithColor()
        state.authorDirection()
        assert.equal(state.storedMarks, null)
    })

    it('组合起点落在别的节点会清除标记', () => {
        const state = stateWithColor()
        state.beginComposition(SECOND_NODE)
        assert.equal(state.storedMarks, null)
    })

    it('显式清除格式会清除标记', () => {
        const state = stateWithColor()
        state.clearStoredMarks()
        assert.equal(state.storedMarks, null)
    })

    it('退出可视编辑会同时清除光标和标记', () => {
        const state = stateWithColor()
        state.exitEditing()
        assert.equal(state.selection, null)
        assert.equal(state.storedMarks, null)
    })
})
