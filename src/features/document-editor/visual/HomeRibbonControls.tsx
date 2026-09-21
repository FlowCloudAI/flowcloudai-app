// 本组件把主仓已有的页面文档属性适配器接到 Office 功能区；不读取模型或直接改写源码。

import {AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Eraser, IndentDecrease, IndentIncrease, Search, Trash2} from 'lucide-react'
import {Select} from 'flowcloudai-ui'
import type {LayerProjectionNode} from '../../page-document/domain/layerProjection.ts'
import type {
    KernelComponentInspectionRequest,
    KernelComponentInspectionResult,
    KernelDraftEditRequest,
    KernelTextRangeInspectionRequest,
    KernelTextRangeInspectionResult,
} from '../../page-document/application/documentKernelDraftRuntime.ts'
import {
    inspectVisualProperties,
    type VisualPropertyEditValue,
    type VisualPropertyName,
    type VisualPropertyState,
} from '../../page-document/application/visualPropertyEditing.ts'
import type {LiveVisualScheduleOptions} from '../../page-document/application/liveVisualCommitScheduler.ts'
import {
    DOCUMENT_HOME_RIBBON_PRIORITIES,
    homeRibbonGroupAvailability,
} from './documentRibbonModel.ts'
import {
    DocumentRibbonCommand,
    DocumentRibbonGroup,
    DocumentRibbonRows,
} from './DocumentOfficeRibbon.tsx'
import {
    createRibbonPropertyRequest,
    ribbonParagraphIndentLevel,
    ribbonParagraphIndentStep,
} from './ribbonKernelBinding.ts'
import type {RibbonTextRange} from './ribbonKernelBinding.ts'
import {InlineRibbonStyleControls} from './InlineRibbonStyleControls.tsx'
import {ColorPropertyControl} from '../../page-document/components/properties/ColorPropertyControl.tsx'

export type RibbonApplyKernelEntry = (
    request: KernelDraftEditRequest,
    label: string,
    options?: LiveVisualScheduleOptions,
) => Promise<boolean>

export type RibbonInspectComponent = (
    request: KernelComponentInspectionRequest,
) => KernelComponentInspectionResult

export type RibbonInspectTextRange = (
    request: KernelTextRangeInspectionRequest,
) => KernelTextRangeInspectionResult

export interface HomeRibbonControlsProps {
    selected: LayerProjectionNode | null
    applyKernelEntry: RibbonApplyKernelEntry
    inspectComponent: RibbonInspectComponent
    inspectTextRange: RibbonInspectTextRange
    activeTextRange: RibbonTextRange | null
    styleContext: 'mobile' | 'desktop'
    onFind?: () => void
    onOpenDetails?: () => void
    onRemove?: () => void
}

const FONT_SIZE_OPTIONS = ['12px', '14px', '16px', '18px', '20px', '24px', '32px'] as const
const ALIGNMENT_OPTIONS = [
    {value: 'left', label: '左对齐', icon: AlignLeft},
    {value: 'center', label: '居中', icon: AlignCenter},
    {value: 'right', label: '右对齐', icon: AlignRight},
    {value: 'justify', label: '两端对齐', icon: AlignJustify},
] as const

function stateFor(
    states: readonly VisualPropertyState[],
    property: VisualPropertyName,
): VisualPropertyState | null {
    return states.find(item => item.property === property) ?? null
}

function propertyValue(state: VisualPropertyState | null): string {
    return (state?.localValue ?? state?.value ?? '').trim()
}

function RibbonUnavailable({label, reason}: {label: string; reason: string}) {
    return (
        <button aria-label={`${label}：${reason}`} className="document-ribbon-unavailable" disabled title={reason} type="button">
            {label}
        </button>
    )
}

function FontControls({
    node,
    states,
    applyKernelEntry,
    styleContext,
}: {
    node: LayerProjectionNode
    states: readonly VisualPropertyState[]
    applyKernelEntry: RibbonApplyKernelEntry
    styleContext: 'mobile' | 'desktop'
}) {
    const size = stateFor(states, 'font-size')
    const weight = stateFor(states, 'font-weight')
    const color = stateFor(states, 'color')
    const backgroundColor = stateFor(states, 'background-color')
    const sizeValue = propertyValue(size)
    const selectedSize = FONT_SIZE_OPTIONS.includes(sizeValue as (typeof FONT_SIZE_OPTIONS)[number])
        ? sizeValue
        : 'current'
    const weightValue = propertyValue(weight)
    const canWrite = Boolean(size && !size.disabled)
    const canWeight = Boolean(weight && !weight.disabled)
    const apply = (property: VisualPropertyName, value: VisualPropertyEditValue, label: string) => {
        return applyKernelEntry(createRibbonPropertyRequest(node.id, property, value, styleContext), label, {immediate: true})
    }
    return (
        <DocumentRibbonRows
            first={
                <>
                    <Select
                        aria-label="整段字号"
                        disabled={!canWrite}
                        onValueChange={value => {
                            const next = String(value)
                            if (next === 'current') return
                            void apply(
                                'font-size',
                                next === 'unset'
                                    ? {kind: 'clear-override'}
                                    : {kind: 'numeric', value: Number(next.slice(0, -2)), unit: 'px', numberText: next.slice(0, -2)},
                                '修改整段字号',
                            )
                        }}
                        options={[
                            {value: 'current', label: selectedSize === 'current' ? '当前字号' : sizeValue},
                            ...FONT_SIZE_OPTIONS.map(value => ({value, label: value.slice(0, -2)})),
                        ]}
                        radius="sm"
                        title={size?.reason ?? '整段字号'}
                        value={selectedSize}
                    />
                    <div className="document-ribbon-font-weight" role="group" aria-label="整段字重">
                        <button
                            aria-label="加粗"
                            aria-pressed={weightValue === '700'}
                            disabled={!canWeight}
                            onClick={() => void apply('font-weight', {kind: 'font-weight', value: weightValue === '700' ? '400' : '700'}, '切换整段加粗')}
                            title={weight?.reason ?? '切换整段加粗'}
                            type="button"
                        >
                            <Bold size={15} />
                        </button>
                    </div>
                    <button
                        aria-label="清除"
                        disabled={!canWrite || size?.localValue === null}
                        onClick={() => void apply('font-size', {kind: 'clear-override'}, '清除整段字号')}
                        title={size?.clearTitle ?? '清除后恢复默认字号。'}
                        type="button"
                    >
                        <Eraser size={14} />
                    </button>
                </>
            }
            second={<>
                {color && <div className="document-ribbon-node-color">
                    <span>节点文字</span>
                    <ColorPropertyControl
                        embedded
                        field={color}
                        onChange={(value, options) => applyKernelEntry(
                            createRibbonPropertyRequest(node.id, 'color', value, styleContext),
                            '修改节点文字颜色',
                            options,
                        )}
                    />
                </div>}
                {backgroundColor && <div className="document-ribbon-node-color">
                    <span>节点底色</span>
                    <ColorPropertyControl
                        embedded
                        field={backgroundColor}
                        onChange={(value, options) => applyKernelEntry(
                            createRibbonPropertyRequest(node.id, 'background-color', value, styleContext),
                            '修改节点背景颜色',
                            options,
                        )}
                    />
                </div>}
            </>}
        />
    )
}

function ParagraphControls({
    node,
    states,
    applyKernelEntry,
    styleContext,
}: {
    node: LayerProjectionNode
    states: readonly VisualPropertyState[]
    applyKernelEntry: RibbonApplyKernelEntry
    styleContext: 'mobile' | 'desktop'
}) {
    const alignment = stateFor(states, 'text-align')
    const indent = stateFor(states, 'margin-inline-start')
    const current = propertyValue(alignment) || 'left'
    const canWrite = Boolean(alignment && !alignment.disabled)
    const indentValue = propertyValue(indent) || '0'
    const indentLevel = ribbonParagraphIndentLevel(indentValue)
    const indentReason = indent?.reason
        ?? (indentLevel === null ? '当前缩进是自定义值，请在详细设置中调整。' : null)
    const changeIndent = (direction: 'decrease' | 'increase') => {
        const next = ribbonParagraphIndentStep(indentValue, direction)
        if (!next) return
        void applyKernelEntry(
            createRibbonPropertyRequest(node.id, 'margin-inline-start', next, styleContext),
            direction === 'increase' ? '增加段落缩进' : '减少段落缩进',
            {immediate: true},
        )
    }
    return (
        <DocumentRibbonRows
            first={<div className="document-ribbon-alignment" role="group" aria-label="段落对齐">
                {ALIGNMENT_OPTIONS.map(option => {
                    const Icon = option.icon
                    return (
                        <button
                            aria-label={option.label}
                            aria-pressed={current === option.value}
                            disabled={!canWrite}
                            key={option.value}
                            onClick={() => void applyKernelEntry(
                                createRibbonPropertyRequest(node.id, 'text-align', {kind: 'choice', value: option.value}, styleContext),
                                `修改${option.label}`,
                                {immediate: true},
                            )}
                            title={alignment?.reason ?? option.label}
                            type="button"
                        >
                            <Icon size={14} />
                        </button>
                    )
                })}
            </div>}
            second={<>
                <DocumentRibbonCommand
                    ariaLabel={indentReason || indentLevel === 0 ? `减少缩进：${indentReason ?? '已到最小缩进'}` : '减少缩进'}
                    disabled={Boolean(indentReason) || indentLevel === 0}
                    icon={IndentDecrease}
                    label="减少缩进"
                    onClick={() => changeIndent('decrease')}
                    title={indentReason ?? (indentLevel === 0 ? '已到最小缩进' : '减少缩进')}
                />
                <DocumentRibbonCommand
                    ariaLabel={indentReason || indentLevel === 3 ? `增加缩进：${indentReason ?? '已到最大缩进'}` : '增加缩进'}
                    disabled={Boolean(indentReason) || indentLevel === 3}
                    icon={IndentIncrease}
                    label="增加缩进"
                    onClick={() => changeIndent('increase')}
                    title={indentReason ?? (indentLevel === 3 ? '已到最大缩进' : '增加缩进')}
                />
            </>}
        />
    )
}

export function HomeRibbonControls({
    selected,
    applyKernelEntry,
    inspectComponent,
    inspectTextRange,
    activeTextRange,
    styleContext,
    onFind,
    onOpenDetails,
    onRemove,
}: HomeRibbonControlsProps) {
    const availability = homeRibbonGroupAvailability(selected)
    const states = selected?.managed
        ? inspectVisualProperties(selected, inspectComponent, '', styleContext)
        : []
    const editableText = Boolean(selected?.managed && ['paragraph', 'heading', 'list-item', 'table-cell'].includes(selected.kind))
    const groupReason = availability.font ?? '先选择一个受管文字节点'
    return (
        <>
            <DocumentRibbonGroup
                disabledReason={availability.font}
                label="字体"
                onOpenDetails={onOpenDetails}
                priority={DOCUMENT_HOME_RIBBON_PRIORITIES.font}
                slot="font"
                wide
            >
                {selected && editableText ? (
                    <FontControls node={selected} states={states} applyKernelEntry={applyKernelEntry} styleContext={styleContext} />
                ) : (
                    <RibbonUnavailable label="整段文字" reason={groupReason} />
                )}
            </DocumentRibbonGroup>
            <DocumentRibbonGroup
                disabledReason={availability.paragraph}
                label="段落"
                onOpenDetails={onOpenDetails}
                priority={DOCUMENT_HOME_RIBBON_PRIORITIES.paragraph}
                slot="paragraph"
                wide
            >
                {selected && editableText ? (
                    <ParagraphControls node={selected} states={states} applyKernelEntry={applyKernelEntry} styleContext={styleContext} />
                ) : (
                    <RibbonUnavailable label="段落对齐" reason={availability.paragraph ?? '当前节点不支持段落命令'} />
                )}
            </DocumentRibbonGroup>
            <DocumentRibbonGroup label="编辑" priority={DOCUMENT_HOME_RIBBON_PRIORITIES.edit} slot="edit">
                <DocumentRibbonCommand
                    disabled={!onFind}
                    icon={Search}
                    label="查找"
                    onClick={onFind ?? (() => undefined)}
                    size="large"
                    title="查找功能将在后续工具栏批次接入"
                />
            </DocumentRibbonGroup>
            {selected?.managed && selected.attributes['data-fc-editor-root'] === undefined && <DocumentRibbonGroup
                label="块操作"
                priority={DOCUMENT_HOME_RIBBON_PRIORITIES.block}
                slot="block"
            >
                <DocumentRibbonCommand
                    danger
                    disabled={!onRemove}
                    icon={Trash2}
                    label="删除"
                    onClick={onRemove ?? (() => undefined)}
                    title={onRemove ? '删除选中的页面节点' : (availability.block ?? '当前节点不可删除')}
                />
            </DocumentRibbonGroup>}
            <InlineRibbonStyleControls
                range={activeTextRange}
                applyKernelEntry={applyKernelEntry}
                inspectTextRange={inspectTextRange}
                styleContext={styleContext}
            />
        </>
    )
}
