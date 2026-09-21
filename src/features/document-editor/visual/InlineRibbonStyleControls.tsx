// 本组件让可信文字选区与光标待输入格式共用一套字体控件；文本块基础格式只由组启动器进入属性 Dock。

import {Baseline, Bold, Eraser, Highlighter, Italic, Strikethrough, Underline} from 'lucide-react'
import {Select} from 'flowcloudai-ui'
import type {KernelTextRangeInspectionRequest} from '../../page-document/application/documentKernelDraftRuntime.ts'
import {
    serializeVisualPropertyValue,
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
    ribbonFontControlsAvailable,
    ribbonInlineDisplayValue,
    toggleRibbonTextDecoration,
    type RibbonFontScope,
    type RibbonInlineProperty,
    type RibbonTextRange,
} from './ribbonKernelBinding.ts'

export interface InlineRibbonStyleControlsProps {
    readonly node: LayerProjectionNode
    readonly range: RibbonTextRange | null
    readonly typingStyles: Readonly<Partial<Record<CanvasTypingStyleProperty, string>>>
    readonly applyKernelEntry: RibbonApplyKernelEntry
    readonly inspectTextRange: RibbonInspectTextRange
    readonly styleContext: 'mobile' | 'desktop'
    readonly onOpenDetails?: () => void
    readonly onTypingStyleChange: (property: CanvasTypingStyleProperty, value: string | null) => void
    readonly onTypingStylesReset: () => void
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

interface InlineComputedSnapshot {
    readonly values: Readonly<Partial<Record<RibbonInlineProperty, string | null>>>
    readonly mixed: ReadonlySet<RibbonInlineProperty>
    readonly managedOverrides: ReadonlySet<RibbonInlineProperty>
}

function computedSnapshot(
    inspection: ReturnType<RibbonInspectTextRange> | null,
): InlineComputedSnapshot | null {
    if (inspection?.status !== 'ready') return null
    const values: Partial<Record<RibbonInlineProperty, string | null>> = {}
    const mixed = new Set<RibbonInlineProperty>()
    const managedOverrides = new Set<RibbonInlineProperty>()
    for (const property of PROPERTIES) {
        const inspected = inspection.inspection.properties[property]
        if (inspected?.valueState.kind === 'uniform') values[property] = inspected.valueState.value
        else if (inspected?.valueState.kind === 'mixed') mixed.add(property)
        const segments = inspected?.segments ?? []
        if (segments.length > 0 && segments.every(segment => segment.managedOverride)) {
            managedOverrides.add(property)
        }
    }
    return Object.freeze({
        values: Object.freeze(values),
        mixed,
        managedOverrides,
    })
}

function colorField(
    value: string | null,
    mixed: boolean,
    managedOverride: boolean,
    storedMark: boolean,
    property: 'color' | 'background-color',
    scope: RibbonFontScope,
    enabled: boolean,
): VisualPropertyState {
    const resolved = value ?? (property === 'color' ? 'currentcolor' : 'transparent')
    const localValue = scope === 'typing' ? storedMark ? resolved : null : managedOverride ? resolved : null
    return Object.freeze({
        property,
        label: property === 'color' ? '文字颜色' : '文字底色',
        group: 'appearance',
        value: resolved,
        localValue,
        sourceState: mixed ? 'mixed' : storedMark ? 'local' : 'inherited',
        statusText: mixed ? '多种值' : scope === 'typing' ? '后续输入' : '选区',
        clearTitle: scope === 'typing' ? '清除待输入颜色并继承光标处样式' : '清除局部颜色',
        disabled: !enabled,
        reason: enabled ? null : '在画布中放置光标或选择文字后可用。',
    })
}

function scopeLabel(scope: RibbonFontScope): string {
    if (scope === 'selection') return '字体 · 选区'
    if (scope === 'typing') return '字体 · 后续输入'
    return '字体'
}

export function InlineRibbonStyleControls({
    node,
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
    const computed = computedSnapshot(inspection)
    const controlsEnabled = ribbonFontControlsAvailable(node.managed, range)
    const effectiveValue = (property: RibbonInlineProperty): string =>
        ribbonInlineDisplayValue(
            scope,
            computed?.values[property] ?? null,
            typingStyles[property],
        ) ?? ''
    const mixed = (property: RibbonInlineProperty): boolean =>
        scope === 'selection' && Boolean(computed?.mixed.has(property))

    const applyInline = (property: RibbonInlineProperty, value: string | null, label: string) => {
        if (!range || scope !== 'selection' || !controlsEnabled) return Promise.resolve(false)
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
    const textColor = colorField(
        effectiveValue('color'),
        mixed('color'),
        Boolean(computed?.managedOverrides.has('color')),
        typingStyles.color !== undefined,
        'color',
        scope,
        controlsEnabled,
    )
    const backgroundColor = colorField(
        effectiveValue('background-color'),
        mixed('background-color'),
        Boolean(computed?.managedOverrides.has('background-color')),
        typingStyles['background-color'] !== undefined,
        'background-color',
        scope,
        controlsEnabled,
    )
    const clear = () => {
        if (scope === 'selection') {
            for (const property of PROPERTIES) void applyInline(property, null, `清除选区${property}`)
            return
        }
        if (scope === 'typing') {
            onTypingStylesReset()
            return
        }
    }

    return (
        <DocumentRibbonGroup
            disabledReason={!controlsEnabled ? '在画布中放置光标或选择文字后可用。' : null}
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
                        disabled={!controlsEnabled}
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
                        disabled={!controlsEnabled}
                        icon={Bold}
                        label="加粗"
                        onClick={() => void applyValue('font-weight', weight === '700' ? '400' : '700', '切换加粗')}
                    />
                    <DocumentRibbonCommand
                        active={style === 'italic'}
                        disabled={!controlsEnabled}
                        icon={Italic}
                        label="斜体"
                        onClick={() => void applyValue('font-style', style === 'italic' ? 'normal' : 'italic', '切换斜体')}
                    />
                    <DocumentRibbonCommand
                        active={(decoration || '').split(/\s+/u).includes('underline')}
                        disabled={!controlsEnabled}
                        icon={Underline}
                        label="下划线"
                        onClick={() => {
                            const next = toggleRibbonTextDecoration(decoration, 'underline')
                            void applyValue('text-decoration-line', next, '切换下划线')
                        }}
                    />
                    <DocumentRibbonCommand
                        active={(decoration || '').split(/\s+/u).includes('line-through')}
                        disabled={!controlsEnabled}
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
                                    onTypingStyleChange('color', serialized)
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
                                    onTypingStyleChange('background-color', serialized)
                                    return Promise.resolve(true)
                                }
                                return Promise.resolve(false)
                            }}
                        />
                    </span>
                    <DocumentRibbonCommand disabled={!controlsEnabled} icon={Eraser} label="清除格式" onClick={clear} />
                </>}
            />
        </DocumentRibbonGroup>
    )
}
