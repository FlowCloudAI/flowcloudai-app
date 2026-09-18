// 本测试固定图片上下文页签最终使用既有图片替换内核请求，不创建第二套写回路径。
import assert from 'node:assert/strict'
import test from 'node:test'
import {utf16Range, type ComponentHandle} from '../domain/kernel/index.ts'
import {createImageReplacementRequest} from './imageAssetEditing.ts'
import type {ManagedImageDescription} from './imageSemanticEditing.ts'

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
