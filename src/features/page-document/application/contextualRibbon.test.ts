// 本测试从上下文功能区实际使用的请求构造入口固定图片、结构与档位写回，不创建第二套路径。
import assert from 'node:assert/strict'
import test from 'node:test'
import {utf16Range, type ComponentHandle} from '../domain/kernel/index.ts'
import {createImageReplacementRequest} from './imageAssetEditing.ts'
import type {ManagedImageDescription} from './imageSemanticEditing.ts'
import {createRibbonPropertyRequest} from '../../document-editor/visual/ribbonKernelBinding.ts'
import {
    createDividerLineStyleRequest,
    createDividerSpacingRequest,
    createListItemInsertionRequest,
    createListTypeRequest,
    createTableResizeRequest,
} from './structuredContentEditing.ts'

const NODE_ID = '11111111-1111-4111-8111-111111111111'
const ASSET_ID = '22222222-2222-4222-8222-222222222222'

test('图片上下文页签的替换动作发出受管资产引用 intent', () => {
    const image: ManagedImageDescription = {
        nodeId: NODE_ID,
        alt: '旧图',
        expectedAlt: '旧图',
        sourceReference: {src: `fcasset://${ASSET_ID}`, assetId: ASSET_ID},
        caption: null,
        captionKind: 'absent',
        captionEditable: true,
        captionReason: null,
        reference: {status: 'available', assetId: ASSET_ID, message: 'ok'},
    }
    const request = createImageReplacementRequest(image, '33333333-3333-4333-8333-333333333333')
    const handle: ComponentHandle = {
        handleId: 'handle:picture' as ComponentHandle['handleId'],
        nodeId: NODE_ID as ComponentHandle['nodeId'],
        instanceId: 'instance:picture',
        kind: 'asset',
        origin: {kind: 'author', source: {scope: 'entry', file: 'article.html'}, range: utf16Range(0, 1)},
        analysisStamp: 'analysis:picture' as ComponentHandle['analysisStamp'],
    }
    const intent = request.createIntents(new Map([[NODE_ID, handle]]))[0]
    assert.equal(intent?.kind, 'set-asset-reference')
    assert.equal(intent?.assetId, '33333333-3333-4333-8333-333333333333')
})

test('图片上下文页签的环绕与填充命令写入当前断点的受管规则', () => {
    const bindings = new Map([[NODE_ID, componentHandle(NODE_ID, 'asset')]])
    for (const [context, channel] of [
        ['mobile', {kind: 'base-rule'}],
        ['desktop', {kind: 'conditional-rule', context: 'desktop'}],
    ] as const) {
        for (const value of ['none', 'inline-start', 'inline-end']) {
            const intent = createRibbonPropertyRequest(
                NODE_ID,
                'float',
                {kind: 'keyword', value},
                context,
            ).createIntents(bindings)[0]
            assert.equal(intent?.kind, 'edit-property')
            assert.equal(intent?.property, 'float')
            assert.deepEqual(intent?.action, {kind: 'set-value', value})
            assert.deepEqual(intent?.destination, {scope: 'entry', channel})
        }
        for (const value of ['contain', 'cover', 'fill', 'scale-down']) {
            const intent = createRibbonPropertyRequest(
                NODE_ID,
                'object-fit',
                {kind: 'keyword', value},
                context,
            ).createIntents(bindings)[0]
            assert.equal(intent?.kind, 'edit-property')
            assert.equal(intent?.property, 'object-fit')
            assert.deepEqual(intent?.action, {kind: 'set-value', value})
            assert.deepEqual(intent?.destination, {scope: 'entry', channel})
        }
    }
})

function componentHandle(nodeId: string, kind: ComponentHandle['kind']): ComponentHandle {
    return {
        handleId: `handle:${kind}` as ComponentHandle['handleId'],
        nodeId: nodeId as ComponentHandle['nodeId'],
        instanceId: `instance:${kind}`,
        kind,
        origin: {kind: 'author', source: {scope: 'entry', file: 'article.html'}, range: utf16Range(0, 1)},
        analysisStamp: `analysis:${kind}` as ComponentHandle['analysisStamp'],
    }
}

test('表格上下文命令发出宿主分配单元格身份的 resize-table intent', () => {
    const request = createTableResizeRequest(
        NODE_ID,
        {rowCount: 2, columnCount: 1},
        {rowCount: 2, columnCount: 2},
        ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'],
    )
    const intent = request.createIntents(new Map([[NODE_ID, componentHandle(NODE_ID, 'table')]]))[0]
    assert.equal(intent?.kind, 'resize-table')
    assert.deepEqual(intent?.newCellNodeIds, [
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
    ])
})

test('列表上下文命令发出列表标签与新增列表项 intent', () => {
    const listRequest = createListTypeRequest(NODE_ID, 'ul', 'ol')
    const listIntent = listRequest.createIntents(new Map([[NODE_ID, componentHandle(NODE_ID, 'list')]]))[0]
    assert.equal(listIntent?.kind, 'set-component-tag')
    assert.equal(listIntent?.tag, 'ol')

    const itemId = '33333333-3333-4333-8333-333333333333'
    const insertRequest = createListItemInsertionRequest(NODE_ID, null, itemId)
    const insertIntent = insertRequest.createIntents(new Map([[NODE_ID, componentHandle(NODE_ID, 'list')]]))[0]
    assert.equal(insertIntent?.kind, 'insert-component')
    assert.equal(insertIntent?.componentKind, 'list-item')
    assert.equal(insertIntent?.newNodeId, itemId)
})

test('分隔线功能区的线型与留白跟随当前移动或桌面档位', () => {
    const bindings = new Map([[NODE_ID, componentHandle(NODE_ID, 'divider')]])
    for (const [context, channel] of [
        ['mobile', {kind: 'base-rule'}],
        ['desktop', {kind: 'conditional-rule', context: 'desktop'}],
    ] as const) {
        const lineIntent = createDividerLineStyleRequest(NODE_ID, 'dashed', context).createIntents(bindings)[0]
        assert.equal(lineIntent?.kind, 'edit-property')
        assert.equal(lineIntent?.property, 'border-style')
        assert.deepEqual(lineIntent?.action, {kind: 'set-value', value: 'dashed'})
        assert.deepEqual(lineIntent?.readContext, {
            viewport: context,
            interactions: {hover: false, focusWithin: false},
            direction: 'ltr',
            writingMode: 'horizontal-tb',
        })
        assert.deepEqual(lineIntent?.destination, {scope: 'entry', channel})

        const spacingIntents = createDividerSpacingRequest(NODE_ID, 'wide', context).createIntents(bindings)
        assert.deepEqual(spacingIntents.map(intent => intent.kind === 'edit-property'
            ? [intent.property, intent.action, intent.readContext, intent.destination]
            : null), [
            ['margin-block-start', {kind: 'set-value', value: '2rem'}, lineIntent?.readContext, {scope: 'entry', channel}],
            ['margin-block-end', {kind: 'set-value', value: '2rem'}, lineIntent?.readContext, {scope: 'entry', channel}],
        ])
    }
})
