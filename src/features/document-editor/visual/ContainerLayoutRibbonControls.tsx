// 本组件把当前内核已经支持的容器间距接入功能区；布局模式与对齐等待契约补齐。
import {AlignCenter, LayoutGrid, MoveHorizontal} from 'lucide-react'
import {Select} from 'flowcloudai-ui'
import type {LayerProjectionNode} from '../../page-document/domain/layerProjection.ts'
import type {KernelComponentInspectionRequest, KernelComponentInspectionResult, KernelDraftEditRequest} from '../../page-document/application/documentKernelDraftRuntime.ts'
import {DocumentRibbonCommand, DocumentRibbonGroup, DocumentRibbonRows} from './DocumentOfficeRibbon.tsx'
import {createContainerGapRequest} from './containerLayoutRibbonModel.ts'

export type ContainerLayoutContext = 'mobile' | 'desktop'
export type InspectComponent = (request: KernelComponentInspectionRequest) => KernelComponentInspectionResult
export type ApplyKernelEntry = (request: KernelDraftEditRequest, label: string) => Promise<boolean>

const GAP_OPTIONS = [
    {value: 'unset', label: '继承'},
    {value: '0px', label: '无'},
    {value: '0.5rem', label: '小'},
    {value: '1rem', label: '中'},
    {value: '1.5rem', label: '大'},
] as const

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
    void sourceVersion
    void inspectComponent
    const applyGap = (value: string) => {
        const request = createContainerGapRequest(node.id, value as 'unset' | '0px' | '0.5rem' | '1rem' | '1.5rem')
        void applyKernelEntry(request, '修改容器间距')
    }
    return <>
        <DocumentRibbonGroup
            disabledReason="布局模式与列数的安全写回契约尚未接入主仓。"
            detailsTitle="打开容器排列详细设置"
            label="排列"
            onOpenDetails={onOpenArrangementDetails}
            priority="essential"
            wide
        >
            <DocumentRibbonRows
                first={<DocumentRibbonCommand disabled icon={LayoutGrid} label="布局方式" onClick={() => undefined} title="布局模式契约尚未接入" />}
                second={<DocumentRibbonCommand disabled icon={MoveHorizontal} label="分栏数" onClick={() => undefined} title="分栏数契约尚未接入" />}
            />
        </DocumentRibbonGroup>
        <DocumentRibbonGroup label={`间距 · ${context === 'desktop' ? '桌面' : '移动'}`} onOpenDetails={onOpenSpacingDetails} priority="high" wide>
            <label className="document-ribbon-layout-choice">
                <MoveHorizontal aria-hidden="true" size={14} />
                <Select
                    aria-label="容器间距"
                    onValueChange={value => applyGap(String(value))}
                    options={[...GAP_OPTIONS]}
                    title="容器 gap"
                    value="unset"
                />
            </label>
        </DocumentRibbonGroup>
        <DocumentRibbonGroup
            disabledReason="align-items 的读写上下文尚未接入主仓。"
            label="对齐"
            onOpenDetails={onOpenGridDetails}
            priority="normal"
        >
            <DocumentRibbonCommand disabled icon={AlignCenter} label="容器对齐" onClick={() => undefined} title="对齐契约尚未接入" />
        </DocumentRibbonGroup>
    </>
}
