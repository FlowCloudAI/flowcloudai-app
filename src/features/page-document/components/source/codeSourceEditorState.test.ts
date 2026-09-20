import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {history, redo, undo} from '@codemirror/commands'
import {EditorState, type Transaction} from '@codemirror/state'
import type {SourceFileName} from '../../domain/contract.ts'
import {
    type CodeSourceEditorStateCache,
    sourceEditorHistory,
    synchronizeExternalEditorState,
} from './codeSourceEditorState.ts'

function userEdit(state: EditorState, from: number, insert: string): EditorState {
    return state.update({changes: {from, insert}, userEvent: 'input.type'}).state
}

function runHistoryCommand(state: EditorState, command: typeof undo): EditorState {
    let current = state
    const applied = command({
        get state() {
            return current
        },
        dispatch(transaction: Transaction) {
            current = transaction.state
        },
    })
    assert.equal(applied, true)
    return current
}

function initialState(value: string): EditorState {
    return EditorState.create({doc: value, extensions: [history()]})
}

function restore(cache: CodeSourceEditorStateCache, file: SourceFileName): EditorState {
    const state = cache.get(file)
    assert.ok(state)
    return state
}

describe('源码编辑器文件级历史', () => {
    it('article 编辑后往返 style 页签仍可撤销和重做', () => {
        const cache: CodeSourceEditorStateCache = new Map()
        cache.set('article.html', userEdit(initialState('正文'), 2, '修改'))
        cache.set('style.css', initialState('.page {}'))

        let article = restore(cache, 'article.html')
        assert.deepEqual(sourceEditorHistory(article), {canUndo: true, canRedo: false})
        article = runHistoryCommand(article, undo)
        assert.equal(article.doc.toString(), '正文')
        assert.deepEqual(sourceEditorHistory(article), {canUndo: false, canRedo: true})
        article = runHistoryCommand(article, redo)
        assert.equal(article.doc.toString(), '正文修改')
    })

    it('两个文件的撤销历史互不干扰', () => {
        const cache: CodeSourceEditorStateCache = new Map()
        cache.set('article.html', userEdit(initialState('正文'), 2, '甲'))
        cache.set('style.css', userEdit(initialState('.page {}'), 6, 'color:red;'))

        const article = runHistoryCommand(restore(cache, 'article.html'), undo)
        assert.equal(article.doc.toString(), '正文')
        assert.equal(restore(cache, 'style.css').doc.toString(), '.page color:red;{}')

        const style = runHistoryCommand(restore(cache, 'style.css'), undo)
        assert.equal(style.doc.toString(), '.page {}')
    })

    it('外部同步不进入历史，撤销只退回用户自己的上一步编辑', () => {
        let article = userEdit(initialState('正文\n结尾'), 2, '修改')
        article = synchronizeExternalEditorState(article, '正文修改\n结尾\n外部诊断修复')

        assert.equal(sourceEditorHistory(article).canUndo, true)
        article = runHistoryCommand(article, undo)
        assert.equal(article.doc.toString(), '正文\n结尾\n外部诊断修复')
    })
})
