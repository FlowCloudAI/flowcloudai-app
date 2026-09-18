// 本模块把属性 Dock 的“所有宽度”字段适配为内核检查与编辑请求；它不持有 React 状态，也不直接改写源码。

import type {DocumentNodeKind} from '../domain/contract.ts'
import postcss, {type Node} from 'postcss'
import {
    documentFingerprint,
    idempotencyKey,
    interactionId,
    managedRuleTarget,
    normalizeManagedCondition,
    type AuthorDeclarationState,
    type PropertyInspection,
    type ReadContext,
    type WriteDestination,
} from '../domain/kernel/index.ts'
import type {LayerProjectionNode} from '../domain/layerProjection.ts'
import {
    requireKernelComponentHandle,
    type KernelComponentBindings,
    type KernelComponentInspectionRequest,
    type KernelComponentInspectionResult,
    type KernelDraftEditRequest,
} from './documentKernelDraftRuntime.ts'
import type {DocumentHistoryOptions} from './documentDraftModel.ts'

export const VISUAL_PROPERTY_FIELDS = [
    {property: 'font-size', label: '字号', group: 'text'},
    {property: 'font-weight', label: '字重', group: 'text'},
    {property: 'line-height', label: '行高', group: 'text'},
    {property: 'text-align', label: '对齐', group: 'layout'},
    {property: 'margin-block-start', label: '外距上', group: 'layout'},
    {property: 'margin-block-end', label: '外距下', group: 'layout'},
    {property: 'margin-inline-start', label: '外距左', group: 'layout'},
    {property: 'margin-inline-end', label: '外距右', group: 'layout'},
    {property: 'padding-block-start', label: '内距上', group: 'layout'},
    {property: 'padding-block-end', label: '内距下', group: 'layout'},
    {property: 'padding-inline-start', label: '内距左', group: 'layout'},
    {property: 'padding-inline-end', label: '内距右', group: 'layout'},
    {property: 'gap', label: '容器间距', group: 'layout'},
    {property: 'color', label: '文字颜色', group: 'appearance'},
    {property: 'background-color', label: '背景色', group: 'appearance'},
] as const

export type VisualPropertyName = (typeof VISUAL_PROPERTY_FIELDS)[number]['property']
export type VisualPropertyGroup = (typeof VISUAL_PROPERTY_FIELDS)[number]['group']
export type VisualPropertySourceState =
    | 'local'
    | 'inherited'
    | 'other-viewport'
    | 'not-applicable'

export interface VisualPropertyState {
    readonly property: VisualPropertyName
    readonly label: string
    readonly group: VisualPropertyGroup
    readonly value: string
    readonly localValue: string | null
    readonly sourceState: VisualPropertySourceState
    readonly statusText: string
    readonly disabled: boolean
    readonly reason: string | null
}

export type InspectVisualComponent = (
    request: KernelComponentInspectionRequest,
) => KernelComponentInspectionResult

const ALL_WIDTHS_READ_CONTEXT: ReadContext = Object.freeze({
    viewport: 'mobile',
    interactions: Object.freeze({hover: false, focusWithin: false}),
    direction: 'ltr',
    writingMode: 'horizontal-tb',
})

const ALL_WIDTHS_DESTINATION: WriteDestination = Object.freeze({
    scope: 'entry',
    channel: Object.freeze({kind: 'base-rule'}),
})

const CSS_NUMBER_PATTERN = /^[+-]?(?:(?:\d+\.\d+)|(?:\d+)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u
const HEX_COLOR_PATTERN = /^#[\da-f]{6}$/iu
const ENTRY_THEME_COLOR_PATTERN = /^var\(--fc-entry-(?:surface|text|accent|accent-contrast|muted)\)$/u

function sameDestination(left: WriteDestination, right: WriteDestination): boolean {
    return left.scope === right.scope && left.channel.kind === right.channel.kind
}

function matchesManagedRule(
    declaration: AuthorDeclarationState,
    node: LayerProjectionNode,
    property: string,
    destination: WriteDestination,
): boolean {
    if (destination.channel.kind === 'inline') return false
    const target = managedRuleTarget(
        node.id,
        node.kind as DocumentNodeKind,
        destination.channel,
    )
    return (
        declaration.declaredProperty.toLowerCase() === property &&
        declaration.sourceKind === 'stylesheet' &&
        declaration.origin.source?.scope === 'entry' &&
        declaration.origin.source.file === 'style.css' &&
        declaration.layer === 'fc-node' &&
        declaration.selector?.trim() === target.selector &&
        normalizeManagedCondition(declaration.media) === normalizeManagedCondition(target.media)
    )
}

function effectiveValue(inspection: PropertyInspection | undefined): string {
    return (
        inspection?.effectiveValue?.resolvedValue ??
        inspection?.effectiveValue?.rawValue ??
        ''
    )
}

function fieldState(
    node: LayerProjectionNode,
    field: (typeof VISUAL_PROPERTY_FIELDS)[number],
    inspection: PropertyInspection | undefined,
    desktopInspection: PropertyInspection | undefined,
    otherViewportProperties: ReadonlySet<string>,
    display: string,
): VisualPropertyState {
    const base = {
        property: field.property,
        label: field.label,
        group: field.group,
    } as const
    if (!node.managed || node.kind === 'source' || node.kind === 'operation' || !inspection) {
        return Object.freeze({
            ...base,
            value: '',
            localValue: null,
            sourceState: 'not-applicable' as const,
            statusText: '不适用 · 当前节点不是可编辑组件',
            disabled: true,
            reason: '当前节点不是可编辑组件。',
        })
    }
    if (field.property === 'gap' && !/^(?:inline-)?(?:grid|flex)$/iu.test(display.trim())) {
        return Object.freeze({
            ...base,
            value: effectiveValue(inspection),
            localValue: null,
            sourceState: 'not-applicable' as const,
            statusText: '不适用 · 需要 Grid 或 Flex',
            disabled: true,
            reason: '需要 Grid 或 Flex。',
        })
    }
    const applicabilityReason =
        inspection.applicability.kind === 'applicable'
            ? null
            : inspection.applicability.reason
    const baseDeclarations = inspection.directDeclarations.filter(declaration =>
        matchesManagedRule(declaration, node, field.property, ALL_WIDTHS_DESTINATION),
    )
    const localDeclaration = baseDeclarations.at(-1)
    const important = baseDeclarations.some(declaration => declaration.important)
    const writable = inspection.writeDestinations.some(destination =>
        sameDestination(destination, ALL_WIDTHS_DESTINATION),
    )
    const reason =
        important
            ? '本级声明使用了 !important，无法安全接管。'
            : applicabilityReason ??
              (inspection.confidence.kind === 'proven' ? null : inspection.confidence.reason) ??
              (writable ? null : '当前源码没有可写的词条样式目标。')
    if (reason) {
        return Object.freeze({
            ...base,
            value: localDeclaration?.resolvedValue ?? localDeclaration?.rawValue ?? effectiveValue(inspection),
            localValue: localDeclaration?.resolvedValue ?? localDeclaration?.rawValue ?? null,
            sourceState: 'not-applicable' as const,
            statusText: `不适用 · ${reason}`,
            disabled: true,
            reason,
        })
    }
    const localValue = localDeclaration?.resolvedValue ?? localDeclaration?.rawValue ?? null
    const otherViewport =
        effectiveValue(inspection).trim() !== effectiveValue(desktopInspection).trim() ||
        otherViewportProperties.has(field.property) ||
        [inspection, desktopInspection].some(candidate =>
            candidate?.directDeclarations.some(
                declaration =>
                    declaration.declaredProperty.toLowerCase() === field.property &&
                    declaration.origin.source?.scope === 'entry' &&
                    declaration.origin.source.file === 'style.css' &&
                    normalizeManagedCondition(declaration.media) !== null,
            ),
        )
    const inherited = '本级未设置 · 继承自词条样式'
    return Object.freeze({
        ...base,
        value: localValue ?? effectiveValue(inspection),
        localValue,
        sourceState: otherViewport ? 'other-viewport' : localValue ? 'local' : 'inherited',
        statusText: otherViewport
            ? `${localValue ? '本级已设置' : inherited} · 其他区间有覆盖`
            : localValue
              ? '本级已设置'
              : inherited,
        disabled: false,
        reason: null,
    })
}

export function inspectVisualProperties(
    node: LayerProjectionNode,
    inspect: InspectVisualComponent,
    entryStyleCss = '',
): readonly VisualPropertyState[] {
    const properties = [...VISUAL_PROPERTY_FIELDS.map(field => field.property), 'display']
    const result = inspect({nodeId: node.id, properties, context: ALL_WIDTHS_READ_CONTEXT})
    const desktopResult = inspect({
        nodeId: node.id,
        properties,
        context: Object.freeze({...ALL_WIDTHS_READ_CONTEXT, viewport: 'desktop'}),
    })
    const inspections = result.status === 'ready' ? result.inspection.properties : {}
    const desktopInspections =
        desktopResult.status === 'ready' ? desktopResult.inspection.properties : {}
    const display = effectiveValue(inspections.display)
    const otherViewportProperties = managedOtherViewportProperties(node, entryStyleCss)
    return Object.freeze(
        VISUAL_PROPERTY_FIELDS.map(field =>
            fieldState(
                node,
                field,
                inspections[field.property],
                desktopInspections[field.property],
                otherViewportProperties,
                display,
            ),
        ),
    )
}

function managedOtherViewportProperties(
    node: LayerProjectionNode,
    entryStyleCss: string,
): ReadonlySet<string> {
    if (!entryStyleCss || node.kind === 'source' || node.kind === 'operation') return new Set()
    const desktopTarget = managedRuleTarget(node.id, node.kind as DocumentNodeKind, {
        kind: 'conditional-rule',
        context: 'desktop',
    })
    const properties = new Set<string>()
    try {
        postcss.parse(entryStyleCss).walkRules(rule => {
            if (rule.selector.trim() !== desktopTarget.selector) return
            let parent: Node | undefined = rule.parent
            let insideMedia = false
            while (parent) {
                if (
                    parent.type === 'atrule' &&
                    'name' in parent &&
                    typeof parent.name === 'string' &&
                    parent.name.toLowerCase() === 'media'
                ) {
                    insideMedia = true
                    break
                }
                parent = parent.parent
            }
            if (!insideMedia) return
            rule.walkDecls(declaration => {
                properties.add(declaration.prop.toLowerCase())
            })
        })
    } catch {
        // 无法解析的 CSS 会由统一校验链给出诊断；属性面板不在这里猜测覆盖状态。
    }
    return properties
}

export const VISUAL_FONT_WEIGHTS = ['400', '500', '600', '700', '800', '900'] as const
export type VisualFontWeight = (typeof VISUAL_FONT_WEIGHTS)[number]
export type VisualLengthUnit = 'px' | 'rem' | 'em' | '%'
export type VisualSpacingUnit = 'px' | 'rem' | 'em'
export type VisualNumericUnit = VisualLengthUnit | VisualSpacingUnit | ''

export interface VisualNumericPropertyValue {
    readonly kind: 'numeric'
    readonly value: number
    readonly unit: VisualNumericUnit
    readonly numberText: string
}

export interface VisualColorPropertyValue {
    readonly kind: 'color'
    readonly value: string
    readonly opacity: number
}

function byteHex(value: number): string {
    return Math.round(value).toString(16).padStart(2, '0')
}

/** 只回读本适配层可能产出的颜色形式，其他合法作者值仍保持为复杂源码。 */
export function parseSerializedVisualColor(rawValue: string): VisualColorPropertyValue | null {
    const raw = rawValue.trim().toLowerCase()
    if (HEX_COLOR_PATTERN.test(raw) || ENTRY_THEME_COLOR_PATTERN.test(raw)) {
        return {kind: 'color', value: raw, opacity: 100}
    }
    if (raw === 'transparent') return {kind: 'color', value: '#000000', opacity: 0}
    const rgb = /^rgb\((\d{1,3}) (\d{1,3}) (\d{1,3}) \/ (\d+(?:\.\d+)?)%\)$/u.exec(raw)
    if (rgb) {
        const channels = rgb.slice(1, 4).map(Number)
        const opacity = Number(rgb[4])
        if (channels.every(channel => channel >= 0 && channel <= 255) && opacity >= 0 && opacity <= 100) {
            return {kind: 'color', value: `#${channels.map(byteHex).join('')}`, opacity}
        }
    }
    const mixed = /^color-mix\(in srgb, (var\(--fc-entry-(?:surface|text|accent|accent-contrast|muted)\)) (\d+(?:\.\d+)?)%, transparent\)$/u.exec(raw)
    if (mixed) {
        const opacity = Number(mixed[2])
        if (opacity >= 0 && opacity <= 100) return {kind: 'color', value: mixed[1], opacity}
    }
    return null
}

export type VisualPropertyEditValue =
    | VisualNumericPropertyValue
    | {readonly kind: 'font-weight'; readonly value: VisualFontWeight}
    | {readonly kind: 'choice'; readonly value: 'left' | 'center' | 'right' | 'justify'}
    | VisualColorPropertyValue
    | {readonly kind: 'clear-override'}

export interface VisualPropertyChange {
    readonly property: VisualPropertyName
    readonly value: VisualPropertyEditValue
}

function compactNumber(value: number): string {
    return Number(value.toFixed(4)).toString()
}

function serializeColor(value: VisualColorPropertyValue): string {
    if (
        !HEX_COLOR_PATTERN.test(value.value) &&
        !ENTRY_THEME_COLOR_PATTERN.test(value.value)
    ) throw new TypeError('颜色只能使用完整十六进制值或页面主题色。')
    if (!Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 100) {
        throw new TypeError('颜色透明度必须位于 0–100。')
    }
    if (value.opacity === 0) return 'transparent'
    if (value.opacity === 100) return value.value.toLowerCase()
    if (HEX_COLOR_PATTERN.test(value.value)) {
        const red = Number.parseInt(value.value.slice(1, 3), 16)
        const green = Number.parseInt(value.value.slice(3, 5), 16)
        const blue = Number.parseInt(value.value.slice(5, 7), 16)
        return `rgb(${red} ${green} ${blue} / ${compactNumber(value.opacity)}%)`
    }
    return `color-mix(in srgb, ${value.value} ${compactNumber(value.opacity)}%, transparent)`
}

function allowedNumericUnits(property: VisualPropertyName): readonly VisualNumericUnit[] {
    if (property === 'line-height') return ['']
    if (property === 'font-size') return ['px', 'rem', 'em', '%']
    if (
        property.startsWith('margin-') ||
        property.startsWith('padding-') ||
        property === 'gap'
    ) return ['px', 'rem', 'em']
    return []
}

export function serializeVisualPropertyValue(
    property: VisualPropertyName,
    value: VisualPropertyEditValue,
): string | null {
    if (value.kind === 'clear-override') return null
    if (value.kind === 'font-weight') {
        if (property !== 'font-weight' || !VISUAL_FONT_WEIGHTS.includes(value.value)) {
            throw new TypeError('字重结构与目标属性不匹配。')
        }
        return value.value
    }
    if (value.kind === 'choice') {
        if (property !== 'text-align') throw new TypeError('选择值结构与目标属性不匹配。')
        return value.value
    }
    if (value.kind === 'color') {
        if (property !== 'color' && property !== 'background-color') {
            throw new TypeError('颜色结构与目标属性不匹配。')
        }
        return serializeColor(value)
    }
    const units = allowedNumericUnits(property)
    if (!units.includes(value.unit)) throw new TypeError('数值单位不在该属性白名单内。')
    if (!Number.isFinite(value.value) || !CSS_NUMBER_PATTERN.test(value.numberText)) {
        throw new TypeError('数值结构必须包含有限数字。')
    }
    if (Number(value.numberText) !== value.value) throw new TypeError('数值文本与数值不一致。')
    if (!property.startsWith('margin-') && value.value < 0) {
        throw new TypeError('该属性不接受负数。')
    }
    return `${value.numberText}${value.unit}`
}

export function createVisualPropertyEditRequest(
    nodeId: string,
    changes: readonly VisualPropertyChange[],
    history: DocumentHistoryOptions = {},
    allocateRequestId: () => string = () => crypto.randomUUID(),
): KernelDraftEditRequest {
    if (changes.length === 0) throw new TypeError('属性修改不能为空。')
    const serialized = changes.map(change => Object.freeze({
        property: change.property,
        value: serializeVisualPropertyValue(change.property, change.value),
    }))
    if (new Set(serialized.map(change => change.property)).size !== serialized.length) {
        throw new TypeError('同一请求不能重复修改属性。')
    }
    const requestId = allocateRequestId()
    const interactionSeed = history.historyGroupId ?? requestId
    return Object.freeze({
        nodeIds: Object.freeze([nodeId.toLowerCase()]),
        idempotencyKey: idempotencyKey(`page-property:${requestId}`),
        interactionId: interactionId(`page-property:${documentFingerprint(interactionSeed)}`),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents: (handles: KernelComponentBindings) => {
            const component = requireKernelComponentHandle(handles, nodeId)
            return Object.freeze(serialized.map(change => Object.freeze({
                    kind: 'edit-property' as const,
                    target: Object.freeze({kind: 'component-root' as const, component}),
                    property: change.property,
                    action: change.value !== null
                        ? Object.freeze({kind: 'set-value' as const, value: change.value})
                        : Object.freeze({kind: 'clear-override' as const}),
                    readContext: ALL_WIDTHS_READ_CONTEXT,
                    destination: ALL_WIDTHS_DESTINATION,
                    ...(change.value !== null
                        ? {takeover: 'preserve-inline-effect' as const}
                        : {}),
                })))
        },
    })
}
