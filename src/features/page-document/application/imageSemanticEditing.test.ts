// 本测试验证图片说明写回，并固定未鉴权的新引用必须失败关闭。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {PageDocument} from '../../../api/pageDocument.ts'
import {createDocumentKernelDraftRuntime} from './documentKernelDraftRuntime.ts'
import {
    acceptEntryDocumentSave,
    acceptEntryDocumentVisualUpdate,
    createEntryDocumentSessionState,
    editEntryDocumentSource,
    finishEntryDocumentValidation,
    prepareEntryDocumentSave,
    rejectEntryDocumentSave,
    undoEntryDocumentSession,
} from './entryDocumentSessionModel.ts'
import {createImageDescriptionEditRequest, readManagedImageDescription} from './imageSemanticEditing.ts'

const ENTRY_ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'
const PROJECT_ID = '11111111-1111-7111-8111-111111111111'
const NODE_ID = '22222222-2222-7222-8222-222222222222'
const ASSET_ID = '33333333-3333-7333-8333-333333333333'
const OTHER_ID = '44444444-4444-7444-8444-444444444444'

function article(src = `fcasset://${ASSET_ID}`, id = ASSET_ID): string {
    return `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><section data-fc-node-id="${ENTRY_ID}" data-fc-node-kind="container"><figure data-fc-node-id="${NODE_ID}" data-fc-node-kind="asset" class="keep"><img src="${src}" data-fc-asset-id="${id}" alt="旧说明"><figcaption>旧图注</figcaption></figure><p class="keep">未知合法源码 &amp; 原样保留</p></section></template></template>`
}

function document(html = article()): PageDocument {
    return {
        entryId: ENTRY_ID, projectId: PROJECT_ID, html, css: '/* keep-css */',
        derivedText: '旧图注', revision: 3, modifiedBy: 'local', updatedAt: '2026-09-17T00:00:00Z',
    }
}

function session(html = article()) {
    return createEntryDocumentSessionState({
        entryId: ENTRY_ID, projectId: PROJECT_ID, title: '图片说明', summary: '', markdown: '',
    }, document(html))
}

describe('现有页面图片说明的安全切片', () => {
    it('只识别稳定逻辑引用，并把路径、运行 URL、缺失引用标为不可加载', () => {
        assert.deepEqual(readManagedImageDescription(article(), NODE_ID)?.reference, {
            status: 'unverified', assetId: ASSET_ID,
            message: '尚未读取当前项目资产目录，原件状态待核验。',
        })
        for (const invalid of ['/Users/test/image.png', 'file:///tmp/image.png',
            'http://asset.local/image.png', 'blob:opaque', `fcasset://${OTHER_ID}`]) {
            assert.equal(readManagedImageDescription(article(invalid), NODE_ID)?.reference.status, 'invalid')
        }
        assert.equal(readManagedImageDescription(article('', ''), NODE_ID)?.reference.status, 'missing')
        // 有效 UUID 也不能凭前端格式判断归属或存在性。
        assert.equal(readManagedImageDescription(
            article(`fcasset://${OTHER_ID}`, OTHER_ID), NODE_ID,
        )?.reference.status, 'unverified')
    })

    it('真实会话一次修改 alt 与图注：无关源码原样保留，可撤销，保存只提交当前 revision', () => {
        const original = session()
        const image = readManagedImageDescription(original.model.entry.sources['article.html'], NODE_ID)
        assert.ok(image)
        const request = createImageDescriptionEditRequest(image, {
            alt: '新说明 & 字符', caption: '新图注',
        }, () => 'image-description-test')
        assert.ok(request)
        const runtime = createDocumentKernelDraftRuntime()
        const prepared = runtime.prepare(original.model, original.snapshot, request)
        assert.equal(prepared.status, 'ready', JSON.stringify(prepared))
        if (prepared.status !== 'ready') return
        const applied = runtime.applyPrepared(original.model, original.snapshot, prepared.edit, '修改图片说明')
        assert.equal(applied.applied, true, JSON.stringify(applied.diagnostics))
        const changed = acceptEntryDocumentVisualUpdate(original, applied)
        const source = changed.model.entry.sources['article.html']
        assert.match(source, new RegExp(`src="fcasset://${ASSET_ID}" data-fc-asset-id="${ASSET_ID}" alt="新说明 &amp; 字符"`, 'u'))
        assert.match(source, /<figcaption>新图注<\/figcaption><\/figure><p class="keep">未知合法源码 &amp; 原样保留<\/p>/u)
        assert.equal(changed.model.entry.sources['style.css'], '/* keep-css */')
        assert.equal(undoEntryDocumentSession(changed).model.entry.sources['article.html'], article())

        const ready = finishEntryDocumentValidation(changed)
        const save = prepareEntryDocumentSave(ready, () => 'image-description-save')
        assert.equal(save.status, 'ready', JSON.stringify(save))
        if (save.status !== 'ready') return
        assert.equal(save.input.expectedRevision, 3)
        assert.equal(save.input.html, source)
        const persisted = {...document(source), revision: 4}
        const saved = acceptEntryDocumentSave(save.state, {
            document: persisted, revision: 4, requestKey: 'image-description-save',
        })
        assert.equal(saved.persistedRevision, 4)
        assert.equal(saved.model.entry.phase, 'clean')
        const reopened = createEntryDocumentSessionState(original.identity, persisted)
        assert.equal(reopened.persistedRevision, 4)
        const reopenedImage = readManagedImageDescription(reopened.model.entry.sources['article.html'], NODE_ID)
        assert.equal(reopenedImage?.reference.assetId, ASSET_ID)
        assert.equal(reopenedImage?.alt, '新说明 & 字符')
        assert.equal(reopenedImage?.caption, '新图注')

        const failed = rejectEntryDocumentSave(save.state, {
            kind: 'other', code: 'IO_ERROR', message: '磁盘不可用',
        })
        assert.equal(failed.persistedRevision, 3)
        assert.equal(failed.model.entry.sources['article.html'], source)
        assert.equal(failed.pendingSave?.requestKey, 'image-description-save')
    })

    it('过期图片说明和新增未授权资产引用都不得进入草稿', () => {
        const original = session()
        const image = readManagedImageDescription(original.model.entry.sources['article.html'], NODE_ID)
        assert.ok(image)
        const runtime = createDocumentKernelDraftRuntime()
        const stale = createImageDescriptionEditRequest({...image, expectedAlt: '已过期'}, {
            alt: '新说明', caption: image.caption,
        }, () => 'stale-image-description')
        assert.ok(stale)
        const rejected = runtime.prepare(original.model, original.snapshot, stale)
        assert.equal(rejected.status, 'rejected')
        assert.equal(original.model.entry.sources['article.html'], article())
        assert.equal(original.persistedRevision, 3)

        const newAssetSource = article(`fcasset://${OTHER_ID}`, OTHER_ID)
        const candidate = editEntryDocumentSource(original, 'article.html', newAssetSource)
        const changedImage = readManagedImageDescription(newAssetSource, NODE_ID)
        assert.ok(changedImage)
        // 草稿中新增的 UUID 不在已存源码中，说明文字编辑不得替它取得授权。
        const request = createImageDescriptionEditRequest(changedImage, {
            alt: '新说明', caption: changedImage.caption,
        }, () => 'stored-image-description')
        assert.ok(request)
        assert.equal(runtime.prepare(candidate.model, candidate.snapshot, request).status, 'rejected')
        assert.equal(candidate.model.entry.sources['article.html'], newAssetSource)
        assert.equal(candidate.persistedRevision, 3)
    })

    it('复杂图注替换要求明确确认，准备阶段不留下半次修改', () => {
        const source = article().replace('<figcaption>旧图注</figcaption>', '<figcaption><em>旧图注</em></figcaption>')
        const original = session(source)
        const image = readManagedImageDescription(source, NODE_ID)
        assert.ok(image)
        assert.equal(image.captionKind, 'structured')
        const request = createImageDescriptionEditRequest(image, {
            alt: image.alt, caption: '新图注',
        }, () => 'structured-caption')
        assert.ok(request)
        const prepared = createDocumentKernelDraftRuntime().prepare(original.model, original.snapshot, request)
        assert.equal(prepared.status, 'needs-decision', JSON.stringify(prepared))
        assert.equal(original.model.entry.sources['article.html'], source)
        assert.equal(original.persistedRevision, 3)
    })

    it('含 HTML 注释的图注按结构化内容确认替换，取消时不丢注释', () => {
        const source = article().replace(
            '<figcaption>旧图注</figcaption>',
            '<figcaption><!--作者注释-->旧图注</figcaption>',
        )
        const original = session(source)
        const image = readManagedImageDescription(original.model.entry.sources['article.html'], NODE_ID)
        assert.ok(image)
        assert.equal(image.captionKind, 'structured')
        assert.equal(image.caption, '旧图注')
        const request = createImageDescriptionEditRequest(image, {
            alt: image.alt, caption: '新图注',
        }, () => 'comment-caption')
        assert.ok(request)
        const runtime = createDocumentKernelDraftRuntime()
        const prepared = runtime.prepare(original.model, original.snapshot, request)
        assert.equal(prepared.status, 'needs-decision', JSON.stringify(prepared))
        if (prepared.status !== 'needs-decision') return
        assert.ok(prepared.decisions.some(decision => decision.code === 'asset-caption-structured-replacement'))
        // 用户取消确认时不应用候选，原注释与 revision 必须原样保留。
        assert.equal(original.model.entry.sources['article.html'], source)
        assert.equal(original.persistedRevision, 3)

        const applied = runtime.applyPrepared(original.model, original.snapshot, prepared.edit, '修改图片说明')
        assert.equal(applied.applied, true, JSON.stringify(applied.diagnostics))
        const changed = acceptEntryDocumentVisualUpdate(original, applied)
        assert.equal(changed.model.entry.sources['article.html'], article().replace(
            '<figcaption>旧图注</figcaption>', '<figcaption>新图注</figcaption>',
        ))
        assert.equal(changed.persistedRevision, 3)
        assert.equal(undoEntryDocumentSession(changed).model.entry.sources['article.html'], source)
    })

    it('含 HTML 注释的图注仅修改 alt 时保留完整图注、引用和无关源码', () => {
        const source = article().replace(
            '<figcaption>旧图注</figcaption>',
            '<figcaption><!--作者注释-->旧图注</figcaption>',
        )
        const original = session(source)
        const image = readManagedImageDescription(source, NODE_ID)
        assert.ok(image)
        const request = createImageDescriptionEditRequest(image, {
            alt: '新说明', caption: image.caption,
        }, () => 'comment-caption-alt-only')
        assert.ok(request)
        const runtime = createDocumentKernelDraftRuntime()
        const prepared = runtime.prepare(original.model, original.snapshot, request)
        assert.equal(prepared.status, 'ready', JSON.stringify(prepared))
        if (prepared.status !== 'ready') return
        const applied = runtime.applyPrepared(original.model, original.snapshot, prepared.edit, '修改图片说明')
        assert.equal(applied.applied, true, JSON.stringify(applied.diagnostics))
        const changed = acceptEntryDocumentVisualUpdate(original, applied)
        assert.equal(changed.model.entry.sources['article.html'], source.replace('alt="旧说明"', 'alt="新说明"'))
        assert.equal(changed.model.entry.sources['style.css'], '/* keep-css */')
    })
})
