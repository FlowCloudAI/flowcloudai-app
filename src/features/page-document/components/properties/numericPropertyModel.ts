// 本模块定义属性 Dock 的有限数值模型；滑杆常用范围只控制显示，不改变作者已保存的合法数值。

import type {
    VisualNumericPropertyValue,
    VisualNumericUnit,
    VisualPropertyName,
} from '../../application/visualPropertyEditing.ts'

export interface NumericPropertyPreset {
    readonly label: string
    readonly value: number
    readonly unit: VisualNumericUnit
}

export interface NumericPropertyRange {
    readonly minimum: number
    readonly maximum: number
    readonly step: number
}

export interface NumericPropertyDefinition {
    readonly property: VisualPropertyName
    readonly units: readonly VisualNumericUnit[]
    readonly defaultValue: VisualNumericPropertyValue
    readonly presets: readonly NumericPropertyPreset[]
    readonly sliderRange: (unit: VisualNumericUnit) => NumericPropertyRange
    readonly minimum?: number
}

export type NumericPropertyEditorValue =
    | {readonly kind: 'numeric'; readonly candidate: VisualNumericPropertyValue}
    | {readonly kind: 'custom'; readonly raw: string}

const CSS_DIMENSION_PATTERN = /^([+-]?(?:(?:\d+\.\d+)|(?:\d+)|(?:\.\d+))(?:[eE][+-]?\d+)?)([a-z%]*)$/iu
const CSS_NUMBER_PATTERN = /^[+-]?(?:(?:\d+\.\d+)|(?:\d+)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u

const FONT_SIZE_PRESETS: readonly NumericPropertyPreset[] = [
    {label: '小字', value: 12, unit: 'px'},
    {label: '正文', value: 16, unit: 'px'},
    {label: '小标题', value: 24, unit: 'px'},
    {label: '大标题', value: 32, unit: 'px'},
]

const LINE_HEIGHT_PRESETS: readonly NumericPropertyPreset[] = [
    {label: '单倍', value: 1, unit: ''},
    {label: '紧凑', value: 1.25, unit: ''},
    {label: '正文', value: 1.5, unit: ''},
    {label: '宽松', value: 2, unit: ''},
]

const SPACING_PRESETS: readonly NumericPropertyPreset[] = [
    {label: '无', value: 0, unit: 'px'},
    {label: '小', value: 0.5, unit: 'rem'},
    {label: '中', value: 1, unit: 'rem'},
    {label: '大', value: 1.5, unit: 'rem'},
]

const SIZE_PRESETS: readonly NumericPropertyPreset[] = [
    {label: '小', value: 12, unit: 'rem'},
    {label: '中', value: 24, unit: 'rem'},
    {label: '大', value: 48, unit: 'rem'},
    {label: '填充', value: 100, unit: '%'},
]

function compactNumber(value: number): string {
    return Number(value.toFixed(6)).toString()
}

function spacingRange(unit: VisualNumericUnit, permitsNegative: boolean): NumericPropertyRange {
    if (unit === 'px') return {minimum: permitsNegative ? -128 : 0, maximum: 128, step: 1}
    return {minimum: permitsNegative ? -8 : 0, maximum: 8, step: 0.125}
}

export function numericPropertyDefinition(property: VisualPropertyName): NumericPropertyDefinition | null {
    if (property === 'font-size') {
        return {
            property,
            units: ['px', 'rem', 'em', '%'],
            defaultValue: {kind: 'numeric', value: 16, unit: 'px', numberText: '16'},
            presets: FONT_SIZE_PRESETS,
            minimum: 0,
            sliderRange: unit => {
                if (unit === 'px') return {minimum: 6, maximum: 96, step: 1}
                if (unit === '%') return {minimum: 25, maximum: 600, step: 5}
                return {minimum: 0.375, maximum: 6, step: 0.125}
            },
        }
    }
    if (property === 'line-height') {
        return {
            property,
            units: [''],
            defaultValue: {kind: 'numeric', value: 1.5, unit: '', numberText: '1.5'},
            presets: LINE_HEIGHT_PRESETS,
            minimum: 0,
            sliderRange: () => ({minimum: 0.5, maximum: 8, step: 0.1}),
        }
    }
    if (property === 'opacity') {
        return {
            property,
            units: [''],
            defaultValue: {kind: 'numeric', value: 1, unit: '', numberText: '1'},
            presets: [
                {label: '透明', value: 0, unit: ''},
                {label: '半透明', value: 0.5, unit: ''},
                {label: '不透明', value: 1, unit: ''},
            ],
            minimum: 0,
            sliderRange: () => ({minimum: 0, maximum: 1, step: 0.05}),
        }
    }
    if (property === 'rotate') {
        return {
            property,
            units: ['deg'],
            defaultValue: {kind: 'numeric', value: 0, unit: 'deg', numberText: '0'},
            presets: [
                {label: '无', value: 0, unit: 'deg'},
                {label: '左转', value: -90, unit: 'deg'},
                {label: '右转', value: 90, unit: 'deg'},
                {label: '倒置', value: 180, unit: 'deg'},
            ],
            sliderRange: () => ({minimum: -180, maximum: 180, step: 1}),
        }
    }
    if (['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height'].includes(property)) {
        return {
            property,
            units: ['px', 'rem', 'em', '%'],
            defaultValue: {kind: 'numeric', value: 100, unit: '%', numberText: '100'},
            presets: SIZE_PRESETS,
            minimum: 0,
            sliderRange: unit => unit === '%'
                ? {minimum: 0, maximum: 100, step: 1}
                : unit === 'px'
                  ? {minimum: 0, maximum: 1024, step: 1}
                  : {minimum: 0, maximum: 64, step: 0.25},
        }
    }
    const spacing =
        property.startsWith('margin-') ||
        property.startsWith('padding-') ||
        ['gap', 'row-gap', 'column-gap', 'border-width', 'border-radius', 'letter-spacing', 'word-spacing'].includes(property)
    if (!spacing) return null
    const permitsNegative = property.startsWith('margin-') || property === 'letter-spacing' || property === 'word-spacing'
    return {
        property,
        units: ['px', 'rem', 'em'],
        defaultValue: {kind: 'numeric', value: ['gap', 'row-gap', 'column-gap'].includes(property) ? 1 : 0, unit: 'rem', numberText: ['gap', 'row-gap', 'column-gap'].includes(property) ? '1' : '0'},
        presets: ['gap', 'row-gap', 'column-gap', 'border-radius'].includes(property) ? SPACING_PRESETS : [],
        minimum: permitsNegative ? undefined : 0,
        sliderRange: unit => spacingRange(unit, permitsNegative),
    }
}

export function readNumericPropertyEditorValue(
    rawValue: string,
    definition: NumericPropertyDefinition,
): NumericPropertyEditorValue {
    const raw = rawValue.trim()
    if (!raw) return {kind: 'numeric', candidate: definition.defaultValue}
    const match = CSS_DIMENSION_PATTERN.exec(raw)
    if (!match) return {kind: 'custom', raw}
    const unit = match[2].toLowerCase() as VisualNumericUnit
    const value = Number(match[1])
    if (
        !definition.units.includes(unit) ||
        !Number.isFinite(value) ||
        (definition.minimum !== undefined && value < definition.minimum)
    ) return {kind: 'custom', raw}
    return {
        kind: 'numeric',
        candidate: {kind: 'numeric', value, unit, numberText: match[1]},
    }
}

export function validateNumericPropertyDraft(
    draft: string,
    definition: NumericPropertyDefinition,
): {valid: true; value: number; numberText: string} | {valid: false; message: string} {
    const raw = draft.trim()
    if (!CSS_NUMBER_PATTERN.test(raw)) return {valid: false, message: '请输入不带单位的有限数字。'}
    const value = Number(raw)
    if (!Number.isFinite(value)) return {valid: false, message: '请输入不带单位的有限数字。'}
    if (definition.minimum !== undefined && value < definition.minimum) {
        return {valid: false, message: `数值不能小于 ${definition.minimum}。`}
    }
    return {valid: true, value, numberText: raw}
}

export function numericSliderDisplayValue(range: NumericPropertyRange, value: number): number {
    if (!Number.isFinite(value)) return range.minimum
    return Math.min(range.maximum, Math.max(range.minimum, value))
}

export function matchingNumericPropertyPreset(
    presets: readonly NumericPropertyPreset[],
    candidate: Pick<VisualNumericPropertyValue, 'unit' | 'value'>,
): NumericPropertyPreset | null {
    return presets.find(preset => preset.unit === candidate.unit && preset.value === candidate.value) ?? null
}

export function changeNumericPropertyUnit(
    candidate: VisualNumericPropertyValue,
    unit: VisualNumericUnit,
    definition: NumericPropertyDefinition,
): VisualNumericPropertyValue {
    if (!definition.units.includes(unit)) throw new TypeError('单位不在该属性白名单内。')
    return {...candidate, unit}
}

export function stepNumericPropertyValue(
    candidate: VisualNumericPropertyValue,
    direction: -1 | 1,
    definition: NumericPropertyDefinition,
): VisualNumericPropertyValue {
    const step = definition.sliderRange(candidate.unit).step
    const precision = Math.min(8, Math.max(0, (String(step).split('.')[1] ?? '').length + 2))
    const raw = Number((candidate.value + direction * step).toFixed(precision))
    const value = definition.minimum === undefined ? raw : Math.max(definition.minimum, raw)
    return {...candidate, value, numberText: compactNumber(value)}
}
