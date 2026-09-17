// 本测试让十种图片布局先经过真实预览编译与画布隔离，静态截图只应取这一合法产物。

import assert from 'node:assert/strict'
import {readFileSync, writeFileSync} from 'node:fs'
import test from 'node:test'
import {deflateSync} from 'node:zlib'
import {parseFragment, serialize, type DefaultTreeAdapterTypes} from 'parse5'
import {imageDataUrlForOriginalSize} from '../runtime/assetDisplay.ts'
import {isolatePageDocument} from '../runtime/isolationPolicy.ts'
import {CANVAS_BASE_PROJECT_CSS, CANVAS_BASE_PROJECT_HTML, compileCanvasPreview, wrapMarkdownFallback} from './compiledPreview.ts'

const ENTRY = '018f47a2-3b4c-7d5e-8f90-123456789abc'
const cases = [
    {name: '带层叠背景的容器', parentCss: 'position:relative;z-index:1;background:Canvas;', imageCss: '', image: ''},
    {name: '只写宽', parentCss: '', imageCss: '', image: 'width="240"'},
    {name: '只写高', parentCss: '', imageCss: '', image: 'height="120"'},
    {name: '大图无尺寸', parentCss: '', imageCss: '', image: ''},
    {name: '显式矮尺寸', parentCss: '', imageCss: '', image: 'width="240" height="24"'},
    {name: '旋转', parentCss: '', imageCss: 'transform:rotate(15deg);', image: ''},
    {name: '父级裁剪圆角', parentCss: 'overflow:hidden;border-radius:20px;', imageCss: '', image: ''},
    {name: '封面裁剪', parentCss: '', imageCss: 'width:240px;height:80px;object-fit:cover;', image: ''},
    {name: '隐藏', parentCss: '', imageCss: '', image: 'hidden'},
    {name: '透明度', parentCss: '', imageCss: 'opacity:.35;', image: ''},
] as const

function pngChunk(name: string, payload: Buffer): Buffer {
    const tag = Buffer.from(name, 'ascii')
    const length = Buffer.alloc(4)
    length.writeUInt32BE(payload.length)
    let crc = 0xffffffff
    for (const value of Buffer.concat([tag, payload])) {
        crc ^= value
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([length, tag, payload, checksum])
}

function previewPng(width: number, height: number): string {
    const header = Buffer.alloc(13)
    header.writeUInt32BE(width, 0)
    header.writeUInt32BE(height, 4)
    header.set([8, 6, 0, 0, 0], 8)
    const pixels = Buffer.alloc(height * (1 + width * 4))
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const offset = y * (1 + width * 4) + 1 + x * 4
            pixels.set(x < width / 2 ? [255, 96, 32, 255] : [32, 96, 255, 255], offset)
        }
    }
    const png = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0)),
    ])
    return `data:image/png;base64,${png.toString('base64')}`
}

function writeStaticFixture(artifact: {html: string; css: string}, ids: string[], output: string): void {
    const fragment = parseFragment(artifact.html)
    const visit = (node: DefaultTreeAdapterTypes.Node): void => {
        if ('tagName' in node && node.tagName === 'img') {
            const id = node.attrs.find(attribute => attribute.name === 'data-fc-canvas-asset-id')?.value
            const index = ids.indexOf(id ?? '')
            if (index >= 0) {
                const large = index === 3
                const width = large ? 2048 : 120
                const height = large ? 1024 : 60
                const previewWidth = large ? 512 : 120
                const previewHeight = large ? 256 : 60
                node.attrs = node.attrs.filter(attribute => attribute.name !== 'data-fc-asset-placeholder')
                node.attrs.push({name: 'src', value: imageDataUrlForOriginalSize(
                    previewPng(previewWidth, previewHeight), previewWidth, previewHeight, width, height,
                )})
            }
        }
        if ('childNodes' in node) node.childNodes.forEach(visit)
    }
    fragment.childNodes.forEach(visit)
    const runtimeCss = readFileSync(new URL('../runtime/runtime.css', import.meta.url), 'utf8')
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>${runtimeCss}\n${artifact.css}</style></head><body><main id="page-document-canvas-root">${serialize(fragment)}</main></body></html>`
    writeFileSync(output, html)
}

test('十种图片布局的作者文档均通过真实编译和隔离，并保留原 img 属性与选择身份', () => {
    const ids = cases.map((_, index) => `018f47a2-3b4c-7d5e-8f90-${String(index + 1).padStart(12, '0')}`)
    const body = cases.map((item, index) => {
        const id = ids[index]
        return `<figure data-fc-node-id="${id}" data-fc-node-kind="asset" style="${item.parentCss}"><img src="fcasset://${id}" data-fc-asset-id="${id}" style="${item.imageCss}" ${item.image} alt="${item.name}"><figcaption>${item.name}</figcaption></figure>`
    }).join('')
    const compiled = compileCanvasPreview({
        projectArticleHtml: CANVAS_BASE_PROJECT_HTML,
        projectStyleCss: CANVAS_BASE_PROJECT_CSS,
        entryArticleHtml: wrapMarkdownFallback(ENTRY, body),
        entryStyleCss: '',
        metadata: {id: ENTRY, title: '图片布局', summary: '', tags: []},
        assetIds: ids,
    })
    assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), [])
    assert.ok(compiled.html && compiled.css)
    const isolated = isolatePageDocument(compiled.html, compiled.css)
    assert.deepEqual(isolated.errors, [])
    assert.ok(isolated.artifact)
    assert.deepEqual(isolated.artifact.displayAssetIds, ids)
    assert.match(isolated.artifact.html, /width="240" height="24"/u)
    assert.match(isolated.artifact.html, /hidden=""/u)
    assert.match(isolated.artifact.html, /transform:rotate\(15deg\)/u)
    assert.match(isolated.artifact.html, /object-fit:cover/u)
    assert.doesNotMatch(isolated.artifact.html, /src="(?:data:|blob:|https?:)/u)
    if (process.env.PAGE_DOCUMENT_LAYOUT_FIXTURE_PATH) {
        writeStaticFixture(isolated.artifact, ids, process.env.PAGE_DOCUMENT_LAYOUT_FIXTURE_PATH)
    }
})
