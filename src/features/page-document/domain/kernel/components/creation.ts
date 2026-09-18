// 本模块依据组件定义生成确定性初始结构；所有持久身份均由宿主传入，组件层不分配 UUID。

import {nodeId} from '../contracts/identity.ts'
import type {DocumentNodeKind} from '../contracts/primitives.ts'
import {componentDefinition} from './definitions.ts'

export const DEFAULT_TABLE_ROW_COUNT = 3
export const DEFAULT_TABLE_COLUMN_COUNT = 3
export const DEFAULT_TABLE_CELL_COUNT = DEFAULT_TABLE_ROW_COUNT * DEFAULT_TABLE_COLUMN_COUNT

export interface ComponentCreationInput {
    readonly assetId?: string
    readonly listItemId?: string
    readonly tableCellIds?: readonly string[]
}

export function createComponentMarkup(
    kind: DocumentNodeKind,
    rawNodeId: string,
    input: ComponentCreationInput = {},
): string | null {
    const id = nodeId(rawNodeId)
    const definition = componentDefinition(kind)
    if (!definition.creation) return null
    if (definition.creation.requiredInputs.some(name => input[name] === undefined)) return null
    const identity = `data-fc-node-id="${id}" data-fc-node-kind="${kind}"`
    const tag = definition.creation.rootTag

    switch (kind) {
        case 'container':
            return `<${tag} ${identity}></${tag}>`
        case 'paragraph':
            return `<${tag} ${identity}>新段落</${tag}>`
        case 'heading':
            return `<${tag} ${identity}>新标题</${tag}>`
        case 'list': {
            const itemId = input.listItemId ? nodeId(input.listItemId) : null
            return itemId
                ? `<${tag} ${identity}><li data-fc-node-id="${itemId}" data-fc-node-kind="list-item">新列表项</li></${tag}>`
                : null
        }
        case 'list-item':
            return `<${tag} ${identity}>新列表项</${tag}>`
        case 'table':
            return createTableMarkup(tag, identity, input.tableCellIds)
        case 'table-cell':
            return null
        case 'asset': {
            const assetId = input.assetId ? nodeId(input.assetId) : null
            return assetId
                ? `<${tag} ${identity}><img src="fcasset://${assetId}" data-fc-asset-id="${assetId}" alt="词条资产"></${tag}>`
                : null
        }
        case 'gallery': {
            const assetId = input.assetId ? nodeId(input.assetId) : null
            return assetId
                ? `<${tag} ${identity}><img src="fcasset://${assetId}" data-fc-asset-id="${assetId}" alt="图库资产"></${tag}>`
                : `<${tag} ${identity}></${tag}>`
        }
        case 'divider':
            return `<${tag} ${identity}>`
        case 'component':
            return null
    }
}

function createTableMarkup(
    tag: string,
    identity: string,
    rawCellIds: readonly string[] | undefined,
): string | null {
    if (rawCellIds?.length !== DEFAULT_TABLE_CELL_COUNT) return null
    const cells = rawCellIds.map(id => nodeId(id))
    const header = cells
        .slice(0, DEFAULT_TABLE_COLUMN_COUNT)
        .map(
            (cellId, index) =>
                `<th data-fc-node-id="${cellId}" data-fc-node-kind="table-cell">列 ${index + 1}</th>`,
        )
        .join('')
    const body = Array.from({length: DEFAULT_TABLE_ROW_COUNT - 1}, (_, row) => row)
        .map(row => {
            const offset = DEFAULT_TABLE_COLUMN_COUNT * (row + 1)
            const rowCells = cells
                .slice(offset, offset + DEFAULT_TABLE_COLUMN_COUNT)
                .map(
                    cellId =>
                        `<td data-fc-node-id="${cellId}" data-fc-node-kind="table-cell">单元格</td>`,
                )
                .join('')
            return `<tr>${rowCells}</tr>`
        })
        .join('')
    return `<${tag} ${identity}><thead><tr>${header}</tr></thead><tbody>${body}</tbody></${tag}>`
}
