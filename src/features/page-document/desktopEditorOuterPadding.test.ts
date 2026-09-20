// 固定桌面词条编辑页由满高工作台承载，页面级不再通过外层留白制造卡片。

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import postcss from 'postcss'

test('桌面词条页使用满高网格且页面编辑器不再是带外边距的卡片', () => {
    const css = readFileSync(new URL('../entries/components/EntryEditor.css', import.meta.url), 'utf8')
    const stylesheet = postcss.parse(css)
    const page = stylesheet.nodes.find(node => node.type === 'rule' && node.selector === '.entry-editor-page')
    const body = stylesheet.nodes.find(node => node.type === 'rule' && node.selector === '.entry-editor-workspace__body')
    const document = stylesheet.nodes.find(node => node.type === 'rule'
        && node.selector === '.entry-editor-workspace__document')
    const editorCss = readFileSync(new URL('components/PageDocumentEditor.css', import.meta.url), 'utf8')
    const editorStylesheet = postcss.parse(editorCss)
    const editor = editorStylesheet.nodes.find(node => node.type === 'rule' && node.selector === '.page-document-editor')

    assert.ok(page && page.type === 'rule')
    assert.ok(body && body.type === 'rule')
    assert.ok(document && document.type === 'rule')
    assert.ok(editor && editor.type === 'rule')
    assert.ok(page.nodes.some(node => node.type === 'decl' && node.prop === 'display' && node.value === 'grid'))
    assert.ok(page.nodes.some(node => node.type === 'decl' && node.prop === 'overflow' && node.value === 'hidden'))
    assert.ok(document.nodes.some(node => node.type === 'decl'
        && node.prop === 'min-width' && node.value === 'var(--workspace-page-content-min-width)'))
    assert.equal(body.nodes.some(node => node.type === 'decl' && node.prop === 'padding'), false)
    assert.ok(editor.nodes.some(node => node.type === 'decl' && node.prop === 'height' && node.value === '100%'))
    assert.ok(editor.nodes.some(node => node.type === 'decl' && node.prop === 'min-height' && node.value === '0'))
    assert.equal(editor.nodes.some(node => node.type === 'decl'
        && (node.prop === 'border' || node.prop === 'border-radius')), false)
})

test('页面编辑工作条挂入词条常驻顶栏且不再占用第二行', () => {
    const workspace = readFileSync(new URL('../entries/components/EntryEditorWorkspace.tsx', import.meta.url), 'utf8')
    const editor = readFileSync(new URL('components/PageDocumentEditor.tsx', import.meta.url), 'utf8')

    assert.match(workspace, /entry-editor-workspace__header-center[\s\S]*setPageDocumentWorkbarHost/u)
    assert.match(editor, /workbarPortalHost && createPortal\(workbarControls, workbarPortalHost\)/u)
    assert.match(editor, /!workbarPortalHost && <header className="page-document-editor__workbar"/u)
})
