// 本测试锁定 Grid 任务窗格绑定发出的真实内核请求，并验证非 Grid 状态不会暴露轨道模型。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {EntrySourceSnapshot} from '../domain/contract.ts'
import {utf16Range, type ComponentHandle} from '../domain/kernel/index.ts'
import {createDocumentDraft} from './documentDraftModel.ts'
import {createDocumentKernelDraftRuntime} from './documentKernelDraftRuntime.ts'
import {createVisualPropertyEditRequest} from './visualPropertyEditing.ts'
import {
    createGridItemPlacementRequest,
    createGridTrackInsertRequest,
    createGridTrackReorderRequest,
    createGridTrackResizeRequest,
    gridTrackPresetSize,
    inspectGridEditor,
} from './gridVisualEditing.ts'

const ENTRY_ID = '11111111-1111-7111-8111-111111111111'
const GRID_ID = '22222222-2222-7222-8222-222222222222'
const CHILD_ID = '33333333-3333-7333-8333-333333333333'

function handle(nodeId: string, kind: ComponentHandle['kind']): ComponentHandle {
    return {
        handleId: `handle:${nodeId}` as ComponentHandle['handleId'],
        nodeId: nodeId as ComponentHandle['nodeId'],
        instanceId: `instance:${nodeId}`,
        kind,
        origin: {kind: 'author', source: {scope: 'entry', file: 'article.html'}, range: utf16Range(0, 1)},
        analysisStamp: 'analysis:grid-editor' as ComponentHandle['analysisStamp'],
    }
}

const bindings = new Map([
    [GRID_ID, handle(GRID_ID, 'container')],
    [CHILD_ID, handle(CHILD_ID, 'paragraph')],
])

function snapshot(display: 'block' | 'grid'): EntrySourceSnapshot {
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
        entry: {id: ENTRY_ID, title: 'Grid', summary: '', tags: []},
        documentVersion: 1,
        baseTemplateVersion: 1,
        revision: 1,
        hashes: {article: 'c'.repeat(64), style: 'd'.repeat(64)},
        articleHtml: `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><div data-fc-node-id="${GRID_ID}" data-fc-node-kind="container"><p data-fc-node-id="${CHILD_ID}" data-fc-node-kind="paragraph">正文</p></div></template></template>`,
        styleCss: `@layer fc-node { [data-fc-node-id="${GRID_ID}"][data-fc-node-kind="container"] { display: ${display}; grid-template-columns: 8rem minmax(0, 1fr); grid-template-rows: auto; } }`,
        assets: [],
        editorLimits: {paragraph: 100, asset: 100, managedNodes: 512, containerDepth: 3, containerChildren: 32},
        diagnostics: [],
        sourceStatus: 'ready',
    }
}

function snapshotWithAreas(): EntrySourceSnapshot {
    const source = snapshot('grid')
    return {
        ...source,
        styleCss: source.styleCss.replace(
            'grid-template-rows: auto;',
            'grid-template-rows: auto; grid-template-areas: "main side";',
        ),
    }
}

describe('grid visual editing binding', () => {
    it('轨道增删绑定发出带断点上下文的结构意图', () => {
        const inserted = createGridTrackInsertRequest(GRID_ID, 'desktop', 'columns', 2, 'fraction', 'insert')
            .createIntents(bindings)[0]
        assert.equal(inserted?.kind, 'change-grid-track-structure')
        if (inserted?.kind !== 'change-grid-track-structure') return
        assert.equal(inserted.context, 'desktop')
        assert.equal(inserted.axis, 'columns')
        assert.deepEqual(inserted.action, {kind: 'insert', trackIndex: 2, value: 'minmax(0, 1fr)'})
    })

    it('轨道类型切换与重排经绑定生成当前断点的属性意图', () => {
        const resized = createGridTrackResizeRequest(
            GRID_ID,
            'mobile',
            'columns',
            '8rem minmax(0, 1fr)',
            0,
            gridTrackPresetSize('content'),
            'resize',
        ).createIntents(bindings)[0]
        assert.equal(resized?.kind, 'edit-property')
        assert.deepEqual(resized?.action, {kind: 'set-value', value: 'auto minmax(0, 1fr)'})
        assert.deepEqual(resized?.destination.channel, {kind: 'base-rule'})

        const reordered = createGridTrackReorderRequest(
            GRID_ID,
            'desktop',
            'columns',
            '8rem minmax(0, 1fr)',
            1,
            0,
            'reorder',
        ).createIntents(bindings)[0]
        assert.equal(reordered?.kind, 'edit-property')
        assert.deepEqual(reordered?.action, {kind: 'set-value', value: 'minmax(0, 1fr) 8rem'})
        assert.deepEqual(reordered?.destination.channel, {kind: 'conditional-rule', context: 'desktop'})
    })

    it('子项跨行跨列绑定发出四个同一历史步骤内的位置意图', () => {
        const intents = createGridItemPlacementRequest(CHILD_ID, 'desktop', {
            column: {mode: 'positioned', start: 2, span: 3},
            row: {mode: 'positioned', start: 1, span: 2},
        }, 'placement').createIntents(bindings)
        assert.deepEqual(intents.map(intent => intent.kind === 'edit-property'
            ? [intent.property, intent.action, intent.destination.channel]
            : null), [
            ['grid-column-start', {kind: 'set-value', value: '2'}, {kind: 'conditional-rule', context: 'desktop'}],
            ['grid-column-end', {kind: 'set-value', value: 'span 3'}, {kind: 'conditional-rule', context: 'desktop'}],
            ['grid-row-start', {kind: 'set-value', value: '1'}, {kind: 'conditional-rule', context: 'desktop'}],
            ['grid-row-end', {kind: 'set-value', value: 'span 2'}, {kind: 'conditional-rule', context: 'desktop'}],
        ])
    })

    it('Grid 容器与子项对齐控件沿用当前断点的属性绑定', () => {
        const container = createVisualPropertyEditRequest(GRID_ID, [
            {property: 'align-items', value: {kind: 'keyword', value: 'center'}},
            {property: 'justify-content', value: {kind: 'keyword', value: 'space-between'}},
        ], {styleContext: 'mobile'}, () => 'grid-container-alignment').createIntents(bindings)
        assert.deepEqual(container.map(intent => intent.kind === 'edit-property'
            ? [intent.property, intent.action]
            : null), [
            ['align-items', {kind: 'set-value', value: 'center'}],
            ['justify-content', {kind: 'set-value', value: 'space-between'}],
        ])
        const child = createVisualPropertyEditRequest(CHILD_ID, [
            {property: 'align-self', value: {kind: 'keyword', value: 'stretch'}},
            {property: 'justify-self', value: {kind: 'keyword', value: 'end'}},
        ], {styleContext: 'desktop'}, () => 'grid-child-alignment').createIntents(bindings)
        assert.deepEqual(child.map(intent => intent.kind === 'edit-property'
            ? [intent.property, intent.action, intent.destination.channel]
            : null), [
            ['align-self', {kind: 'set-value', value: 'stretch'}, {kind: 'conditional-rule', context: 'desktop'}],
            ['justify-self', {kind: 'set-value', value: 'end'}, {kind: 'conditional-rule', context: 'desktop'}],
        ])
    })

    it('非 Grid 容器的真实检查结果不返回可渲染轨道组', () => {
        const source = snapshot('block')
        const model = createDocumentDraft(source)
        const runtime = createDocumentKernelDraftRuntime()
        const result = inspectGridEditor(
            GRID_ID,
            request => runtime.inspectComponent(model, source, request),
            'mobile',
        )
        assert.equal(result.status, 'not-grid')
        assert.match(result.reason ?? '', /不是 Grid/u)
    })

    it('命名区域沿真实检查入口返回内核拒绝码与作者可执行原因', () => {
        const source = snapshotWithAreas()
        const model = createDocumentDraft(source)
        const runtime = createDocumentKernelDraftRuntime()
        const result = inspectGridEditor(
            GRID_ID,
            request => runtime.inspectComponent(model, source, request),
            'mobile',
        )
        assert.equal(result.status, 'grid')
        assert.deepEqual(result.trackStructureBlock, {
            code: 'grid-template-areas-active',
            reason: '当前断点已定义命名区域；请先清除区域矩阵，再增删轨道。',
        })
    })
})
