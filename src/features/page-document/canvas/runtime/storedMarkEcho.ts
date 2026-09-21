/**
 * 把光标待输入标记渲染成画布本地的乐观结构，使键入当帧的外观与随后回传的权威渲染一致。
 *
 * 真值仍然只由内核补丁决定；这里的声明直接取自标记集，不做任何再加工，
 * 以免与内核的行内写入形成两套语义——两者一旦漂移，跳变会从「默认变设定」
 * 退化成「设定变另一种设定」，更难发现。回显元素带签名属性只为合并连续输入，
 * 权威渲染会整体替换掉它，因此该属性不会进入作者源码。
 */

import type {CanvasStoredMarks} from '../protocol/index.ts'

const ELEMENT_NODE = 1
const TEXT_NODE = 3

export const STORED_MARK_ECHO_ATTRIBUTE = 'data-fc-canvas-echo'

/** 标记集的行内声明；同时用作合并连续输入的签名，因此属性顺序必须稳定。 */
export function storedMarkStyle(marks: CanvasStoredMarks | null): string | null {
    if (!marks) return null
    const declarations = Object.entries(marks.values)
        .map(([property, value]) => [property.trim(), (value ?? '').trim()] as const)
        .filter(([property, value]) => property.length > 0 && value.length > 0)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([property, value]) => `${property}: ${value}`)
    return declarations.length > 0 ? declarations.join('; ') : null
}

/** 插入点紧邻的前一个兄弟节点若是同签名回显元素，连续输入并入其中而不是另起一个。 */
export function absorbableEchoElement(
    parentNode: Node | null,
    index: number,
    style: string | null,
): Element | null {
    if (!parentNode || !style || !Number.isInteger(index) || index <= 0) return null
    const previous = parentNode.childNodes[index - 1]
    if (!previous || previous.nodeType !== ELEMENT_NODE) return null
    const element = previous as Element
    return element.getAttribute(STORED_MARK_ECHO_ATTRIBUTE) === style ? element : null
}

/**
 * 把插入位置归一成「父节点 + 子节点下标」。落在文本节点内部时返回 null：
 * 此时前一个语义字符属于该文本节点，不存在可并入的相邻回显元素。
 */
export function echoInsertionPoint(
    container: Node | null,
    offset: number,
): {parentNode: Node; index: number} | null {
    if (!container || !Number.isInteger(offset) || offset < 0) return null
    if (container.nodeType !== TEXT_NODE) {
        return offset <= container.childNodes.length ? {parentNode: container, index: offset} : null
    }
    if (offset !== 0) return null
    const parentNode = container.parentNode
    if (!parentNode) return null
    const index = Array.from(parentNode.childNodes).indexOf(container as ChildNode)
    return index < 0 ? null : {parentNode, index}
}

/** 换行位置只产生 <br>；无标记集时保持裸文本节点，不引入多余元素。 */
export function buildOptimisticTextFragment(
    documentNode: Document,
    text: string,
    style: string | null,
): DocumentFragment {
    const fragment = documentNode.createDocumentFragment()
    for (const [index, part] of text.split('\n').entries()) {
        if (index > 0) fragment.appendChild(documentNode.createElement('br'))
        if (part.length === 0) continue
        if (!style) {
            fragment.appendChild(documentNode.createTextNode(part))
            continue
        }
        const span = documentNode.createElement('span')
        span.setAttribute('style', style)
        span.setAttribute(STORED_MARK_ECHO_ATTRIBUTE, style)
        span.appendChild(documentNode.createTextNode(part))
        fragment.appendChild(span)
    }
    return fragment
}
