// 本测试固定图片上下文页签最终使用既有图片替换内核请求，不创建第二套写回路径。
import assert from 'node:assert/strict'
import test from 'node:test'
import {utf16Range, type ComponentHandle} from '../domain/kernel/index.ts'
import {createImageReplacementRequest} from './imageAssetEditing.ts'
import type {ManagedImageDescription} from './imageSemanticEditing.ts'
import {
    createDividerLineStyleRequest,
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

test('分隔线上下文命令发出受管 border-style intent', () => {
    const request = createDividerLineStyleRequest(NODE_ID, 'dashed')
    const intent = request.createIntents(new Map([[NODE_ID, componentHandle(NODE_ID, 'divider')]]))[0]
    assert.equal(intent?.kind, 'edit-property')
    assert.equal(intent?.property, 'border-style')
    assert.deepEqual(intent?.action, {kind: 'set-value', value: 'dashed'})
})
