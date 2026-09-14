// 本模块一次解析项目与词条样式表，保留每条声明的文件、layer、条件、顺序和源码范围供属性级分析复用。

import postcss, {type AtRule, type Declaration, type Node, type Rule} from 'postcss'
import type {ReadContext} from '../contracts/context.ts'
import {utf16Range, type SourceKey, type SourceOrigin} from '../contracts/source.ts'
import {parseStylesheetSyntax, type SyntaxDiagnostic} from '../syntax/index.ts'

export interface AuthorStylesheetInput {
    readonly key: SourceKey
    readonly content: string
}

export interface IndexedStyleDeclaration {
    readonly id: string
    readonly property: string
    readonly rawValue: string
    readonly important: boolean
    readonly selector: string
    readonly layer: string | null
    readonly layerOrder: number | null
    readonly media: string | null
    readonly unsupportedConditions: readonly string[]
    readonly sourceOrder: number
    readonly ruleOrder: number
    readonly declarationOrder: number
    readonly origin: SourceOrigin
}

export interface AuthorStyleIndex {
    readonly declarations: readonly IndexedStyleDeclaration[]
    readonly diagnostics: readonly SyntaxDiagnostic[]
    declarationsRelatedTo(property: string): readonly IndexedStyleDeclaration[]
}

const VIEWPORT_MEDIA: Readonly<Record<ReadContext['viewport'], readonly string[]>> = {
    mobile: [],
    desktop: ['(min-width:48rem)'],
}

export function createAuthorStyleIndex(
    sources: readonly AuthorStylesheetInput[],
): AuthorStyleIndex {
    const declarations: IndexedStyleDeclaration[] = []
    const diagnostics: SyntaxDiagnostic[] = []
    const parsedSources = sources.map(source => ({
        source,
        parsed: parseStylesheetSyntax(source.content, source.key),
    }))
    const layerOrder = new Map<string, number>()
    parsedSources.forEach(({parsed}) => {
        parsed.root?.walkAtRules(/^layer$/iu, atRule => {
            for (const name of postcss.list.comma(atRule.params)) {
                const normalized = name.trim()
                if (normalized && !layerOrder.has(normalized)) {
                    layerOrder.set(normalized, layerOrder.size)
                }
            }
        })
    })
    parsedSources.forEach(({source, parsed}, sourceOrder) => {
        diagnostics.push(...parsed.diagnostics)
        let ruleOrder = 0
        parsed.root?.walkRules((rule: Rule) => {
            const context = ruleContext(rule)
            let declarationOrder = 0
            rule.each(node => {
                if (node.type !== 'decl') return
                declarations.push(
                    Object.freeze({
                        id: `${source.key.scope}:${source.key.file}:${node.source?.start?.offset ?? declarationOrder}`,
                        property: propertyName(node.prop),
                        rawValue: node.value,
                        important: node.important,
                        selector: rule.selector,
                        layer: context.layer,
                        layerOrder:
                            context.layer === null ? null : (layerOrder.get(context.layer) ?? null),
                        media: context.media,
                        unsupportedConditions: context.unsupported,
                        sourceOrder,
                        ruleOrder,
                        declarationOrder: declarationOrder++,
                        origin: declarationOrigin(source.key, node),
                    }),
                )
            })
            ruleOrder += 1
        })
    })
    const frozen = Object.freeze(declarations)
    const byProperty = new Map<string, readonly IndexedStyleDeclaration[]>()
    return Object.freeze({
        declarations: frozen,
        diagnostics: Object.freeze(diagnostics),
        declarationsRelatedTo: (property: string) => {
            const normalized = propertyName(property)
            const cached = byProperty.get(normalized)
            if (cached) return cached
            const related = Object.freeze(
                declarations.filter(declaration =>
                    propertiesOverlap(normalized, declaration.property),
                ),
            )
            byProperty.set(normalized, related)
            return related
        },
    })
}

export function styleRuleCondition(
    declaration: IndexedStyleDeclaration,
    context: ReadContext,
): {readonly condition: 'active' | 'inactive' | 'indeterminate'; readonly reason: string | null} {
    if (declaration.unsupportedConditions.length > 0) {
        return {
            condition: 'indeterminate',
            reason: `规则位于未建模条件 ${declaration.unsupportedConditions.join('、')} 中。`,
        }
    }
    if (!declaration.media) return {condition: 'active', reason: null}
    const normalized = normalizeCondition(declaration.media)
    if (normalized === '(hover:hover)') {
        return {
            condition: context.interactions.hover ? 'active' : 'inactive',
            reason: context.interactions.hover ? null : '当前环境未激活 hover 媒体条件。',
        }
    }
    const known = Object.values(VIEWPORT_MEDIA).flat()
    if (!known.includes(normalized)) {
        return {condition: 'indeterminate', reason: '媒体条件不在当前有限解释范围内。'}
    }
    const active = VIEWPORT_MEDIA[context.viewport].includes(normalized)
    return {
        condition: active ? 'active' : 'inactive',
        reason: active ? null : '当前视口未命中该媒体条件。',
    }
}

export function propertyName(property: string): string {
    return property.startsWith('--') ? property : property.toLowerCase()
}

export function propertiesOverlap(requested: string, declaration: string): boolean {
    const target = propertyName(requested)
    const candidate = propertyName(declaration)
    if (target === candidate || target === 'all' || candidate === 'all') return true
    if (target.startsWith('--') || candidate.startsWith('--')) return false
    const boxOverlap = boxPropertiesOverlap(target, candidate)
    if (boxOverlap !== null) return boxOverlap
    const targetBorder = borderSlots(target)
    const candidateBorder = borderSlots(candidate)
    if (targetBorder && candidateBorder) {
        return targetBorder.some(slot => candidateBorder.includes(slot))
    }
    return expandedProperties(target).some(property =>
        expandedProperties(candidate).includes(property),
    )
}

type IndexedBoxProperty =
    | {readonly family: 'padding' | 'margin'; readonly kind: 'all'}
    | {
          readonly family: 'padding' | 'margin'
          readonly kind: 'axis'
          readonly axis: 'block' | 'inline'
      }
    | {
          readonly family: 'padding' | 'margin'
          readonly kind: 'side'
          readonly side:
              | 'top'
              | 'right'
              | 'bottom'
              | 'left'
              | 'block-start'
              | 'block-end'
              | 'inline-start'
              | 'inline-end'
      }

function boxPropertiesOverlap(left: string, right: string): boolean | null {
    const target = parseIndexedBoxProperty(left)
    const candidate = parseIndexedBoxProperty(right)
    if (!target || !candidate || target.family !== candidate.family) return null
    if (target.kind === 'all' || candidate.kind === 'all') return true
    if (target.kind === 'axis' && candidate.kind === 'axis') {
        return target.axis === candidate.axis
    }
    if (target.kind === 'axis' || candidate.kind === 'axis') {
        const axis =
            target.kind === 'axis' ? target.axis : candidate.kind === 'axis' ? candidate.axis : null
        const side =
            target.kind === 'side' ? target.side : candidate.kind === 'side' ? candidate.side : null
        if (!axis || !side) return false
        return isPhysicalBoxSide(side) || side.startsWith(`${axis}-`)
    }
    if (isPhysicalBoxSide(target.side) && isPhysicalBoxSide(candidate.side)) {
        return target.side === candidate.side
    }
    if (!isPhysicalBoxSide(target.side) && !isPhysicalBoxSide(candidate.side)) {
        return target.side === candidate.side
    }
    return true
}

function parseIndexedBoxProperty(property: string): IndexedBoxProperty | null {
    const match =
        /^(padding|margin)(?:-(block|inline)(?:-(start|end))?|-(top|right|bottom|left))?$/u.exec(
            property,
        )
    if (!match) return null
    const family = match[1] as IndexedBoxProperty['family']
    if (match[4]) {
        return {
            family,
            kind: 'side',
            side: match[4] as Extract<IndexedBoxProperty, {kind: 'side'}>['side'],
        }
    }
    if (match[2] && match[3]) {
        return {
            family,
            kind: 'side',
            side: `${match[2]}-${match[3]}` as Extract<IndexedBoxProperty, {kind: 'side'}>['side'],
        }
    }
    if (match[2]) return {family, kind: 'axis', axis: match[2] as 'block' | 'inline'}
    return {family, kind: 'all'}
}

function isPhysicalBoxSide(
    side: Extract<IndexedBoxProperty, {kind: 'side'}>['side'],
): side is 'top' | 'right' | 'bottom' | 'left' {
    return side === 'top' || side === 'right' || side === 'bottom' || side === 'left'
}

function borderSlots(property: string): readonly string[] | null {
    if (property === 'border-radius' || property.startsWith('border-radius-')) return null
    const match = /^border(?:-(top|right|bottom|left))?(?:-(width|style|color))?$/u.exec(property)
    if (!match) return null
    const sides = match[1] ? [match[1]] : ['top', 'right', 'bottom', 'left']
    const parts = match[2] ? [match[2]] : ['width', 'style', 'color']
    return sides.flatMap(side => parts.map(part => `${side}-${part}`))
}

function expandedProperties(property: string): readonly string[] {
    if (property === 'font') {
        return ['font-family', 'font-size', 'font-style', 'font-weight', 'line-height']
    }
    if (property === 'background') return ['background-color', 'background-image']
    if (property === 'columns') return ['column-count', 'column-width']
    if (property === 'gap') return ['row-gap', 'column-gap']
    if (property === 'place-items') return ['align-items', 'justify-items']
    if (property === 'place-content') return ['align-content', 'justify-content']
    if (property === 'flex-flow') return ['flex-direction', 'flex-wrap']
    if (property === 'flex') return ['flex-grow', 'flex-shrink', 'flex-basis']
    if (property === 'grid-column') return ['grid-column-start', 'grid-column-end']
    if (property === 'grid-row') return ['grid-row-start', 'grid-row-end']
    if (property === 'grid-template') {
        return ['grid-template-columns', 'grid-template-rows', 'grid-template-areas']
    }
    if (property === 'grid') {
        return [
            'grid-template-columns',
            'grid-template-rows',
            'grid-template-areas',
            'grid-auto-columns',
            'grid-auto-rows',
            'grid-auto-flow',
        ]
    }
    const box = /^(padding|margin)(?:-(block|inline))?$/u.exec(property)
    if (box) {
        const family = box[1]
        const axis = box[2]
        return axis
            ? [`${family}-${axis}-start`, `${family}-${axis}-end`]
            : [
                  `${family}-top`,
                  `${family}-right`,
                  `${family}-bottom`,
                  `${family}-left`,
                  `${family}-block-start`,
                  `${family}-block-end`,
                  `${family}-inline-start`,
                  `${family}-inline-end`,
              ]
    }
    if (property === 'border') {
        return ['border-width', 'border-style', 'border-color']
    }
    const borderPart = /^border-(width|style|color)$/u.exec(property)
    if (borderPart) {
        return ['top', 'right', 'bottom', 'left'].map(side => `border-${side}-${borderPart[1]}`)
    }
    return [property]
}

function ruleContext(rule: Rule): {
    layer: string | null
    media: string | null
    unsupported: readonly string[]
} {
    let layer: string | null = null
    let media: string | null = null
    const unsupported: string[] = []
    let parent: Node | undefined = rule.parent
    while (parent && parent.type !== 'root') {
        if (parent.type !== 'atrule') {
            unsupported.push('CSS nesting')
        } else {
            const atRule = parent as AtRule
            const name = atRule.name.toLowerCase()
            if (name === 'layer' && layer === null) layer = atRule.params.trim()
            else if (name === 'media' && media === null) media = atRule.params.trim()
            else unsupported.push(`@${atRule.name}`)
        }
        parent = parent.parent
    }
    return {layer, media, unsupported: Object.freeze(unsupported)}
}

function declarationOrigin(key: SourceKey, declaration: Declaration): SourceOrigin {
    const start = declaration.source?.start?.offset
    const end = declaration.source?.end?.offset
    return Object.freeze({
        kind: 'author',
        source: key,
        range:
            start === undefined || end === undefined
                ? null
                : utf16Range(start, Math.max(start, end)),
    })
}

function normalizeCondition(value: string): string {
    return value.replace(/\s+/gu, '').toLowerCase()
}
