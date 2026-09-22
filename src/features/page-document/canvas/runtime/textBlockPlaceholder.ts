/**
 * 文本块的末行占位：空文本块，或以换行结尾的文本块，在块末补一个占位 <br>，使最后一行真实存在。
 *
 * HTML 中空块没有行盒、块末单独的 <br> 不产生新行，因此块末 Enter 产生的空行、在块末拆出的
 * 新块都看不见，光标与输入法候选也会被规范化回上一行。文本块承担的是文本框能力，这里按文字处理
 * 软件的语义让每个换行后的行都可见。占位只存在于画布 DOM，阅读与编辑共用同一渲染路径，
 * 所见即所得；语义长度为零（见 canvasOnlyNodes），源码不变。
 *
 * 占位总是块的最后一个子节点：同一语义偏移上的插入点锚点与乐观插入都落在它之前。
 */

import {CANVAS_EDITABLE_KINDS} from '../protocol/index.ts'
import {TEXT_BLOCK_PLACEHOLDER_ATTRIBUTE, isTextBlockPlaceholder} from './canvasOnlyNodes.ts'
import {semanticText} from './semanticTextPosition.ts'

const textBlockKinds = new Set<string>(CANVAS_EDITABLE_KINDS)

export function textBlockNeedsPlaceholder(text: string): boolean {
    return text.length === 0 || text.endsWith('\n')
}

export function isPlaceholderTextBlock(value: Element): boolean {
    return value.hasAttribute('data-fc-node-id') && textBlockKinds.has(value.getAttribute('data-fc-node-kind') ?? '')
}

function containsTextBlock(block: Element): boolean {
    return Array.from(block.getElementsByTagName('*')).some(isPlaceholderTextBlock)
}

/**
 * 让单个文本块的占位与其语义文本一致；已经一致时不改动 DOM。返回是否发生了改动。
 * 只处理不再包含其他文本块的叶子块，否则外层会在内层块之后多出一行。
 */
export function syncTextBlockPlaceholder(block: Element): boolean {
    // 非叶子块内部的占位属于内层块，外层不增不删。
    if (containsTextBlock(block)) return false
    const placeholders = Array.from(block.getElementsByTagName('br')).filter(isTextBlockPlaceholder)
    const needed = textBlockNeedsPlaceholder(semanticText(block))
    const last = block.lastChild
    if (needed && placeholders.length === 1 && placeholders[0] === last) return false
    if (!needed && placeholders.length === 0) return false
    for (const placeholder of placeholders) placeholder.parentNode?.removeChild(placeholder)
    if (needed && block.ownerDocument) {
        const placeholder = block.ownerDocument.createElement('br')
        placeholder.setAttribute(TEXT_BLOCK_PLACEHOLDER_ATTRIBUTE, '')
        block.appendChild(placeholder)
    }
    return true
}

export function syncTextBlockPlaceholders(scope: Element): void {
    for (const element of Array.from(scope.getElementsByTagName('*'))) {
        if (isPlaceholderTextBlock(element)) syncTextBlockPlaceholder(element)
    }
}
