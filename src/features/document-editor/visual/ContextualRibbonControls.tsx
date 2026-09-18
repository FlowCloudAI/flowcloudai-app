// 本组件按当前选中节点呈现上下文工具；资产替换和容器间距走主仓内核，其余组等待契约补齐。
import {Captions, ImagePlus, LayoutGrid, ListChecks, Palette, Rows3, Settings2, SlidersHorizontal, type LucideIcon} from 'lucide-react'
import type {LayerProjectionNode} from '../../page-document/domain/layerProjection.ts'
import {ContainerLayoutRibbonControls, type ApplyKernelEntry, type ContainerLayoutContext, type InspectComponent} from './ContainerLayoutRibbonControls.tsx'
import {DocumentRibbonCommand, DocumentRibbonGroup} from './DocumentOfficeRibbon.tsx'

export type LocalAssetFeedback = string | null
export type VisualInspectorTab = 'content' | 'layout' | 'appearance'
export type VisualInspectorSection = string
export type EntrySourceSnapshot = unknown

function UnsupportedContext({label, reason, icon: Icon, onOpenDetails}: {label: string; reason: string; icon: LucideIcon; onOpenDetails: () => void}) {
    return <DocumentRibbonGroup disabledReason={reason} label={label} priority="normal">
        <DocumentRibbonCommand disabled icon={Icon} label={label} onClick={() => undefined} title={reason} />
        <DocumentRibbonCommand icon={Settings2} label="详细设置" onClick={onOpenDetails} title={reason} />
    </DocumentRibbonGroup>
}

export function ContextualRibbonControls({
    selected,
    context,
    assetFeedback,
    onChooseLocalAsset,
    onOpenDetails,
    applyKernelEntry,
    inspectComponent,
    sourceVersion,
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
        return <UnsupportedContext icon={LayoutGrid} label="表格" onOpenDetails={() => onOpenDetails('layout', 'grid-layout')} reason="表格行列结构操作契约尚未接入主仓。" />
    }
    if (selected.kind === 'list' || selected.kind === 'list-item') {
        return <UnsupportedContext icon={ListChecks} label="列表" onOpenDetails={() => onOpenDetails('layout', 'responsive-layout')} reason="列表结构操作契约尚未接入主仓。" />
    }
    if (selected.kind === 'divider') {
        return <UnsupportedContext icon={Rows3} label="分隔线" onOpenDetails={() => onOpenDetails('appearance', 'appearance')} reason="分隔线样式契约尚未接入主仓。" />
    }
    if (selected.kind === 'gallery') {
        return <UnsupportedContext icon={LayoutGrid} label="图库" onOpenDetails={() => onOpenDetails('layout', 'responsive-layout')} reason="图库布局契约尚未接入主仓。" />
    }
    return null
}
