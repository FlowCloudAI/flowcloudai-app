// 本测试从“插入”功能区绑定入口验证宿主身份分配与内核策略拒绝，避免只测试结构序列化。

import assert from 'node:assert/strict'
import test from 'node:test'
import {createBuiltInStructureInsertion} from './builtInStructureInsertion.ts'
import {createDocumentKernelDraftRuntime} from './documentKernelDraftRuntime.ts'
import {createEntryDocumentSessionState} from './entryDocumentSessionModel.ts'

const ROOT = '11111111-1111-4111-8111-111111111111'
const PARAGRAPH = '22222222-2222-4222-8222-222222222222'
const ENTRY = '018f47a2-3b4c-7d5e-8f90-123456789abc'
const IDS = [
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
    '77777777-7777-4777-8777-777777777777',
    '88888888-8888-4888-8888-888888888888',
    '99999999-9999-4999-8999-999999999999',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
]

function state() {
    return createEntryDocumentSessionState({
        projectId: 'project', entryId: ENTRY, title: '词条', summary: '', markdown: '',
    }, {
        entryId: ENTRY, projectId: 'project', revision: 1,
        html: `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><div data-fc-node-id="${ROOT}" data-fc-node-kind="container" data-fc-editor-root><p data-fc-node-id="${PARAGRAPH}" data-fc-node-kind="paragraph">正文</p></div></template></template>`,
        css: '', derivedText: '正文', modifiedBy: null, updatedAt: '2026-09-20T00:00:00Z',
    })
}

test('插入页签为列表和表格分配全部宿主节点身份', () => {
    for (const [kind, expectedChildren] of [['list', 1], ['table', 9]] as const) {
        const allocated = [...IDS]
        const insertion = createBuiltInStructureInsertion(
            {parentId: ROOT, afterId: PARAGRAPH},
            kind,
            () => allocated.shift()!,
            `${kind}-request`,
        )
        const current = state()
        const preparation = createDocumentKernelDraftRuntime().prepare(
            current.model,
            current.snapshot,
            insertion.request,
        )
        assert.equal(preparation.status, 'ready')
        if (preparation.status !== 'ready') continue
        const applied = createDocumentKernelDraftRuntime().applyPrepared(
            current.model,
            current.snapshot,
            preparation.edit,
            `插入${kind}`,
        )
        assert.equal(applied.applied, true, JSON.stringify(applied.diagnostics))
        const html = applied.model.entry.sources['article.html']
        assert.match(html, new RegExp(`data-fc-node-id="${insertion.newNodeId}"[^>]+data-fc-node-kind="${kind}"`, 'u'))
        assert.equal(insertion.newChildNodeIds.length, expectedChildren)
        for (const childId of insertion.newChildNodeIds) assert.match(html, new RegExp(childId, 'u'))
    }
})

test('插入页签的策略拒绝不产生候选补丁', () => {
    const insertion = createBuiltInStructureInsertion(
        {parentId: PARAGRAPH, afterId: null},
        'table',
        () => IDS.shift()!,
        'rejected-request',
    )
    const current = state()
    const preparation = createDocumentKernelDraftRuntime().prepare(
        current.model,
        current.snapshot,
        insertion.request,
    )
    assert.equal(preparation.status, 'rejected')
    if (preparation.status === 'rejected') {
        assert.match(preparation.diagnostics[0]?.message ?? '', /不支持插入子组件/u)
    }
})
