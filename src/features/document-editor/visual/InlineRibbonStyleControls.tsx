// 本组件把画布的可信文字选区绑定到现有 text-range 检查与属性意图；不接触草稿或源码。

import {Bold, Eraser, Italic, Underline} from 'lucide-react'
import {Select} from 'flowcloudai-ui'
import type {KernelTextRangeInspectionRequest} from '../../page-document/application/documentKernelDraftRuntime.ts'
import type {RibbonApplyKernelEntry, RibbonInspectTextRange} from './HomeRibbonControls.tsx'
import {DocumentRibbonCommand, DocumentRibbonGroup, DocumentRibbonRows} from './DocumentOfficeRibbon.tsx'
import {
    createRibbonTextRangePropertyRequest,
    type RibbonInlineProperty,
    type RibbonTextRange,
} from './ribbonKernelBinding.ts'

export interface InlineRibbonStyleControlsProps {
    readonly range: RibbonTextRange | null
    readonly applyKernelEntry: RibbonApplyKernelEntry
    readonly inspectTextRange: RibbonInspectTextRange
    readonly styleContext: 'mobile' | 'desktop'
}

const PROPERTIES = Object.freeze([
    'font-size',
    'font-weight',
    'font-style',
    'text-decoration-line',
    'color',
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

const COLOR_OPTIONS = Object.freeze([
    {value: 'currentcolor', label: '继承'},
    {value: 'var(--fc-entry-text)', label: '正文'},
    {value: 'var(--fc-entry-accent)', label: '强调'},
    {value: 'var(--fc-entry-muted)', label: '弱化'},
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

function uniformValue(
    inspection: ReturnType<RibbonInspectTextRange>,
    property: RibbonInlineProperty,
): string | null {
    if (inspection.status !== 'ready') return null
    const state = inspection.inspection.properties[property]?.valueState
    return state?.kind === 'uniform' ? state.value : null
}

function isMixedValue(
    inspection: ReturnType<RibbonInspectTextRange>,
    property: RibbonInlineProperty,
): boolean {
    if (inspection.status !== 'ready') return false
    return inspection.inspection.properties[property]?.valueState.kind === 'mixed'
}

function toggledDecoration(value: string | null): string {
    const tokens = new Set((value ?? '').split(/\s+/u).filter(token => token && token !== 'none'))
    if (tokens.has('underline')) tokens.delete('underline')
    else tokens.add('underline')
    return ['underline', 'line-through'].filter(token => tokens.has(token)).join(' ') || 'none'
}

export function InlineRibbonStyleControls({
    range,
    applyKernelEntry,
    inspectTextRange,
    styleContext,
}: InlineRibbonStyleControlsProps) {
    const inspection = range ? inspect(range, inspectTextRange, styleContext) : null
    const enabled = Boolean(range && range.to > range.from && inspection?.status === 'ready')
    const reason = enabled ? null : range ? '选区已经漂移，请重新选择文字。' : '请先在画布中选择一段文字。'
    const size = inspection ? uniformValue(inspection, 'font-size') : null
    const sizeMixed = inspection ? isMixedValue(inspection, 'font-size') : false
    const weight = inspection ? uniformValue(inspection, 'font-weight') : null
    const style = inspection ? uniformValue(inspection, 'font-style') : null
    const decoration = inspection ? uniformValue(inspection, 'text-decoration-line') : null
    const color = inspection ? uniformValue(inspection, 'color') : null
    const colorMixed = inspection ? isMixedValue(inspection, 'color') : false
    const apply = (property: RibbonInlineProperty, value: string | null, label: string) => {
        if (!range || !enabled) return
        void applyKernelEntry(
            createRibbonTextRangePropertyRequest(range, property, value, styleContext),
            label,
            {immediate: true},
        )
    }
    return (
        <DocumentRibbonGroup disabledReason={reason} label="所选文字" priority="essential" wide>
            <DocumentRibbonRows
                first={<>
                    <Select
                        aria-label="选区字号"
                        disabled={!enabled}
                        onValueChange={value => {
                            if (value !== 'mixed') apply('font-size', String(value), '修改选区字号')
                        }}
                        options={[
                            ...(sizeMixed ? [{value: 'mixed', label: '多种字号'}] : []),
                            ...FONT_SIZE_OPTIONS,
                        ]}
                        title={reason ?? '选区字号'}
                        value={sizeMixed
                            ? 'mixed'
                            : FONT_SIZE_OPTIONS.some(option => option.value === size) ? size ?? '16px' : '16px'}
                    />
                    <DocumentRibbonCommand active={weight === '700'} disabled={!enabled} icon={Bold} label="加粗" onClick={() => apply('font-weight', weight === '700' ? '400' : '700', '切换选区加粗')} title={reason ?? '切换选区加粗'} />
                    <DocumentRibbonCommand active={style === 'italic'} disabled={!enabled} icon={Italic} label="斜体" onClick={() => apply('font-style', style === 'italic' ? 'normal' : 'italic', '切换选区斜体')} title={reason ?? '切换选区斜体'} />
                </>}
                second={<>
                    <DocumentRibbonCommand active={(decoration ?? '').split(/\s+/u).includes('underline')} disabled={!enabled} icon={Underline} label="下划线" onClick={() => apply('text-decoration-line', toggledDecoration(decoration), '切换选区下划线')} title={reason ?? '切换选区下划线'} />
                    <Select
                        aria-label="选区文字颜色"
                        disabled={!enabled}
                        onValueChange={value => {
                            if (value !== 'mixed') apply('color', String(value), '修改选区文字颜色')
                        }}
                        options={[
                            ...(colorMixed ? [{value: 'mixed', label: '多种颜色'}] : []),
                            ...COLOR_OPTIONS,
                        ]}
                        title={reason ?? '选区文字颜色'}
                        value={colorMixed
                            ? 'mixed'
                            : COLOR_OPTIONS.some(option => option.value === color) ? color ?? 'currentcolor' : 'currentcolor'}
                    />
                    <DocumentRibbonCommand disabled={!enabled} icon={Eraser} label="清除" onClick={() => {
                        for (const property of PROPERTIES) apply(property, null, `清除选区${property}`)
                    }} title={reason ?? '清除后继承整段文字样式'} />
                </>}
            />
        </DocumentRibbonGroup>
    )
}
