// 本模块验证跨作用域源码补丁的前置条件、Unicode 边界、重叠检测和失败原子性。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parseSourceSnapshot, sourceKey, utf16Range} from '../contracts/index.ts'
import {applySourcePatches, type SourcePatch} from './sourcePatches.ts'

function snapshot() {
    return parseSourceSnapshot({
        id: 'snapshot:patches',
        templateVersion: 1,
        documents: [
            {
                key: {scope: 'project', file: 'article.html'},
                content: '<main>项目</main>',
                contentHash: 'project-html',
                persistentRevision: 3,
            },
            {
                key: {scope: 'project', file: 'style.css'},
                content: ':root { color: black; }',
                contentHash: 'project-css',
                persistentRevision: 3,
            },
            {
                key: {scope: 'entry', file: 'article.html'},
                content: '<p>甲😀乙</p>',
                contentHash: 'entry-html',
                persistentRevision: 7,
            },
            {
                key: {scope: 'entry', file: 'style.css'},
                content: 'p { color: red; }',
                contentHash: 'entry-css',
                persistentRevision: 7,
            },
        ],
    })
}

describe('atomic scoped source patches', () => {
    it('在同一基线原子修改项目与词条，并保持持久化 revision', () => {
        const base = snapshot()
        const result = applySourcePatches(base, [
            {
                source: sourceKey('project', 'style.css'),
                range: utf16Range(15, 20),
                expected: 'black',
                insert: 'navy',
            },
            {
                source: sourceKey('entry', 'article.html'),
                range: utf16Range(3, 7),
                expected: '甲😀乙',
                insert: '丙😀丁',
            },
        ])

        assert.equal(result.status, 'applied')
        if (result.status !== 'applied') return
        assert.notEqual(result.snapshot.id, base.id)
        assert.deepEqual(
            result.changedSources.map(item => `${item.scope}:${item.file}`),
            ['project:style.css', 'entry:article.html'],
        )
        assert.equal(result.snapshot.documents[1].content, ':root { color: navy; }')
        assert.equal(result.snapshot.documents[2].content, '<p>丙😀丁</p>')
        assert.equal(result.snapshot.documents[1].persistentRevision, 3)
        assert.equal(result.snapshot.documents[2].persistentRevision, 7)
    })

    it('任一 expected 失败时不暴露其他文件已经修改的部分候选', () => {
        const base = snapshot()
        const result = applySourcePatches(base, [
            {
                source: sourceKey('project', 'style.css'),
                range: utf16Range(15, 20),
                expected: 'black',
                insert: 'navy',
            },
            {
                source: sourceKey('entry', 'style.css'),
                range: utf16Range(11, 14),
                expected: 'blue',
                insert: 'green',
            },
        ])

        assert.equal(result.status, 'rejected')
        assert.equal(result.snapshot, base)
        if (result.status === 'rejected') {
            assert.equal(result.failures[0]?.code, 'source-precondition-failed')
        }
    })

    it('拒绝重叠、共享插入起点和代理对内部坐标', () => {
        const base = snapshot()
        const overlapping: SourcePatch[] = [
            {
                source: sourceKey('entry', 'style.css'),
                range: utf16Range(4, 9),
                expected: 'color',
                insert: 'width',
            },
            {
                source: sourceKey('entry', 'style.css'),
                range: utf16Range(7, 7),
                expected: '',
                insert: 'x',
            },
        ]
        const overlapResult = applySourcePatches(base, overlapping)
        assert.equal(overlapResult.status, 'rejected')
        if (overlapResult.status === 'rejected') {
            assert.equal(overlapResult.failures.at(-1)?.code, 'overlapping-source-patches')
        }

        const unicodeResult = applySourcePatches(base, [
            {
                source: sourceKey('entry', 'article.html'),
                range: utf16Range(5, 6),
                expected: '\ude00',
                insert: 'x',
            },
        ])
        assert.equal(unicodeResult.status, 'rejected')
        if (unicodeResult.status === 'rejected') {
            assert.equal(unicodeResult.failures[0]?.code, 'invalid-source-range')
        }
    })

    it('相同替换返回 unchanged，不创建伪候选版本', () => {
        const base = snapshot()
        const result = applySourcePatches(base, [
            {
                source: sourceKey('entry', 'style.css'),
                range: utf16Range(11, 14),
                expected: 'red',
                insert: 'red',
            },
        ])

        assert.equal(result.status, 'unchanged')
        assert.equal(result.snapshot, base)
    })
})
