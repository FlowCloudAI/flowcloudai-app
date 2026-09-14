// 本模块在计划阶段把规则写入与竞争声明清理扩展为原子行内接管；它保全可证明的视口与交互效果，不替控件猜测未知简写。

import type {DocumentDiagnostic} from '../../contract.ts'
import type {AuthorDeclarationState, PropertyInspection} from '../contracts/analysis.ts'
import type {EditIntent, PropertyEditIntent} from '../contracts/edit.ts'
import type {ReadContext, WriteDestination} from '../contracts/context.ts'
import type {SourceOrigin, SourceScope} from '../contracts/source.ts'
import {decomposableShorthandLonghands} from '../styles/index.ts'
import type {PlanningAnalysisRuntime} from './propertyPlanning.ts'

export type PropertyTakeoverExpansion =
    | {readonly status: 'ready'; readonly intents: readonly EditIntent[]}
    | {readonly status: 'rejected'; readonly diagnostics: readonly DocumentDiagnostic[]}

export function expandPropertyTakeovers(
    runtime: PlanningAnalysisRuntime,
    intents: readonly EditIntent[],
): PropertyTakeoverExpansion {
    if (!runtime.properties) return rejected('candidate-analysis-failed', '候选缺少属性分析器。')
    const preservation: PropertyEditIntent[] = []
    const inlineClears: PropertyEditIntent[] = []
    for (const intent of intents) {
        if (intent.kind !== 'edit-property' || intent.takeover !== 'preserve-inline-effect')
            continue
        const expanded = expandTakeover(runtime, intent)
        if (expanded.status === 'rejected') return expanded
        expanded.intents.forEach(item =>
            item.action.kind === 'clear-override' && item.destination.channel.kind === 'inline'
                ? inlineClears.push(item)
                : preservation.push(item),
        )
    }
    return Object.freeze({
        status: 'ready' as const,
        intents: Object.freeze([
            ...deduplicate(preservation),
            ...deduplicate(inlineClears),
            ...intents,
        ]),
    })
}

function expandTakeover(
    runtime: PlanningAnalysisRuntime,
    intent: PropertyEditIntent,
):
    | {readonly status: 'ready'; readonly intents: readonly PropertyEditIntent[]}
    | {readonly status: 'rejected'; readonly diagnostics: readonly DocumentDiagnostic[]} {
    if (intent.destination.channel.kind === 'inline' || intent.target.kind !== 'component-root') {
        return {status: 'ready', intents: []}
    }
    const analyzer = runtime.properties
    if (!analyzer) return rejected('candidate-analysis-failed', '候选缺少属性分析器。')
    const initial = inspectTarget(analyzer, intent, intent.property, intent.readContext)
    if (!initial) return rejected('stale-component-handle', '无法读取接管属性的当前状态。')
    const inline = initial.directDeclarations.filter(
        declaration => declaration.sourceKind === 'inline' && declaration.condition === 'active',
    )
    const effective = initial.effectiveValue
    const source = effective?.origin.source
    if (!source || source.file !== 'article.html' || inline.length === 0) {
        return {status: 'ready', intents: []}
    }
    if (intent.destination.scope !== source.scope) {
        return rejected(
            'inline-takeover-scope-mismatch',
            '固定行内值与目标规则属于不同作用域，不能自动跨作用域迁移。',
        )
    }
    if (initial.confidence.kind !== 'proven') {
        return rejected(
            'inline-takeover-indeterminate',
            `行内 ${intent.property} 的当前效果无法被完整证明，不能自动迁移。`,
        )
    }
    const winner = inline.find(declaration =>
        sameDeclarationOrigin(declaration, effective.declaredProperty, effective.origin),
    )
    if (!winner || winner.important) {
        return rejected(
            'inline-takeover-unsupported',
            `行内 ${effective.declaredProperty} 不能在保全其他属性后自动迁移。`,
        )
    }
    const affected =
        winner.declaredProperty === intent.property
            ? [intent.property]
            : decomposableShorthandLonghands(winner.declaredProperty, intent.property)
    if (!affected?.includes(intent.property)) {
        return rejected(
            'inline-takeover-shorthand-unsupported',
            `行内简写 ${winner.declaredProperty} 尚不能逐分量无损迁移。`,
        )
    }

    const expanded: PropertyEditIntent[] = []
    for (const property of affected) {
        const state = inspectTarget(analyzer, intent, property, intent.readContext)
        const declaration = state?.directDeclarations.find(item => item.id === winner.id)
        if (!state || !declaration || declaration.resolvedValue === null) {
            return rejected(
                'inline-takeover-component-unresolved',
                `行内简写 ${winner.declaredProperty} 的 ${property} 分量无法完整还原。`,
            )
        }
        if (state.confidence.kind !== 'proven') {
            return rejected(
                'inline-takeover-component-indeterminate',
                `行内简写 ${winner.declaredProperty} 的 ${property} 分量无法被完整证明。`,
            )
        }
        if (
            !sameDeclarationOrigin(
                declaration,
                state.effectiveValue?.declaredProperty,
                state.effectiveValue?.origin,
            )
        ) {
            continue
        }
        const preserved = preserveAcrossContexts(
            runtime,
            intent,
            property,
            declaration.resolvedValue,
            state,
            source.scope,
        )
        if (preserved.status === 'rejected') return preserved
        expanded.push(...preserved.intents)
    }
    expanded.push({
        ...intent,
        property: winner.declaredProperty,
        action: {kind: 'clear-override'},
        destination: {scope: source.scope, channel: {kind: 'inline'}},
        takeover: undefined,
    })
    return {status: 'ready', intents: Object.freeze(expanded)}
}

function preserveAcrossContexts(
    runtime: PlanningAnalysisRuntime,
    target: PropertyEditIntent,
    property: string,
    baselineValue: string,
    initial: PropertyInspection,
    scope: SourceScope,
):
    | {readonly status: 'ready'; readonly intents: readonly PropertyEditIntent[]}
    | {readonly status: 'rejected'; readonly diagnostics: readonly DocumentDiagnostic[]} {
    const analyzer = runtime.properties
    if (!analyzer) return rejected('candidate-analysis-failed', '候选缺少属性分析器。')
    const targetDestination = target.property === property ? target.destination : null
    const result: PropertyEditIntent[] = []
    const mobile = destination(scope, 'mobile')
    if (!targetDestination || !sameDestination(targetDestination, mobile)) {
        result.push(
            preservedIntent(target, property, baselineValue, mobile, context(target, 'mobile')),
        )
    }
    for (const viewport of ['desktop'] as const) {
        const readContext = context(target, viewport)
        const inspected = inspectTarget(analyzer, target, property, readContext)
        if (!inspected)
            return rejected('stale-component-handle', `无法读取 ${property} 的条件状态。`)
        if (!hasActiveConditionalStylesheetDeclaration(inspected)) continue
        const writeDestination = destination(scope, viewport)
        if (targetDestination && sameDestination(targetDestination, writeDestination)) continue
        result.push(preservedIntent(target, property, baselineValue, writeDestination, readContext))
    }
    for (const interaction of ['hover', 'focus-within'] as const) {
        const readContext: ReadContext = {
            ...target.readContext,
            interactions: {
                hover: interaction === 'hover',
                focusWithin: interaction === 'focus-within',
            },
        }
        const inspected = inspectTarget(analyzer, target, property, readContext)
        if (!inspected)
            return rejected('stale-component-handle', `无法读取 ${property} 的交互状态。`)
        if (!hasInteractionOnlyStylesheetDeclaration(initial, inspected)) continue
        const writeDestination: WriteDestination = {
            scope,
            channel: {kind: 'conditional-rule', context: interaction},
        }
        if (targetDestination && sameDestination(targetDestination, writeDestination)) continue
        result.push(preservedIntent(target, property, baselineValue, writeDestination, readContext))
    }
    return {status: 'ready', intents: Object.freeze(result)}
}

function inspectTarget(
    analyzer: NonNullable<PlanningAnalysisRuntime['properties']>,
    intent: PropertyEditIntent,
    property: string,
    context: ReadContext,
): PropertyInspection | null {
    return intent.target.kind === 'semantic-part'
        ? analyzer.inspectTarget(intent.target, property, context)
        : analyzer.inspect(intent.target.component, property, context)
}

function preservedIntent(
    target: PropertyEditIntent,
    property: string,
    value: string,
    writeDestination: WriteDestination,
    readContext: ReadContext,
): PropertyEditIntent {
    return {
        ...target,
        property,
        action: {kind: 'set-value', value},
        destination: writeDestination,
        readContext,
        takeover: undefined,
    }
}

function context(target: PropertyEditIntent, viewport: ReadContext['viewport']): ReadContext {
    return {
        ...target.readContext,
        viewport,
        interactions: {hover: false, focusWithin: false},
    }
}

function destination(scope: SourceScope, viewport: ReadContext['viewport']): WriteDestination {
    return {
        scope,
        channel:
            viewport === 'mobile'
                ? {kind: 'base-rule'}
                : {kind: 'conditional-rule', context: viewport},
    }
}

function hasActiveConditionalStylesheetDeclaration(inspection: PropertyInspection): boolean {
    return inspection.directDeclarations.some(
        declaration =>
            declaration.sourceKind === 'stylesheet' &&
            declaration.condition === 'active' &&
            declaration.media !== null,
    )
}

function hasInteractionOnlyStylesheetDeclaration(
    baseline: PropertyInspection,
    interaction: PropertyInspection,
): boolean {
    const baselineActive = new Set(
        baseline.directDeclarations
            .filter(item => item.sourceKind === 'stylesheet' && item.condition === 'active')
            .map(item => item.id),
    )
    return interaction.directDeclarations.some(
        item =>
            item.sourceKind === 'stylesheet' &&
            item.condition === 'active' &&
            !baselineActive.has(item.id),
    )
}

function sameDeclarationOrigin(
    declaration: AuthorDeclarationState,
    declaredProperty: string | null | undefined,
    origin: SourceOrigin | undefined,
): boolean {
    if (!origin || declaration.declaredProperty !== declaredProperty) return false
    const left = declaration.origin
    return (
        left.kind === origin.kind &&
        left.source?.scope === origin.source?.scope &&
        left.source?.file === origin.source?.file &&
        left.range?.from === origin.range?.from &&
        left.range?.to === origin.range?.to
    )
}

function sameDestination(left: WriteDestination, right: WriteDestination): boolean {
    if (left.scope !== right.scope || left.channel.kind !== right.channel.kind) return false
    return (
        left.channel.kind !== 'conditional-rule' ||
        (right.channel.kind === 'conditional-rule' &&
            left.channel.context === right.channel.context)
    )
}

function deduplicate(intents: readonly PropertyEditIntent[]): readonly PropertyEditIntent[] {
    const unique = new Map<string, PropertyEditIntent>()
    for (const intent of intents) {
        const channel = intent.destination.channel
        const destinationKey =
            channel.kind === 'conditional-rule'
                ? `${channel.kind}:${channel.context}`
                : channel.kind
        const action =
            intent.action.kind === 'set-value' ? `set:${intent.action.value}` : 'clear-override'
        unique.set(
            `${intent.target.component.nodeId}\u0000${intent.property}\u0000${intent.destination.scope}\u0000${destinationKey}\u0000${action}`,
            intent,
        )
    }
    return Object.freeze([...unique.values()])
}

function rejected(
    code: string,
    message: string,
): Extract<PropertyTakeoverExpansion, {status: 'rejected'}> {
    return Object.freeze({
        status: 'rejected',
        diagnostics: Object.freeze([
            {severity: 'error' as const, category: 'capability' as const, code, message},
        ]),
    })
}
