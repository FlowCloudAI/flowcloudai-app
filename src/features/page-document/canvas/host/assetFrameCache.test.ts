// 本测试锁定同项目资产的已完成与在途读取复用、项目隔离和会话清理。

import assert from 'node:assert/strict'
import test from 'node:test'
import type {PageDocumentAssetFrame} from '../../../../api/pageDocument.ts'
import {CanvasAssetFrameCache} from './assetFrameCache.ts'

const ASSET = '018f47a2-3b4c-7d5e-8f90-123456789abc'
const FIRST = '11111111-1111-7111-8111-111111111111'
const SECOND = '22222222-2222-7222-8222-222222222222'
const frame: PageDocumentAssetFrame = {
    assetId: ASSET, width: 1, height: 1, originalWidth: 2048, originalHeight: 1024, rgbaBase64: 'AQIDBA==',
}

test('连续重渲染复用同项目已授权帧，读中再次请求也只调用后端一次', async () => {
    const cache = new CanvasAssetFrameCache('session-a')
    let reads = 0
    let resolve!: (value: PageDocumentAssetFrame) => void
    const read = () => { reads += 1; return new Promise<PageDocumentAssetFrame>(done => { resolve = done }) }
    const first = cache.read(FIRST, ASSET, read)
    const second = cache.read(FIRST, ASSET, read)
    assert.equal(reads, 1)
    resolve(frame)
    assert.deepEqual(await first, frame)
    assert.deepEqual(await second, frame)
    assert.deepEqual(await cache.read(FIRST, ASSET, read), frame)
    assert.equal(reads, 1)
    cache.clear()
})

test('不同项目不能复用帧，身份不符的回执不可缓存', async () => {
    const cache = new CanvasAssetFrameCache('session-a')
    let reads = 0
    const read = async () => { reads += 1; return frame }
    await cache.read(FIRST, ASSET, read)
    await cache.read(SECOND, ASSET, read)
    assert.equal(reads, 2)
    await assert.rejects(() => cache.read(FIRST, SECOND, async () => frame), /身份不匹配/u)
    cache.clear()
    await assert.rejects(() => cache.read(FIRST, ASSET, read), /会话已结束/u)
})

test('宿主帧缓存只保留最近十六张图片', async () => {
    const cache = new CanvasAssetFrameCache('session-a')
    let reads = 0
    const read = async (_projectId: string, assetId: string) => {
        reads += 1
        return {...frame, assetId}
    }
    const ids = Array.from({length: 17}, (_, index) => `018f47a2-3b4c-7d5e-8f90-${String(index + 1).padStart(12, '0')}`)
    for (const id of ids) await cache.read(FIRST, id, read)
    await cache.read(FIRST, ids[16], read)
    assert.equal(reads, 17)
    await cache.read(FIRST, ids[0], read)
    assert.equal(reads, 18)
    cache.clear()
})
