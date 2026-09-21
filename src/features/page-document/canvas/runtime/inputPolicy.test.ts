// 本测试固定 beforeinput 白名单、组合期一次提交和渲染延迟，不依赖浏览器修改 DOM。

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {
    canvasBeforeInputDecision,
    canvasBlockedInputDetail,
    canvasEnterIntent,
    canvasKeyboardIntent,
    canvasPasteDecision,
    createCanvasCompositionTracker,
    expandCollapsedCanvasDeletion,
    isCanvasSplittableKind,
    refreshCanvasTextSelection,
    shouldDeferCanvasRender,
} from './inputPolicy.ts'
import {
    CANVAS_INPUT_TYPES,
    PAGE_DOCUMENT_CANVAS_CHANNEL,
    PAGE_DOCUMENT_CANVAS_VERSION,
    type CanvasInputIntentMessage,
} from '../protocol/index.ts'
import type {ComponentHandle} from '../../domain/kernel/index.ts'
import {createCanvasInputKernelOperation} from '../../application/canvasInputOperation.ts'

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
        'deleteContentBackward',
        'deleteContentForward',
        'deleteWordBackward',
        'deleteWordForward',
        'deleteSoftLineBackward',
        'deleteSoftLineForward',
        'deleteHardLineBackward',
        'deleteHardLineForward',
        'deleteByCut',
        'deleteContent',
    ]) {
        assert.equal(canvasBeforeInputDecision({editingEnabled: true, isComposing: false, inputType}), 'submit')
        assert.equal(canvasBeforeInputDecision({editingEnabled: true, isComposing: true, inputType}), 'block')
    }
    assert.equal(canvasBeforeInputDecision({
        editingEnabled: true,
        isComposing: false,
        inputType: 'insertFromPaste',
    }), 'paste-owned')
    assert.equal(canvasBeforeInputDecision({
        editingEnabled: true,
        isComposing: true,
        inputType: 'insertFromPaste',
    }), 'block')
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

test('非折叠选区粘贴含空行文本只提交一次替换且不分段', () => {
    const submittedBy: string[] = []
    if (canvasBeforeInputDecision({
        editingEnabled: true,
        isComposing: false,
        inputType: 'insertFromPaste',
    }) === 'submit') submittedBy.push('beforeinput')
    if (canvasPasteDecision({
        editingEnabled: true,
        editableTarget: true,
        isComposing: false,
        selectionValid: true,
        plainText: '第一行\n\n第二行',
    }).kind === 'submit') submittedBy.push('paste')

    const messages = submittedBy.map((_, index): CanvasInputIntentMessage => ({
        channel: PAGE_DOCUMENT_CANVAS_CHANNEL,
        version: PAGE_DOCUMENT_CANVAS_VERSION,
        sessionToken: 'a'.repeat(64),
        sequence: index + 1,
        type: 'input-intent',
        intentId: `11111111-1111-7111-8111-11111111111${index}`,
        nodeId: snapshot.nodeId,
        inputType: 'insertFromPaste',
        from: 1,
        to: 3,
        expected: '旧文',
        text: '第一行\n\n第二行',
    }))
    const handle = {nodeId: snapshot.nodeId} as ComponentHandle
    const intents = createCanvasInputKernelOperation(
        messages,
        'canvas-input-history:paste-single-paragraph',
        'paragraph',
    ).request.createIntents(new Map([[snapshot.nodeId, handle]]))

    assert.deepEqual(submittedBy, ['paste'])
    assert.equal(intents.filter(intent => intent.kind === 'replace-text').length, 1)
    assert.equal(intents.filter(intent => intent.kind === 'split-text-block').length, 0)
    assert.equal(intents[0]?.kind === 'replace-text' ? intents[0].text : null, '第一行\n\n第二行')
})

test('分段只开放 paragraph、heading 与 list-item', () => {
    assert.equal(isCanvasSplittableKind('paragraph'), true)
    assert.equal(isCanvasSplittableKind('heading'), true)
    assert.equal(isCanvasSplittableKind('list-item'), true)
    assert.equal(isCanvasSplittableKind('table-cell'), false)
})

test('文本块 Enter 换行、Shift+Enter 拆块，且不可拆分节点的两个变体都换行', () => {
    assert.deepEqual(canvasEnterIntent('paragraph', false), {inputType: 'insertLineBreak', text: '\n'})
    assert.deepEqual(canvasEnterIntent('paragraph', true), {inputType: 'insertParagraph', text: ''})
    assert.deepEqual(canvasEnterIntent('table-cell', false), {inputType: 'insertLineBreak', text: '\n'})
    assert.deepEqual(canvasEnterIntent('table-cell', true), {inputType: 'insertLineBreak', text: '\n'})
})

test('非折叠选区按 Enter 用块内换行替换选中文字', () => {
    const enter = canvasEnterIntent('paragraph', false)
    const message: CanvasInputIntentMessage = {
        channel: PAGE_DOCUMENT_CANVAS_CHANNEL,
        version: PAGE_DOCUMENT_CANVAS_VERSION,
        sessionToken: 'a'.repeat(64),
        sequence: 1,
        type: 'input-intent',
        intentId: '21111111-1111-7111-8111-111111111111',
        nodeId: snapshot.nodeId,
        inputType: enter.inputType,
        from: 1,
        to: 3,
        expected: '旧文',
        text: enter.text,
    }
    const handle = {nodeId: snapshot.nodeId} as ComponentHandle
    const intents = createCanvasInputKernelOperation(
        [message],
        'canvas-input-history:enter-selection',
        'paragraph',
    ).request.createIntents(new Map([[snapshot.nodeId, handle]]))

    assert.equal(intents.filter(intent => intent.kind === 'replace-text').length, 1)
    assert.equal(intents.filter(intent => intent.kind === 'split-text-block').length, 0)
})

test('画布组合键只产生一次宿主意图并区分保存、查找与历史操作', () => {
    const keyboard = (key: string, overrides: Partial<Parameters<typeof canvasKeyboardIntent>[0]> = {}) =>
        canvasKeyboardIntent({
            key,
            metaKey: true,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            isComposing: false,
            defaultPrevented: false,
            ...overrides,
        })
    assert.equal(keyboard('s'), 'save')
    assert.equal(keyboard('f'), 'find')
    assert.equal(keyboard('z'), 'undo')
    assert.equal(keyboard('z', {shiftKey: true}), 'redo')
    assert.equal(keyboard('y', {metaKey: false, ctrlKey: true}), 'redo')
    assert.equal(keyboard('s', {altKey: true}), null)
    assert.equal(keyboard('s', {isComposing: true}), null)
    assert.equal(keyboard('s', {defaultPrevented: true}), null)
})

test('写回后按当前语义文本刷新选区 expected，瞬时采集失败仍可使用上一份范围', () => {
    const selected = {...snapshot, from: 1, to: 3, expected: '旧值', collapsed: false}
    assert.deepEqual(refreshCanvasTextSelection(selected, 'A文字B'), {
        ...selected,
        expected: '文字',
    })
    assert.equal(refreshCanvasTextSelection(selected, null), null)
    assert.equal(refreshCanvasTextSelection({...selected, to: 8}, 'A文字B'), null)
})

test('运行时把快捷键、Enter、指针结束与写回重采集接进真实监听链路', () => {
    const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
    assert.match(source, /const keyboardIntent = canvasKeyboardIntent\(event\)[\s\S]*?type: 'history-intent', action: keyboardIntent/u)
    assert.match(source, /keyboardIntent === 'find'[\s\S]*?type: 'find-intent', action: 'open'/u)
    assert.match(source, /const intent = canvasEnterIntent\(node\.getAttribute\('data-fc-node-kind'\), event\.shiftKey\)/u)
    assert.match(source, /intent\.inputType === 'insertParagraph' && !snapshot\.collapsed/u)
    assert.match(source, /addEventListener\('pointerup', reportSettledTextSelection\)/u)
    assert.match(source, /addEventListener\('pointercancel', reportSettledTextSelection\)/u)
    assert.match(source, /reportTextSelection\(restoredSelection, true\)/u)
    assert.match(source, /selectionchange[\s\S]*?reportTextSelection\(activeTextSelection\)/u)
    assert.match(source, /selectedNodeId !== normalizedNodeId[\s\S]*?getSelection\(\)\?\.removeAllRanges\(\)[\s\S]*?focusedNode\.blur\(\)/u)
    const blurHandler = source.slice(source.indexOf("window.addEventListener('blur'"), source.indexOf("installInputListeners()"))
    assert.doesNotMatch(blurHandler, /clearTextSelection\(\)/u)
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

test('剪切与整行删除进入受控替换，缺失 target range 时按正确行边界扩展', () => {
    const selected = {...snapshot, from: 4, to: 7, expected: 'def', collapsed: false}
    assert.deepEqual(expandCollapsedCanvasDeletion('abc\ndef\nghi', selected, 'deleteByCut'), selected)

    const caret = {...snapshot, from: 6, to: 6}
    assert.deepEqual(expandCollapsedCanvasDeletion('abc\ndef\nghi', caret, 'deleteHardLineBackward'), {
        ...caret,
        from: 4,
        expected: 'de',
        collapsed: false,
    })
    assert.deepEqual(expandCollapsedCanvasDeletion('abc\ndef\nghi', {...snapshot, from: 5, to: 5}, 'deleteHardLineForward'), {
        ...snapshot,
        from: 5,
        to: 7,
        expected: 'ef',
        collapsed: false,
    })

    const visualLine = {...snapshot, from: 5, to: 6, expected: 'e', collapsed: false}
    assert.deepEqual(
        expandCollapsedCanvasDeletion('abc\ndef\nghi', caret, 'deleteSoftLineBackward', visualLine),
        visualLine,
    )
})

test('未白名单的输入类型仍拒绝并保留原因', () => {
    assert.equal(canvasBeforeInputDecision({
        editingEnabled: true,
        isComposing: false,
        inputType: 'deleteEntireDocument',
    }), 'block')
    assert.deepEqual(canvasBlockedInputDetail('deleteEntireDocument', 'unsupported-input-type', snapshot.nodeId), {
        inputType: 'deleteEntireDocument',
        reason: 'unsupported-input-type',
        nodeId: snapshot.nodeId,
    })
})
