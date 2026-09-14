// 这些测试固定组件删除只移除目标源码子树，并准确报告其中全部托管身份。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parseSourceSnapshot, sourceKey, type SourceDocument} from '../contracts/index.ts'
import {findElementsByAttribute, parseHtmlSource} from '../syntax/index.ts'
import {createComponentRemovalPatch} from './componentRemovalPatches.ts'
import {applySourcePatches} from './sourcePatches.ts'

const CONTAINER_ID = '11111111-1111-4111-8111-111111111111'
const PARAGRAPH_ID = '22222222-2222-4222-8222-222222222222'
const SIBLING_ID = '33333333-3333-4333-8333-333333333333'

function document(content: string): SourceDocument {
    return Object.freeze({
        key: sourceKey('entry', 'article.html'),
        content,
        contentHash: 'fixture',
        persistentRevision: 1,
    })
}

function component(source: SourceDocument, id = CONTAINER_ID) {
    const parsed = parseHtmlSource(source.content, {mode: 'fragment', scope: 'entry'})
    const element = findElementsByAttribute(parsed, 'data-fc-node-id', id)[0]
    assert.ok(element)
    return element
}

describe('component removal patches', () => {
    it('精确移除目标子树，保留相邻源码并报告父子身份', () => {
        const source = document(
            `<div data-fc-node-id="${CONTAINER_ID}" data-fc-node-kind="container"><p data-fc-node-id="${PARAGRAPH_ID}" data-fc-node-kind="paragraph"><strong>甲</strong>乙</p></div><!-- keep --><p data-fc-node-id="${SIBLING_ID}" data-fc-node-kind="paragraph">保留</p>`,
        )
        const planned = createComponentRemovalPatch(source, component(source))

        assert.equal(planned.status, 'ready')
        if (planned.status !== 'ready') return
        assert.deepEqual(planned.removedNodeIds, [CONTAINER_ID, PARAGRAPH_ID])
        const snapshot = parseSourceSnapshot({
            id: 'snapshot:component-removal',
            templateVersion: 1,
            documents: [source],
        })
        const applied = applySourcePatches(snapshot, [planned.patch])
        assert.equal(applied.status, 'applied')
        assert.equal(
            applied.snapshot.documents[0].content,
            `<!-- keep --><p data-fc-node-id="${SIBLING_ID}" data-fc-node-kind="paragraph">保留</p>`,
        )
    })

    it('拒绝错误逻辑文件与缺失托管身份的目标', () => {
        const source = document(
            `<div data-fc-node-id="${CONTAINER_ID}" data-fc-node-kind="container"></div>`,
        )
        assert.equal(
            createComponentRemovalPatch(
                {...source, key: sourceKey('entry', 'style.css')},
                component(source),
            ).status,
            'rejected',
        )
        const plain = document('<div>普通源码</div>')
        const parsed = parseHtmlSource(plain.content, {mode: 'fragment', scope: 'entry'})
        const element = parsed.elements.find(candidate => candidate.tagName === 'div')
        assert.ok(element)
        assert.equal(createComponentRemovalPatch(plain, element).status, 'rejected')
    })
})
