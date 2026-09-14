// 本模块复制 HTML 语法树并记录组合来源；模板操作只修改副本，分析者可追溯元素、文本与属性的原始归属。

import type {DefaultTreeAdapterTypes} from 'parse5'
import {
    utf16Range,
    type SourceKey,
    type SourceOrigin,
    type SourceOriginKind,
} from '../contracts/source.ts'

export type HtmlCompositionRoot =
    DefaultTreeAdapterTypes.Document | DefaultTreeAdapterTypes.DocumentFragment
export type HtmlCompositionNode = DefaultTreeAdapterTypes.Node
export type HtmlCompositionElement = DefaultTreeAdapterTypes.Element

export interface HtmlChildListSource {
    readonly source: SourceKey
    readonly container: HtmlCompositionElement
    readonly mode: 'author' | 'fill' | 'append'
    readonly replacesOwnChildren: boolean
}

export interface HtmlSourceMap {
    readonly root: HtmlCompositionRoot
    originOfNode(node: HtmlCompositionNode): SourceOrigin | null
    originOfAttribute(element: HtmlCompositionElement, name: string): SourceOrigin | null
    childListSources(element: HtmlCompositionElement): readonly HtmlChildListSource[]
}

export interface HtmlComposition {
    readonly root: HtmlCompositionRoot
    readonly sourceMap: HtmlSourceMap
}

/** 组合过程内部使用的记录器；调用 finish 后暴露的只有只读查询接口。 */
export class HtmlSourceMapBuilder {
    readonly #nodeOrigins = new WeakMap<HtmlCompositionNode, SourceOrigin>()
    readonly #attributeOrigins = new WeakMap<
        HtmlCompositionElement,
        ReadonlyMap<string, SourceOrigin>
    >()
    readonly #childListSources = new WeakMap<
        HtmlCompositionElement,
        readonly HtmlChildListSource[]
    >()

    cloneAuthorTree<T extends HtmlCompositionRoot>(root: T, source: SourceKey): T {
        const clone = cloneHtmlTree(root)
        this.#registerAuthorTree(clone, source)
        return clone
    }

    recordNodeOrigin(node: HtmlCompositionNode, kind: Exclude<SourceOriginKind, 'author'>): void {
        this.#nodeOrigins.set(node, generatedOrigin(kind))
    }

    recordAttributeOrigin(
        element: HtmlCompositionElement,
        name: string,
        kind: Exclude<SourceOriginKind, 'author'>,
    ): void {
        const current = new Map(this.#attributeOrigins.get(element) ?? [])
        current.set(name.toLowerCase(), generatedOrigin(kind))
        this.#attributeOrigins.set(element, current)
    }

    recordChildListSource(
        element: HtmlCompositionElement,
        container: HtmlCompositionElement,
        mode: 'fill' | 'append',
        replacesOwnChildren: boolean,
    ): void {
        const origin = this.#nodeOrigins.get(container)
        if (origin?.kind !== 'author' || !origin.source) {
            throw new TypeError('组合子列表来源必须指向作者 HTML。')
        }
        const current = this.#childListSources.get(element) ?? []
        this.#childListSources.set(
            element,
            Object.freeze([
                ...current,
                Object.freeze({
                    source: origin.source,
                    container,
                    mode,
                    replacesOwnChildren,
                }),
            ]),
        )
    }

    finish(root: HtmlCompositionRoot): HtmlComposition {
        const sourceMap: HtmlSourceMap = Object.freeze({
            root,
            originOfNode: (node: HtmlCompositionNode) => this.#nodeOrigins.get(node) ?? null,
            originOfAttribute: (element: HtmlCompositionElement, name: string) =>
                this.#attributeOrigins.get(element)?.get(name.toLowerCase()) ?? null,
            childListSources: (element: HtmlCompositionElement) =>
                this.#resolvedChildListSources(element),
        })
        return Object.freeze({root, sourceMap})
    }

    #resolvedChildListSources(element: HtmlCompositionElement): readonly HtmlChildListSource[] {
        const patched = this.#childListSources.get(element) ?? []
        const hasFill = patched.some(item => item.mode === 'fill' && item.replacesOwnChildren)
        const ownOrigin = this.#nodeOrigins.get(element)
        const own =
            !hasFill && ownOrigin?.kind === 'author' && ownOrigin.source
                ? [
                      Object.freeze({
                          source: ownOrigin.source,
                          container: element,
                          mode: 'author' as const,
                          replacesOwnChildren: false,
                      }),
                  ]
                : []
        return Object.freeze([...own, ...patched])
    }

    #registerAuthorTree(root: HtmlCompositionRoot, source: SourceKey): void {
        visitTree(root, node => {
            this.#nodeOrigins.set(node, authorOrigin(source, node.sourceCodeLocation))
            if (!isElement(node)) return
            const attributeOrigins = new Map<string, SourceOrigin>()
            for (const attribute of node.attrs) {
                const location = node.sourceCodeLocation?.attrs?.[attribute.name]
                attributeOrigins.set(attribute.name.toLowerCase(), authorOrigin(source, location))
            }
            this.#attributeOrigins.set(node, attributeOrigins)
        })
    }
}

/** 预览等派生消费者需要独立副本时使用；不会通过序列化重建语法树。 */
export function cloneHtmlTree<T extends HtmlCompositionRoot>(root: T): T {
    return structuredClone(root)
}

function authorOrigin(
    source: SourceKey,
    location: {readonly startOffset: number; readonly endOffset: number} | null | undefined,
): SourceOrigin {
    return Object.freeze({
        kind: 'author',
        source,
        range: location ? utf16Range(location.startOffset, location.endOffset) : null,
    })
}

function generatedOrigin(kind: Exclude<SourceOriginKind, 'author'>): SourceOrigin {
    return Object.freeze({kind, source: null, range: null})
}

function isElement(node: HtmlCompositionNode): node is HtmlCompositionElement {
    return 'tagName' in node
}

function childrenOf(node: HtmlCompositionNode): readonly DefaultTreeAdapterTypes.ChildNode[] {
    if (isElement(node) && node.tagName === 'template' && 'content' in node) {
        return node.content.childNodes
    }
    return 'childNodes' in node ? node.childNodes : []
}

function visitTree(root: HtmlCompositionRoot, visitor: (node: HtmlCompositionNode) => void): void {
    const visit = (node: HtmlCompositionNode): void => {
        visitor(node)
        for (const child of childrenOf(node)) visit(child)
    }
    visit(root)
}
