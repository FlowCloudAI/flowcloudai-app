// 本模块在组合树与来源感知样式索引上解析单个属性；级联、继承、变量和适用性都按属性传播不确定性。

import type {DefaultTreeAdapterTypes} from 'parse5'
import valueParser, {type Node as ValueNode} from 'postcss-value-parser'
import type {DocumentDiagnostic} from '../../contract.ts'
import type {HtmlComposition, HtmlCompositionElement} from '../composition/index.ts'
import {
    componentDefinition,
    type ComponentIndex,
    type ComponentSemanticPartId,
} from '../components/index.ts'
import type {
    AuthorConditionState,
    AuthorDeclarationState,
    EffectiveAuthorValue,
    PropertyConfidence,
    PropertyInspection,
} from '../contracts/analysis.ts'
import type {EditTarget, ReadContext, WriteDestination} from '../contracts/context.ts'
import type {AnalysisStampId, ComponentHandle} from '../contracts/identity.ts'
import {sourceKey, type SourceScope} from '../contracts/source.ts'
import {parseDeclarationListSyntax, syntaxDocumentDiagnostic} from '../syntax/index.ts'
import {createSelectorEnvironment, type SelectorEnvironment} from './selectorMatcher.ts'
import {
    declarationValueForProperty,
    isInheritedProperty,
    propertyValueCapability,
} from './propertySemantics.ts'
import {inspectPropertyApplicability} from './styleApplicability.ts'
import {
    propertyName,
    propertiesOverlap,
    styleRuleCondition,
    type AuthorStyleIndex,
    type IndexedStyleDeclaration,
} from './styleIndex.ts'
import {
    addStyleDeclarationDependency,
    addStyleNodeDependency,
    createStyleDependencyCollector,
    finishStyleDependencies,
    type StyleDependencyCollector,
} from './styleDependencies.ts'

export interface PropertyAnalyzerOptions {
    readonly composition: HtmlComposition
    readonly components: ComponentIndex
    readonly styles: AuthorStyleIndex
    readonly analysisStamp: AnalysisStampId
    readonly writableScopes?: readonly SourceScope[]
}

export type ComponentStyleTarget = Extract<
    EditTarget,
    {readonly kind: 'component-root' | 'semantic-part'}
>

export interface PropertyAnalyzer {
    inspect(
        handle: ComponentHandle,
        property: string,
        context: ReadContext,
    ): PropertyInspection | null
    inspectTarget(
        target: ComponentStyleTarget,
        property: string,
        context: ReadContext,
    ): PropertyInspection | null
    /** 供内部语义部位与文本叶子读取同一份作者级联；此入口只读，不宣告写入目的地。 */
    inspectElement(
        element: HtmlCompositionElement,
        property: string,
        context: ReadContext,
    ): PropertyInspection
}

interface CascadeCandidate {
    readonly state: AuthorDeclarationState
    readonly specificity: number
    readonly sourceOrder: number
    readonly ruleOrder: number
    readonly declarationOrder: number
    readonly layerOrder: number | null
}

interface ResolvedProperty {
    readonly effective: EffectiveAuthorValue | null
    readonly confidence: PropertyConfidence
    readonly direct: readonly CascadeCandidate[]
}

export function createPropertyAnalyzer(options: PropertyAnalyzerOptions): PropertyAnalyzer {
    if (options.components.analysisStamp !== options.analysisStamp) {
        throw new TypeError('组件索引与属性分析版本不一致。')
    }
    const selectors = createSelectorEnvironment(options.composition)
    const writableScopes = Object.freeze([...(options.writableScopes ?? ['entry'])])
    return Object.freeze({
        inspect: (handle: ComponentHandle, property: string, context: ReadContext) => {
            const element = options.components.resolveElement(handle)
            if (!element || handle.analysisStamp !== options.analysisStamp) return null
            return inspectProperty(
                element,
                handle,
                propertyName(property),
                context,
                options,
                selectors,
                writableScopes,
            )
        },
        inspectTarget: (target: ComponentStyleTarget, property: string, context: ReadContext) => {
            const element = resolveStyleTarget(options.components, target)
            if (!element || target.component.analysisStamp !== options.analysisStamp) return null
            return inspectProperty(
                element,
                target.component,
                propertyName(property),
                context,
                options,
                selectors,
                writableScopes,
            )
        },
        inspectElement: (element: HtmlCompositionElement, property: string, context: ReadContext) =>
            inspectProperty(
                element,
                null,
                propertyName(property),
                context,
                options,
                selectors,
                writableScopes,
            ),
    })
}

function inspectProperty(
    element: HtmlCompositionElement,
    handle: ComponentHandle | null,
    property: string,
    context: ReadContext,
    options: PropertyAnalyzerOptions,
    selectors: SelectorEnvironment,
    writableScopes: readonly SourceScope[],
): PropertyInspection {
    const dependencies = createStyleDependencyCollector(context)
    addStyleNodeDependency(dependencies.nodeIds, element)
    const diagnostics = styleDiagnostics(options.styles)
    const invalidStylesheet = options.styles.diagnostics.length > 0
    const resolution = resolveProperty(
        element,
        property,
        context,
        options,
        selectors,
        dependencies,
        new Set(),
    )
    const applicability = inspectPropertyApplicability(
        element,
        property,
        (target, targetProperty) =>
            resolveProperty(
                target,
                targetProperty,
                context,
                options,
                selectors,
                dependencies,
                new Set(),
            ),
        parent => addStyleNodeDependency(dependencies.parentNodeIds, parent),
    )
    const confidence: PropertyConfidence = invalidStylesheet
        ? {kind: 'unknown', reason: '至少一个作者样式表存在语法错误。'}
        : resolution.confidence
    const directDeclarations = directDeclarationStates(resolution.direct)
    return Object.freeze({
        propertyFamily: property,
        context,
        directDeclarations,
        effectiveValue: resolution.effective,
        applicability,
        confidence,
        valueCapability: propertyValueCapability(property, resolution.effective, confidence),
        writeDestinations: handle
            ? writeDestinations(options.components.originOfNode(element), context, writableScopes)
            : [],
        dependencies: finishStyleDependencies(dependencies, options.analysisStamp),
        diagnostics: Object.freeze([...diagnostics, ...dependencies.diagnostics]),
    })
}

function resolveProperty(
    element: HtmlCompositionElement,
    property: string,
    context: ReadContext,
    options: PropertyAnalyzerOptions,
    selectors: SelectorEnvironment,
    dependencies: StyleDependencyCollector,
    stack: Set<string>,
): ResolvedProperty {
    const stackKey = `${elementIdentity(element)}:${property}`
    if (stack.has(stackKey)) {
        return {
            effective: null,
            confidence: {kind: 'unknown', reason: `属性 ${property} 的继承或变量引用形成循环。`},
            direct: [],
        }
    }
    stack.add(stackKey)
    const direct = collectCandidates(element, property, context, options, selectors, dependencies)
    const active = direct.filter(candidate => candidate.state.condition === 'active')
    const winner = active.reduce<CascadeCandidate | null>(
        (current, candidate) =>
            current === null || compareCascade(candidate, current) > 0 ? candidate : current,
        null,
    )
    const uncertain = direct.filter(candidate => candidate.state.condition === 'indeterminate')
    const threatening = uncertain.find(
        candidate =>
            winner === null ||
            (candidate.state.id !== winner.state.id && compareCascade(candidate, winner) >= 0),
    )
    let confidence: PropertyConfidence = threatening
        ? {
              kind: 'unknown',
              reason: threatening.state.reason ?? `属性 ${property} 受到无法确定的作者条件影响。`,
          }
        : {kind: 'proven'}
    let effective: EffectiveAuthorValue | null = null
    if (winner) {
        if (winner.state.resolvedValue === null) {
            confidence = {
                kind: 'partial',
                reason: `声明 ${winner.state.declaredProperty} 无法精确还原为 ${property}。`,
            }
        } else if (winner.state.resolvedValue === 'inherit') {
            const inherited = resolveInherited(
                element,
                property,
                context,
                options,
                selectors,
                dependencies,
                stack,
            )
            effective = inherited.effective ? {...inherited.effective, inherited: true} : null
            confidence = combineConfidence(confidence, inherited.confidence)
        } else if (winner.state.resolvedValue === 'unset' && isInheritedProperty(property)) {
            const inherited = resolveInherited(
                element,
                property,
                context,
                options,
                selectors,
                dependencies,
                stack,
            )
            effective = inherited.effective ? {...inherited.effective, inherited: true} : null
            confidence = combineConfidence(confidence, inherited.confidence)
        } else if (
            winner.state.resolvedValue === 'revert' ||
            winner.state.resolvedValue === 'revert-layer'
        ) {
            effective = Object.freeze({
                property,
                declaredProperty: winner.state.declaredProperty,
                rawValue: winner.state.rawValue,
                resolvedValue: null,
                origin: winner.state.origin,
                inherited: false,
            })
            confidence = {
                kind: 'partial',
                reason: `${winner.state.resolvedValue} 需要更完整的级联来源模型。`,
            }
        } else {
            const variableResolution = resolveVariables(
                winner.state.resolvedValue,
                element,
                context,
                options,
                selectors,
                dependencies,
                stack,
            )
            effective = Object.freeze({
                property,
                declaredProperty: winner.state.declaredProperty,
                rawValue: winner.state.rawValue,
                resolvedValue: variableResolution.value,
                origin: winner.state.origin,
                inherited: false,
            })
            confidence = combineConfidence(confidence, variableResolution.confidence)
        }
    } else if (isInheritedProperty(property)) {
        const inherited = resolveInherited(
            element,
            property,
            context,
            options,
            selectors,
            dependencies,
            stack,
        )
        effective = inherited.effective ? {...inherited.effective, inherited: true} : null
        confidence = combineConfidence(confidence, inherited.confidence)
    }
    stack.delete(stackKey)
    return {effective, confidence, direct: Object.freeze(direct)}
}

function resolveInherited(
    element: HtmlCompositionElement,
    property: string,
    context: ReadContext,
    options: PropertyAnalyzerOptions,
    selectors: SelectorEnvironment,
    dependencies: StyleDependencyCollector,
    stack: Set<string>,
): ResolvedProperty {
    const parent = parentElement(element)
    if (!parent) return {effective: null, confidence: {kind: 'proven'}, direct: []}
    addStyleNodeDependency(dependencies.parentNodeIds, parent)
    return resolveProperty(parent, property, context, options, selectors, dependencies, stack)
}

function collectCandidates(
    element: HtmlCompositionElement,
    property: string,
    context: ReadContext,
    options: PropertyAnalyzerOptions,
    selectors: SelectorEnvironment,
    dependencies: StyleDependencyCollector,
): CascadeCandidate[] {
    const result: CascadeCandidate[] = []
    for (const declaration of options.styles.declarationsRelatedTo(property)) {
        const selector = selectors.match(declaration.selector, element, context)
        if (selector.condition === 'not-matched') continue
        const rule = styleRuleCondition(declaration, context)
        const resolvedValue = declarationValueForProperty(property, declaration, context)
        if (resolvedValue === undefined) continue
        for (const branch of selector.branches) {
            if (branch.condition === 'not-matched') continue
            const condition = combinedCondition(branch.condition, rule.condition)
            const reason =
                condition === 'indeterminate'
                    ? branch.condition === 'indeterminate'
                        ? branch.reason
                        : rule.reason
                    : condition === 'inactive'
                      ? branch.condition === 'inactive'
                          ? branch.reason
                          : rule.reason
                      : null
            const state: AuthorDeclarationState = Object.freeze({
                id: declaration.id,
                property,
                declaredProperty: declaration.property,
                rawValue: declaration.rawValue,
                resolvedValue,
                important: declaration.important,
                sourceKind: 'stylesheet',
                selector: declaration.selector,
                layer: declaration.layer,
                media: declaration.media,
                origin: declaration.origin,
                condition,
                reason,
            })
            result.push({
                state,
                specificity: branch.specificity,
                sourceOrder: declaration.sourceOrder,
                ruleOrder: declaration.ruleOrder,
                declarationOrder: declaration.declarationOrder,
                layerOrder: declaration.layerOrder,
            })
            addStyleDeclarationDependency(dependencies, state)
        }
    }
    result.push(...inlineCandidates(element, property, context, options, dependencies))
    return result
}

function directDeclarationStates(
    candidates: readonly CascadeCandidate[],
): readonly AuthorDeclarationState[] {
    const states = new Map<string, AuthorDeclarationState>()
    const rank: Record<AuthorConditionState, number> = {inactive: 1, indeterminate: 2, active: 3}
    for (const candidate of candidates) {
        const existing = states.get(candidate.state.id)
        if (!existing || rank[candidate.state.condition] > rank[existing.condition]) {
            states.set(candidate.state.id, candidate.state)
        }
    }
    return Object.freeze([...states.values()])
}

function inlineCandidates(
    element: HtmlCompositionElement,
    property: string,
    context: ReadContext,
    options: PropertyAnalyzerOptions,
    dependencies: StyleDependencyCollector,
): CascadeCandidate[] {
    const raw = attribute(element, 'style')
    if (!raw?.trim()) return []
    const origin =
        options.composition.sourceMap.originOfAttribute(element, 'style') ??
        options.composition.sourceMap.originOfNode(element) ??
        Object.freeze({kind: 'renderer-generated', source: null, range: null} as const)
    const parsed = parseDeclarationListSyntax(
        raw,
        origin.source ?? sourceKey('entry', 'article.html'),
    )
    if (parsed.diagnostics.length > 0) {
        dependencies.diagnostics.push(...parsed.diagnostics.map(syntaxDocumentDiagnostic))
        const state: AuthorDeclarationState = Object.freeze({
            id: `inline-invalid:${elementIdentity(element)}`,
            property,
            declaredProperty: property,
            rawValue: raw,
            resolvedValue: null,
            important: true,
            sourceKind: 'inline',
            selector: null,
            layer: null,
            media: null,
            origin,
            condition: 'indeterminate',
            reason: '行内 style 存在语法错误，无法可靠读取任何属性。',
        })
        addStyleDeclarationDependency(dependencies, state)
        return [
            {
                state,
                specificity: 1_000_000_000,
                sourceOrder: Number.MAX_SAFE_INTEGER,
                ruleOrder: 0,
                declarationOrder: 0,
                layerOrder: null,
            },
        ]
    }
    return parsed.declarations.flatMap((declaration, index): CascadeCandidate[] => {
        if (!propertiesOverlap(property, declaration.prop)) return []
        const indexed: IndexedStyleDeclaration = {
            id: `inline:${elementIdentity(element)}:${index}`,
            property: propertyName(declaration.prop),
            rawValue: declaration.value,
            important: declaration.important,
            selector: '',
            layer: null,
            layerOrder: null,
            media: null,
            unsupportedConditions: [],
            sourceOrder: Number.MAX_SAFE_INTEGER,
            ruleOrder: 0,
            declarationOrder: index,
            origin,
        }
        const resolvedValue = declarationValueForProperty(property, indexed, context)
        if (resolvedValue === undefined) return []
        const state: AuthorDeclarationState = Object.freeze({
            id: indexed.id,
            property,
            declaredProperty: indexed.property,
            rawValue: indexed.rawValue,
            resolvedValue,
            important: indexed.important,
            sourceKind: 'inline',
            selector: null,
            layer: null,
            media: null,
            origin,
            condition: 'active',
            reason: null,
        })
        addStyleDeclarationDependency(dependencies, state)
        return [
            {
                state,
                specificity: 1_000_000_000,
                sourceOrder: indexed.sourceOrder,
                ruleOrder: 0,
                declarationOrder: index,
                layerOrder: null,
            },
        ]
    })
}

function compareCascade(left: CascadeCandidate, right: CascadeCandidate): number {
    if (left.state.important !== right.state.important) return left.state.important ? 1 : -1
    const leftBucket = cascadeBucket(left)
    const rightBucket = cascadeBucket(right)
    if (leftBucket !== rightBucket) return leftBucket - rightBucket
    if (left.state.layer !== null && right.state.layer !== null) {
        const leftOrder = left.layerOrder ?? 0
        const rightOrder = right.layerOrder ?? 0
        if (leftOrder !== rightOrder) {
            return left.state.important ? rightOrder - leftOrder : leftOrder - rightOrder
        }
    }
    if (left.specificity !== right.specificity) return left.specificity - right.specificity
    if (left.sourceOrder !== right.sourceOrder) return left.sourceOrder - right.sourceOrder
    if (left.ruleOrder !== right.ruleOrder) return left.ruleOrder - right.ruleOrder
    return left.declarationOrder - right.declarationOrder
}

function cascadeBucket(candidate: CascadeCandidate): number {
    if (candidate.state.sourceKind === 'inline') return 4
    if (candidate.state.important) return candidate.state.layer === null ? 2 : 3
    return candidate.state.layer === null ? 3 : 2
}

function resolveVariables(
    rawValue: string,
    element: HtmlCompositionElement,
    context: ReadContext,
    options: PropertyAnalyzerOptions,
    selectors: SelectorEnvironment,
    dependencies: StyleDependencyCollector,
    stack: Set<string>,
): {value: string | null; confidence: PropertyConfidence} {
    if (!rawValue.includes('var(')) return {value: rawValue, confidence: {kind: 'proven'}}
    const nodes = valueParser(rawValue).nodes as ValueNode[]
    const uncertainty: string[] = []
    const visit = (items: ValueNode[]): void => {
        for (let index = 0; index < items.length; index += 1) {
            const node = items[index]
            if (node.type !== 'function') continue
            if (node.value.toLowerCase() !== 'var') {
                visit(node.nodes)
                continue
            }
            const comma = node.nodes.findIndex(child => child.type === 'div' && child.value === ',')
            const name = valueParser
                .stringify(comma < 0 ? node.nodes : node.nodes.slice(0, comma))
                .trim()
            const fallback =
                comma < 0 ? null : valueParser.stringify(node.nodes.slice(comma + 1)).trim()
            if (!/^--[A-Za-z0-9_-]+$/u.test(name)) {
                uncertainty.push('var() 使用了无法识别的变量名称。')
                continue
            }
            dependencies.variables.add(name)
            const variable = resolveProperty(
                element,
                name,
                context,
                options,
                selectors,
                dependencies,
                stack,
            )
            let replacement = variable.effective?.resolvedValue ?? null
            if (replacement !== null && variable.confidence.kind !== 'proven') {
                uncertainty.push(variable.confidence.reason)
            } else if (
                replacement === null &&
                variable.confidence.kind === 'proven' &&
                fallback !== null
            ) {
                const resolvedFallback = resolveVariables(
                    fallback,
                    element,
                    context,
                    options,
                    selectors,
                    dependencies,
                    stack,
                )
                replacement = resolvedFallback.value
                if (resolvedFallback.confidence.kind !== 'proven') {
                    uncertainty.push(resolvedFallback.confidence.reason)
                }
            } else if (replacement === null && variable.confidence.kind !== 'proven') {
                uncertainty.push(variable.confidence.reason)
            }
            if (replacement === null) {
                uncertainty.push(`变量 ${name} 没有可证明的值或回退。`)
                continue
            }
            const parsedReplacement = valueParser(replacement).nodes as ValueNode[]
            items.splice(index, 1, ...parsedReplacement)
            index += parsedReplacement.length - 1
        }
    }
    visit(nodes)
    const confidence: PropertyConfidence =
        uncertainty.length > 0 ? {kind: 'unknown', reason: uncertainty[0]} : {kind: 'proven'}
    return {
        value: confidence.kind === 'unknown' ? null : valueParser.stringify(nodes),
        confidence,
    }
}

function writeDestinations(
    origin: ReturnType<ComponentIndex['originOfNode']>,
    context: ReadContext,
    scopes: readonly SourceScope[],
): readonly WriteDestination[] {
    const result: WriteDestination[] = []
    for (const scope of scopes) {
        if (origin?.source?.scope === scope && origin.source.file === 'article.html') {
            result.push({scope, channel: {kind: 'inline'}})
        }
        result.push({scope, channel: {kind: 'base-rule'}})
        result.push({
            scope,
            channel: {kind: 'conditional-rule', context: viewportContext(context.viewport)},
        })
        if (context.interactions.hover) {
            result.push({scope, channel: {kind: 'conditional-rule', context: 'hover'}})
        }
        if (context.interactions.focusWithin) {
            result.push({scope, channel: {kind: 'conditional-rule', context: 'focus-within'}})
        }
    }
    return Object.freeze(result.map(item => Object.freeze(item)))
}

function resolveStyleTarget(
    components: ComponentIndex,
    target: ComponentStyleTarget,
): HtmlCompositionElement | null {
    if (target.kind === 'component-root') return components.resolveElement(target.component)
    const definition = componentDefinition(target.component.kind)
    const part = definition.semanticParts.find(candidate => candidate.id === target.part)?.id
    if (!part) return null
    const elements = components.resolveSemanticPart(
        target.component,
        part as ComponentSemanticPartId,
    )
    return elements?.length === 1 ? elements[0] : null
}

function combinedCondition(
    selector: Exclude<AuthorConditionState, 'indeterminate'> | 'indeterminate' | 'not-matched',
    rule: AuthorConditionState,
): AuthorConditionState {
    if (selector === 'indeterminate' || rule === 'indeterminate') return 'indeterminate'
    if (selector === 'inactive' || rule === 'inactive') return 'inactive'
    return 'active'
}

function combineConfidence(
    left: PropertyConfidence,
    right: PropertyConfidence,
): PropertyConfidence {
    if (left.kind === 'unknown') return left
    if (right.kind === 'unknown') return right
    if (left.kind === 'partial') return left
    return right
}

function styleDiagnostics(styles: AuthorStyleIndex): DocumentDiagnostic[] {
    return styles.diagnostics.map(syntaxDocumentDiagnostic)
}

function viewportContext(viewport: ReadContext['viewport']): ReadContext['viewport'] {
    return viewport
}

function elementIdentity(element: HtmlCompositionElement): string {
    return (
        attribute(element, 'data-fc-node-id') ??
        `${element.tagName}:${element.sourceCodeLocation?.startOffset ?? -1}`
    )
}

function attribute(element: HtmlCompositionElement, name: string): string | undefined {
    return element.attrs.find(item => item.name === name)?.value
}

function parentElement(node: HtmlCompositionElement): HtmlCompositionElement | null {
    const parent = node.parentNode
    return parent && isElement(parent) ? parent : null
}

function isElement(node: DefaultTreeAdapterTypes.Node): node is HtmlCompositionElement {
    return 'tagName' in node
}
