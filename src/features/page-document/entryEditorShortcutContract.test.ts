// 本测试固定桌面页面编辑器与词条外壳之间的全局快捷键所有权边界。

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {describe, it} from 'node:test'
import {shouldHandleEntryEditorShortcut} from '../entries/lib/entryEditorShortcutModel.ts'

describe('entry editor shortcut ownership', () => {
    it('编辑模式不处理保存、撤销与重做快捷键', () => {
        for (const key of ['s', 'z', 'y']) {
            assert.equal(shouldHandleEntryEditorShortcut('edit', key), false)
        }
    })

    it('浏览模式保留词条外壳的既有快捷键判定', () => {
        for (const key of ['s', 'z', 'y']) {
            assert.equal(shouldHandleEntryEditorShortcut('browse', key), true)
        }
    })

    it('画布保存意图复用页面编辑器 handleSave，查找只保留待接入口', () => {
        const source = readFileSync(new URL('./components/PageDocumentEditor.tsx', import.meta.url), 'utf8')
        assert.match(source, /onHistoryIntent=\{mode === 'visual'[\s\S]*?action === 'save'[\s\S]*?void handleSave\(\)/u)
        assert.match(source, /onFindIntent=\{undefined \/\* TODO：页面文档尚无查找面板/u)
    })
})
