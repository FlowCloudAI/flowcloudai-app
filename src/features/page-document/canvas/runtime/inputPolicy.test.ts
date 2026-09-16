// 本测试固定 beforeinput 白名单、组合期一次提交和渲染延迟，不依赖浏览器修改 DOM。

import assert from 'node:assert/strict'
import test from 'node:test'
import {
    canvasBeforeInputDecision,
    canvasBlockedInputDetail,
    canvasPasteDecision,
    createCanvasCompositionTracker,
    expandCollapsedCanvasDeletion,
    isCanvasSplittableKind,
    shouldDeferCanvasRender,
} from './inputPolicy.ts'
import {CANVAS_INPUT_TYPES} from '../protocol/index.ts'

const snapshot = {
    nodeId: '018f47a2-3b4c-7d5e-8f90-123456789abc',
    from: 2,
    to: 2,
    expected: '',
    collapsed: true,
}

test('未收到开启命令时不处理输入，开启后只提交受控 beforeinput', () => {
    assert.equal(canvasBeforeInputDecision({editingEnabled: false, isComposing: false, inputType: 'insertText'}), 'ignore')
    for (const inputType of [
        'insertText',
        'insertReplacementText',
        'insertParagraph',
        'insertLineBreak',
        'insertFromPaste',
        'deleteContentBackward',
        'deleteContentForward',
        'deleteWordBackward',
        'deleteWordForward',
    ]) {
        assert.equal(canvasBeforeInputDecision({editingEnabled: true, isComposing: false, inputType}), 'submit')
        assert.equal(canvasBeforeInputDecision({editingEnabled: true, isComposing: true, inputType}), 'block')
    }
    for (const inputType of ['insertFromDrop', 'formatBold', 'historyUndo']) {
        assert.equal(canvasBeforeInputDecision({editingEnabled: true, isComposing: false, inputType}), 'block')
        assert.equal(canvasBeforeInputDecision({editingEnabled: true, isComposing: true, inputType}), 'block')
    }
    assert.deepEqual(canvasBlockedInputDetail('insertParagraph', 'unsupported-input-type', snapshot.nodeId), {
        inputType: 'insertParagraph',
        reason: 'unsupported-input-type',
        nodeId: snapshot.nodeId,
    })
})

test('纯文本粘贴在未编辑或组合期拒绝提交，并规范换行与大小上限', () => {
    assert.deepEqual(canvasPasteDecision({
        editingEnabled: false,
        editableTarget: true,
        isComposing: false,
        selectionValid: true,
        plainText: '正文',
    }), {kind: 'ignore'})
    assert.deepEqual(canvasPasteDecision({
        editingEnabled: true,
        editableTarget: true,
        isComposing: true,
        selectionValid: true,
        plainText: '正文',
    }), {kind: 'block', reason: 'unsupported-input-type'})
    assert.deepEqual(canvasPasteDecision({
        editingEnabled: true,
        editableTarget: true,
        isComposing: false,
        selectionValid: false,
        plainText: '正文',
    }), {kind: 'block', reason: 'invalid-selection'})
    assert.deepEqual(canvasPasteDecision({
        editingEnabled: true,
        editableTarget: true,
        isComposing: false,
        selectionValid: true,
        plainText: '第一行\r\n第二行',
    }), {kind: 'submit', text: '第一行\n第二行'})
    assert.deepEqual(canvasPasteDecision({
        editingEnabled: true,
        editableTarget: true,
        isComposing: false,
        selectionValid: true,
        plainText: '你'.repeat(65_537),
    }), {kind: 'block', reason: 'input-too-large'})
})

test('分段只开放 paragraph、heading 与 list-item', () => {
    assert.equal(isCanvasSplittableKind('paragraph'), true)
    assert.equal(isCanvasSplittableKind('heading'), true)
    assert.equal(isCanvasSplittableKind('list-item'), true)
    assert.equal(isCanvasSplittableKind('table-cell'), false)
})

test('四种组合专用 beforeinput 不依赖当前 composing 状态且 WebKit 类型不进入提交白名单', () => {
    const compositionInputTypes = [
        'insertCompositionText',
        'deleteCompositionText',
        'insertFromComposition',
        'deleteByComposition',
    ]
    for (const inputType of compositionInputTypes) {
        assert.equal(canvasBeforeInputDecision({editingEnabled: true, isComposing: true, inputType}), 'native-composition')
        assert.equal(canvasBeforeInputDecision({editingEnabled: true, isComposing: false, inputType}), 'native-composition')
    }
    const submitTypes = new Set<string>(CANVAS_INPUT_TYPES)
    assert.equal(submitTypes.has('insertFromComposition'), false)
    assert.equal(submitTypes.has('deleteByComposition'), false)
})

test('组合期间延迟宿主渲染', () => {
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
