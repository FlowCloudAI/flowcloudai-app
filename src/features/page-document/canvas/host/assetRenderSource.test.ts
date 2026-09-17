// 本测试固定图片读取只能在对应 render 真正挂载后开始，过期回执不能启动旧请求。

import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {sourceForRenderedAssetRequest} from './assetRenderSource.ts'

test('待渲染图片不提前读取，挂载回执才释放该次来源，旧回执被拒', () => {
    const old = {requestId: 'old', html: '<img src="fcasset://old">', css: ''}
    const next = {requestId: 'next', html: '<img src="fcasset://next">', css: '.next{}'}
    assert.equal(sourceForRenderedAssetRequest(next, old.requestId), null)
    assert.deepEqual(sourceForRenderedAssetRequest(next, next.requestId), next)
    assert.equal(sourceForRenderedAssetRequest(null, next.requestId), null)
    const host = readFileSync(new URL('./PageDocumentCanvas.tsx', import.meta.url), 'utf8')
    assert.match(host, /if \(message\.type === 'rendered'\) \{[\s\S]*?loadAssets\(source\.requestId, source\.html, source\.css\)/u)
    assert.doesNotMatch(host, /send\(\{\s*type: 'render',[\s\S]*?\}\)\s*loadAssets\(/u)
})
