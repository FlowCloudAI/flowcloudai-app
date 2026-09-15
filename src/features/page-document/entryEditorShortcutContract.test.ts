// 本测试固定页面模式与词条 Markdown 编辑器之间的全局快捷键所有权边界。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {shouldHandleEntryEditorShortcut} from '../entries/lib/entryEditorShortcutModel.ts'

describe('entry editor shortcut ownership', () => {
    it('页面模式不处理保存、撤销与重做快捷键', () => {
        for (const key of ['s', 'z', 'y']) {
            assert.equal(shouldHandleEntryEditorShortcut('page', key), false)
        }
    })

    it('编辑与浏览模式保持原有词条快捷键处理', () => {
        for (const mode of ['edit', 'browse'] as const) {
            for (const key of ['s', 'z', 'y']) {
                assert.equal(shouldHandleEntryEditorShortcut(mode, key), true)
            }
        }
    })
})
