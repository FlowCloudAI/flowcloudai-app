// 本测试固定读取错误优先于空会话显示，防止失败状态永久伪装成加载中。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {resolvePageDocumentEditorLoadView} from './pageDocumentEditorLoadState.ts'

describe('page document editor load state', () => {
    it('读取失败且会话为空时优先显示错误', () => {
        assert.equal(resolvePageDocumentEditorLoadView('error', false), 'error')
    })

    it('加载中或尚无会话时显示加载态，读取成功后显示编辑器', () => {
        assert.equal(resolvePageDocumentEditorLoadView('loading', false), 'loading')
        assert.equal(resolvePageDocumentEditorLoadView('ready', false), 'loading')
        assert.equal(resolvePageDocumentEditorLoadView('ready', true), 'ready')
    })
})
