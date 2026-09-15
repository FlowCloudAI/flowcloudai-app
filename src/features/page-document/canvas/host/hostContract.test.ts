// 这些测试固定独立页面 URL、iframe 沙箱、宿主导航复核和页面文档 CSS 无颜色字面量约束。

import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync, readdirSync, statSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {createCanvasPageUrl, resolveCanvasHeight} from './canvasPageUrl.ts'
import {canForwardCanvasNavigationIntent} from './navigationIntent.ts'

const featureRoot = fileURLToPath(new URL('../../', import.meta.url))

function collectCss(directory: string): string[] {
    return readdirSync(directory).flatMap(name => {
        const absolute = path.join(directory, name)
        return statSync(absolute).isDirectory()
            ? collectCss(absolute)
            : absolute.endsWith('.css')
                ? [absolute]
                : []
    })
}

test('画布 URL 把 token 放在 fragment 且不改变资源请求', () => {
    const token = 'ab'.repeat(32)
    const url = new URL(createCanvasPageUrl('tauri://localhost/project/entry', token))
    assert.equal(url.pathname, '/canvas.html')
    assert.equal(url.search, '')
    assert.equal(url.hash, `#token=${token}`)
    assert.equal(resolveCanvasHeight(320.2, 160), 321)
    assert.equal(resolveCanvasHeight(Number.NaN, 160), 160)
})

test('宿主只转交作者白名单中的导航意图', () => {
    assert.equal(canForwardCanvasNavigationIntent('#section'), true)
    assert.equal(canForwardCanvasNavigationIntent('entry://018f47a2-3b4c-7d5e-8f90-123456789abc'), true)
    assert.equal(canForwardCanvasNavigationIntent('https://example.invalid'), true)
    assert.equal(canForwardCanvasNavigationIntent('javascript:alert(1)'), false)
    assert.equal(canForwardCanvasNavigationIntent('fc://project/entry/018f47a2-3b4c-7d5e-8f90-123456789abc'), false)
})

test('React 宿主固定使用独立 src 与最小 allow-scripts 沙箱', () => {
    const source = readFileSync(new URL('./PageDocumentCanvas.tsx', import.meta.url), 'utf8')
    assert.match(source, /sandbox="allow-scripts"/u)
    assert.match(source, /src=\{source\}/u)
    assert.doesNotMatch(source, /srcDoc|allow-same-origin|allow-top-navigation|allow-popups|allow-forms/u)
})

test('画布 HTML 没有内联脚本并叠加无网络 CSP', () => {
    const source = readFileSync(new URL('../../../../../canvas.html', import.meta.url), 'utf8')
    assert.match(source, /default-src 'none'/u)
    assert.match(source, /connect-src 'none'/u)
    assert.match(source, /img-src 'none'/u)
    assert.match(source, /form-action 'none'/u)
    assert.match(source, /script type="module" src=/u)
    assert.doesNotMatch(source, /<script(?:\s[^>]*)?>\s*[^<\s]/u)
})

test('page-document 下 CSS 不含颜色字面量', () => {
    const colorLiteral = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\s*\(/iu
    for (const file of collectCss(featureRoot)) {
        assert.doesNotMatch(readFileSync(file, 'utf8'), colorLiteral, path.relative(featureRoot, file))
    }
})
