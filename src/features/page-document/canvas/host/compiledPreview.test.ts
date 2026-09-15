// 这些测试固定正常宿主路径必须经过 previewCompiler，并把完整文档安全拆为画布 HTML/CSS。

import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {
    CANVAS_BASE_PROJECT_CSS,
    CANVAS_BASE_PROJECT_HTML,
    compileCanvasPreview,
    wrapMarkdownFallback,
} from './compiledPreview.ts'
import {markdownParagraphsToHtml} from './markdownFallback.ts'

const ENTRY_ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'

test('Markdown 降级经模板合并后得到绑定标题、正文与基线 CSS', () => {
    const result = compileCanvasPreview({
        projectArticleHtml: CANVAS_BASE_PROJECT_HTML,
        projectStyleCss: CANVAS_BASE_PROJECT_CSS,
        entryArticleHtml: wrapMarkdownFallback(ENTRY_ID, markdownParagraphsToHtml('第一段\n\n第二段')),
        entryStyleCss: '',
        metadata: {id: ENTRY_ID, title: '降级词条', summary: '摘要', tags: []},
    })
    assert.ok(result.html)
    assert.ok(result.css)
    assert.doesNotMatch(result.html ?? '', /<template|<style/iu)
    assert.match(result.html ?? '', /降级词条/)
    assert.match(result.html ?? '', /第一段/)
    assert.match(result.css ?? '', /@layer fc-renderer/)
    assert.match(result.css ?? '', /font-family: system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;/u)
    assert.match(result.css ?? '', /line-height: 1\.6;/u)
})

test('共享合法样例经 previewCompiler 后保留托管节点与链接', () => {
    const root = new URL('../../../../../tests/fixtures/page-document/v1/', import.meta.url)
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')) as {
        entry: {id: string; title: string; summary: string; tags: string[]}
        assets: Array<{id: string}>
    }
    const result = compileCanvasPreview({
        projectArticleHtml: readFileSync(new URL('project/article.html', root), 'utf8'),
        projectStyleCss: readFileSync(new URL('project/style.css', root), 'utf8'),
        entryArticleHtml: readFileSync(new URL('entry/article.html', root), 'utf8'),
        entryStyleCss: readFileSync(new URL('entry/style.css', root), 'utf8'),
        metadata: manifest.entry,
        assetIds: manifest.assets.map(asset => asset.id),
    })
    assert.equal(result.diagnostics.filter(item => item.severity === 'error').length, 0)
    assert.match(result.html ?? '', /data-fc-node-id="44444444-4444-4444-8444-444444444444"/)
    assert.match(result.html ?? '', /href="#linked-section"/)
})
