// 本测试锁定旧 Markdown 的有限转换范围、逐字降级与页面文档安全契约。

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, it} from 'node:test'
import {compileCanvasPreview, CANVAS_BASE_PROJECT_CSS, CANVAS_BASE_PROJECT_HTML} from '../canvas/host/compiledPreview.ts'
import {convertMarkdownToPageDocument} from './markdownDocumentConversion.ts'

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const ASSET_ID = '22222222-2222-4222-8222-222222222222'
const TARGET_ID = '33333333-3333-4333-8333-333333333333'

function allocator() {
    let sequence = 0
    return () => {
        sequence += 1
        return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
    }
}

function compile(markdown: string) {
    const conversion = convertMarkdownToPageDocument(ENTRY_ID, markdown, allocator())
    const preview = compileCanvasPreview({
        projectArticleHtml: CANVAS_BASE_PROJECT_HTML,
        projectStyleCss: CANVAS_BASE_PROJECT_CSS,
        entryArticleHtml: conversion.articleHtml,
        entryStyleCss: '',
        metadata: {id: ENTRY_ID, title: '旧正文', summary: '', tags: []},
    })
    assert.equal(preview.diagnostics.filter(item => item.severity === 'error').length, 0)
    assert.ok(preview.html)
    return conversion
}

describe('Markdown 临时转换层', () => {
    it('标题一至六级转换为受管 heading', () => {
        const result = compile('# 一级\n## 二级\n### 三级\n#### 四级\n##### 五级\n###### 六级')
        assert.equal(result.articleHtml.match(/data-fc-node-kind="heading"/gu)?.length, 6)
        assert.match(result.articleHtml, /<h2 [^>]*data-fc-node-kind="heading"/u)
        assert.match(result.articleHtml, /<h6 [^>]*data-fc-node-kind="heading"/u)
        assert.equal(result.derivedText, '一级\n二级\n三级\n四级\n五级\n六级')
    })

    it('空行分段且单个换行保留为段内 br', () => {
        const result = compile('第一行\n第二行\n\n第二段')
        assert.match(result.articleHtml, />第一行<br>第二行<\/p>/u)
        assert.equal(result.articleHtml.match(/data-fc-node-kind="paragraph"/gu)?.length, 2)
        assert.equal(result.derivedText, '第一行\n第二行\n第二段')
    })

    it('无序与有序列表生成 list 和带独立 UUID 的 list-item', () => {
        const result = compile('- 甲\n- 乙\n\n1. 丙\n2. 丁')
        assert.match(result.articleHtml, /<ul [^>]*data-fc-node-kind="list">/u)
        assert.match(result.articleHtml, /<ol [^>]*data-fc-node-kind="list">/u)
        assert.equal(result.articleHtml.match(/data-fc-node-kind="list-item"/gu)?.length, 4)
        assert.equal(result.derivedText, '甲\n乙\n丙\n丁')
    })

    it('两种旧图片引用转换为 fcasset 资产节点并保留 alt', () => {
        const result = compile(`![海图](fc://self/image/${ASSET_ID})\n\n![航线](fcimg:${ASSET_ID})`)
        assert.equal(result.articleHtml.match(new RegExp(`src="fcasset://${ASSET_ID}"`, 'gu'))?.length, 2)
        assert.match(result.articleHtml, /data-fc-node-kind="asset"/u)
        assert.match(result.articleHtml, /alt="海图"/u)
        assert.equal(result.derivedText, '海图\n航线')
    })

    it('词条、外部、邮件、电话与标题链接保持安全 href', () => {
        const markdown = `[本词条](fc://self/entry/${TARGET_ID}) [旧链接](entry://${TARGET_ID}) `
            + '[网页](https://example.invalid/a) [邮件](mailto:a@example.invalid) [电话](tel:+8610) [[待建/词条]]'
        const result = compile(markdown)
        assert.match(result.articleHtml, new RegExp(`href="fc://self/entry/${TARGET_ID}"`, 'u'))
        assert.match(result.articleHtml, new RegExp(`href="entry://${TARGET_ID}"`, 'u'))
        assert.match(result.articleHtml, /href="https:\/\/example\.invalid\/a"/u)
        assert.match(result.articleHtml, /href="entry-title:\/\/%E5%BE%85%E5%BB%BA%2F%E8%AF%8D%E6%9D%A1"/u)
        assert.equal(result.derivedText, '本词条 旧链接 网页 邮件 电话 待建/词条')
    })

    it('行内强调与代码去标记但不丢字', () => {
        const result = compile('**粗体**、*强调*、`代码`')
        assert.match(result.articleHtml, />粗体、强调、代码<\/p>/u)
        assert.equal(result.derivedText, '粗体、强调、代码')
    })

    it('代码块、引用、表格、原始 HTML 与非法图片整段转义后逐字保留', () => {
        const samples = [
            '```ts\nconst x = "<tag>"\n```',
            '> 引用 **不解释**',
            '| A | B |\n| --- | --- |\n| 1 | 2 |',
            '<aside onclick="x">原始 HTML</aside>',
            '![外链](https://example.invalid/a.png)',
        ]
        for (const sample of samples) {
            const result = compile(sample)
            assert.equal(result.derivedText, sample)
            assert.doesNotMatch(result.articleHtml, /<aside[\s>]/iu)
        }
    })

    it('转换只返回新草稿且不修改输入字符串', () => {
        const markdown = '原始正文'
        const result = compile(markdown)
        assert.equal(markdown, '原始正文')
        assert.equal(result.blockCount, 1)
        assert.match(result.articleHtml, /data-fc-entry-patch/u)
    })

    it('前端转换产物与 Rust 共用的合法样例逐字一致', () => {
        const markdown = `# 标题\n\n段落 [内链](entry://${TARGET_ID})\n\n- 项目\n\n![图](fcimg:${ASSET_ID})`
        const converted = convertMarkdownToPageDocument(ENTRY_ID, markdown, allocator())
        const fixture = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../tests/fixtures/page-document/v1/markdown-converted-article.html'), 'utf8')
        assert.equal(converted.articleHtml, fixture.trimEnd())
    })
})
