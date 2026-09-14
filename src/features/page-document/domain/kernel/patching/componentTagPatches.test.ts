// 这些测试固定语义标签转换的成对最小补丁、源码保留和旧标签前置条件。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {sourceKey, type SourceDocument} from '../contracts/index.ts'
import {parseHtmlSource} from '../syntax/index.ts'
import {createComponentTagPatches} from './componentTagPatches.ts'
import {applySourcePatches} from './sourcePatches.ts'
import {parseSourceSnapshot} from '../contracts/source.ts'

const NODE_ID = '22222222-2222-4222-8222-222222222222'

function document(content: string): SourceDocument {
    return Object.freeze({
        key: sourceKey('entry', 'article.html'),
        content,
        contentHash: 'fixture',
        persistentRevision: 1,
    })
}

function elementOf(source: SourceDocument) {
    const parsed = parseHtmlSource(source.content, {mode: 'fragment', scope: 'entry'})
    const element = parsed.elements.find(item =>
        item.attrs.some(attribute => attribute.name === 'data-fc-node-id'),
    )
    assert.ok(element)
    return element
}

describe('component tag patches', () => {
    it('只替换开始与结束标签名并保留属性、空白和正文', () => {
        const source = document(
            `<h2 class="lead" data-fc-node-id="${NODE_ID}" data-fc-node-kind="heading">甲 <strong>乙</strong></h2>`,
        )
        const result = createComponentTagPatches(source, elementOf(source), 'h2', 'h4')
        assert.equal(result.status, 'ready')
        if (result.status !== 'ready') return
        const snapshot = parseSourceSnapshot({
            id: 'snapshot:component-tag',
            templateVersion: 1,
            documents: [source],
        })
        const applied = applySourcePatches(snapshot, result.patches)
        assert.equal(applied.status, 'applied')
        assert.equal(
            applied.snapshot.documents[0].content,
            `<h4 class="lead" data-fc-node-id="${NODE_ID}" data-fc-node-kind="heading">甲 <strong>乙</strong></h4>`,
        )
    })

    it('拒绝过期标签且相同目标不生成补丁', () => {
        const source = document(
            `<ul data-fc-node-id="${NODE_ID}" data-fc-node-kind="list"><li>甲</li></ul>`,
        )
        assert.equal(
            createComponentTagPatches(source, elementOf(source), 'ol', 'ul').status,
            'rejected',
        )
        assert.equal(
            createComponentTagPatches(source, elementOf(source), 'ul', 'ul').status,
            'unchanged',
        )
    })
})
