// 这些测试固定 hidden 属性的最小源码补丁、前置状态和自闭合标签边界。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {sourceKey, type SourceDocument} from '../contracts/index.ts'
import {parseHtmlSource} from '../syntax/index.ts'
import {createComponentVisibilityPatch} from './componentVisibilityPatches.ts'
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

function apply(source: SourceDocument, expectedHidden: boolean, hidden: boolean): string {
    const result = createComponentVisibilityPatch(source, elementOf(source), expectedHidden, hidden)
    assert.equal(result.status, 'ready')
    if (result.status !== 'ready') return source.content
    const snapshot = parseSourceSnapshot({
        id: 'snapshot:visibility',
        templateVersion: 1,
        documents: [source],
    })
    const applied = applySourcePatches(snapshot, [result.patch])
    assert.equal(applied.status, 'applied')
    return applied.snapshot.documents[0].content
}

describe('component visibility patches', () => {
    it('只添加和移除 hidden 属性并保留相邻源码', () => {
        const source = document(
            `<p class="lead" data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">正文</p>`,
        )
        const hidden = apply(source, false, true)
        assert.match(hidden, /data-fc-node-kind="paragraph" hidden>正文/u)
        assert.equal(apply(document(hidden), true, false), source.content)
    })

    it('拒绝过期前置状态且相同目标状态不生成补丁', () => {
        const source = document(
            `<p hidden data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">正文</p>`,
        )
        assert.equal(
            createComponentVisibilityPatch(source, elementOf(source), false, true).status,
            'rejected',
        )
        assert.equal(
            createComponentVisibilityPatch(source, elementOf(source), true, true).status,
            'unchanged',
        )
    })

    it('在自闭合标签结束符前插入 hidden', () => {
        const source = document(
            `<img data-fc-node-id="${NODE_ID}" data-fc-node-kind="asset" src="asset://fixture"/>`,
        )
        assert.match(apply(source, false, true), /src="asset:\/\/fixture" hidden\/>/u)
    })
})
