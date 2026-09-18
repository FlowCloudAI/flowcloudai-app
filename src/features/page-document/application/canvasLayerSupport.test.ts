// 锁定旧 WebView 无法进入页面编辑的宿主入口，同时覆盖初始模式和后续切换。

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {resolveSupportedEntryMode, supportsPageDocumentLayers} from './canvasLayerSupport.ts'

test('CSSLayerBlockRule 缺失时页面编辑模式被关闭', () => {
    assert.equal(supportsPageDocumentLayers({}), false)
    assert.equal(supportsPageDocumentLayers({CSSLayerBlockRule: undefined}), false)
    assert.equal(resolveSupportedEntryMode('edit', false), 'browse')
    assert.equal(resolveSupportedEntryMode('browse', false), 'browse')
    assert.equal(supportsPageDocumentLayers({CSSLayerBlockRule: class CSSLayerBlockRule {}}), true)
    assert.equal(resolveSupportedEntryMode('edit', true), 'edit')
})

test('桌面入口、词条重载和草稿恢复共用宿主能力门禁与升级提示', () => {
    const source = readFileSync(new URL('../../entries/components/EntryEditor.tsx', import.meta.url), 'utf8')
    assert.match(source, /supportsPageDocumentLayers\(window\)/u)
    assert.match(source, /resolveSupportedEntryMode\(initialEditorMode, PAGE_DOCUMENT_LAYERS_SUPPORTED\)/u)
    assert.match(source, /if \(!PAGE_DOCUMENT_LAYERS_SUPPORTED\) \{\s*setLayerSupportNoticeOpen\(true\)/u)
    assert.match(source, /aria-disabled=\{!PAGE_DOCUMENT_LAYERS_SUPPORTED\}/u)
    assert.match(source, /<Overlay[\s\S]*?更新系统 WebView/u)
    assert.match(source, /editorMode === 'edit' && PAGE_DOCUMENT_LAYERS_SUPPORTED && \(/u)
})
