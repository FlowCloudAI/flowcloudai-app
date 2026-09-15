// 本测试固定 Tauri 页面文档错误到编辑会话错误的窄适配，避免普通拒绝被误判为版本冲突。
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parsePageDocumentSaveError} from '../../../api/pageDocument.ts'

describe('page document save error adapter', () => {
    it('解析版本冲突及当前 revision', () => {
        assert.deepEqual(
            parsePageDocumentSaveError({
                code: 'DOCUMENT_REVISION_CONFLICT',
                message: '词条页面 revision 冲突',
                detail: {currentRevision: 7},
            }),
            {kind: 'conflict', message: '词条页面 revision 冲突', currentRevision: 7},
        )
    })

    it('解析 Rust 返回的结构化诊断', () => {
        const diagnostic = {
            severity: 'error' as const,
            category: 'security',
            code: 'forbidden_html_element',
            message: '禁止 script 元素。',
            file: 'article.html' as const,
        }
        assert.deepEqual(
            parsePageDocumentSaveError({
                code: 'VALIDATION_FORMAT_ERROR',
                message: '页面文档校验失败',
                detail: {diagnostics: [diagnostic]},
            }),
            {kind: 'validation', message: '页面文档校验失败', diagnostics: [diagnostic]},
        )
    })

    it('保留其他错误且不误报冲突', () => {
        assert.deepEqual(
            parsePageDocumentSaveError({
                code: 'CORE_CLIENT_INTERNAL_ERROR',
                message: '请求幂等键已用于不同内容',
            }),
            {
                kind: 'other',
                code: 'CORE_CLIENT_INTERNAL_ERROR',
                message: '请求幂等键已用于不同内容',
            },
        )
    })
})
