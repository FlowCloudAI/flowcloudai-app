// 这些测试固定独立页面 URL、iframe 沙箱、宿主导航复核和页面文档 CSS 无颜色字面量约束。

import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync, readdirSync, statSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {createCanvasPageUrl, resolveCanvasHeight} from './canvasPageUrl.ts'
import {canForwardCanvasNavigationIntent} from './navigationIntent.ts'

const featureRoot = fileURLToPath(new URL('../../', import.meta.url))
const appRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const uiStyleRoot = fileURLToPath(new URL('../../../../../../lib_ui/ui/src/style/', import.meta.url))
const appGlobalStyles = [
    path.join(appRoot, 'src/App.css'),
    path.join(appRoot, 'src/glassEffect.css'),
    path.join(appRoot, 'src/assets/fonts/fonts.css'),
    path.join(appRoot, 'src/app/mobile/mobileTokens.css'),
    path.join(appRoot, 'src/app/mobile/mobileAccessibility.css'),
    path.join(appRoot, 'src/app/mobile/mobileTypography.css'),
]

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

function collectCustomProperties(source: string, pattern: RegExp, group = 1): string[] {
    return [...source.matchAll(pattern)].flatMap(match => match[group] ? [match[group]] : [])
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

test('双链候选消息只经已鉴权 gate 转交给宿主回调', () => {
    const source = readFileSync(new URL('./PageDocumentCanvas.tsx', import.meta.url), 'utf8')
    const gateIndex = source.indexOf('const message = gate.accept(event)')
    const callbackIndex = source.indexOf("if (message.type === 'link-candidate-intent')")
    assert.ok(gateIndex >= 0 && callbackIndex > gateIndex)
    assert.match(source.slice(callbackIndex), /latest\.current\.onLinkCandidateIntent\?\.\(message\)/u)
})

test('保存与查找快捷键只经已鉴权 gate 转交一次宿主回调', () => {
    const source = readFileSync(new URL('./PageDocumentCanvas.tsx', import.meta.url), 'utf8')
    const gateIndex = source.indexOf('const message = gate.accept(event)')
    const historyIndex = source.indexOf("if (message.type === 'history-intent')")
    const findIndex = source.indexOf("if (message.type === 'find-intent')")
    assert.ok(gateIndex >= 0 && historyIndex > gateIndex && findIndex > historyIndex)
    assert.match(source.slice(historyIndex, findIndex), /latest\.current\.onHistoryIntent\?\.\(message\.action\)/u)
    assert.match(source.slice(findIndex), /latest\.current\.onFindIntent\?\.\(\)/u)
})

test('画布 HTML 源文件只保留内联哈希构建所需的安全骨架和占位', () => {
    const source = readFileSync(new URL('../../../../../canvas.html', import.meta.url), 'utf8')
    assert.match(source, /default-src 'none'/u)
    assert.match(source, /connect-src 'none'/u)
    assert.match(source, /img-src data:/u)
    assert.doesNotMatch(source, /img-src[^;]*blob:|img-src[^;]*https?:/u)
    assert.match(source, /form-action 'none'/u)
    assert.match(source, /script-src __PAGE_DOCUMENT_CANVAS_SCRIPT_CSP__/u)
    assert.match(source, /style-src 'unsafe-inline'/u)
    assert.match(source, /<!-- PAGE_DOCUMENT_CANVAS_RUNTIME -->/u)
    const rootIndex = source.indexOf('<main id="page-document-canvas-root"></main>')
    const runtimeIndex = source.indexOf('<!-- PAGE_DOCUMENT_CANVAS_RUNTIME -->')
    assert.ok(rootIndex > source.indexOf('<body>'))
    assert.ok(runtimeIndex > rootIndex)
    assert.ok(runtimeIndex < source.indexOf('</body>'))
    assert.doesNotMatch(source, /<script\b|<style\b|<link\b[^>]*stylesheet/iu)
    assert.doesNotMatch(source, /type="module"|crossorigin|modulepreload/u)
})

test('跳过校验探针在画布上方说明原始片段没有模板与基础样式', () => {
    const source = readFileSync(new URL('../development/PageDocumentProbeSection.tsx', import.meta.url), 'utf8')
    const notice = '跳过模式直接发送原始片段，不含项目模板与基础样式，排版简陋属正常'
    const noticeIndex = source.indexOf(notice)
    assert.match(source, /\{bypassAuthorGuard && \(/u)
    assert.ok(noticeIndex >= 0)
    assert.ok(noticeIndex < source.indexOf('<PageDocumentCanvas'))
    assert.match(source.slice(0, noticeIndex), /className="page-document-probe-section__state" role="status">\s*$/u)
})

test('page-document 下 CSS 不含颜色字面量', () => {
    const colorLiteral = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\s*\(/iu
    for (const file of collectCss(featureRoot)) {
        assert.doesNotMatch(readFileSync(file, 'utf8'), colorLiteral, path.relative(featureRoot, file))
    }
})

test('page-document 宿主 CSS 使用的每个设计 token 都有全局定义', () => {
    const definitionPattern = /(^|[;{])\s*(--fc-[a-z0-9-]+)\s*:/gimu
    const usePattern = /var\(\s*(--fc-[a-z0-9-]+)/giu
    const definitions = new Set([
        ...collectCss(uiStyleRoot),
        ...appGlobalStyles,
    ].flatMap(file => collectCustomProperties(readFileSync(file, 'utf8'), definitionPattern, 2)))
    const runtimePath = path.join(featureRoot, 'canvas/runtime/runtime.css')
    const unresolved: string[] = []

    for (const file of collectCss(featureRoot)) {
        const source = readFileSync(file, 'utf8')
        const uses = collectCustomProperties(source, usePattern)
        if (file === runtimePath) {
            const runtimeDefinitions = new Set(
                [...source.matchAll(definitionPattern)].map(match => match[2]),
            )
            for (const token of uses) {
                if (!token.startsWith('--fc-entry-') || !runtimeDefinitions.has(token)) {
                    unresolved.push(`${path.relative(featureRoot, file)}: ${token}`)
                }
            }
            continue
        }
        for (const token of uses) {
            if (!definitions.has(token)) unresolved.push(`${path.relative(featureRoot, file)}: ${token}`)
        }
    }

    assert.deepEqual(unresolved, [])
})
