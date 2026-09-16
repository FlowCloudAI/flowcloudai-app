// 本测试固定 beforeinput 白名单、组合期一次提交和渲染延迟，不依赖浏览器修改 DOM。

import assert from 'node:assert/strict'
import test from 'node:test'
import {
    canvasBeforeInputDecision,
    canvasBlockedInputDetail,
    createCanvasCompositionTracker,
    expandCollapsedCanvasDeletion,
    shouldDeferCanvasRender,
} from './inputPolicy.ts'

const snapshot = {
    nodeId: '018f47a2-3b4c-7d5e-8f90-123456789abc',
    from: 2,
    to: 2,
    expected: '',
    collapsed: true,
}

test('未收到开启命令时不处理输入，开启后只提交本批六种 beforeinput', () => {
    assert.equal(canvasBeforeInputDecision({editingEnabled: false, isComposing: false, inputType: 'insertText'}), 'ignore')
    for (const inputType of [
        'insertText',
        'insertReplacementText',
        'deleteContentBackward',
        'deleteContentForward',
        'deleteWordBackward',
        'deleteWordForward',
    ]) {
        assert.equal(canvasBeforeInputDecision({editingEnabled: true, isComposing: false, inputType}), 'submit')
    }
    for (const inputType of ['insertParagraph', 'insertLineBreak', 'insertFromPaste', 'insertFromDrop', 'formatBold', 'historyUndo']) {
        assert.equal(canvasBeforeInputDecision({editingEnabled: true, isComposing: false, inputType}), 'block')
    }
    assert.deepEqual(canvasBlockedInputDetail('insertParagraph', 'unsupported-input-type', snapshot.nodeId), {
        inputType: 'insertParagraph',
        reason: 'unsupported-input-type',
        nodeId: snapshot.nodeId,
    })
})

test('组合期间只让浏览器维护中间态并延迟宿主渲染', () => {
    assert.equal(canvasBeforeInputDecision({editingEnabled: true, isComposing: true, inputType: 'insertCompositionText'}), 'native-composition')
    assert.equal(canvasBeforeInputDecision({editingEnabled: true, isComposing: true, inputType: 'deleteCompositionText'}), 'native-composition')
    assert.equal(canvasBeforeInputDecision({editingEnabled: true, isComposing: true, inputType: 'insertParagraph'}), 'block')
    assert.equal(shouldDeferCanvasRender(true, 0), true)
    assert.equal(shouldDeferCanvasRender(false, 1), true)
    assert.equal(shouldDeferCanvasRender(false, 0), false)
})

test('compositionstart 到多次中间态后 compositionend 只产出一次最终提交，取消不留提交', () => {
    const tracker = createCanvasCompositionTracker()
    assert.equal(tracker.begin(snapshot), true)
    assert.equal(tracker.begin({...snapshot, from: 3, to: 3}), false)
    assert.equal(tracker.isComposing, true)
    assert.deepEqual(tracker.finish('中文'), {snapshot, text: '中文'})
    assert.equal(tracker.finish('重复'), null)
    assert.equal(tracker.isComposing, false)

    assert.equal(tracker.begin(snapshot), true)
    assert.equal(tracker.finish(''), null)
    assert.equal(tracker.isComposing, false)
})

test('折叠删除不会把 UTF-16 代理对拆开', () => {
    const afterEmoji = {...snapshot, from: 3, to: 3}
    const backward = expandCollapsedCanvasDeletion('A😀B', afterEmoji, 'deleteContentBackward')
    assert.deepEqual(backward, {...afterEmoji, from: 1, expected: '😀', collapsed: false})
    const forward = expandCollapsedCanvasDeletion(
        'A😀B',
        {...snapshot, from: 1, to: 1},
        'deleteContentForward',
    )
    assert.deepEqual(forward, {nodeId: snapshot.nodeId, from: 1, to: 3, expected: '😀', collapsed: false})
})
