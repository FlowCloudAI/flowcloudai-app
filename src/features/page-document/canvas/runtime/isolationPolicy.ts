// 本模块是画布内的第二道安全门；它在字符串进入活 DOM 前独立拒绝执行能力并移除所有资源加载地址。

import postcss, {type Container, type Declaration, type Rule} from 'postcss'
import {parseFragment, serialize, type DefaultTreeAdapterTypes} from 'parse5'
import {visitCssResourceReferences} from '../../domain/engine/assetReferences.ts'
import {
    FORBIDDEN_HTML_ATTRIBUTES,
    FORBIDDEN_HTML_ATTRIBUTE_PREFIXES,
    FORBIDDEN_HTML_TAGS,
} from '../../domain/engine/htmlPolicy.ts'
import {validateAuthorHref} from '../../domain/engine/hrefPolicy.ts'
import {RFC_9562_UUID_PATTERN} from '../../domain/uuidPolicy.ts'

const FCASSET_PATTERN = /^fcasset:\/\/([0-9a-f-]+)$/iu
const FORBIDDEN_AT_RULES = new Set(['import', 'font-face', 'namespace', 'document', 'page', 'keyframes'])
const RESOURCE_ATTRIBUTES = new Set(['src', 'srcset', 'poster', 'href', 'xlink:href'])
const STRIPPED_LINK_ATTRIBUTES = new Set(['target', 'download', 'referrerpolicy'])

export interface CanvasIsolationArtifact {
    html: string
    css: string
    managedNodeCount: number
    assetIds: string[]
    displayAssetIds: string[]
}

export interface CanvasIsolationResult {
    artifact: CanvasIsolationArtifact | null
    errors: string[]
}

type HtmlNode = DefaultTreeAdapterTypes.Node
type HtmlElement = DefaultTreeAdapterTypes.Element

function childNodes(node: HtmlNode): readonly DefaultTreeAdapterTypes.ChildNode[] {
    if ('tagName' in node && node.tagName === 'template' && 'content' in node) {
        return node.content.childNodes
    }
    return 'childNodes' in node ? node.childNodes : []
}

function isElement(node: HtmlNode): node is HtmlElement {
    return 'tagName' in node && 'attrs' in node
}

function qualifiedName(attribute: HtmlElement['attrs'][number]): string {
    return attribute.prefix
        ? `${attribute.prefix.toLowerCase()}:${attribute.name.toLowerCase()}`
        : attribute.name.toLowerCase()
}

function isLogicalAsset(value: string): string | null {
    const match = FCASSET_PATTERN.exec(value)
    return match && RFC_9562_UUID_PATTERN.test(match[1]) ? match[1].toLowerCase() : null
}

function srcsetAssets(value: string): string[] | null {
    const candidates = value.split(',')
    if (candidates.some(candidate => candidate.trim().length === 0)) return null
    const ids: string[] = []
    for (const candidate of candidates) {
        const [url] = candidate.trim().split(/\s+/u)
        const id = isLogicalAsset(url)
        if (!id) return null
        ids.push(id)
    }
    return ids
}

function isZeroCssLength(value: string): boolean {
    return /^[+-]?(?:0+\.?0*|\.0+)(?:[a-z]+|%)?$/iu.test(value.trim())
}

function isFullscreenInset(value: string): boolean {
    const parts = postcss.list.space(value)
    return parts.length >= 1 && parts.length <= 4 && parts.every(isZeroCssLength)
}

function lastDeclaration(container: Container, property: string): Declaration | undefined {
    return container.nodes
        ?.filter((node): node is Declaration => node.type === 'decl' && node.prop.toLowerCase() === property)
        .at(-1)
}

function hasFullscreenFixedOverlay(container: Container): boolean {
    const position = lastDeclaration(container, 'position')
    if (position?.value.trim().toLowerCase() !== 'fixed') return false
    const inset = lastDeclaration(container, 'inset')
    const longhands = ['top', 'right', 'bottom', 'left'].every(property => {
        const declaration = lastDeclaration(container, property)
        return declaration ? isZeroCssLength(declaration.value) : false
    })
    return Boolean((inset && isFullscreenInset(inset.value)) || longhands)
}

function sanitizeCssContainer(container: Container, errors: string[], assetIds: Set<string>): void {
    container.walkAtRules(rule => {
        if (FORBIDDEN_AT_RULES.has(rule.name.toLowerCase())) {
            errors.push(`画布隔离层拒绝 @${rule.name}。`)
        }
    })
    container.walkRules((rule: Rule) => {
        if (hasFullscreenFixedOverlay(rule)) errors.push('画布隔离层拒绝全屏 fixed 覆盖。')
        if (!/::?(?:before|after)\b/iu.test(rule.selector)) return
        rule.walkDecls(/^content$/iu, declaration => {
            const value = declaration.value.trim().toLowerCase()
            if (value !== 'none' && value !== 'normal') errors.push('画布隔离层拒绝伪元素内容注入。')
        })
    })
    container.walkDecls(declaration => {
        if (declaration.important) errors.push('画布隔离层拒绝 !important。')
        const property = declaration.prop.toLowerCase()
        const value = declaration.value
        const normalized = value.toLowerCase()
        if (property === 'behavior' || property === '-moz-binding' || normalized.includes('expression(') || normalized.includes('javascript:')) {
            errors.push(`画布隔离层拒绝 CSS 执行能力 ${declaration.prop}。`)
        }
        let hasAsset = false
        visitCssResourceReferences(value, reference => {
            const assetId = isLogicalAsset(reference)
            if (!assetId) {
                errors.push('画布隔离层拒绝非 fcasset CSS 资源。')
                return
            }
            hasAsset = true
            assetIds.add(assetId)
        })
        if (hasAsset) declaration.value = 'none'
    })
}

function sanitizeStylesheet(source: string, errors: string[], assetIds: Set<string>): string {
    try {
        const root = postcss.parse(source, {from: undefined})
        sanitizeCssContainer(root, errors, assetIds)
        return root.toString()
    } catch {
        errors.push('画布隔离层无法解析 CSS。')
        return ''
    }
}

function sanitizeInlineStyle(source: string, errors: string[], assetIds: Set<string>): string {
    try {
        const root = postcss.parse(`x{${source}}`, {from: undefined})
        sanitizeCssContainer(root, errors, assetIds)
        const serialized = root.toString()
        return serialized.slice(serialized.indexOf('{') + 1, serialized.lastIndexOf('}'))
    } catch {
        errors.push('画布隔离层无法解析行内 CSS。')
        return ''
    }
}

function sanitizeHtmlElement(element: HtmlElement, errors: string[], assetIds: Set<string>, displayAssetIds: Set<string>): number {
    if (FORBIDDEN_HTML_TAGS.has(element.tagName)) {
        errors.push(`画布隔离层拒绝 <${element.tagName}>。`)
    }
    let managedNodeCount = 0
    const nextAttributes: HtmlElement['attrs'] = []
    let assetPlaceholder = false
    let displayAssetId: string | null = null
    for (const attribute of element.attrs) {
        const name = qualifiedName(attribute)
        if (name === 'data-fc-asset-placeholder' || name === 'data-fc-canvas-asset-id') continue
        if ([...FORBIDDEN_HTML_ATTRIBUTE_PREFIXES].some(prefix => name.startsWith(prefix))) {
            errors.push(`画布隔离层拒绝事件属性 ${name}。`)
            continue
        }
        if (FORBIDDEN_HTML_ATTRIBUTES.has(name) || name === 'contenteditable') {
            errors.push(`画布隔离层拒绝属性 ${name}。`)
            continue
        }
        if ((element.tagName === 'a' || element.tagName === 'area') && STRIPPED_LINK_ATTRIBUTES.has(name)) {
            continue
        }
        if (name === 'style') {
            nextAttributes.push({...attribute, value: sanitizeInlineStyle(attribute.value, errors, assetIds)})
            continue
        }
        if (!RESOURCE_ATTRIBUTES.has(name)) {
            nextAttributes.push(attribute)
            continue
        }
        if ((element.tagName === 'a' || element.tagName === 'area') && name === 'href') {
            if (validateAuthorHref(attribute.value).allowed) nextAttributes.push(attribute)
            continue
        }
        if (name === 'srcset') {
            const ids = srcsetAssets(attribute.value)
            if (!ids) errors.push('画布隔离层拒绝非 fcasset srcset。')
            else ids.forEach(id => assetIds.add(id))
            assetPlaceholder = true
            continue
        }
        const assetId = isLogicalAsset(attribute.value)
        if (!assetId) errors.push(`画布隔离层拒绝 ${name} 的非 fcasset 资源。`)
        else {
            assetIds.add(assetId)
            if (element.tagName === 'img' && name === 'src') {
                displayAssetId = assetId
                displayAssetIds.add(assetId)
            }
        }
        assetPlaceholder = true
    }
    if (assetPlaceholder) {
        nextAttributes.push({name: 'data-fc-asset-placeholder', value: ''})
        if (displayAssetId) nextAttributes.push({name: 'data-fc-canvas-asset-id', value: displayAssetId})
    }
    if (nextAttributes.some(attribute => attribute.name === 'data-fc-node-id')) managedNodeCount += 1
    element.attrs = nextAttributes
    for (const child of childNodes(element)) {
        if (isElement(child)) managedNodeCount += sanitizeHtmlElement(child, errors, assetIds, displayAssetIds)
    }
    return managedNodeCount
}

export function isolatePageDocument(html: string, css: string): CanvasIsolationResult {
    const errors: string[] = []
    const assets = new Set<string>()
    const displayAssets = new Set<string>()
    let fragment: DefaultTreeAdapterTypes.DocumentFragment
    try {
        fragment = parseFragment(html, {scriptingEnabled: false})
    } catch {
        return {artifact: null, errors: ['画布隔离层无法解析 HTML。']}
    }
    let managedNodeCount = 0
    for (const child of fragment.childNodes) {
        if (isElement(child)) managedNodeCount += sanitizeHtmlElement(child, errors, assets, displayAssets)
    }
    const safeCss = sanitizeStylesheet(css, errors, assets)
    if (errors.length > 0) return {artifact: null, errors: [...new Set(errors)]}
    return {
        artifact: {
            html: serialize(fragment),
            css: safeCss,
            managedNodeCount,
            assetIds: [...assets].sort(),
            displayAssetIds: [...displayAssets].sort(),
        },
        errors: [],
    }
}
