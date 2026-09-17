// 本测试先真实编译、隔离作者文档；可选静态夹具调用运行时资产挂载与状态切换，不直接改写待测 img 的 src。

import assert from 'node:assert/strict'
import {readFileSync, writeFileSync} from 'node:fs'
import test from 'node:test'
import {deflateSync} from 'node:zlib'
import {build} from 'esbuild-wasm'
import {parseFragment, serialize} from 'parse5'
import {isolatePageDocument} from '../runtime/isolationPolicy.ts'
import {CANVAS_BASE_PROJECT_CSS, CANVAS_BASE_PROJECT_HTML, compileCanvasPreview, wrapMarkdownFallback} from './compiledPreview.ts'

const ENTRY = '018f47a2-3b4c-7d5e-8f90-123456789abc'
const cases = [
    {name: '窄容器同时写宽高', parentCss: 'width:300px;', imageCss: '', image: 'width="1024" height="512"', state: 'ready'},
    {name: '只写宽', parentCss: 'width:300px;', imageCss: '', image: 'width="240"', state: 'ready'},
    {name: '只写高', parentCss: 'width:300px;', imageCss: '', image: 'height="120"', state: 'ready'},
    {name: '宽高比例不符', parentCss: 'width:300px;', imageCss: '', image: 'width="240" height="24"', state: 'ready'},
    {name: '大图无尺寸', parentCss: 'width:300px;', imageCss: '', image: '', state: 'ready'},
    {name: '带层叠背景的容器', parentCss: 'width:300px;position:relative;z-index:1;background:Canvas;', imageCss: '', image: '', state: 'ready'},
    {name: '旋转', parentCss: 'width:300px;', imageCss: 'transform:rotate(15deg);', image: '', state: 'ready'},
    {name: '父级裁剪圆角', parentCss: 'width:300px;overflow:hidden;border-radius:20px;', imageCss: '', image: '', state: 'ready'},
    {name: '封面裁剪', parentCss: 'width:300px;', imageCss: 'width:240px;height:80px;object-fit:cover;', image: '', state: 'ready'},
    {name: '透明度', parentCss: 'width:300px;', imageCss: 'opacity:.35;', image: '', state: 'ready'},
    {name: 'hidden 加载中', parentCss: 'width:300px;', imageCss: '', image: 'hidden', state: 'loading'},
    {name: 'hidden 缺失', parentCss: 'width:300px;', imageCss: '', image: 'hidden', state: 'unavailable'},
    {name: 'hidden 格式无效', parentCss: 'width:300px;', imageCss: '', image: 'hidden', state: 'invalid'},
    {name: 'display none 加载中', parentCss: 'width:300px;', imageCss: 'display:none;', image: '', state: 'loading'},
    {name: 'display none 缺失', parentCss: 'width:300px;', imageCss: 'display:none;', image: '', state: 'unavailable'},
    {name: 'display none 格式无效', parentCss: 'width:300px;', imageCss: 'display:none;', image: '', state: 'invalid'},
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

async function writeStaticFixture(artifact: {html: string; css: string}, ids: string[], output: string): Promise<void> {
    const largeIndex = 4
    const rgba = (width: number, height: number): string => {
        const pixels = Buffer.alloc(width * height * 4)
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) pixels.set(x < width / 2 ? [255, 96, 32, 255] : [32, 96, 255, 255], (y * width + x) * 4)
        }
        return pixels.toString('base64')
    }
    const commands = cases.map((item, index) => ({assetId: ids[index], status: item.state,
        width: index === largeIndex ? 512 : 120, height: index === largeIndex ? 256 : 60,
        originalWidth: index === largeIndex ? 2048 : 120, originalHeight: index === largeIndex ? 1024 : 60,
        rgbaBase64: item.state === 'ready' ? rgba(index === largeIndex ? 512 : 120, index === largeIndex ? 256 : 60) : '',
    }))
    const reference = cases.map((item, index) => {
        const source = previewPng(index === largeIndex ? 2048 : 120, index === largeIndex ? 1024 : 60)
        return `<figure data-fc-node-kind="asset" style="${item.parentCss}"><img data-reference="${ids[index]}" data-fc-canvas-asset-id="${ids[index]}" src="${source}" style="${item.imageCss}" ${item.image} alt="参照：${item.name}"><figcaption>参照：${item.name}</figcaption></figure>`
    }).join('')
    const harness = `
        import {CanvasAssetImageCache, mountCanvasAssetDisplays, applyCanvasAssetFrame} from './src/features/page-document/canvas/runtime/assetDisplay.ts'
        const cache = new CanvasAssetImageCache()
        const root = document.querySelector('#page-document-canvas-root')
        const displays = mountCanvasAssetDisplays(root, cache)
        const commands = window.__fixtureCommands
        for (const command of commands) {
            if (command.status !== 'loading') applyCanvasAssetFrame(displays, cache, command)
        }
        const measure = image => {
            const rect = image.getBoundingClientRect()
            return {width: rect.width, height: rect.height, display: getComputedStyle(image).display,
                state: image.getAttribute('data-fc-asset-state'), src: image.currentSrc.slice(0, 24)}
        }
        Promise.all([...root.querySelectorAll('img[data-fc-canvas-asset-id]')].map(image =>
            image.decode().catch(() => undefined))).then(() => {
            const results = commands.map(command => {
                const image = root.querySelector('img[data-fc-canvas-asset-id="' + command.assetId + '"]')
                const direct = document.querySelector('img[data-reference="' + command.assetId + '"]')
                return {id: command.assetId, actual: measure(image), reference: measure(direct)}
            })
            document.querySelector('#fixture-results').textContent = JSON.stringify(results)
            document.documentElement.setAttribute('data-fixture-ready', 'true')
        })
    `
    const bundled = await build({stdin: {contents: harness, loader: 'ts', resolveDir: process.cwd()},
        bundle: true, format: 'iife', platform: 'browser', write: false})
    const runtimeCss = readFileSync(new URL('../runtime/runtime.css', import.meta.url), 'utf8')
    // 临时截图夹具才允许内联测试脚本；实际 canvas.html 的哈希 CSP 仍由独立产物检查锁定。
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>${runtimeCss}\n${artifact.css}</style></head><body><main id="page-document-canvas-root">${serialize(parseFragment(artifact.html))}</main><section id="fixture-reference">${reference}</section><pre id="fixture-results"></pre><script>window.__fixtureCommands=${JSON.stringify(commands)};${bundled.outputFiles[0].text}</script></body></html>`
    writeFileSync(output, html)
}

test('图片尺寸与可见性夹具经真实编译和隔离，并由运行时挂载与状态切换', async () => {
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
    assert.match(isolated.artifact.css, /img\s*\{[^}]*max-width:\s*100%;\s*height:\s*auto;/u)
    assert.match(isolated.artifact.html, /width="1024" height="512"/u)
    assert.match(isolated.artifact.html, /width="240" height="24"/u)
    assert.match(isolated.artifact.html, /hidden=""/u)
    assert.match(isolated.artifact.html, /transform:rotate\(15deg\)/u)
    assert.match(isolated.artifact.html, /object-fit:cover/u)
    assert.doesNotMatch(isolated.artifact.html, /src="(?:data:|blob:|https?:)/u)
    if (process.env.PAGE_DOCUMENT_LAYOUT_FIXTURE_PATH) {
        await writeStaticFixture(isolated.artifact, ids, process.env.PAGE_DOCUMENT_LAYOUT_FIXTURE_PATH)
    }
})
