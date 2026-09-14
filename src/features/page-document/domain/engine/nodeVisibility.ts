// 本模块定义作者 HTML 的语义可见性边界；只解释 hidden 属性，不尝试模拟完整 CSS 级联。
import {getAttribute, walkElements, type HtmlElement, type ParsedHtmlSource} from './htmlParser.ts'

export function isSemanticallyHidden(element: HtmlElement): boolean {
    return getAttribute(element, 'hidden') !== undefined
}

export function elementAncestorMap(
    parsed: ParsedHtmlSource,
): ReadonlyMap<HtmlElement, readonly HtmlElement[]> {
    const ancestors = new Map<HtmlElement, readonly HtmlElement[]>()
    walkElements(parsed.root, (element, chain) => ancestors.set(element, chain))
    return ancestors
}

export function isHiddenBySemanticAncestor(
    element: HtmlElement,
    ancestors: ReadonlyMap<HtmlElement, readonly HtmlElement[]>,
): boolean {
    return (ancestors.get(element) ?? []).some(isSemanticallyHidden)
}

export function visibleManagedParagraphs(
    parsed: ParsedHtmlSource,
    ancestors: ReadonlyMap<HtmlElement, readonly HtmlElement[]> = elementAncestorMap(parsed),
): HtmlElement[] {
    return parsed.elements.filter(
        element =>
            getAttribute(element, 'data-fc-node-kind') === 'paragraph' &&
            !isSemanticallyHidden(element) &&
            !isHiddenBySemanticAncestor(element, ancestors),
    )
}

export function hidingElementKeepsVisibleParagraph(
    parsed: ParsedHtmlSource,
    element: HtmlElement,
): boolean {
    const ancestors = elementAncestorMap(parsed)
    return visibleManagedParagraphs(parsed, ancestors).some(
        paragraph => paragraph !== element && !(ancestors.get(paragraph) ?? []).includes(element),
    )
}
