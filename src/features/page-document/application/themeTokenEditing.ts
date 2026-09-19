// 本模块把项目主题令牌检查结果转换为受限表单状态，并通过现有内核意图写回统一草稿。
// 主题写回固定在 project 作用域；分析版本随请求携带，防止主题根的旧读数覆盖新草稿。

import {
    documentFingerprint,
    idempotencyKey,
    interactionId,
    type AnalysisStampId,
    type EditIntent,
    type ThemeTokenInspection,
} from '../domain/kernel/index.ts'
import type {
    KernelDraftEditRequest,
    KernelThemeTokenInspectionResult,
} from './documentKernelDraftRuntime.ts'
import type {DocumentHistoryOptions} from './documentDraftModel.ts'

export interface ThemeTokenField {
    readonly property: string
    readonly label: string
    readonly type: 'color' | 'text'
}

export const THEME_TOKEN_FIELDS: readonly ThemeTokenField[] = Object.freeze([
    Object.freeze({property: '--fc-entry-surface', label: '页面表面', type: 'color' as const}),
    Object.freeze({property: '--fc-entry-text', label: '正文颜色', type: 'color' as const}),
    Object.freeze({property: '--fc-entry-accent', label: '强调色', type: 'color' as const}),
    Object.freeze({property: '--fc-entry-content-width', label: '内容宽度', type: 'text' as const}),
])

export interface ThemeTokenEditorState {
    readonly values: Readonly<Record<string, string>>
    readonly sources: Readonly<Record<string, ThemeTokenInspection | null>>
    readonly dirtyFields: ReadonlySet<string>
    readonly analysisStamp: AnalysisStampId | null
}

export interface ThemeTokenCasContext {
    readonly scope: 'project'
    readonly analysisStamp: AnalysisStampId
}

export function readThemeTokenEditorState(
    result: KernelThemeTokenInspectionResult,
): ThemeTokenEditorState {
    const properties = THEME_TOKEN_FIELDS.map(field => field.property)
    const sources = Object.fromEntries(
        properties.map(property => [property, result.tokens[property] ?? null]),
    ) as Record<string, ThemeTokenInspection | null>
    const firstInspection = properties
        .map(property => sources[property])
        .find((value): value is ThemeTokenInspection => value !== null)
    return Object.freeze({
        values: Object.freeze(
            Object.fromEntries(
                properties.map(property => {
                    const state = sources[property]
                    return [
                        property,
                        state?.managedValue?.rawValue ?? state?.effectiveValue?.rawValue ?? '',
                    ]
                }),
            ),
        ),
        sources: Object.freeze(sources),
        dirtyFields: new Set<string>(),
        analysisStamp: firstInspection?.dependencies.analysisStamp ?? null,
    })
}

export function updateThemeTokenEditorState(
    state: ThemeTokenEditorState,
    property: string,
    value: string,
): ThemeTokenEditorState {
    if (!THEME_TOKEN_FIELDS.some(field => field.property === property)) {
        throw new TypeError(`不支持的主题令牌：${property}`)
    }
    return Object.freeze({
        ...state,
        values: Object.freeze({...state.values, [property]: value}),
        dirtyFields: new Set([...state.dirtyFields, property]),
    })
}

export function createThemeTokenPatch(
    state: ThemeTokenEditorState,
    properties: readonly string[] = [...state.dirtyFields],
): Readonly<Record<string, string | null>> {
    return Object.freeze(
        Object.fromEntries(
            properties
                .filter(property => state.dirtyFields.has(property))
                .map(property => [property, state.values[property]?.trim() || null]),
        ),
    )
}

export function createThemeTokenKernelRequest(
    context: ThemeTokenCasContext,
    tokens: Readonly<Record<string, string | null>>,
    history: DocumentHistoryOptions = {},
    allocateRequestId: () => string = () => crypto.randomUUID(),
): KernelDraftEditRequest {
    if (context.scope !== 'project') throw new TypeError('主题令牌只能写入项目作用域。')
    if (!context.analysisStamp) throw new TypeError('主题令牌写回缺少分析版本。')
    const entries = Object.entries(tokens)
    if (entries.length === 0) throw new TypeError('主题令牌写回至少需要一个字段。')
    if (entries.some(([property]) => !THEME_TOKEN_FIELDS.some(field => field.property === property))) {
        throw new TypeError('主题令牌字段不在页面功能区白名单中。')
    }
    const requestId = allocateRequestId()
    const interactionSeed = history.historyGroupId ?? requestId
    return Object.freeze({
        nodeIds: Object.freeze([]),
        idempotencyKey: idempotencyKey(
            `theme-token:project:${documentFingerprint(`${requestId}:${context.analysisStamp}`)}`,
        ),
        interactionId: interactionId(
            `theme-token:project:${documentFingerprint(`${context.analysisStamp}:${interactionSeed}`)}`,
        ),
        authorizedScopes: Object.freeze(['project'] as const),
        expectedAnalysisStamp: context.analysisStamp,
        createIntents: () => Object.freeze(
            entries.map(([property, value]) => Object.freeze({
                kind: 'edit-theme-token' as const,
                target: Object.freeze({kind: 'theme-root' as const, scope: 'project' as const}),
                property,
                action: value === null
                    ? Object.freeze({kind: 'clear-override' as const})
                    : Object.freeze({kind: 'set-value' as const, value}),
            } satisfies EditIntent)),
        ),
    })
}

export function themeTokenStatusLabel(
    state: ThemeTokenInspection | null,
): string | null {
    if (!state) return '默认'
    if (state.confidence.kind === 'unknown') return '默认'
    if (!state.managedValue) return '默认'
    if (state.managedDeclarations.length > 1) return '多条本级声明'
    return null
}

export function themeTokenValueAccepted(
    field: ThemeTokenField,
    value: string,
): boolean {
    const normalized = value.trim()
    if (!normalized) return true
    if (typeof CSS === 'undefined') return true
    return CSS.supports(field.type === 'color' ? 'color' : 'width', normalized)
}
