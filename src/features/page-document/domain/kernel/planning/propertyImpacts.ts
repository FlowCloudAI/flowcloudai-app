// 本模块比较属性编辑前后的多上下文作者状态；只把新增的条件语义损失升级为需要用户决定的影响。

import type {PropertyInspection} from '../contracts/analysis.ts'
import type {PropertyEditIntent, EditImpact} from '../contracts/edit.ts'
import type {ReadContext, WriteDestination} from '../contracts/context.ts'
import type {ComponentHandle} from '../contracts/identity.ts'
import type {PropertyAnalyzer} from '../styles/index.ts'

export interface PropertyImpactAnalysisInput {
    readonly before: PropertyAnalyzer
    readonly after: PropertyAnalyzer
    readonly beforeHandle: ComponentHandle
    readonly afterHandle: ComponentHandle
    readonly intent: PropertyEditIntent
}

const VIEWPORTS = ['mobile', 'desktop'] as const
const INTERACTIONS = [
    {hover: false, focusWithin: false},
    {hover: true, focusWithin: false},
    {hover: false, focusWithin: true},
    {hover: true, focusWithin: true},
] as const

export function analyzePropertyEditImpacts(
    input: PropertyImpactAnalysisInput,
): readonly EditImpact[] {
    const referenceBefore = input.before.inspectTarget(
        targetFor(input.intent, input.beforeHandle),
        input.intent.property,
        input.intent.readContext,
    )
    if (!referenceBefore) return Object.freeze([])

    const affectedContexts = contextsAffectedBy(input.intent.destination, input.intent.readContext)
    const changedConditionalContexts: ReadContext[] = []
    const newlyMaskedUnknownContexts: ReadContext[] = []
    const referenceValue = semanticValue(referenceBefore)

    for (const context of affectedContexts) {
        const before = input.before.inspectTarget(
            targetFor(input.intent, input.beforeHandle),
            input.intent.property,
            context,
        )
        const after = input.after.inspectTarget(
            targetFor(input.intent, input.afterHandle),
            input.intent.property,
            context,
        )
        if (!before || !after) continue

        if (before.confidence.kind === 'unknown' && after.confidence.kind !== 'unknown') {
            newlyMaskedUnknownContexts.push(context)
            continue
        }
        if (sameContext(context, input.intent.readContext)) continue
        const beforeValue = semanticValue(before)
        if (beforeValue === referenceValue) continue
        if (beforeValue !== semanticValue(after)) changedConditionalContexts.push(context)
    }

    const impacts: EditImpact[] = []
    if (newlyMaskedUnknownContexts.length > 0) {
        impacts.push(
            impact(
                'mask-indeterminate-author-condition',
                `此次修改会遮住 ${contextSummary(newlyMaskedUnknownContexts)} 中无法可靠解释的同属性声明；原规则会保留，但不再决定当前效果。`,
            ),
        )
    }
    if (changedConditionalContexts.length > 0) {
        impacts.push(
            impact(
                'replace-context-specific-author-value',
                `此次修改会同时改变 ${contextSummary(changedConditionalContexts)} 中原本不同的同属性效果。`,
            ),
        )
    }
    return Object.freeze(impacts)
}

function targetFor(intent: PropertyEditIntent, handle: ComponentHandle) {
    return intent.target.kind === 'semantic-part'
        ? ({...intent.target, component: handle} as const)
        : ({kind: 'component-root', component: handle} as const)
}

function contextsAffectedBy(
    destination: WriteDestination,
    basis: ReadContext,
): readonly ReadContext[] {
    const contexts: ReadContext[] = []
    for (const viewport of VIEWPORTS) {
        for (const interactions of INTERACTIONS) {
            if (!destinationMatches(destination, viewport, interactions)) continue
            contexts.push(
                Object.freeze({
                    viewport,
                    interactions: Object.freeze({...interactions}),
                    direction: basis.direction,
                    writingMode: basis.writingMode,
                }),
            )
        }
    }
    return Object.freeze(contexts)
}

function destinationMatches(
    destination: WriteDestination,
    viewport: ReadContext['viewport'],
    interactions: ReadContext['interactions'],
): boolean {
    if (destination.channel.kind !== 'conditional-rule') return true
    switch (destination.channel.context) {
        case 'mobile':
        case 'desktop':
            return destination.channel.context === viewport
        case 'hover':
            return interactions.hover
        case 'focus-within':
            return interactions.focusWithin
    }
}

function semanticValue(inspection: PropertyInspection): string {
    if (!inspection.effectiveValue) return '<absent>'
    const value = inspection.effectiveValue.resolvedValue ?? inspection.effectiveValue.rawValue
    return value.trim().replace(/\s+/gu, ' ')
}

function sameContext(left: ReadContext, right: ReadContext): boolean {
    return (
        left.viewport === right.viewport &&
        left.interactions.hover === right.interactions.hover &&
        left.interactions.focusWithin === right.interactions.focusWithin &&
        left.direction === right.direction &&
        left.writingMode === right.writingMode
    )
}

function contextSummary(contexts: readonly ReadContext[]): string {
    const labels = new Set(
        contexts.map(context => {
            const states = [
                context.interactions.hover ? '悬停' : null,
                context.interactions.focusWithin ? '聚焦' : null,
            ].filter((item): item is string => item !== null)
            return `${viewportLabel(context.viewport)}${states.length > 0 ? `／${states.join('＋')}` : ''}`
        }),
    )
    const values = [...labels]
    return values.length <= 4
        ? values.join('、')
        : `${values.slice(0, 4).join('、')}等 ${values.length} 个上下文`
}

function viewportLabel(viewport: ReadContext['viewport']): string {
    switch (viewport) {
        case 'mobile':
            return '移动'
        case 'desktop':
            return '桌面'
    }
}

function impact(code: string, message: string): EditImpact {
    return Object.freeze({code, message, requiresDecision: true})
}
