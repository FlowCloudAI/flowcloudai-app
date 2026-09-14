// 本模块验证候选确实建立或清除了指定目的地声明，并防止被更高优先级规则吞掉的“成功”操作进入草稿。

import type {AuthorDeclarationState} from '../contracts/analysis.ts'
import type {PropertyEditIntent} from '../contracts/edit.ts'
import type {ComponentHandle} from '../contracts/identity.ts'
import type {SourceOrigin} from '../contracts/source.ts'
import {managedRuleTarget, normalizeManagedCondition} from '../patching/index.ts'
import {propertyName, type PropertyAnalyzer} from '../styles/index.ts'

export type PropertyPostconditionResult =
    | {readonly status: 'satisfied'}
    | {readonly status: 'failed'; readonly code: string; readonly message: string}

export function verifyPropertyEditPostcondition(
    analyzer: PropertyAnalyzer,
    handle: ComponentHandle,
    intent: PropertyEditIntent,
): PropertyPostconditionResult {
    const target =
        intent.target.kind === 'semantic-part'
            ? ({...intent.target, component: handle} as const)
            : ({kind: 'component-root', component: handle} as const)
    const inspection = analyzer.inspectTarget(target, intent.property, intent.readContext)
    if (!inspection) return failed('edit-postcondition-target-missing', '候选中找不到属性目标。')

    const property = propertyName(intent.property)
    const destinationDeclarations = inspection.directDeclarations.filter(
        declaration =>
            declaration.declaredProperty === property &&
            declarationMatchesDestination(declaration, handle, intent),
    )
    if (intent.action.kind === 'clear-override') {
        return destinationDeclarations.length === 0
            ? {status: 'satisfied'}
            : failed('edit-postcondition-clear-failed', '候选仍包含应当清除的本级声明。')
    }

    const expected = normalizeValue(intent.action.value)
    const written = destinationDeclarations
        .filter(declaration => normalizeValue(declaration.rawValue) === expected)
        .at(-1)
    if (!written) {
        return failed('edit-postcondition-write-missing', '候选没有建立请求的目标声明。')
    }
    if (isCascadeControlValue(expected)) return {status: 'satisfied'}
    if (inspection.confidence.kind === 'unknown') {
        return failed('edit-postcondition-indeterminate', `候选仍无法证明 ${property} 的当前效果。`)
    }
    const effective = inspection.effectiveValue
    if (!effective || !sameOrigin(effective.origin, written.origin)) {
        return failed(
            'edit-postcondition-overridden',
            `请求写入了 ${property}，但更高优先级的作者声明仍决定当前效果。`,
        )
    }
    return {status: 'satisfied'}
}

function declarationMatchesDestination(
    declaration: AuthorDeclarationState,
    handle: ComponentHandle,
    intent: PropertyEditIntent,
): boolean {
    const source = declaration.origin.source
    if (!source || source.scope !== intent.destination.scope) return false
    if (intent.destination.channel.kind === 'inline') {
        return declaration.sourceKind === 'inline' && source.file === 'article.html'
    }
    const target = managedRuleTarget(
        handle.nodeId,
        handle.kind,
        intent.destination.channel,
        intent.target.kind === 'semantic-part'
            ? (intent.target.part as Parameters<typeof managedRuleTarget>[3])
            : null,
    )
    return (
        declaration.sourceKind === 'stylesheet' &&
        source.file === 'style.css' &&
        declaration.layer === 'fc-node' &&
        declaration.selector?.trim() === target.selector &&
        normalizeManagedCondition(declaration.media) === normalizeManagedCondition(target.media)
    )
}

function sameOrigin(left: SourceOrigin, right: SourceOrigin): boolean {
    if (left.kind !== right.kind) return false
    if (left.source?.scope !== right.source?.scope || left.source?.file !== right.source?.file) {
        return false
    }
    if (!left.range || !right.range) return left.range === right.range
    return left.range.from === right.range.from && left.range.to === right.range.to
}

function normalizeValue(value: string): string {
    return value.trim().replace(/\s+/gu, ' ')
}

function isCascadeControlValue(value: string): boolean {
    return /^(?:inherit|initial|unset|revert|revert-layer)$/iu.test(value)
}

function failed(code: string, message: string): PropertyPostconditionResult {
    return Object.freeze({status: 'failed', code, message})
}
