// 本测试用生产会话提供的真实项目基线贯穿内核 prepare/apply，避免单元夹具掩盖项目源码策略错误。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {PageDocument} from '../../../api/pageDocument.ts'
import {createLayerProjection, type LayerProjectionNode} from '../domain/layerProjection.ts'
import {createDocumentKernelDraftRuntime} from './documentKernelDraftRuntime.ts'
import {
    acceptEntryDocumentVisualUpdate,
    createEntryDocumentSessionState,
} from './entryDocumentSessionModel.ts'
import {createOpaqueElementAdoptionKernelRequest} from './opaqueElementAdoption.ts'
import {createVisualPropertyEditRequest} from './visualPropertyEditing.ts'

const ENTRY_ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'
const PROJECT_ID = '11111111-1111-7111-8111-111111111111'
const ROOT_ID = '22222222-2222-7222-8222-222222222222'
const PARAGRAPH_ID = '33333333-3333-7333-8333-333333333333'
const ADOPTED_ID = '44444444-4444-7444-8444-444444444444'

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
            {},
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
})
