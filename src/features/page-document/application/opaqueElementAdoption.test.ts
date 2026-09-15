// 这些测试固定旧源码元素经内核纳入后只增加身份、可撤销，且未知类型不提供纳入动作。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {EntrySourceSnapshot} from '../domain/contract.ts'
import {createLayerProjection, type LayerProjectionNode} from '../domain/layerProjection.ts'
import {createDocumentDraft, undoEntryDraft} from './documentDraftModel.ts'
import {createDocumentKernelDraftRuntime} from './documentKernelDraftRuntime.ts'
import {
    createOpaqueElementAdoptionKernelRequest,
    inferOpaqueAdoptionKind,
} from './opaqueElementAdoption.ts'

const ENTRY_ID = '11111111-1111-7111-8111-111111111111'
const ROOT_ID = '22222222-2222-7222-8222-222222222222'
const ADOPTED_ID = '33333333-3333-7333-8333-333333333333'

function article(body: string): string {
    return `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><div data-fc-node-id="${ROOT_ID}" data-fc-node-kind="container">${body}</div></template></template>`
}

function snapshot(articleHtml: string): EntrySourceSnapshot {
    return {
        project: {
            projectRevision: 1,
            templateVersion: 1,
            hashes: {article: 'a'.repeat(64), style: 'b'.repeat(64)},
            defaultArticleHtml: '<!doctype html><html data-fc-document-version="1" data-fc-template-version="1"><head></head><body><main data-fc-slot="entry-root"><div data-fc-slot="entry-body"></div></main></body></html>',
            defaultStyleCss: '@layer fc-renderer, fc-project, fc-entry, fc-node;',
            diagnostics: [],
            sourceStatus: 'ready',
        },
        entry: {id: ENTRY_ID, title: '旧段落', summary: '', tags: []},
        documentVersion: 1,
        baseTemplateVersion: 1,
        revision: 1,
        hashes: {article: 'c'.repeat(64), style: 'd'.repeat(64)},
        articleHtml,
        styleCss: '',
        assets: [],
        editorLimits: {paragraph: 100, asset: 100, managedNodes: 512, containerDepth: 3, containerChildren: 32},
        diagnostics: [],
        sourceStatus: 'ready',
    }
}

function findSourceNode(nodes: readonly LayerProjectionNode[], tagName: string): LayerProjectionNode {
    const pending = [...nodes]
    while (pending.length > 0) {
        const node = pending.shift()
        assert.ok(node)
        if (node.kind === 'source' && node.tagName === tagName) return node
        pending.unshift(...node.children)
    }
    throw new Error(`未找到 <${tagName}> 源码节点。`)
}

describe('旧页面元素纳入可视编辑', () => {
    it('段落纳入后只增加身份属性并可由同一草稿历史撤销', () => {
        const raw = '<p class="lead"><strong>原样</strong>&amp;正文</p>'
        const source = snapshot(article(raw))
        const model = createDocumentDraft(source)
        const node = findSourceNode(createLayerProjection(source.articleHtml).nodes, 'p')
        const request = createOpaqueElementAdoptionKernelRequest({
            node,
            articleHtml: source.articleHtml,
            newNodeId: ADOPTED_ID,
            allocateRequestId: () => 'adopt-old-paragraph',
        })
        const runtime = createDocumentKernelDraftRuntime()
        const prepared = runtime.prepare(model, source, request)

        assert.equal(inferOpaqueAdoptionKind(node), 'paragraph')
        assert.equal(prepared.status, 'ready', JSON.stringify(prepared))
        if (prepared.status !== 'ready') return
        const applied = runtime.applyPrepared(model, source, prepared.edit, '纳入可视编辑')
        assert.equal(applied.applied, true, JSON.stringify(applied.diagnostics))
        assert.ok(applied.applied)
        assert.equal(
            applied.model.entry.sources['article.html'],
            article(`<p class="lead" data-fc-node-id="${ADOPTED_ID}" data-fc-node-kind="paragraph"><strong>原样</strong>&amp;正文</p>`),
        )
        assert.deepEqual(undoEntryDraft(applied.model).model.entry.sources, model.entry.sources)
    })

    it('无法推断类型的源码元素不产生纳入动作', () => {
        const source = snapshot(article('<aside>旁注</aside>'))
        const node = findSourceNode(createLayerProjection(source.articleHtml).nodes, 'aside')

        assert.equal(inferOpaqueAdoptionKind(node), null)
        assert.throws(() => createOpaqueElementAdoptionKernelRequest({
            node,
            articleHtml: source.articleHtml,
            newNodeId: ADOPTED_ID,
        }), /无法安全推断/u)
    })
})
