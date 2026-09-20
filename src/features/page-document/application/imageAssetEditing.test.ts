// 本测试从真实词条会话经过现有内核、历史和保存准备验证图片插入与替换，不伪造第二份正文。

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {describe, it} from 'node:test'
import type {PageDocument, PageDocumentAsset} from '../../../api/pageDocument.ts'
import {createLayerProjection} from '../domain/layerProjection.ts'
import {createDocumentKernelDraftRuntime} from './documentKernelDraftRuntime.ts'
import {
    acceptEntryDocumentSave,
    acceptEntryDocumentVisualUpdate,
    createEntryDocumentSessionState,
    finishEntryDocumentValidation,
    prepareEntryDocumentSave,
    redoEntryDocumentSession,
    registerEntryDocumentAsset,
    undoEntryDocumentSession,
    type EntryDocumentSessionState,
} from './entryDocumentSessionModel.ts'
import {
    createImageInsertionRequest,
    createImageReplacementRequest,
    isCurrentImageAssetSelection,
    resolveImageInsertionTarget,
    resolvePageDocumentInsertionTargets,
} from './imageAssetEditing.ts'
import {readManagedImageDescription} from './imageSemanticEditing.ts'
import {CANVAS_BASE_PROJECT_CSS, CANVAS_BASE_PROJECT_HTML, compileCanvasPreview} from '../canvas/host/compiledPreview.ts'
import {isolatePageDocument} from '../canvas/runtime/isolationPolicy.ts'

const ENTRY = '018f47a2-3b4c-7d5e-8f90-123456789abc'
const PROJECT = '11111111-1111-7111-8111-111111111111'
const ROOT = '22222222-2222-7222-8222-222222222222'
const PARAGRAPH = '33333333-3333-7333-8333-333333333333'
const IMAGE = '44444444-4444-7444-8444-444444444444'
const ASSET_A = '55555555-5555-7555-8555-555555555555'
const ASSET_B = '66666666-6666-7666-8666-666666666666'
const NESTED = '77777777-7777-7777-8777-777777777777'

const identity = {entryId: ENTRY, projectId: PROJECT, title: '图片', summary: '', markdown: ''}
const article = `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><div data-fc-node-id="${ROOT}" data-fc-node-kind="container" data-fc-editor-root><p data-fc-node-id="${PARAGRAPH}" data-fc-node-kind="paragraph">正文</p><!-- 保留作者注释 --></div></template></template>`

function asset(id: string, projectId = PROJECT): PageDocumentAsset {
    return {id, projectId, mediaType: 'image/png', sizeBytes: 70, sha256: 'a'.repeat(64), width: 2, height: 2, createdAt: '2026-09-17T00:00:00Z'}
}

function document(html = article, revision = 2): PageDocument {
    return {entryId: ENTRY, projectId: PROJECT, html, css: '/* keep-css */', derivedText: '正文', revision, modifiedBy: null, updatedAt: '2026-09-17T00:00:00Z'}
}

function session(): EntryDocumentSessionState {
    return createEntryDocumentSessionState(identity, document(), [
        {id: ASSET_A, mediaType: 'image/png', sizeBytes: 70, sha256: 'a'.repeat(64)},
        {id: ASSET_B, mediaType: 'image/png', sizeBytes: 70, sha256: 'a'.repeat(64)},
    ])
}

function apply(state: EntryDocumentSessionState, request: ReturnType<typeof createImageInsertionRequest>, label: string) {
    const runtime = createDocumentKernelDraftRuntime()
    const prepared = runtime.prepare(state.model, state.snapshot, request)
    assert.equal(prepared.status, 'ready', JSON.stringify(prepared))
    if (prepared.status !== 'ready') return state
    const update = runtime.applyPrepared(state.model, state.snapshot, prepared.edit, label)
    assert.equal(update.applied, true, JSON.stringify(update.diagnostics))
    return acceptEntryDocumentVisualUpdate(state, update)
}

describe('项目页面图片生产会话', () => {
    it('导入 API 不接受路径，作者 data/blob 图片在编译与隔离两道门均被拒绝', () => {
        const api = readFileSync(new URL('../../../api/pageDocument.ts', import.meta.url), 'utf8')
        assert.match(api, /invoke\('page_document_import_asset', \{projectId\}\)/u)
        assert.doesNotMatch(api, /sourcePath|convertFileSrc/u)
        for (const url of ['data:image/png;base64,AQID', 'blob:https://example.invalid/picture']) {
            const unsafeArticle = article.replace('<!-- 保留作者注释 -->', `<img src="${url}">`)
            const compiled = compileCanvasPreview({
                projectArticleHtml: CANVAS_BASE_PROJECT_HTML,
                projectStyleCss: CANVAS_BASE_PROJECT_CSS,
                entryArticleHtml: unsafeArticle,
                entryStyleCss: '',
                metadata: {id: ENTRY, title: '图片', summary: '', tags: []},
            })
            assert.equal(compiled.html, null)
            assert.ok(compiled.diagnostics.some(item => item.severity === 'error'))
            assert.equal(isolatePageDocument(`<img src="${url}">`, '').artifact, null)
            const unsafeCss = `@layer fc-entry { [data-fc-entry-id="${ENTRY}"] { background-image: url("${url}"); } }`
            const cssCompiled = compileCanvasPreview({
                projectArticleHtml: CANVAS_BASE_PROJECT_HTML,
                projectStyleCss: CANVAS_BASE_PROJECT_CSS,
                entryArticleHtml: article,
                entryStyleCss: unsafeCss,
                metadata: {id: ENTRY, title: '图片', summary: '', tags: []},
            })
            assert.equal(cssCompiled.html, null)
            assert.ok(cssCompiled.diagnostics.some(item => item.severity === 'error'))
            assert.equal(isolatePageDocument('<p>正文</p>', unsafeCss).artifact, null)
        }
    })

    it('异步选择结果仅能写回原项目、词条、模式、节点和草稿版本', () => {
        const opened = `${PROJECT}:${ENTRY}:true:visual:${PARAGRAPH}:2`
        const pickerId = 'picker-original'
        assert.equal(isCurrentImageAssetSelection(opened, opened, PROJECT, PROJECT, pickerId, pickerId), true)
        for (const changed of [
            `${PROJECT}:${ENTRY}:true:visual:${IMAGE}:2`,
            `${PROJECT}:${ENTRY}:true:display:${PARAGRAPH}:2`,
            `${PROJECT}:${ENTRY}:true:visual:${PARAGRAPH}:3`,
            `${PROJECT}:${ENTRY}:false:visual:${PARAGRAPH}:2`,
            `${PROJECT}:${IMAGE}:true:visual:${PARAGRAPH}:2`,
        ]) assert.equal(isCurrentImageAssetSelection(opened, changed, PROJECT, PROJECT, pickerId, pickerId), false)
        assert.equal(isCurrentImageAssetSelection(opened, opened, '99999999-9999-7999-8999-999999999999', PROJECT, pickerId, pickerId), false)
        assert.equal(isCurrentImageAssetSelection(opened, opened, PROJECT, PROJECT, pickerId, null), false)
        assert.equal(isCurrentImageAssetSelection(opened, opened, PROJECT, PROJECT, pickerId, 'picker-later'), false)
    })

    it('授权资产插入、撤销重做、保存并重开仍保留稳定引用', () => {
        const initial = session()
        const target = resolveImageInsertionTarget(createLayerProjection(article).nodes, PARAGRAPH)
        assert.deepEqual(target, {parentId: ROOT, afterId: PARAGRAPH})
        assert.ok(target)
        const changed = apply(initial, createImageInsertionRequest(target, ASSET_A, IMAGE, 'insert-once'), '插入图片')
        const html = changed.model.entry.sources['article.html']
        assert.match(html, new RegExp(`<figure data-fc-node-id="${IMAGE}" data-fc-node-kind="asset"><img src="fcasset://${ASSET_A}" data-fc-asset-id="${ASSET_A}"`, 'u'))
        assert.ok(html.includes('<!-- 保留作者注释 -->'))
        assert.equal(changed.model.entry.sources['style.css'], '/* keep-css */')
        assert.equal(changed.model.entry.undo.length, 1)
        const undone = undoEntryDocumentSession(changed)
        assert.equal(undone.model.entry.sources['article.html'], article)
        assert.equal(redoEntryDocumentSession(undone).model.entry.sources['article.html'], html)

        const preparation = prepareEntryDocumentSave(finishEntryDocumentValidation(changed), () => 'image-save')
        assert.equal(preparation.status, 'ready')
        if (preparation.status !== 'ready') return
        assert.equal(preparation.input.expectedRevision, 2)
        assert.equal(preparation.input.html, html)
        const persisted = document(html, 3)
        const saved = acceptEntryDocumentSave(preparation.state, {document: persisted, revision: 3, requestKey: 'image-save'})
        assert.equal(saved.model.entry.phase, 'clean')
        assert.equal(saved.persistedRevision, 3)
        const reopened = createEntryDocumentSessionState(identity, persisted, initial.snapshot.assets)
        assert.equal(readManagedImageDescription(reopened.model.entry.sources['article.html'], IMAGE)?.reference.assetId, ASSET_A)
    })

    it('插入位置对容器提供内部与之后，对普通节点只提供之后', () => {
        const nestedArticle = article.replace(
            `<p data-fc-node-id="${PARAGRAPH}"`,
            `<section data-fc-node-id="${NESTED}" data-fc-node-kind="container"><p data-fc-node-id="${PARAGRAPH}"`,
        ).replace('</p><!-- 保留作者注释 -->', '</p></section><!-- 保留作者注释 -->')
        const nodes = createLayerProjection(nestedArticle).nodes

        assert.deepEqual(resolvePageDocumentInsertionTargets(nodes, NESTED), {
            inside: {parentId: NESTED, afterId: PARAGRAPH},
            after: {parentId: ROOT, afterId: NESTED},
            defaultPlacement: 'inside',
        })
        assert.deepEqual(resolvePageDocumentInsertionTargets(nodes, PARAGRAPH), {
            inside: null,
            after: {parentId: NESTED, afterId: PARAGRAPH},
            defaultPlacement: 'after',
        })
        assert.deepEqual(resolvePageDocumentInsertionTargets(nodes, ROOT), {
            inside: {parentId: ROOT, afterId: NESTED},
            after: null,
            defaultPlacement: 'inside',
        })
    })

    it('无可选编辑根标记时，优先沿选中的受管容器解析并完成真实插入', () => {
        const customArticle = article.replace(' data-fc-editor-root', '')
        const initial = createEntryDocumentSessionState(identity, document(customArticle), session().snapshot.assets)
        const target = resolveImageInsertionTarget(createLayerProjection(customArticle).nodes, ROOT)
        assert.deepEqual(target, {parentId: ROOT, afterId: PARAGRAPH})
        assert.ok(target)
        const runtime = createDocumentKernelDraftRuntime()
        const prepared = runtime.prepare(initial.model, initial.snapshot,
            createImageInsertionRequest(target, ASSET_A, IMAGE, 'custom-container'))
        assert.equal(prepared.status, 'ready', JSON.stringify(prepared))
        if (prepared.status !== 'ready') return
        const update = runtime.applyPrepared(initial.model, initial.snapshot, prepared.edit, '插入图片')
        assert.equal(update.applied, true, JSON.stringify(update.diagnostics))
        assert.match(update.model.entry.sources['article.html'], new RegExp(`fcasset://${ASSET_A}`, 'u'))
        assert.match(update.model.entry.sources['article.html'], /<!-- 保留作者注释 -->/u)
        assert.equal(resolveImageInsertionTarget(createLayerProjection(customArticle).nodes, null), null)
    })

    it('替换仅修改资源，保留 alt、结构化图注和其他源码，且可撤销', () => {
        const target = resolveImageInsertionTarget(createLayerProjection(article).nodes, PARAGRAPH)
        assert.ok(target)
        const inserted = apply(session(), createImageInsertionRequest(target, ASSET_A, IMAGE, 'insert-for-replace'), '插入图片')
        const source = inserted.model.entry.sources['article.html'].replace('</figure>', '<figcaption><!--作者注释--><em>旧图注</em></figcaption></figure>')
        const starting = createEntryDocumentSessionState(identity, document(source), session().snapshot.assets)
        const image = readManagedImageDescription(source, IMAGE)
        assert.ok(image)
        assert.equal(image.captionKind, 'structured')
        const changed = apply(starting, createImageReplacementRequest(image, ASSET_B, 'replace-once'), '替换图片')
        const html = changed.model.entry.sources['article.html']
        assert.equal(html, source.replaceAll(ASSET_A, ASSET_B))
        assert.ok(html.includes('alt="词条资产"'))
        assert.ok(html.includes('<figcaption><!--作者注释--><em>旧图注</em></figcaption>'))
        assert.equal(undoEntryDocumentSession(changed).model.entry.sources['article.html'], source)
    })

    it('非法 ID、未登记资产、跨项目登记和过期引用均不修改草稿或 revision', () => {
        const initial = session()
        const target = resolveImageInsertionTarget(createLayerProjection(article).nodes, null)
        assert.ok(target)
        for (const id of ['/tmp/picture.png', 'file:///tmp/picture.png', 'https://example.invalid/a.png']) {
            assert.throws(() => createImageInsertionRequest(target, id, IMAGE), /ID 无效/u)
        }
        const runtime = createDocumentKernelDraftRuntime()
        const missing = runtime.prepare(initial.model, initial.snapshot,
            createImageInsertionRequest(target, '77777777-7777-7777-8777-777777777777', IMAGE, 'missing'))
        assert.equal(missing.status, 'rejected')
        const unauthorized = registerEntryDocumentAsset(initial, asset(ASSET_B, '99999999-9999-7999-8999-999999999999'))
        assert.equal(unauthorized, initial)
        assert.equal(initial.model.entry.sources['article.html'], article)
        assert.equal(initial.persistedRevision, 2)

        const inserted = apply(initial, createImageInsertionRequest(target, ASSET_A, IMAGE, 'insert-for-stale'), '插入图片')
        const image = readManagedImageDescription(inserted.model.entry.sources['article.html'], IMAGE)
        assert.ok(image)
        const stale = createImageReplacementRequest(image, ASSET_B, 'stale')
        const reverted = undoEntryDocumentSession(inserted)
        assert.equal(runtime.prepare(reverted.model, reverted.snapshot, stale).status, 'rejected')
        assert.equal(reverted.model.entry.sources['article.html'], article)
        assert.equal(reverted.persistedRevision, 2)
    })
})
