// 本模块只维护项目或词条规范主题根中的单个 --fc-* 声明；其他规则、条件、注释和声明保持原样。

import type {AtRule, Declaration, Node, Rule} from 'postcss'
import {utf16Range, type SourceDocument} from '../contracts/source.ts'
import {parsePropertyValueSyntax, parseStylesheetSyntax} from '../syntax/index.ts'
import {matchesThemeTokenSelector, themeTokenSelector} from '../styles/index.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type ThemeTokenPatchResult =
    | {readonly status: 'ready'; readonly patches: readonly SourcePatch[]}
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

const THEME_TOKEN_PATTERN = /^--fc-[a-z0-9][a-z0-9-]*$/u
const MAX_TOKEN_VALUE_LENGTH = 4_096

export function createThemeTokenPatches(
    document: SourceDocument,
    entryId: string,
    propertyInput: string,
    value: string | null,
): ThemeTokenPatchResult {
    if (document.key.file !== 'style.css') {
        return rejected('theme-token-source-invalid', '主题令牌只能写入 style.css。')
    }
    const property = propertyInput.toLowerCase()
    if (!THEME_TOKEN_PATTERN.test(property)) {
        return rejected('theme-token-property-invalid', '主题令牌必须使用 --fc-* 属性名。')
    }
    if (value !== null) {
        if (value.length > MAX_TOKEN_VALUE_LENGTH) {
            return rejected('theme-token-value-too-large', `令牌 ${property} 的值超过长度限制。`)
        }
        const parsedValue = parsePropertyValueSyntax(property, value, document.key)
        const declaration = parsedValue.declarations[0]
        if (parsedValue.diagnostics.length > 0 || !declaration || declaration.important) {
            return rejected('theme-token-value-invalid', `令牌 ${property} 的值不是单一普通声明。`)
        }
    }
    const parsed = parseStylesheetSyntax(document.content, document.key)
    if (!parsed.root || parsed.diagnostics.length > 0) {
        return rejected('invalid-stylesheet', '现有样式表语法无效，不能修改主题令牌。')
    }
    const scope = document.key.scope
    const layerName = `fc-${scope}`
    const selector = themeTokenSelector(scope, entryId)
    const layers = parsed.root.nodes.filter(node => isCanonicalLayer(node, layerName))
    const rules = layers.flatMap(layer =>
        (layer.nodes ?? []).filter(
            (node): node is Rule =>
                node.type === 'rule' && matchesThemeTokenSelector(node.selector, scope, entryId),
        ),
    )
    const declarations = rules.flatMap(rule =>
        (rule.nodes ?? []).filter(
            (node): node is Declaration =>
                node.type === 'decl' && node.prop.toLowerCase() === property,
        ),
    )

    if (value === null) {
        if (declarations.length === 0) return {status: 'unchanged'}
        const removals = declarations.map(declaration => removeDeclaration(document, declaration))
        if (removals.some(patch => patch === null)) {
            return rejected('source-location-missing', '无法定位待清除的主题令牌声明。')
        }
        return ready(removals.filter((patch): patch is SourcePatch => patch !== null))
    }

    const retained = managedWinner(declarations)
    if (retained) {
        const duplicates = declarations.filter(declaration => declaration !== retained)
        if (duplicates.length === 0 && retained.value === value) return {status: 'unchanged'}
        const replacement =
            retained.value === value ? null : replaceDeclarationValue(document, retained, value)
        const removals = duplicates.map(declaration => removeDeclaration(document, declaration))
        if ((!replacement && retained.value !== value) || removals.some(patch => patch === null)) {
            return rejected('source-location-missing', '无法精确定位主题令牌声明。')
        }
        return ready([
            ...removals.filter((patch): patch is SourcePatch => patch !== null),
            ...(replacement ? [replacement] : []),
        ])
    }

    const rule = rules.at(-1)
    if (rule) {
        const at = closingBraceOffset(document.content, rule)
        if (at === null) return rejected('source-location-missing', '无法定位主题根规则结尾。')
        return ready([
            insertionPatch(
                document,
                at,
                declarationInsertion(document.content, rule, property, value),
            ),
        ])
    }
    const layer = layers.at(-1)
    if (layer) {
        const at = closingBraceOffset(document.content, layer)
        if (at === null) return rejected('source-location-missing', '无法定位主题 layer 结尾。')
        return ready([insertionPatch(document, at, renderRule(selector, property, value, '  '))])
    }
    const separator = document.content.length === 0 || document.content.endsWith('\n') ? '' : '\n'
    return ready([
        insertionPatch(
            document,
            document.content.length,
            `${separator}@layer ${layerName} {${renderRule(selector, property, value, '  ')}\n}\n`,
        ),
    ])
}

function isCanonicalLayer(node: Node, name: string): node is AtRule {
    if (node.type !== 'atrule') return false
    const atRule = node as AtRule
    return (
        atRule.name.toLowerCase() === 'layer' &&
        atRule.params.trim() === name &&
        Array.isArray(atRule.nodes) &&
        atRule.parent?.type === 'root'
    )
}

function managedWinner(declarations: readonly Declaration[]): Declaration | null {
    const important = declarations.filter(declaration => declaration.important)
    return (important.length > 0 ? important : declarations).at(-1) ?? null
}

function replaceDeclarationValue(
    document: SourceDocument,
    declaration: Declaration,
    value: string,
): SourcePatch | null {
    const start = declaration.source?.start?.offset
    if (start === undefined) return null
    const rawValue = declaration.raws.value?.raw ?? declaration.value
    const from = start + declaration.prop.length + (declaration.raws.between ?? ':').length
    return Object.freeze({
        source: document.key,
        range: utf16Range(from, from + rawValue.length),
        expected: rawValue,
        insert: value,
    })
}

function removeDeclaration(document: SourceDocument, declaration: Declaration): SourcePatch | null {
    const start = declaration.source?.start?.offset
    const end = declaration.source?.end?.offset
    if (start === undefined || end === undefined) return null
    let to = end
    if (document.content[to] === ';') to += 1
    return Object.freeze({
        source: document.key,
        range: utf16Range(start, to),
        expected: document.content.slice(start, to),
        insert: '',
    })
}

function closingBraceOffset(source: string, node: AtRule | Rule): number | null {
    const end = node.source?.end?.offset
    if (end === undefined) return null
    return source[end - 1] === '}' ? end - 1 : null
}

function declarationInsertion(source: string, rule: Rule, property: string, value: string): string {
    const closing = closingBraceOffset(source, rule)
    if (closing === null) return `\n  ${property}: ${value};\n`
    const lineStart = source.lastIndexOf('\n', closing - 1) + 1
    const braceIndent = source.slice(lineStart, closing).match(/^\s*/u)?.[0] ?? ''
    return `\n${braceIndent}  ${property}: ${value};\n${braceIndent}`
}

function renderRule(selector: string, property: string, value: string, indent: string): string {
    return `\n${indent}${selector} {\n${indent}  ${property}: ${value};\n${indent}}\n`
}

function insertionPatch(document: SourceDocument, at: number, insert: string): SourcePatch {
    return Object.freeze({
        source: document.key,
        range: utf16Range(at, at),
        expected: '',
        insert,
    })
}

function ready(patches: readonly SourcePatch[]): ThemeTokenPatchResult {
    return Object.freeze({status: 'ready', patches: Object.freeze(patches)})
}

function rejected(code: string, message: string): ThemeTokenPatchResult {
    return Object.freeze({status: 'rejected', code, message})
}
