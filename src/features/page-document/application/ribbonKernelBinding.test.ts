// 本测试从功能区绑定入口检查实际内核 intent，避免只测试属性序列化函数本身。

import assert from 'node:assert/strict'
import test from 'node:test'
import {utf16Range, type ComponentHandle} from '../domain/kernel/index.ts'
import {
    createRibbonPropertyRequest,
    createRibbonTextRangePropertyRequest,
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

test('工具栏字号绑定发出受管 font-size 属性 intent', () => {
    const request = createRibbonPropertyRequest(NODE_ID, 'font-size', {
        kind: 'numeric',
        value: 20,
        unit: 'px',
        numberText: '20',
    }, 'mobile')
    const intent = request.createIntents(new Map([[NODE_ID, handle()]]))
    assert.equal(request.nodeIds[0], NODE_ID)
    assert.equal(intent[0]?.kind, 'edit-property')
    assert.equal(intent[0]?.property, 'font-size')
    assert.deepEqual(intent[0]?.action, {kind: 'set-value', value: '20px'})
})

test('工具栏加粗与对齐分别绑定受限字重和 text-align intent', () => {
    const weight = createRibbonPropertyRequest(NODE_ID, 'font-weight', {kind: 'font-weight', value: '700'}, 'mobile')
    const alignment = createRibbonPropertyRequest(NODE_ID, 'text-align', {kind: 'choice', value: 'center'}, 'mobile')
    const bindings = new Map([[NODE_ID, handle()]])
    const weightIntent = weight.createIntents(bindings)
    const alignmentIntent = alignment.createIntents(bindings)
    assert.deepEqual(weightIntent[0]?.action, {kind: 'set-value', value: '700'})
    assert.equal(alignmentIntent[0]?.property, 'text-align')
    assert.deepEqual(alignmentIntent[0]?.action, {kind: 'set-value', value: 'center'})
})

test('字体组的节点文字与节点底色写入当前节点的受管规则', () => {
    const bindings = new Map([[NODE_ID, handle()]])
    const color = createRibbonPropertyRequest(
        NODE_ID,
        'color',
        {kind: 'color', value: '#334455', opacity: 100},
        'mobile',
    ).createIntents(bindings)[0]
    const background = createRibbonPropertyRequest(
        NODE_ID,
        'background-color',
        {kind: 'color', value: 'var(--fc-entry-surface)', opacity: 100},
        'desktop',
    ).createIntents(bindings)[0]

    assert.equal(color?.kind, 'edit-property')
    assert.equal(background?.kind, 'edit-property')
    if (color?.kind !== 'edit-property' || background?.kind !== 'edit-property') return
    assert.equal(color.property, 'color')
    assert.deepEqual(color.action, {kind: 'set-value', value: '#334455'})
    assert.deepEqual(color.destination, {scope: 'entry', channel: {kind: 'base-rule'}})
    assert.equal(background.property, 'background-color')
    assert.deepEqual(background.action, {kind: 'set-value', value: 'var(--fc-entry-surface)'})
    assert.deepEqual(background.destination, {
        scope: 'entry',
        channel: {kind: 'conditional-rule', context: 'desktop'},
    })
})

test('断点切换经功能区绑定写入移动基础与桌面条件通道', () => {
    const bindings = new Map([[NODE_ID, handle()]])
    const mobile = createRibbonPropertyRequest(
        NODE_ID,
        'font-size',
        {kind: 'numeric', value: 16, unit: 'px', numberText: '16'},
        'mobile',
    ).createIntents(bindings)[0]
    const desktop = createRibbonPropertyRequest(
        NODE_ID,
        'font-size',
        {kind: 'numeric', value: 20, unit: 'px', numberText: '20'},
        'desktop',
    ).createIntents(bindings)[0]
    assert.equal(mobile?.kind, 'edit-property')
    assert.equal(desktop?.kind, 'edit-property')
    if (mobile?.kind !== 'edit-property' || desktop?.kind !== 'edit-property') return
    assert.deepEqual(mobile.readContext.interactions, {hover: false, focusWithin: false})
    assert.equal(mobile.readContext.viewport, 'mobile')
    assert.deepEqual(mobile.destination, {scope: 'entry', channel: {kind: 'base-rule'}})
    assert.equal(desktop.readContext.viewport, 'desktop')
    assert.deepEqual(desktop.destination, {scope: 'entry', channel: {kind: 'conditional-rule', context: 'desktop'}})
})

test('行内样式功能区按当前档位读取且始终写入 inline 通道', () => {
    const range = {
        nodeId: NODE_ID,
        from: 1,
        to: 3,
        expected: '文字',
    } as const
    for (const styleContext of ['mobile', 'desktop'] as const) {
        const request = createRibbonTextRangePropertyRequest(
            range,
            'font-weight',
            '700',
            styleContext,
            () => `inline-request-${styleContext}`,
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
        assert.deepEqual(intent.action, {kind: 'set-value', value: '700'})
        assert.equal(intent.readContext.viewport, styleContext)
        assert.deepEqual(intent.destination, {scope: 'entry', channel: {kind: 'inline'}})
    }
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
