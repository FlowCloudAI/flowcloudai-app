import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {PageDocument} from '../../../api/pageDocument.ts'
import {createLayerProjection} from '../domain/layerProjection.ts'
import type {ComponentHandle} from '../domain/kernel/index.ts'
import {createDocumentKernelDraftRuntime} from './documentKernelDraftRuntime.ts'
import {
    acceptEntryDocumentVisualUpdate,
    createEntryDocumentSessionState,
    undoEntryDocumentSession,
} from './entryDocumentSessionModel.ts'
import {createPageNodeRemoval} from './pageNodeRemoval.ts'

const ENTRY_ID = '11111111-1111-7111-8111-111111111111'
const PROJECT_ID = '22222222-2222-7222-8222-222222222222'
const ROOT_ID = '33333333-3333-7333-8333-333333333333'
const FIRST_ID = '44444444-4444-7444-8444-444444444444'
const MIDDLE_ID = '55555555-5555-7555-8555-555555555555'
const LAST_ID = '66666666-6666-7666-8666-666666666666'

const identity = {
    entryId: ENTRY_ID,
    projectId: PROJECT_ID,
    title: '删除回归',
    summary: '',
    markdown: '',
}

function page(html: string): PageDocument {
    return {
        entryId: ENTRY_ID,
        projectId: PROJECT_ID,
        html,
        css: '',
        derivedText: '',
        revision: 1,
        modifiedBy: 'local',
        updatedAt: '2026-09-21T00:00:00Z',
    }
}

function article(paragraphs: readonly [string, string][]): string {
    return `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><div data-fc-node-id="${ROOT_ID}" data-fc-node-kind="container" data-fc-editor-root>${paragraphs.map(([id, text]) => `<p data-fc-node-id="${id}" data-fc-node-kind="paragraph">${text}</p>`).join('')}</div></template></template>`
}

describe('页面节点删除', () => {
    it('绑定入口发出 remove-component 并优先选中后一个相邻兄弟', () => {
        const nodes = createLayerProjection(article([
            [FIRST_ID, '甲'],
            [MIDDLE_ID, '乙'],
            [LAST_ID, '丙'],
        ])).nodes
        const removal = createPageNodeRemoval(nodes, MIDDLE_ID, '77777777-7777-7777-8777-777777777777')
        assert.ok(removal)
        assert.equal(removal.selectionAfterRemoval, LAST_ID)
        const handle = {nodeId: MIDDLE_ID} as ComponentHandle
        assert.deepEqual(removal.request.createIntents(new Map([[MIDDLE_ID, handle]])), [{
            kind: 'remove-component',
            target: {kind: 'component-root', component: handle},
            expectedParentNodeId: ROOT_ID,
            destinationScope: 'entry',
        }])
    })

    it('删除是一次可撤销历史，只剩一个可见段落时由内核拒绝且草稿不变', () => {
        const runtime = createDocumentKernelDraftRuntime()
        const multiHtml = article([[FIRST_ID, '甲'], [MIDDLE_ID, '乙']])
        const initial = createEntryDocumentSessionState(identity, page(multiHtml))
        const removal = createPageNodeRemoval(createLayerProjection(multiHtml).nodes, MIDDLE_ID)
        assert.ok(removal)
        const prepared = runtime.prepare(initial.model, initial.snapshot, removal.request)
        assert.equal(prepared.status, 'needs-decision', JSON.stringify(prepared))
        if (prepared.status !== 'needs-decision') return
        const update = runtime.applyPrepared(initial.model, initial.snapshot, prepared.edit, '删除页面节点')
        assert.equal(update.applied, true, JSON.stringify(update.diagnostics))
        const changed = acceptEntryDocumentVisualUpdate(initial, update)
        assert.doesNotMatch(changed.model.entry.sources['article.html'], new RegExp(MIDDLE_ID, 'u'))
        assert.equal(changed.model.entry.undo.length, 1)
        assert.equal(undoEntryDocumentSession(changed).model.entry.sources['article.html'], multiHtml)

        const singleHtml = article([[FIRST_ID, '唯一段落']])
        const single = createEntryDocumentSessionState(identity, page(singleHtml))
        const blocked = createPageNodeRemoval(createLayerProjection(singleHtml).nodes, FIRST_ID)
        assert.ok(blocked)
        const rejected = runtime.prepare(single.model, single.snapshot, blocked.request)
        assert.equal(rejected.status, 'rejected', JSON.stringify(rejected))
        assert.match(JSON.stringify(rejected), /至少保留一个实际可见的段落/u)
        assert.equal(single.model.entry.sources['article.html'], singleHtml)
        assert.equal(single.model.entry.undo.length, 0)
    })

    it('固定页面根不产生删除命令', () => {
        const html = article([[FIRST_ID, '正文']])
        assert.equal(createPageNodeRemoval(createLayerProjection(html).nodes, ROOT_ID), null)
    })
})
