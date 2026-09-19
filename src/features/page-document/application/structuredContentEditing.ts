// 本模块把表格、列表与分隔线功能区命令绑定为现有内核意图；节点身份由宿主在调用前分配。

import {
    TABLE_MAX_COLUMN_COUNT,
    TABLE_MAX_ROW_COUNT,
    TABLE_MIN_COLUMN_COUNT,
    TABLE_MIN_ROW_COUNT,
} from '../domain/contract.ts'
import type {LayerProjectionNode} from '../domain/layerProjection.ts'
import {
    documentFingerprint,
    idempotencyKey,
    interactionId,
    nodeId,
    type EditIntent,
    type ReadContext,
} from '../domain/kernel/index.ts'
import {
    requireKernelComponentHandle,
    type KernelComponentBindings,
    type KernelComponentInspectionResult,
    type KernelDraftEditRequest,
} from './documentKernelDraftRuntime.ts'
import {createVisualPropertyEditRequest} from './visualPropertyEditing.ts'

export interface TableDimensions {
    readonly rowCount: number
    readonly columnCount: number
}

export interface StructuredSelectionContext {
    readonly tableNode: LayerProjectionNode | null
    readonly listNode: LayerProjectionNode | null
}

export type DividerLineStyle = 'unset' | 'solid' | 'dashed' | 'dotted'
export type DividerSpacing = 'unset' | 'compact' | 'normal' | 'wide'

const ALL_WIDTHS_CONTEXT: ReadContext = Object.freeze({
    viewport: 'mobile',
    interactions: Object.freeze({hover: false, focusWithin: false}),
    direction: 'ltr',
    writingMode: 'horizontal-tb',
})

export function resolveStructuredSelectionContext(
    nodes: readonly LayerProjectionNode[],
    selectedNodeId: string | null,
): StructuredSelectionContext {
    if (!selectedNodeId) return Object.freeze({tableNode: null, listNode: null})
    const visit = (
        items: readonly LayerProjectionNode[],
        tableNode: LayerProjectionNode | null,
        listNode: LayerProjectionNode | null,
    ): StructuredSelectionContext | null => {
        for (const item of items) {
            const nextTable = item.kind === 'table' ? item : tableNode
            const nextList = item.kind === 'list' ? item : listNode
            if (item.id === selectedNodeId) {
                return Object.freeze({tableNode: nextTable, listNode: nextList})
            }
            const nested = visit(item.children, nextTable, nextList)
            if (nested) return nested
        }
        return null
    }
    return visit(nodes, null, null) ?? Object.freeze({tableNode: null, listNode: null})
}

export function readTableDimensions(
    tableId: string,
    inspect: (request: {
        readonly nodeId: string
        readonly properties: readonly string[]
        readonly context: ReadContext
    }) => KernelComponentInspectionResult,
): TableDimensions | null {
    const result = inspect({nodeId: tableId, properties: [], context: ALL_WIDTHS_CONTEXT})
    if (result.status !== 'ready' || result.inspection.handle.kind !== 'table') return null
    const table = result.inspection.structure.table
    return table?.status === 'rectangular'
        ? Object.freeze({rowCount: table.rowCount, columnCount: table.columnCount})
        : null
}

export function tableResizeNewCellCount(
    current: TableDimensions,
    target: TableDimensions,
): number {
    const retainedRows = Math.min(current.rowCount, target.rowCount)
    return (
        Math.max(0, target.columnCount - current.columnCount) * retainedRows +
        Math.max(0, target.rowCount - current.rowCount) * target.columnCount
    )
}

export function tableDimensionsAllowed(value: TableDimensions): boolean {
    return (
        Number.isInteger(value.rowCount) &&
        value.rowCount >= TABLE_MIN_ROW_COUNT &&
        value.rowCount <= TABLE_MAX_ROW_COUNT &&
        Number.isInteger(value.columnCount) &&
        value.columnCount >= TABLE_MIN_COLUMN_COUNT &&
        value.columnCount <= TABLE_MAX_COLUMN_COUNT
    )
}

export function createTableResizeRequest(
    tableId: string,
    current: TableDimensions,
    target: TableDimensions,
    newCellNodeIds: readonly string[],
    requestId: string = crypto.randomUUID(),
): KernelDraftEditRequest {
    if (!tableDimensionsAllowed(current) || !tableDimensionsAllowed(target)) {
        throw new TypeError('表格目标行列数超出页面文档限制。')
    }
    const required = tableResizeNewCellCount(current, target)
    if (newCellNodeIds.length !== required) {
        throw new TypeError(`表格调整需要 ${required} 个宿主分配的单元格 ID。`)
    }
    const allocated = Object.freeze(newCellNodeIds.map(value => nodeId(value)))
    if (new Set(allocated).size !== allocated.length) throw new TypeError('新单元格 ID 不能重复。')
    return Object.freeze({
        nodeIds: Object.freeze([tableId.toLowerCase()]),
        idempotencyKey: idempotencyKey(`ribbon-table:${requestId}`),
        interactionId: interactionId(`ribbon-table:${documentFingerprint(requestId)}`),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents(handles: KernelComponentBindings) {
            const table = requireKernelComponentHandle(handles, tableId)
            return Object.freeze([Object.freeze({
                kind: 'resize-table' as const,
                target: Object.freeze({kind: 'component-root' as const, component: table}),
                expectedRowCount: current.rowCount,
                expectedColumnCount: current.columnCount,
                rowCount: target.rowCount,
                columnCount: target.columnCount,
                newCellNodeIds: allocated,
                destinationScope: 'entry' as const,
            } satisfies EditIntent)])
        },
    })
}

export function createListTypeRequest(
    listId: string,
    expectedTag: 'ul' | 'ol',
    tag: 'ul' | 'ol',
    requestId: string = crypto.randomUUID(),
): KernelDraftEditRequest {
    return Object.freeze({
        nodeIds: Object.freeze([listId.toLowerCase()]),
        idempotencyKey: idempotencyKey(`ribbon-list-tag:${requestId}`),
        interactionId: interactionId(`ribbon-list-tag:${documentFingerprint(requestId)}`),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents(handles: KernelComponentBindings) {
            const list = requireKernelComponentHandle(handles, listId)
            return Object.freeze([Object.freeze({
                kind: 'set-component-tag' as const,
                target: Object.freeze({kind: 'component-root' as const, component: list}),
                expectedTag,
                tag,
                destinationScope: 'entry' as const,
            } satisfies EditIntent)])
        },
    })
}

export function createListItemInsertionRequest(
    listId: string,
    afterId: string | null,
    newNodeId: string,
    requestId: string = crypto.randomUUID(),
): KernelDraftEditRequest {
    const allocated = nodeId(newNodeId)
    return Object.freeze({
        nodeIds: Object.freeze(afterId ? [listId.toLowerCase(), afterId.toLowerCase()] : [listId.toLowerCase()]),
        idempotencyKey: idempotencyKey(`ribbon-list-insert:${requestId}`),
        interactionId: interactionId(`ribbon-list-insert:${documentFingerprint(requestId)}`),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents(handles: KernelComponentBindings) {
            const list = requireKernelComponentHandle(handles, listId)
            const after = afterId ? requireKernelComponentHandle(handles, afterId) : null
            return Object.freeze([Object.freeze({
                kind: 'insert-component' as const,
                target: Object.freeze({kind: 'component-root' as const, component: list}),
                after,
                componentKind: 'list-item' as const,
                newNodeId: allocated,
                newChildNodeIds: Object.freeze([]),
                assetId: null,
                destinationScope: 'entry' as const,
            } satisfies EditIntent)])
        },
    })
}

export function createDividerLineStyleRequest(
    dividerId: string,
    style: DividerLineStyle,
    requestId: string = crypto.randomUUID(),
): KernelDraftEditRequest {
    return Object.freeze({
        nodeIds: Object.freeze([dividerId.toLowerCase()]),
        idempotencyKey: idempotencyKey(`ribbon-divider-line:${requestId}`),
        interactionId: interactionId(`ribbon-divider-line:${documentFingerprint(requestId)}`),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents(handles: KernelComponentBindings) {
            const divider = requireKernelComponentHandle(handles, dividerId)
            return Object.freeze([Object.freeze({
                kind: 'edit-property' as const,
                target: Object.freeze({kind: 'component-root' as const, component: divider}),
                property: 'border-style',
                action: style === 'unset'
                    ? Object.freeze({kind: 'clear-override' as const})
                    : Object.freeze({kind: 'set-value' as const, value: style}),
                readContext: ALL_WIDTHS_CONTEXT,
                destination: Object.freeze({scope: 'entry' as const, channel: Object.freeze({kind: 'base-rule' as const})}),
            } satisfies EditIntent)])
        },
    })
}

export function createDividerSpacingRequest(
    dividerId: string,
    spacing: DividerSpacing,
): KernelDraftEditRequest {
    const value = spacing === 'compact' ? 0.5 : spacing === 'normal' ? 1 : spacing === 'wide' ? 2 : null
    return createVisualPropertyEditRequest(dividerId, [
        {
            property: 'margin-block-start',
            value: value === null
                ? {kind: 'clear-override'}
                : {kind: 'numeric', value, unit: 'rem', numberText: String(value)},
        },
        {
            property: 'margin-block-end',
            value: value === null
                ? {kind: 'clear-override'}
                : {kind: 'numeric', value, unit: 'rem', numberText: String(value)},
        },
    ])
}
