// 本测试固定图片读取只能在对应 render 真正挂载后开始，过期回执不能启动旧请求。

import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {requestedCanvasAssetIds, sourceForRenderedAssetRequest} from './assetRenderSource.ts'

const ASSET = '018f47a2-3b4c-7d5e-8f90-123456789abc'

test('待渲染图片不提前读取，挂载回执才释放该次来源，旧回执被拒', () => {
    const old = {requestId: 'old', html: '<img src="fcasset://old">', css: ''}
    const next = {requestId: 'next', html: '<img src="fcasset://next">', css: '.next{}'}
    assert.equal(sourceForRenderedAssetRequest(next, old.requestId), null)
    assert.deepEqual(sourceForRenderedAssetRequest(next, next.requestId), next)
    assert.equal(sourceForRenderedAssetRequest(null, next.requestId), null)
    const host = readFileSync(new URL('./PageDocumentCanvas.tsx', import.meta.url), 'utf8')
    assert.match(host, /if \(message\.type === 'rendered'\) \{[\s\S]*?loadAssets\(source\.requestId, source\.html, source\.css, message\.missingAssetIds\)/u)
    assert.doesNotMatch(host, /send\(\{\s*type: 'render',[\s\S]*?\}\)\s*loadAssets\(/u)
})

test('宿主只读取实际 img 使用且由隔离层派生的资产，CSS 与伪造请求不触发帧', () => {
    const source = {requestId: 'latest', html: `<img src="fcasset://${ASSET}">`,
        css: `.cover{background-image:url(fcasset://11111111-1111-7111-8111-111111111111)}`}
    assert.deepEqual(requestedCanvasAssetIds(source, [ASSET, ASSET, '11111111-1111-7111-8111-111111111111']), [ASSET])
    assert.deepEqual(requestedCanvasAssetIds({requestId: 'latest', html: '<p>正文</p>', css: source.css},
        ['11111111-1111-7111-8111-111111111111']), [])
})
