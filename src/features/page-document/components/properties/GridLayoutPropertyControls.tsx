// 本组件呈现 Grid 的精确轨道与子项位置；所有提交均经 Grid 应用绑定进入文档内核。

import {useEffect, useState} from 'react'
import {ArrowDown, ArrowUp, Plus, Trash2} from 'lucide-react'
import {Button, Input, Select} from 'flowcloudai-ui'
import type {LayerProjectionNode} from '../../domain/layerProjection.ts'
import type {GridTrackItem, GridTrackSize} from '../../domain/kernel/index.ts'
import type {
    InspectVisualComponent,
} from '../../application/visualPropertyEditing.ts'
import type {KernelDraftEditRequest} from '../../application/documentKernelDraftRuntime.ts'
import {
    createGridConversionRequest,
    createGridItemPlacementRequest,
    createGridTrackInsertRequest,
    createGridTrackRemoveRequest,
    createGridTrackReorderRequest,
    createGridTrackResizeRequest,
    gridTrackPresetSize,
    inspectGridEditor,
    inspectGridItemPlacement,
    type GridAxis,
    type GridTrackPreset,
    type GridViewportContext,
} from '../../application/gridVisualEditing.ts'

interface GridLayoutPropertyControlsProps {
    readonly node: LayerProjectionNode
    readonly gridParent: LayerProjectionNode | null
    readonly viewport: GridViewportContext
    readonly inspectComponent: InspectVisualComponent
    readonly applyKernelEntry: (request: KernelDraftEditRequest, label: string) => Promise<boolean>
}

const TRACK_TYPE_OPTIONS = [
    {value: 'fixed', label: '固定值'},
    {value: 'content', label: '随内容'},
    {value: 'fraction', label: '比例分配'},
    {value: 'minmax', label: '最小 / 最大'},
] as const

function trackType(size: GridTrackSize): GridTrackPreset | 'custom' {
    if (size.kind === 'custom') return 'custom'
    if (size.kind === 'keyword') return 'content'
    if (size.kind === 'length' || size.kind === 'zero') return 'fixed'
    if (size.kind === 'fraction') return 'fraction'
    if (size.minimum.kind === 'zero' && size.maximum.kind === 'fraction') return 'fraction'
    return 'minmax'
}

function finiteDraft(raw: string, fallback: number): number {
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0 ? value : fallback
}

function TrackValueEditor({
    axis,
    index,
    item,
    nodeId,
    raw,
    viewport,
    apply,
}: {
    readonly axis: GridAxis
    readonly index: number
    readonly item: GridTrackItem
    readonly nodeId: string
    readonly raw: string
    readonly viewport: GridViewportContext
    readonly apply: (request: KernelDraftEditRequest, label: string) => Promise<void>
}) {
    const type = trackType(item.size)
    const [first, setFirst] = useState('8')
    const [second, setSecond] = useState('1')
    const [firstUnit, setFirstUnit] = useState<'px' | 'rem' | 'em' | '%'>('rem')
    const [secondUnit, setSecondUnit] = useState<'px' | 'rem' | 'em' | '%' | 'fr'>('fr')
    useEffect(() => {
        const size = item.size
        if (size.kind === 'length') {
            setFirst(size.numberText)
            setFirstUnit(size.unit)
        } else if (size.kind === 'fraction') {
            setFirst(size.numberText)
        } else if (size.kind === 'minmax') {
            if (size.minimum.kind === 'length') {
                setFirst(size.minimum.numberText)
                setFirstUnit(size.minimum.unit)
            } else if (size.minimum.kind === 'zero') {
                setFirst(size.minimum.numberText)
                setFirstUnit('px')
            }
            if (size.maximum.kind === 'length') {
                setSecond(size.maximum.numberText)
                setSecondUnit(size.maximum.unit)
            } else if (size.maximum.kind === 'fraction') {
                setSecond(size.maximum.numberText)
                setSecondUnit('fr')
            }
        }
    }, [item.raw, item.size])

    const commit = (size: Exclude<GridTrackSize, {kind: 'custom'}>) => apply(
        createGridTrackResizeRequest(nodeId, viewport, axis, raw, index, size),
        `修改${axis === 'columns' ? '列' : '行'}轨道`,
    )
    const commitFixed = () => {
        const value = finiteDraft(first, 8)
        void commit({kind: 'length', value, unit: firstUnit, numberText: String(value)})
    }
    const commitFraction = () => {
        const value = Math.max(finiteDraft(first, 1), 0.01)
        void commit({
            kind: 'minmax',
            minimum: {kind: 'zero', numberText: '0'},
            maximum: {kind: 'fraction', value, numberText: String(value)},
        })
    }
    const commitMinmax = () => {
        const minimumValue = finiteDraft(first, 8)
        const maximumValue = Math.max(finiteDraft(second, 1), secondUnit === 'fr' ? 0.01 : 0)
        void commit({
            kind: 'minmax',
            minimum: {kind: 'length', value: minimumValue, unit: firstUnit, numberText: String(minimumValue)},
            maximum: secondUnit === 'fr'
                ? {kind: 'fraction', value: maximumValue, numberText: String(maximumValue)}
                : {kind: 'length', value: maximumValue, unit: secondUnit, numberText: String(maximumValue)},
        })
    }

    return <div className="page-document-grid-track__value">
        <Select
            aria-label={`${axis === 'columns' ? '列' : '行'}轨道 ${index + 1} 类型`}
            value={type}
            options={[
                ...(type === 'custom' ? [{value: 'custom', label: '自定义源码', disabled: true}] : []),
                ...TRACK_TYPE_OPTIONS,
            ]}
            onValueChange={next => {
                if (next === 'custom') return
                void commit(gridTrackPresetSize(String(next) as GridTrackPreset))
            }}
        />
        {type === 'content' && <Select
            aria-label="随内容轨道值"
            value={item.size.kind === 'keyword' ? item.size.value : 'auto'}
            options={[
                {value: 'auto', label: '自动'},
                {value: 'min-content', label: '最小内容'},
                {value: 'max-content', label: '最大内容'},
            ]}
            onValueChange={value => void commit({kind: 'keyword', value: String(value) as 'auto' | 'min-content' | 'max-content'})}
        />}
        {(type === 'fixed' || type === 'fraction' || type === 'minmax') && <label>
            {type === 'minmax' ? '最小值' : type === 'fraction' ? '比例' : '数值'}
            <span className="page-document-grid-track__number">
                <Input aria-label="轨道第一数值" inputMode="decimal" value={first} onValueChange={setFirst} onBlur={type === 'fixed' ? commitFixed : type === 'fraction' ? commitFraction : commitMinmax}/>
                {type !== 'fraction' && <Select aria-label="轨道第一单位" value={firstUnit} options={['px', 'rem', 'em', '%'].map(value => ({value, label: value}))} onValueChange={value => setFirstUnit(String(value) as typeof firstUnit)}/>}
                {type === 'fraction' && <span>fr</span>}
            </span>
        </label>}
        {type === 'minmax' && <label>
            最大值
            <span className="page-document-grid-track__number">
                <Input aria-label="轨道第二数值" inputMode="decimal" value={second} onValueChange={setSecond} onBlur={commitMinmax}/>
                <Select aria-label="轨道第二单位" value={secondUnit} options={['fr', 'px', 'rem', 'em', '%'].map(value => ({value, label: value}))} onValueChange={value => setSecondUnit(String(value) as typeof secondUnit)}/>
            </span>
        </label>}
        {type === 'custom' && <p>该轨道由源码维护，选择受支持类型后才会接管。</p>}
    </div>
}

function GridAxisEditor({
    axis,
    nodeId,
    viewport,
    model,
    apply,
}: {
    readonly axis: GridAxis
    readonly nodeId: string
    readonly viewport: GridViewportContext
    readonly model: ReturnType<typeof inspectGridEditor>['columns']
    readonly apply: (request: KernelDraftEditRequest, label: string) => Promise<void>
}) {
    const [newTrackType, setNewTrackType] = useState<GridTrackPreset>('fraction')
    const axisLabel = axis === 'columns' ? '列' : '行'
    return <section className="page-document-grid-axis" aria-label={`${axisLabel}轨道`}>
        <header>
            <strong>{axisLabel}轨道</strong>
            <span>{model.tracks.length} 条</span>
        </header>
        {model.reason && <p>{model.reason}</p>}
        {model.tracks.map((item, index) => <div className="page-document-grid-track" key={`${item.sourceStart}:${item.raw}`}>
            <div className="page-document-grid-track__heading">
                <span>{axisLabel} {index + 1}</span>
                <Button iconOnly size="sm" variant="ghost" aria-label={`上移${axisLabel}轨道 ${index + 1}`} disabled={!model.canRestructure || index === 0} onClick={() => void apply(createGridTrackReorderRequest(nodeId, viewport, axis, model.raw, index, index - 1), `上移${axisLabel}轨道`)}><ArrowUp aria-hidden="true" size={14}/></Button>
                <Button iconOnly size="sm" variant="ghost" aria-label={`下移${axisLabel}轨道 ${index + 1}`} disabled={!model.canRestructure || index === model.tracks.length - 1} onClick={() => void apply(createGridTrackReorderRequest(nodeId, viewport, axis, model.raw, index, index + 1), `下移${axisLabel}轨道`)}><ArrowDown aria-hidden="true" size={14}/></Button>
                <Button iconOnly size="sm" variant="ghost" aria-label={`删除${axisLabel}轨道 ${index + 1}`} disabled={!model.canRestructure || model.tracks.length <= 1} onClick={() => void apply(createGridTrackRemoveRequest(nodeId, viewport, axis, index), `删除${axisLabel}轨道`)}><Trash2 aria-hidden="true" size={14}/></Button>
            </div>
            <TrackValueEditor axis={axis} index={index} item={item} nodeId={nodeId} raw={model.raw} viewport={viewport} apply={apply}/>
        </div>)}
        <div className="page-document-grid-axis__add">
            <Select aria-label={`新增${axisLabel}轨道类型`} value={newTrackType} options={[...TRACK_TYPE_OPTIONS]} onValueChange={value => setNewTrackType(String(value) as GridTrackPreset)}/>
            <Button size="sm" variant="outline" disabled={model.tracks.length >= 12} onClick={() => void apply(createGridTrackInsertRequest(nodeId, viewport, axis, model.tracks.length, newTrackType), `新增${axisLabel}轨道`)}><Plus aria-hidden="true" size={14}/>新增</Button>
        </div>
    </section>
}

function positiveInteger(raw: string, fallback: number): number {
    const value = Number(raw)
    return Number.isSafeInteger(value) && value > 0 && value <= 12 ? value : fallback
}

function GridItemEditor({
    node,
    viewport,
    inspectComponent,
    apply,
}: {
    readonly node: LayerProjectionNode
    readonly viewport: GridViewportContext
    readonly inspectComponent: InspectVisualComponent
    readonly apply: (request: KernelDraftEditRequest, label: string) => Promise<void>
}) {
    const placement = inspectGridItemPlacement(node.id, inspectComponent, viewport)
    const initial = (axis: 'column' | 'row') => {
        const value = placement?.[axis]
        return {
            start: value?.mode === 'positioned' ? value.start : 1,
            span: value && value.mode !== 'custom' && value.mode !== 'unset' ? value.span : 1,
        }
    }
    const [columnStart, setColumnStart] = useState(String(initial('column').start))
    const [columnSpan, setColumnSpan] = useState(String(initial('column').span))
    const [rowStart, setRowStart] = useState(String(initial('row').start))
    const [rowSpan, setRowSpan] = useState(String(initial('row').span))
    useEffect(() => {
        setColumnStart(String(initial('column').start))
        setColumnSpan(String(initial('column').span))
        setRowStart(String(initial('row').start))
        setRowSpan(String(initial('row').span))
        // placement 已由当前节点与上下文完整决定。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id, placement?.column.mode, placement?.row.mode, viewport])
    const commit = () => void apply(createGridItemPlacementRequest(node.id, viewport, {
        column: {mode: 'positioned', start: positiveInteger(columnStart, 1), span: positiveInteger(columnSpan, 1)},
        row: {mode: 'positioned', start: positiveInteger(rowStart, 1), span: positiveInteger(rowSpan, 1)},
    }), '修改 Grid 子项位置')
    return <section className="page-document-grid-item" aria-label="Grid 子项位置">
        <header><strong>子项位置</strong><span>起始轨道与跨度</span></header>
        <div>
            {[
                ['列起点', columnStart, setColumnStart],
                ['跨列', columnSpan, setColumnSpan],
                ['行起点', rowStart, setRowStart],
                ['跨行', rowSpan, setRowSpan],
            ].map(([label, value, change]) => <label key={String(label)}>{String(label)}<Input inputMode="numeric" value={String(value)} onValueChange={change as (value: string) => void} onBlur={commit}/></label>)}
        </div>
    </section>
}

export function GridLayoutPropertyControls({
    node,
    gridParent,
    viewport,
    inspectComponent,
    applyKernelEntry,
}: GridLayoutPropertyControlsProps) {
    const container = node.kind === 'container' ? node : gridParent
    const inspection = container ? inspectGridEditor(container.id, inspectComponent, viewport) : null
    const [error, setError] = useState<string | null>(null)
    const apply = async (request: KernelDraftEditRequest, label: string) => {
        try {
            const accepted = await applyKernelEntry(request, label)
            setError(accepted ? null : `${label}未应用；页面草稿保持不变。`)
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : `${label}未应用。`)
        }
    }
    if (!container || !inspection) return null
    if (inspection.status !== 'grid') {
        return node.kind === 'container' ? <section className="page-document-grid-editor is-inactive" aria-label="Grid 布局">
            <strong>Grid 布局</strong>
            <p>{inspection.reason}</p>
            {inspection.status === 'not-grid' && <Button size="sm" variant="outline" onClick={() => void apply(createGridConversionRequest(node.id, viewport), '转换为 Grid 布局')}>转换为 Grid</Button>}
            {error && <p role="alert">{error}</p>}
        </section> : null
    }
    return <section className="page-document-grid-editor" aria-label="Grid 布局">
        <header>
            <strong>Grid 详细设置</strong>
            <span>{viewport === 'desktop' ? '桌面覆盖' : '移动基础'}</span>
        </header>
        {node.id === container.id ? <>
            <GridAxisEditor axis="columns" nodeId={container.id} viewport={viewport} model={inspection.columns} apply={apply}/>
            <GridAxisEditor axis="rows" nodeId={container.id} viewport={viewport} model={inspection.rows} apply={apply}/>
        </> : <GridItemEditor node={node} viewport={viewport} inspectComponent={inspectComponent} apply={apply}/>}
        {error && <p role="alert">{error}</p>}
    </section>
}
