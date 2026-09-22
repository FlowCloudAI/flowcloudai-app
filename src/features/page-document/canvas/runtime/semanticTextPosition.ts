/**
 * 维护画布 DOM 位置与页面文档语义文本偏移之间的映射。
 *
 * 子节点的语义区间按半开区间处理：位置恰好落在子元素首尾时，归属最近的共同父级，
 * 不进入相邻的行内元素。这样在已有格式片段的紧邻位置输入时，不会因遍历顺序意外
 * 继承左侧或右侧 span；只有严格位于元素语义区间内部的位置才归属该元素。
 *
 * 画布自有节点（插入点锚点、文本块占位换行，见 canvasOnlyNodes）语义长度为零：其内任何 DOM
 * 位置都映射到该节点起点，语义偏移也永远不会被定位进它们内部。
 */

import {isCanvasOnlyNode} from './canvasOnlyNodes.ts'

const ELEMENT_NODE = 1
const TEXT_NODE = 3

function isLineBreak(value: Node): boolean {
    return value.nodeType === ELEMENT_NODE && (value as Element).tagName.toUpperCase() === 'BR'
}

export function semanticLength(value: Node): number {
    if (isCanvasOnlyNode(value)) return 0
    if (value.nodeType === TEXT_NODE) return value.textContent?.length ?? 0
    if (isLineBreak(value)) return 1
    return Array.from(value.childNodes).reduce((total, child) => total + semanticLength(child), 0)
}

export function semanticText(value: Node): string {
    if (isCanvasOnlyNode(value)) return ''
    if (value.nodeType === TEXT_NODE) return value.textContent ?? ''
    if (isLineBreak(value)) return '\n'
    return Array.from(value.childNodes).map(semanticText).join('')
}

function isSameOrDescendant(ancestor: Node, value: Node): boolean {
    for (let current: Node | null = value; current; current = current.parentNode) {
        if (current === ancestor) return true
    }
    return false
}

export function semanticOffset(rootNode: Node, container: Node, offset: number): number | null {
    let total = 0
    let resolved: number | null = null
    let found = false
    const visit = (value: Node): void => {
        if (found) return
        if (isCanvasOnlyNode(value)) {
            if (isSameOrDescendant(value, container)) {
                found = true
                resolved = total
            }
            return
        }
        if (value === container) {
            found = true
            if (value.nodeType === TEXT_NODE) {
                const length = value.textContent?.length ?? 0
                if (Number.isInteger(offset) && offset >= 0 && offset <= length) resolved = total + offset
                return
            }
            if (!Number.isInteger(offset) || offset < 0 || offset > value.childNodes.length) return
            for (let index = 0; index < offset; index += 1) total += semanticLength(value.childNodes[index])
            resolved = total
            return
        }
        if (value.nodeType === TEXT_NODE || isLineBreak(value)) {
            total += semanticLength(value)
            return
        }
        Array.from(value.childNodes).forEach(visit)
    }
    visit(rootNode)
    return resolved
}

export function locateTextOffset(rootNode: Node, offset: number): {node: Node; offset: number} | null {
    if (!Number.isInteger(offset) || offset < 0 || offset > semanticLength(rootNode)) return null
    let remaining = offset
    const locate = (parentNode: Node): {node: Node; offset: number} => {
        const children = Array.from(parentNode.childNodes)
        for (const [index, child] of children.entries()) {
            if (remaining === 0) return {node: parentNode, offset: index}
            const length = semanticLength(child)
            if (remaining < length) {
                if (child.nodeType === TEXT_NODE) return {node: child, offset: remaining}
                if (isLineBreak(child)) return {node: parentNode, offset: index}
                return locate(child)
            }
            remaining -= length
            if (remaining === 0) return {node: parentNode, offset: index + 1}
        }
        return {node: parentNode, offset: children.length}
    }
    return locate(rootNode)
}
