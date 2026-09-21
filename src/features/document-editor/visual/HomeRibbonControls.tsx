// 本组件把主仓已有的页面文档属性适配器接到 Office 功能区；不读取模型或直接改写源码。

import {AlignCenter, AlignJustify, AlignLeft, AlignRight, IndentDecrease, IndentIncrease, Trash2} from 'lucide-react'
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
    type VisualPropertyName,
    type VisualPropertyState,
} from '../../page-document/application/visualPropertyEditing.ts'
import type {LiveVisualScheduleOptions} from '../../page-document/application/liveVisualCommitScheduler.ts'
import type {CanvasTypingStyleProperty} from '../../page-document/application/canvasInputOperation.ts'
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
    typingStyles: Readonly<Partial<Record<CanvasTypingStyleProperty, string>>>
    styleContext: 'mobile' | 'desktop'
    onOpenDetails?: () => void
    onRemove?: () => void
    onTypingStyleChange: (property: CanvasTypingStyleProperty, value: string) => void
    onTypingStylesReset: (values: Readonly<Partial<Record<CanvasTypingStyleProperty, string>>>) => void
}

const LINE_HEIGHT_OPTIONS = Object.freeze([
    {value: '1.3', label: '紧凑'},
    {value: '1.6', label: '标准'},
    {value: '1.8', label: '宽松'},
    {value: '2', label: '舒展'},
])
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
    const lineHeight = stateFor(states, 'line-height')
    const current = propertyValue(alignment) || 'left'
    const canWrite = Boolean(alignment && !alignment.disabled)
    const indentValue = propertyValue(indent) || '0'
    const indentLevel = ribbonParagraphIndentLevel(indentValue)
    const indentReason = indent?.reason
        ?? (indentLevel === null ? '当前缩进是自定义值，请在详细设置中调整。' : null)
    const lineHeightValue = propertyValue(lineHeight)
    const selectedLineHeight = LINE_HEIGHT_OPTIONS.some(option => option.value === lineHeightValue)
        ? lineHeightValue
        : 'custom'
    const changeIndent = (direction: 'decrease' | 'increase') => {
        const next = ribbonParagraphIndentStep(indentValue, direction)
        if (!next) return
        void applyKernelEntry(
            createRibbonPropertyRequest(node.id, 'margin-inline-start', next, styleContext),
            direction === 'increase' ? '增加文本块缩进' : '减少文本块缩进',
            {immediate: true},
        )
    }
    return (
        <DocumentRibbonRows
            first={<div className="document-ribbon-alignment" role="group" aria-label="文本块对齐">
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
                <Select
                    aria-label="文本块行高"
                    disabled={Boolean(lineHeight?.disabled)}
                    onValueChange={value => {
                        const next = String(value)
                        if (next === 'custom') return
                        void applyKernelEntry(
                            createRibbonPropertyRequest(node.id, 'line-height', {
                                kind: 'numeric',
                                value: Number(next),
                                unit: '',
                                numberText: next,
                            }, styleContext),
                            '修改文本块行高',
                            {immediate: true},
                        )
                    }}
                    options={[
                        ...LINE_HEIGHT_OPTIONS,
                        {value: 'custom', label: lineHeightValue || '自定义'},
                    ]}
                    radius="sm"
                    title={lineHeight?.reason ?? '文本块行高'}
                    value={selectedLineHeight}
                />
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
    typingStyles,
    styleContext,
    onOpenDetails,
    onRemove,
    onTypingStyleChange,
    onTypingStylesReset,
}: HomeRibbonControlsProps) {
    const availability = homeRibbonGroupAvailability(selected)
    const states = selected?.managed
        ? inspectVisualProperties(selected, inspectComponent, '', styleContext)
        : []
    const editableText = Boolean(selected?.managed && ['paragraph', 'heading', 'list-item', 'table-cell'].includes(selected.kind))
    return (
        <>
            {selected && editableText ? <InlineRibbonStyleControls
                node={selected}
                blockStates={states}
                range={activeTextRange?.nodeId === selected.id ? activeTextRange : null}
                typingStyles={typingStyles}
                applyKernelEntry={applyKernelEntry}
                inspectTextRange={inspectTextRange}
                styleContext={styleContext}
                onOpenDetails={onOpenDetails}
                onTypingStyleChange={onTypingStyleChange}
                onTypingStylesReset={onTypingStylesReset}
            /> : <DocumentRibbonGroup
                disabledReason={availability.font ?? '先选择一个受管文字节点'}
                label="字体"
                priority={DOCUMENT_HOME_RIBBON_PRIORITIES.font}
                slot="font"
                wide
            ><RibbonUnavailable label="文字格式" reason={availability.font ?? '先选择一个受管文字节点'} /></DocumentRibbonGroup>}
            <DocumentRibbonGroup
                disabledReason={availability.paragraph}
                label="文本块"
                onOpenDetails={onOpenDetails}
                priority={DOCUMENT_HOME_RIBBON_PRIORITIES.paragraph}
                slot="paragraph"
                wide
            >
                {selected && editableText ? (
                    <ParagraphControls node={selected} states={states} applyKernelEntry={applyKernelEntry} styleContext={styleContext} />
                ) : (
                    <RibbonUnavailable label="文本块排版" reason={availability.paragraph ?? '当前节点不支持文本块命令'} />
                )}
            </DocumentRibbonGroup>
            {selected?.managed && selected.attributes['data-fc-editor-root'] === undefined && <DocumentRibbonGroup
                label="块操作"
                priority={DOCUMENT_HOME_RIBBON_PRIORITIES.block}
                slot="block"
            >
                <DocumentRibbonCommand
                    disabled={!onRemove}
                    icon={Trash2}
                    label="删除"
                    onClick={onRemove ?? (() => undefined)}
                    title={onRemove ? '删除选中的页面节点' : (availability.block ?? '当前节点不可删除')}
                />
            </DocumentRibbonGroup>}
        </>
    )
}
