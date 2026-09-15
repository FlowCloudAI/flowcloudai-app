// 本模块按显式 slot 操作生成一次性合并 DOM；项目与词条作者源码始终保持原样。
import {defaultTreeAdapter, serialize, type DefaultTreeAdapterTypes} from 'parse5'
import {DOCUMENT_VERSION, type DocumentDiagnostic} from '../../contract.ts'
import {sourceKey} from '../contracts/source.ts'
import {
    childNodes,
    elementRange,
    findElementsByAttribute,
    findFirstElementByTagName,
    getAttribute,
    hasAttribute,
    hasBlockingDiagnostics,
    isElement,
    isTemplateElement,
    setAttribute,
    validateHtmlTree,
    walkElements,
    type HtmlElement,
    type HtmlTemplate,
    type ParsedHtmlSource,
} from '../syntax/htmlContract.ts'
import {HtmlSourceMapBuilder, type HtmlComposition} from './htmlSourceMap.ts'
import {RFC_9562_UUID_PATTERN} from '../../uuidPolicy.ts'

const OPERATION_ATTRIBUTES = [
    'data-fc-fill',
    'data-fc-append',
    'data-fc-replace',
    'data-fc-remove',
] as const

type PatchOperationKind = 'fill' | 'append' | 'replace' | 'remove'

interface PatchOperation {
    kind: PatchOperationKind
    targetName: string
    source: HtmlTemplate
    content: DefaultTreeAdapterTypes.ChildNode[]
    replacement?: HtmlElement
}

export interface EntryMetadataInput {
    id: string
    title: string
    summary: string
    tags: string[]
}

export interface TemplateMergeResult {
    html: string | null
    /** 合并后已经完成契约解析的临时 DOM；仅供同一轮预览继续派生，不得写回作者源码。 */
    parsedHtml: ParsedHtmlSource | null
    /** 保留项目、词条、元数据及渲染生成来源的组合树；分析不得再从 html 字符串反推归属。 */
    composition: HtmlComposition | null
    diagnostics: DocumentDiagnostic[]
    templateVersion: number | null
}

function mergeDiagnostic(code: string, message: string, element?: HtmlElement): DocumentDiagnostic {
    return {
        severity: 'error',
        category: 'capability',
        code,
        message,
        file: 'article.html',
        range: element ? elementRange(element) : undefined,
    }
}

function isWhitespaceText(node: DefaultTreeAdapterTypes.ChildNode): boolean {
    return (
        !isElement(node) && node.nodeName === '#text' && 'value' in node && node.value.trim() === ''
    )
}

function isIgnorable(node: DefaultTreeAdapterTypes.ChildNode): boolean {
    return isWhitespaceText(node) || node.nodeName === '#comment'
}

function rootPatchTemplate(
    entry: ParsedHtmlSource,
    diagnostics: DocumentDiagnostic[],
): HtmlTemplate | null {
    const significant = childNodes(entry.root).filter(node => !isIgnorable(node))
    if (
        significant.length !== 1 ||
        !isElement(significant[0]) ||
        !isTemplateElement(significant[0])
    ) {
        diagnostics.push(
            mergeDiagnostic(
                'invalid_entry_patch_root',
                '词条 article.html 必须只包含一个 data-fc-entry-patch 根 template。',
            ),
        )
        return null
    }
    const root = significant[0]
    if (!hasAttribute(root, 'data-fc-entry-patch')) {
        diagnostics.push(
            mergeDiagnostic(
                'missing_entry_patch_marker',
                '词条根 template 缺少 data-fc-entry-patch。',
                root,
            ),
        )
        return null
    }
    if (getAttribute(root, 'data-fc-entry-patch') !== '') {
        diagnostics.push(
            mergeDiagnostic(
                'invalid_entry_patch_marker',
                'data-fc-entry-patch 是布尔标记，不接受值。',
                root,
            ),
        )
    }
    const allowedAttributes = new Set([
        'data-fc-entry-patch',
        'data-fc-document-version',
        'data-fc-entry-id',
        'data-fc-base-template-version',
    ])
    for (const attribute of root.attrs) {
        if (!allowedAttributes.has(attribute.name)) {
            diagnostics.push(
                mergeDiagnostic(
                    'unknown_entry_patch_attribute',
                    `词条 patch 根不接受属性 ${attribute.name}。`,
                    root,
                ),
            )
        }
    }
    return root
}

function readTemplateVersion(
    project: ParsedHtmlSource,
    diagnostics: DocumentDiagnostic[],
): number | null {
    const html = findFirstElementByTagName(project.root, 'html')
    const value = Number(html ? getAttribute(html, 'data-fc-template-version') : Number.NaN)
    if (!Number.isInteger(value) || value < 1) {
        diagnostics.push(
            mergeDiagnostic(
                'invalid_template_version',
                '项目模板没有可用的正整数 template version。',
                html,
            ),
        )
        return null
    }
    return value
}

function validatePatchIdentity(
    root: HtmlTemplate,
    metadata: EntryMetadataInput,
    templateVersion: number,
    diagnostics: DocumentDiagnostic[],
): void {
    if (getAttribute(root, 'data-fc-document-version') !== String(DOCUMENT_VERSION)) {
        diagnostics.push(
            mergeDiagnostic(
                'unsupported_document_version',
                '词条 patch 的文档版本不受支持。',
                root,
            ),
        )
    }
    const entryId = getAttribute(root, 'data-fc-entry-id')
    if (
        !entryId ||
        !RFC_9562_UUID_PATTERN.test(entryId) ||
        entryId.toLowerCase() !== metadata.id.toLowerCase()
    ) {
        diagnostics.push(
            mergeDiagnostic(
                'entry_patch_identity_mismatch',
                '词条 patch 的 entry ID 必须与 SQLite 元数据一致。',
                root,
            ),
        )
    }
    const baseVersion = Number(getAttribute(root, 'data-fc-base-template-version'))
    if (!Number.isInteger(baseVersion) || baseVersion !== templateVersion) {
        diagnostics.push(
            mergeDiagnostic(
                'template_version_conflict',
                `词条基于模板版本 ${String(baseVersion)}，当前版本为 ${templateVersion}。`,
                root,
            ),
        )
    }
}

function parseOperations(root: HtmlTemplate, diagnostics: DocumentDiagnostic[]): PatchOperation[] {
    const operations: PatchOperation[] = []
    for (const node of root.content.childNodes) {
        if (isIgnorable(node)) continue
        if (!isElement(node) || !isTemplateElement(node)) {
            diagnostics.push(
                mergeDiagnostic(
                    'invalid_patch_operation_node',
                    '词条 patch 根的有效子节点只能是操作 template。',
                    isElement(node) ? node : root,
                ),
            )
            continue
        }
        const operationAttributes = OPERATION_ATTRIBUTES.filter(attribute =>
            hasAttribute(node, attribute),
        )
        if (operationAttributes.length !== 1) {
            diagnostics.push(
                mergeDiagnostic(
                    'invalid_patch_operation',
                    '每个操作 template 必须且只能声明 fill、append、replace、remove 之一。',
                    node,
                ),
            )
            continue
        }
        if (node.attrs.length !== 1) {
            diagnostics.push(
                mergeDiagnostic(
                    'unknown_patch_operation_attribute',
                    '操作 template 不接受操作标记以外的属性。',
                    node,
                ),
            )
        }
        const attribute = operationAttributes[0]
        const targetName = getAttribute(node, attribute) ?? ''
        if (!targetName) {
            diagnostics.push(
                mergeDiagnostic('missing_patch_target', '模板覆盖操作必须指定目标 slot。', node),
            )
            continue
        }
        const kind = attribute.slice('data-fc-'.length) as PatchOperationKind
        const content = [...node.content.childNodes]
        const significant = content.filter(child => !isIgnorable(child))
        let replacement: HtmlElement | undefined
        if (kind === 'remove' && significant.length > 0) {
            diagnostics.push(
                mergeDiagnostic(
                    'remove_operation_has_content',
                    'remove 操作不得包含有效内容。',
                    node,
                ),
            )
        }
        if (kind === 'replace') {
            if (significant.length !== 1 || !isElement(significant[0])) {
                diagnostics.push(
                    mergeDiagnostic(
                        'invalid_replace_content',
                        'replace 操作必须恰好包含一个替换元素。',
                        node,
                    ),
                )
            } else {
                replacement = significant[0]
                if (getAttribute(replacement, 'data-fc-slot') !== targetName) {
                    diagnostics.push(
                        mergeDiagnostic(
                            'replace_slot_not_retained',
                            'replace 元素必须保留同名 data-fc-slot。',
                            replacement,
                        ),
                    )
                }
            }
        }
        operations.push({kind, targetName, source: node, content, replacement})
    }
    return operations
}

function validateOperationConflicts(
    operations: readonly PatchOperation[],
    slots: ReadonlyMap<string, HtmlElement>,
    diagnostics: DocumentDiagnostic[],
): void {
    const states = new Map<string, {primary?: PatchOperationKind; hasAppend: boolean}>()
    for (const operation of operations) {
        const target = slots.get(operation.targetName)
        if (!target) {
            diagnostics.push(
                mergeDiagnostic(
                    'missing_patch_slot',
                    `默认模板不存在 slot ${operation.targetName}。`,
                    operation.source,
                ),
            )
            continue
        }
        if (operation.kind === 'remove' && !hasAttribute(target, 'data-fc-slot-optional')) {
            diagnostics.push(
                mergeDiagnostic(
                    'required_slot_cannot_be_removed',
                    `slot ${operation.targetName} 不是可选 slot，不能删除。`,
                    operation.source,
                ),
            )
        }

        const state = states.get(operation.targetName) ?? {hasAppend: false}
        if (operation.kind === 'append') {
            if (state.primary === 'replace' || state.primary === 'remove') {
                diagnostics.push(
                    mergeDiagnostic(
                        'conflicting_patch_operations',
                        `slot ${operation.targetName} 的 append 与 ${state.primary} 冲突。`,
                        operation.source,
                    ),
                )
            }
            state.hasAppend = true
        } else {
            if (
                state.primary ||
                ((operation.kind === 'replace' || operation.kind === 'remove') && state.hasAppend)
            ) {
                diagnostics.push(
                    mergeDiagnostic(
                        'conflicting_patch_operations',
                        `slot ${operation.targetName} 包含互斥或重复覆盖操作。`,
                        operation.source,
                    ),
                )
            }
            state.primary = operation.kind
        }
        states.set(operation.targetName, state)
    }

    const destructive = operations.filter(operation => operation.kind !== 'append')
    for (const operation of destructive) {
        const ancestorTarget = slots.get(operation.targetName)
        if (!ancestorTarget) continue
        for (const other of operations) {
            if (other === operation || other.targetName === operation.targetName) continue
            let parent = slots.get(other.targetName)?.parentNode ?? null
            while (parent) {
                if (parent === ancestorTarget) {
                    diagnostics.push(
                        mergeDiagnostic(
                            'overlapping_slot_operations',
                            `覆盖祖先 slot ${operation.targetName} 时不能再操作后代 slot ${other.targetName}。`,
                            other.source,
                        ),
                    )
                    break
                }
                parent = 'parentNode' in parent ? parent.parentNode : null
            }
        }
    }
}

function clearChildren(element: HtmlElement): void {
    for (const child of [...element.childNodes]) defaultTreeAdapter.detachNode(child)
}

function moveContent(
    parent: HtmlElement,
    content: readonly DefaultTreeAdapterTypes.ChildNode[],
): void {
    for (const child of content) {
        defaultTreeAdapter.detachNode(child)
        defaultTreeAdapter.appendChild(parent, child)
    }
}

function applyOperations(
    operations: readonly PatchOperation[],
    slots: Map<string, HtmlElement>,
): void {
    for (const operation of operations) {
        const target = slots.get(operation.targetName)!
        if (operation.kind === 'fill') {
            clearChildren(target)
            moveContent(target, operation.content)
        } else if (operation.kind === 'append') {
            moveContent(target, operation.content)
        } else if (operation.kind === 'remove') {
            defaultTreeAdapter.detachNode(target)
        } else if (operation.replacement) {
            const parent = target.parentNode
            if (!parent) continue
            defaultTreeAdapter.detachNode(operation.replacement)
            defaultTreeAdapter.insertBefore(parent, operation.replacement, target)
            defaultTreeAdapter.detachNode(target)
            slots.set(operation.targetName, operation.replacement)
        }
    }
}

function nearestManagedHost(element: HtmlElement): HtmlElement | null {
    let current: DefaultTreeAdapterTypes.ParentNode | null = element
    while (current) {
        if (
            isElement(current) &&
            hasAttribute(current, 'data-fc-node-id') &&
            hasAttribute(current, 'data-fc-node-kind')
        ) {
            return current
        }
        current = 'parentNode' in current ? current.parentNode : null
    }
    return null
}

function replaceChildrenWithText(element: HtmlElement, value: string): void {
    clearChildren(element)
    defaultTreeAdapter.insertText(element, value)
}

function bindMetadata(
    project: ParsedHtmlSource,
    metadata: EntryMetadataInput,
    sourceMap: HtmlSourceMapBuilder,
): void {
    const values: Record<string, string> = {
        title: metadata.title,
        summary: metadata.summary,
        tags: metadata.tags.join('、'),
    }
    const currentElements: HtmlElement[] = []
    walkElements(project.root, element => currentElements.push(element))
    for (const element of currentElements) {
        const binding = getAttribute(element, 'data-fc-bind')
        if (binding && binding in values) {
            replaceChildrenWithText(element, values[binding])
            const text = element.childNodes[0]
            if (text) sourceMap.recordNodeOrigin(text, 'metadata-binding')
        }
    }
    const entryRoot = currentElements.find(
        element => getAttribute(element, 'data-fc-slot') === 'entry-root',
    )
    if (entryRoot) {
        setAttribute(entryRoot, 'data-fc-entry-id', metadata.id.toLowerCase())
        sourceMap.recordAttributeOrigin(entryRoot, 'data-fc-entry-id', 'renderer-generated')
    }
}

function cloneParsedSource(
    parsed: ParsedHtmlSource,
    root: ParsedHtmlSource['root'],
): ParsedHtmlSource {
    const elements: HtmlElement[] = []
    walkElements(root, element => elements.push(element))
    return {...parsed, root, elements, diagnostics: [...parsed.diagnostics]}
}

export function mergeEntryTemplate(
    project: ParsedHtmlSource,
    entry: ParsedHtmlSource,
    metadata: EntryMetadataInput,
): TemplateMergeResult {
    const sourceMap = new HtmlSourceMapBuilder()
    const projectCopy = cloneParsedSource(
        project,
        sourceMap.cloneAuthorTree(project.root, sourceKey('project', 'article.html')),
    )
    const entryCopy = cloneParsedSource(
        entry,
        sourceMap.cloneAuthorTree(entry.root, sourceKey('entry', 'article.html')),
    )
    const diagnostics = [...project.diagnostics, ...entry.diagnostics]
    const templateVersion = readTemplateVersion(projectCopy, diagnostics)
    const root = rootPatchTemplate(entryCopy, diagnostics)
    if (root && templateVersion !== null)
        validatePatchIdentity(root, metadata, templateVersion, diagnostics)

    const slots = new Map<string, HtmlElement>()
    for (const element of findElementsByAttribute(projectCopy, 'data-fc-slot')) {
        const name = getAttribute(element, 'data-fc-slot')
        if (name && !slots.has(name)) slots.set(name, element)
    }
    const operations = root ? parseOperations(root, diagnostics) : []
    validateOperationConflicts(operations, slots, diagnostics)

    if (hasBlockingDiagnostics(diagnostics) || !root || templateVersion === null) {
        return {html: null, parsedHtml: null, composition: null, diagnostics, templateVersion}
    }
    for (const operation of operations) {
        if (operation.kind === 'fill' || operation.kind === 'append') {
            const target = slots.get(operation.targetName)!
            sourceMap.recordChildListSource(target, operation.source, operation.kind, true)
            const targetIsManaged =
                hasAttribute(target, 'data-fc-node-id') && hasAttribute(target, 'data-fc-node-kind')
            const managedHost = targetIsManaged ? null : nearestManagedHost(target)
            if (managedHost && managedHost !== target) {
                sourceMap.recordChildListSource(
                    managedHost,
                    operation.source,
                    operation.kind,
                    false,
                )
            }
        }
    }
    applyOperations(operations, slots)
    bindMetadata(projectCopy, metadata, sourceMap)
    const composition = sourceMap.finish(projectCopy.root)
    const html = serialize(composition.root)
    const merged = validateHtmlTree(html, composition.root, {
        mode: 'document',
        scope: 'project',
    })
    diagnostics.push(...merged.diagnostics.filter(diagnostic => diagnostic.severity === 'error'))
    const valid = !hasBlockingDiagnostics(diagnostics)
    return {
        html: valid ? html : null,
        parsedHtml: valid ? merged : null,
        composition: valid ? composition : null,
        diagnostics,
        templateVersion,
    }
}
