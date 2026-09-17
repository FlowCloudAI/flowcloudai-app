// 本测试确认授权像素只由原 img 绘制，原图尺寸与占位生命周期正确，已解码的帧在重渲染时直接复用。

import assert from 'node:assert/strict'
import test from 'node:test'
import type {CanvasAssetFrameCommand} from '../protocol/index.ts'
import {applyCanvasAssetFrame, CanvasAssetImageCache, missingCanvasAssetIds, mountCanvasAssetDisplays} from './assetDisplay.ts'

const ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'

function fakeImage(attributes: Record<string, string> = {}) {
    const attrs = new Map(Object.entries({'data-fc-canvas-asset-id': ID, 'data-fc-asset-placeholder': '', ...attributes}))
    const listeners = new Map<string, Array<() => void>>()
    const image = {
        tagName: 'IMG', attrs, hidden: attrs.has('hidden'), complete: false, naturalWidth: 0, naturalHeight: 0,
        getAttribute(name: string) { return attrs.get(name) ?? null },
        hasAttribute(name: string) { return attrs.has(name) },
        setAttribute(name: string, value: string) { attrs.set(name, value) },
        removeAttribute(name: string) { attrs.delete(name) },
        addEventListener(name: string, callback: () => void) {
            listeners.set(name, [...listeners.get(name) ?? [], callback])
        },
        insertAdjacentElement() { throw new Error('状态不得向作者 DOM 插入兄弟节点') },
        get src() { return attrs.get('src') ?? '' },
        set src(value: string) { attrs.set('src', value) },
        fireLoad() {
            this.complete = true
            this.naturalWidth = 2048
            this.naturalHeight = 1024
            listeners.get('load')?.forEach(callback => callback())
        },
    }
    return image
}

function withFakeDom(run: (image: ReturnType<typeof fakeImage>, root: HTMLElement) => void, attributes: Record<string, string> = {}) {
    const image = fakeImage(attributes)
    const root = {querySelectorAll: () => [image]} as unknown as HTMLElement
    const before = new Map<string, PropertyDescriptor | undefined>()
    for (const name of ['document', 'ImageData']) before.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, 'document', {configurable: true, value: {createElement(tag: string) {
        assert.equal(tag, 'canvas')
        return {width: 0, height: 0,
            getContext: () => ({putImageData() { /* 测试只关心安全编码入口。 */ }}),
            toDataURL: () => 'data:image/png;base64,AA=='}
    }}})
    Object.defineProperty(globalThis, 'ImageData', {configurable: true, value: class {}})
    try { run(image, root) } finally {
        for (const [name, descriptor] of before) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor)
            else Reflect.deleteProperty(globalThis, name)
        }
    }
}

const frame: CanvasAssetFrameCommand = {
    type: 'asset-frame', requestId: ID, assetId: ID, status: 'ready', width: 1, height: 1,
    originalWidth: 2048, originalHeight: 1024,
    rgbaBase64: btoa(String.fromCharCode(255, 0, 0, 255)),
    channel: 'page-document-canvas', version: 1, sessionToken: 'a'.repeat(64), sequence: 1,
}

test('像素写回原 img；大于 512 的原图尺寸由可信图片声明且不改作者尺寸属性', () => {
    withFakeDom((image, root) => {
        const cache = new CanvasAssetImageCache()
        const displays = mountCanvasAssetDisplays(root, cache)
        assert.deepEqual(missingCanvasAssetIds(displays, cache), [ID])
        assert.equal(image.getAttribute('data-fc-asset-state'), 'loading')
        assert.match(decodeURIComponent(image.src), /正在读取图片/u)
        assert.equal(applyCanvasAssetFrame(displays, cache, frame), true)
        assert.match(image.src, /^data:image\/svg\+xml,/u)
        const svg = decodeURIComponent(image.src.slice('data:image/svg+xml,'.length))
        assert.match(svg, /width="2048" height="1024"/u)
        assert.match(svg, /href="data:image\/png;base64,AA=="/u)
        assert.equal(image.hasAttribute('width'), false)
        assert.equal(image.hasAttribute('height'), false)
        image.fireLoad()
        assert.equal(image.hasAttribute('data-fc-asset-placeholder'), false)
        assert.equal(image.hasAttribute('data-fc-asset-state'), false)
        assert.deepEqual(missingCanvasAssetIds(displays, cache), [])
    })
})

test('已显示图片重渲染从有界缓存直接赋给新 img，不回到加载状态', () => {
    withFakeDom((image, root) => {
        const cache = new CanvasAssetImageCache()
        applyCanvasAssetFrame(mountCanvasAssetDisplays(root, cache), cache, frame)
        image.fireLoad()
        const next = fakeImage({'data-fc-node-id': ID, class: 'hero', hidden: '', width: '240', height: '24'})
        const nextRoot = {querySelectorAll: () => [next]} as unknown as HTMLElement
        const displays = mountCanvasAssetDisplays(nextRoot, cache)
        assert.equal(nextRoot.querySelectorAll('img[data-fc-canvas-asset-id]')[0], next as unknown as Element)
        assert.equal(next.getAttribute('data-fc-node-id'), ID)
        assert.equal(next.hasAttribute('data-fc-asset-state'), false)
        assert.equal(next.hasAttribute('data-fc-asset-placeholder'), false)
        assert.equal(next.getAttribute('width'), '240')
        assert.equal(next.getAttribute('height'), '24')
        assert.equal(next.getAttribute('class'), 'hero')
        assert.equal(next.hidden, true)
        assert.match(next.src, /^data:image\/svg\+xml,/u)
        assert.deepEqual(missingCanvasAssetIds(displays, cache), [])
    })
})

test('缺失与格式无效只在原 img 上显示状态，失败缓存使重渲染不再请求帧', () => {
    withFakeDom((image, root) => {
        const cache = new CanvasAssetImageCache()
        const displays = mountCanvasAssetDisplays(root, cache)
        assert.equal(applyCanvasAssetFrame(displays, cache, {...frame, status: 'unavailable', width: 0,
            height: 0, originalWidth: 0, originalHeight: 0, rgbaBase64: ''}), false)
        assert.equal(image.getAttribute('data-fc-asset-state'), 'unavailable')
        assert.match(decodeURIComponent(image.src), /图片缺失、无权读取或读取失败/u)
        assert.equal(applyCanvasAssetFrame(displays, cache, {...frame, rgbaBase64: 'AAAA'}), false)
        assert.equal(image.getAttribute('data-fc-asset-state'), 'invalid')
        assert.match(decodeURIComponent(image.src), /图片格式或内容无效/u)
        const next = fakeImage()
        const nextDisplays = mountCanvasAssetDisplays({querySelectorAll: () => [next]} as unknown as HTMLElement, cache)
        assert.equal(next.getAttribute('data-fc-asset-state'), 'invalid')
        assert.deepEqual(missingCanvasAssetIds(nextDisplays, cache), [])
        assert.deepEqual(missingCanvasAssetIds(displays, cache), [])
    })
})

test('hidden 图片的加载与失败提示始终留在原 img，不新增可见兄弟节点', () => {
    withFakeDom((image, root) => {
        const cache = new CanvasAssetImageCache()
        const displays = mountCanvasAssetDisplays(root, cache)
        assert.equal(image.hidden, true)
        assert.equal(image.getAttribute('data-fc-asset-state'), 'loading')
        assert.equal(applyCanvasAssetFrame(displays, cache, {...frame, status: 'unavailable', rgbaBase64: ''}), false)
        assert.equal(image.hidden, true)
        assert.equal(image.getAttribute('data-fc-asset-state'), 'unavailable')
    }, {hidden: ''})
})

test('画布已解码图片缓存覆盖合法单页的一百项，超额淘汰并可在会话结束时释放', () => {
    const cache = new CanvasAssetImageCache()
    for (let index = 0; index < 101; index += 1) cache.set(String(index), {url: 'data:image/png;base64,AA==', state: 'ready', decoded: true})
    assert.equal(cache.get('0'), null)
    assert.ok(cache.get('100'))
    cache.clear()
    assert.equal(cache.get('100'), null)
})
