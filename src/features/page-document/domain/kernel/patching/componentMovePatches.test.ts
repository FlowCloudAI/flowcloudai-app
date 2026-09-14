// 这些测试固定组件移动只搬运目标源码片段，并在同一快照上原子应用删除与插入补丁。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parseSourceSnapshot, sourceKey, type SourceDocument} from '../contracts/index.ts'
import {findElementsByAttribute, parseHtmlSource} from '../syntax/index.ts'
import {createComponentMovePatches} from './componentMovePatches.ts'
import {applySourcePatches} from './sourcePatches.ts'

const ROOT_ID = '11111111-1111-4111-8111-111111111111'
const FIRST_ID = '22222222-2222-4222-8222-222222222222'
const SECOND_ID = '33333333-3333-4333-8333-333333333333'
const THIRD_ID = '44444444-4444-4444-8444-444444444444'

function document(content: string): SourceDocument {
    return Object.freeze({
        key: sourceKey('entry', 'article.html'),
        content,
        contentHash: 'fixture',
        persistentRevision: 1,
    })
}

function elements(source: SourceDocument) {
    const parsed = parseHtmlSource(source.content, {mode: 'fragment', scope: 'entry'})
    const get = (id: string) => {
        const element = findElementsByAttribute(parsed, 'data-fc-node-id', id)[0]
        assert.ok(element)
        return element
    }
    return {root: get(ROOT_ID), first: get(FIRST_ID), second: get(SECOND_ID), third: get(THIRD_ID)}
}

function sourceHtml() {
    return `<div data-fc-node-id="${ROOT_ID}" data-fc-node-kind="container"><p data-fc-node-id="${FIRST_ID}" data-fc-node-kind="paragraph">甲</p><!-- keep --><p data-fc-node-id="${SECOND_ID}" data-fc-node-kind="paragraph"><strong>乙</strong></p><p data-fc-node-id="${THIRD_ID}" data-fc-node-kind="paragraph">丙</p></div>`
}

describe('component move patches', () => {
    it('把末项移动到首项之后并逐字保留节点内部源码与相邻注释', () => {
        const source = document(sourceHtml())
        const {root, first, third} = elements(source)
        const planned = createComponentMovePatches(source, third, root, first)

        assert.equal(planned.status, 'ready')
        if (planned.status !== 'ready') return
        const snapshot = parseSourceSnapshot({
            id: 'snapshot:component-move',
            templateVersion: 1,
            documents: [source],
        })
        const applied = applySourcePatches(snapshot, planned.patches)
        assert.equal(applied.status, 'applied')
        const changed = applied.snapshot.documents[0].content
        assert.ok(changed.indexOf(FIRST_ID) < changed.indexOf(THIRD_ID))
        assert.ok(changed.indexOf(THIRD_ID) < changed.indexOf(SECOND_ID))
        assert.match(changed, /<!-- keep -->/u)
        assert.match(changed, /<strong>乙<\/strong>/u)
    })

    it('拒绝错误逻辑文件及与目标自身重叠的插入位置', () => {
        const source = document(sourceHtml())
        const {root, first} = elements(source)
        assert.equal(
            createComponentMovePatches(
                {...source, key: sourceKey('entry', 'style.css')},
                first,
                root,
                null,
            ).status,
            'rejected',
        )
        const overlap = createComponentMovePatches(source, first, root, first)
        assert.equal(overlap.status, 'rejected')
        if (overlap.status === 'rejected') assert.equal(overlap.code, 'component-move-overlap')
    })
})
