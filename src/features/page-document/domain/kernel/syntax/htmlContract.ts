// 本模块解析带源码位置的 HTML 并检查稳定节点、slot 与 bind 契约；它不序列化回写作者源码。
import type {DefaultTreeAdapterTypes} from 'parse5'
import {
    DOCUMENT_VERSION,
    TABLE_MAX_COLUMN_COUNT,
    TABLE_MAX_ROW_COUNT,
    TABLE_MIN_COLUMN_COUNT,
    TABLE_MIN_ROW_COUNT,
    type DocumentDiagnostic,
    type SourceRange,
} from '../../contract.ts'
import {canComponentContain, isComponentTagCompatible} from '../components/index.ts'
import {DOCUMENT_NODE_KINDS, type DocumentNodeKind} from '../contracts/primitives.ts'
import {sourceKey} from '../contracts/source.ts'
import {syntaxDocumentDiagnostic} from './diagnostics.ts'
import {parseHtmlSyntax} from './htmlSyntax.ts'
import {RFC_9562_UUID_PATTERN} from '../../uuidPolicy.ts'

const SLOT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const COMPONENT_SCHEMA_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const COMPONENT_REVISION_PATTERN = /^(?:latest|[1-9]\d*)$/u
const ALLOWED_BINDINGS = new Set(['title', 'summary', 'tags'])

export type HtmlSourceMode = 'document' | 'fragment'
export type HtmlContractScope = 'project' | 'entry'
export type HtmlRoot = DefaultTreeAdapterTypes.Document | DefaultTreeAdapterTypes.DocumentFragment
export type HtmlElement = DefaultTreeAdapterTypes.Element
export type HtmlTemplate = DefaultTreeAdapterTypes.Template
export type HtmlNode = DefaultTreeAdapterTypes.Node

export interface ParsedHtmlSource {
    source: string
    root: HtmlRoot
    mode: HtmlSourceMode
    scope: HtmlContractScope
    elements: HtmlElement[]
    diagnostics: DocumentDiagnostic[]
}

export function isElement(node: HtmlNode): node is HtmlElement {
    return 'tagName' in node
}

export function isTemplateElement(element: HtmlElement): element is HtmlTemplate {
    return element.tagName === 'template' && 'content' in element
}

export function getAttribute(element: HtmlElement, name: string): string | undefined {
    return element.attrs.find(attribute => attribute.name === name)?.value
}

export function hasAttribute(element: HtmlElement, name: string): boolean {
    return element.attrs.some(attribute => attribute.name === name)
}

export function setAttribute(element: HtmlElement, name: string, value: string): void {
    const existing = element.attrs.find(attribute => attribute.name === name)
    if (existing) {
        existing.value = value
    } else {
        element.attrs.push({name, value})
    }
}

export function elementRange(element: HtmlElement): SourceRange | undefined {
    const location = element.sourceCodeLocation
    if (!location) return undefined
    return {from: location.startOffset, to: location.endOffset}
}

export function elementInnerRange(element: HtmlElement): SourceRange | undefined {
    const location = element.sourceCodeLocation
    if (!location?.startTag || !location.endTag) return undefined
    return {from: location.startTag.endOffset, to: location.endTag.startOffset}
}

export function attributeRange(element: HtmlElement, name: string): SourceRange | undefined {
    const location = element.sourceCodeLocation?.attrs?.[name]
    if (!location) return undefined
    return {from: location.startOffset, to: location.endOffset}
}

export function childNodes(node: HtmlNode | HtmlRoot): DefaultTreeAdapterTypes.ChildNode[] {
    if (isElement(node) && isTemplateElement(node)) return node.content.childNodes
    if ('childNodes' in node) return node.childNodes
    return []
}

export interface ManagedTableRow {
    element: HtmlElement
    cells: HtmlElement[]
    header: boolean
}

export interface ManagedTableStructure {
    head: HtmlElement
    body: HtmlElement
    rows: ManagedTableRow[]
    columnCount: number
}

function directElements(node: HtmlElement): HtmlElement[] {
    return childNodes(node).filter(isElement)
}

/** 只识别可视操作能够无损维护的矩形表格；源码模式仍可编辑其他普通 table。 */
export function readManagedTableStructure(table: HtmlElement): ManagedTableStructure | null {
    if (table.tagName !== 'table') return null
    const children = directElements(table)
    const heads = children.filter(element => element.tagName === 'thead')
    const bodies = children.filter(element => element.tagName === 'tbody')
    if (heads.length !== 1 || bodies.length !== 1) return null

    const headRows = directElements(heads[0]).filter(element => element.tagName === 'tr')
    const bodyRows = directElements(bodies[0]).filter(element => element.tagName === 'tr')
    if (headRows.length !== 1 || bodyRows.length === 0) return null

    const rows: ManagedTableRow[] = [
        {element: headRows[0], cells: directElements(headRows[0]), header: true},
        ...bodyRows.map(element => ({element, cells: directElements(element), header: false})),
    ]
    const columnCount = rows[0].cells.length
    if (columnCount === 0) return null
    if (
        rows.some(
            row =>
                row.cells.length !== columnCount ||
                row.cells.some(
                    cell =>
                        cell.tagName !== (row.header ? 'th' : 'td') ||
                        getAttribute(cell, 'data-fc-node-kind') !== 'table-cell',
                ),
        )
    ) {
        return null
    }
    return {head: heads[0], body: bodies[0], rows, columnCount}
}

export function walkElements(
    root: HtmlNode | HtmlRoot,
    visitor: (element: HtmlElement, ancestors: readonly HtmlElement[]) => void,
): void {
    function visit(node: HtmlNode | HtmlRoot, ancestors: readonly HtmlElement[]): void {
        const nextAncestors = isElement(node) ? [...ancestors, node] : ancestors
        if (isElement(node)) visitor(node, ancestors)
        for (const child of childNodes(node)) visit(child, nextAncestors)
    }
    visit(root, [])
}

export function findElementsByAttribute(
    parsed: ParsedHtmlSource,
    attributeName: string,
    value?: string,
): HtmlElement[] {
    return parsed.elements.filter(element => {
        const attributeValue = getAttribute(element, attributeName)
        return attributeValue !== undefined && (value === undefined || attributeValue === value)
    })
}

export function findFirstElementByTagName(
    root: HtmlNode | HtmlRoot,
    tagName: string,
): HtmlElement | undefined {
    let result: HtmlElement | undefined
    walkElements(root, element => {
        if (!result && element.tagName === tagName) result = element
    })
    return result
}

function diagnosticForElement(
    severity: 'error' | 'warning',
    code: string,
    message: string,
    element: HtmlElement,
    attributeName?: string,
): DocumentDiagnostic {
    return {
        severity,
        category: 'capability',
        code,
        message,
        file: 'article.html',
        range: attributeName
            ? (attributeRange(element, attributeName) ?? elementRange(element))
            : elementRange(element),
        nodeId: getAttribute(element, 'data-fc-node-id'),
    }
}

function validateManagedTable(parsed: ParsedHtmlSource, table: HtmlElement): void {
    const structure = readManagedTableStructure(table)
    if (!structure) {
        parsed.diagnostics.push(
            diagnosticForElement(
                'error',
                'invalid_managed_table_structure',
                '可视表格必须包含一个单行 thead、一个非空 tbody，并保持每行相同数量的托管 th/td 单元格。',
                table,
            ),
        )
        return
    }
    if (
        structure.rows.length < TABLE_MIN_ROW_COUNT ||
        structure.rows.length > TABLE_MAX_ROW_COUNT ||
        structure.columnCount < TABLE_MIN_COLUMN_COUNT ||
        structure.columnCount > TABLE_MAX_COLUMN_COUNT
    ) {
        parsed.diagnostics.push(
            diagnosticForElement(
                'error',
                'managed_table_dimension_limit',
                `可视表格限制为 ${TABLE_MIN_ROW_COUNT}–${TABLE_MAX_ROW_COUNT} 行、${TABLE_MIN_COLUMN_COUNT}–${TABLE_MAX_COLUMN_COUNT} 列（行数包含表头）。`,
                table,
            ),
        )
    }
    for (const row of structure.rows) {
        for (const cell of row.cells) {
            if (hasAttribute(cell, 'rowspan') || hasAttribute(cell, 'colspan')) {
                parsed.diagnostics.push(
                    diagnosticForElement(
                        'error',
                        'managed_table_span_unsupported',
                        '当前可视表格不支持 rowspan 或 colspan；请先拆分为矩形单元格。',
                        cell,
                    ),
                )
            }
        }
    }
}

function validateManagedNodes(parsed: ParsedHtmlSource): void {
    const seenIds = new Map<string, HtmlElement>()
    walkElements(parsed.root, (element, ancestors) => {
        const nodeId = getAttribute(element, 'data-fc-node-id')
        const nodeKind = getAttribute(element, 'data-fc-node-kind')
        const knownKind = DOCUMENT_NODE_KINDS.includes(nodeKind as DocumentNodeKind)
        const validId = nodeId !== undefined && RFC_9562_UUID_PATTERN.test(nodeId)

        if (nodeId !== undefined && !validId) {
            parsed.diagnostics.push(
                diagnosticForElement(
                    'error',
                    'invalid_node_id',
                    'data-fc-node-id 必须是 UUID。',
                    element,
                    'data-fc-node-id',
                ),
            )
        } else if (nodeId) {
            const normalizedId = nodeId.toLowerCase()
            if (seenIds.has(normalizedId)) {
                parsed.diagnostics.push(
                    diagnosticForElement(
                        'error',
                        'duplicate_node_id',
                        'data-fc-node-id 在文档中必须唯一。',
                        element,
                        'data-fc-node-id',
                    ),
                )
            } else {
                seenIds.set(normalizedId, element)
            }
        }

        if (nodeKind !== undefined && !knownKind) {
            parsed.diagnostics.push(
                diagnosticForElement(
                    'warning',
                    'unknown_node_kind',
                    '未知 data-fc-node-kind 将作为不透明源码节点保留。',
                    element,
                    'data-fc-node-kind',
                ),
            )
        }
        if (knownKind && !validId) {
            parsed.diagnostics.push(
                diagnosticForElement(
                    'error',
                    'managed_node_missing_id',
                    '已知可视节点必须同时提供合法 data-fc-node-id。',
                    element,
                ),
            )
        }
        if (validId && nodeKind === undefined) {
            parsed.diagnostics.push(
                diagnosticForElement(
                    'warning',
                    'unmanaged_node_id',
                    '只有 data-fc-node-id 而没有 kind 的元素按不透明源码节点处理。',
                    element,
                    'data-fc-node-id',
                ),
            )
        }

        if (knownKind && validId) {
            const kind = nodeKind as DocumentNodeKind
            if (!isComponentTagCompatible(kind, element.tagName)) {
                parsed.diagnostics.push(
                    diagnosticForElement(
                        'error',
                        'managed_node_tag_mismatch',
                        kind === 'heading'
                            ? 'heading 必须使用 h2–h6；h1 保留给词条标题元数据。'
                            : `${kind} 与 <${element.tagName}> 的 HTML 语义不匹配。`,
                        element,
                    ),
                )
            }
            const managedAncestor = [...ancestors].reverse().find(ancestor => {
                const ancestorKind = getAttribute(ancestor, 'data-fc-node-kind')
                return (
                    DOCUMENT_NODE_KINDS.includes(ancestorKind as DocumentNodeKind) &&
                    RFC_9562_UUID_PATTERN.test(getAttribute(ancestor, 'data-fc-node-id') ?? '')
                )
            })
            const ancestorKind = managedAncestor
                ? (getAttribute(managedAncestor, 'data-fc-node-kind') as DocumentNodeKind)
                : null
            if (
                (ancestorKind && !canComponentContain(ancestorKind, kind)) ||
                (!ancestorKind && (kind === 'list-item' || kind === 'table-cell'))
            ) {
                parsed.diagnostics.push(
                    diagnosticForElement(
                        'error',
                        'invalid_managed_parent',
                        kind === 'list-item'
                            ? 'list-item 只能位于 list 内部。'
                            : kind === 'table-cell'
                              ? 'table-cell 只能位于 table 的 thead/tbody 行内。'
                              : '普通托管节点只能位于 container 或非托管 HTML 元素内部。',
                        element,
                    ),
                )
            }
            if (kind === 'table') validateManagedTable(parsed, element)
        }
    })
}

function validatePublicComponentInstances(parsed: ParsedHtmlSource): void {
    const seenInstanceIds = new Set<string>()
    const partNamesByInstance = new Map<HtmlElement, Set<string>>()
    walkElements(parsed.root, (element, ancestors) => {
        const kind = getAttribute(element, 'data-fc-node-kind')
        const isInstance = kind === 'component'
        const componentAttributes = element.attrs.filter(
            attribute =>
                attribute.name === 'data-fc-component' ||
                attribute.name === 'data-fc-component-revision' ||
                attribute.name === 'data-fc-instance' ||
                attribute.name.startsWith('data-fc-prop-'),
        )

        if (!isInstance && componentAttributes.length > 0) {
            parsed.diagnostics.push(
                diagnosticForElement(
                    'error',
                    'orphan_component_attribute',
                    '组件引用、修订、实例与属性只能声明在 component 页面节点上。',
                    element,
                    componentAttributes[0].name,
                ),
            )
        }

        if (isInstance) {
            partNamesByInstance.set(element, new Set())
            const definitionId = getAttribute(element, 'data-fc-component')
            const revision = getAttribute(element, 'data-fc-component-revision')
            const instanceId = getAttribute(element, 'data-fc-instance')
            if (!definitionId || !RFC_9562_UUID_PATTERN.test(definitionId)) {
                parsed.diagnostics.push(
                    diagnosticForElement(
                        'error',
                        'invalid_component_reference',
                        'data-fc-component 必须是公共组件定义 UUID。',
                        element,
                        'data-fc-component',
                    ),
                )
            }
            if (
                !revision ||
                !COMPONENT_REVISION_PATTERN.test(revision) ||
                (revision !== 'latest' && !Number.isSafeInteger(Number(revision)))
            ) {
                parsed.diagnostics.push(
                    diagnosticForElement(
                        'error',
                        'invalid_component_revision',
                        'data-fc-component-revision 必须是 latest 或正整数。',
                        element,
                        'data-fc-component-revision',
                    ),
                )
            }
            if (!instanceId || !RFC_9562_UUID_PATTERN.test(instanceId)) {
                parsed.diagnostics.push(
                    diagnosticForElement(
                        'error',
                        'invalid_component_instance_id',
                        'data-fc-instance 必须是组件实例 UUID。',
                        element,
                        'data-fc-instance',
                    ),
                )
            } else {
                const normalized = instanceId.toLowerCase()
                if (normalized === getAttribute(element, 'data-fc-node-id')?.toLowerCase()) {
                    parsed.diagnostics.push(
                        diagnosticForElement(
                            'error',
                            'component_instance_id_not_distinct',
                            '组件实例身份必须与页面节点身份彼此独立。',
                            element,
                            'data-fc-instance',
                        ),
                    )
                } else if (seenInstanceIds.has(normalized)) {
                    parsed.diagnostics.push(
                        diagnosticForElement(
                            'error',
                            'duplicate_component_instance_id',
                            'data-fc-instance 在单个页面文档中必须唯一。',
                            element,
                            'data-fc-instance',
                        ),
                    )
                } else {
                    seenInstanceIds.add(normalized)
                }
            }
            for (const attribute of componentAttributes) {
                if (!attribute.name.startsWith('data-fc-prop-')) continue
                const name = attribute.name.slice('data-fc-prop-'.length)
                if (!COMPONENT_SCHEMA_NAME_PATTERN.test(name)) {
                    parsed.diagnostics.push(
                        diagnosticForElement(
                            'error',
                            'invalid_component_property_name',
                            'data-fc-prop-* 必须使用稳定的小写短横线名称。',
                            element,
                            attribute.name,
                        ),
                    )
                }
            }
        }

        const partName = getAttribute(element, 'data-fc-part')
        if (partName === undefined) return
        const owner = [...ancestors]
            .reverse()
            .find(ancestor => getAttribute(ancestor, 'data-fc-node-kind') === 'component')
        if (!owner) {
            parsed.diagnostics.push(
                diagnosticForElement(
                    'error',
                    'orphan_component_part',
                    'data-fc-part 必须位于公共组件实例内部。',
                    element,
                    'data-fc-part',
                ),
            )
            return
        }
        if (!COMPONENT_SCHEMA_NAME_PATTERN.test(partName)) {
            parsed.diagnostics.push(
                diagnosticForElement(
                    'error',
                    'invalid_component_part_name',
                    'data-fc-part 必须使用稳定的小写短横线名称。',
                    element,
                    'data-fc-part',
                ),
            )
            return
        }
        const seenParts = partNamesByInstance.get(owner)
        if (seenParts?.has(partName)) {
            parsed.diagnostics.push(
                diagnosticForElement(
                    'error',
                    'duplicate_component_part',
                    '同一公共组件实例内的 data-fc-part 名称必须唯一。',
                    element,
                    'data-fc-part',
                ),
            )
        } else {
            seenParts?.add(partName)
        }
    })
}

function validateBindings(parsed: ParsedHtmlSource): void {
    for (const element of parsed.elements) {
        const binding = getAttribute(element, 'data-fc-bind')
        if (binding !== undefined && !ALLOWED_BINDINGS.has(binding)) {
            parsed.diagnostics.push(
                diagnosticForElement(
                    'error',
                    'unknown_metadata_binding',
                    'data-fc-bind 只能引用 title、summary 或 tags。',
                    element,
                    'data-fc-bind',
                ),
            )
        }
    }
}

function validateProjectContract(parsed: ParsedHtmlSource): void {
    const htmlElements = parsed.elements.filter(element => element.tagName === 'html')
    if (htmlElements.length !== 1) {
        parsed.diagnostics.push({
            severity: 'error',
            category: 'capability',
            code: 'invalid_project_document_root',
            message: '项目 article.html 必须包含唯一 html 根元素。',
            file: 'article.html',
        })
        return
    }

    const htmlElement = htmlElements[0]
    if (getAttribute(htmlElement, 'data-fc-document-version') !== String(DOCUMENT_VERSION)) {
        parsed.diagnostics.push(
            diagnosticForElement(
                'error',
                'unsupported_document_version',
                '项目 article.html 的文档版本不受支持。',
                htmlElement,
                'data-fc-document-version',
            ),
        )
    }
    const templateVersion = Number(getAttribute(htmlElement, 'data-fc-template-version'))
    if (!Number.isInteger(templateVersion) || templateVersion < 1) {
        parsed.diagnostics.push(
            diagnosticForElement(
                'error',
                'invalid_template_version',
                'data-fc-template-version 必须是正整数。',
                htmlElement,
                'data-fc-template-version',
            ),
        )
    }

    const seenSlots = new Set<string>()
    for (const slotElement of findElementsByAttribute(parsed, 'data-fc-slot')) {
        const slot = getAttribute(slotElement, 'data-fc-slot') ?? ''
        if (!SLOT_NAME_PATTERN.test(slot)) {
            parsed.diagnostics.push(
                diagnosticForElement(
                    'error',
                    'invalid_slot_name',
                    'data-fc-slot 必须是稳定的小写短横线名称。',
                    slotElement,
                    'data-fc-slot',
                ),
            )
        } else if (seenSlots.has(slot)) {
            parsed.diagnostics.push(
                diagnosticForElement(
                    'error',
                    'duplicate_slot',
                    '项目默认模板中的 slot 名称必须唯一。',
                    slotElement,
                    'data-fc-slot',
                ),
            )
        } else {
            seenSlots.add(slot)
        }
        if (
            hasAttribute(slotElement, 'data-fc-slot-optional') &&
            getAttribute(slotElement, 'data-fc-slot-optional') !== ''
        ) {
            parsed.diagnostics.push(
                diagnosticForElement(
                    'error',
                    'invalid_optional_slot_marker',
                    'data-fc-slot-optional 是布尔标记，不接受值。',
                    slotElement,
                    'data-fc-slot-optional',
                ),
            )
        }
    }
}

export function parseHtmlSource(
    source: string,
    options: {mode: HtmlSourceMode; scope: HtmlContractScope},
): ParsedHtmlSource {
    const syntax = parseHtmlSyntax(source, {
        mode: options.mode,
        sourceKey: sourceKey(options.scope, 'article.html'),
    })
    return validateHtmlTree(
        source,
        syntax.root,
        options,
        syntax.diagnostics.map(syntaxDocumentDiagnostic),
    )
}

/** 对已经组合好的派生树执行与源码解析相同的结构契约检查，但不重新序列化或解析。 */
export function validateHtmlTree(
    source: string,
    root: HtmlRoot,
    options: {mode: HtmlSourceMode; scope: HtmlContractScope},
    initialDiagnostics: readonly DocumentDiagnostic[] = [],
): ParsedHtmlSource {
    const elements: HtmlElement[] = []
    walkElements(root, element => elements.push(element))
    const parsed: ParsedHtmlSource = {
        source,
        root,
        mode: options.mode,
        scope: options.scope,
        elements,
        diagnostics: [...initialDiagnostics],
    }
    validateManagedNodes(parsed)
    validatePublicComponentInstances(parsed)
    validateBindings(parsed)
    if (options.scope === 'project') validateProjectContract(parsed)
    return parsed
}

export function hasBlockingDiagnostics(diagnostics: readonly DocumentDiagnostic[]): boolean {
    return diagnostics.some(diagnostic => diagnostic.severity === 'error')
}
