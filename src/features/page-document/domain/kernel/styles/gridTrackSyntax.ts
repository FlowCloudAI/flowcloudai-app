// 本模块解释内核明确支持的 CSS Grid 轨道语法；它保留作者源码区间，不承担浏览器完整轨道算法。
import valueParser from 'postcss-value-parser'

export const GRID_TRACK_LIMIT = 12
export const GRID_TRACK_LENGTH_UNITS = ['px', 'rem', 'em', '%'] as const

export type GridTrackLengthUnit = (typeof GRID_TRACK_LENGTH_UNITS)[number]
export type GridTrackKeyword = 'auto' | 'min-content' | 'max-content'

export type GridTrackBreadth =
    | {kind: 'zero'; numberText: string}
    | {kind: 'keyword'; value: GridTrackKeyword}
    | {
          kind: 'length'
          value: number
          unit: GridTrackLengthUnit
          numberText: string
      }
    | {kind: 'fraction'; value: number; numberText: string}

export type GridTrackSize =
    | GridTrackBreadth
    | {kind: 'minmax'; minimum: GridTrackBreadth; maximum: GridTrackBreadth}
    | {kind: 'custom'; raw: string; reason: string}

export type GridAdaptiveRepeatMode = 'auto-fit' | 'auto-fill'

interface GridTrackFixedRepeatOrigin {
    kind: 'fixed'
    start: number
    end: number
    repetition: number
    patternIndex: number
}

interface GridTrackAdaptiveRepeatOrigin {
    kind: 'adaptive'
    start: number
    end: number
    mode: GridAdaptiveRepeatMode
}

type GridTrackRepeatOrigin = GridTrackFixedRepeatOrigin | GridTrackAdaptiveRepeatOrigin

export interface GridAdaptiveRepeat {
    mode: GridAdaptiveRepeatMode
    modeStart: number
    modeEnd: number
}

export interface GridNamedLineGroup {
    lineIndex: number
    names: readonly string[]
    raw: string
    sourceStart: number
    sourceEnd: number
    editable: boolean
    reason: string | null
}

export interface GridTrackItem {
    raw: string
    sourceStart: number
    sourceEnd: number
    size: GridTrackSize
    repeat: GridTrackRepeatOrigin | null
    editable: boolean
    reason: string | null
}

export interface GridTrackListModel {
    status: 'absent' | 'none' | 'explicit' | 'custom'
    raw: string
    tracks: readonly GridTrackItem[]
    hasNamedLines: boolean
    namedLines: readonly GridNamedLineGroup[]
    adaptiveRepeat: GridAdaptiveRepeat | null
    fixedTrackCount: number | null
    canEditNamedLines: boolean
    canResize: boolean
    canRestructure: boolean
    reason: string | null
}

type ParsedNode = ReturnType<typeof valueParser>['nodes'][number]

interface TrackSequenceResult {
    tracks: GridTrackItem[]
    hasNamedLines: boolean
    namedLines: GridNamedLineGroup[]
    hasUnsupportedSegments: boolean
    adaptiveRepeat: GridAdaptiveRepeat | null
}

const NUMBER_WITH_UNIT = /^\+?((?:\d+(?:\.\d+)?|\.\d+))(px|rem|em|%|fr)$/iu
const ZERO = /^\+?(?:0+(?:\.0*)?|\.0+)$/u
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'revert', 'revert-layer', 'unset'])
const GRID_LINE_NAME = /^-?[_a-z][-_a-z0-9]*$/iu
const RESERVED_GRID_LINE_NAMES = new Set([...CSS_WIDE_KEYWORDS, 'auto', 'span'])
const GRID_LINE_NAMES_PER_BOUNDARY_LIMIT = 8

function customSize(raw: string, reason: string): GridTrackSize {
    return {kind: 'custom', raw, reason}
}

function parseBreadth(raw: string, allowFraction: boolean): GridTrackBreadth | null {
    const normalized = raw.trim().toLowerCase()
    if (ZERO.test(normalized)) return {kind: 'zero', numberText: raw.trim()}
    if (['auto', 'min-content', 'max-content'].includes(normalized)) {
        return {kind: 'keyword', value: normalized as GridTrackKeyword}
    }
    const match = NUMBER_WITH_UNIT.exec(normalized)
    if (!match) return null
    const value = Number(match[1])
    const unit = match[2].toLowerCase()
    if (!Number.isFinite(value) || value < 0) return null
    if (unit === 'fr') {
        return allowFraction && value > 0 ? {kind: 'fraction', value, numberText: match[1]} : null
    }
    return {
        kind: 'length',
        value,
        unit: unit as GridTrackLengthUnit,
        numberText: match[1],
    }
}

function functionArguments(node: Extract<ParsedNode, {type: 'function'}>): ParsedNode[][] | null {
    const groups: ParsedNode[][] = [[]]
    for (const child of node.nodes) {
        if (child.type === 'div' && child.value === ',') {
            groups.push([])
            continue
        }
        groups.at(-1)?.push(child)
    }
    return groups.some(group => group.length === 0) ? null : groups
}

function nodesRaw(source: string, nodes: readonly ParsedNode[]): string {
    const first = nodes[0]
    const last = nodes.at(-1)
    return first && last ? source.slice(first.sourceIndex, last.sourceEndIndex) : ''
}

function meaningfulNodes(nodes: readonly ParsedNode[]): ParsedNode[] {
    return nodes.filter(node => node.type !== 'space')
}

function parseTrackNode(source: string, node: ParsedNode): GridTrackSize {
    const raw = source.slice(node.sourceIndex, node.sourceEndIndex)
    if (node.type === 'word') {
        return parseBreadth(raw, true) ?? customSize(raw, `暂不接管轨道值“${raw.trim()}”。`)
    }
    if (node.type !== 'function' || node.value.toLowerCase() !== 'minmax') {
        return customSize(raw, `暂不接管轨道函数“${raw.trim()}”。`)
    }
    const groups = functionArguments(node)
    if (!groups || groups.length !== 2) {
        return customSize(raw, 'minmax() 必须恰好包含最小值和最大值。')
    }
    const minimumNodes = meaningfulNodes(groups[0])
    const maximumNodes = meaningfulNodes(groups[1])
    if (minimumNodes.length !== 1 || maximumNodes.length !== 1) {
        return customSize(raw, '当前只接管由两个简单边界组成的 minmax()。')
    }
    const minimum = parseBreadth(nodesRaw(source, minimumNodes), false)
    const maximum = parseBreadth(nodesRaw(source, maximumNodes), true)
    if (!minimum || !maximum) {
        return customSize(raw, 'minmax() 包含尚未接管的单位、函数或比例下界。')
    }
    return {kind: 'minmax', minimum, maximum}
}

function trackItem(
    source: string,
    node: ParsedNode,
    repeat: GridTrackRepeatOrigin | null = null,
): GridTrackItem {
    const raw = source.slice(node.sourceIndex, node.sourceEndIndex)
    const size = parseTrackNode(source, node)
    const reason = size.kind === 'custom' ? size.reason : null
    return {
        raw,
        sourceStart: node.sourceIndex,
        sourceEnd: node.sourceEndIndex,
        size,
        repeat,
        editable: reason === null,
        reason,
    }
}

function safeGridLineNames(raw: string): string[] | null {
    const names = raw.trim().split(/\s+/u).filter(Boolean)
    if (
        names.length === 0 ||
        names.length > GRID_LINE_NAMES_PER_BOUNDARY_LIMIT ||
        names.some(
            name => !GRID_LINE_NAME.test(name) || RESERVED_GRID_LINE_NAMES.has(name.toLowerCase()),
        )
    ) {
        return null
    }
    return names
}

function namedLineGroupAt(
    source: string,
    nodes: readonly ParsedNode[],
    nodeIndex: number,
    lineIndex: number,
): {group: GridNamedLineGroup; nextNodeIndex: number} | null {
    const first = nodes[nodeIndex]
    if (first?.type !== 'word' || !first.value.trimStart().startsWith('[')) return null
    let endIndex = nodeIndex
    while (endIndex < nodes.length) {
        const node = nodes[endIndex]
        if (!node || !['word', 'space'].includes(node.type)) return null
        if (node.type === 'word' && node.value.trimEnd().endsWith(']')) break
        endIndex += 1
    }
    const last = nodes[endIndex]
    if (!last || last.type !== 'word' || !last.value.trimEnd().endsWith(']')) return null
    const raw = source.slice(first.sourceIndex, last.sourceEndIndex)
    const match = /^\[\s*(.*?)\s*\]$/u.exec(raw)
    const names =
        match && !match[1].includes('[') && !match[1].includes(']')
            ? safeGridLineNames(match[1])
            : null
    const reason = names
        ? null
        : `命名线“${raw.trim()}”包含转义、保留字或超出 ${GRID_LINE_NAMES_PER_BOUNDARY_LIMIT} 个名称，暂由源码维护。`
    return {
        group: {
            lineIndex,
            names: names ?? [],
            raw,
            sourceStart: first.sourceIndex,
            sourceEnd: last.sourceEndIndex,
            editable: names !== null,
            reason,
        },
        nextNodeIndex: endIndex,
    }
}

function fixedRepeat(
    source: string,
    node: Extract<ParsedNode, {type: 'function'}>,
): TrackSequenceResult {
    const raw = source.slice(node.sourceIndex, node.sourceEndIndex)
    const groups = functionArguments(node)
    if (!groups || groups.length !== 2) {
        return {
            tracks: [
                {
                    ...trackItem(source, node),
                    reason: 'repeat() 必须恰好包含次数和轨道列表。',
                    editable: false,
                    size: customSize(raw, 'repeat() 必须恰好包含次数和轨道列表。'),
                },
            ],
            hasNamedLines: false,
            namedLines: [],
            hasUnsupportedSegments: true,
            adaptiveRepeat: null,
        }
    }
    const countNodes = meaningfulNodes(groups[0])
    if (countNodes.length !== 1 || countNodes[0].type !== 'word') {
        return unsupportedRepeat(source, node, '当前只接管固定整数次数的 repeat()。')
    }
    const countRaw = source.slice(countNodes[0].sourceIndex, countNodes[0].sourceEndIndex)
    if (!/^\+?\d+$/u.test(countRaw.trim())) {
        const mode = countRaw.trim().toLowerCase()
        if (mode === 'auto-fit' || mode === 'auto-fill') {
            return adaptiveRepeat(
                source,
                node,
                groups[1],
                mode,
                countNodes[0].sourceIndex,
                countNodes[0].sourceEndIndex,
            )
        }
        return unsupportedRepeat(source, node, '该动态 repeat() 暂由源码维护。')
    }
    const count = Number(countRaw)
    if (!Number.isSafeInteger(count) || count < 1) {
        return unsupportedRepeat(source, node, 'repeat() 次数必须是正整数。')
    }
    const pattern = parseTrackSequence(source, groups[1])
    if (
        pattern.tracks.length === 0 ||
        pattern.hasNamedLines ||
        pattern.hasUnsupportedSegments ||
        pattern.tracks.length * count > GRID_TRACK_LIMIT
    ) {
        const reason =
            pattern.tracks.length * count > GRID_TRACK_LIMIT
                ? `展开后的轨道超过每轴 ${GRID_TRACK_LIMIT} 条上限。`
                : '包含命名线或复杂片段的 repeat() 暂由源码维护。'
        return unsupportedRepeat(source, node, reason)
    }
    return {
        tracks: Array.from({length: count}, (_, repetition) =>
            pattern.tracks.map((track, patternIndex) => ({
                ...track,
                repeat: {
                    kind: 'fixed' as const,
                    start: node.sourceIndex,
                    end: node.sourceEndIndex,
                    repetition,
                    patternIndex,
                },
            })),
        ).flat(),
        hasNamedLines: false,
        namedLines: [],
        hasUnsupportedSegments: false,
        adaptiveRepeat: null,
    }
}

function adaptiveRepeat(
    source: string,
    node: Extract<ParsedNode, {type: 'function'}>,
    patternNodes: readonly ParsedNode[],
    mode: GridAdaptiveRepeatMode,
    modeStart: number,
    modeEnd: number,
): TrackSequenceResult {
    const pattern = parseTrackSequence(source, patternNodes)
    const template = pattern.tracks[0]
    const fixedTemplate =
        template?.size.kind === 'zero' ||
        template?.size.kind === 'length' ||
        (template?.size.kind === 'minmax' &&
            (template.size.minimum.kind === 'zero' ||
                template.size.minimum.kind === 'length' ||
                template.size.maximum.kind === 'zero' ||
                template.size.maximum.kind === 'length'))
    if (
        pattern.tracks.length !== 1 ||
        !fixedTemplate ||
        pattern.hasNamedLines ||
        pattern.hasUnsupportedSegments ||
        pattern.adaptiveRepeat
    ) {
        return unsupportedRepeat(
            source,
            node,
            '自适应 repeat() 当前只接管一个包含固定尺寸边界、且不带命名线的简单轨道模板。',
        )
    }
    return {
        tracks: pattern.tracks.map(track => ({
            ...track,
            repeat: {kind: 'adaptive', start: node.sourceIndex, end: node.sourceEndIndex, mode},
        })),
        hasNamedLines: false,
        namedLines: [],
        hasUnsupportedSegments: false,
        adaptiveRepeat: {mode, modeStart, modeEnd},
    }
}

function unsupportedRepeat(
    source: string,
    node: Extract<ParsedNode, {type: 'function'}>,
    reason: string,
): TrackSequenceResult {
    const raw = source.slice(node.sourceIndex, node.sourceEndIndex)
    return {
        tracks: [
            {
                raw,
                sourceStart: node.sourceIndex,
                sourceEnd: node.sourceEndIndex,
                size: customSize(raw, reason),
                repeat: null,
                editable: false,
                reason,
            },
        ],
        hasNamedLines: false,
        namedLines: [],
        hasUnsupportedSegments: true,
        adaptiveRepeat: null,
    }
}

function parseTrackSequence(source: string, nodes: readonly ParsedNode[]): TrackSequenceResult {
    const result: TrackSequenceResult = {
        tracks: [],
        hasNamedLines: false,
        namedLines: [],
        hasUnsupportedSegments: false,
        adaptiveRepeat: null,
    }
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
        const node = nodes[nodeIndex]
        if (!node) continue
        if (node.type === 'space') continue
        if (node.type === 'comment') {
            result.hasUnsupportedSegments = true
            continue
        }
        const namedLine = namedLineGroupAt(source, nodes, nodeIndex, result.tracks.length)
        if (namedLine) {
            result.hasNamedLines = true
            result.namedLines.push(namedLine.group)
            result.hasUnsupportedSegments ||= !namedLine.group.editable
            nodeIndex = namedLine.nextNodeIndex
            continue
        }
        if (node.type === 'function' && node.value.toLowerCase() === 'repeat') {
            const expanded = fixedRepeat(source, node)
            result.tracks.push(...expanded.tracks)
            result.hasNamedLines ||= expanded.hasNamedLines
            result.namedLines.push(...expanded.namedLines)
            result.hasUnsupportedSegments ||= expanded.hasUnsupportedSegments
            result.adaptiveRepeat ??= expanded.adaptiveRepeat
            continue
        }
        if (node.type === 'div') {
            result.hasUnsupportedSegments = true
            continue
        }
        const item = trackItem(source, node)
        result.tracks.push(item)
        result.hasUnsupportedSegments ||= !item.editable
    }
    return result
}

export function parseGridTrackList(value: string | null | undefined): GridTrackListModel {
    const raw = value ?? ''
    const normalized = raw.trim().toLowerCase()
    if (!normalized) {
        return {
            status: 'absent',
            raw,
            tracks: [],
            hasNamedLines: false,
            namedLines: [],
            adaptiveRepeat: null,
            fixedTrackCount: 0,
            canEditNamedLines: false,
            canResize: false,
            canRestructure: false,
            reason: null,
        }
    }
    if (normalized === 'none') {
        return {
            status: 'none',
            raw,
            tracks: [],
            hasNamedLines: false,
            namedLines: [],
            adaptiveRepeat: null,
            fixedTrackCount: 0,
            canEditNamedLines: false,
            canResize: false,
            canRestructure: true,
            reason: null,
        }
    }
    const contextualKeyword = /^(subgrid|masonry)(?:\s|$)/u.exec(normalized)?.[1]
    if (CSS_WIDE_KEYWORDS.has(normalized) || contextualKeyword) {
        return {
            status: 'custom',
            raw,
            tracks: [],
            hasNamedLines: false,
            namedLines: [],
            adaptiveRepeat: null,
            fixedTrackCount: null,
            canEditNamedLines: false,
            canResize: false,
            canRestructure: false,
            reason:
                contextualKeyword === 'subgrid'
                    ? 'subgrid 依赖父网格轨道、当前轴跨度和命名线合并；当前逐字保留源码，不提供独立轨道控件。'
                    : `轨道关键字“${raw.trim()}”暂由源码维护。`,
        }
    }
    const parsed = valueParser(raw)
    const sequence = parseTrackSequence(raw, parsed.nodes)
    const exceedsLimit = sequence.tracks.length > GRID_TRACK_LIMIT
    const editableTracks = sequence.tracks.filter(track => track.editable)
    const firstUnsupportedReason =
        sequence.tracks.find(track => !track.editable)?.reason ??
        sequence.namedLines.find(line => !line.editable)?.reason
    return {
        status: sequence.tracks.length > 0 ? 'explicit' : 'custom',
        raw,
        tracks: sequence.tracks,
        hasNamedLines: sequence.hasNamedLines,
        namedLines: sequence.namedLines,
        adaptiveRepeat: sequence.adaptiveRepeat,
        fixedTrackCount: sequence.adaptiveRepeat ? null : sequence.tracks.length,
        canEditNamedLines:
            !sequence.adaptiveRepeat &&
            !sequence.hasUnsupportedSegments &&
            sequence.tracks.length > 0 &&
            sequence.tracks.every(track => track.repeat === null) &&
            sequence.namedLines.every(line => line.editable),
        canResize: !sequence.adaptiveRepeat && !exceedsLimit && editableTracks.length > 0,
        canRestructure:
            !sequence.adaptiveRepeat &&
            !exceedsLimit &&
            !sequence.hasNamedLines &&
            !sequence.hasUnsupportedSegments &&
            sequence.tracks.length > 0,
        reason: exceedsLimit
            ? `轨道超过每轴 ${GRID_TRACK_LIMIT} 条上限。`
            : sequence.adaptiveRepeat
              ? '重复数量由浏览器按可用空间决定；可修改重复模式和轨道模板，不能按固定序号增删或拖动。'
              : sequence.hasUnsupportedSegments
                ? editableTracks.length > 0
                    ? `${firstUnsupportedReason ?? '声明中包含尚未接管的轨道片段。'} 可编辑轨道仍可单独调整。`
                    : (firstUnsupportedReason ?? '声明中包含尚未接管的轨道片段。')
                : sequence.hasNamedLines
                  ? '命名线与轨道尺寸可编辑；为保全子项引用，暂不能增删轨道。'
                  : sequence.tracks.length === 0
                    ? '未找到可识别的显式轨道。'
                    : null,
    }
}

export function serializeGridTrackBreadth(value: GridTrackBreadth): string {
    if (value.kind === 'zero') return value.numberText
    if (value.kind === 'keyword') return value.value
    return value.kind === 'fraction' ? `${value.numberText}fr` : `${value.numberText}${value.unit}`
}

export function serializeGridTrackSize(value: Exclude<GridTrackSize, {kind: 'custom'}>): string {
    if (value.kind !== 'minmax') return serializeGridTrackBreadth(value)
    return `minmax(${serializeGridTrackBreadth(value.minimum)}, ${serializeGridTrackBreadth(value.maximum)})`
}

/**
 * 修改单条轨道时尽量只替换对应 token；固定 repeat 内的单项修改只展开该 repeat 片段。
 */
export function replaceGridTrackAt(
    model: GridTrackListModel,
    trackIndex: number,
    next: Exclude<GridTrackSize, {kind: 'custom'}>,
): string | null {
    const target = model.tracks[trackIndex]
    if (!target?.editable) return null
    const serialized = serializeGridTrackSize(next)
    if (target.repeat?.kind === 'adaptive') {
        return `${model.raw.slice(0, target.sourceStart)}${serialized}${model.raw.slice(target.sourceEnd)}`
    }
    if (target.repeat?.kind === 'fixed') {
        const group = model.tracks.filter(
            track =>
                track.repeat?.kind === 'fixed' &&
                track.repeat?.start === target.repeat?.start &&
                track.repeat?.end === target.repeat?.end,
        )
        const targetInGroup = group.indexOf(target)
        if (targetInGroup < 0) return null
        const expanded = group.map((track, index) =>
            index === targetInGroup ? serialized : track.raw,
        )
        return `${model.raw.slice(0, target.repeat.start)}${expanded.join(' ')}${model.raw.slice(target.repeat.end)}`
    }
    return `${model.raw.slice(0, target.sourceStart)}${serialized}${model.raw.slice(target.sourceEnd)}`
}

/** 只替换自适应 repeat 的模式 token，轨道模板、空白与其余声明保持原字节。 */
export function replaceAdaptiveGridRepeatMode(
    model: GridTrackListModel,
    mode: GridAdaptiveRepeatMode,
): string | null {
    const repeat = model.adaptiveRepeat
    if (!repeat) return null
    return `${model.raw.slice(0, repeat.modeStart)}${mode}${model.raw.slice(repeat.modeEnd)}`
}

/** 把一条逻辑边界上的安全名称作为整体修改；同边界多个原组会合并，其他源码保持原字节。 */
export function setGridNamedLineNames(
    model: GridTrackListModel,
    lineIndex: number,
    names: readonly string[],
): string | null {
    if (
        !model.canEditNamedLines ||
        !Number.isInteger(lineIndex) ||
        lineIndex < 0 ||
        lineIndex > model.tracks.length ||
        names.length > GRID_LINE_NAMES_PER_BOUNDARY_LIMIT ||
        names.some(
            name => !GRID_LINE_NAME.test(name) || RESERVED_GRID_LINE_NAMES.has(name.toLowerCase()),
        )
    ) {
        return null
    }
    const groups = model.namedLines.filter(group => group.lineIndex === lineIndex)
    const replacement = names.length > 0 ? `[${names.join(' ')}]` : ''
    if (groups.length > 0) {
        const first = groups[0]
        const last = groups.at(-1)
        if (!first || !last) return null
        return `${model.raw.slice(0, first.sourceStart)}${replacement}${model.raw.slice(last.sourceEnd)}`
    }
    if (names.length === 0) return model.raw
    const nextTrack = model.tracks[lineIndex]
    const previousTrack = model.tracks[lineIndex - 1]
    if (nextTrack) {
        return `${model.raw.slice(0, nextTrack.sourceStart)}${replacement} ${model.raw.slice(nextTrack.sourceStart)}`
    }
    if (previousTrack) {
        return `${model.raw.slice(0, previousTrack.sourceEnd)} ${replacement}${model.raw.slice(previousTrack.sourceEnd)}`
    }
    return null
}

export function gridNamedLineNames(model: GridTrackListModel, lineIndex: number): string[] {
    return model.namedLines
        .filter(group => group.lineIndex === lineIndex)
        .flatMap(group => [...group.names])
}

export function parseGridNamedLineInput(value: string): string[] | null {
    if (!value.trim()) return []
    return safeGridLineNames(value)
}

function expandedTrackValues(model: GridTrackListModel): string[] | null {
    if (!model.canRestructure) return null
    return model.tracks.map(track => track.raw)
}

/** 结构操作会展开固定 repeat；仅当全部轨道均受控时才允许生成新的显式列表。 */
export function insertGridTrackAt(
    model: GridTrackListModel,
    trackIndex: number,
    value: Exclude<GridTrackSize, {kind: 'custom'}>,
): string | null {
    const tracks =
        model.status === 'absent' || model.status === 'none' ? [] : expandedTrackValues(model)
    if (
        !tracks ||
        trackIndex < 0 ||
        trackIndex > tracks.length ||
        tracks.length >= GRID_TRACK_LIMIT
    )
        return null
    tracks.splice(trackIndex, 0, serializeGridTrackSize(value))
    return tracks.join(' ')
}

export function removeGridTrackAt(model: GridTrackListModel, trackIndex: number): string | null {
    const tracks = expandedTrackValues(model)
    if (!tracks || tracks.length <= 1 || !tracks[trackIndex]) return null
    tracks.splice(trackIndex, 1)
    return tracks.join(' ')
}

/** 新建比例轨道使用零最小尺寸，避免内容的自动最小值意外撑破网格。 */
export function createFractionGridTrack(value: number, numberText = String(value)): GridTrackSize {
    if (!Number.isFinite(value) || value <= 0) {
        return customSize(numberText, '比例轨道必须是正有限数值。')
    }
    return {
        kind: 'minmax',
        minimum: {kind: 'zero', numberText: '0'},
        maximum: {kind: 'fraction', value, numberText},
    }
}
