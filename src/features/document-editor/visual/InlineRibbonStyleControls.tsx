// 本组件让可信文字选区与光标待输入格式共用一套字体控件；文本块基础格式只由组启动器进入属性 Dock。

import {Baseline, Bold, Eraser, Highlighter, Italic, Strikethrough, Underline} from 'lucide-react'
import {Select} from 'flowcloudai-ui'
import type {KernelTextRangeInspectionRequest} from '../../page-document/application/documentKernelDraftRuntime.ts'
import {
    serializeVisualPropertyValue,
    type VisualPropertyName,
    type VisualPropertyState,
} from '../../page-document/application/visualPropertyEditing.ts'
import type {CanvasTypingStyleProperty} from '../../page-document/application/canvasInputOperation.ts'
import type {LayerProjectionNode} from '../../page-document/domain/layerProjection.ts'
import {ColorPropertyControl} from '../../page-document/components/properties/ColorPropertyControl.tsx'
import type {RibbonApplyKernelEntry, RibbonInspectTextRange} from './HomeRibbonControls.tsx'
import {DocumentRibbonCommand, DocumentRibbonGroup, DocumentRibbonRows} from './DocumentOfficeRibbon.tsx'
import {
    createRibbonTextRangePropertyRequest,
    resolveRibbonFontScope,
    ribbonCaretInspectionRange,
    toggleRibbonTextDecoration,
    type RibbonFontScope,
    type RibbonInlineProperty,
    type RibbonTextRange,
} from './ribbonKernelBinding.ts'

export interface InlineRibbonStyleControlsProps {
    readonly node: LayerProjectionNode
    readonly blockStates: readonly VisualPropertyState[]
    readonly range: RibbonTextRange | null
    readonly typingStyles: Readonly<Partial<Record<CanvasTypingStyleProperty, string>>>
    readonly applyKernelEntry: RibbonApplyKernelEntry
    readonly inspectTextRange: RibbonInspectTextRange
    readonly styleContext: 'mobile' | 'desktop'
    readonly onOpenDetails?: () => void
    readonly onTypingStyleChange: (property: CanvasTypingStyleProperty, value: string) => void
    readonly onTypingStylesReset: (values: Readonly<Partial<Record<CanvasTypingStyleProperty, string>>>) => void
}

const PROPERTIES = Object.freeze([
    'background-color',
    'color',
    'font-size',
    'font-style',
    'font-weight',
    'text-decoration-line',
] satisfies readonly RibbonInlineProperty[])

const FONT_SIZE_OPTIONS = Object.freeze([
    {value: '12px', label: '12'},
    {value: '14px', label: '14'},
    {value: '16px', label: '16'},
    {value: '18px', label: '18'},
    {value: '20px', label: '20'},
    {value: '24px', label: '24'},
    {value: '32px', label: '32'},
])

function stateFor(
    states: readonly VisualPropertyState[],
    property: VisualPropertyName,
): VisualPropertyState | null {
    return states.find(item => item.property === property) ?? null
}

function blockValue(states: readonly VisualPropertyState[], property: VisualPropertyName): string {
    const state = stateFor(states, property)
    return (state?.localValue ?? state?.value ?? '').trim()
}

function inspect(
    range: RibbonTextRange,
    inspectTextRange: RibbonInspectTextRange,
    styleContext: 'mobile' | 'desktop',
) {
    const request: KernelTextRangeInspectionRequest = {
        ...range,
        properties: PROPERTIES,
        context: {
            viewport: styleContext,
            interactions: {hover: false, focusWithin: false},
            direction: 'ltr',
            writingMode: 'horizontal-tb',
        },
    }
    return inspectTextRange(request)
}

function uniformValue(
    inspection: ReturnType<RibbonInspectTextRange> | null,
    property: RibbonInlineProperty,
): string | null {
    if (inspection?.status !== 'ready') return null
    const state = inspection.inspection.properties[property]?.valueState
    return state?.kind === 'uniform' ? state.value : null
}

function isMixedValue(
    inspection: ReturnType<RibbonInspectTextRange> | null,
    property: RibbonInlineProperty,
): boolean {
    if (inspection?.status !== 'ready') return false
    return inspection.inspection.properties[property]?.valueState.kind === 'mixed'
}

function hasManagedOverride(
    inspection: ReturnType<RibbonInspectTextRange> | null,
    property: RibbonInlineProperty,
): boolean {
    if (inspection?.status !== 'ready') return false
    const segments = inspection.inspection.properties[property]?.segments ?? []
    return segments.length > 0 && segments.every(segment => segment.managedOverride)
}

function colorField(
    states: readonly VisualPropertyState[],
    inspection: ReturnType<RibbonInspectTextRange> | null,
    typingStyles: Readonly<Partial<Record<CanvasTypingStyleProperty, string>>>,
    property: 'color' | 'background-color',
    scope: RibbonFontScope,
): VisualPropertyState {
    const block = stateFor(states, property)
    if (scope === 'inactive' && block) {
        return Object.freeze({
            ...block,
            disabled: true,
            reason: '在画布中放置光标或选择文字后可用。',
        })
    }
    const pending = scope === 'typing' ? typingStyles[property] : undefined
    const inspected = uniformValue(inspection, property)
    const value = pending ?? inspected ?? block?.value ?? (property === 'color' ? 'currentcolor' : 'transparent')
    const mixed = isMixedValue(inspection, property)
    const localValue = scope === 'typing'
        ? pending ?? inspected
        : hasManagedOverride(inspection, property) ? inspected : null
    return Object.freeze({
        property,
        label: property === 'color' ? '文字颜色' : '文字底色',
        group: 'appearance',
        value,
        localValue,
        sourceState: mixed ? 'mixed' : pending ? 'local' : 'inherited',
        statusText: mixed ? '多种值' : scope === 'typing' ? '后续输入' : '选区',
        clearTitle: scope === 'typing' ? '恢复文本块基础颜色' : '清除局部颜色',
        disabled: false,
        reason: null,
    })
}

function scopeLabel(scope: RibbonFontScope): string {
    if (scope === 'selection') return '字体 · 选区'
    if (scope === 'typing') return '字体 · 后续输入'
    return '字体'
}

export function InlineRibbonStyleControls({
    node,
    blockStates,
    range,
    typingStyles,
    applyKernelEntry,
    inspectTextRange,
    styleContext,
    onOpenDetails,
    onTypingStyleChange,
    onTypingStylesReset,
}: InlineRibbonStyleControlsProps) {
    const scope = resolveRibbonFontScope(range)
    const inspectionRange = range
        ? range.to > range.from ? range : ribbonCaretInspectionRange(range, node.textContent)
        : null
    const inspection = inspectionRange ? inspect(inspectionRange, inspectTextRange, styleContext) : null
    const rangeReady = scope === 'typing' && node.textContent.length === 0
        ? range?.from === 0 && range.to === 0
        : scope !== 'inactive' && inspection?.status === 'ready'
    const inlineValue = (property: RibbonInlineProperty): string | null => {
        const pending = scope === 'typing' ? typingStyles[property] : undefined
        return pending ?? uniformValue(inspection, property)
    }
    const effectiveValue = (property: RibbonInlineProperty): string => {
        return inlineValue(property) ?? blockValue(blockStates, property as VisualPropertyName)
    }
    const mixed = (property: RibbonInlineProperty): boolean =>
        scope === 'selection' && isMixedValue(inspection, property)

    const applyInline = (property: RibbonInlineProperty, value: string | null, label: string) => {
        if (!range || scope !== 'selection' || !rangeReady) return Promise.resolve(false)
        return applyKernelEntry(
            createRibbonTextRangePropertyRequest(range, property, value, styleContext),
            label,
            {immediate: true},
        )
    }
    const applyValue = (
        property: CanvasTypingStyleProperty,
        inline: string,
        label: string,
    ) => {
        if (scope === 'selection') return applyInline(property, inline, label)
        if (scope === 'typing') {
            onTypingStyleChange(property, inline)
            return Promise.resolve(true)
        }
        return Promise.resolve(false)
    }

    const size = effectiveValue('font-size')
    const sizeMixed = mixed('font-size')
    const selectedSize = sizeMixed
        ? 'mixed'
        : FONT_SIZE_OPTIONS.some(option => option.value === size) ? size : 'current'
    const weight = effectiveValue('font-weight')
    const style = effectiveValue('font-style')
    const decoration = effectiveValue('text-decoration-line')
    const textColor = colorField(blockStates, inspection, typingStyles, 'color', scope)
    const backgroundColor = colorField(blockStates, inspection, typingStyles, 'background-color', scope)
    const clear = () => {
        if (scope === 'selection') {
            for (const property of PROPERTIES) void applyInline(property, null, `清除选区${property}`)
            return
        }
        if (scope === 'typing') {
            onTypingStylesReset({
                'background-color': blockValue(blockStates, 'background-color') || 'transparent',
                color: blockValue(blockStates, 'color') || 'currentcolor',
                'font-size': blockValue(blockStates, 'font-size') || '16px',
                'font-style': blockValue(blockStates, 'font-style') || 'normal',
                'font-weight': blockValue(blockStates, 'font-weight') || '400',
                'text-decoration-line': blockValue(blockStates, 'text-decoration-line') || 'none',
            })
            return
        }
    }

    return (
        <DocumentRibbonGroup
            disabledReason={scope === 'selection' && !rangeReady ? '选区已经变化，请重新选择文字。' : null}
            label={scopeLabel(scope)}
            onOpenDetails={onOpenDetails}
            priority="essential"
            slot="font"
            wide
        >
            <DocumentRibbonRows
                first={<>
                    <Select
                        aria-label={scope === 'typing' ? '后续输入字号' : scope === 'selection' ? '选区字号' : '文字字号'}
                        disabled={!rangeReady}
                        onValueChange={value => {
                            const next = String(value)
                            if (next === 'current' || next === 'mixed') return
                            void applyValue(
                                'font-size',
                                next,
                                '修改字号',
                            )
                        }}
                        options={[
                            ...(sizeMixed ? [{value: 'mixed', label: '混合'}] : []),
                            ...(selectedSize === 'current' ? [{value: 'current', label: size || '继承'}] : []),
                            ...FONT_SIZE_OPTIONS,
                        ]}
                        radius="sm"
                        title={`${scopeLabel(scope)}字号`}
                        value={selectedSize}
                    />
                    <DocumentRibbonCommand
                        active={weight === '700'}
                        disabled={!rangeReady}
                        icon={Bold}
                        label="加粗"
                        onClick={() => void applyValue('font-weight', weight === '700' ? '400' : '700', '切换加粗')}
                    />
                    <DocumentRibbonCommand
                        active={style === 'italic'}
                        disabled={!rangeReady}
                        icon={Italic}
                        label="斜体"
                        onClick={() => void applyValue('font-style', style === 'italic' ? 'normal' : 'italic', '切换斜体')}
                    />
                    <DocumentRibbonCommand
                        active={(decoration || '').split(/\s+/u).includes('underline')}
                        disabled={!rangeReady}
                        icon={Underline}
                        label="下划线"
                        onClick={() => {
                            const next = toggleRibbonTextDecoration(decoration, 'underline')
                            void applyValue('text-decoration-line', next, '切换下划线')
                        }}
                    />
                    <DocumentRibbonCommand
                        active={(decoration || '').split(/\s+/u).includes('line-through')}
                        disabled={!rangeReady}
                        icon={Strikethrough}
                        label="删除线"
                        onClick={() => {
                            const next = toggleRibbonTextDecoration(decoration, 'line-through')
                            void applyValue('text-decoration-line', next, '切换删除线')
                        }}
                    />
                </>}
                second={<>
                    <span className="document-ribbon-color-command">
                        <span>文字颜色</span>
                        <ColorPropertyControl
                            embedded
                            field={textColor}
                            triggerIcon={Baseline}
                            onChange={value => {
                                const serialized = serializeVisualPropertyValue('color', value)
                                if (scope === 'selection') return applyInline('color', serialized, '修改文字颜色')
                                if (scope === 'typing') {
                                    onTypingStyleChange('color', serialized ?? (blockValue(blockStates, 'color') || 'currentcolor'))
                                    return Promise.resolve(true)
                                }
                                return Promise.resolve(false)
                            }}
                        />
                    </span>
                    <span className="document-ribbon-color-command">
                        <span>文字底色</span>
                        <ColorPropertyControl
                            embedded
                            field={backgroundColor}
                            triggerIcon={Highlighter}
                            onChange={value => {
                                const serialized = serializeVisualPropertyValue('background-color', value)
                                if (scope === 'selection') return applyInline('background-color', serialized, '修改文字底色')
                                if (scope === 'typing') {
                                    onTypingStyleChange('background-color', serialized ?? (blockValue(blockStates, 'background-color') || 'transparent'))
                                    return Promise.resolve(true)
                                }
                                return Promise.resolve(false)
                            }}
                        />
                    </span>
                    <DocumentRibbonCommand disabled={!rangeReady} icon={Eraser} label="清除格式" onClick={clear} />
                </>}
            />
        </DocumentRibbonGroup>
    )
}
