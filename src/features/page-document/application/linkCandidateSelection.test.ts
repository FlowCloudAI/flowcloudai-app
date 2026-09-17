// 本测试从真实会话项目基线验证双链选择：只替换目标受管文本，内核生成可保存的 HTML 内链。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {EntryBrief} from '../../../api/worldflow.ts'
import type {PageDocument} from '../../../api/pageDocument.ts'
import {
    PAGE_DOCUMENT_CANVAS_CHANNEL,
    PAGE_DOCUMENT_CANVAS_VERSION,
    type CanvasLinkCandidateIntentMessage,
} from '../canvas/protocol/index.ts'
import {createDocumentKernelDraftRuntime} from './documentKernelDraftRuntime.ts'
import {
    acceptEntryDocumentVisualUpdate,
    createEntryDocumentSessionState,
    prepareEntryDocumentSave,
    undoEntryDocumentSession,
} from './entryDocumentSessionModel.ts'
import {createLinkCandidateKernelRequest, pageDocumentLinkCandidates} from './linkCandidateSelection.ts'

const ENTRY_ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'
const PROJECT_ID = '11111111-1111-7111-8111-111111111111'
const NODE_ID = '33333333-3333-7333-8333-333333333333'
const LINK_ID = '44444444-4444-7444-8444-444444444444'
const articleHtml = `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">前文[[星 后文</p></template></template>`

const linkedEntry: EntryBrief = {
    id: LINK_ID, project_id: PROJECT_ID, category_id: null, title: '星港', updated_at: '',
}

function candidate(query = '星'): CanvasLinkCandidateIntentMessage {
    return {
        channel: PAGE_DOCUMENT_CANVAS_CHANNEL,
        version: PAGE_DOCUMENT_CANVAS_VERSION,
        sessionToken: 'test-token',
        sequence: 1,
        type: 'link-candidate-intent',
        intentId: '55555555-5555-7555-8555-555555555555',
        nodeId: NODE_ID,
        query,
        from: 2,
        to: 5,
    }
}

describe('页面文档双链选择', () => {
    it('候选按当前项目已有列表筛选，排除当前词条并限制数量', () => {
        const entries = [linkedEntry, {...linkedEntry, id: ENTRY_ID}]
        assert.deepEqual(pageDocumentLinkCandidates(entries, ENTRY_ID, '星'), [linkedEntry])
        assert.deepEqual(pageDocumentLinkCandidates(Array.from({length: 12}, (_, index) => ({
            ...linkedEntry, id: `${String(index + 1).padStart(8, '0')}-4444-7444-8444-444444444444`,
        })), ENTRY_ID, '').length, 8)
    })

    it('真实会话把候选变为 HTML 内链，保留旁边源码，可撤销并可保存', () => {
        const document: PageDocument = {
            entryId: ENTRY_ID,
            projectId: PROJECT_ID,
            html: articleHtml,
            css: '/* 原有样式 */',
            derivedText: '前文[[星 后文',
            revision: 1,
            modifiedBy: 'local',
            updatedAt: '2026-09-17T00:00:00Z',
        }
        let state = createEntryDocumentSessionState({
            entryId: ENTRY_ID, projectId: PROJECT_ID, title: '当前词条', summary: '', markdown: '',
        }, document)
        const request = createLinkCandidateKernelRequest(articleHtml, candidate(), linkedEntry)
        assert.ok(request)
        const runtime = createDocumentKernelDraftRuntime()
        const prepared = runtime.prepare(state.model, state.snapshot, request)
        assert.equal(prepared.status, 'ready', JSON.stringify(prepared))
        if (prepared.status !== 'ready') return
        const applied = runtime.applyPrepared(state.model, state.snapshot, prepared.edit, '插入词条双链')
        assert.equal(applied.applied, true, JSON.stringify(applied.diagnostics))
        state = acceptEntryDocumentVisualUpdate(state, applied)
        const html = state.model.entry.sources['article.html']
        assert.match(html, /前文<a data-fc-inline-link href="fc:\/\/self\/entry\/44444444-4444-7444-8444-444444444444">星港<\/a> 后文/u)
        assert.equal(state.model.entry.sources['style.css'], document.css)
        assert.equal(prepareEntryDocumentSave(state, () => 'save-link-candidate').status, 'ready')
        assert.equal(undoEntryDocumentSession(state).model.entry.sources['article.html'], articleHtml)
    })

    it('节点不存在或范围已变化时拒绝候选，不接受画布自报文本', () => {
        assert.equal(createLinkCandidateKernelRequest(articleHtml, candidate('错'), linkedEntry), null)
        assert.equal(createLinkCandidateKernelRequest(articleHtml, {...candidate(), nodeId: LINK_ID}, linkedEntry), null)
    })

    it('已输入闭合方括号时一并替换，避免链接后残留 wiki 标记', () => {
        const complete = articleHtml.replace('[[星 后文', '[[星]] 后文')
        const request = createLinkCandidateKernelRequest(complete, candidate(), linkedEntry)
        assert.ok(request)
        const runtime = createDocumentKernelDraftRuntime()
        const state = createEntryDocumentSessionState({
            entryId: ENTRY_ID, projectId: PROJECT_ID, title: '当前词条', summary: '', markdown: '',
        }, {
            entryId: ENTRY_ID, projectId: PROJECT_ID, html: complete, css: '', derivedText: '',
            revision: 1, modifiedBy: 'local', updatedAt: '2026-09-17T00:00:00Z',
        })
        const prepared = runtime.prepare(state.model, state.snapshot, request)
        assert.equal(prepared.status, 'ready', JSON.stringify(prepared))
        if (prepared.status !== 'ready') return
        const applied = runtime.applyPrepared(state.model, state.snapshot, prepared.edit, '插入词条双链')
        assert.equal(applied.applied, true)
        assert.doesNotMatch(applied.model.entry.sources['article.html'], /\]\]/u)
    })
})
