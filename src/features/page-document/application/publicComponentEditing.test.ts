// 本测试从真实页面文档会话验证公共组件实例的插入、属性写回、撤销和缺失定义拒绝。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {PageDocument} from '../../../api/pageDocument.ts'
import {
    acceptEntryDocumentVisualUpdate,
    createEntryDocumentSessionState,
    undoEntryDocumentSession,
    type EntryDocumentSessionState,
} from './entryDocumentSessionModel.ts'
import {createDocumentKernelDraftRuntime} from './documentKernelDraftRuntime.ts'
import {
    createPublicComponentInstanceEditRequest,
    createPublicComponentInsertionRequest,
    createPublicComponentLocalizationRequest,
} from './publicComponentEditing.ts'
import type {PublicComponentDefinitionContract} from '../domain/kernel/contracts/publicComponent.ts'
import {createLayerProjection} from '../domain/layerProjection.ts'
import {findLayerNode} from './visualSelectionModel.ts'
import {compilePreviewArtifact} from '../domain/engine/previewCompiler.ts'
import {CANVAS_BASE_PROJECT_CSS, CANVAS_BASE_PROJECT_HTML} from '../canvas/host/compiledPreview.ts'

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT_ID = '22222222-2222-4222-8222-222222222222'
const ROOT_ID = '33333333-3333-4333-8333-333333333333'
const PARAGRAPH_ID = '44444444-4444-4444-8444-444444444444'
const COMPONENT_ID = '55555555-5555-4555-8555-555555555555'
const COMPONENT_NODE_A = '66666666-6666-4666-8666-666666666666'
const COMPONENT_INSTANCE_A = '77777777-7777-4777-8777-777777777777'
const COMPONENT_NODE_B = '88888888-8888-4888-8888-888888888888'
const COMPONENT_INSTANCE_B = '99999999-9999-4999-8999-999999999999'
const REQUEST_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REQUEST_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const REQUEST_EDIT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const LOCAL_ROOT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const LOCAL_ARTICLE_ID = 'abababab-abab-4bab-8bab-abababababab'
const LOCAL_HEADING_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const LOCAL_PARAGRAPH_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const LOCAL_REQUEST_ID = '12121212-1212-4212-8212-121212121212'

const definition: PublicComponentDefinitionContract = {
    componentId: COMPONENT_ID,
    revision: 1,
    html: '<article><h2>模板标题 {{title}}</h2><p data-fc-part="body">默认内容</p></article>',
    css: `@layer fc-component { [data-fc-component="${COMPONENT_ID}"] { display: grid; } }`,
    propertySchema: [{name: 'title', valueType: 'text', required: false}],
    partSchema: [{name: 'body', accepts: ['text'], required: false}],
    styleVariableSchema: [{name: '--accent', syntax: '<color>', initialValue: null}],
    assetDependencies: [],
    name: '公共卡片',
    category: '基础',
    preview: null,
    ownershipScope: {kind: 'project', id: PROJECT_ID},
}

function article(): string {
    return `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><div data-fc-node-id="${ROOT_ID}" data-fc-node-kind="container" data-fc-editor-root><p data-fc-node-id="${PARAGRAPH_ID}" data-fc-node-kind="paragraph">保留正文</p></div></template></template>`
}

function document(html = article()): PageDocument {
    return {
        entryId: ENTRY_ID,
        projectId: PROJECT_ID,
        html,
        css: '',
        derivedText: '保留正文',
        revision: 1,
        modifiedBy: 'local',
        updatedAt: '2026-09-19T00:00:00Z',
    }
}

function session(definitions: readonly PublicComponentDefinitionContract[] = [definition]): EntryDocumentSessionState {
    return createEntryDocumentSessionState(
        {entryId: ENTRY_ID, projectId: PROJECT_ID, title: '组件', summary: '', markdown: ''},
        document(),
        [],
        definitions,
    )
}

function apply(
    state: EntryDocumentSessionState,
    request: Parameters<ReturnType<typeof createDocumentKernelDraftRuntime>['prepare']>[2],
    label: string,
): EntryDocumentSessionState {
    const runtime = createDocumentKernelDraftRuntime()
    const prepared = runtime.prepare(state.model, state.snapshot, request)
    assert.equal(prepared.status, 'ready', JSON.stringify(prepared))
    if (prepared.status !== 'ready') return state
    const update = runtime.applyPrepared(state.model, state.snapshot, prepared.edit, label)
    assert.equal(update.applied, true, JSON.stringify(update.diagnostics))
    return acceptEntryDocumentVisualUpdate(state, update)
}

describe('公共组件实例编辑', () => {
    it('宿主分配身份后可连续插入同一定义，并隔离同名 part', () => {
        let ids = [COMPONENT_NODE_A, COMPONENT_INSTANCE_A, REQUEST_A]
        const first = createPublicComponentInsertionRequest(ROOT_ID, definition, () => ids.shift()!, {
            parts: {body: '第一实例'},
            properties: {title: '甲'},
        })
        const inserted = apply(session(), first.request, '插入公共组件')
        ids = [COMPONENT_NODE_B, COMPONENT_INSTANCE_B, REQUEST_B]
        const second = createPublicComponentInsertionRequest(ROOT_ID, definition, () => ids.shift()!, {
            parts: {body: '第二实例'},
            properties: {title: '乙'},
        })
        const changed = apply(inserted, second.request, '插入公共组件')
        const source = changed.model.entry.sources['article.html']
        assert.match(source, new RegExp(`data-fc-node-id="${COMPONENT_NODE_A}"`, 'u'))
        assert.match(source, new RegExp(`data-fc-node-id="${COMPONENT_NODE_B}"`, 'u'))
        assert.equal((source.match(/data-fc-component-revision="latest"/gu) ?? []).length, 2)
        assert.equal((source.match(/data-fc-part="body"/gu) ?? []).length, 2)
        assert.equal((source.match(/data-fc-instance=/gu) ?? []).length, 2)
        assert.equal(undoEntryDocumentSession(changed).model.entry.sources['article.html'], inserted.model.entry.sources['article.html'])
    })

    it('实例属性和样式变量只写公开覆盖，撤销恢复原始实例源码', () => {
        const ids = [COMPONENT_NODE_A, COMPONENT_INSTANCE_A, REQUEST_A]
        const inserted = apply(
            session(),
            createPublicComponentInsertionRequest(ROOT_ID, definition, () => ids.shift()!, {
                parts: {body: '插槽'},
                properties: {title: '旧标题'},
            }).request,
            '插入公共组件',
        )
        const edited = apply(
            inserted,
            createPublicComponentInstanceEditRequest(
                COMPONENT_NODE_A,
                {title: '新标题'},
                {'--accent': 'red'},
                REQUEST_EDIT,
            ),
            '修改公共组件属性',
        )
        const source = edited.model.entry.sources['article.html']
        assert.match(source, /data-fc-prop-title="新标题"/u)
        assert.match(source, /style="--accent: red;"/u)
        assert.match(source, /data-fc-part="body">插槽/u)
        assert.match(source, /<p data-fc-node-id="44444444-4444-4444-8444-444444444444" data-fc-node-kind="paragraph">保留正文<\/p>/u)
        assert.equal(undoEntryDocumentSession(edited).model.entry.sources['article.html'], inserted.model.entry.sources['article.html'])
    })

    it('缺失定义时插入在内核入口拒绝且不改变草稿', () => {
        const missing: PublicComponentDefinitionContract = {
            ...definition,
            componentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        }
        const ids = [COMPONENT_NODE_A, COMPONENT_INSTANCE_A, REQUEST_A]
        const request = createPublicComponentInsertionRequest(ROOT_ID, missing, () => ids.shift()!).request
        const original = session()
        const result = createDocumentKernelDraftRuntime().prepare(original.model, original.snapshot, request)
        assert.equal(result.status, 'rejected')
        assert.equal(original.model.entry.sources['article.html'], article())
        assert.equal(original.persistedRevision, 1)
    })

    it('把实例一次物化为带新身份的本地内容并可一次撤销', () => {
        const insertionIds = [COMPONENT_NODE_A, COMPONENT_INSTANCE_A, REQUEST_A]
        const inserted = apply(
            session(),
            createPublicComponentInsertionRequest(ROOT_ID, definition, () => insertionIds.shift()!, {
                parts: {body: '实例插槽'},
                properties: {title: '实例标题'},
            }).request,
            '插入公共组件',
        )
        const before = inserted.model.entry.sources['article.html']
        const node = findLayerNode(createLayerProjection(before).nodes, COMPONENT_NODE_A)
        assert.ok(node?.range)
        const instanceSource = before.slice(node.range.from, node.range.to)
        const localizationIds = [
            LOCAL_ROOT_ID,
            LOCAL_ARTICLE_ID,
            LOCAL_HEADING_ID,
            LOCAL_PARAGRAPH_ID,
            LOCAL_REQUEST_ID,
        ]
        const operation = createPublicComponentLocalizationRequest(
            COMPONENT_NODE_A,
            COMPONENT_INSTANCE_A,
            instanceSource,
            definition,
            [ROOT_ID, PARAGRAPH_ID, COMPONENT_NODE_A, COMPONENT_INSTANCE_A],
            [],
            () => localizationIds.shift()!,
        )
        const localized = apply(inserted, operation.request, '转为本地内容')
        const html = localized.model.entry.sources['article.html']
        const style = localized.model.entry.sources['style.css']
        assert.equal(operation.newRootNodeId, LOCAL_ROOT_ID)
        assert.doesNotMatch(html, new RegExp(COMPONENT_NODE_A, 'u'))
        assert.doesNotMatch(html, new RegExp(COMPONENT_INSTANCE_A, 'u'))
        assert.doesNotMatch(html, /data-fc-component/u)
        assert.match(html, new RegExp(`data-fc-node-id="${LOCAL_ROOT_ID}"`, 'u'))
        assert.match(html, new RegExp(`data-fc-node-id="${LOCAL_HEADING_ID}"`, 'u'))
        assert.match(html, new RegExp(`data-fc-node-id="${LOCAL_PARAGRAPH_ID}"`, 'u'))
        assert.match(html, /模板标题 实例标题/u)
        assert.match(html, /实例插槽/u)
        assert.match(style, /@layer fc-node/u)
        assert.match(style, new RegExp(`\\[data-fc-node-id="${LOCAL_ROOT_ID}"\\]`, 'u'))

        const preview = compilePreviewArtifact({
            projectArticleHtml: CANVAS_BASE_PROJECT_HTML,
            projectStyleCss: CANVAS_BASE_PROJECT_CSS,
            entryArticleHtml: html,
            entryStyleCss: style,
            metadata: {id: ENTRY_ID, title: '组件', summary: '', tags: []},
            componentDefinitions: [{...definition, revision: 2, html: '<section>新版不应影响本地副本</section>'}],
        })
        assert.ok(preview.srcdoc, JSON.stringify(preview.diagnostics))
        assert.equal(preview.textBlocks?.some(block => block.text.includes('模板标题 实例标题')), true)
        assert.doesNotMatch(preview.srcdoc ?? '', /新版不应影响本地副本/u)

        const undone = undoEntryDocumentSession(localized)
        assert.equal(undone.model.entry.sources['article.html'], before)
        assert.equal(undone.model.entry.sources['style.css'], inserted.model.entry.sources['style.css'])
    })
})
