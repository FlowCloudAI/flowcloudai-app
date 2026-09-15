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

const LENGTH_PATTERN = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(px|rem|em|%)$/iu
const NUMBER_PATTERN = /^[+]?(?:\d+(?:\.\d+)?|\.\d+)$/u
const COLOR_PATTERN = /^(?:#[\da-f]{3,8}|[a-z]+|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color|var)\([^{};]+\))$/iu

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

export interface VisualPropertyValueValidation {
    readonly valid: boolean
    readonly normalized: string
    readonly message: string | null
}

export function validateVisualPropertyValue(
    property: VisualPropertyName,
    rawValue: string,
): VisualPropertyValueValidation {
    const value = rawValue.trim()
    if (!value) return Object.freeze({valid: true, normalized: '', message: null})
    const hasControl = [...value].some(character => {
        const code = character.codePointAt(0) ?? 0
        return code <= 31 || code === 127
    })
    if (hasControl || /[{};]/u.test(value) || /!important/iu.test(value)) {
        return Object.freeze({valid: false, normalized: value, message: '值中含有不允许的 CSS 语法。'})
    }
    if (property === 'font-weight') {
        const numeric = NUMBER_PATTERN.test(value) ? Number(value) : null
        const valid = ['normal', 'bold', 'bolder', 'lighter'].includes(value.toLowerCase()) ||
            (numeric !== null && numeric >= 1 && numeric <= 1000)
        return Object.freeze({
            valid,
            normalized: value,
            message: valid ? null : '字重应为 1–1000 或 normal、bold、bolder、lighter。',
        })
    }
    if (property === 'color' || property === 'background-color') {
        const valid = COLOR_PATTERN.test(value)
        return Object.freeze({
            valid,
            normalized: value,
            message: valid ? null : '请输入完整 CSS 颜色值。',
        })
    }
    if (property === 'line-height' && (value.toLowerCase() === 'normal' || NUMBER_PATTERN.test(value))) {
        const valid = value.toLowerCase() === 'normal' || Number(value) >= 0
        return Object.freeze({
            valid,
            normalized: value,
            message: valid ? null : '行高不能为负数。',
        })
    }
    const match = LENGTH_PATTERN.exec(value)
    const numeric = match ? Number(match[1]) : Number.NaN
    const permitsNegative = property.startsWith('margin-')
    const valid = Boolean(match) && (permitsNegative || numeric >= 0)
    return Object.freeze({
        valid,
        normalized: value,
        message: valid
            ? null
            : `${VISUAL_PROPERTY_FIELDS.find(field => field.property === property)?.label ?? property}应为带 px、rem、em 或 % 单位的${permitsNegative ? '' : '非负'}数值。`,
    })
}

export function createVisualPropertyEditRequest(
    nodeId: string,
    property: VisualPropertyName,
    rawValue: string,
    history: DocumentHistoryOptions = {},
    allocateRequestId: () => string = () => crypto.randomUUID(),
): KernelDraftEditRequest {
    const validation = validateVisualPropertyValue(property, rawValue)
    if (!validation.valid) throw new TypeError(validation.message ?? '属性值无效。')
    const requestId = allocateRequestId()
    const interactionSeed = history.historyGroupId ?? requestId
    return Object.freeze({
        nodeIds: Object.freeze([nodeId.toLowerCase()]),
        idempotencyKey: idempotencyKey(`page-property:${requestId}`),
        interactionId: interactionId(`page-property:${documentFingerprint(interactionSeed)}`),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents: (handles: KernelComponentBindings) => {
            const component = requireKernelComponentHandle(handles, nodeId)
            return Object.freeze([
                Object.freeze({
                    kind: 'edit-property' as const,
                    target: Object.freeze({kind: 'component-root' as const, component}),
                    property,
                    action: validation.normalized
                        ? Object.freeze({kind: 'set-value' as const, value: validation.normalized})
                        : Object.freeze({kind: 'clear-override' as const}),
                    readContext: ALL_WIDTHS_READ_CONTEXT,
                    destination: ALL_WIDTHS_DESTINATION,
                    ...(validation.normalized
                        ? {takeover: 'preserve-inline-effect' as const}
                        : {}),
                }),
            ])
        },
    })
}
