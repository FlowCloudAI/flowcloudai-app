// 固定页面编辑外壳与浏览卡片的画布内边距；作者文档 CSS 仍由同一编译路径决定。

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import postcss from 'postcss'

function declaration(source: string, selector: string, property: string): string | null {
    const stylesheet = postcss.parse(source)
    let value: string | null = null
    stylesheet.walkRules(rule => {
        if (rule.selector !== selector) return
        rule.walkDecls(property, item => { value = item.value })
    })
    return value
}

test('编辑页卡片和代码预览沿用浏览卡片的画布内边距', () => {
    const browseCss = readFileSync(new URL('../canvas/entry/PageDocumentCanvasEntry.css', import.meta.url), 'utf8')
    const editorCss = readFileSync(new URL('./PageDocumentEditor.css', import.meta.url), 'utf8')
    const browsePadding = declaration(browseCss, '.page-document-canvas-entry', 'padding')

    assert.equal(browsePadding, 'var(--fc-space-lg)')
    assert.equal(declaration(editorCss, '.page-document-editor__page-card', 'padding'), browsePadding)
    assert.equal(declaration(editorCss, '.page-document-source-workspace__preview-canvas', 'padding'), browsePadding)
    assert.equal(declaration(editorCss, '.page-document-editor__page-card', 'box-sizing'), 'border-box')
})
