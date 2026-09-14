// 本模块把矩形可视表格的行列调整编译为最小 HTML 补丁；删除单元格的样式回收由同一计划器组合。

import {
    TABLE_MAX_COLUMN_COUNT,
    TABLE_MAX_ROW_COUNT,
    TABLE_MIN_COLUMN_COUNT,
    TABLE_MIN_ROW_COUNT,
} from '../../contract.ts'
import type {HtmlCompositionElement} from '../composition/index.ts'
import {utf16Range, type SourceDocument} from '../contracts/source.ts'
import {
    elementRange,
    getAttribute,
    readManagedTableStructure,
    walkElements,
} from '../syntax/index.ts'
import type {SourcePatch} from './sourcePatches.ts'

export interface TableDimensionsExpectation {
    readonly rowCount: number
    readonly columnCount: number
}

export type TableStructurePatchResult =
    | {
          readonly status: 'ready'
          readonly patches: readonly SourcePatch[]
          readonly removedNodeIds: readonly string[]
      }
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export function createTableStructurePatches(
    document: SourceDocument,
    table: HtmlCompositionElement,
    expected: TableDimensionsExpectation,
    target: TableDimensionsExpectation,
    newCellNodeIds: readonly string[],
): TableStructurePatchResult {
    if (document.key.file !== 'article.html') {
        return rejected('table-source-invalid', '表格结构只能写入 article.html。')
    }
    const structure = readManagedTableStructure(table)
    if (!structure) {
        return rejected(
            'invalid-managed-table-structure',
            '当前表格不是可视编辑器支持的矩形表头/正文结构。',
        )
    }
    const current = Object.freeze({
        rowCount: structure.rows.length,
        columnCount: structure.columnCount,
    })
    if (current.rowCount !== expected.rowCount || current.columnCount !== expected.columnCount) {
        return rejected('table-dimension-precondition-failed', '表格行列数已变化，请重新读取。')
    }
    if (!validDimensions(target)) {
        return rejected(
            'managed-table-dimension-limit',
            `可视表格限制为 ${TABLE_MIN_ROW_COUNT}–${TABLE_MAX_ROW_COUNT} 行、${TABLE_MIN_COLUMN_COUNT}–${TABLE_MAX_COLUMN_COUNT} 列（行数包含表头）。`,
        )
    }
    const requiredNodeIds = requiredNewCellCount(current, target)
    if (newCellNodeIds.length !== requiredNodeIds) {
        return rejected(
            'table-new-cell-id-count-mismatch',
            `本次调整需要 ${requiredNodeIds} 个新单元格 UUID。`,
        )
    }
    const normalizedIds = newCellNodeIds.map(value => value.toLowerCase())
    if (new Set(normalizedIds).size !== normalizedIds.length) {
        return rejected('duplicate-node-id', '新单元格 UUID 在本次调整中不能重复。')
    }
    if (current.rowCount === target.rowCount && current.columnCount === target.columnCount) {
        return {status: 'unchanged'}
    }

    const patches: SourcePatch[] = []
    const removedNodeIds: string[] = []
    const retainedRowCount = Math.min(current.rowCount, target.rowCount)
    for (const row of structure.rows.slice(target.rowCount)) {
        const patch = removalPatch(document, row.element)
        if (!patch) return rejected('source-location-missing', '无法定位待删除表格行。')
        patches.push(patch)
        removedNodeIds.push(...managedNodeIds(row.element))
    }
    for (const row of structure.rows.slice(0, retainedRowCount)) {
        if (target.columnCount >= current.columnCount) continue
        for (const cell of row.cells.slice(target.columnCount)) {
            const patch = removalPatch(document, cell)
            if (!patch) return rejected('source-location-missing', '无法定位待删除表格单元格。')
            patches.push(patch)
            const id = getAttribute(cell, 'data-fc-node-id')
            if (id) removedNodeIds.push(id.toLowerCase())
        }
    }

    let nextId = 0
    if (target.columnCount > current.columnCount) {
        for (const row of structure.rows.slice(0, retainedRowCount)) {
            const lastCell = row.cells.at(-1)
            const range = lastCell ? elementRange(lastCell) : undefined
            if (!lastCell || !range) {
                return rejected('source-location-missing', '无法定位表格扩列位置。')
            }
            const indent = indentationAt(document.content, range.from)
            const tag = row.header ? 'th' : 'td'
            const markup = Array.from(
                {length: target.columnCount - current.columnCount},
                (_, index) =>
                    tableCellMarkup(tag, normalizedIds[nextId++], current.columnCount + index),
            )
                .map(value => `\n${indent}${value}`)
                .join('')
            patches.push(insertionPatch(document, range.to, markup))
        }
    }
    if (target.rowCount > current.rowCount) {
        const lastBodyRow = structure.rows.at(-1)?.element
        const range = lastBodyRow ? elementRange(lastBodyRow) : undefined
        if (!lastBodyRow || !range) {
            return rejected('source-location-missing', '无法定位表格增行位置。')
        }
        const rowIndent = indentationAt(document.content, range.from)
        const cellIndent = `${rowIndent}  `
        const markup = Array.from({length: target.rowCount - current.rowCount}, () => {
            const cells = Array.from({length: target.columnCount}, (_, columnIndex) =>
                tableCellMarkup('td', normalizedIds[nextId++], columnIndex),
            )
            return `\n${rowIndent}<tr>\n${cellIndent}${cells.join(`\n${cellIndent}`)}\n${rowIndent}</tr>`
        }).join('')
        patches.push(insertionPatch(document, range.to, markup))
    }
    return Object.freeze({
        status: 'ready',
        patches: Object.freeze(patches),
        removedNodeIds: Object.freeze([...new Set(removedNodeIds)]),
    })
}

function validDimensions(value: TableDimensionsExpectation): boolean {
    return (
        Number.isInteger(value.rowCount) &&
        value.rowCount >= TABLE_MIN_ROW_COUNT &&
        value.rowCount <= TABLE_MAX_ROW_COUNT &&
        Number.isInteger(value.columnCount) &&
        value.columnCount >= TABLE_MIN_COLUMN_COUNT &&
        value.columnCount <= TABLE_MAX_COLUMN_COUNT
    )
}

function requiredNewCellCount(
    current: TableDimensionsExpectation,
    target: TableDimensionsExpectation,
): number {
    const retainedRows = Math.min(current.rowCount, target.rowCount)
    const expandedExisting = Math.max(0, target.columnCount - current.columnCount) * retainedRows
    const addedRows = Math.max(0, target.rowCount - current.rowCount) * target.columnCount
    return expandedExisting + addedRows
}

function tableCellMarkup(tag: 'th' | 'td', id: string, columnIndex: number): string {
    const text = tag === 'th' ? `列 ${columnIndex + 1}` : '单元格'
    return `<${tag} data-fc-node-id="${id}" data-fc-node-kind="table-cell">${text}</${tag}>`
}

function managedNodeIds(root: HtmlCompositionElement): string[] {
    const ids: string[] = []
    walkElements(root, element => {
        const id = getAttribute(element, 'data-fc-node-id')
        if (id) ids.push(id.toLowerCase())
    })
    return ids
}

function removalPatch(
    document: SourceDocument,
    element: HtmlCompositionElement,
): SourcePatch | null {
    const range = elementRange(element)
    if (!range) return null
    return Object.freeze({
        source: document.key,
        range: utf16Range(range.from, range.to),
        expected: document.content.slice(range.from, range.to),
        insert: '',
    })
}

function insertionPatch(document: SourceDocument, at: number, insert: string): SourcePatch {
    return Object.freeze({
        source: document.key,
        range: utf16Range(at, at),
        expected: '',
        insert,
    })
}

function indentationAt(source: string, offset: number): string {
    const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
    return /^[\t ]*/u.exec(source.slice(lineStart, offset))?.[0] ?? ''
}

function rejected(code: string, message: string): TableStructurePatchResult {
    return Object.freeze({status: 'rejected', code, message})
}
