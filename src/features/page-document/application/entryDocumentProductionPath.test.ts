// 本测试用生产会话提供的真实项目基线贯穿内核 prepare/apply，避免单元夹具掩盖项目源码策略错误。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {PageDocument} from '../../../api/pageDocument.ts'
import {createLayerProjection, type LayerProjectionNode} from '../domain/layerProjection.ts'
import {createDocumentKernelDraftRuntime} from './documentKernelDraftRuntime.ts'
import {
    acceptEntryDocumentVisualUpdate,
    createEntryDocumentSessionState,
    prepareEntryDocumentSave,
    undoEntryDocumentSession,
} from './entryDocumentSessionModel.ts'
import {
    createCanvasInputKernelOperation,
    createCanvasInputKernelRequest,
    readCanvasInputTarget,
} from './canvasInputOperation.ts'
import {createCanvasInputCommitScheduler} from './canvasInputCommitScheduler.ts'
import {
    PAGE_DOCUMENT_CANVAS_CHANNEL,
    PAGE_DOCUMENT_CANVAS_VERSION,
    type CanvasInputIntentMessage,
} from '../canvas/protocol/index.ts'
import {createOpaqueElementAdoptionKernelRequest} from './opaqueElementAdoption.ts'
import {createVisualPropertyEditRequest} from './visualPropertyEditing.ts'

const ENTRY_ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'
const PROJECT_ID = '11111111-1111-7111-8111-111111111111'
const ROOT_ID = '22222222-2222-7222-8222-222222222222'
const PARAGRAPH_ID = '33333333-3333-7333-8333-333333333333'
const ADOPTED_ID = '44444444-4444-7444-8444-444444444444'
const SPLIT_ID = '81111111-1111-7111-8111-111111111111'

const identity = {
    entryId: ENTRY_ID,
    projectId: PROJECT_ID,
    title: '生产基线回归',
    summary: '真实会话路径',
    markdown: '',
}

function articleHtml(): string {
    return `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><div data-fc-node-id="${ROOT_ID}" data-fc-node-kind="container"><p data-fc-node-id="${PARAGRAPH_ID}" data-fc-node-kind="paragraph">受管正文</p><p class="legacy">旧段落</p></div></template></template>`
}

function document(): PageDocument {
    return {
        entryId: ENTRY_ID,
        projectId: PROJECT_ID,
        html: articleHtml(),
        css: `/* keep-before */
@layer fc-node {
  [data-fc-node-id="${PARAGRAPH_ID}"][data-fc-node-kind="paragraph"] { color: #334455; }
}
/* keep-after */`,
        derivedText: '受管正文\n旧段落',
        revision: 2,
        modifiedBy: 'local',
        updatedAt: '2026-09-16T00:00:00Z',
    }
}

function findSourceParagraph(nodes: readonly LayerProjectionNode[]): LayerProjectionNode {
    const pending = [...nodes]
    while (pending.length > 0) {
        const node = pending.shift()
        assert.ok(node)
        if (node.kind === 'source' && node.tagName === 'p') return node
        pending.unshift(...node.children)
    }
    throw new Error('未找到待纳入的旧段落。')
}

describe('页面编辑生产项目基线', () => {
    it('真实会话初始化无诊断且预览可渲染', () => {
        const state = createEntryDocumentSessionState(identity, document())

        assert.doesNotMatch(state.snapshot.project.defaultArticleHtml, /<meta\b/iu)
        assert.match(state.snapshot.project.defaultArticleHtml, /<title data-fc-bind="title">词条<\/title>/u)
        assert.deepEqual(state.model.project.diagnostics, [])
        assert.deepEqual(state.model.entry.diagnostics, [])
        assert.equal(state.previewStale, false)
        assert.ok(state.preview)
        assert.equal(state.preview.diagnostics.some(item => item.severity === 'error'), false)
        assert.match(state.preview.html ?? '', /受管正文[\s\S]*旧段落/u)
    })

    it('真实会话允许属性修改与旧段落纳入通过同一内核路径', () => {
        let state = createEntryDocumentSessionState(identity, document())
        const runtime = createDocumentKernelDraftRuntime()
        const originalHtml = state.model.entry.sources['article.html']
        const originalCss = state.model.entry.sources['style.css']
        const propertyRequest = createVisualPropertyEditRequest(
            PARAGRAPH_ID,
            [{
                property: 'font-size',
                value: {kind: 'numeric', value: 18, unit: 'px', numberText: '18'},
            }],
            {styleContext: 'mobile'},
            () => 'production-property-edit',
        )
        const propertyPrepared = runtime.prepare(state.model, state.snapshot, propertyRequest)

        assert.equal(propertyPrepared.status, 'ready', JSON.stringify(propertyPrepared))
        if (propertyPrepared.status !== 'ready') return
        const propertyApplied = runtime.applyPrepared(
            state.model,
            state.snapshot,
            propertyPrepared.edit,
            '调整字号',
        )
        assert.equal(propertyApplied.applied, true, JSON.stringify(propertyApplied.diagnostics))
        assert.equal(propertyApplied.model.entry.sources['article.html'], originalHtml)
        const changedCss = propertyApplied.model.entry.sources['style.css']
        assert.equal(changedCss.match(/font-size:\s*18px/gu)?.length, 1)
        assert.ok(changedCss.includes('/* keep-before */'))
        assert.ok(changedCss.includes('color: #334455;'))
        assert.ok(changedCss.includes('/* keep-after */'))
        assert.ok(changedCss.length > originalCss.length)
        assert.equal(
            changedCss.replace(/\n\s+font-size:\s*18px;\n\s+/u, ''),
            originalCss,
        )
        state = acceptEntryDocumentVisualUpdate(state, propertyApplied)

        const sourceNode = findSourceParagraph(
            createLayerProjection(state.model.entry.sources['article.html']).nodes,
        )
        const adoptionRequest = createOpaqueElementAdoptionKernelRequest({
            node: sourceNode,
            articleHtml: state.model.entry.sources['article.html'],
            newNodeId: ADOPTED_ID,
            allocateRequestId: () => 'production-adopt-paragraph',
        })
        const adoptionPrepared = runtime.prepare(state.model, state.snapshot, adoptionRequest)

        assert.equal(adoptionPrepared.status, 'ready', JSON.stringify(adoptionPrepared))
        if (adoptionPrepared.status !== 'ready') return
        const adoptionApplied = runtime.applyPrepared(
            state.model,
            state.snapshot,
            adoptionPrepared.edit,
            '纳入可视编辑',
        )
        assert.equal(adoptionApplied.applied, true, JSON.stringify(adoptionApplied.diagnostics))
        assert.match(
            adoptionApplied.model.entry.sources['article.html'],
            new RegExp(`<p class="legacy" data-fc-node-id="${ADOPTED_ID}" data-fc-node-kind="paragraph">旧段落<\\/p>`, 'u'),
        )
    })

    it('真实会话的连续中文输入在交互结束落下尾帧，只改目标文本、可撤销并保存', async () => {
        const initial = createEntryDocumentSessionState(identity, document())
        let state = initial
        const runtime = createDocumentKernelDraftRuntime()
        const originalHtml = initial.model.entry.sources['article.html']
        const base = {
            channel: PAGE_DOCUMENT_CANVAS_CHANNEL,
            version: PAGE_DOCUMENT_CANVAS_VERSION,
            sessionToken: 'a'.repeat(64),
            sequence: 1,
            type: 'input-intent' as const,
            nodeId: PARAGRAPH_ID,
        }
        const messages: CanvasInputIntentMessage[] = [
            {
                ...base,
                intentId: '55555555-5555-7555-8555-555555555555',
                inputType: 'insertText',
                from: 4,
                to: 4,
                expected: '',
                text: '中',
            },
            {
                ...base,
                sequence: 2,
                intentId: '66666666-6666-7666-8666-666666666666',
                inputType: 'insertText',
                from: 5,
                to: 5,
                expected: '',
                text: '文',
            },
        ]
        const scheduler = createCanvasInputCommitScheduler({
            delayMs: 10_000,
            readNodeText: nodeId => {
                const projection = createLayerProjection(state.model.entry.sources['article.html'])
                const pending = [...projection.nodes]
                let node = pending.shift()
                while (node && node.id !== nodeId) {
                    pending.unshift(...node.children)
                    node = pending.shift()
                }
                return node?.managed ? node.textContent : null
            },
            commit: async (batch, metadata) => {
                const historyGroupId = metadata.historyGroupId
                assert.ok(historyGroupId)
                const request = createCanvasInputKernelRequest(batch, historyGroupId)
                const prepared = runtime.prepare(state.model, state.snapshot, request)
                assert.equal(prepared.status, 'ready', JSON.stringify(prepared))
                if (prepared.status !== 'ready') return false
                const update = runtime.applyPrepared(
                    state.model,
                    state.snapshot,
                    prepared.edit,
                    '画布输入文本',
                    metadata,
                )
                assert.equal(update.applied, true, JSON.stringify(update.diagnostics))
                state = acceptEntryDocumentVisualUpdate(state, update)
                return true
            },
            createHistoryGroupId: () => 'canvas-input-history:production',
        })
        const scheduled = messages.map(message => scheduler.schedule(message))
        const flushed = scheduler.endInteraction()
        assert.deepEqual(await Promise.all([...scheduled, flushed]), [true, true, true])

        const changedHtml = state.model.entry.sources['article.html']
        assert.equal(
            changedHtml,
            originalHtml.replace('>受管正文</p>', '>受管正文中文</p>'),
        )
        assert.match(changedHtml, /<p class="legacy">旧段落<\/p>/u)
        assert.equal(state.model.entry.undo.length, 1)

        const undone = undoEntryDocumentSession(state)
        assert.equal(undone.model.entry.sources['article.html'], originalHtml)

        const save = prepareEntryDocumentSave(state, () => '77777777-7777-7777-8777-777777777777')
        assert.equal(save.status, 'ready')
        if (save.status === 'ready') {
            assert.equal(save.input.html, changedHtml)
            assert.equal(save.input.expectedRevision, 2)
        }
    })

    it('真实会话按 Shift+Enter 分段后立即输入落在宿主新节点，两个交互可依次撤销并保存', () => {
        const initial = createEntryDocumentSessionState(identity, document())
        let state = initial
        const runtime = createDocumentKernelDraftRuntime()
        const splitMessage: CanvasInputIntentMessage = {
            channel: PAGE_DOCUMENT_CANVAS_CHANNEL,
            version: PAGE_DOCUMENT_CANVAS_VERSION,
            sessionToken: 'a'.repeat(64),
            sequence: 1,
            type: 'input-intent',
            intentId: '81111111-1111-7111-8111-111111111112',
            nodeId: PARAGRAPH_ID,
            inputType: 'insertParagraph',
            from: 2,
            to: 2,
            expected: '',
            text: '',
        }
        const splitOperation = createCanvasInputKernelOperation(
            [splitMessage],
            'canvas-input-history:enter',
            'paragraph',
            () => SPLIT_ID,
        )
        const splitPrepared = runtime.prepare(state.model, state.snapshot, splitOperation.request)
        assert.equal(splitPrepared.status, 'ready', JSON.stringify(splitPrepared))
        if (splitPrepared.status !== 'ready') return
        const splitUpdate = runtime.applyPrepared(
            state.model,
            state.snapshot,
            splitPrepared.edit,
            '画布分段',
            {historyGroupId: 'canvas-input-history:enter'},
        )
        assert.equal(splitUpdate.applied, true, JSON.stringify(splitUpdate.diagnostics))
        state = acceptEntryDocumentVisualUpdate(state, splitUpdate)
        assert.deepEqual(splitOperation.resolution.selection, {nodeId: SPLIT_ID, offset: 0})
        assert.equal(
            state.model.entry.sources['article.html'],
            initial.model.entry.sources['article.html'].replace(
                '>受管正文</p>',
                `>受管</p>\n<p data-fc-node-id="${SPLIT_ID}" data-fc-node-kind="paragraph">正文</p>`,
            ),
        )
        assert.equal(
            state.model.entry.sources['style.css'],
            initial.model.entry.sources['style.css'],
        )

        const typeMessage: CanvasInputIntentMessage = {
            ...splitMessage,
            sequence: 2,
            intentId: '82222222-2222-7222-8222-222222222222',
            nodeId: SPLIT_ID,
            inputType: 'insertText',
            from: 0,
            to: 0,
            text: '新',
        }
        const nextTarget = readCanvasInputTarget(state.model.entry.sources['article.html'], SPLIT_ID)
        assert.deepEqual(nextTarget, {kind: 'paragraph', text: '正文'})
        const typeOperation = createCanvasInputKernelOperation(
            [typeMessage],
            'canvas-input-history:after-enter',
            nextTarget?.kind ?? '',
        )
        const typePrepared = runtime.prepare(state.model, state.snapshot, typeOperation.request)
        assert.equal(typePrepared.status, 'ready', JSON.stringify(typePrepared))
        if (typePrepared.status !== 'ready') return
        const typeUpdate = runtime.applyPrepared(
            state.model,
            state.snapshot,
            typePrepared.edit,
            '画布输入文本',
            {historyGroupId: 'canvas-input-history:after-enter'},
        )
        assert.equal(typeUpdate.applied, true, JSON.stringify(typeUpdate.diagnostics))
        state = acceptEntryDocumentVisualUpdate(state, typeUpdate)
        assert.match(state.model.entry.sources['article.html'], />受管<\/p>\s*<p[^>]+>新正文<\/p>/u)
        assert.equal(state.model.entry.undo.length, 2)

        const undoTyping = undoEntryDocumentSession(state)
        assert.match(undoTyping.model.entry.sources['article.html'], />受管<\/p>\s*<p[^>]+>正文<\/p>/u)
        const undoSplit = undoEntryDocumentSession(undoTyping)
        assert.equal(undoSplit.model.entry.sources['article.html'], initial.model.entry.sources['article.html'])
        const save = prepareEntryDocumentSave(state, () => '83333333-3333-7333-8333-333333333333')
        assert.equal(save.status, 'ready')
        if (save.status === 'ready') assert.equal(save.input.html, state.model.entry.sources['article.html'])
    })

    it('真实会话粘贴的全部换行保留在当前块且一次撤销退回', () => {
        const initial = createEntryDocumentSessionState(identity, document())
        const runtime = createDocumentKernelDraftRuntime()
        const message: CanvasInputIntentMessage = {
            channel: PAGE_DOCUMENT_CANVAS_CHANNEL,
            version: PAGE_DOCUMENT_CANVAS_VERSION,
            sessionToken: 'a'.repeat(64),
            sequence: 1,
            type: 'input-intent',
            intentId: '86666666-6666-7666-8666-666666666666',
            nodeId: PARAGRAPH_ID,
            inputType: 'insertFromPaste',
            from: 4,
            to: 4,
            expected: '',
            text: '首行\n软换行\n\n第二段\n\n末段',
        }
        const operation = createCanvasInputKernelOperation(
            [message],
            'canvas-input-history:paste',
            'paragraph',
        )
        const prepared = runtime.prepare(initial.model, initial.snapshot, operation.request)
        assert.equal(prepared.status, 'ready', JSON.stringify(prepared))
        if (prepared.status !== 'ready') return
        const update = runtime.applyPrepared(
            initial.model,
            initial.snapshot,
            prepared.edit,
            '画布粘贴纯文本',
            {historyGroupId: 'canvas-input-history:paste'},
        )
        assert.equal(update.applied, true, JSON.stringify(update.diagnostics))
        const state = acceptEntryDocumentVisualUpdate(initial, update)
        const html = state.model.entry.sources['article.html']
        assert.match(html, /受管正文首行<br>软换行<br><br>第二段<br><br>末段<\/p>/u)
        assert.equal(
            readCanvasInputTarget(html, PARAGRAPH_ID)?.text,
            '受管正文首行\n软换行\n\n第二段\n\n末段',
        )
        assert.equal(state.model.entry.undo.length, 1)
        assert.equal(undoEntryDocumentSession(state).model.entry.sources['article.html'], initial.model.entry.sources['article.html'])
    })

    it('真实会话拒绝在 table-cell 进行 Shift+Enter 拆块且草稿保持不变', () => {
        const cellId = '87777777-7777-7777-8777-777777777777'
        const cellDocument = {
            ...document(),
            html: articleHtml().replace(
                '<p class="legacy">旧段落</p>',
                `<table><tbody><tr><td data-fc-node-id="${cellId}" data-fc-node-kind="table-cell">单元格</td></tr></tbody></table><p class="legacy">旧段落</p>`,
            ),
        }
        const state = createEntryDocumentSessionState(identity, cellDocument)
        const before = state.model.entry.sources['article.html']
        const message: CanvasInputIntentMessage = {
            channel: PAGE_DOCUMENT_CANVAS_CHANNEL,
            version: PAGE_DOCUMENT_CANVAS_VERSION,
            sessionToken: 'a'.repeat(64),
            sequence: 1,
            type: 'input-intent',
            intentId: '88888888-8888-7888-8888-888888888888',
            nodeId: cellId,
            inputType: 'insertParagraph',
            from: 2,
            to: 2,
            expected: '',
            text: '',
        }
        assert.deepEqual(readCanvasInputTarget(before, cellId), {kind: 'table-cell', text: '单元格'})
        assert.throws(
            () => createCanvasInputKernelOperation(
                [message],
                'canvas-input-history:table-enter',
                'table-cell',
                () => '89999999-9999-7999-8999-999999999999',
            ),
            /不支持创建后续文本块/u,
        )
        assert.equal(state.model.entry.sources['article.html'], before)
        assert.equal(state.model.entry.undo.length, 0)
    })
})
