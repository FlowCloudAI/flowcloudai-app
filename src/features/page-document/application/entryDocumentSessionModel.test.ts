// 本测试固定词条页面文档会话的保存、重试、冲突与前端阻断语义。
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {PageDocument, SavePageDocumentResult} from '../../../api/pageDocument.ts'
import {
    acceptEntryDocumentSave,
    canSaveEntryDocument,
    createEntryDocumentSessionState,
    editEntryDocumentSource,
    finishEntryDocumentValidation,
    prepareEntryDocumentSave,
    rejectEntryDocumentSave,
} from './entryDocumentSessionModel.ts'

const ENTRY_ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

const identity = {
    entryId: ENTRY_ID,
    projectId: PROJECT_ID,
    title: '雾港档案馆',
    summary: '测试摘要',
    markdown: 'Markdown 正文',
}

function entryHtml(text = '原正文'): string {
    return `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><p data-fc-node-id="22222222-2222-4222-8222-222222222222" data-fc-node-kind="paragraph">${text}</p></template></template>`
}

function document(revision = 2, text = '原正文'): PageDocument {
    return {
        entryId: ENTRY_ID,
        projectId: PROJECT_ID,
        html: entryHtml(text),
        css: '',
        derivedText: text,
        revision,
        modifiedBy: 'local',
        updatedAt: '2026-09-15T00:00:00Z',
    }
}

function validEditedState() {
    return finishEntryDocumentValidation(
        editEntryDocumentSource(
            createEntryDocumentSessionState(identity, document()),
            'article.html',
            entryHtml('本地草稿'),
        ),
    )
}

function saveResult(
    preparation: Extract<ReturnType<typeof prepareEntryDocumentSave>, {status: 'ready'}>,
    revision: number,
): SavePageDocumentResult {
    return {
        document: {
            ...document(revision, '本地草稿'),
            html: preparation.input.html,
            css: preparation.input.css,
        },
        revision,
        requestKey: preparation.input.requestKey,
    }
}

describe('entry page document session', () => {
    it('保存成功后回到 clean 并推进 revision', () => {
        const prepared = prepareEntryDocumentSave(validEditedState(), () => 'save-success')
        assert.equal(prepared.status, 'ready')
        if (prepared.status !== 'ready') return
        const saved = acceptEntryDocumentSave(prepared.state, saveResult(prepared, 3))
        assert.equal(saved.model.entry.phase, 'clean')
        assert.equal(saved.model.entry.baseRevision, 3)
        assert.equal(saved.persistedRevision, 3)
        assert.equal(saved.pendingSave, null)
    })

    it('保存失败时保留本地草稿', () => {
        const prepared = prepareEntryDocumentSave(validEditedState(), () => 'save-failure')
        assert.equal(prepared.status, 'ready')
        if (prepared.status !== 'ready') return
        const failed = rejectEntryDocumentSave(prepared.state, {
            kind: 'other',
            code: 'CORE_CLIENT_INTERNAL_ERROR',
            message: '磁盘暂不可用',
        })
        assert.equal(failed.model.entry.phase, 'failed')
        assert.equal(failed.model.entry.sources['article.html'], entryHtml('本地草稿'))
        assert.equal(failed.pendingSave?.requestKey, 'save-failure')
    })

    it('冲突保留草稿并暴露磁盘最新版本', () => {
        const prepared = prepareEntryDocumentSave(validEditedState(), () => 'save-conflict')
        assert.equal(prepared.status, 'ready')
        if (prepared.status !== 'ready') return
        const latest = document(3, '磁盘最新')
        const conflicted = rejectEntryDocumentSave(
            prepared.state,
            {kind: 'conflict', message: '版本冲突', currentRevision: 3},
            latest,
        )
        assert.equal(conflicted.model.entry.phase, 'conflict')
        assert.equal(conflicted.model.entry.sources['article.html'], entryHtml('本地草稿'))
        assert.equal(conflicted.conflict?.currentRevision, 3)
        assert.equal(conflicted.conflict?.latestDocument?.html, entryHtml('磁盘最新'))
    })

    it('相同内容失败重试复用 requestKey', () => {
        const first = prepareEntryDocumentSave(validEditedState(), () => 'stable-key')
        assert.equal(first.status, 'ready')
        if (first.status !== 'ready') return
        const failed = rejectEntryDocumentSave(first.state, {
            kind: 'other',
            code: 'CORE_CLIENT_INTERNAL_ERROR',
            message: '稍后重试',
        })
        const retry = prepareEntryDocumentSave(failed, () => 'must-not-be-used')
        assert.equal(retry.status, 'ready')
        if (retry.status !== 'ready') return
        assert.equal(retry.input.requestKey, 'stable-key')
    })

    it('新文档首次保存不携带 expectedRevision', () => {
        const prepared = prepareEntryDocumentSave(
            createEntryDocumentSessionState(identity, null),
            () => 'new-document',
        )
        assert.equal(prepared.status, 'ready')
        if (prepared.status !== 'ready') return
        assert.equal('expectedRevision' in prepared.input, false)
    })

    it('存在阻断诊断时禁止保存并保留上一次预览', () => {
        const initial = createEntryDocumentSessionState(identity, document())
        const validated = finishEntryDocumentValidation(
            editEntryDocumentSource(initial, 'article.html', '<script>alert(1)</script>'),
        )
        assert.equal(canSaveEntryDocument(validated), false)
        assert.equal(validated.preview, initial.preview)
        assert.equal(validated.previewStale, true)
        assert.ok(validated.model.entry.diagnostics.some(item => item.severity === 'error'))
        assert.equal(prepareEntryDocumentSave(validated, () => 'blocked').status, 'blocked')
    })
})
