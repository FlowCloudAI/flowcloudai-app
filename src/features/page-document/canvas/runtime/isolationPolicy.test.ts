// 这些测试证明绕过作者 guard 时，画布第二道门仍不会把执行或网络入口送进活 DOM。

import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {isolatePageDocument} from './isolationPolicy.ts'
import {readCanvasSessionToken} from './sessionToken.ts'

const V7_ASSET_ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'

test('合法内容保留托管节点与链接，并把 fcasset 资源改成无 URL 占位', () => {
    const result = isolatePageDocument(
        `<p data-fc-node-id="${V7_ASSET_ID}"><a href="https://example.invalid">链接</a><img src="fcasset://${V7_ASSET_ID}"></p>`,
        `.hero { background-image: url(fcasset://${V7_ASSET_ID}); }`,
    )
    assert.deepEqual(result.errors, [])
    assert.equal(result.artifact?.managedNodeCount, 1)
    assert.deepEqual(result.artifact?.assetIds, [V7_ASSET_ID])
    assert.match(result.artifact?.html ?? '', /href="https:\/\/example\.invalid"/u)
    assert.match(result.artifact?.html ?? '', /data-fc-asset-placeholder/u)
    assert.doesNotMatch(result.artifact?.html ?? '', /src=/u)
    assert.doesNotMatch(result.artifact?.css ?? '', /fcasset:|url\(/u)
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

test('非法链接被保留为无 href 文本，不能产生导航意图', () => {
    const result = isolatePageDocument('<p><a href="javascript:alert(1)">危险</a></p>', '')
    assert.ok(result.artifact)
    assert.doesNotMatch(result.artifact?.html ?? '', /href=/u)
    assert.match(result.artifact?.html ?? '', />危险</u)
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
