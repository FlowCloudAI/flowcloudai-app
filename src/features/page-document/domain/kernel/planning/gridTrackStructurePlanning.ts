// 本模块把 Grid 轨道增删意图展开为父轨道与直属子项位置的原子属性批次；界面不得自行决定源码落点。

import type {DocumentDiagnostic} from '../../contract.ts'
import {componentHasCapability, type ComponentDescriptor} from '../components/index.ts'
import type {PropertyInspection} from '../contracts/analysis.ts'
import type {
    ChangeGridTrackStructureIntent,
    EditIntent,
    GridTrackRelocationStrategy,
    PropertyEditIntent,
} from '../contracts/edit.ts'
import type {ComponentHandle} from '../contracts/identity.ts'
import type {SourceOrigin, SourceScope} from '../contracts/source.ts'
import {
    insertGridTrackAt,
    parseGridItemPlacementLonghands,
    parseGridTrackList,
    removeGridTrackAt,
    type GridItemPlacementValue,
} from '../styles/index.ts'
import type {PlanningAnalysisRuntime} from './propertyPlanning.ts'

type ManagedPlacement = Exclude<GridItemPlacementValue, {readonly mode: 'custom' | 'unset'}>
type PlacementSource = 'absent' | 'fixed' | 'conditional' | 'unknown'

export type GridTrackStructureExpansion =
    | {readonly status: 'ready'; readonly intents: readonly EditIntent[]}
    | {readonly status: 'rejected'; readonly diagnostics: readonly DocumentDiagnostic[]}

type GridTrackStructureRejection = Extract<
    GridTrackStructureExpansion,
    {readonly status: 'rejected'}
>

export function expandGridTrackStructureIntents(
    runtime: PlanningAnalysisRuntime,
    intents: readonly EditIntent[],
): GridTrackStructureExpansion {
    if (!intents.some(intent => intent.kind === 'change-grid-track-structure')) {
        return Object.freeze({status: 'ready', intents})
    }
    if (intents.length !== 1 || intents[0]?.kind !== 'change-grid-track-structure') {
        return rejected(
            'grid-track-structure-mixed-batch',
            '轨道结构修改暂不能与其他显式意图混用；请作为独立原子操作提交。',
        )
    }
    return expandGridTrackStructureIntent(runtime, intents[0])
}

function expandGridTrackStructureIntent(
    runtime: PlanningAnalysisRuntime,
    intent: ChangeGridTrackStructureIntent,
): GridTrackStructureExpansion {
    if (!runtime.components || !runtime.properties) {
        return rejected('candidate-analysis-failed', '候选缺少组件与属性分析。')
    }
    const parent = runtime.components.components.find(
        item =>
            item.handle.nodeId === intent.target.component.nodeId &&
            runtime.components?.resolveElement(intent.target.component) !== null,
    )
    if (!parent) return rejected('stale-component-handle', '网格容器已经失效。')
    if (
        parent.handle.kind !== 'container' ||
        !componentHasCapability(parent.handle.kind, 'layout.container')
    ) {
        return rejected('grid-container-required', '轨道结构只能应用于受管布局容器。', parent)
    }
    if (parent.unmanagedDirectContentCount > 0) {
        return rejected(
            'grid-unmanaged-direct-content',
            '容器含有无法归属到受管组件的直属内容，不能安全迁移轨道结构。',
            parent,
        )
    }
    const readContext = context(intent.context)
    const display = runtime.properties.inspect(parent.handle, 'display', readContext)
    if (!isProvenGrid(display)) {
        return rejected(
            'grid-layout-not-applicable',
            display?.confidence.kind === 'proven'
                ? '当前断点的容器不是 Grid。'
                : (display?.confidence.reason ?? '无法确定当前断点的布局类型。'),
            parent,
        )
    }
    const areas = runtime.properties.inspect(parent.handle, 'grid-template-areas', readContext)
    const areaBlock = templateAreaBlockReason(areas)
    if (areaBlock) return rejected('grid-template-areas-active', areaBlock, parent)

    const property = intent.axis === 'columns' ? 'grid-template-columns' : 'grid-template-rows'
    const trackInspection = runtime.properties.inspect(parent.handle, property, readContext)
    const currentTracks = trackModel(trackInspection)
    if (currentTracks.status === 'rejected') {
        return rejected('grid-track-state-unavailable', currentTracks.reason, parent)
    }
    const model = currentTracks.model
    const establishesFirstTrack =
        intent.action.kind === 'insert' &&
        intent.action.trackIndex === 0 &&
        (model.status === 'absent' || model.status === 'none')
    if (!establishesFirstTrack && (model.status !== 'explicit' || !model.canRestructure)) {
        return rejected(
            'grid-track-restructure-unsupported',
            model.reason ?? '当前轨道声明不能安全重组。',
            parent,
        )
    }
    if (intent.action.kind === 'collapse-mobile-single-column') {
        return expandMobileSingleColumn(runtime, intent, parent, model)
    }
    const nextRaw = nextTrackValue(model, intent)
    if (nextRaw.status === 'rejected') {
        return rejected('grid-track-action-invalid', nextRaw.reason, parent)
    }

    const axis = intent.axis === 'columns' ? 'column' : 'row'
    const boundary = intent.action.trackIndex + 1
    const nextTrackCount = model.tracks.length + (intent.action.kind === 'insert' ? 1 : -1)
    const propertyIntents: PropertyEditIntent[] = [
        propertyIntent(
            parent.handle,
            property,
            nextRaw.value,
            intent.context,
            intent.destinationScope,
        ),
    ]
    for (const childId of parent.childNodeIds) {
        const child = runtime.components.components.find(item => item.handle.nodeId === childId)
        if (!child) {
            return rejected(
                'grid-child-binding-missing',
                `直属子项 ${childId} 无法重新绑定。`,
                parent,
            )
        }
        const placement = inspectPlacement(runtime, child, axis, intent.context)
        if (placement.status === 'rejected') {
            return rejected(
                'grid-child-placement-unavailable',
                `子项 ${childId} 的位置无法安全迁移：${placement.reason}`,
                child,
            )
        }
        if (establishesFirstTrack && placement.value.mode === 'positioned') {
            return rejected(
                'grid-first-track-position-conflict',
                `子项 ${childId} 已有显式位置；建立第一条轨道前需先处理该引用。`,
                child,
            )
        }
        if (establishesFirstTrack && placement.value.mode === 'auto' && placement.value.span > 1) {
            return rejected(
                'grid-first-track-span-conflict',
                `子项 ${childId} 的自动跨度大于 1，建立第一条轨道会改变隐式轨道结构。`,
                child,
            )
        }
        if (establishesFirstTrack) continue
        const transformed =
            intent.action.kind === 'insert'
                ? transformForInsert(placement.value, boundary)
                : transformForRemoval(
                      placement.value,
                      boundary,
                      intent.action.relocation,
                      nextTrackCount,
                  )
        if (transformed.status === 'rejected') {
            return rejected(
                transformed.code,
                `子项 ${childId} 的位置无法安全迁移：${transformed.reason}`,
                child,
            )
        }
        if (transformed.status === 'unchanged') continue
        propertyIntents.push(
            ...placementIntents(
                child.handle,
                axis,
                transformed.value,
                intent.context,
                intent.destinationScope,
            ),
        )
    }
    return Object.freeze({status: 'ready', intents: Object.freeze(propertyIntents)})
}

function nextTrackValue(
    model: ReturnType<typeof parseGridTrackList>,
    intent: ChangeGridTrackStructureIntent,
):
    | {readonly status: 'ready'; readonly value: string}
    | {readonly status: 'rejected'; reason: string} {
    if (intent.action.kind === 'collapse-mobile-single-column') {
        return {status: 'rejected', reason: '通用单列操作必须经过专用规划。'}
    }
    if (intent.action.kind === 'remove') {
        const value = removeGridTrackAt(model, intent.action.trackIndex)
        return value === null
            ? {status: 'rejected', reason: '至少保留一条轨道，且删除位置必须存在。'}
            : {status: 'ready', value}
    }
    const inserted = parseGridTrackList(intent.action.value)
    if (
        inserted.status !== 'explicit' ||
        inserted.tracks.length !== 1 ||
        !inserted.canRestructure ||
        inserted.hasNamedLines ||
        inserted.tracks[0]?.size.kind === 'custom'
    ) {
        return {status: 'rejected', reason: '插入值必须是一条受支持且不含命名线的轨道。'}
    }
    const value = insertGridTrackAt(model, intent.action.trackIndex, inserted.tracks[0]!.size)
    return value === null
        ? {status: 'rejected', reason: '插入位置或轨道数量不满足限制。'}
        : {status: 'ready', value}
}

function expandMobileSingleColumn(
    runtime: PlanningAnalysisRuntime,
    intent: ChangeGridTrackStructureIntent,
    parent: ComponentDescriptor,
    mobileTracks: ReturnType<typeof parseGridTrackList>,
): GridTrackStructureExpansion {
    if (intent.context !== 'mobile' || intent.axis !== 'columns') {
        return rejected(
            'grid-mobile-single-column-context',
            '通用单列操作必须使用 mobile 列轴。',
            parent,
        )
    }
    if (mobileTracks.status !== 'explicit' || !mobileTracks.canRestructure) {
        return rejected(
            'grid-mobile-columns-unavailable',
            mobileTracks.reason ?? '移动基础的列轨道不能安全改为单列。',
            parent,
        )
    }
    const intents: PropertyEditIntent[] = []
    if (mobileTracks.tracks.length !== 1) {
        const preserved = preserveWiderTrackContexts(runtime, intent, parent)
        if (preserved.status === 'rejected') return preserved
        intents.push(...preserved.intents)
        intents.push(
            propertyIntent(
                parent.handle,
                'grid-template-columns',
                'minmax(0, 1fr)',
                'mobile',
                intent.destinationScope,
            ),
        )
    }
    for (const childId of parent.childNodeIds) {
        const child = runtime.components?.components.find(item => item.handle.nodeId === childId)
        if (!child) {
            return rejected(
                'grid-child-binding-missing',
                `直属子项 ${childId} 无法重新绑定。`,
                parent,
            )
        }
        for (const axis of ['column', 'row'] as const) {
            const mobile = inspectPlacement(runtime, child, axis, 'mobile')
            if (mobile.status === 'rejected') {
                return rejected(
                    'grid-child-placement-unavailable',
                    `子项 ${childId} 的移动基础位置无法安全接管：${mobile.reason}`,
                    child,
                )
            }
            const needsAuto =
                mobile.value.mode === 'positioned' ||
                (mobile.value.mode === 'auto' && mobile.value.span > 1)
            if (!needsAuto) continue
            const preserved = preserveWiderPlacementContexts(runtime, intent, parent, child, axis)
            if (preserved.status === 'rejected') return preserved
            intents.push(...preserved.intents)
            intents.push(
                ...placementIntents(
                    child.handle,
                    axis,
                    {mode: 'auto', span: 1},
                    'mobile',
                    intent.destinationScope,
                ),
            )
        }
    }
    return Object.freeze({status: 'ready', intents: Object.freeze(intents)})
}

function preserveWiderTrackContexts(
    runtime: PlanningAnalysisRuntime,
    intent: ChangeGridTrackStructureIntent,
    parent: ComponentDescriptor,
):
    | {readonly status: 'ready'; readonly intents: readonly PropertyEditIntent[]}
    | {readonly status: 'rejected'; readonly diagnostics: readonly DocumentDiagnostic[]} {
    const intents: PropertyEditIntent[] = []
    for (const viewport of ['desktop'] as const) {
        const layout = gridLayoutState(runtime, parent.handle, viewport)
        if (layout.status === 'rejected') return rejected(layout.code, layout.reason, parent)
        if (!layout.grid) continue
        const inspection = runtime.properties!.inspect(
            parent.handle,
            'grid-template-columns',
            context(viewport),
        )
        const tracks = trackModel(inspection)
        if (tracks.status === 'rejected' || tracks.model.status !== 'explicit') {
            return rejected(
                'grid-wider-columns-unavailable',
                tracks.status === 'rejected'
                    ? tracks.reason
                    : `${viewport} 的有效列轨道无法无损保留。`,
                parent,
            )
        }
        const source = effectiveSourceKind(inspection!)
        if (source === 'unknown') {
            return rejected(
                'grid-wider-columns-source-unknown',
                `${viewport} 的列轨道来源无法确定。`,
                parent,
            )
        }
        if (source !== 'fixed') continue
        intents.push(
            propertyIntent(
                parent.handle,
                'grid-template-columns',
                tracks.model.raw,
                viewport,
                intent.destinationScope,
            ),
        )
    }
    return {status: 'ready', intents: Object.freeze(intents)}
}

function preserveWiderPlacementContexts(
    runtime: PlanningAnalysisRuntime,
    intent: ChangeGridTrackStructureIntent,
    parent: ComponentDescriptor,
    child: ComponentDescriptor,
    axis: 'column' | 'row',
):
    | {readonly status: 'ready'; readonly intents: readonly PropertyEditIntent[]}
    | {readonly status: 'rejected'; readonly diagnostics: readonly DocumentDiagnostic[]} {
    const intents: PropertyEditIntent[] = []
    for (const viewport of ['desktop'] as const) {
        const layout = gridLayoutState(runtime, parent.handle, viewport)
        if (layout.status === 'rejected') return rejected(layout.code, layout.reason, parent)
        if (!layout.grid) continue
        const placement = inspectPlacement(runtime, child, axis, viewport)
        if (placement.status === 'rejected') {
            return rejected(
                'grid-wider-placement-unavailable',
                `子项 ${child.handle.nodeId} 的 ${viewport} 位置无法无损保留：${placement.reason}`,
                child,
            )
        }
        if (placement.source === 'unknown') {
            return rejected(
                'grid-wider-placement-source-unknown',
                `子项 ${child.handle.nodeId} 的 ${viewport} 位置来源无法确定。`,
                child,
            )
        }
        if (placement.source !== 'fixed' || placement.value.mode === 'unset') continue
        intents.push(
            ...placementIntents(
                child.handle,
                axis,
                placement.value,
                viewport,
                intent.destinationScope,
            ),
        )
    }
    return {status: 'ready', intents: Object.freeze(intents)}
}

function inspectPlacement(
    runtime: PlanningAnalysisRuntime,
    child: ComponentDescriptor,
    axis: 'column' | 'row',
    viewport: ChangeGridTrackStructureIntent['context'],
):
    | {
          readonly status: 'ready'
          readonly value: Exclude<GridItemPlacementValue, {readonly mode: 'custom'}>
          readonly source: PlacementSource
      }
    | {readonly status: 'rejected'; reason: string} {
    const properties = runtime.properties!
    const readContext = context(viewport)
    const area = properties.inspect(child.handle, 'grid-area', readContext)
    if (!area || area.confidence.kind !== 'proven') {
        return {
            status: 'rejected',
            reason: confidenceReason(area, '无法读取 grid-area。'),
        }
    }
    const areaValue = area.effectiveValue?.resolvedValue ?? area.effectiveValue?.rawValue ?? null
    if (areaValue && !/^auto(?:\s*\/\s*auto){0,3}$/iu.test(areaValue.trim())) {
        return {status: 'rejected', reason: 'grid-area 同时影响行列位置。'}
    }
    const start = properties.inspect(child.handle, `grid-${axis}-start`, readContext)
    const end = properties.inspect(child.handle, `grid-${axis}-end`, readContext)
    if (!start || !end || start.confidence.kind !== 'proven' || end.confidence.kind !== 'proven') {
        return {
            status: 'rejected',
            reason:
                start?.confidence.kind !== 'proven'
                    ? confidenceReason(start, `无法读取 grid-${axis}-start。`)
                    : confidenceReason(end, `无法读取 grid-${axis}-end。`),
        }
    }
    if (effectiveImportant(start) || effectiveImportant(end)) {
        return {status: 'rejected', reason: '!important 位置声明不能由轨道结构操作接管。'}
    }
    const startValue = resolvedValue(start)
    const endValue = resolvedValue(end)
    if (startValue.status === 'rejected') {
        return {
            status: 'rejected',
            reason: startValue.reason,
        }
    }
    if (endValue.status === 'rejected') return {status: 'rejected', reason: endValue.reason}
    const value = parseGridItemPlacementLonghands(startValue.value, endValue.value)
    return value.mode === 'custom'
        ? {status: 'rejected', reason: value.reason}
        : {
              status: 'ready',
              value,
              source: combinePlacementSources(effectiveSourceKind(start), effectiveSourceKind(end)),
          }
}

function transformForInsert(
    value: GridItemPlacementValue,
    insertedTrack: number,
): {readonly status: 'unchanged'} | {readonly status: 'changed'; readonly value: ManagedPlacement} {
    if (value.mode !== 'positioned') return {status: 'unchanged'}
    const finalTrack = value.start + value.span - 1
    if (value.start >= insertedTrack) {
        return {status: 'changed', value: {...value, start: value.start + 1}}
    }
    if (finalTrack >= insertedTrack) {
        return {status: 'changed', value: {...value, span: value.span + 1}}
    }
    return {status: 'unchanged'}
}

function transformForRemoval(
    value: GridItemPlacementValue,
    removedTrack: number,
    relocation: GridTrackRelocationStrategy | null,
    nextTrackCount: number,
):
    | {readonly status: 'unchanged'}
    | {readonly status: 'changed'; readonly value: ManagedPlacement}
    | {readonly status: 'rejected'; readonly code: string; readonly reason: string} {
    if (value.mode === 'unset') return {status: 'unchanged'}
    if (value.mode === 'custom') {
        return {status: 'rejected', code: 'grid-child-placement-custom', reason: value.reason}
    }
    if (value.mode === 'auto') {
        return value.span <= nextTrackCount
            ? {status: 'unchanged'}
            : {
                  status: 'rejected',
                  code: 'grid-child-span-out-of-range',
                  reason: `自动跨度为 ${value.span}，删除后只剩 ${nextTrackCount} 条显式轨道。`,
              }
    }
    const finalTrack = value.start + value.span - 1
    if (finalTrack < removedTrack) return {status: 'unchanged'}
    if (value.start > removedTrack) {
        return {status: 'changed', value: {...value, start: value.start - 1}}
    }
    if (value.span > 1) {
        return {status: 'changed', value: {...value, span: value.span - 1}}
    }
    if (!relocation) {
        return {
            status: 'rejected',
            code: 'grid-track-relocation-required',
            reason: '子项只占用即将删除的轨道，需要先选择安置方式。',
        }
    }
    if (relocation === 'auto') {
        return {status: 'changed', value: {mode: 'auto', span: 1}}
    }
    const start = relocation === 'previous' ? removedTrack - 1 : removedTrack
    if (start < 1 || start > nextTrackCount) {
        return {
            status: 'rejected',
            code: 'grid-track-relocation-invalid',
            reason: '所选相邻轨道在删除后不存在。',
        }
    }
    return {status: 'changed', value: {mode: 'positioned', start, span: 1}}
}

function propertyIntent(
    handle: ComponentHandle,
    property: string,
    value: string,
    viewport: ChangeGridTrackStructureIntent['context'],
    scope: SourceScope,
): PropertyEditIntent {
    return Object.freeze({
        kind: 'edit-property',
        target: Object.freeze({kind: 'component-root', component: handle}),
        property,
        action: Object.freeze({kind: 'set-value', value}),
        readContext: context(viewport),
        destination: destination(scope, viewport),
        takeover: 'preserve-inline-effect',
    })
}

function placementIntents(
    handle: ComponentHandle,
    axis: 'column' | 'row',
    value: ManagedPlacement,
    viewport: ChangeGridTrackStructureIntent['context'],
    scope: SourceScope,
): readonly PropertyEditIntent[] {
    const shorthand = `grid-${axis}`
    const start = value.mode === 'positioned' ? String(value.start) : 'auto'
    const end = value.span === 1 ? 'auto' : `span ${value.span}`
    return Object.freeze([
        clearIntent(handle, shorthand, viewport, scope),
        propertyIntent(handle, `${shorthand}-start`, start, viewport, scope),
        propertyIntent(handle, `${shorthand}-end`, end, viewport, scope),
    ])
}

function clearIntent(
    handle: ComponentHandle,
    property: string,
    viewport: ChangeGridTrackStructureIntent['context'],
    scope: SourceScope,
): PropertyEditIntent {
    return Object.freeze({
        ...propertyIntent(handle, property, '', viewport, scope),
        action: Object.freeze({kind: 'clear-override'}),
    })
}

function trackModel(
    inspection: PropertyInspection | null,
):
    | {readonly status: 'ready'; readonly model: ReturnType<typeof parseGridTrackList>}
    | {readonly status: 'rejected'; readonly reason: string} {
    if (!inspection) return {status: 'rejected', reason: '内核没有返回轨道属性。'}
    if (inspection.confidence.kind !== 'proven') {
        return {status: 'rejected', reason: inspection.confidence.reason}
    }
    const value = resolvedValue(inspection)
    if (value.status === 'rejected') return value
    const model = parseGridTrackList(value.value)
    return model.status === 'custom'
        ? {status: 'rejected', reason: model.reason ?? '当前轨道值无法安全解释。'}
        : {status: 'ready', model}
}

function resolvedValue(
    inspection: PropertyInspection,
):
    | {readonly status: 'ready'; readonly value: string | null}
    | {readonly status: 'rejected'; readonly reason: string} {
    const effective = inspection.effectiveValue
    if (!effective) return {status: 'ready', value: null}
    if (effective.resolvedValue === null) {
        return {
            status: 'rejected',
            reason: `声明 ${effective.declaredProperty} 无法精确还原。`,
        }
    }
    return {status: 'ready', value: effective.resolvedValue}
}

function isProvenGrid(inspection: PropertyInspection | null): boolean {
    if (!inspection || inspection.confidence.kind !== 'proven') return false
    const value = inspection.effectiveValue?.resolvedValue ?? inspection.effectiveValue?.rawValue
    return /^(?:inline-)?grid$/iu.test(value?.trim() ?? 'block')
}

function gridLayoutState(
    runtime: PlanningAnalysisRuntime,
    handle: ComponentHandle,
    viewport: ChangeGridTrackStructureIntent['context'],
):
    | {readonly status: 'ready'; readonly grid: boolean}
    | {readonly status: 'rejected'; readonly code: string; readonly reason: string} {
    const inspection = runtime.properties?.inspect(handle, 'display', context(viewport)) ?? null
    if (!inspection) {
        return {
            status: 'rejected',
            code: 'grid-wider-layout-unavailable',
            reason: `${viewport} 的布局状态缺失。`,
        }
    }
    if (inspection.confidence.kind !== 'proven') {
        return {
            status: 'rejected',
            code: 'grid-wider-layout-unknown',
            reason: inspection.confidence.reason,
        }
    }
    const effective = inspection.effectiveValue
    if (!effective) return {status: 'ready', grid: false}
    if (effective.resolvedValue === null) {
        return {
            status: 'rejected',
            code: 'grid-wider-layout-unknown',
            reason: `${viewport} 的 display 声明无法精确还原。`,
        }
    }
    return {
        status: 'ready',
        grid: /^(?:inline-)?grid$/iu.test(effective.resolvedValue.trim()),
    }
}

function effectiveSourceKind(inspection: PropertyInspection): PlacementSource {
    const effective = inspection.effectiveValue
    if (!effective) return 'absent'
    if (effective.inherited) return 'unknown'
    const declaration = inspection.directDeclarations.find(
        item =>
            item.condition === 'active' &&
            item.declaredProperty === effective.declaredProperty &&
            sameOrigin(item.origin, effective.origin),
    )
    if (!declaration) return 'unknown'
    if (declaration.sourceKind === 'inline') return 'fixed'
    return declaration.media === null ? 'fixed' : 'conditional'
}

function combinePlacementSources(start: PlacementSource, end: PlacementSource): PlacementSource {
    if (start === 'unknown' || end === 'unknown') return 'unknown'
    if (start === 'fixed' || end === 'fixed') return 'fixed'
    if (start === 'conditional' || end === 'conditional') return 'conditional'
    return 'absent'
}

function sameOrigin(left: SourceOrigin, right: SourceOrigin): boolean {
    return (
        left.kind === right.kind &&
        left.source?.scope === right.source?.scope &&
        left.source?.file === right.source?.file &&
        left.range?.from === right.range?.from &&
        left.range?.to === right.range?.to
    )
}

function templateAreaBlockReason(inspection: PropertyInspection | null): string | null {
    if (!inspection) return '无法读取当前断点的命名区域。'
    if (inspection.confidence.kind !== 'proven') return inspection.confidence.reason
    const effective = inspection.effectiveValue
    if (!effective) return null
    if (effective.resolvedValue === null) return '当前断点的命名区域无法安全迁移。'
    return effective.resolvedValue.trim().toLowerCase() === 'none'
        ? null
        : '当前断点已定义命名区域；请先清除区域矩阵，再增删轨道。'
}

function effectiveImportant(inspection: PropertyInspection): boolean {
    const effective = inspection.effectiveValue
    if (!effective) return false
    return inspection.directDeclarations.some(
        declaration =>
            declaration.condition === 'active' &&
            declaration.important &&
            declaration.declaredProperty === effective.declaredProperty &&
            declaration.origin.source?.scope === effective.origin.source?.scope &&
            declaration.origin.source?.file === effective.origin.source?.file &&
            declaration.origin.range?.from === effective.origin.range?.from &&
            declaration.origin.range?.to === effective.origin.range?.to,
    )
}

function confidenceReason(
    inspection: PropertyInspection | null | undefined,
    fallback: string,
): string {
    return inspection?.confidence.kind === 'partial' || inspection?.confidence.kind === 'unknown'
        ? inspection.confidence.reason
        : fallback
}

function context(viewport: ChangeGridTrackStructureIntent['context']) {
    return Object.freeze({
        viewport,
        interactions: Object.freeze({hover: false, focusWithin: false}),
        direction: 'unknown' as const,
        writingMode: 'unknown' as const,
    })
}

function destination(scope: SourceScope, viewport: ChangeGridTrackStructureIntent['context']) {
    if (scope === 'component') {
        throw new TypeError('公共组件作用域不能通过通用 Grid 结构入口写回。')
    }
    return Object.freeze({
        scope,
        channel:
            viewport === 'mobile'
                ? Object.freeze({kind: 'base-rule' as const})
                : Object.freeze({kind: 'conditional-rule' as const, context: viewport}),
    })
}

function rejected(
    code: string,
    message: string,
    component?: ComponentDescriptor,
): GridTrackStructureRejection {
    return Object.freeze({
        status: 'rejected',
        diagnostics: Object.freeze([
            Object.freeze({
                severity: 'error',
                category: 'capability',
                code,
                message,
                nodeId: component?.handle.nodeId,
            } satisfies DocumentDiagnostic),
        ]),
    })
}
