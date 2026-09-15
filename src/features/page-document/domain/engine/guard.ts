// 本模块执行作者侧能力与资源预检；它只报告问题，不删除、改写或“修复”用户 HTML/CSS。
import postcss, {
    type AtRule,
    type Container as CssContainer,
    type Declaration,
    type Node as CssNode,
    type Rule,
} from 'postcss'
import {
    type CssDeclarationPatch,
    DOCUMENT_NODE_KINDS,
    type DocumentDiagnostic,
    type DocumentDiagnosticCategory,
    type DocumentNodeKind,
    type SourceRange,
} from '../contract.ts'
import {sourceKey} from '../kernel/contracts/source.ts'
import {parseDeclarationListSyntax} from '../kernel/syntax/index.ts'
import {cssNodeRange, type ParsedCssSource} from './cssParser.ts'
import {DOCUMENT_LIMITS} from './limits.ts'
import {
    attributeRange,
    childNodes,
    elementRange,
    findElementsByAttribute,
    getAttribute,
    isElement,
    type HtmlElement,
    type ParsedHtmlSource,
} from './htmlParser.ts'
import {validateAuthorHref} from './hrefPolicy.ts'
import {visitCssResourceReferences} from './assetReferences.ts'
import {visualTextPseudoElements} from './visualTextCompatibility.ts'
import {visualCssCompatibilityDiagnostics} from './visualCssCompatibility.ts'
import {
    elementAncestorMap,
    isSemanticallyHidden,
    visibleManagedParagraphs,
} from './nodeVisibility.ts'
import {RFC_9562_UUID_PATTERN} from '../uuidPolicy.ts'

const LOGICAL_ASSET_PATTERN = /^fcasset:\/\/([0-9a-f-]+)$/i
export const FORBIDDEN_HTML_TAGS = new Set([
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'textarea',
    'select',
    'button',
    'base',
    'link',
    'meta',
])
export const FORBIDDEN_HTML_ATTRIBUTES = new Set([
    'ping',
    'action',
    'formaction',
    'background',
])
export const FORBIDDEN_HTML_ATTRIBUTE_PREFIXES = new Set(['on'])
export const MANAGED_RESOURCE_ATTRIBUTES = {
    allElements: new Set(['src', 'srcset', 'poster']),
    nonLinkElements: new Set(['href', 'xlink:href']),
    linkElements: new Set(['a', 'area']),
}
export const URL_ATTRIBUTES = new Set([
    ...FORBIDDEN_HTML_ATTRIBUTES,
    ...MANAGED_RESOURCE_ATTRIBUTES.allElements,
    ...MANAGED_RESOURCE_ATTRIBUTES.nonLinkElements,
])
export const FORBIDDEN_AT_RULES = new Set(['import', 'font-face', 'namespace', 'document', 'page'])

export interface DocumentGuardOptions {
    knownAssetIds?: ReadonlySet<string>
    paragraphLimit?: number
    assetLimit?: number
}

export interface DocumentGuardResult {
    diagnostics: DocumentDiagnostic[]
    referencedAssetIds: string[]
}

/**
 * 校验受控 operation 新写入的声明；调用方仍须负责目标选择器、layer 与最终源码语法。
 * 这里与全量 guard 共用声明、资源和 fixed 覆盖规则，避免“快速路径”形成第二套安全策略。
 */
export function guardCssDeclarationPatch(
    patch: CssDeclarationPatch,
    options: Pick<DocumentGuardOptions, 'knownAssetIds'> = {},
): DocumentGuardResult {
    const diagnostics: DocumentDiagnostic[] = []
    const referenced = new Set<string>()
    const declarations = Object.entries(patch).filter(
        (entry): entry is [string, string] => entry[1] !== null,
    )
    if (declarations.length === 0) return {diagnostics, referencedAssetIds: []}
    if (declarations.some(([, value]) => /<\/style/iu.test(value))) {
        diagnostics.push(
            cssDiagnostic('unsafe_style_terminator', 'CSS 源码不得包含 style 结束标签。'),
        )
        return {diagnostics, referencedAssetIds: []}
    }
    const parsed = parseDeclarationListSyntax(
        declarations.map(([property, value]) => `${property}:${value};`).join(''),
        sourceKey('entry', 'style.css'),
    )
    if (parsed.diagnostics.length === 0 && parsed.rule) {
        const knownAssets = options.knownAssetIds
            ? new Set([...options.knownAssetIds].map(id => id.toLowerCase()))
            : undefined
        for (const declaration of parsed.declarations) {
            validateDeclaration(
                declaration,
                diagnostics,
                referenced,
                knownAssets,
                undefined,
                'style.css',
            )
        }
        validateFixedOverlay(parsed.rule, diagnostics)
    } else {
        diagnostics.push(
            cssDiagnostic(
                'invalid_css_declaration',
                'CSS 声明批次无法解析。',
                undefined,
                'style.css',
                'capability',
            ),
        )
    }
    return {diagnostics, referencedAssetIds: [...referenced].sort()}
}

function htmlDiagnostic(
    code: string,
    message: string,
    element: HtmlElement,
    attributeName?: string,
    category: DocumentDiagnosticCategory = 'security',
): DocumentDiagnostic {
    return {
        severity: 'error',
        category,
        code,
        message,
        file: 'article.html',
        range: attributeName
            ? (attributeRange(element, attributeName) ?? elementRange(element))
            : elementRange(element),
        nodeId: getAttribute(element, 'data-fc-node-id'),
    }
}

function cssDiagnostic(
    code: string,
    message: string,
    range?: SourceRange,
    file: 'article.html' | 'style.css' = 'style.css',
    category: DocumentDiagnosticCategory = 'security',
): DocumentDiagnostic {
    return {severity: 'error', category, code, message, file, range}
}

function registerAssetReference(
    value: string,
    diagnostics: DocumentDiagnostic[],
    referenced: Set<string>,
    range: SourceRange | undefined,
    knownAssets: ReadonlySet<string> | undefined,
    file: 'article.html' | 'style.css',
): void {
    const match = LOGICAL_ASSET_PATTERN.exec(value)
    if (!match || !RFC_9562_UUID_PATTERN.test(match[1])) {
        diagnostics.push(
            cssDiagnostic(
                'invalid_asset_reference',
                '资产 URL 必须是 fcasset://<uuid>。',
                range,
                file,
            ),
        )
        return
    }
    const assetId = match[1].toLowerCase()
    referenced.add(assetId)
    if (knownAssets && !knownAssets.has(assetId)) {
        diagnostics.push(
            cssDiagnostic(
                'missing_asset',
                `资产 ${assetId} 不在当前词条索引中。`,
                range,
                file,
                'resource',
            ),
        )
    }
}

function qualifiedAttributeName(attribute: HtmlElement['attrs'][number]): string {
    const name = attribute.name.toLowerCase()
    return attribute.prefix ? `${attribute.prefix.toLowerCase()}:${name}` : name
}

function registerHtmlAssetReference(
    element: HtmlElement,
    attributeName: string,
    value: string,
    diagnostics: DocumentDiagnostic[],
    referenced: Set<string>,
    knownAssets: ReadonlySet<string> | undefined,
): void {
    registerAssetReference(
        value,
        diagnostics,
        referenced,
        attributeRange(element, attributeName) ?? elementRange(element),
        knownAssets,
        'article.html',
    )
}

function validateHtmlSrcset(
    element: HtmlElement,
    attributeName: string,
    value: string,
    diagnostics: DocumentDiagnostic[],
    referenced: Set<string>,
    knownAssets: ReadonlySet<string> | undefined,
): void {
    const candidates = value.split(',')
    if (candidates.some(candidate => candidate.trim().length === 0)) {
        diagnostics.push(
            htmlDiagnostic(
                'invalid_asset_reference',
                'srcset 必须包含非空的 fcasset://<uuid> 候选地址。',
                element,
                attributeName,
            ),
        )
        return
    }
    for (const candidate of candidates) {
        const [url] = candidate.trim().split(/\s+/u)
        registerHtmlAssetReference(
            element,
            attributeName,
            url,
            diagnostics,
            referenced,
            knownAssets,
        )
    }
}

function validateResourceFunctions(
    value: string,
    diagnostics: DocumentDiagnostic[],
    referenced: Set<string>,
    knownAssets: ReadonlySet<string> | undefined,
    range: SourceRange | undefined,
    file: 'article.html' | 'style.css',
): void {
    visitCssResourceReferences(value, reference =>
        registerAssetReference(reference, diagnostics, referenced, range, knownAssets, file),
    )
}

function validateInlineStyle(
    element: HtmlElement,
    scope: 'project' | 'entry',
    diagnostics: DocumentDiagnostic[],
    referenced: Set<string>,
    knownAssets: ReadonlySet<string> | undefined,
): void {
    const style = getAttribute(element, 'style')
    if (style === undefined) return
    const range = attributeRange(element, 'style') ?? elementRange(element)
    if (/<\/style/iu.test(style)) {
        diagnostics.push(
            htmlDiagnostic(
                'unsafe_style_terminator',
                '内联样式不得包含 style 结束标签。',
                element,
                'style',
            ),
        )
        return
    }
    const parsed = parseDeclarationListSyntax(style, sourceKey(scope, 'article.html'))
    if (parsed.diagnostics.length === 0 && parsed.rule) {
        for (const declaration of parsed.declarations) {
            validateDeclaration(
                declaration,
                diagnostics,
                referenced,
                knownAssets,
                range,
                'article.html',
            )
        }
        validateFixedOverlay(parsed.rule, diagnostics, range, 'article.html')
    } else {
        diagnostics.push(
            htmlDiagnostic(
                'invalid_inline_style',
                'style 属性必须是有效 CSS 声明列表。',
                element,
                'style',
                'capability',
            ),
        )
    }
}

function validateHtml(
    parsed: ParsedHtmlSource,
    options: DocumentGuardOptions,
    diagnostics: DocumentDiagnostic[],
    referenced: Set<string>,
): void {
    const knownAssets = options.knownAssetIds
        ? new Set([...options.knownAssetIds].map(id => id.toLowerCase()))
        : undefined

    for (const element of parsed.elements) {
        if (FORBIDDEN_HTML_TAGS.has(element.tagName)) {
            diagnostics.push(
                htmlDiagnostic(
                    'forbidden_html_element',
                    `作者 HTML 不允许使用 <${element.tagName}>。`,
                    element,
                ),
            )
        }
        if (element.tagName === 'meta' && getAttribute(element, 'http-equiv') !== undefined) {
            diagnostics.push(
                htmlDiagnostic(
                    'forbidden_meta_http_equiv',
                    '作者 HTML 不允许通过 meta http-equiv 注入运行策略。',
                    element,
                    'http-equiv',
                ),
            )
        }

        for (const attribute of element.attrs) {
            const name = qualifiedAttributeName(attribute)
            if (name.startsWith('data-fc-preview-')) {
                diagnostics.push(
                    htmlDiagnostic(
                        'forbidden_preview_runtime_attribute',
                        '作者 HTML 不得声明预览运行时保留属性。',
                        element,
                        name,
                    ),
                )
            }
            if (
                [...FORBIDDEN_HTML_ATTRIBUTE_PREFIXES].some(prefix => name.startsWith(prefix))
            ) {
                diagnostics.push(
                    htmlDiagnostic(
                        'forbidden_event_handler',
                        '作者 HTML 不允许内联事件处理器。',
                        element,
                        name,
                    ),
                )
                continue
            }
            if (name === 'contenteditable') {
                diagnostics.push(
                    htmlDiagnostic(
                        'forbidden_contenteditable',
                        '预览 DOM 的编辑状态由系统 bridge 管理，作者 HTML 不得声明 contenteditable。',
                        element,
                        name,
                    ),
                )
            }
            if (FORBIDDEN_HTML_ATTRIBUTES.has(name)) {
                diagnostics.push(
                    htmlDiagnostic(
                        'forbidden_html_attribute',
                        `作者 HTML 不允许使用 ${name} 属性。`,
                        element,
                        name,
                    ),
                )
                continue
            }
            if (!URL_ATTRIBUTES.has(name)) continue

            if (MANAGED_RESOURCE_ATTRIBUTES.linkElements.has(element.tagName) && name === 'href') {
                const validation = validateAuthorHref(attribute.value)
                if (!validation.allowed) {
                    diagnostics.push(
                        htmlDiagnostic(validation.code, validation.message, element, name),
                    )
                }
            } else if (element.tagName === 'img' && name === 'src') {
                const match = LOGICAL_ASSET_PATTERN.exec(attribute.value)
                if (!match || !RFC_9562_UUID_PATTERN.test(match[1])) {
                    diagnostics.push(
                        htmlDiagnostic(
                            'invalid_asset_reference',
                            'img src 必须是 fcasset://<uuid>。',
                            element,
                            name,
                        ),
                    )
                } else {
                    const assetId = match[1].toLowerCase()
                    referenced.add(assetId)
                    const declaredId = getAttribute(element, 'data-fc-asset-id')?.toLowerCase()
                    if (declaredId !== assetId) {
                        diagnostics.push(
                            htmlDiagnostic(
                                'asset_id_mismatch',
                                'img 的 data-fc-asset-id 必须与 src UUID 一致。',
                                element,
                                'data-fc-asset-id',
                                'capability',
                            ),
                        )
                    }
                    if (knownAssets && !knownAssets.has(assetId)) {
                        diagnostics.push(
                            htmlDiagnostic(
                                'missing_asset',
                                `资产 ${assetId} 不在当前词条索引中。`,
                                element,
                                name,
                                'resource',
                            ),
                        )
                    }
                }
            } else if (name === 'srcset') {
                validateHtmlSrcset(
                    element,
                    name,
                    attribute.value,
                    diagnostics,
                    referenced,
                    knownAssets,
                )
            } else if (
                MANAGED_RESOURCE_ATTRIBUTES.allElements.has(name) ||
                (MANAGED_RESOURCE_ATTRIBUTES.nonLinkElements.has(name) &&
                    !MANAGED_RESOURCE_ATTRIBUTES.linkElements.has(element.tagName))
            ) {
                registerHtmlAssetReference(
                    element,
                    name,
                    attribute.value,
                    diagnostics,
                    referenced,
                    knownAssets,
                )
            } else {
                diagnostics.push(
                    htmlDiagnostic(
                        'forbidden_url_attribute',
                        `作者 HTML 不允许使用 ${name} 导航或加载外部资源。`,
                        element,
                        name,
                    ),
                )
            }
        }
        validateInlineStyle(element, parsed.scope, diagnostics, referenced, knownAssets)
    }

    const managed = findElementsByAttribute(parsed, 'data-fc-node-kind').filter(element =>
        DOCUMENT_NODE_KINDS.includes(
            getAttribute(element, 'data-fc-node-kind') as DocumentNodeKind,
        ),
    )
    const nonRootManaged = managed.filter(
        element => getAttribute(element, 'data-fc-editor-root') === undefined,
    )
    const ancestors = elementAncestorMap(parsed)
    if (nonRootManaged.length > DOCUMENT_LIMITS.managedNodes) {
        diagnostics.push({
            severity: 'error',
            category: 'resource',
            code: 'managed_node_limit_exceeded',
            message: `非根托管节点数量不得超过 ${DOCUMENT_LIMITS.managedNodes}。`,
            file: 'article.html',
        })
    }
    const paragraphCount = managed.filter(
        element => getAttribute(element, 'data-fc-node-kind') === 'paragraph',
    ).length
    const assetCount = managed.filter(
        element => getAttribute(element, 'data-fc-node-kind') === 'asset',
    ).length
    if (paragraphCount > (options.paragraphLimit ?? 100)) {
        diagnostics.push({
            severity: 'error',
            category: 'resource',
            code: 'paragraph_limit_exceeded',
            message: `段落数量 ${paragraphCount} 超过当前上限 ${options.paragraphLimit ?? 100}。`,
            file: 'article.html',
        })
    }
    if (assetCount > (options.assetLimit ?? 100)) {
        diagnostics.push({
            severity: 'error',
            category: 'resource',
            code: 'asset_limit_exceeded',
            message: `单张资产块数量 ${assetCount} 超过当前上限 ${options.assetLimit ?? 100}。`,
            file: 'article.html',
        })
    }

    const editorRoots = findElementsByAttribute(parsed, 'data-fc-editor-root')
    if (editorRoots.length > 1) {
        diagnostics.push({
            severity: 'error',
            category: 'capability',
            code: 'duplicate_editor_root',
            message: '词条文档只能声明一个 data-fc-editor-root。',
            file: 'article.html',
        })
    }
    for (const root of editorRoots) {
        if (isSemanticallyHidden(root)) {
            diagnostics.push(
                htmlDiagnostic(
                    'editor_root_hidden',
                    '编辑根容器必须保持可见。',
                    root,
                    'hidden',
                    'capability',
                ),
            )
        }
        if (
            getAttribute(root, 'data-fc-node-kind') !== 'container' ||
            getAttribute(root, 'data-fc-editor-root') !== ''
        ) {
            diagnostics.push(
                htmlDiagnostic(
                    'invalid_editor_root',
                    'data-fc-editor-root 必须是空值布尔标记，并且只能用于 container。',
                    root,
                    'data-fc-editor-root',
                    'capability',
                ),
            )
        }
        if (
            ancestors
                .get(root)
                ?.some(ancestor => getAttribute(ancestor, 'data-fc-node-kind') === 'container')
        ) {
            diagnostics.push(
                htmlDiagnostic(
                    'nested_editor_root',
                    '编辑根容器不能嵌套在其他托管容器中。',
                    root,
                    undefined,
                    'capability',
                ),
            )
        }
    }
    const paragraphs = managed.filter(
        element => getAttribute(element, 'data-fc-node-kind') === 'paragraph',
    )
    if (paragraphs.length > 0 && visibleManagedParagraphs(parsed, ancestors).length === 0) {
        diagnostics.push(
            htmlDiagnostic(
                'visible_paragraph_required',
                '词条必须至少保留一个不受 hidden 祖先遮蔽的可见段落。',
                paragraphs[0],
                undefined,
                'capability',
            ),
        )
    }
    for (const container of managed.filter(
        element => getAttribute(element, 'data-fc-node-kind') === 'container',
    )) {
        const isRoot = getAttribute(container, 'data-fc-editor-root') !== undefined
        const nonRootDepth =
            (ancestors.get(container) ?? []).filter(
                ancestor =>
                    getAttribute(ancestor, 'data-fc-node-kind') === 'container' &&
                    getAttribute(ancestor, 'data-fc-editor-root') === undefined,
            ).length + (isRoot ? 0 : 1)
        if (nonRootDepth > 3) {
            diagnostics.push(
                htmlDiagnostic(
                    'container_depth_exceeded',
                    '非根容器嵌套深度不得超过 3 层。',
                    container,
                    undefined,
                    'resource',
                ),
            )
        }
        const directElementChildren = childNodes(container).filter(isElement).length
        if (!isRoot && directElementChildren > 32) {
            diagnostics.push(
                htmlDiagnostic(
                    'container_child_limit_exceeded',
                    '普通容器最多包含 32 个直接元素子节点。',
                    container,
                    undefined,
                    'resource',
                ),
            )
        }
    }
}

function nearestLayer(rule: Rule): string | undefined {
    let parent: CssNode | undefined = rule.parent
    while (parent) {
        if (parent.type === 'atrule') {
            const atRule = parent as AtRule
            if (atRule.name.toLowerCase() === 'layer') return atRule.params.trim()
        }
        parent = parent.parent
    }
    return undefined
}

function selectorAllowed(
    selector: string,
    layer: string | undefined,
    scope: 'project' | 'entry',
): boolean {
    const trimmed = selector.trim()
    // P0F 暂不开放同级组合器，避免从受管根选择到其外部兄弟节点。
    if (trimmed.includes('+') || trimmed.includes('~')) return false
    if (layer === 'fc-node') return trimmed.startsWith('[data-fc-node-id=')
    if (layer === 'fc-entry') {
        return (
            scope === 'entry' &&
            (trimmed.startsWith('[data-fc-entry-id=') ||
                trimmed.startsWith('.fc-entry[data-fc-entry-id='))
        )
    }
    if (layer === 'fc-project') {
        return scope === 'project' && (trimmed === ':root' || trimmed.startsWith('.fc-entry'))
    }
    return false
}

function validateDeclarationValue(
    property: string,
    value: string,
    diagnostics: DocumentDiagnostic[],
    referenced: Set<string>,
    knownAssets: ReadonlySet<string> | undefined,
    range?: SourceRange,
    file: 'article.html' | 'style.css' = 'style.css',
): void {
    const normalizedProperty = property.toLowerCase()
    const normalizedValue = value.toLowerCase()
    if (
        normalizedProperty === 'behavior' ||
        normalizedProperty === '-moz-binding' ||
        normalizedValue.includes('expression(') ||
        normalizedValue.includes('javascript:')
    ) {
        diagnostics.push(
            cssDiagnostic(
                'forbidden_css_capability',
                `CSS 声明 ${property} 使用了不允许的执行能力。`,
                range,
                file,
            ),
        )
    }
    validateResourceFunctions(value, diagnostics, referenced, knownAssets, range, file)
}

function validateDeclaration(
    declaration: Declaration,
    diagnostics: DocumentDiagnostic[],
    referenced: Set<string>,
    knownAssets: ReadonlySet<string> | undefined,
    range?: SourceRange,
    file: 'article.html' | 'style.css' = 'style.css',
): void {
    if (declaration.important) {
        diagnostics.push(
            cssDiagnostic(
                'forbidden_css_important',
                '作者 CSS 不允许使用 !important 覆盖应用样式优先级。',
                range,
                file,
            ),
        )
    }
    validateDeclarationValue(
        declaration.prop,
        declaration.value,
        diagnostics,
        referenced,
        knownAssets,
        range,
        file,
    )
}

function lastDeclaration(container: CssContainer, property: string): Declaration | undefined {
    return container.nodes
        ?.filter(
            (node): node is Declaration =>
                node.type === 'decl' && node.prop.toLowerCase() === property,
        )
        .at(-1)
}

function isZeroCssLength(value: string): boolean {
    return /^[+-]?(?:0+\.?0*|\.0+)(?:[a-z]+|%)?$/iu.test(value.trim())
}

function isFullscreenInset(value: string): boolean {
    const parts = postcss.list.space(value)
    return parts.length >= 1 && parts.length <= 4 && parts.every(isZeroCssLength)
}

function validateFixedOverlay(
    container: CssContainer,
    diagnostics: DocumentDiagnostic[],
    range?: SourceRange,
    file: 'article.html' | 'style.css' = 'style.css',
): void {
    const position = lastDeclaration(container, 'position')
    if (position?.value.trim().toLowerCase() !== 'fixed') return
    const inset = lastDeclaration(container, 'inset')
    const longhandFullscreen = ['top', 'right', 'bottom', 'left'].every(property => {
        const declaration = lastDeclaration(container, property)
        return declaration ? isZeroCssLength(declaration.value) : false
    })
    if (!((inset && isFullscreenInset(inset.value)) || longhandFullscreen)) return
    diagnostics.push(
        cssDiagnostic(
            'forbidden_fullscreen_fixed_overlay',
            '作者 CSS 不允许创建覆盖整个应用视口的 fixed 层。',
            range,
            file,
        ),
    )
}

function validatePseudoElementContent(rule: Rule, diagnostics: DocumentDiagnostic[]): void {
    if (!/::?(?:before|after)\b/iu.test(rule.selector)) return
    rule.walkDecls(/^content$/iu, declaration => {
        const normalized = declaration.value.trim().toLowerCase()
        if (normalized === 'none' || normalized === 'normal') return
        diagnostics.push(
            cssDiagnostic(
                'forbidden_pseudo_content',
                '作者 CSS 不允许通过伪元素 content 注入页面文字或图形。',
                cssNodeRange(declaration),
            ),
        )
    })
}

function validateVisualTextSelectionCompatibility(
    rule: Rule,
    diagnostics: DocumentDiagnostic[],
): void {
    const pseudoElements = visualTextPseudoElements(rule.selector)
    if (pseudoElements.length === 0) return
    diagnostics.push({
        severity: 'warning',
        category: 'capability',
        code: 'visual_text_pseudo_element',
        message: `${pseudoElements.map(name => `::${name}`).join('、')} 不形成独立 DOM 文本边界；源码可继续使用，但可视模式不能把它与相邻文字独立编辑。局部文字效果请改用仅带 style 属性的真实 span。`,
        file: 'style.css',
        range: cssNodeRange(rule),
    })
}

function validateCss(
    parsed: ParsedCssSource,
    options: DocumentGuardOptions,
    diagnostics: DocumentDiagnostic[],
    referenced: Set<string>,
): void {
    if (!parsed.root) return
    const knownAssets = options.knownAssetIds
        ? new Set([...options.knownAssetIds].map(id => id.toLowerCase()))
        : undefined
    if (/<\/style/iu.test(parsed.source)) {
        diagnostics.push(
            cssDiagnostic('unsafe_style_terminator', 'CSS 源码不得包含 style 结束标签。'),
        )
    }

    let ruleCount = 0
    parsed.root.walkAtRules((atRule: AtRule) => {
        if (FORBIDDEN_AT_RULES.has(atRule.name.toLowerCase())) {
            diagnostics.push(
                cssDiagnostic(
                    'forbidden_css_at_rule',
                    `作者 CSS 不允许使用 @${atRule.name}。`,
                    cssNodeRange(atRule),
                ),
            )
        }
    })
    parsed.root.walkRules((rule: Rule) => {
        ruleCount += 1
        const layer = nearestLayer(rule)
        for (const selector of postcss.list.comma(rule.selector)) {
            if (!selectorAllowed(selector, layer, parsed.scope)) {
                diagnostics.push(
                    cssDiagnostic(
                        'selector_scope_violation',
                        `选择器 ${selector.trim()} 超出 ${layer ?? '未分层'} 的受管范围。`,
                        cssNodeRange(rule),
                    ),
                )
            }
        }
        validateFixedOverlay(rule, diagnostics, cssNodeRange(rule))
        validatePseudoElementContent(rule, diagnostics)
        validateVisualTextSelectionCompatibility(rule, diagnostics)
        diagnostics.push(...visualCssCompatibilityDiagnostics(rule, layer))
    })
    if (ruleCount > DOCUMENT_LIMITS.cssRules) {
        diagnostics.push(
            cssDiagnostic(
                'css_rule_limit_exceeded',
                `CSS 规则数量不得超过 ${DOCUMENT_LIMITS.cssRules}。`,
                undefined,
                'style.css',
                'resource',
            ),
        )
    }
    parsed.root.walkDecls(declaration => {
        validateDeclaration(
            declaration,
            diagnostics,
            referenced,
            knownAssets,
            cssNodeRange(declaration),
            'style.css',
        )
    })
}

export function guardDocumentSources(
    htmlSources: readonly ParsedHtmlSource[],
    cssSources: readonly ParsedCssSource[],
    options: DocumentGuardOptions = {},
): DocumentGuardResult {
    const diagnostics: DocumentDiagnostic[] = []
    const referenced = new Set<string>()
    for (const html of htmlSources) validateHtml(html, options, diagnostics, referenced)
    for (const css of cssSources) validateCss(css, options, diagnostics, referenced)
    return {diagnostics, referencedAssetIds: [...referenced].sort()}
}
