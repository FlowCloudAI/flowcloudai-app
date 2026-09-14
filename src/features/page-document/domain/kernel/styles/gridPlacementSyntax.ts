// 本模块解释内核明确支持的 Grid 子项位置语法；可视控件与结构规划器共用同一值模型。

export type GridItemPlacementValue =
    | {readonly mode: 'unset'}
    | {readonly mode: 'auto'; readonly span: number}
    | {readonly mode: 'positioned'; readonly start: number; readonly span: number}
    | {readonly mode: 'custom'; readonly raw: string; readonly reason: string}

type GridLineValue =
    | {readonly kind: 'auto'}
    | {readonly kind: 'line'; readonly value: number}
    | {readonly kind: 'span'; readonly value: number}

const GRID_PLACEMENT_PARTS: Readonly<Record<string, readonly string[]>> = {
    'grid-area': ['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end'],
    'grid-column': ['grid-column-start', 'grid-column-end'],
    'grid-row': ['grid-row-start', 'grid-row-end'],
}

/** 判断两个 Grid 位置声明是否控制同一行列分量，不承担通用 CSS 级联展开。 */
export function gridItemPlacementPropertiesOverlap(left: string, right: string): boolean {
    const normalizedLeft = left.toLowerCase()
    const normalizedRight = right.toLowerCase()
    if (
        normalizedLeft === normalizedRight ||
        normalizedLeft === 'all' ||
        normalizedRight === 'all'
    ) {
        return true
    }
    const leftParts = GRID_PLACEMENT_PARTS[normalizedLeft] ?? [normalizedLeft]
    const rightParts = GRID_PLACEMENT_PARTS[normalizedRight] ?? [normalizedRight]
    return leftParts.some(property => rightParts.includes(property))
}

export function parseGridLineValue(raw: string): GridLineValue | null {
    const normalized = raw.trim().toLowerCase().replace(/\s+/gu, ' ')
    if (normalized === 'auto') return {kind: 'auto'}
    const line = /^\+?([1-9]\d*)$/u.exec(normalized)
    if (line) return {kind: 'line', value: Number(line[1])}
    const span = /^span\s+\+?([1-9]\d*)$/u.exec(normalized)
    return span ? {kind: 'span', value: Number(span[1])} : null
}

export function parseGridItemPlacementShorthand(
    raw: string,
): readonly [GridLineValue, GridLineValue] | null {
    const parts = raw.split('/')
    if (parts.length > 2) return null
    const start = parseGridLineValue(parts[0] ?? '')
    const end = parts.length === 2 ? parseGridLineValue(parts[1] ?? '') : {kind: 'auto' as const}
    return start && end ? [start, end] : null
}

export function parseGridItemPlacementLonghands(
    startRaw: string | null,
    endRaw: string | null,
    displayRaw = '',
): GridItemPlacementValue {
    if (startRaw === null && endRaw === null) return {mode: 'unset'}
    const start = startRaw === null ? ({kind: 'auto'} as const) : parseGridLineValue(startRaw)
    const end = endRaw === null ? ({kind: 'auto'} as const) : parseGridLineValue(endRaw)
    if (!start || !end) {
        return customPlacement(
            displayRaw || [startRaw, endRaw].filter(value => value !== null).join(' / '),
            '该起止线包含当前控件尚未接管的位置值。',
        )
    }
    return placementFromLineValues(start, end, displayRaw)
}

export function placementFromGridLineValues(
    startValue: GridLineValue,
    endValue: GridLineValue,
    displayRaw: string,
): GridItemPlacementValue {
    return placementFromLineValues(startValue, endValue, displayRaw)
}

export function gridItemPlacementFitsTracks(
    value: GridItemPlacementValue,
    trackCount: number,
): boolean {
    if (value.mode === 'unset') return true
    if (value.mode === 'custom') return false
    if (value.mode === 'auto') return value.span <= trackCount
    return value.start <= trackCount && value.start + value.span - 1 <= trackCount
}

export function serializeGridItemPlacement(
    value: GridItemPlacementValue,
): string | null | undefined {
    if (value.mode === 'custom') return undefined
    if (value.mode === 'unset') return null
    if (value.mode === 'auto') return value.span === 1 ? 'auto' : `auto / span ${value.span}`
    return `${value.start} / span ${value.span}`
}

function placementFromLineValues(
    startValue: GridLineValue,
    endValue: GridLineValue,
    displayRaw: string,
): GridItemPlacementValue {
    if (startValue.kind === 'auto' && endValue.kind === 'auto') return {mode: 'auto', span: 1}
    if (startValue.kind === 'span' && endValue.kind === 'auto') {
        return {mode: 'auto', span: startValue.value}
    }
    if (startValue.kind === 'auto' && endValue.kind === 'span') {
        return {mode: 'auto', span: endValue.value}
    }
    if (startValue.kind === 'line' && endValue.kind === 'auto') {
        return {mode: 'positioned', start: startValue.value, span: 1}
    }
    if (startValue.kind === 'line' && endValue.kind === 'span') {
        return {mode: 'positioned', start: startValue.value, span: endValue.value}
    }
    if (
        startValue.kind === 'line' &&
        endValue.kind === 'line' &&
        endValue.value > startValue.value
    ) {
        return {
            mode: 'positioned',
            start: startValue.value,
            span: endValue.value - startValue.value,
        }
    }
    return customPlacement(displayRaw, '该起止线组合无法无损表示为起始位置与跨度。')
}

function customPlacement(raw: string, reason: string): GridItemPlacementValue {
    return {mode: 'custom', raw: raw || '无法确定的作者源码', reason}
}
