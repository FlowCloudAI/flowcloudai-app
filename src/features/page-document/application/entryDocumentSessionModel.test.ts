// 本测试固定词条页面文档会话的保存、重试、冲突与前端阻断语义。
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {RFC_9562_UUID_PATTERN} from '../domain/uuidPolicy.ts'
import type {PageDocument, SavePageDocumentResult} from '../../../api/pageDocument.ts'
import {
    acceptEntryDocumentSave,
    canSaveEntryDocument,
    createEntryDocumentSessionState,
    editEntryDocumentSource,
    finishEntryDocumentValidation,
    keepEntryDocumentDraft,
    loadLatestEntryDocument,
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
    it('源码校验补齐缺失身份并去重，保存发送归一化后的同一草稿', () => {
        const duplicate = '22222222-2222-4222-8222-222222222222'
        const missingReplacement = '33333333-3333-4333-8333-333333333333'
        const duplicateReplacement = '44444444-4444-4444-8444-444444444444'
        const source = `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><p data-fc-node-id="${duplicate}" data-fc-node-kind="paragraph">保留</p><p data-fc-node-kind="paragraph">补身份</p><h2 data-fc-node-id="${duplicate}" data-fc-node-kind="heading">去重</h2></template></template>`
        const edited = editEntryDocumentSource(
            createEntryDocumentSessionState(identity, document()),
            'article.html',
            source,
        )
        const ids = [missingReplacement, duplicateReplacement]
        const validated = finishEntryDocumentValidation(
            edited,
            () => ids.shift() ?? duplicateReplacement,
        )

        assert.equal(validated.model.entry.validationPhase, 'valid')
        assert.match(validated.model.entry.sources['article.html'], new RegExp(missingReplacement, 'u'))
        assert.match(validated.model.entry.sources['article.html'], new RegExp(duplicateReplacement, 'u'))
        assert.equal(
            validated.model.entry.diagnostics.some(item => item.code === 'managed_node_id_assigned'),
            true,
        )
        assert.equal(
            validated.model.entry.diagnostics.some(item => item.code === 'duplicate_node_id_reassigned'),
            true,
        )
        const prepared = prepareEntryDocumentSave(validated, () => 'identity-normalized-save')
        assert.equal(prepared.status, 'ready')
        if (prepared.status === 'ready') {
            assert.equal(prepared.input.html, validated.model.entry.sources['article.html'])
        }
    })

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

    it('冲突后保留草稿会以磁盘最新版为基线并可再次保存', () => {
        const prepared = prepareEntryDocumentSave(validEditedState(), () => 'save-conflict')
        assert.equal(prepared.status, 'ready')
        if (prepared.status !== 'ready') return
        const latest = document(3, '磁盘最新')
        const conflicted = rejectEntryDocumentSave(
            prepared.state,
            {kind: 'conflict', message: '版本冲突', currentRevision: 3},
            latest,
        )

        const kept = keepEntryDocumentDraft(conflicted)
        assert.equal(kept.persistedRevision, 3)
        assert.equal(kept.snapshot.articleHtml, entryHtml('磁盘最新'))
        assert.equal(kept.model.entry.baseSources['article.html'], entryHtml('磁盘最新'))
        assert.equal(kept.model.entry.sources['article.html'], entryHtml('本地草稿'))
        assert.equal(kept.model.entry.phase, 'dirty')
        assert.equal(kept.conflict, null)
        assert.equal(kept.pendingSave, null)

        const retry = prepareEntryDocumentSave(kept, () => 'save-overwrite')
        assert.equal(retry.status, 'ready')
        if (retry.status !== 'ready') return
        assert.equal(retry.input.expectedRevision, 3)
        assert.equal(retry.input.requestKey, 'save-overwrite')
        const saved = acceptEntryDocumentSave(retry.state, saveResult(retry, 4))
        assert.equal(saved.model.entry.phase, 'clean')
        assert.equal(saved.persistedRevision, 4)
    })

    it('冲突后读不到最新文档时保持冲突且不能保存', () => {
        const prepared = prepareEntryDocumentSave(validEditedState(), () => 'save-conflict')
        assert.equal(prepared.status, 'ready')
        if (prepared.status !== 'ready') return
        const conflicted = rejectEntryDocumentSave(
            prepared.state,
            {kind: 'conflict', message: '版本冲突', currentRevision: 3},
        )

        const kept = keepEntryDocumentDraft(conflicted)
        assert.equal(kept.model.entry.phase, 'conflict')
        assert.equal(kept.persistedRevision, 2)
        assert.equal(kept.conflict?.resolutionError, '无法读取最新版本，暂不能覆盖保存')
        assert.equal(canSaveEntryDocument(kept), false)
        assert.equal(prepareEntryDocumentSave(kept, () => 'must-not-save').status, 'blocked')
    })

    it('载入最新版本会放弃本地修改并回到 clean', () => {
        const prepared = prepareEntryDocumentSave(validEditedState(), () => 'save-conflict')
        assert.equal(prepared.status, 'ready')
        if (prepared.status !== 'ready') return
        const latest = document(3, '磁盘最新')
        const conflicted = rejectEntryDocumentSave(
            prepared.state,
            {kind: 'conflict', message: '版本冲突', currentRevision: 3},
            latest,
        )

        const loaded = loadLatestEntryDocument(conflicted)
        assert.equal(loaded.model.entry.sources['article.html'], entryHtml('磁盘最新'))
        assert.equal(loaded.model.entry.baseSources['article.html'], entryHtml('磁盘最新'))
        assert.equal(loaded.model.entry.phase, 'clean')
        assert.equal(loaded.persistedRevision, 3)
        assert.equal(loaded.conflict, null)
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

    it('新文档把 Markdown 降级段落全部生成为可选中的受管组件', () => {
        const created = createEntryDocumentSessionState({
            ...identity,
            markdown: '第一行\n第二行\n\n第三段',
        }, null)
        const html = created.model.entry.sources['article.html']
        const paragraphIds = [...html.matchAll(/<p data-fc-node-id="([^"]+)" data-fc-node-kind="paragraph">/gu)]
            .map(match => match[1])

        assert.equal(paragraphIds.length, 2)
        assert.equal(new Set(paragraphIds).size, 2)
        assert.ok(paragraphIds.every(id => RFC_9562_UUID_PATTERN.test(id)))
        assert.match(html, />第一行<br>第二行<\/p>/u)
        assert.match(html, />第三段<\/p>/u)
        assert.equal(created.model.entry.diagnostics.some(item => item.severity === 'error'), false)
        assert.equal(created.previewStale, false)
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
