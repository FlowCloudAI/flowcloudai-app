// 本组件按当前选中节点呈现上下文工具；结构化命令统一经 DocumentKernelDraftRuntime 写回。
import {Captions, ImagePlus, LayoutGrid, ListChecks, ListPlus, Palette, SlidersHorizontal} from 'lucide-react'
import {Select} from 'flowcloudai-ui'
import type {LayerProjectionNode} from '../../page-document/domain/layerProjection.ts'
import type {KernelComponentInspectionResult} from '../../page-document/application/documentKernelDraftRuntime.ts'
import {TABLE_MAX_COLUMN_COUNT, TABLE_MAX_ROW_COUNT, TABLE_MIN_COLUMN_COUNT, TABLE_MIN_ROW_COUNT} from '../../page-document/domain/contract.ts'
import {
    createDividerLineStyleRequest,
    createDividerSpacingRequest,
    createListTypeRequest,
    createTableResizeRequest,
    readTableDimensions,
} from '../../page-document/application/structuredContentEditing.ts'
import {ContainerLayoutRibbonControls, type ApplyKernelEntry, type ContainerLayoutContext, type InspectComponent} from './ContainerLayoutRibbonControls.tsx'
import {DocumentRibbonCommand, DocumentRibbonGroup} from './DocumentOfficeRibbon.tsx'

export type LocalAssetFeedback = string | null
export type VisualInspectorTab = 'content' | 'layout' | 'appearance'
export type VisualInspectorSection = string
export type EntrySourceSnapshot = unknown

function inspectedValue(result: KernelComponentInspectionResult, property: string): string {
    if (result.status !== 'ready') return ''
    const inspection = result.inspection.properties[property]
    return inspection?.effectiveValue?.resolvedValue ?? inspection?.effectiveValue?.rawValue ?? ''
}

function TableStructureControls({
    node,
    inspectComponent,
    applyKernelEntry,
}: {
    node: LayerProjectionNode
    inspectComponent: InspectComponent
    applyKernelEntry: ApplyKernelEntry
}) {
    const dimensions = readTableDimensions(node.id, inspectComponent)
    const options = (minimum: number, maximum: number) =>
        Array.from({length: maximum - minimum + 1}, (_, index) => {
            const value = String(minimum + index)
            return {value, label: value}
        })
    const resize = (rowCount: number, columnCount: number) => {
        if (!dimensions || (rowCount === dimensions.rowCount && columnCount === dimensions.columnCount)) return
        const newIds = Array.from(
            {length: Math.max(0, (Math.min(rowCount, dimensions.rowCount) * Math.max(0, columnCount - dimensions.columnCount)) + Math.max(0, rowCount - dimensions.rowCount) * columnCount)},
            () => crypto.randomUUID(),
        )
        void applyKernelEntry(
            createTableResizeRequest(node.id, dimensions, {rowCount, columnCount}, newIds),
            '调整表格行列',
        )
    }
    return <>
        <label className="document-ribbon-layout-choice">
            <span>行</span>
            <Select
                aria-label="表格行数"
                disabled={!dimensions}
                onValueChange={value => dimensions && resize(Number(value), dimensions.columnCount)}
                options={options(TABLE_MIN_ROW_COUNT, TABLE_MAX_ROW_COUNT)}
                value={String(dimensions?.rowCount ?? TABLE_MIN_ROW_COUNT)}
            />
        </label>
        <label className="document-ribbon-layout-choice">
            <span>列</span>
            <Select
                aria-label="表格列数"
                disabled={!dimensions}
                onValueChange={value => dimensions && resize(dimensions.rowCount, Number(value))}
                options={options(TABLE_MIN_COLUMN_COUNT, TABLE_MAX_COLUMN_COUNT)}
                value={String(dimensions?.columnCount ?? TABLE_MIN_COLUMN_COUNT)}
            />
        </label>
    </>
}

function ListStructureControls({
    node,
    parentListId,
    canAddListItem,
    applyKernelEntry,
    onAddListItem,
}: {
    node: LayerProjectionNode
    parentListId: string | null
    canAddListItem: boolean
    applyKernelEntry: ApplyKernelEntry
    onAddListItem?: (listId: string, afterNodeId: string | null) => void
}) {
    const list = node.kind === 'list' ? node : null
    const listId = list?.id ?? parentListId
    const currentTag = list?.tagName === 'ol' ? 'ol' : 'ul'
    const setTag = (tag: 'ul' | 'ol') => {
        if (!list || tag === currentTag) return
        void applyKernelEntry(createListTypeRequest(list.id, currentTag, tag), '切换列表类型')
    }
    const lastItem = list?.children.at(-1)?.id ?? null
    const add = () => {
        if (!listId || !onAddListItem) return
        onAddListItem(listId, node.kind === 'list-item' ? node.id : lastItem)
    }
    return <>
        {list && <>
            <DocumentRibbonCommand active={currentTag === 'ul'} icon={ListChecks} label="项目符号" onClick={() => setTag('ul')} />
            <DocumentRibbonCommand active={currentTag === 'ol'} icon={ListChecks} label="编号" onClick={() => setTag('ol')} />
        </>}
        <DocumentRibbonCommand disabled={!canAddListItem || !onAddListItem} icon={ListPlus} label="添加列表项" onClick={add} title="在列表末尾添加一项" />
    </>
}

function DividerStructureControls({
    node,
    inspectComponent,
    applyKernelEntry,
}: {
    node: LayerProjectionNode
    inspectComponent: InspectComponent
    applyKernelEntry: ApplyKernelEntry
}) {
    const result = inspectComponent({
        nodeId: node.id,
        properties: ['border-style', 'margin-block-start', 'margin-block-end'],
        context: {viewport: 'desktop', interactions: {hover: false, focusWithin: false}, direction: 'ltr', writingMode: 'horizontal-tb'},
    })
    const line = inspectedValue(result, 'border-style')
    const start = inspectedValue(result, 'margin-block-start')
    const spacing = start === '0.5rem' ? 'compact' : start === '2rem' ? 'wide' : start === '1rem' ? 'normal' : 'unset'
    return <>
        <Select
            aria-label="分隔线样式"
            onValueChange={value => void applyKernelEntry(createDividerLineStyleRequest(node.id, String(value) as 'unset' | 'solid' | 'dashed' | 'dotted'), '修改分隔线样式')}
            options={[{value: 'unset', label: '继承'}, {value: 'solid', label: '实线'}, {value: 'dashed', label: '虚线'}, {value: 'dotted', label: '点线'}]}
            value={line === 'solid' || line === 'dashed' || line === 'dotted' ? line : 'unset'}
        />
        <Select
            aria-label="分隔线上下留白"
            onValueChange={value => void applyKernelEntry(createDividerSpacingRequest(node.id, String(value) as 'unset' | 'compact' | 'normal' | 'wide'), '修改分隔线上下留白')}
            options={[{value: 'unset', label: '继承'}, {value: 'compact', label: '紧凑'}, {value: 'normal', label: '标准'}, {value: 'wide', label: '宽松'}]}
            value={spacing}
        />
    </>
}

export function ContextualRibbonControls({
    selected,
    tableNode,
    context,
    assetFeedback,
    onChooseLocalAsset,
    onOpenDetails,
    applyKernelEntry,
    inspectComponent,
    sourceVersion,
    canAddListItem = false,
    parentListId = null,
    onAddListItem,
}: {
    selected: LayerProjectionNode
    tableNode?: LayerProjectionNode | null
    snapshot?: EntrySourceSnapshot
    context: ContainerLayoutContext
    nonRootManagedCount?: number
    assetFeedback: LocalAssetFeedback
    applyKernelEntry: ApplyKernelEntry
    inspectComponent: InspectComponent
    sourceVersion: number
    onChooseLocalAsset: () => void
    canAddListItem?: boolean
    parentListId?: string | null
    onAddListItem?: (listId: string, afterNodeId: string | null) => void
    onOpenDetails: (tab: VisualInspectorTab, section?: VisualInspectorSection) => void
    activeTextRange?: unknown
}) {
    void assetFeedback
    if (selected.kind === 'asset') {
        return <>
            <DocumentRibbonGroup label="图片" priority="essential" wide>
                <DocumentRibbonCommand icon={ImagePlus} label="替换图片" onClick={onChooseLocalAsset} title="从项目资产库选择替换图片" />
            </DocumentRibbonGroup>
            <DocumentRibbonGroup label="辅助信息" priority="high">
                <DocumentRibbonCommand icon={Captions} label="替代文字" onClick={() => onOpenDetails('content', 'content')} />
                <DocumentRibbonCommand icon={ImagePlus} label="图注" onClick={() => onOpenDetails('content', 'content')} />
            </DocumentRibbonGroup>
            <DocumentRibbonGroup label="调整" priority="normal">
                <DocumentRibbonCommand icon={SlidersHorizontal} label="滤镜" onClick={() => onOpenDetails('appearance', 'appearance')} />
                <DocumentRibbonCommand icon={LayoutGrid} label="布局" onClick={() => onOpenDetails('layout', 'responsive-layout')} />
                <DocumentRibbonCommand icon={Palette} label="外观" onClick={() => onOpenDetails('appearance', 'appearance')} />
            </DocumentRibbonGroup>
        </>
    }
    if (selected.kind === 'container') {
        return <>
            <ContainerLayoutRibbonControls
                applyKernelEntry={applyKernelEntry}
                context={context}
                inspectComponent={inspectComponent}
                node={selected}
                onOpenArrangementDetails={() => onOpenDetails('layout', 'container-layout-preset')}
                onOpenGridDetails={() => onOpenDetails('layout', 'grid-layout')}
                onOpenSpacingDetails={() => onOpenDetails('layout', 'container-layout-spacing')}
                sourceVersion={sourceVersion}
            />
            <DocumentRibbonGroup label="容器外观" priority="low">
                <DocumentRibbonCommand icon={Palette} label="外观" onClick={() => onOpenDetails('appearance', 'appearance')} />
            </DocumentRibbonGroup>
        </>
    }
    if (selected.kind === 'table' || selected.kind === 'table-cell') {
        return <>
            <DocumentRibbonGroup label="行列" priority="essential" wide>
                {tableNode && <TableStructureControls applyKernelEntry={applyKernelEntry} inspectComponent={inspectComponent} node={tableNode} />}
            </DocumentRibbonGroup>
            <DocumentRibbonGroup label="单元格" priority="high">
                <DocumentRibbonCommand icon={Palette} label="外观" onClick={() => onOpenDetails('appearance', 'appearance')} />
            </DocumentRibbonGroup>
        </>
    }
    if (selected.kind === 'list' || selected.kind === 'list-item') {
        return <>
            <DocumentRibbonGroup label="列表" priority="essential" wide>
                <ListStructureControls applyKernelEntry={applyKernelEntry} canAddListItem={canAddListItem} node={selected} onAddListItem={onAddListItem} parentListId={parentListId} />
            </DocumentRibbonGroup>
            <DocumentRibbonGroup label="列表外观" priority="normal">
                <DocumentRibbonCommand icon={Palette} label="颜色" onClick={() => onOpenDetails('appearance', 'appearance')} />
            </DocumentRibbonGroup>
        </>
    }
    if (selected.kind === 'divider') {
        return <>
            <DocumentRibbonGroup label="分隔线" priority="essential" wide>
                <DividerStructureControls applyKernelEntry={applyKernelEntry} inspectComponent={inspectComponent} node={selected} />
            </DocumentRibbonGroup>
        </>
    }
    if (selected.kind === 'gallery') {
        return <DocumentRibbonGroup label="图库" priority="essential">
            <DocumentRibbonCommand disabled icon={LayoutGrid} label="布局" onClick={() => undefined} title="图库布局契约仍待移植" />
            <DocumentRibbonCommand disabled icon={Palette} label="外观" onClick={() => undefined} title="图库外观契约仍待移植" />
        </DocumentRibbonGroup>
    }
    return null
}
