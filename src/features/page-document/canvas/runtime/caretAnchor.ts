/**
 * 画布本地的插入点锚点：存在待输入标记时，让光标停在一个带标记声明的行内元素里。
 *
 * 光标本身与输入法候选文字都由浏览器按光标所在位置的样式原生绘制，不经过乐观回显。
 * 光标紧跟同格式文字时会继承其样式；换行之后、文本块开头或刚切换格式的位置，前方没有
 * 同格式文字可继承，原生绘制就退回文本块默认格式——表现为光标变色、候选文字先默认后跳变。
 *
 * 锚点只存在于画布 DOM：语义文本与偏移映射把它视为长度为零（见 semanticTextPosition），
 * 权威渲染整体替换时随之消失，不进入作者源码、撤销历史或任何发往宿主的偏移。
 * 空行内元素无法稳定容纳光标，因此内含一个零宽填充字符。
 */

export const CARET_ANCHOR_ATTRIBUTE = 'data-fc-canvas-caret-anchor'
export const CARET_ANCHOR_FILLER = '\u200B'

const ELEMENT_NODE = 1
const TEXT_NODE = 3

/**
 * 块末尾的换行之后没有可渲染的行：WebKit 会把「末尾 <br> 之后」规范化到 <br> 之前，
 * 光标与输入法候选文字都会落回上一行。这个位置同样需要锚点撑出真实的一行。
 */
export function caretAfterTrailingBreak(text: string, offset: number): boolean {
    return offset === text.length && text.endsWith('\n')
}

export function isCaretAnchor(value: Node): boolean {
    return value.nodeType === ELEMENT_NODE && (value as Element).hasAttribute(CARET_ANCHOR_ATTRIBUTE)
}

export function createCaretAnchor(
    documentNode: Document,
    style: string,
): {anchor: Element; filler: Text} {
    const anchor = documentNode.createElement('span')
    anchor.setAttribute(CARET_ANCHOR_ATTRIBUTE, '')
    anchor.setAttribute('style', style)
    const filler = documentNode.createTextNode(CARET_ANCHOR_FILLER)
    anchor.appendChild(filler)
    return {anchor, filler}
}

export function findCaretAnchors(scope: Element): Element[] {
    return Array.from(scope.getElementsByTagName('span')).filter(isCaretAnchor)
}

/**
 * 移除锚点。锚点正常只含填充字符；若意外含有其他内容，内容去掉填充字符后留在原位，
 * 宁可短暂失去格式也不静默丢字，下一次权威渲染会纠正外观。
 */
export function removeCaretAnchor(anchor: Element): void {
    const parent = anchor.parentNode
    if (!parent) return
    const ownerDocument = anchor.ownerDocument
    for (const child of Array.from(anchor.childNodes)) {
        if (child.nodeType === TEXT_NODE) {
            const text = (child.nodeValue ?? '').split(CARET_ANCHOR_FILLER).join('')
            if (text.length > 0 && ownerDocument) parent.insertBefore(ownerDocument.createTextNode(text), anchor)
            continue
        }
        parent.insertBefore(child, anchor)
    }
    parent.removeChild(anchor)
}
