// 本模块把 Grid 任务窗格的结构化输入绑定到既有内核意图；它只接受内核可解析的轨道与位置值。

import {
    documentFingerprint,
    gridTemplateAreaBlockReason,
    idempotencyKey,
    interactionId,
    parseGridItemPlacementLonghands,
    parseGridTrackList,
    replaceGridTrackAt,
    serializeGridTrackSize,
    type ChangeGridTrackStructureIntent,
    type GridItemPlacementValue,
    type GridTrackSize,
    type PropertyEditIntent,
    type ReadContext,
    type WriteDestination,
} from '../domain/kernel/index.ts'
import type {LayerProjectionNode} from '../domain/layerProjection.ts'
import {
    requireKernelComponentHandle,
    type KernelComponentBindings,
    type KernelDraftEditRequest,
} from './documentKernelDraftRuntime.ts'
import type {InspectVisualComponent} from './visualPropertyEditing.ts'

export type GridViewportContext = 'mobile' | 'desktop'
export type GridAxis = 'columns' | 'rows'
export type GridTrackPreset = 'fixed' | 'content' | 'fraction' | 'minmax'

export interface GridEditorInspection {
    readonly status: 'grid' | 'not-grid' | 'unavailable'
    readonly reason: string | null
    readonly columns: ReturnType<typeof parseGridTrackList>
    readonly rows: ReturnType<typeof parseGridTrackList>
    readonly trackStructureBlock: Readonly<{
        code: 'grid-template-areas-active'
        reason: string
    }> | null
}

export interface GridSelectionContext {
    readonly selected: LayerProjectionNode | null
    readonly gridParent: LayerProjectionNode | null
}

const PROPERTY_ALLOWLIST = new Set([
    'display',
    'grid-template-columns',
    'grid-template-rows',
    'grid-column-start',
    'grid-column-end',
    'grid-row-start',
    'grid-row-end',
    'align-items',
    'justify-content',
    'align-self',
    'justify-self',
    'row-gap',
    'column-gap',
])

function readContext(viewport: GridViewportContext): ReadContext {
    return Object.freeze({
        viewport,
        interactions: Object.freeze({hover: false, focusWithin: false}),
        direction: 'ltr',
        writingMode: 'horizontal-tb',
    })
}

function destination(viewport: GridViewportContext): WriteDestination {
    return Object.freeze({
        scope: 'entry',
        channel: viewport === 'mobile'
            ? Object.freeze({kind: 'base-rule' as const})
            : Object.freeze({kind: 'conditional-rule' as const, context: 'desktop' as const}),
    })
}

function effectiveValue(
    result: ReturnType<InspectVisualComponent>,
    property: string,
): string {
    if (result.status !== 'ready') return ''
    const value = result.inspection.properties[property]?.effectiveValue
    return value?.resolvedValue ?? value?.rawValue ?? ''
}

export function resolveGridSelectionContext(
    nodes: readonly LayerProjectionNode[],
    selectedNodeId: string | null,
): GridSelectionContext {
    if (!selectedNodeId) return Object.freeze({selected: null, gridParent: null})
    const visit = (
        items: readonly LayerProjectionNode[],
        parent: LayerProjectionNode | null,
    ): GridSelectionContext | null => {
        for (const item of items) {
            if (item.id === selectedNodeId) {
                return Object.freeze({
                    selected: item,
                    gridParent: parent?.managed && parent.kind === 'container' ? parent : null,
                })
            }
            const nested = visit(item.children, item)
            if (nested) return nested
        }
        return null
    }
    return visit(nodes, null) ?? Object.freeze({selected: null, gridParent: null})
}

export function inspectGridEditor(
    nodeId: string,
    inspect: InspectVisualComponent,
    viewport: GridViewportContext,
): GridEditorInspection {
    const result = inspect({
        nodeId,
        properties: ['display', 'grid-template-columns', 'grid-template-rows', 'grid-template-areas'],
        context: readContext(viewport),
    })
    if (result.status !== 'ready') {
        return Object.freeze({
            status: 'unavailable',
            reason: '当前布局状态无法读取。',
            columns: parseGridTrackList(null),
            rows: parseGridTrackList(null),
            trackStructureBlock: null,
        })
    }
    const display = effectiveValue(result, 'display').trim().toLowerCase()
    const grid = /^(?:inline-)?grid$/u.test(display)
    const areaBlockReason = grid
        ? gridTemplateAreaBlockReason(result.inspection.properties['grid-template-areas'] ?? null)
        : null
    return Object.freeze({
        status: grid ? 'grid' : 'not-grid',
        reason: grid ? null : '当前容器不是 Grid；轨道设置尚未生效。',
        columns: parseGridTrackList(effectiveValue(result, 'grid-template-columns')),
        rows: parseGridTrackList(effectiveValue(result, 'grid-template-rows')),
        trackStructureBlock: areaBlockReason
            ? Object.freeze({code: 'grid-template-areas-active' as const, reason: areaBlockReason})
            : null,
    })
}

export function gridTrackPresetSize(preset: GridTrackPreset): Exclude<GridTrackSize, {kind: 'custom'}> {
    if (preset === 'fixed') {
        return Object.freeze({kind: 'length', value: 8, unit: 'rem', numberText: '8'})
    }
    if (preset === 'content') return Object.freeze({kind: 'keyword', value: 'auto'})
    if (preset === 'fraction') {
        return Object.freeze({
            kind: 'minmax',
            minimum: Object.freeze({kind: 'zero', numberText: '0'}),
            maximum: Object.freeze({kind: 'fraction', value: 1, numberText: '1'}),
        })
    }
    return Object.freeze({
        kind: 'minmax',
        minimum: Object.freeze({kind: 'length', value: 8, unit: 'rem', numberText: '8'}),
        maximum: Object.freeze({kind: 'fraction', value: 1, numberText: '1'}),
    })
}

function propertyRequest(
    nodeId: string,
    viewport: GridViewportContext,
    changes: readonly Readonly<{property: string; value: string | null}>[],
    requestId: string,
): KernelDraftEditRequest {
    if (changes.length === 0 || changes.some(change => !PROPERTY_ALLOWLIST.has(change.property))) {
        throw new TypeError('Grid 属性请求包含未开放字段。')
    }
    if (new Set(changes.map(change => change.property)).size !== changes.length) {
        throw new TypeError('Grid 属性请求不能重复修改同一字段。')
    }
    return Object.freeze({
        nodeIds: Object.freeze([nodeId.toLowerCase()]),
        idempotencyKey: idempotencyKey(`grid-property:${requestId}`),
        interactionId: interactionId(`grid-property:${documentFingerprint(requestId)}`),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents(handles: KernelComponentBindings) {
            const component = requireKernelComponentHandle(handles, nodeId)
            return Object.freeze(changes.map(change => Object.freeze({
                kind: 'edit-property' as const,
                target: Object.freeze({kind: 'component-root' as const, component}),
                property: change.property,
                action: change.value === null
                    ? Object.freeze({kind: 'clear-override' as const})
                    : Object.freeze({kind: 'set-value' as const, value: change.value}),
                readContext: readContext(viewport),
                destination: destination(viewport),
                ...(change.value === null ? {} : {takeover: 'preserve-inline-effect' as const}),
            } satisfies PropertyEditIntent)))
        },
    })
}

export function createGridConversionRequest(
    nodeId: string,
    viewport: GridViewportContext,
    requestId: string = crypto.randomUUID(),
): KernelDraftEditRequest {
    return propertyRequest(nodeId, viewport, [{property: 'display', value: 'grid'}], requestId)
}

export function createGridTrackStructureRequest(
    nodeId: string,
    viewport: GridViewportContext,
    axis: GridAxis,
    action: ChangeGridTrackStructureIntent['action'],
    requestId: string = crypto.randomUUID(),
): KernelDraftEditRequest {
    return Object.freeze({
        nodeIds: Object.freeze([nodeId.toLowerCase()]),
        idempotencyKey: idempotencyKey(`grid-structure:${requestId}`),
        interactionId: interactionId(`grid-structure:${documentFingerprint(requestId)}`),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents(handles: KernelComponentBindings) {
            const component = requireKernelComponentHandle(handles, nodeId)
            return Object.freeze([Object.freeze({
                kind: 'change-grid-track-structure' as const,
                target: Object.freeze({kind: 'component-root' as const, component}),
                context: viewport,
                axis,
                action,
                destinationScope: 'entry' as const,
            })])
        },
    })
}

export function createGridTrackInsertRequest(
    nodeId: string,
    viewport: GridViewportContext,
    axis: GridAxis,
    trackIndex: number,
    preset: GridTrackPreset,
    requestId: string = crypto.randomUUID(),
): KernelDraftEditRequest {
    return createGridTrackStructureRequest(nodeId, viewport, axis, {
        kind: 'insert',
        trackIndex,
        value: serializeGridTrackSize(gridTrackPresetSize(preset)),
    }, requestId)
}

export function createGridTrackRemoveRequest(
    nodeId: string,
    viewport: GridViewportContext,
    axis: GridAxis,
    trackIndex: number,
    requestId: string = crypto.randomUUID(),
): KernelDraftEditRequest {
    return createGridTrackStructureRequest(nodeId, viewport, axis, {
        kind: 'remove',
        trackIndex,
        relocation: 'auto',
    }, requestId)
}

export function createGridTrackResizeRequest(
    nodeId: string,
    viewport: GridViewportContext,
    axis: GridAxis,
    currentRaw: string,
    trackIndex: number,
    size: Exclude<GridTrackSize, {kind: 'custom'}>,
    requestId: string = crypto.randomUUID(),
): KernelDraftEditRequest {
    const model = parseGridTrackList(currentRaw)
    const next = replaceGridTrackAt(model, trackIndex, size)
    if (next === null) throw new TypeError(model.reason ?? '当前轨道不能安全修改。')
    return propertyRequest(nodeId, viewport, [{
        property: axis === 'columns' ? 'grid-template-columns' : 'grid-template-rows',
        value: next,
    }], requestId)
}

export function createGridTrackReorderRequest(
    nodeId: string,
    viewport: GridViewportContext,
    axis: GridAxis,
    currentRaw: string,
    fromIndex: number,
    toIndex: number,
    requestId: string = crypto.randomUUID(),
): KernelDraftEditRequest {
    const model = parseGridTrackList(currentRaw)
    if (!model.canRestructure || !model.tracks[fromIndex] || !model.tracks[toIndex]) {
        throw new TypeError(model.reason ?? '当前轨道不能安全重排。')
    }
    const tracks = model.tracks.map(track => track.raw)
    const [moved] = tracks.splice(fromIndex, 1)
    if (!moved) throw new TypeError('待移动轨道不存在。')
    tracks.splice(toIndex, 0, moved)
    return propertyRequest(nodeId, viewport, [{
        property: axis === 'columns' ? 'grid-template-columns' : 'grid-template-rows',
        value: tracks.join(' '),
    }], requestId)
}

export function createGridItemPlacementRequest(
    nodeId: string,
    viewport: GridViewportContext,
    placement: Readonly<{
        column: Exclude<GridItemPlacementValue, {mode: 'custom' | 'unset'}>
        row: Exclude<GridItemPlacementValue, {mode: 'custom' | 'unset'}>
    }>,
    requestId: string = crypto.randomUUID(),
): KernelDraftEditRequest {
    const axisChanges = (axis: 'column' | 'row', value: typeof placement.column) => {
        const start = value.mode === 'positioned' ? String(value.start) : 'auto'
        const end = value.span === 1 ? 'auto' : `span ${value.span}`
        return [
            {property: `grid-${axis}-start`, value: start},
            {property: `grid-${axis}-end`, value: end},
        ] as const
    }
    return propertyRequest(nodeId, viewport, [
        ...axisChanges('column', placement.column),
        ...axisChanges('row', placement.row),
    ], requestId)
}

export function inspectGridItemPlacement(
    nodeId: string,
    inspect: InspectVisualComponent,
    viewport: GridViewportContext,
): Readonly<{column: GridItemPlacementValue; row: GridItemPlacementValue}> | null {
    const result = inspect({
        nodeId,
        properties: ['grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end'],
        context: readContext(viewport),
    })
    if (result.status !== 'ready') return null
    const read = (property: string) => effectiveValue(result, property) || null
    return Object.freeze({
        column: parseGridItemPlacementLonghands(read('grid-column-start'), read('grid-column-end')),
        row: parseGridItemPlacementLonghands(read('grid-row-start'), read('grid-row-end')),
    })
}
