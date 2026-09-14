// 本模块在属性批次的最终候选上校验受影响 Grid 的重叠、隐式列与阅读顺序；不接收 UI 伪造的预演结果。

import valueParser, {type Node as ValueNode} from 'postcss-value-parser'
import type {DocumentDiagnostic} from '../../contract.ts'
import type {ComponentDescriptor, ComponentIndex} from '../components/index.ts'
import type {ReadContext} from '../contracts/context.ts'
import type {PropertyEditIntent} from '../contracts/edit.ts'
import type {NodeId} from '../contracts/identity.ts'
import type {PropertyAnalyzer} from '../styles/index.ts'
import {parseGridTrackList} from '../styles/gridTrackSyntax.ts'
import type {PlanningAnalysisRuntime} from './propertyPlanning.ts'

const VIEWPORTS = ['mobile', 'desktop'] as const
const PARENT_GRID_PROPERTIES = new Set([
    'display',
    'grid-auto-flow',
    'grid-template-columns',
    'grid-template-rows',
    'grid-template-areas',
])
const CHILD_GRID_PROPERTIES = new Set([
    'grid-area',
    'grid-column',
    'grid-column-start',
    'grid-column-end',
    'grid-row',
    'grid-row-start',
    'grid-row-end',
])
const SAFE_AREA_NAME = /^-?[_a-z][-_a-z0-9]*$/iu

interface ValidationTarget {
    readonly parentId: NodeId
    readonly context: ReadContext
}

type GridTrackShape =
    | {
          readonly kind: 'fixed'
          readonly count: number
          readonly namedLines: ReadonlyMap<string, number>
          readonly reason: null
      }
    | {
          readonly kind: 'adaptive'
          readonly count: null
          readonly namedLines: ReadonlyMap<string, number>
          readonly reason: null
      }
    | {readonly kind: 'unknown'; readonly count: null; readonly reason: string}

type GridAreaShape =
    | {readonly kind: 'none'}
    | {readonly kind: 'explicit'; readonly cells: readonly (readonly string[])[]}
    | {readonly kind: 'unknown'; readonly reason: string}

type GridLine =
    | {readonly kind: 'auto'}
    | {readonly kind: 'line'; readonly value: number}
    | {readonly kind: 'named'; readonly value: string}
    | {
          readonly kind: 'span'
          readonly value: number
      }

interface Placement {
    readonly mode: 'auto' | 'positioned'
    readonly start?: number
    readonly span: number
}

interface PlacementItem {
    readonly descriptor: ComponentDescriptor
    readonly column: Placement
    readonly row: Placement
}

interface PlacementRect {
    readonly itemIndex: number
    readonly column: number
    readonly row: number
    readonly columnSpan: number
    readonly rowSpan: number
}

export function validateGridLayoutPostconditions(
    candidate: PlanningAnalysisRuntime,
    intents: readonly PropertyEditIntent[],
): readonly DocumentDiagnostic[] {
    if (!candidate.components || !candidate.properties) return Object.freeze([])
    return validateTargets(candidate, collectTargets(candidate.components, intents))
}

/** 结构型 Grid 意图没有逐属性目的地；统一对其父容器的四个标准视口验收。 */
export function validateGridParentPostconditions(
    candidate: PlanningAnalysisRuntime,
    parentIds: readonly NodeId[],
): readonly DocumentDiagnostic[] {
    if (!candidate.components || !candidate.properties) return Object.freeze([])
    const targets = [...new Set(parentIds)].flatMap(parentId =>
        VIEWPORTS.map(viewport => ({parentId, context: readContext(viewport, false, false)})),
    )
    return validateTargets(candidate, targets)
}

function validateTargets(
    candidate: PlanningAnalysisRuntime,
    targets: readonly ValidationTarget[],
): readonly DocumentDiagnostic[] {
    if (!candidate.components || !candidate.properties) return Object.freeze([])
    for (const target of targets) {
        const parent = candidate.components.components.find(
            component => component.handle.nodeId === target.parentId,
        )
        if (!parent) continue
        const reason = validateParent(
            candidate.components,
            candidate.properties,
            parent,
            target.context,
        )
        if (reason) {
            return Object.freeze([
                Object.freeze({
                    severity: 'error',
                    category: 'capability',
                    code: 'grid-layout-postcondition-failed',
                    message: `${contextLabel(target.context)}：${reason}`,
                    nodeId: parent.handle.nodeId,
                }),
            ])
        }
    }
    return Object.freeze([])
}

function collectTargets(
    components: ComponentIndex,
    intents: readonly PropertyEditIntent[],
): readonly ValidationTarget[] {
    const targets = new Map<string, ValidationTarget>()
    for (const intent of intents) {
        const property = intent.property.toLowerCase()
        if (!PARENT_GRID_PROPERTIES.has(property) && !CHILD_GRID_PROPERTIES.has(property)) continue
        const descriptor = components.components.find(
            component => component.handle.nodeId === intent.target.component.nodeId,
        )
        if (!descriptor) continue
        const parentId = PARENT_GRID_PROPERTIES.has(property)
            ? descriptor.handle.kind === 'container'
                ? descriptor.handle.nodeId
                : null
            : descriptor.parentNodeId
        if (!parentId) continue
        for (const context of affectedContexts(intent)) {
            const key = `${parentId}\u0000${context.viewport}\u0000${context.interactions.hover}\u0000${context.interactions.focusWithin}`
            targets.set(key, {parentId, context})
        }
    }
    return Object.freeze([...targets.values()])
}

function affectedContexts(intent: PropertyEditIntent): readonly ReadContext[] {
    const channel = intent.destination.channel
    if (channel.kind !== 'conditional-rule') {
        return Object.freeze(VIEWPORTS.map(viewport => readContext(viewport, false, false)))
    }
    if (channel.context === 'hover') {
        return Object.freeze(VIEWPORTS.map(viewport => readContext(viewport, true, false)))
    }
    if (channel.context === 'focus-within') {
        return Object.freeze(VIEWPORTS.map(viewport => readContext(viewport, false, true)))
    }
    return Object.freeze([readContext(channel.context, false, false)])
}

function readContext(
    viewport: ReadContext['viewport'],
    hover: boolean,
    focusWithin: boolean,
): ReadContext {
    return Object.freeze({
        viewport,
        interactions: Object.freeze({hover, focusWithin}),
        direction: 'unknown',
        writingMode: 'unknown',
    })
}

function validateParent(
    components: ComponentIndex,
    properties: PropertyAnalyzer,
    parent: ComponentDescriptor,
    context: ReadContext,
): string | null {
    const display = readProperty(properties, parent, 'display', context)
    if (display.kind === 'unknown') return `无法确定父容器布局类型：${display.reason}`
    if (!/^(?:inline-)?grid$/iu.test(display.value ?? 'block')) return null
    if (parent.unmanagedDirectContentCount > 0) {
        return '直属布局层包含未托管内容，无法证明全部子项的视觉阅读顺序。'
    }
    const columns = readProperty(properties, parent, 'grid-template-columns', context)
    if (columns.kind === 'unknown') return `无法确定父容器列轨道：${columns.reason}`
    const trackShape = parseTrackShape(columns.value)
    if (trackShape.kind === 'unknown') return trackShape.reason
    const rows = readProperty(properties, parent, 'grid-template-rows', context)
    if (rows.kind === 'unknown') return `无法确定父容器行轨道：${rows.reason}`
    const rowShape = parseTrackShape(rows.value)
    if (rowShape.kind === 'unknown') return rowShape.reason
    const areasValue = readProperty(properties, parent, 'grid-template-areas', context)
    if (areasValue.kind === 'unknown') return `无法确定父容器命名区域：${areasValue.reason}`
    const areas = parseAreaShape(areasValue.value)
    if (areas.kind === 'unknown') return areas.reason
    const autoFlow = readProperty(properties, parent, 'grid-auto-flow', context)
    if (autoFlow.kind === 'unknown') return `无法确定 grid-auto-flow：${autoFlow.reason}`
    const autoFlowReason = validateAutoFlow(autoFlow.value)
    if (autoFlowReason) return autoFlowReason

    const children = parent.childNodeIds.flatMap(id => {
        const child = components.components.find(component => component.handle.nodeId === id)
        return child ? [child] : []
    })
    const placements: PlacementItem[] = []
    for (const child of children) {
        const placement = readChildPlacement(
            properties,
            child,
            context,
            areas,
            trackShape,
            rowShape,
        )
        if (placement.kind === 'unknown') {
            return `子项 ${child.handle.nodeId} 的位置无法校验：${placement.reason}`
        }
        placements.push({descriptor: child, column: placement.column, row: placement.row})
    }

    if (trackShape.kind === 'adaptive') {
        if (areas.kind === 'explicit') return '自适应列数不能与固定命名区域矩阵共同验证。'
        const positioned = placements.find(
            item =>
                item.column.mode !== 'auto' ||
                item.column.span !== 1 ||
                item.row.mode !== 'auto' ||
                item.row.span !== 1,
        )
        return positioned
            ? `自适应列数只支持单格自动排列；子项 ${positioned.descriptor.handle.nodeId} 仍有位置或跨度设置。`
            : null
    }

    let columnCount = trackShape.count ?? 0
    if (areas.kind === 'explicit') {
        const areaColumns = areas.cells[0]?.length ?? 0
        if (areaColumns === 0) return '命名区域矩阵没有有效列。'
        if (columnCount > 0 && columnCount !== areaColumns) {
            return '命名区域列数与父容器显式列轨道不一致。'
        }
        columnCount = areaColumns
    }
    if (columnCount < 1) return '父容器列轨道数量无法确定，不能验证视觉阅读顺序。'
    return validatePlacementOrder(placements, columnCount)
}

type ReadProperty =
    | {readonly kind: 'value'; readonly value: string | null}
    | {readonly kind: 'unknown'; readonly reason: string}

function readProperty(
    properties: PropertyAnalyzer,
    descriptor: ComponentDescriptor,
    property: string,
    context: ReadContext,
): ReadProperty {
    const inspection = properties.inspect(descriptor.handle, property, context)
    if (!inspection) return {kind: 'unknown', reason: '属性目标已经失效。'}
    if (inspection.confidence.kind !== 'proven') {
        return {kind: 'unknown', reason: inspection.confidence.reason}
    }
    const effective = inspection.effectiveValue
    if (!effective) return {kind: 'value', value: null}
    return effective.resolvedValue === null
        ? {kind: 'unknown', reason: `声明 ${effective.declaredProperty} 无法精确拆分。`}
        : {kind: 'value', value: effective.resolvedValue}
}

function parseTrackShape(raw: string | null): GridTrackShape {
    if (!raw || raw.trim().toLowerCase() === 'none') {
        return {kind: 'fixed', count: 0, namedLines: new Map(), reason: null}
    }
    const normalized = raw.trim().toLowerCase()
    if (
        ['subgrid', 'masonry', 'inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(
            normalized,
        )
    ) {
        return {kind: 'unknown', count: null, reason: `列轨道 ${raw.trim()} 暂不能安全校验。`}
    }
    const parsed = valueParser(raw)
    const count = countTrackNodes(parsed.nodes)
    if (count.kind === 'unknown') return count
    if (count.adaptive) {
        return {kind: 'adaptive', count: null, namedLines: new Map(), reason: null}
    }
    const model = parseGridTrackList(raw)
    const unsafeLine = model.namedLines.find(line => !line.editable)
    if (unsafeLine) {
        return {
            kind: 'unknown',
            count: null,
            reason: unsafeLine.reason ?? '轨道命名线无法安全解释。',
        }
    }
    const namedLines = new Map<string, number>()
    for (const line of model.namedLines) {
        for (const name of line.names) {
            if (!namedLines.has(name)) namedLines.set(name, line.lineIndex + 1)
        }
    }
    return {kind: 'fixed', count: count.count, namedLines, reason: null}
}

type CountedTracks =
    | {readonly kind: 'counted'; readonly count: number; readonly adaptive: boolean}
    | Extract<GridTrackShape, {readonly kind: 'unknown'}>

function countTrackNodes(nodes: readonly ValueNode[]): CountedTracks {
    let count = 0
    let adaptive = false
    for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]
        if (node.type === 'space' || node.type === 'comment') continue
        if (node.type === 'word' && node.value.trimStart().startsWith('[')) {
            while (
                index < nodes.length &&
                !(
                    nodes[index]?.type === 'word' &&
                    (nodes[index] as Extract<ValueNode, {type: 'word'}>).value
                        .trimEnd()
                        .endsWith(']')
                )
            ) {
                index += 1
            }
            if (index >= nodes.length) {
                return {kind: 'unknown', count: null, reason: '列轨道命名线括号未闭合。'}
            }
            continue
        }
        if (node.type === 'function' && node.value.toLowerCase() === 'repeat') {
            const groups = functionGroups(node.nodes)
            if (!groups || groups.length !== 2) {
                return {kind: 'unknown', count: null, reason: 'repeat() 轨道无法解析。'}
            }
            const mode = valueParser.stringify(groups[0]).trim().toLowerCase()
            const nested = countTrackNodes(groups[1])
            if (nested.kind !== 'counted' || nested.adaptive || nested.count < 1) {
                return {kind: 'unknown', count: null, reason: 'repeat() 轨道模板无法确定。'}
            }
            if (mode === 'auto-fit' || mode === 'auto-fill') {
                if (count > 0 || nested.count !== 1) {
                    return {
                        kind: 'unknown',
                        count: null,
                        reason: '自适应 repeat() 与额外轨道无法共同校验。',
                    }
                }
                adaptive = true
                continue
            }
            if (!/^\+?[1-9]\d*$/u.test(mode)) {
                return {kind: 'unknown', count: null, reason: 'repeat() 次数无法确定。'}
            }
            count += Number(mode) * nested.count
            continue
        }
        if (node.type === 'div') {
            return {kind: 'unknown', count: null, reason: '列轨道包含无法解释的分隔符。'}
        }
        count += 1
    }
    return {kind: 'counted', count, adaptive}
}

function functionGroups(nodes: readonly ValueNode[]): ValueNode[][] | null {
    const groups: ValueNode[][] = [[]]
    for (const node of nodes) {
        if (node.type === 'div' && node.value === ',') groups.push([])
        else groups.at(-1)?.push(node)
    }
    return groups.some(group => group.length === 0) ? null : groups
}

function parseAreaShape(raw: string | null): GridAreaShape {
    if (!raw || raw.trim().toLowerCase() === 'none') return {kind: 'none'}
    const nodes = valueParser(raw).nodes.filter(
        node => node.type !== 'space' && node.type !== 'comment',
    )
    if (nodes.length === 0 || nodes.some(node => node.type !== 'string')) {
        return {kind: 'unknown', reason: '命名区域不是可验证的字符串矩阵。'}
    }
    const cells = nodes.map(node =>
        node.type === 'string'
            ? node.value
                  .trim()
                  .split(/\s+/u)
                  .map(name => (/^\.+$/u.test(name) ? '.' : name))
            : [],
    )
    const width = cells[0]?.length ?? 0
    if (width < 1 || cells.some(row => row.length !== width)) {
        return {kind: 'unknown', reason: '命名区域矩阵行列不规则。'}
    }
    const invalid = cells.flat().find(name => name !== '.' && !SAFE_AREA_NAME.test(name))
    if (invalid) return {kind: 'unknown', reason: `命名区域 ${invalid} 无法安全解释。`}
    const names = [...new Set(cells.flat().filter(name => name !== '.'))]
    const nonRectangular = names.find(name => !isRectangularArea(cells, name))
    if (nonRectangular) {
        return {kind: 'unknown', reason: `命名区域 ${nonRectangular} 不是连续矩形。`}
    }
    return {kind: 'explicit', cells}
}

function isRectangularArea(cells: readonly (readonly string[])[], name: string): boolean {
    const positions: Array<{row: number; column: number}> = []
    cells.forEach((row, rowIndex) =>
        row.forEach((cell, columnIndex) => {
            if (cell === name) positions.push({row: rowIndex, column: columnIndex})
        }),
    )
    if (positions.length === 0) return false
    const rows = positions.map(position => position.row)
    const columns = positions.map(position => position.column)
    const minRow = Math.min(...rows)
    const maxRow = Math.max(...rows)
    const minColumn = Math.min(...columns)
    const maxColumn = Math.max(...columns)
    for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
            if (cells[row]?.[column] !== name) return false
        }
    }
    return true
}

function validateAutoFlow(raw: string | null): string | null {
    const value = raw?.trim().toLowerCase().replace(/\s+/gu, ' ') ?? 'row'
    if (value === 'row') return null
    if (value.includes('dense')) return '父容器启用了 dense 自动回填，可能改变视觉阅读顺序。'
    if (value === 'column') return '父容器使用列优先自动排列，无法证明视觉顺序与源码顺序一致。'
    return `grid-auto-flow: ${value} 暂不能安全校验。`
}

type ChildPlacement =
    | {readonly kind: 'ready'; readonly column: Placement; readonly row: Placement}
    | {readonly kind: 'unknown'; readonly reason: string}

function readChildPlacement(
    properties: PropertyAnalyzer,
    child: ComponentDescriptor,
    context: ReadContext,
    areas: GridAreaShape,
    columns: GridTrackShape,
    rows: GridTrackShape,
): ChildPlacement {
    const area = readProperty(properties, child, 'grid-area', context)
    if (area.kind === 'value' && area.value && SAFE_AREA_NAME.test(area.value.trim())) {
        if (areas.kind !== 'explicit')
            return {kind: 'unknown', reason: `引用了未定义区域 ${area.value.trim()}。`}
        const placement = areaPlacement(areas.cells, area.value.trim())
        return placement
            ? {kind: 'ready', ...placement}
            : {kind: 'unknown', reason: `引用了不存在的区域 ${area.value.trim()}。`}
    }
    const column = readAxisPlacement(properties, child, context, 'column', columns)
    if (column.kind === 'unknown') return column
    const row = readAxisPlacement(properties, child, context, 'row', rows)
    if (row.kind === 'unknown') return row
    return {kind: 'ready', column: column.value, row: row.value}
}

function readAxisPlacement(
    properties: PropertyAnalyzer,
    child: ComponentDescriptor,
    context: ReadContext,
    axis: 'column' | 'row',
    tracks: GridTrackShape,
):
    | {readonly kind: 'ready'; readonly value: Placement}
    | {readonly kind: 'unknown'; readonly reason: string} {
    const start = readProperty(properties, child, `grid-${axis}-start`, context)
    if (start.kind === 'unknown') return start
    const end = readProperty(properties, child, `grid-${axis}-end`, context)
    if (end.kind === 'unknown') return end
    const startLine = parseGridLine(start.value ?? 'auto')
    const endLine = parseGridLine(end.value ?? 'auto')
    if (!startLine || !endLine) return {kind: 'unknown', reason: `${axis} 起止线无法归一化。`}
    const resolvedStart = resolveGridLine(startLine, tracks)
    const resolvedEnd = resolveGridLine(endLine, tracks)
    if (!resolvedStart || !resolvedEnd) {
        return {kind: 'unknown', reason: `${axis} 引用了当前轨道中不存在的命名线。`}
    }
    const value = placementFromLines(resolvedStart, resolvedEnd)
    return value
        ? {kind: 'ready', value}
        : {kind: 'unknown', reason: `${axis} 起止线组合不受支持。`}
}

function parseGridLine(raw: string): GridLine | null {
    const value = raw.trim().toLowerCase().replace(/\s+/gu, ' ')
    if (value === 'auto') return {kind: 'auto'}
    const line = /^\+?([1-9]\d*)$/u.exec(value)
    if (line) return {kind: 'line', value: Number(line[1])}
    const span = /^span\s+\+?([1-9]\d*)$/u.exec(value)
    if (span) return {kind: 'span', value: Number(span[1])}
    return /^-?[_a-z][-_a-z0-9]*$/iu.test(value) &&
        !['auto', 'span', 'inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(value)
        ? {kind: 'named', value}
        : null
}

function resolveGridLine(
    line: GridLine,
    tracks: GridTrackShape,
): Exclude<GridLine, {readonly kind: 'named'}> | null {
    if (line.kind !== 'named') return line
    if (tracks.kind !== 'fixed') return null
    const value = tracks.namedLines.get(line.value)
    return value === undefined ? null : {kind: 'line', value}
}

function placementFromLines(
    start: Exclude<GridLine, {readonly kind: 'named'}>,
    end: Exclude<GridLine, {readonly kind: 'named'}>,
): Placement | null {
    if (start.kind === 'auto' && end.kind === 'auto') return {mode: 'auto', span: 1}
    if (start.kind === 'span' && end.kind === 'auto') return {mode: 'auto', span: start.value}
    if (start.kind === 'auto' && end.kind === 'span') return {mode: 'auto', span: end.value}
    if (start.kind === 'line' && end.kind === 'auto')
        return {mode: 'positioned', start: start.value, span: 1}
    if (start.kind === 'line' && end.kind === 'span')
        return {mode: 'positioned', start: start.value, span: end.value}
    if (start.kind === 'line' && end.kind === 'line' && end.value > start.value) {
        return {mode: 'positioned', start: start.value, span: end.value - start.value}
    }
    return null
}

function areaPlacement(
    cells: readonly (readonly string[])[],
    name: string,
): {readonly column: Placement; readonly row: Placement} | null {
    const positions: Array<{row: number; column: number}> = []
    cells.forEach((row, rowIndex) =>
        row.forEach((cell, columnIndex) => {
            if (cell === name) positions.push({row: rowIndex + 1, column: columnIndex + 1})
        }),
    )
    if (positions.length === 0) return null
    const rows = positions.map(position => position.row)
    const columns = positions.map(position => position.column)
    const startRow = Math.min(...rows)
    const startColumn = Math.min(...columns)
    return {
        row: {mode: 'positioned', start: startRow, span: Math.max(...rows) - startRow + 1},
        column: {
            mode: 'positioned',
            start: startColumn,
            span: Math.max(...columns) - startColumn + 1,
        },
    }
}

function validatePlacementOrder(
    items: readonly PlacementItem[],
    columnCount: number,
): string | null {
    const invalid = items.find(
        item =>
            item.column.span > columnCount ||
            (item.column.mode === 'positioned' &&
                (item.column.start ?? 1) + item.column.span - 1 > columnCount),
    )
    if (invalid) return `子项 ${invalid.descriptor.handle.nodeId} 的位置超出父容器列轨道。`
    const rects = simulateSparseRowFlow(items, columnCount)
    if (!rects) return '该设置会产生重叠或需要隐式列，无法安全排布。'
    const visualOrder = [...rects].sort(
        (left, right) =>
            left.row - right.row || left.column - right.column || left.itemIndex - right.itemIndex,
    )
    const mismatch = visualOrder.findIndex((rect, index) => rect.itemIndex !== index)
    return mismatch < 0 ? null : '该设置会使视觉顺序与组件源码顺序不一致。'
}

function simulateSparseRowFlow(
    items: readonly PlacementItem[],
    columnCount: number,
): readonly PlacementRect[] | null {
    const occupied = new Set<string>()
    const rects: Array<PlacementRect | null> = items.map(() => null)
    const place = (index: number, row: number, column: number) => {
        const item = items[index]
        const rect = {
            itemIndex: index,
            row,
            column,
            rowSpan: item.row.span,
            columnSpan: item.column.span,
        }
        rects[index] = rect
        occupy(occupied, rect)
    }
    items.forEach((item, index) => {
        if (item.row.mode !== 'positioned' || item.column.mode !== 'positioned') return
        const row = item.row.start ?? 1
        const column = item.column.start ?? 1
        if (rectFits(occupied, row, column, item.row.span, item.column.span, columnCount)) {
            place(index, row, column)
        }
    })
    if (
        items.some(
            (item, index) =>
                item.row.mode === 'positioned' &&
                item.column.mode === 'positioned' &&
                !rects[index],
        )
    )
        return null
    items.forEach((item, index) => {
        if (rects[index] || item.row.mode !== 'positioned' || item.column.mode !== 'auto') return
        for (let column = 1; column <= columnCount; column += 1) {
            const row = item.row.start ?? 1
            if (rectFits(occupied, row, column, item.row.span, item.column.span, columnCount)) {
                place(index, row, column)
                return
            }
        }
    })
    if (
        items.some(
            (item, index) =>
                item.row.mode === 'positioned' && item.column.mode === 'auto' && !rects[index],
        )
    )
        return null
    let cursorRow = 1
    let cursorColumn = 1
    const searchLimit = Math.max(64, items.length * 24)
    for (let index = 0; index < items.length; index += 1) {
        if (rects[index]) continue
        const item = items[index]
        if (item.column.mode === 'positioned') {
            const start = item.column.start ?? 1
            if (start < cursorColumn) cursorRow += 1
            cursorColumn = start
        }
        let attempts = 0
        while (
            !rectFits(
                occupied,
                cursorRow,
                cursorColumn,
                item.row.span,
                item.column.span,
                columnCount,
            )
        ) {
            if (item.column.mode === 'positioned') cursorRow += 1
            else {
                cursorColumn += 1
                if (cursorColumn + item.column.span - 1 > columnCount) {
                    cursorRow += 1
                    cursorColumn = 1
                }
            }
            attempts += 1
            if (attempts > searchLimit) return null
        }
        place(index, cursorRow, cursorColumn)
        cursorColumn += item.column.span
    }
    return rects.every(Boolean) ? (rects as PlacementRect[]) : null
}

function rectFits(
    occupied: ReadonlySet<string>,
    row: number,
    column: number,
    rowSpan: number,
    columnSpan: number,
    columnCount: number,
): boolean {
    if (row < 1 || column < 1 || column + columnSpan - 1 > columnCount) return false
    for (let currentRow = row; currentRow < row + rowSpan; currentRow += 1) {
        for (let currentColumn = column; currentColumn < column + columnSpan; currentColumn += 1) {
            if (occupied.has(`${currentRow}:${currentColumn}`)) return false
        }
    }
    return true
}

function occupy(occupied: Set<string>, rect: PlacementRect): void {
    for (let row = rect.row; row < rect.row + rect.rowSpan; row += 1) {
        for (let column = rect.column; column < rect.column + rect.columnSpan; column += 1) {
            occupied.add(`${row}:${column}`)
        }
    }
}

function contextLabel(context: ReadContext): string {
    const state = context.interactions.hover
        ? '悬停'
        : context.interactions.focusWithin
          ? '聚焦'
          : '常态'
    return `${context.viewport} ${state}`
}
