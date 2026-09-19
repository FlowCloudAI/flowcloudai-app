// 本测试固定搜索片段到桌面词条打开意图的产品映射，并验证重复点击会形成新的画布选择请求。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {EntryBrief} from '../../../api/worldflow.ts'
import {
    advancePageDocumentSelectionRequest,
    pageDocumentSearchDescription,
    pageDocumentSearchOpenTarget,
} from './searchResultNavigation.ts'

const NODE_ID = '11111111-1111-4111-8111-111111111111'

function entry(overrides: Partial<EntryBrief> = {}): EntryBrief {
    return {
        id: '22222222-2222-4222-8222-222222222222',
        project_id: '33333333-3333-4333-8333-333333333333',
        title: '北境航线',
        summary: '词条摘要',
        type: null,
        cover: null,
        updated_at: '2026-09-19T00:00:00Z',
        ...overrides,
    }
}

describe('页面正文搜索结果导航', () => {
    it('正文命中显示段落片段，并把节点身份带入词条打开意图', () => {
        const result = entry({
            search_hit_node_id: NODE_ID,
            search_hit_snippet: '…贸易航线穿过冰封海岸…',
        })
        assert.equal(pageDocumentSearchDescription(result), '…贸易航线穿过冰封海岸…')
        assert.deepEqual(pageDocumentSearchOpenTarget(result), {
            id: result.id,
            title: result.title,
            pageDocumentNodeId: NODE_ID,
        })
    })

    it('普通列表不伪造节点定位，重复点击同一命中仍触发新的选择请求', () => {
        const ordinary = entry()
        assert.equal(pageDocumentSearchDescription(ordinary), '词条摘要')
        assert.deepEqual(pageDocumentSearchOpenTarget(ordinary), {id: ordinary.id, title: ordinary.title})
        const first = advancePageDocumentSelectionRequest(undefined, NODE_ID)
        const second = advancePageDocumentSelectionRequest(first, NODE_ID)
        assert.deepEqual(first, {nodeId: NODE_ID, requestId: 1})
        assert.deepEqual(second, {nodeId: NODE_ID, requestId: 2})
    })
})
