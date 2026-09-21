// 本测试从功能区绑定入口检查实际内核 intent，避免只测试属性序列化函数本身。

import assert from 'node:assert/strict'
import test from 'node:test'
import {utf16Range, type ComponentHandle} from '../domain/kernel/index.ts'
import {
    createRibbonPropertyRequest,
    createRibbonTextRangePropertyRequest,
    RIBBON_PARAGRAPH_INDENT_LEVELS,
    resolveRibbonFontScope,
    ribbonCaretInspectionRange,
    ribbonFontControlsAvailable,
    ribbonInlineDisplayValue,
    ribbonParagraphIndentLevel,
    ribbonParagraphIndentStep,
    toggleRibbonTextDecoration,
} from '../../document-editor/visual/ribbonKernelBinding.ts'
import {refreshCanvasTextSelection} from '../canvas/runtime/inputPolicy.ts'

const NODE_ID = '11111111-1111-4111-8111-111111111111'

function handle(): ComponentHandle {
    return {
        handleId: 'handle:toolbar' as ComponentHandle['handleId'],
        nodeId: NODE_ID as ComponentHandle['nodeId'],
        instanceId: 'instance:toolbar',
        kind: 'paragraph',
        origin: {
            kind: 'author',
            source: {scope: 'entry', file: 'article.html'},
            range: utf16Range(0, 1),
        },
        analysisStamp: 'analysis:toolbar' as ComponentHandle['analysisStamp'],
    }
}

test('文本块对齐经功能区绑定发出节点规则 intent', () => {
    const alignment = createRibbonPropertyRequest(NODE_ID, 'text-align', {kind: 'choice', value: 'center'}, 'mobile')
    const bindings = new Map([[NODE_ID, handle()]])
    const alignmentIntent = alignment.createIntents(bindings)
    assert.equal(alignmentIntent[0]?.property, 'text-align')
    assert.deepEqual(alignmentIntent[0]?.action, {kind: 'set-value', value: 'center'})
})

test('文本块缩进只沿固定档位增减并写入当前断点', () => {
    assert.deepEqual(RIBBON_PARAGRAPH_INDENT_LEVELS, [0, 1, 2, 3])
    assert.deepEqual(['0', '1rem', '2rem', '3rem'].map(ribbonParagraphIndentLevel), [0, 1, 2, 3])
    assert.equal(ribbonParagraphIndentLevel('1.5rem'), null)
    assert.equal(ribbonParagraphIndentStep('0', 'decrease'), null)
    assert.equal(ribbonParagraphIndentStep('3rem', 'increase'), null)
    assert.deepEqual(ribbonParagraphIndentStep('1rem', 'increase'), {
        kind: 'numeric', value: 2, unit: 'rem', numberText: '2',
    })
    assert.deepEqual(ribbonParagraphIndentStep('2rem', 'decrease'), {
        kind: 'numeric', value: 1, unit: 'rem', numberText: '1',
    })

    const next = ribbonParagraphIndentStep('1rem', 'increase')
    assert.ok(next)
    const intent = createRibbonPropertyRequest(
        NODE_ID,
        'margin-inline-start',
        next,
        'desktop',
    ).createIntents(new Map([[NODE_ID, handle()]]))[0]
    assert.equal(intent?.kind, 'edit-property')
    if (intent?.kind !== 'edit-property') return
    assert.equal(intent.property, 'margin-inline-start')
    assert.deepEqual(intent.action, {kind: 'set-value', value: '2rem'})
    assert.deepEqual(intent.destination, {
        scope: 'entry',
        channel: {kind: 'conditional-rule', context: 'desktop'},
    })
})

test('字体组行高档位写入当前节点受管规则', () => {
    const intent = createRibbonPropertyRequest(
        NODE_ID,
        'line-height',
        {kind: 'numeric', value: 1.8, unit: '', numberText: '1.8'},
        'mobile',
    ).createIntents(new Map([[NODE_ID, handle()]]))[0]
    assert.equal(intent?.kind, 'edit-property')
    if (intent?.kind !== 'edit-property') return
    assert.equal(intent.property, 'line-height')
    assert.deepEqual(intent.action, {kind: 'set-value', value: '1.8'})
    assert.deepEqual(intent.destination, {scope: 'entry', channel: {kind: 'base-rule'}})
})

test('字体功能区的六项写入都只产生 inline 标记', () => {
    const range = {
        nodeId: NODE_ID,
        from: 1,
        to: 3,
        expected: '文字',
    } as const
    const values = {
        'background-color': '#eeeeee',
        color: '#334455',
        'font-size': '18px',
        'font-style': 'italic',
        'font-weight': '700',
        'text-decoration-line': 'underline',
    } as const
    for (const styleContext of ['mobile', 'desktop'] as const) {
        for (const [property, value] of Object.entries(values)) {
            const request = createRibbonTextRangePropertyRequest(
                range,
                property as keyof typeof values,
                value,
                styleContext,
                () => `inline-request-${styleContext}-${property}`,
            )
            const intent = request.createIntents(new Map([[NODE_ID, handle()]]))[0]
            assert.equal(intent?.kind, 'edit-property')
            if (intent?.kind !== 'edit-property') continue
            assert.deepEqual(intent.target, {
                kind: 'text-range',
                component: handle(),
                range: utf16Range(1, 3),
                expected: '文字',
            })
            assert.equal(intent.property, property)
            assert.deepEqual(intent.action, {kind: 'set-value', value})
            assert.equal(intent.readContext.viewport, styleContext)
            assert.deepEqual(intent.destination, {scope: 'entry', channel: {kind: 'inline'}})
        }
    }
})

test('字体组在折叠光标下使用待输入作用域，只在没有文本落点时停用', () => {
    const caret = {nodeId: NODE_ID, from: 2, to: 2, expected: ''} as const
    const selection = {nodeId: NODE_ID, from: 1, to: 3, expected: '文字'} as const
    assert.equal(resolveRibbonFontScope(caret), 'typing')
    assert.equal(resolveRibbonFontScope(selection), 'selection')
    assert.equal(resolveRibbonFontScope(null), 'inactive')
    assert.equal(ribbonFontControlsAvailable(true, caret), true)
    assert.equal(ribbonFontControlsAvailable(true, selection), true)
    assert.equal(ribbonFontControlsAvailable(true, null), false)
    assert.equal(ribbonFontControlsAvailable(false, caret), false)
})

test('草稿探查滞后时待输入标记仍是字体组的显示值', () => {
    assert.equal(ribbonInlineDisplayValue('typing', null, '18px'), '18px')
    assert.equal(ribbonInlineDisplayValue('typing', '16px', '18px'), '18px')
    assert.equal(ribbonInlineDisplayValue('typing', '16px', undefined), '16px')
    assert.equal(ribbonInlineDisplayValue('selection', '#334455', '#c43c35'), '#334455')
})

test('折叠光标优先用前一个完整字符回读文字格式并兼容代理对', () => {
    assert.deepEqual(
        ribbonCaretInspectionRange({nodeId: NODE_ID, from: 3, to: 3, expected: ''}, 'A😀B'),
        {nodeId: NODE_ID, from: 1, to: 3, expected: '😀'},
    )
    assert.deepEqual(
        ribbonCaretInspectionRange({nodeId: NODE_ID, from: 0, to: 0, expected: ''}, '😀B'),
        {nodeId: NODE_ID, from: 0, to: 2, expected: '😀'},
    )
    assert.equal(
        ribbonCaretInspectionRange({nodeId: NODE_ID, from: 0, to: 0, expected: ''}, ''),
        null,
    )
})

test('所选文字删除线与下划线独立切换并写入同一 inline 装饰声明', () => {
    const range = {nodeId: NODE_ID, from: 0, to: 2, expected: '文字'} as const
    const withBoth = toggleRibbonTextDecoration('underline', 'line-through')
    assert.equal(withBoth, 'underline line-through')
    assert.equal(toggleRibbonTextDecoration(withBoth, 'underline'), 'line-through')
    assert.equal(toggleRibbonTextDecoration(withBoth, 'line-through'), 'underline')

    const intent = createRibbonTextRangePropertyRequest(
        range,
        'text-decoration-line',
        withBoth,
        'mobile',
        () => 'inline-decoration-request',
    ).createIntents(new Map([[NODE_ID, handle()]]))[0]
    assert.equal(intent?.kind, 'edit-property')
    if (intent?.kind !== 'edit-property') return
    assert.deepEqual(intent.action, {kind: 'set-value', value: 'underline line-through'})
    assert.deepEqual(intent.destination, {scope: 'entry', channel: {kind: 'inline'}})
})

test('写回重采集后同一文字选区可连续发出两次行内样式请求', () => {
    const original = {
        nodeId: NODE_ID,
        from: 1,
        to: 3,
        expected: '旧值',
        collapsed: false,
    } as const
    const firstRange = refreshCanvasTextSelection(original, 'A文字B')
    const secondRange = refreshCanvasTextSelection(firstRange, 'A文字B')
    assert.ok(firstRange && secondRange)
    const bindings = new Map([[NODE_ID, handle()]])
    const first = createRibbonTextRangePropertyRequest(
        firstRange,
        'font-weight',
        '700',
        'mobile',
        () => 'inline-request-first',
    ).createIntents(bindings)[0]
    const second = createRibbonTextRangePropertyRequest(
        secondRange,
        'font-weight',
        '400',
        'mobile',
        () => 'inline-request-second',
    ).createIntents(bindings)[0]
    assert.equal(first?.kind, 'edit-property')
    assert.equal(second?.kind, 'edit-property')
    if (first?.kind !== 'edit-property' || second?.kind !== 'edit-property') return
    assert.equal(first.target.kind, 'text-range')
    assert.equal(second.target.kind, 'text-range')
    if (first.target.kind !== 'text-range' || second.target.kind !== 'text-range') return
    assert.equal(first.target.expected, '文字')
    assert.equal(second.target.expected, '文字')
    assert.deepEqual(second.action, {kind: 'set-value', value: '400'})
})
