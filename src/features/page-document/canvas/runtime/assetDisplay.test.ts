// 本测试用最小 DOM 替身核对原 img 未被替换，像素层跟随尺寸、裁剪、隐藏与托管选择。

import assert from 'node:assert/strict'
import test from 'node:test'
import type {CanvasAssetFrameCommand} from '../protocol/index.ts'
import {applyCanvasAssetFrame, disposeCanvasAssetDisplays, mountCanvasAssetDisplays, selectCanvasAssetDisplays, syncCanvasAssetDisplays} from './assetDisplay.ts'

const ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'

function fakeStyle() {
    const values = new Map<string, string>()
    return {
        getPropertyValue(name: string) { return values.get(name) ?? '' },
        getPropertyPriority() { return '' },
        setProperty(name: string, value: string) { values.set(name, value) },
        removeProperty(name: string) { values.delete(name) },
    } as CSSStyleDeclaration
}

function fakeElement(tagName: string, attributes: Record<string, string> = {}) {
    const attrs = new Map(Object.entries(attributes))
    const children: ReturnType<typeof fakeElement>[] = []
    const element = {
        tagName,
        attributes: attrs,
        children,
        parentElement: null as ReturnType<typeof fakeElement> | null,
        style: fakeStyle(),
        hidden: false,
        textContent: '',
        rect: {left: 0, top: 0, right: 180, bottom: 100, width: 180, height: 100},
        width: Number(attrs.get('width') ?? 0),
        height: Number(attrs.get('height') ?? 0),
        clientLeft: 0,
        clientTop: 0,
        scrollLeft: 0,
        scrollTop: 0,
        getAttribute(name: string) { return attrs.get(name) ?? null },
        hasAttribute(name: string) { return attrs.has(name) },
        setAttribute(name: string, value: string) { attrs.set(name, value) },
        toggleAttribute(name: string, present: boolean) { if (present) attrs.set(name, ''); else attrs.delete(name) },
        getBoundingClientRect() { return this.rect },
        append(...nodes: ReturnType<typeof fakeElement>[]) {
            for (const node of nodes) { node.parentElement = this; children.push(node) }
        },
        querySelectorAll(selector: string) {
            assert.equal(selector, 'img[data-fc-canvas-asset-id]')
            return children.flatMap(child => child.tagName === 'img' ? [child] : child.children.filter(node => node.tagName === 'img'))
        },
        getContext() { return {putImageData() { /* 像素写入由命令边界负责。 */ }} },
    }
    return element
}

function withFakeDom(run: (root: HTMLElement, image: HTMLImageElement, figure: HTMLElement | null) => void, inFigure: boolean) {
    const root = fakeElement('main')
    root.rect = {left: 10, top: 20, right: 610, bottom: 420, width: 600, height: 400}
    const figure = inFigure ? fakeElement('figure') : null
    if (figure) {
        figure.rect = {left: 20, top: 30, right: 170, bottom: 130, width: 150, height: 100}
        root.append(figure)
    }
    const image = fakeElement('img', {
        'data-fc-canvas-asset-id': ID,
        'data-fc-node-id': ID,
        class: 'hero',
        width: '180',
        height: '100',
        hidden: '',
    })
    image.hidden = false
    image.rect = {left: 20, top: 30, right: 200, bottom: 130, width: 180, height: 100}
    ;(figure ?? root).append(image)
    const original = new Map<string, PropertyDescriptor | undefined>()
    for (const name of ['document', 'window', 'ResizeObserver', 'getComputedStyle', 'ImageData']) {
        original.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    }
    const replace = (name: string, value: unknown) => Object.defineProperty(globalThis, name, {configurable: true, value})
    replace('document', {createElement: (tag: string) => fakeElement(tag)})
    replace('window', {addEventListener() {}, removeEventListener() {}})
    replace('ResizeObserver', class { observe() {} disconnect() {} })
    replace('getComputedStyle', (element: unknown) => element === image ? {
        opacity: '0.7', display: 'block', visibility: 'visible', objectFit: 'cover', objectPosition: 'center',
        borderRadius: '8px', border: '1px solid', padding: '0px', filter: 'none', clipPath: 'none', boxShadow: 'none',
    } : {opacity: '1', overflowX: 'hidden', overflowY: 'clip'})
    replace('ImageData', class {})
    try { run(root as unknown as HTMLElement, image as unknown as HTMLImageElement, figure as unknown as HTMLElement | null) } finally {
        for (const [name, descriptor] of original) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor)
            else Reflect.deleteProperty(globalThis, name)
        }
    }
}

const ready: CanvasAssetFrameCommand = {
    type: 'asset-frame', requestId: ID, assetId: ID, status: 'ready', width: 1, height: 1,
    rgbaBase64: btoa(String.fromCharCode(255, 0, 0, 255)),
    channel: 'page-document-canvas', version: 1, sessionToken: 'a'.repeat(64), sequence: 1,
}

test('直接受管 img 留在 DOM，保留 class、节点身份、hidden 与尺寸，显示层跟随选择', () => {
    withFakeDom((root, image) => {
        const displays = mountCanvasAssetDisplays(root)
        const child = root.children[0] as HTMLImageElement
        assert.equal(child, image)
        assert.equal(image.getAttribute('class'), 'hero')
        assert.equal(image.getAttribute('data-fc-node-id'), ID)
        assert.equal(image.getAttribute('width'), '180')
        assert.equal(image.getAttribute('height'), '100')
        assert.equal(applyCanvasAssetFrame(root, displays, ready), true)
        const canvas = displays.get(ID)?.[0].canvas
        assert.ok(canvas)
        assert.equal(canvas.style.objectFit, 'cover')
        assert.equal(canvas.style.objectPosition, 'center')
        assert.equal(canvas.style.width, '100%')
        selectCanvasAssetDisplays(displays, ID)
        assert.equal(canvas.hasAttribute('data-fc-canvas-selected'), true)
        image.hidden = true
        syncCanvasAssetDisplays(root, displays)
        assert.equal(canvas.hidden, true)
        disposeCanvasAssetDisplays(displays)
    }, false)
})

test('figure img 作者选择器仍有原节点，溢出裁剪约束像素层', () => {
    withFakeDom((root, image, figure) => {
        assert.ok(figure)
        const displays = mountCanvasAssetDisplays(root)
        assert.equal(figure.children[0], image)
        applyCanvasAssetFrame(root, displays, ready)
        const overlay = displays.get(ID)?.[0].overlay
        assert.ok(overlay)
        assert.equal(overlay.style.clipPath, 'inset(0px 30px 0px 0px)')
        disposeCanvasAssetDisplays(displays)
    }, true)
})
