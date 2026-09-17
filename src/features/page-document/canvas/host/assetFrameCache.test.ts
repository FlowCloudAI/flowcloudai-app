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
    cache.activate()
    let reads = 0
    let resolve!: (value: PageDocumentAssetFrame) => void
    const read = () => { reads += 1; return new Promise<PageDocumentAssetFrame>(done => { resolve = done }) }
    const first = cache.read(FIRST, ASSET, read)
    const second = cache.read(FIRST, ASSET, read)
    assert.equal(reads, 1)
    resolve(frame)
    assert.deepEqual(await first, {status: 'ready', frame})
    assert.deepEqual(await second, {status: 'ready', frame})
    assert.deepEqual(await cache.read(FIRST, ASSET, read), {status: 'ready', frame})
    assert.equal(reads, 1)
    cache.clear()
})

test('不同项目不能复用帧，身份不符的回执不可缓存', async () => {
    const cache = new CanvasAssetFrameCache('session-a')
    cache.activate()
    let reads = 0
    const read = async () => { reads += 1; return frame }
    await cache.read(FIRST, ASSET, read)
    await cache.read(SECOND, ASSET, read)
    assert.equal(reads, 2)
    assert.deepEqual(await cache.read(FIRST, SECOND, async () => frame), {status: 'unavailable'})
    cache.clear()
    await assert.rejects(() => cache.read(FIRST, ASSET, read), /会话已结束/u)
})

test('宿主帧缓存只保留最近十六张图片', async () => {
    const cache = new CanvasAssetFrameCache('session-a')
    cache.activate()
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

test('StrictMode 式 cleanup/setup 重放保留同一帧缓存，真正卸载后旧会话不可复活', async () => {
    const cache = new CanvasAssetFrameCache('session-a')
    cache.activate()
    let reads = 0
    const read = async () => { reads += 1; return frame }
    await cache.read(FIRST, ASSET, read)
    cache.deactivate()
    await Promise.resolve()
    cache.activate()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(cache.isActive(), true)
    assert.deepEqual(await cache.read(FIRST, ASSET, read), {status: 'ready', frame})
    assert.equal(reads, 1)
    cache.deactivate()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(cache.isActive(), false)
    assert.throws(() => cache.activate(), /会话已结束/u)
    const next = new CanvasAssetFrameCache('session-b')
    next.activate()
    await next.read(FIRST, ASSET, read)
    assert.equal(reads, 2)
})

test('缺失与无效帧按会话和项目缓存，重渲染不再读取后端', async () => {
    const cache = new CanvasAssetFrameCache('session-a')
    cache.activate()
    let reads = 0
    const read = async () => { reads += 1; throw new Error('asset failure') }
    assert.deepEqual(await cache.read(FIRST, ASSET, read, () => 'invalid'), {status: 'invalid'})
    assert.deepEqual(await cache.read(FIRST, ASSET, read, () => 'invalid'), {status: 'invalid'})
    assert.deepEqual(await cache.read(SECOND, ASSET, read), {status: 'unavailable'})
    assert.equal(reads, 2)
    cache.clear()
})

test('项目切换后旧会话的迟到帧不入缓存，也不能阻止新会话重新读取', async () => {
    const old = new CanvasAssetFrameCache('session-a')
    old.activate()
    let resolve!: (value: PageDocumentAssetFrame) => void
    const pending = old.read(FIRST, ASSET, () => new Promise(done => { resolve = done }))
    old.deactivate()
    await new Promise(resolve => setTimeout(resolve, 0))
    resolve(frame)
    assert.deepEqual(await pending, {status: 'ready', frame})
    assert.equal(old.isActive(), false)
    await assert.rejects(() => old.read(FIRST, ASSET, async () => frame), /会话已结束/u)
    const next = new CanvasAssetFrameCache('session-b')
    next.activate()
    let reads = 0
    assert.deepEqual(await next.read(SECOND, ASSET, async () => { reads += 1; return frame }), {status: 'ready', frame})
    assert.equal(reads, 1)
    next.clear()
})
