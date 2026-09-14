// 本模块提取并比较默认模板的 slot/bind 契约，用于要求破坏性变更显式提升 template version。
import type {DocumentDiagnostic} from '../contract.ts'
import {
    findFirstElementByTagName,
    getAttribute,
    hasAttribute,
    hasBlockingDiagnostics,
    parseHtmlSource,
    walkElements,
    type HtmlElement,
    type ParsedHtmlSource,
} from './htmlParser.ts'

export interface TemplateSlotContract {
    name: string
    tagName: string
    optional: boolean
    parentSlot: string | null
}

export interface TemplateBindingContract {
    name: string
    tagName: string
    slot: string | null
}

export interface TemplateContract {
    templateVersion: number
    slots: TemplateSlotContract[]
    bindings: TemplateBindingContract[]
}

export interface TemplateContractChange {
    kind: 'slot_removed' | 'slot_changed' | 'binding_changed'
    key: string
}

export interface TemplateCompatibilityResult {
    breaking: boolean
    changes: TemplateContractChange[]
}

export interface TemplateVersionValidationResult extends TemplateCompatibilityResult {
    previous: TemplateContract | null
    next: TemplateContract | null
    diagnostics: DocumentDiagnostic[]
}

export interface TemplateContractTransitionResult extends TemplateCompatibilityResult {
    diagnostics: DocumentDiagnostic[]
}

function nearestSlot(ancestors: readonly HtmlElement[]): string | null {
    for (const ancestor of [...ancestors].reverse()) {
        const slot = getAttribute(ancestor, 'data-fc-slot')
        if (slot) return slot
    }
    return null
}

export function extractTemplateContract(parsed: ParsedHtmlSource): TemplateContract | null {
    const html = findFirstElementByTagName(parsed.root, 'html')
    const templateVersion = Number(
        html ? getAttribute(html, 'data-fc-template-version') : Number.NaN,
    )
    if (
        !Number.isInteger(templateVersion) ||
        templateVersion < 1 ||
        hasBlockingDiagnostics(parsed.diagnostics)
    ) {
        return null
    }

    const slots: TemplateSlotContract[] = []
    const bindings: TemplateBindingContract[] = []
    walkElements(parsed.root, (element, ancestors) => {
        const slot = getAttribute(element, 'data-fc-slot')
        if (slot) {
            slots.push({
                name: slot,
                tagName: element.tagName,
                optional: hasAttribute(element, 'data-fc-slot-optional'),
                parentSlot: nearestSlot(ancestors),
            })
        }
        const binding = getAttribute(element, 'data-fc-bind')
        if (binding) {
            bindings.push({
                name: binding,
                tagName: element.tagName,
                slot: slot ?? nearestSlot(ancestors),
            })
        }
    })
    slots.sort((left, right) => left.name.localeCompare(right.name))
    bindings.sort(
        (left, right) =>
            left.name.localeCompare(right.name) ||
            (left.slot ?? '').localeCompare(right.slot ?? '') ||
            left.tagName.localeCompare(right.tagName),
    )
    return {templateVersion, slots, bindings}
}

function stableValue(value: unknown): string {
    return JSON.stringify(value)
}

export function compareTemplateContracts(
    previous: TemplateContract,
    next: TemplateContract,
): TemplateCompatibilityResult {
    const changes: TemplateContractChange[] = []
    const nextSlots = new Map(next.slots.map(slot => [slot.name, slot]))
    for (const previousSlot of previous.slots) {
        const nextSlot = nextSlots.get(previousSlot.name)
        if (!nextSlot) {
            changes.push({kind: 'slot_removed', key: previousSlot.name})
        } else if (stableValue(previousSlot) !== stableValue(nextSlot)) {
            changes.push({kind: 'slot_changed', key: previousSlot.name})
        }
    }
    if (stableValue(previous.bindings) !== stableValue(next.bindings)) {
        changes.push({kind: 'binding_changed', key: 'bindings'})
    }
    return {breaking: changes.length > 0, changes}
}

export function validateTemplateVersionChange(
    previousSource: string,
    nextSource: string,
): TemplateVersionValidationResult {
    const previousParsed = parseHtmlSource(previousSource, {mode: 'document', scope: 'project'})
    const nextParsed = parseHtmlSource(nextSource, {mode: 'document', scope: 'project'})
    const diagnostics = [...previousParsed.diagnostics, ...nextParsed.diagnostics]
    const previous = extractTemplateContract(previousParsed)
    const next = extractTemplateContract(nextParsed)
    if (!previous || !next) {
        return {previous, next, breaking: false, changes: [], diagnostics}
    }

    const transition = validateTemplateContractTransition(previous, next)
    diagnostics.push(...transition.diagnostics)
    return {...transition, previous, next, diagnostics}
}

export function validateTemplateContractTransition(
    previous: TemplateContract,
    next: TemplateContract,
): TemplateContractTransitionResult {
    const diagnostics: DocumentDiagnostic[] = []
    const compatibility = compareTemplateContracts(previous, next)
    if (next.templateVersion < previous.templateVersion) {
        diagnostics.push({
            severity: 'error',
            category: 'capability',
            code: 'template_version_regression',
            message: 'template version 不得倒退。',
            file: 'article.html',
        })
    } else if (compatibility.breaking && next.templateVersion <= previous.templateVersion) {
        diagnostics.push({
            severity: 'error',
            category: 'capability',
            code: 'template_version_bump_required',
            message: 'slot/bind 契约发生破坏性变化，必须显式提升 template version。',
            file: 'article.html',
            details: compatibility.changes,
        })
    } else if (!compatibility.breaking && next.templateVersion !== previous.templateVersion) {
        diagnostics.push({
            severity: 'error',
            category: 'capability',
            code: 'unnecessary_template_version_bump',
            message: '兼容的默认模板修改不得提升 template version。',
            file: 'article.html',
        })
    }
    return {...compatibility, diagnostics}
}
