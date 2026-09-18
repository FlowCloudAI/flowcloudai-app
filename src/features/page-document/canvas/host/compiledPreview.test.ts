// 这些测试固定正常宿主路径必须经过 previewCompiler，并把完整文档安全拆为画布 HTML/CSS。

import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {
    CANVAS_BASE_PROJECT_CSS,
    CANVAS_BASE_PROJECT_HTML,
    compileCanvasPreview,
} from './compiledPreview.ts'
import {convertMarkdownToPageDocument} from '../../application/markdownDocumentConversion.ts'
import {parseCssSource} from '../../domain/engine/cssParser.ts'
import {guardDocumentSources} from '../../domain/engine/guard.ts'

const ENTRY_ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'

test('新旧项目层序均可读，组件层仅接受按定义选择器且作者层仍关闭', () => {
    for (const css of [
        '@layer fc-renderer, fc-project, fc-entry, fc-node;',
        CANVAS_BASE_PROJECT_CSS,
    ]) {
        assert.deepEqual(parseCssSource(css, 'project').diagnostics, [])
    }
    const component = parseCssSource(
        `${CANVAS_BASE_PROJECT_CSS.split('\n')[0]}
@layer fc-component { [data-fc-component="11111111-1111-4111-8111-111111111111"] { color: red; } }`,
        'project',
    )
    assert.deepEqual(component.diagnostics, [])
    assert.ok(
        guardDocumentSources([], [component]).diagnostics.some(
            item => item.code === 'selector_scope_violation',
        ),
    )

    const instanceSelector = parseCssSource(
        `${CANVAS_BASE_PROJECT_CSS.split('\n')[0]}
@layer fc-component { [data-fc-instance="22222222-2222-4222-8222-222222222222"] { color: red; } }`,
        'project',
    )
    assert.ok(
        guardDocumentSources([], [instanceSelector]).diagnostics.some(
            item => item.code === 'selector_scope_violation',
        ),
    )

    const author = parseCssSource(
        '@layer fc-author { [data-fc-component="11111111-1111-4111-8111-111111111111"] { color: red; } }',
        'project',
    )
    assert.ok(author.diagnostics.some(item => item.code === 'layer_scope_violation'))
    assert.ok(
        guardDocumentSources([], [author]).diagnostics.some(
            item => item.code === 'selector_scope_violation',
        ),
    )
})

test('旧 Markdown 临时转换经模板合并后得到绑定标题、正文与基线 CSS', () => {
    const result = compileCanvasPreview({
        projectArticleHtml: CANVAS_BASE_PROJECT_HTML,
        projectStyleCss: CANVAS_BASE_PROJECT_CSS,
        entryArticleHtml: convertMarkdownToPageDocument(ENTRY_ID, '第一段\n\n第二段').articleHtml,
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
