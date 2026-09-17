// 这些测试证明绕过作者 guard 时，画布第二道门仍不会把执行或网络入口送进活 DOM。

import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {isolatePageDocument} from './isolationPolicy.ts'
import {readCanvasSessionToken} from './sessionToken.ts'
import {mountCanvasStyles} from './styleMount.ts'

const V7_ASSET_ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'

test('合法内容保留托管节点与链接，并把 fcasset 资源改成无 URL 占位', () => {
    const result = isolatePageDocument(
        `<p data-fc-node-id="${V7_ASSET_ID}"><a href="https://example.invalid">链接</a><img src="fcasset://${V7_ASSET_ID}"></p>`,
        `.hero { background-image: url(fcasset://${V7_ASSET_ID}); }`,
    )
    assert.deepEqual(result.errors, [])
    assert.equal(result.artifact?.managedNodeCount, 1)
    assert.deepEqual(result.artifact?.assetIds, [V7_ASSET_ID])
    assert.deepEqual(result.artifact?.displayAssetIds, [V7_ASSET_ID])
    assert.match(result.artifact?.html ?? '', /href="https:\/\/example\.invalid"/u)
    assert.match(result.artifact?.html ?? '', /data-fc-asset-placeholder/u)
    assert.match(result.artifact?.html ?? '', new RegExp(`data-fc-canvas-asset-id="${V7_ASSET_ID}"`, 'u'))
    assert.doesNotMatch(result.artifact?.html ?? '', /src=/u)
    assert.doesNotMatch(result.artifact?.css ?? '', /fcasset:|url\(/u)
})

test('作者伪造画布图片身份会被清除，只有合法 src 可派生受管加载身份', () => {
    const forged = isolatePageDocument(`<img data-fc-canvas-asset-id="${V7_ASSET_ID}">`, '')
    assert.ok(forged.artifact)
    assert.deepEqual(forged.artifact.assetIds, [])
    assert.deepEqual(forged.artifact.displayAssetIds, [])
    assert.doesNotMatch(forged.artifact.html, /data-fc-canvas-asset-id/u)
    const external = isolatePageDocument(`<img src="https://example.invalid/a.png" data-fc-canvas-asset-id="${V7_ASSET_ID}">`, '')
    assert.equal(external.artifact, null)
})

test('CSS 中受管图片引用只保留作校验，不请求画布从不显示的帧', () => {
    const result = isolatePageDocument('<p>正文</p>', `.hero{background-image:url(fcasset://${V7_ASSET_ID})}`)
    assert.ok(result.artifact)
    assert.deepEqual(result.artifact.assetIds, [V7_ASSET_ID])
    assert.deepEqual(result.artifact.displayAssetIds, [])
})

test('作者 data 与 blob 图片地址在隔离层拒绝，可信运行时是唯一 data 图片来源', () => {
    for (const url of ['data:image/png;base64,AQID', 'blob:https://example.invalid/picture']) {
        assert.equal(isolatePageDocument(`<img src="${url}">`, '').artifact, null)
        assert.equal(isolatePageDocument('<p>正文</p>', `.hero{background-image:url("${url}")}`).artifact, null)
    }
})

test('直接受管图片隔离后仍保留身份、尺寸、隐藏属性与作者选择器目标', () => {
    const result = isolatePageDocument(
        `<img data-fc-node-id="${V7_ASSET_ID}" data-fc-node-kind="asset" class="hero" hidden width="320" height="180" src="fcasset://${V7_ASSET_ID}">`,
        `img.hero { object-fit: cover; }`,
    )
    assert.ok(result.artifact)
    assert.match(result.artifact.html, new RegExp(`data-fc-node-id="${V7_ASSET_ID}"`, 'u'))
    assert.match(result.artifact.html, /class="hero" hidden="" width="320" height="180"/u)
    assert.match(result.artifact.css, /img\.hero\s*\{\s*object-fit:\s*cover/u)
})

test('脚本、事件、外部资源、表单能力与危险 CSS 在挂载前被拒绝', () => {
    const attacks = [
        ['<script>parent.compromised=true</script>', ''],
        ['<img src="https://example.invalid/a" onerror="parent.compromised=true">', ''],
        ['<form action="https://example.invalid"><button>提交</button></form>', ''],
        ['<svg><image href="https://example.invalid/a"></image></svg>', ''],
        ['<p>正文</p>', '@import "https://example.invalid/a.css";'],
        ['<p>正文</p>', '.x::before{content:"伪造"}'],
        ['<p>正文</p>', '.x{position:fixed;inset:0}'],
    ] as const
    for (const [html, css] of attacks) {
        const result = isolatePageDocument(html, css)
        assert.equal(result.artifact, null, `${html} / ${css}`)
        assert.ok(result.errors.length > 0)
    }
})

test('作者 contenteditable 仍由隔离层拒绝，不能自行取得运行时编辑权限', () => {
    const result = isolatePageDocument(
        `<p data-fc-node-id="${V7_ASSET_ID}" data-fc-node-kind="paragraph" contenteditable="true">越权编辑</p>`,
        '',
    )
    assert.equal(result.artifact, null)
    assert.ok(result.errors.some(error => error.includes('contenteditable')))
})

test('非法链接被保留为无 href 文本，不能产生导航意图', () => {
    const result = isolatePageDocument('<p><a href="javascript:alert(1)">危险</a></p>', '')
    assert.ok(result.artifact)
    assert.doesNotMatch(result.artifact?.html ?? '', /href=/u)
    assert.match(result.artifact?.html ?? '', />危险</u)
})

test('运行时样式先于作者样式挂载，且作者 HTML 的合法 style 属性继续保留', () => {
    const created: Array<{
        attributes: Map<string, string>
        textContent: string
        getAttribute(name: string): string | null
        setAttribute(name: string, value: string): void
    }> = []
    const appended: unknown[] = []
    const documentScope = {
        createElement(tagName: string) {
            assert.equal(tagName, 'style')
            const element = {
                attributes: new Map<string, string>(),
                textContent: '',
                getAttribute(name: string) {
                    return this.attributes.get(name) ?? null
                },
                setAttribute(name: string, value: string) {
                    this.attributes.set(name, value)
                },
            }
            created.push(element)
            return element
        },
        head: {
            append(...nodes: unknown[]) {
                appended.push(...nodes)
            },
        },
    } as unknown as Document

    const mounted = mountCanvasStyles(documentScope, ':root { color: CanvasText; }')
    assert.equal(created.length, 2)
    assert.deepEqual(appended, [mounted.runtimeStyle, mounted.authorStyle])
    assert.equal(mounted.runtimeStyle.getAttribute('data-fc-canvas-style'), 'runtime')
    assert.equal(mounted.runtimeStyle.textContent, ':root { color: CanvasText; }')
    assert.equal(mounted.authorStyle.getAttribute('data-fc-canvas-style'), 'author')
    assert.equal(mounted.authorStyle.textContent, '')

    const isolated = isolatePageDocument('<p style="color: var(--fc-entry-text)">中文正文</p>', '')
    assert.ok(isolated.artifact)
    assert.match(isolated.artifact.html, /style="color: var\(--fc-entry-text\)"/u)
})

test('共享恶意样例绕过作者 guard 后仍被拒绝或清除全部执行与资源入口', () => {
    const root = new URL('../../../../../tests/fixtures/page-document/v1/', import.meta.url)
    const fixture = JSON.parse(readFileSync(new URL('malicious-cases.json', root), 'utf8')) as {
        cases: Array<{id: string; file: string; replace: {needle: string; value: string}}>
    }
    const baseHtml = readFileSync(new URL('entry/article.html', root), 'utf8')
    const baseCss = readFileSync(new URL('entry/style.css', root), 'utf8')
    for (const item of fixture.cases) {
        const source = item.file.endsWith('.css') ? baseCss : baseHtml
        const mutated = source.replace(item.replace.needle, item.replace.value)
        const result = item.file.endsWith('.css')
            ? isolatePageDocument(baseHtml, mutated)
            : isolatePageDocument(mutated, baseCss)
        if (!result.artifact) continue
        const combined = `${result.artifact.html}\n${result.artifact.css}`
        assert.doesNotMatch(combined, /<script|\son[a-z]+=|https?:\/\/example\.invalid\/(?:pixel|image|poster|sprite|table|audit)/iu, item.id)
        assert.doesNotMatch(combined, /javascript:|data:text\/html|custom-protocol:/iu, item.id)
    }
})

test('画布只接受 URL fragment 中的 32 字节十六进制 token', () => {
    const token = 'ab'.repeat(32)
    assert.equal(readCanvasSessionToken(`#token=${token}`), token)
    assert.equal(readCanvasSessionToken(`?token=${token}`), null)
    assert.equal(readCanvasSessionToken('#token=short'), null)
})
