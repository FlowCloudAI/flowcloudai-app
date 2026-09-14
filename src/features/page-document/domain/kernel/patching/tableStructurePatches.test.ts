// 这些测试固定表格行列调整的最小 HTML 写回、身份分配顺序与过期前置条件。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parseSourceSnapshot, sourceKey, type SourceDocument} from '../contracts/index.ts'
import {
    findFirstElementByTagName,
    parseHtmlSource,
    readManagedTableStructure,
} from '../syntax/index.ts'
import {applySourcePatches} from './sourcePatches.ts'
import {createTableStructurePatches} from './tableStructurePatches.ts'

const TABLE_ID = '11111111-1111-4111-8111-111111111111'
const CELL_IDS = [
    '22222222-2222-4222-8222-222222222221',
    '22222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222223',
    '22222222-2222-4222-8222-222222222224',
    '22222222-2222-4222-8222-222222222225',
    '22222222-2222-4222-8222-222222222226',
    '22222222-2222-4222-8222-222222222227',
    '22222222-2222-4222-8222-222222222228',
    '22222222-2222-4222-8222-222222222229',
] as const
const NEW_IDS = [
    '33333333-3333-4333-8333-333333333331',
    '33333333-3333-4333-8333-333333333332',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333334',
    '33333333-3333-4333-8333-333333333335',
] as const

function cell(tag: 'th' | 'td', id: string, content: string): string {
    return `<${tag} data-fc-node-id="${id}" data-fc-node-kind="table-cell">${content}</${tag}>`
}

function document(content: string): SourceDocument {
    return Object.freeze({
        key: sourceKey('entry', 'article.html'),
        content,
        contentHash: 'fixture',
        persistentRevision: 1,
    })
}

function table(source: SourceDocument) {
    const parsed = parseHtmlSource(source.content, {mode: 'fragment', scope: 'entry'})
    const result = findFirstElementByTagName(parsed.root, 'table')
    assert.ok(result)
    return result
}

function apply(source: SourceDocument, patches: Parameters<typeof applySourcePatches>[1]): string {
    const snapshot = parseSourceSnapshot({
        id: 'snapshot:table-structure',
        templateVersion: 1,
        documents: [source],
    })
    const result = applySourcePatches(snapshot, patches)
    assert.equal(result.status, 'applied')
    return result.snapshot.documents[0].content
}

describe('table structure patches', () => {
    it('扩展现有行后再新增正文行，保留原单元格身份、内容和结构', () => {
        const source = document(
            `<table data-fc-node-id="${TABLE_ID}" data-fc-node-kind="table">
  <thead><tr>${cell('th', CELL_IDS[0], '甲')}${cell('th', CELL_IDS[1], '乙')}</tr></thead>
  <tbody><tr>${cell('td', CELL_IDS[2], '丙')}${cell('td', CELL_IDS[3], '<em>丁</em>')}</tr></tbody>
</table>`,
        )
        const planned = createTableStructurePatches(
            source,
            table(source),
            {rowCount: 2, columnCount: 2},
            {rowCount: 3, columnCount: 3},
            NEW_IDS,
        )

        assert.equal(planned.status, 'ready')
        if (planned.status !== 'ready') return
        assert.deepEqual(planned.removedNodeIds, [])
        const changed = document(apply(source, planned.patches))
        const structure = readManagedTableStructure(table(changed))
        assert.equal(structure?.rows.length, 3)
        assert.equal(structure?.columnCount, 3)
        assert.match(changed.content, new RegExp(`<em>丁</em>`, 'u'))
        assert.match(changed.content, new RegExp(CELL_IDS[3], 'u'))
        for (const id of NEW_IDS) assert.match(changed.content, new RegExp(id, 'u'))
    })

    it('缩减只删除末尾行列并报告所有被删除的托管身份', () => {
        const source = document(
            `<table data-fc-node-id="${TABLE_ID}" data-fc-node-kind="table">
  <thead><tr>${cell('th', CELL_IDS[0], 'A')}${cell('th', CELL_IDS[1], 'B')}${cell('th', CELL_IDS[2], 'C')}</tr></thead>
  <tbody>
    <tr>${cell('td', CELL_IDS[3], 'D')}${cell('td', CELL_IDS[4], 'E')}${cell('td', CELL_IDS[5], 'F')}</tr>
    <tr>${cell('td', CELL_IDS[6], 'G')}${cell('td', CELL_IDS[7], 'H')}${cell('td', CELL_IDS[8], 'I')}</tr>
  </tbody>
</table>`,
        )
        const planned = createTableStructurePatches(
            source,
            table(source),
            {rowCount: 3, columnCount: 3},
            {rowCount: 2, columnCount: 1},
            [],
        )

        assert.equal(planned.status, 'ready')
        if (planned.status !== 'ready') return
        assert.deepEqual(
            new Set(planned.removedNodeIds),
            new Set(CELL_IDS.slice(1).filter(id => id !== CELL_IDS[3])),
        )
        const changed = document(apply(source, planned.patches))
        const structure = readManagedTableStructure(table(changed))
        assert.equal(structure?.rows.length, 2)
        assert.equal(structure?.columnCount, 1)
        assert.match(changed.content, new RegExp(CELL_IDS[0], 'u'))
        assert.match(changed.content, new RegExp(CELL_IDS[3], 'u'))
        for (const id of planned.removedNodeIds)
            assert.doesNotMatch(changed.content, new RegExp(id, 'u'))
    })

    it('拒绝过期尺寸、错误 UUID 数量与无变化请求携带额外身份', () => {
        const source = document(
            `<table data-fc-node-id="${TABLE_ID}" data-fc-node-kind="table"><thead><tr>${cell('th', CELL_IDS[0], '甲')}${cell('th', CELL_IDS[1], '乙')}</tr></thead><tbody><tr>${cell('td', CELL_IDS[2], '丙')}${cell('td', CELL_IDS[3], '丁')}</tr></tbody></table>`,
        )
        const element = table(source)
        assert.equal(
            createTableStructurePatches(
                source,
                element,
                {rowCount: 3, columnCount: 2},
                {rowCount: 3, columnCount: 3},
                NEW_IDS,
            ).status,
            'rejected',
        )
        assert.equal(
            createTableStructurePatches(
                source,
                element,
                {rowCount: 2, columnCount: 2},
                {rowCount: 3, columnCount: 3},
                NEW_IDS.slice(0, 4),
            ).status,
            'rejected',
        )
        assert.equal(
            createTableStructurePatches(
                source,
                element,
                {rowCount: 2, columnCount: 2},
                {rowCount: 2, columnCount: 2},
                NEW_IDS.slice(0, 1),
            ).status,
            'rejected',
        )
        assert.equal(
            createTableStructurePatches(
                source,
                element,
                {rowCount: 2, columnCount: 2},
                {rowCount: 2, columnCount: 2},
                [],
            ).status,
            'unchanged',
        )
    })
})
