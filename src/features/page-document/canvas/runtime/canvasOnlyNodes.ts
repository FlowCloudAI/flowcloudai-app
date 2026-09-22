/**
 * 画布自有的 DOM 节点：只在画布里出现，不来自作者源码，也不进入语义文本与偏移。
 *
 * 插入点锚点撑住带待输入格式的光标，文本块占位换行撑出空块与块末换行后的最后一行。
 * 两者语义长度都为零；作者源码中的同名属性由隔离层整体剥离（data-fc-canvas-* 命名空间），
 * 否则作者可以让画布与内核对同一段文字算出不同偏移。
 */

export const CARET_ANCHOR_ATTRIBUTE = 'data-fc-canvas-caret-anchor'
export const TEXT_BLOCK_PLACEHOLDER_ATTRIBUTE = 'data-fc-canvas-placeholder'

const ELEMENT_NODE = 1

function hasAttribute(value: Node, attribute: string): boolean {
    return value.nodeType === ELEMENT_NODE && (value as Element).hasAttribute(attribute)
}

export function isCaretAnchor(value: Node): boolean {
    return hasAttribute(value, CARET_ANCHOR_ATTRIBUTE)
}

export function isTextBlockPlaceholder(value: Node): boolean {
    return hasAttribute(value, TEXT_BLOCK_PLACEHOLDER_ATTRIBUTE)
}

export function isCanvasOnlyNode(value: Node): boolean {
    return isCaretAnchor(value) || isTextBlockPlaceholder(value)
}
