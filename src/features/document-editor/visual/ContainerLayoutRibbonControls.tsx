// 本组件把受控的容器布局字段接入功能区；读写均经 DocumentKernelDraftRuntime，不直接改写作者源码。
import {AlignCenter, LayoutGrid, MoveHorizontal} from 'lucide-react'
import {useState} from 'react'
import {Select} from 'flowcloudai-ui'
import type {LayerProjectionNode} from '../../page-document/domain/layerProjection.ts'
import type {
    KernelComponentInspectionRequest,
    KernelComponentInspectionResult,
    KernelDraftEditRequest,
} from '../../page-document/application/documentKernelDraftRuntime.ts'
import {DocumentRibbonGroup, DocumentRibbonRows} from './DocumentOfficeRibbon.tsx'
import {
    createContainerAlignRequest,
    createContainerColumnsRequest,
    createContainerGapRequest,
    createContainerJustifyRequest,
    createContainerLayoutRequest,
    type ContainerAlignPreset,
    type ContainerColumnPreset,
    type ContainerJustifyPreset,
    type ContainerLayoutMode,
} from './containerLayoutRibbonModel.ts'

export type ContainerLayoutContext = 'mobile' | 'desktop'
export type InspectComponent = (
    request: KernelComponentInspectionRequest,
) => KernelComponentInspectionResult
export type ApplyKernelEntry = (request: KernelDraftEditRequest, label: string) => Promise<boolean>

const LAYOUT_OPTIONS = [
    {value: 'unset', label: '继承'},
    {value: 'block', label: '普通块'},
    {value: 'flow-root', label: '独立文档流'},
    {value: 'grid', label: '网格'},
    {value: 'flex', label: '横向换行'},
] as const

const COLUMN_OPTIONS = [
    {value: 'unset', label: '继承'},
    {value: 'one', label: '单栏'},
    {value: 'two', label: '双栏'},
    {value: 'three', label: '三栏'},
] as const

const GAP_OPTIONS = [
    {value: 'unset', label: '继承'},
    {value: '0px', label: '无'},
    {value: '0.5rem', label: '小'},
    {value: '1rem', label: '中'},
    {value: '1.5rem', label: '大'},
] as const

const ALIGN_OPTIONS = [
    {value: 'unset', label: '继承'},
    {value: 'stretch', label: '拉伸'},
    {value: 'start', label: '顶部'},
    {value: 'center', label: '居中'},
    {value: 'end', label: '底部'},
] as const

const JUSTIFY_OPTIONS = [
    {value: 'unset', label: '继承'},
    {value: 'start', label: '起始'},
    {value: 'center', label: '居中'},
    {value: 'end', label: '末尾'},
    {value: 'space-between', label: '两端分布'},
] as const

const INSPECT_CONTEXT = Object.freeze({
    interactions: Object.freeze({hover: false, focusWithin: false}),
    direction: 'ltr' as const,
    writingMode: 'horizontal-tb' as const,
})

type LayoutProperty = 'display' | 'grid-template-columns' | 'gap' | 'align-items' | 'justify-content'

function effectiveValue(
    result: KernelComponentInspectionResult,
    property: LayoutProperty,
): string {
    if (result.status !== 'ready') return ''
    const inspection = result.inspection.properties[property]
    return inspection?.effectiveValue?.resolvedValue ?? inspection?.effectiveValue?.rawValue ?? ''
}

function canWrite(result: KernelComponentInspectionResult, property: LayoutProperty): boolean {
    if (result.status !== 'ready') return false
    const inspection = result.inspection.properties[property]
    return Boolean(
        inspection &&
            inspection.applicability.kind === 'applicable' &&
            inspection.confidence.kind === 'proven' &&
            inspection.writeDestinations.some(
                destination => destination.scope === 'entry' && destination.channel.kind === 'base-rule',
            ),
    )
}

function normalized(raw: string): string {
    return raw.trim().toLowerCase().replace(/\s+/gu, ' ')
}

function layoutMode(raw: string): ContainerLayoutMode | 'custom' {
    const value = normalized(raw)
    if (value === '') return 'unset'
    if (value === 'flow-root' || value === 'block' || value === 'grid' || value === 'flex') return value
    return 'custom'
}

function columnPreset(raw: string): ContainerColumnPreset | 'custom' {
    const value = normalized(raw).replace(/\s+/gu, '')
    if (value === '') return 'unset'
    if (value === 'minmax(0,1fr)') return 'one'
    if (value === 'repeat(2,minmax(0,1fr))' || value === 'minmax(0,1fr)minmax(0,1fr)') return 'two'
    if (value === 'repeat(3,minmax(0,1fr))' || value === 'minmax(0,1fr)minmax(0,1fr)minmax(0,1fr)') return 'three'
    return 'custom'
}

function alignPreset(raw: string): ContainerAlignPreset | 'custom' {
    const value = normalized(raw)
    if (value === '') return 'unset'
    if (value === 'flex-start') return 'start'
    if (value === 'flex-end') return 'end'
    if (value === 'stretch' || value === 'start' || value === 'center' || value === 'end') return value
    return 'custom'
}

function justifyPreset(raw: string): ContainerJustifyPreset | 'custom' {
    const value = normalized(raw)
    if (value === '') return 'unset'
    if (value === 'flex-start') return 'start'
    if (value === 'flex-end') return 'end'
    if (value === 'start' || value === 'center' || value === 'end' || value === 'space-between') return value
    return 'custom'
}

export function ContainerLayoutRibbonControls({
    node,
    context,
    sourceVersion,
    applyKernelEntry,
    inspectComponent,
    onOpenArrangementDetails,
    onOpenGridDetails,
    onOpenSpacingDetails,
}: {
    node: LayerProjectionNode
    context: ContainerLayoutContext
    sourceVersion: number
    applyKernelEntry: ApplyKernelEntry
    inspectComponent: InspectComponent
    onOpenArrangementDetails: () => void
    onOpenGridDetails: () => void
    onOpenSpacingDetails: () => void
}) {
    const [feedback, setFeedback] = useState<string | null>(null)
    void sourceVersion
    const inspection = inspectComponent({
        nodeId: node.id,
        properties: ['display', 'grid-template-columns', 'gap', 'align-items', 'justify-content'],
        context: Object.freeze({...INSPECT_CONTEXT, viewport: context}),
    })
    const mode = layoutMode(effectiveValue(inspection, 'display'))
    const columns = columnPreset(effectiveValue(inspection, 'grid-template-columns'))
    const align = alignPreset(effectiveValue(inspection, 'align-items'))
    const justify = justifyPreset(effectiveValue(inspection, 'justify-content'))
    const gapValue = effectiveValue(inspection, 'gap')
    const gapOption = GAP_OPTIONS.some(option => option.value === gapValue) ? gapValue : 'unset'
    const modeDisabled = !canWrite(inspection, 'display')
    const columnsDisabled = !canWrite(inspection, 'grid-template-columns')
    const alignDisabled = !canWrite(inspection, 'align-items')
    const justifyDisabled = !canWrite(inspection, 'justify-content')
    const run = async (request: KernelDraftEditRequest, label: string) => {
        const applied = await applyKernelEntry(request, label)
        setFeedback(applied ? null : `${label}未应用。`)
    }
    const customOption = (value: string, label: string) => ({value, label, disabled: true})

    return <>
        <DocumentRibbonGroup
            disabledReason={feedback}
            detailsTitle="打开容器排列详细设置"
            label="排列"
            onOpenDetails={onOpenArrangementDetails}
            priority="essential"
            wide
        >
            <DocumentRibbonRows
                first={<label className="document-ribbon-layout-choice">
                    <LayoutGrid aria-hidden="true" size={14} />
                    <Select
                        aria-label="布局方式"
                        disabled={modeDisabled}
                        onValueChange={value => {
                            if (value === 'custom') return
                            void run(createContainerLayoutRequest(node.id, String(value) as ContainerLayoutMode, context), '切换容器布局方式')
                        }}
                        options={[
                            ...(mode === 'custom' ? [customOption('custom', '自定义')] : []),
                            ...LAYOUT_OPTIONS,
                        ]}
                        title={modeDisabled ? '当前布局方式不可安全写回' : '布局方式'}
                        value={mode}
                    />
                </label>}
                second={<label className="document-ribbon-layout-choice">
                    <LayoutGrid aria-hidden="true" size={14} />
                    <Select
                        aria-label="分栏数"
                        disabled={columnsDisabled}
                        onValueChange={value => {
                            if (value === 'custom') return
                            void run(createContainerColumnsRequest(node.id, String(value) as ContainerColumnPreset, context), '修改容器分栏数')
                        }}
                        options={[
                            ...(columns === 'custom' ? [customOption('custom', '自定义')] : []),
                            ...COLUMN_OPTIONS,
                        ]}
                        title={columnsDisabled ? '当前分栏值不可安全写回' : '分栏数'}
                        value={columns}
                    />
                </label>}
            />
        </DocumentRibbonGroup>
        <DocumentRibbonGroup label={`间距与对齐 · ${context === 'desktop' ? '桌面' : '移动'}`} onOpenDetails={onOpenSpacingDetails} priority="high" wide>
            <DocumentRibbonRows
                first={<label className="document-ribbon-layout-choice">
                    <MoveHorizontal aria-hidden="true" size={14} />
                    <Select
                        aria-label="容器间距"
                        onValueChange={value => void run(createContainerGapRequest(node.id, String(value) as 'unset' | '0px' | '0.5rem' | '1rem' | '1.5rem', context), '修改容器间距')}
                        options={[...GAP_OPTIONS]}
                        title="容器间距"
                        value={gapOption}
                    />
                </label>}
                second={<label className="document-ribbon-layout-choice">
                    <AlignCenter aria-hidden="true" size={14} />
                    <Select
                        aria-label="纵向对齐"
                        disabled={alignDisabled}
                        onValueChange={value => {
                            if (value === 'custom') return
                            void run(createContainerAlignRequest(node.id, String(value) as ContainerAlignPreset, context), '修改容器纵向对齐')
                        }}
                        options={[
                            ...(align === 'custom' ? [customOption('custom', '自定义')] : []),
                            ...ALIGN_OPTIONS,
                        ]}
                        title={alignDisabled ? '当前纵向对齐不可安全写回' : '纵向对齐'}
                        value={align}
                    />
                </label>}
            />
            <label className="document-ribbon-layout-choice">
                <AlignCenter aria-hidden="true" size={14} />
                <Select
                    aria-label="横向分布"
                    disabled={justifyDisabled}
                    onValueChange={value => {
                        if (value === 'custom') return
                        void run(createContainerJustifyRequest(node.id, String(value) as ContainerJustifyPreset, context), '修改容器横向分布')
                    }}
                    options={[
                        ...(justify === 'custom' ? [customOption('custom', '自定义')] : []),
                        ...JUSTIFY_OPTIONS,
                    ]}
                    title={justifyDisabled ? '当前横向分布不可安全写回' : '横向分布'}
                    value={justify}
                />
            </label>
        </DocumentRibbonGroup>
        <DocumentRibbonGroup label="详细布局" onOpenDetails={onOpenGridDetails} priority="normal">
            <button className="document-ribbon-unavailable" disabled type="button">
                当前布局的精确轨道请在详细设置中调整
            </button>
        </DocumentRibbonGroup>
    </>
}
