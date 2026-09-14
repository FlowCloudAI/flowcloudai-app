// 本模块检查语义隐藏的文档级边界；它只使用组合树与组件定义，不依赖 UI 的提示性计数。

import type {DefaultTreeAdapterTypes} from 'parse5'
import type {HtmlCompositionElement} from '../composition/index.ts'
import type {ComponentIndex} from '../components/index.ts'
import type {ComponentHandle} from '../contracts/identity.ts'

export type ComponentVisibilityPolicyResult =
    | {readonly status: 'allowed'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export function checkComponentVisibilityPolicy(
    components: ComponentIndex,
    handle: ComponentHandle,
    hidden: boolean,
): ComponentVisibilityPolicyResult {
    if (!hidden) return Object.freeze({status: 'allowed'})
    const target = components.resolveElement(handle)
    if (!target) return rejected('stale-component-handle', '目标组件已经失效。')
    if (hasAttribute(target, 'data-fc-editor-root')) {
        return rejected('editor_root_hidden', '编辑根容器必须保持可见。')
    }
    const visibleParagraphRemains = components.query({kinds: ['paragraph']}).some(descriptor => {
        const element = components.resolveElement(descriptor.handle)
        return (
            element !== null &&
            !isDescendantOrSelf(element, target) &&
            !hasHiddenAncestorOrSelf(element)
        )
    })
    return visibleParagraphRemains
        ? Object.freeze({status: 'allowed'})
        : rejected('visible_paragraph_required', '隐藏后必须至少保留一个实际可见的段落。')
}

function isDescendantOrSelf(
    element: HtmlCompositionElement,
    ancestor: HtmlCompositionElement,
): boolean {
    let current: DefaultTreeAdapterTypes.Node | null = element
    while (current) {
        if (current === ancestor) return true
        current = parentOf(current)
    }
    return false
}

function hasHiddenAncestorOrSelf(element: HtmlCompositionElement): boolean {
    let current: DefaultTreeAdapterTypes.Node | null = element
    while (current) {
        if (isElement(current) && hasAttribute(current, 'hidden')) return true
        current = parentOf(current)
    }
    return false
}

function hasAttribute(element: HtmlCompositionElement, name: string): boolean {
    return element.attrs.some(attribute => attribute.name === name)
}

function isElement(node: DefaultTreeAdapterTypes.Node): node is HtmlCompositionElement {
    return 'tagName' in node
}

function parentOf(node: DefaultTreeAdapterTypes.Node): DefaultTreeAdapterTypes.ParentNode | null {
    return 'parentNode' in node ? node.parentNode : null
}

function rejected(
    code: string,
    message: string,
): Extract<ComponentVisibilityPolicyResult, {status: 'rejected'}> {
    return Object.freeze({status: 'rejected', code, message})
}
